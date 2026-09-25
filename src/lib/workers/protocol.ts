import type { EngineErrorCode, EngineInput, EngineResult } from "@/lib/engines";
import { EngineError } from "@/lib/engines";
import type {
  Capabilities,
  EngineId,
  Operation,
  StepFormat,
} from "@/lib/registry";

/**
 * Environment-neutral types shared by both sides of the worker boundary:
 * `engine-host.ts` (worker-side, implements `EngineHostApi`) and `pool.ts`
 * (main-thread, calls it through an RPC layer). Neither this file, nor
 * anything it imports, may reference DOM or WebWorker-only globals — see
 * ADR-0005.
 */

/**
 * One resolved pipeline step, as dispatched to a worker — the engine to run
 * it on, where that engine's assets live, and the op/format shape the
 * engine-host uses both to route (`EngineAdapter.supports`) and to build
 * that step's `EngineTask`. See ADR-0007: `inputFormat`/`outputFormat` are
 * `StepFormat` (a real `FormatId`, or `"raster"` for the in-worker
 * decoded-pixels intermediate a multi-step image pipeline passes between
 * steps).
 */
export interface RunStep {
  engine: EngineId;
  baseUrl: string;
  op: Operation;
  inputFormat: StepFormat;
  outputFormat: StepFormat;
}

/**
 * One conversion job, as dispatched to a worker: the whole resolved
 * pipeline, run in step order inside that one worker (ADR-0007) so a raster
 * intermediate between steps never crosses a thread boundary. `input` feeds
 * the first step only — each later step's input is the previous step's
 * `EngineResult`, converted in-place by `engine-host.ts`. `options` is the
 * tool's whole parsed options object, handed to every step unchanged; a step
 * reads only the keys it cares about.
 */
export interface RunRequest {
  jobId: string;
  input: EngineInput;
  /** ADR-0008: passthrough to the first step's `EngineTask.inputs` — every
   * input in the user's own order, for a many-to-one job. `undefined` for
   * every other job, same as `EngineTask.inputs` itself. */
  inputs?: readonly EngineInput[];
  steps: readonly RunStep[];
  options: Readonly<Record<string, unknown>>;
}

/**
 * A worker-boundary crossing (postMessage, or an RPC layer like Comlink)
 * structured-clones an `Error`, and structured clone keeps only
 * `message`/`stack`/`cause` — a subclass's own fields, `EngineError.code`
 * chief among them, are lost (see errors.test.ts, and Comlink's default
 * throw handler drops them the same way). So an `EngineError` crosses the
 * boundary as this plain data shape instead of being thrown, and is
 * reconstructed on the other side with `deserializeEngineError`.
 */
export interface SerializedEngineError {
  name: "EngineError";
  code: EngineErrorCode;
  message: string;
  engine?: EngineId;
}

export type RunOutcome =
  | { ok: true; result: EngineResult }
  | { ok: false; error: SerializedEngineError };

/** Implemented by `engine-host.ts`, run inside the worker. */
export interface EngineHostApi {
  probe(): Capabilities;
  run(
    req: RunRequest,
    onProgress?: (fraction: number) => void,
  ): Promise<RunOutcome>;
  cancel(jobId: string): void;
  /** Disposes the cached engine instance, if any — see `dispose` in
   * `engine-host.ts` for what "cached" means. */
  dispose(engine: EngineId): void;
}

/**
 * `T` with every method made async — the shape Comlink's `Remote<T>` gives a
 * caller on the other side of a `postMessage` boundary, reproduced here as a
 * plain mapped type so `pool.ts` can depend on it without importing Comlink
 * itself (the real `Worker` + `Comlink.wrap` factory lands with the first
 * tool, Phase 0.5 — see the note in `index.ts`). A method that already
 * returns a `Promise` is not wrapped a second time.
 */
export type Promisified<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? (...args: A) => Promise<Awaited<R>>
    : never;
};

export function serializeEngineError(e: EngineError): SerializedEngineError {
  return {
    name: "EngineError",
    code: e.code,
    message: e.message,
    ...(e.engine !== undefined ? { engine: e.engine } : {}),
  };
}

export function deserializeEngineError(s: SerializedEngineError): EngineError {
  return new EngineError(s.code, s.message, { engine: s.engine });
}
