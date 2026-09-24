import type { EngineResult } from "@/lib/engines";
import { toEngineError } from "@/lib/engines";
import { ENGINE_MANIFEST } from "@/lib/engines/manifest";
import type {
  Capabilities,
  Category,
  EngineId,
  FormatId,
  Operation,
  ToolDefinition,
} from "@/lib/registry";
import { CATEGORY_META, outputFileName } from "@/lib/registry";
import { NoEngineError, resolvePipeline } from "@/lib/router";
import { collectToBlob } from "@/lib/sinks";
import type { WorkerPool, ZipResult } from "@/lib/workers";
import { zipInWorker } from "@/lib/workers";
import type { JobStore } from "./store";

/**
 * MAIN THREAD. Turns a tool + a batch of files into tracked `Job`s, dispatches
 * them to the worker pool, and mirrors their progress/results into the job
 * store. See docs/ARCHITECTURE.md's diagram — this is the "job engine" box.
 */

export interface SubmitFile {
  file: File;
  format: FormatId;
}

export interface JobEngine {
  /** Validates `options`, resolves the tool's pipeline, and dispatches one
   * job per file. Returns the new jobs' ids, in the same order as `files`. */
  submit(tool: ToolDefinition, files: SubmitFile[], options: unknown): string[];
  cancel(id: string): void;
  cancelAll(): void;
  /** Zips the given jobs' outputs (every done job, if `ids` is omitted). */
  zipOutputs(ids?: string[]): Promise<ReadableStream<Uint8Array>>;
  /** Cancels every in-flight job. */
  dispose(): void;
}

export interface JobEngineOptions {
  pool: WorkerPool;
  capabilities: Capabilities;
  store: JobStore;
  createObjectURL?: (blob: Blob) => string;
  now?: () => number;
  zip?: (entries: { name: string; blob: Blob }[]) => Promise<ZipResult>;
}

/** Tracks one dispatched-but-not-yet-settled job, for `cancel`/`cancelAll`. */
interface Inflight {
  controller: AbortController;
}

