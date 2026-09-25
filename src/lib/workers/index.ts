// MAIN-THREAD BARREL: the wire protocol, the pool, and the real worker
// factories. `engine-host.ts` is deliberately not re-exported here — it runs
// inside the worker and the main thread must never import it directly, only
// talk to it through the RPC layer `WorkerHandle.api` stands in for (see
// pool.ts and spawn.ts). `engine.worker.ts` / `zip.worker.ts` themselves are
// never imported directly either — only reached through `spawn.ts`'s
// `new Worker(new URL(...))` calls.

export type { PoolOptions, RunOptions, WorkerHandle, WorkerPool } from "./pool";
export { createWorkerPool } from "./pool";
export type {
  EngineHostApi,
  Promisified,
  RunOutcome,
  RunRequest,
  RunStep,
  SerializedEngineError,
} from "./protocol";
export { deserializeEngineError, serializeEngineError } from "./protocol";
export type { ZipResult } from "./spawn";
export { spawnEngineWorker, zipInWorker } from "./spawn";
