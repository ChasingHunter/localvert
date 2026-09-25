import type { EngineInput, EngineResult } from "@/lib/engines";
import { toEngineError } from "@/lib/engines";
import { ENGINE_MANIFEST } from "@/lib/engines/manifest";
import type {
  Capabilities,
  Category,
  FormatId,
  ToolDefinition,
} from "@/lib/registry";
import { CATEGORY_META, outputFileName } from "@/lib/registry";
import {
  NoEngineError,
  type ResolvedStep,
  resolvePipeline,
} from "@/lib/router";
import { collectToBlob } from "@/lib/sinks";
import type { RunStep, WorkerPool, ZipResult } from "@/lib/workers";
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
  // A done job's output blob(s), kept alongside their object URL(s) so
  // `zipOutputs` can hand the actual bytes to the zip worker without
  // re-fetching a URL. Always an array — one entry for a one-to-one or
  // many-to-one job's single output, N entries for a one-to-many job's
  // multiple outputs (ADR-0008) — so `zipOutputs` doesn't need to know which
  // arity produced a given job.
  const outputBlobs = new Map<string, { name: string; blob: Blob }[]>();

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

    if (tool.arity === "many-to-one") {
      return submitManyToOne(tool, files, resolved, parsed.data);
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

      dispatch({
        tool,
        id,
        file,
        steps: buildSteps(tool, resolved, format),
        parsedOptions: parsed.data,
      });
    }

    return ids;
  }

  /**
   * ADR-0008: a many-to-one submission is **one** job that owns every file
   * in `files`, in the order the caller gave them (the order the user
   * arranged them in `FileOrderList`) — never one job per file, unlike the
   * loop in `submit` above. `files[0]` stands in for "the file" wherever a
   * single representative is needed (naming, the sniffed format every
   * declared pipeline step falls back to).
   */
  function submitManyToOne(
    tool: ToolDefinition,
    files: SubmitFile[],
    resolved: ReturnType<typeof resolvePipeline> | NoEngineError,
    parsedOptions: unknown,
  ): string[] {
    if (files.length === 0) return [];

    const id = makeId();
    const first = files[0];
    if (!first) return [id]; // unreachable: guarded by the length check above
    const totalSize = files.reduce((sum, f) => sum + f.file.size, 0);
    const fileName =
      files.length === 1 ? first.file.name : `${files.length} files`;

    if (resolved instanceof NoEngineError) {
      store.getState().add({
        id,
        toolSlug: tool.slug,
        fileName,
        inputSize: totalSize,
        inputFormat: first.format,
        status: "error",
        progress: 0,
        error: { code: "unsupported", message: resolved.message },
      });
      return [id];
    }

    store.getState().add({
      id,
      toolSlug: tool.slug,
      fileName,
      inputSize: totalSize,
      inputFormat: first.format,
      status: "queued",
      progress: 0,
    });

    dispatch({
      tool,
      id,
      file: first.file,
      inputs: files.map((f): EngineInput => ({ kind: "blob", blob: f.file })),
      steps: buildSteps(tool, resolved, first.format),
      parsedOptions,
    });

    return [id];
  }

  /**
   * Zips each resolved step (op + engine, from `resolvePipeline`) with the
   * tool's own declared step (which carries `baseUrl`'s ingredients and, for
   * an `imagePipeline`-built tool, the step's `from`/`to` formats) and this
   * file's sniffed input format, into the `RunStep[]` a `RunRequest` sends
   * to a worker. A step with no declared `from`/`to` (a single-step tool
   * that predates ADR-0007's raster pipeline) falls back to
   * (this file's format -> `tool.produces`) — the same pair `job-engine.ts`
   * always used before this field existed. `tool.produces === "same"` (e.g.
   * `strip-exif`) has no fixed format to fall back to — the file's own
   * sniffed format is the output format too, since the tool guarantees its
   * output is always the same format as its input.
   */
  function buildSteps(
    tool: ToolDefinition,
    resolved: readonly ResolvedStep[],
    format: FormatId,
  ): RunStep[] {
    return resolved.map((step, i) => {
      const declared = tool.pipeline[i];
      if (!declared) {
        // Unreachable: resolvePipeline maps tool.pipeline 1:1.
        throw new Error(
          `[job] tool "${tool.slug}" resolved more steps than it declared`,
        );
      }
      const produces = tool.produces === "same" ? format : tool.produces;
      return {
        engine: step.engine,
        baseUrl: ENGINE_MANIFEST[step.engine].baseUrl,
        op: step.op,
        inputFormat: declared.from ?? format,
        outputFormat: declared.to ?? produces,
      };
    });
  }

  interface DispatchArgs {
    tool: ToolDefinition;
    id: string;
    file: File;
    /** ADR-0008: every input file, in order, for a many-to-one job.
     * Undefined for every other arity — `file` above is the whole input. */
    inputs?: readonly EngineInput[];
    steps: readonly RunStep[];
    parsedOptions: unknown;
  }

  function dispatch(args: DispatchArgs): void {
    const { tool, id, file, inputs, steps, parsedOptions } = args;
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
            input: { kind: "blob", blob: file },
            inputs,
            steps,
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

    if (result.kind === "raster") {
      // Unreachable: engine-host.ts (ADR-0007) rejects a pipeline whose
      // final step produces a raw raster rather than bytes/stream/opfs
      // before it ever gets here — see "pipeline ended without an encode
      // step". Handled anyway so this function's `result` narrowing stays
      // exhaustive rather than assuming that guarantee holds.
      store.getState().update(id, {
        status: "error",
        error: {
          code: "internal",
          message: "pipeline ended without an encode step",
        },
      });
      return;
    }

    if (result.kind === "files") {
      // ADR-0008, one-to-many (e.g. split-pdf): every produced file gets its
      // own blob/url, named by the engine — `job-engine.ts` trusts those
      // names as-is, so `outputBlobs`' own de-duplication (via
      // `zipOutputs` -> `uniqueName` in the zip sink) is what keeps two
      // identically-named outputs from colliding inside a zip.
      const outputs = result.files.map((f) => {
        const blob = new Blob([f.bytes], { type: f.mime });
        return { name: f.name, mime: f.mime, size: blob.size, blob };
      });
      outputBlobs.set(
        id,
        outputs.map(({ name, blob }) => ({ name, blob })),
      );
      store.getState().update(id, {
        status: "done",
        progress: 1,
        outputs: outputs.map((o) => ({ ...o, url: createObjectURL(o.blob) })),
      });
      return;
    }

    const blob =
      result.kind === "bytes"
        ? new Blob([result.bytes], { type: result.mime })
        : await collectToBlob(result.stream, result.mime);

    const name = outputFileName(tool, file.name, parsedOptions);
    const url = createObjectURL(blob);
    outputBlobs.set(id, [{ name, blob }]);

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
      const forJob = outputBlobs.get(id);
      if (forJob) entries.push(...forJob);
    }
    const { stream } = await zip(entries);
    return stream;
  }

  function dispose(): void {
    cancelAll();
  }

  return { submit, cancel, cancelAll, zipOutputs, dispose };
}
