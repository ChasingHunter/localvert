// MAIN-THREAD BARREL: the wire protocol plus the pool. `engine-host.ts` is
// deliberately not re-exported here — it runs inside the worker and the main
// thread must never import it directly, only talk to it through the RPC
// layer `WorkerHandle.api` stands in for (see pool.ts).
//
// NOTE: there is no `*.worker.ts` entry file in this slice. The real
// `new Worker(...)` + `Comlink.wrap` factory that implements `spawn` in
// production lands with the first tool (Phase 0.5); until then `PoolOptions.
// spawn` is supplied by callers (tests today, the real factory later).

export type { PoolOptions, RunOptions, WorkerHandle, WorkerPool } from "./pool";
export { createWorkerPool } from "./pool";
export type {
  EngineHostApi,
  Promisified,
  RunOutcome,
  RunRequest,
  SerializedEngineError,
} from "./protocol";
export { deserializeEngineError, serializeEngineError } from "./protocol";
