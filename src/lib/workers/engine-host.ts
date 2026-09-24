import type { EngineAdapter, EngineInstance } from "@/lib/engines";
import { EngineError, toEngineError } from "@/lib/engines";
import type { Capabilities, EngineId } from "@/lib/registry";
import type { EngineHostApi, RunOutcome, RunRequest } from "./protocol";
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

  async function run(
    req: RunRequest,
    onProgress?: (fraction: number) => void,
  ): Promise<RunOutcome> {
    const {
      jobId,
      engine,
      baseUrl,
      op,
      input,
      inputFormat,
      outputFormat,
      options,
    } = req;

    const controller = new AbortController();
    controllers.set(jobId, controller);

    try {
      let entry: CacheEntry;
      try {
        entry = await loadEngine(engine, baseUrl);
      } catch (e) {
        return {
          ok: false,
          error: serializeEngineError(toEngineError(e, engine)),
        };
      }

      if (!entry.adapter.supports(op, inputFormat, outputFormat)) {
        return {
          ok: false,
          error: serializeEngineError(
            new EngineError(
              "unsupported",
              `engine "${engine}" does not support ${op} ${inputFormat} -> ${outputFormat}`,
              { engine },
            ),
          ),
        };
      }

      let lastReportedAt = 0;
      let lastReported: number | null = null;
      const throttledProgress = onProgress
        ? (fraction: number) => {
            const clamped = Math.min(1, Math.max(0, fraction));
            const now = Date.now();
            if (now - lastReportedAt < PROGRESS_INTERVAL_MS) return;
            lastReportedAt = now;
            lastReported = clamped;
            onProgress(clamped);
          }
        : undefined;

      try {
        const result = await entry.instance.run({
          op,
          input,
          inputFormat,
          outputFormat,
          options,
          signal: controller.signal,
          onProgress: throttledProgress,
        });
        // The throttle above can swallow the true last update; the caller
        // is always owed a final 1 on success regardless of what it ate.
        if (onProgress && lastReported !== 1) onProgress(1);
        return { ok: true, result };
      } catch (e) {
        return {
          ok: false,
          error: serializeEngineError(toEngineError(e, engine)),
        };
      }
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
