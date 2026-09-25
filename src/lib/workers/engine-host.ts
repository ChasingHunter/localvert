import type {
  EngineAdapter,
  EngineInput,
  EngineInstance,
  EngineResult,
} from "@/lib/engines";
import { EngineError, toEngineError } from "@/lib/engines";
import type { Capabilities, EngineId } from "@/lib/registry";
import type {
  EngineHostApi,
  RunOutcome,
  RunRequest,
  RunStep,
} from "./protocol";
import { serializeEngineError } from "./protocol";

/**
 * Runs inside the worker. Environment-neutral code, no DOM — see ADR-0005.
 * The main thread never imports this module; it only ever talks to it
 * through an RPC layer (Comlink, wired up when the real `*.worker.ts` entry
 * lands in Phase 0.5) implementing `EngineHostApi`.
 */

/** At most 10 progress calls per second reach the caller, regardless of how
 * often the adapter calls `onProgress` — an adapter is free to call it every
 * decoded frame. */
const PROGRESS_INTERVAL_MS = 100;

interface CacheEntry {
  adapter: EngineAdapter;
  instance: EngineInstance;
}

export function createEngineHost(
  loaders: Partial<Record<EngineId, () => Promise<{ default: EngineAdapter }>>>,
  probe: () => Capabilities,
): EngineHostApi {
  const cache = new Map<EngineId, CacheEntry>();
  // In-flight `load()` calls, keyed by engine — so two `run()`s racing to
  // load the same engine share one `adapter.load()` rather than each paying
  // for (and each caching) their own.
  const loading = new Map<EngineId, Promise<CacheEntry>>();
  const controllers = new Map<string, AbortController>();

  function loadEngine(engine: EngineId, baseUrl: string): Promise<CacheEntry> {
    const cached = cache.get(engine);
    if (cached) return Promise.resolve(cached);

    const inFlight = loading.get(engine);
    if (inFlight) return inFlight;

    const loader = loaders[engine];
    if (!loader) {
      return Promise.reject(
        new EngineError(
          "unsupported",
          `no adapter registered for engine "${engine}"`,
          { engine },
        ),
      );
    }

    const promise = (async () => {
      try {
        const mod = await loader();
        const adapter = mod.default;
        const instance = await adapter.load({ baseUrl, capabilities: probe() });
        const entry: CacheEntry = { adapter, instance };
        // Cache before this async function's own promise settles, so a
        // caller that awaits `loadEngine` next always sees the entry.
        cache.set(engine, entry);
        return entry;
      } catch (cause) {
        // Deliberately not cached — a transient failure (a flaky fetch of
        // the wasm asset, say) should not permanently strand this engine.
        throw new EngineError(
          "load-failed",
          `engine "${engine}" failed to load`,
          { engine, cause },
        );
      } finally {
        loading.delete(engine);
      }
    })();

    loading.set(engine, promise);
    // The map holding a promise nothing has awaited yet would otherwise be
    // an unhandled rejection on load failure; callers still get the real
    // rejection from the promise returned below.
    promise.catch(() => {});
    return promise;
  }

  function probeApi(): Capabilities {
    return probe();
  }

  function clamp01(n: number): number {
    return Math.min(1, Math.max(0, n));
  }

  /**
   * Feeds one step's `EngineResult` into the next step as its `EngineInput`
   * — the raster intermediate stays a plain in-memory reference, never
   * transferred or cloned (ADR-0007: both steps run in this same worker). A
   * `"stream"` result mid-pipeline has no `EngineInput` counterpart; only a
   * final step may produce one.
   */
  function resultToInput(result: EngineResult, engine: EngineId): EngineInput {
    switch (result.kind) {
      case "raster":
        return { kind: "raster", image: result.image };
      case "bytes":
        return { kind: "bytes", bytes: result.bytes };
      case "opfs":
        return { kind: "opfs", path: result.path };
      case "stream":
        throw new EngineError(
          "internal",
          "a stream result cannot feed the next pipeline step",
          { engine },
        );
    }
  }

  async function run(
    req: RunRequest,
    onProgress?: (fraction: number) => void,
  ): Promise<RunOutcome> {
    const { jobId, input, steps, options } = req;

    if (steps.length === 0) {
      return {
        ok: false,
        error: serializeEngineError(
          new EngineError("internal", "pipeline has no steps"),
        ),
      };
    }

    const controller = new AbortController();
    controllers.set(jobId, controller);

    try {
      const n = steps.length;
      let lastReportedAt = 0;
      let lastReported: number | null = null;
      const reportOverall = (overall: number) => {
        const clamped = clamp01(overall);
        const now = Date.now();
        if (now - lastReportedAt < PROGRESS_INTERVAL_MS) return;
        lastReportedAt = now;
        lastReported = clamped;
        onProgress?.(clamped);
      };

      let currentInput: EngineInput = input;
      let result: EngineResult | undefined;

      for (let i = 0; i < n; i++) {
        const step: RunStep | undefined = steps[i];
        if (!step) break; // unreachable: guarded by `i < n === steps.length`

        let entry: CacheEntry;
        try {
          entry = await loadEngine(step.engine, step.baseUrl);
        } catch (e) {
          return {
            ok: false,
            error: serializeEngineError(toEngineError(e, step.engine)),
          };
        }

        if (
          !entry.adapter.supports(step.op, step.inputFormat, step.outputFormat)
        ) {
          return {
            ok: false,
            error: serializeEngineError(
              new EngineError(
                "unsupported",
                `engine "${step.engine}" does not support step ${i} ` +
                  `(${step.op} ${step.inputFormat} -> ${step.outputFormat})`,
                { engine: step.engine },
              ),
            ),
          };
        }

        try {
          result = await entry.instance.run({
            op: step.op,
            input: currentInput,
            inputFormat: step.inputFormat,
            outputFormat: step.outputFormat,
            options,
            signal: controller.signal,
            onProgress: onProgress
              ? (fraction: number) => reportOverall((i + clamp01(fraction)) / n)
              : undefined,
          });
        } catch (e) {
          return {
            ok: false,
            error: serializeEngineError(toEngineError(e, step.engine)),
          };
        }

        if (i < n - 1) {
          currentInput = resultToInput(result, step.engine);
        }
      }

      // Unreachable: `steps.length === 0` returns above, and every iteration
      // of a non-empty loop either assigns `result` or returns early.
      if (!result) {
        return {
          ok: false,
          error: serializeEngineError(
            new EngineError("internal", "pipeline produced no result"),
          ),
        };
      }

      if (result.kind === "raster") {
        return {
          ok: false,
          error: serializeEngineError(
            new EngineError(
              "internal",
              "pipeline ended without an encode step",
            ),
          ),
        };
      }

      // The throttle above can swallow the true last update; the caller is
      // always owed a final 1 on success regardless of what it ate.
      if (onProgress && lastReported !== 1) onProgress(1);
      return { ok: true, result };
    } finally {
      controllers.delete(jobId);
    }
  }

  function cancel(jobId: string): void {
    controllers.get(jobId)?.abort();
  }

  function dispose(engine: EngineId): void {
    const entry = cache.get(engine);
    if (!entry) return;
    entry.instance.dispose();
    cache.delete(engine);
  }

  return { probe: probeApi, run, cancel, dispose };
}

/**
 * Transferables for a `RunOutcome`'s result, for the Comlink wiring (Phase
 * 0.5) to pass as `postMessage`'s transfer list — moving the bytes/stream
 * instead of structured-cloning a copy of them. An `ok: false` outcome, or
 * an OPFS result (just a path string), has nothing to transfer.
 */
export function transferablesOf(outcome: RunOutcome): Transferable[] {
  if (!outcome.ok) return [];
  if (outcome.result.kind === "bytes") return [outcome.result.bytes];
  if (outcome.result.kind === "stream") return [outcome.result.stream];
  return [];
}
