import type {
  EngineAdapter,
  EngineInput,
  EngineInstance,
  EngineResult,
} from "@/lib/engines";
import { EngineError, toEngineError } from "@/lib/engines";
import { ENGINE_MANIFEST } from "@/lib/engines/manifest";
import type { Capabilities, EngineId } from "@/lib/registry";
import {
  classifyLoadFailure,
  isNetworkFailure,
  isOffline,
} from "./engine-load-error";
import { withIdleTimeout } from "./idle-timeout";
import type {
  EngineHostApi,
  RunOutcome,
  RunRequest,
  RunStep,
} from "./protocol";
import { serializeEngineError } from "./protocol";

/** No engine/asset fetch — however it's stuck (offline, a stalled connection,
 * a service worker that never settles) — spins forever; see the "offline +
 * never-cached engine" bug this exists to fix. 60s comfortably covers a slow
 * real download (the consent-gated download path is separate and unbounded
 * on purpose) while still failing well within what a user will wait on a
 * "Loading…" spinner before assuming the app is broken. */
const LOAD_IDLE_TIMEOUT_MS = 60_000;

/** Idle window for a running step while online — see its use in `run`. */
const RUN_IDLE_TIMEOUT_MS = 10 * 60_000;

/** Slowest connection we still wait for before calling a load stuck. */
const SLOW_LINK_BYTES_PER_SECOND = 50_000;

/**
 * The load timeout scales with the engine's download size: a fixed 60 s
 * would wrongly kill a legitimate multi-megabyte engine (libreoffice ~74 MB)
 * on a slow connection, since nothing resets the timer mid-download.
 */
