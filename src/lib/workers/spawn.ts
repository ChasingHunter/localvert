import * as Comlink from "comlink";
import { EngineError } from "@/lib/engines";
import type { WorkerHandle } from "./pool";
import type { EngineHostApi, Promisified, RunRequest } from "./protocol";

/**
 * MAIN THREAD. The real `new Worker(...)` + `Comlink.wrap` factories that
 * `pool.ts`'s `PoolOptions.spawn` and `job-engine.ts`'s zip step are built
 * against — see the note atop `workers/index.ts`. Deliberately does not
 * import `engine-host.ts` or `engines/loaders.ts`: those run *inside* the
 * worker (`engine.worker.ts`), reached only through the `new Worker(new
 * URL(...))` call below. Importing either here would make the whole adapter
 * graph reachable from main-thread code — exactly what invariant 3 (no
 * engine in the core bundle) forbids.
 */

/**
 * Mirrors the shape `zip.worker.ts` exposes via `Comlink.expose`. Duplicated
 * here rather than imported from that file: a `*.worker.ts` file
 * typechecks under `tsconfig.worker.json`'s `WebWorker` lib (see ADR-0005),
 * and importing even just its type into this main-thread module would pull
 * it into the root `DOM`-lib program too.
 */
interface ZipWorkerApi {
  zip(entries: { name: string; blob: Blob }[]): ReadableStream<Uint8Array>;
}

/**
 * A promise that never resolves and rejects exactly once, the moment `label`
 * (a spawned worker) fails to load or hands back an unclonable message —
 * `worker.onerror`/`onmessageerror`, which nothing else listens for on a bare
 * `new Worker(...)`. Racing an RPC call against this is what turns "the
 * worker's script failed to load" from a silent, permanent hang (nothing
 * ever answers the Comlink call awaiting it) into a rejection. One instance
 * is shared per worker so a failure after the worker's first call still
 * rejects every call already in flight, and — since the promise stays
 * rejected — every call made afterwards too.
 */
function workerFailure(worker: Worker, label: string): Promise<never> {
  const failure = new Promise<never>((_, reject) => {
    worker.addEventListener("error", (e) => {
      reject(
        new EngineError("internal", `${label} failed to load: ${e.message || "worker error"}`),
      );
    });
    worker.addEventListener("messageerror", () => {
      reject(
        new EngineError("internal", `${label}: message could not be deserialized`),
      );
    });
  });
  // Nothing awaits `failure` itself until (if ever) it's raced against a
  // real call below — swallow so an error firing while the worker is
  // otherwise idle doesn't surface as an unhandled rejection.
  failure.catch(() => {});
  return failure;
}

/**
 * Spawns the real engine worker and adapts it to `WorkerHandle`. `new
 * Worker(new URL(...))` must stay exactly this literal shape inline in this
 * call — bundlers (Turbopack/Vite) only recognise that exact pattern, not
 * one built up from a variable or helper.
 */
export function spawnEngineWorker(): WorkerHandle {
  const worker = new Worker(new URL("./engine.worker.ts", import.meta.url), {
    type: "module",
    name: "localvert-engine",
  });
  const remote = Comlink.wrap<EngineHostApi>(worker);
  const failure = workerFailure(worker, "engine worker");

  const api: Promisified<EngineHostApi> = {
    probe: () => Promise.race([remote.probe(), failure]),
    run: (req: RunRequest, onProgress?: (fraction: number) => void) =>
      Promise.race([
        remote.run(req, onProgress ? Comlink.proxy(onProgress) : undefined),
        failure,
      ]),
    cancel: (jobId: string) => Promise.race([remote.cancel(jobId), failure]),
    dispose: (engine) => Promise.race([remote.dispose(engine), failure]),
  };

  return {
    api,
    terminate() {
      remote[Comlink.releaseProxy]();
      worker.terminate();
    },
  };
}

export interface ZipResult {
  stream: ReadableStream<Uint8Array>;
  /** Terminates the zip worker immediately. Also called automatically once
   * `stream` closes or errors on its own. Safe to call more than once. */
  dispose(): void;
}

/**
 * Zips `entries` in a fresh, one-shot worker: spawning a worker per call
 * keeps this stateless and lets independent batches zip concurrently,
 * unlike the shared/pinned engine workers `pool.ts` manages. The worker is
 * terminated once the returned stream closes or errors, or immediately if
 * the caller calls `dispose()` first.
 */
export function zipInWorker(
  entries: { name: string; blob: Blob }[],
): Promise<ZipResult> {
  const worker = new Worker(new URL("./zip.worker.ts", import.meta.url), {
    type: "module",
    name: "localvert-zip",
  });
  const remote = Comlink.wrap<ZipWorkerApi>(worker);
  const failure = workerFailure(worker, "zip worker");

  let disposed = false;
  function dispose(): void {
    if (disposed) return;
    disposed = true;
    remote[Comlink.releaseProxy]();
    worker.terminate();
  }

  return Promise.race([remote.zip(entries), failure]).then(
    (workerStream) => {
      // A passthrough rather than handing `workerStream` straight to the
      // caller: this is how completion/error is observed (to know when to
      // terminate the worker) without consuming the bytes the caller still
      // needs to read. `pipeTo` propagates a source error into `writable`
      // (and so into `readable`) by default.
      const { readable, writable } = new TransformStream<
        Uint8Array,
        Uint8Array
      >();
      // Raced against `failure` too: a worker that dies *after* handing
      // back its stream (rather than never loading at all) would otherwise
      // leave `pipeTo` pending forever with nothing to ever settle it —
      // aborting `writable` is what turns that into a visible stream error
      // instead of a second flavour of the same hang.
      // `pipeTo` holds the lock on `writable`, so `writable.abort()` would
      // just reject; aborting the pipe through its signal is what actually
      // errors `readable` for the caller.
      const pipeAbort = new AbortController();
      failure.catch((e: unknown) => pipeAbort.abort(e));
      workerStream
        .pipeTo(writable, { signal: pipeAbort.signal })
        .then(dispose, dispose);
      return { stream: readable, dispose };
    },
    (e) => {
      dispose();
      throw e;
    },
  );
}