export function createJobEngine(opts: JobEngineOptions): JobEngine {
  const {
    pool,
    capabilities,
    store,
    createObjectURL = URL.createObjectURL,
    now = Date.now,
    zip = zipInWorker,
  } = opts;

  const inflight = new Map<string, Inflight>();
  // A done job's blob, kept alongside its object URL so `zipOutputs` can
  // hand the actual bytes to the zip worker without re-fetching the URL.
  const outputBlobs = new Map<string, { name: string; blob: Blob }>();

  // One FIFO chain per "single"-concurrency category (see CATEGORY_META) —
  // a small semaphore of concurrency 1. "pool" categories skip this
  // entirely and let the worker pool's own queue do the work.
  const singleQueues = new Map<Category, Promise<void>>();
  function runSingle(category: Category, task: () => Promise<void>): void {
    const prior = singleQueues.get(category) ?? Promise.resolve();
    // `task` runs regardless of how the previous link settled — one failed
    // job must not stall every job queued behind it in the same category.
    const next = prior.then(task, task);
    singleQueues.set(
      category,
      next.catch(() => {}),
    );
  }

  let jobCounter = 0;
  function makeId(): string {
    return `job-${now()}-${jobCounter++}`;
  }

  function submit(
    tool: ToolDefinition,
    files: SubmitFile[],
    options: unknown,
  ): string[] {
    const parsed = tool.options.safeParse(options);
    if (!parsed.success) {
      throw new Error(`[job] invalid options: ${parsed.error.message}`);
    }

    let resolved: ReturnType<typeof resolvePipeline> | NoEngineError;
    try {
      resolved = resolvePipeline(tool, capabilities);
    } catch (e) {
      if (!(e instanceof NoEngineError)) throw e;
      resolved = e;
    }

    if (!(resolved instanceof NoEngineError) && resolved.length > 1) {
      // Lands with the first multi-step tool.
      throw new Error("multi-step pipelines are not supported yet");
    }

    const ids: string[] = [];
    for (const { file, format } of files) {
      const id = makeId();
      ids.push(id);

      if (resolved instanceof NoEngineError) {
        store.getState().add({
          id,
          toolSlug: tool.slug,
          fileName: file.name,
          inputSize: file.size,
          inputFormat: format,
          status: "error",
          progress: 0,
          error: { code: "unsupported", message: resolved.message },
        });
        continue;
      }

      store.getState().add({
        id,
        toolSlug: tool.slug,
        fileName: file.name,
        inputSize: file.size,
        inputFormat: format,
        status: "queued",
        progress: 0,
      });

      const step = resolved[0];
      if (!step) {
        // Unreachable: defineTool requires every pipeline to have at least
        // one step, and resolvePipeline resolves one engine per step.
        throw new Error(`[job] tool "${tool.slug}" resolved to no steps`);
      }
      dispatch({
        tool,
        id,
        file,
        inputFormat: format,
        engine: step.engine,
        op: step.op,
        parsedOptions: parsed.data,
      });
    }

    return ids;
  }

  interface DispatchArgs {
    tool: ToolDefinition;
    id: string;
    file: File;
    inputFormat: FormatId;
    engine: EngineId;
    op: Operation;
    parsedOptions: unknown;
  }

  function dispatch(args: DispatchArgs): void {
    const { tool, id, file, inputFormat, engine, op, parsedOptions } = args;
    const controller = new AbortController();
    inflight.set(id, { controller });

    const execute = async (): Promise<void> => {
      if (controller.signal.aborted) {
        store.getState().update(id, {
          status: "cancelled",
          error: { code: "aborted", message: "cancelled while queued" },
        });
        inflight.delete(id);
        return;
      }

      store.getState().update(id, { status: "running" });

      try {
        const result = await pool.run(
          {
            jobId: id,
            engine,
            baseUrl: ENGINE_MANIFEST[engine].baseUrl,
            op,
            input: { kind: "blob", blob: file },
            inputFormat,
            outputFormat: tool.produces,
            options: parsedOptions as Record<string, unknown>,
          },
          {
            signal: controller.signal,
            onProgress: (fraction) => {
              store.getState().update(id, { progress: fraction });
            },
          },
        );
        await applyResult({ tool, id, file, parsedOptions, result });
      } catch (e) {
        applyError(id, e);
      } finally {
        inflight.delete(id);
      }
    };

    if (CATEGORY_META[tool.category].concurrency === "single") {
      runSingle(tool.category, execute);
    } else {
      void execute();
    }
  }

  interface ApplyResultArgs {
    tool: ToolDefinition;
    id: string;
    file: File;
    parsedOptions: unknown;
    result: EngineResult;
  }

  async function applyResult(args: ApplyResultArgs): Promise<void> {
    const { tool, id, file, parsedOptions, result } = args;

    if (result.kind === "opfs") {
      // OPFS-spilled outputs aren't wired up on the main thread yet — see
      // docs/ROADMAP.md for when the OPFS sink lands.
      store.getState().update(id, {
        status: "error",
        error: {
          code: "unsupported",
          message: "OPFS outputs are not supported yet",
        },
      });
      return;
    }

    const blob =
      result.kind === "bytes"
        ? new Blob([result.bytes], { type: result.mime })
        : await collectToBlob(result.stream, result.mime);

    const name = outputFileName(tool, file.name, parsedOptions);
    const url = createObjectURL(blob);
    outputBlobs.set(id, { name, blob });

    store.getState().update(id, {
      status: "done",
      progress: 1,
      output: { name, mime: result.mime, size: blob.size, url },
    });
  }

  function applyError(id: string, e: unknown): void {
    const err = toEngineError(e);
    store.getState().update(id, {
      status: err.code === "aborted" ? "cancelled" : "error",
      error: { code: err.code, message: err.message },
    });
  }

  function cancel(id: string): void {
    inflight.get(id)?.controller.abort();
  }

  function cancelAll(): void {
    for (const { controller } of inflight.values()) controller.abort();
  }

  async function zipOutputs(
    ids?: string[],
  ): Promise<ReadableStream<Uint8Array>> {
    const targets = ids ?? [...outputBlobs.keys()];
    const entries: { name: string; blob: Blob }[] = [];
    for (const id of targets) {
      const entry = outputBlobs.get(id);
      if (entry) entries.push(entry);
    }
    const { stream } = await zip(entries);
    return stream;
  }

  function dispose(): void {
    cancelAll();
  }

  return { submit, cancel, cancelAll, zipOutputs, dispose };
}