export function loadTimeoutMs(engine: EngineId): number {
  const bytes = ENGINE_MANIFEST[engine]?.totalBytes ?? 0;
  return Math.max(
    LOAD_IDLE_TIMEOUT_MS,
    Math.ceil(bytes / SLOW_LINK_BYTES_PER_SECOND) * 1000,
  );
}

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
        throw classifyLoadFailure({
          engine,
          cause,
          offline: isOffline(),
          timedOut: false,
        });
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
   * `"stream"` or `"files"` result mid-pipeline has no `EngineInput`
   * counterpart; only a final step may produce one (a one-to-many tool
   * like word-to-jpg ends on it), and a step that produces one anywhere else
   * must fail loudly here rather than silently drop the extra output files.
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
      case "files":
        throw new EngineError(
          "internal",
          "a files result cannot feed the next pipeline step",
          { engine },
        );
    }
  }

  async function run(
    req: RunRequest,
    onProgress?: (fraction: number) => void,
  ): Promise<RunOutcome> {
    const { jobId, input, inputs, steps, options } = req;

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

      // Fan-in: a `merge` step after other steps means "do those steps to
      // every input first, then merge the results" (heic-to-pdf: decode and
      // encode each HEIC, then merge the JPGs). Everything before the merge
      // is the per-file prefix; a merge at index 0 (or no merge) leaves
      // `inputs` for step 0 to read directly, as before.
      const mergeAt = steps.findIndex((s) => s.op === "merge");
      const fanIn = inputs && inputs.length > 0 && mergeAt > 0;
      const prefixLength = fanIn ? mergeAt : 0;
      const units = fanIn ? inputs.length * prefixLength + (n - mergeAt) : n;
      let unitsDone = 0;

      const execStep = async (
        step: RunStep,
        i: number,
        stepInput: EngineInput,
        stepInputs: readonly EngineInput[] | undefined,
      ): Promise<{ result: EngineResult } | { failure: RunOutcome }> => {
        let entry: CacheEntry;
        try {
          // `loadEngine` reports no progress of its own, so `poke()` is called
          // once up front and never again; the whole load must finish inside
          // `loadTimeoutMs` (scaled to the engine's download size) or it is
          // treated as stuck (the offline/never-cached-engine hang this
          // guards against: a fetch that neither resolves nor rejects).
          entry = await withIdleTimeout(
            (poke) => {
              poke();
              return loadEngine(step.engine, step.baseUrl);
            },
            {
              ms: loadTimeoutMs(step.engine),
              onTimeout: () =>
                classifyLoadFailure({
                  engine: step.engine,
                  offline: isOffline(),
                  timedOut: true,
                }),
            },
          );
        } catch (e) {
          return {
            failure: {
              ok: false,
              error: serializeEngineError(toEngineError(e, step.engine)),
            },
          };
        }

        if (
          !entry.adapter.supports(step.op, step.inputFormat, step.outputFormat)
        ) {
          return {
            failure: {
              ok: false,
              error: serializeEngineError(
                new EngineError(
                  "unsupported",
                  `engine "${step.engine}" does not support step ${i} ` +
                    `(${step.op} ${step.inputFormat} -> ${step.outputFormat})`,
                  { engine: step.engine },
                ),
              ),
            },
          };
        }

        try {
          // Some adapters (e.g. jsquash-*) fetch their wasm lazily on first
          // `run()` rather than in `load()` above — the same stuck-fetch
          // hang can happen here too, so this gets the same idle-timeout
          // treatment. Unlike the load timeout, `poke()` fires on every
          // `onProgress` tick: a step that keeps reporting real progress
          // (a long but healthy transcode) never times out, only one that
          // goes silent for the full window does.
          const result = await withIdleTimeout(
            (poke) =>
              entry.instance.run({
                op: step.op,
                input: stepInput,
                inputs: stepInputs,
                inputFormat: step.inputFormat,
                outputFormat: step.outputFormat,
                options,
                signal: controller.signal,
                onProgress: (fraction: number) => {
                  poke();
                  if (onProgress) {
                    reportOverall((unitsDone + clamp01(fraction)) / units);
                  }
                },
              }),
            {
              // Offline, a silent step is almost certainly a lazy wasm fetch
              // that will never arrive. Online, a long silent step can be a
              // healthy conversion that reports no progress (large PDF,
              // ffmpeg) — give it a much wider window before calling it stuck.
              ms: isOffline() ? LOAD_IDLE_TIMEOUT_MS : RUN_IDLE_TIMEOUT_MS,
              onTimeout: () =>
                classifyLoadFailure({
                  engine: step.engine,
                  offline: isOffline(),
                  timedOut: true,
                }),
            },
          );
          unitsDone++;
          return { result };
        } catch (e) {
          // Some adapters fetch their wasm lazily on first `run()` (see the
          // `withIdleTimeout` call above) rather than in `load()`, so a
          // never-cached engine going offline mid-run rejects here with a
          // plain "Failed to fetch" `TypeError` instead of surfacing through
          // `loadEngine`'s own classification. Map that (and the offline
          // signal itself, in case it fires as something else entirely)
          // through the same friendly message rather than passing the raw
          // network error to the job store.
          if (isOffline() || isNetworkFailure(e)) {
            return {
              failure: {
                ok: false,
                error: serializeEngineError(
                  classifyLoadFailure({
                    engine: step.engine,
                    cause: e,
                    offline: true,
                    timedOut: false,
                  }),
                ),
              },
            };
          }
          return {
            failure: {
              ok: false,
              error: serializeEngineError(toEngineError(e, step.engine)),
            },
          };
        }
      };

      let currentInput: EngineInput = input;
      let currentInputs = inputs;
      let result: EngineResult | undefined;

      if (fanIn) {
        const merged: EngineInput[] = [];
        for (const original of inputs) {
          let fileInput = original;
          for (let i = 0; i < prefixLength; i++) {
            const step = steps[i];
            if (!step) break; // unreachable: i < mergeAt <= steps.length
            const out = await execStep(step, i, fileInput, undefined);
            if ("failure" in out) return out.failure;
            fileInput = resultToInput(out.result, step.engine);
          }
          merged.push(fileInput);
        }
        currentInput = merged[0] ?? input;
        currentInputs = merged;
      }

      for (let i = prefixLength; i < n; i++) {
        const step: RunStep | undefined = steps[i];
        if (!step) break; // unreachable: guarded by `i < n === steps.length`

        // Only the first step that runs here can be many-to-one: either
        // step 0, or the merge after a fan-in prefix. Every later step's
        // input is the previous step's own single `EngineResult`, converted
        // by `resultToInput` above.
        const out = await execStep(
          step,
          i,
          currentInput,
          i === prefixLength ? currentInputs : undefined,
        );
        if ("failure" in out) return out.failure;
        result = out.result;

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
  if (outcome.result.kind === "files") {
    return outcome.result.files.map((f) => f.bytes);
  }
  return [];
}
