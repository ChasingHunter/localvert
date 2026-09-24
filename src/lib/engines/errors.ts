import type { EngineId } from "@/lib/registry";

export type EngineErrorCode =
  | "unsupported"
  | "aborted"
  | "load-failed"
  | "decode-failed"
  | "encode-failed"
  | "out-of-memory"
  | "internal";

export class EngineError extends Error {
  readonly code: EngineErrorCode;
  readonly engine?: EngineId;

  constructor(
    code: EngineErrorCode,
    message: string,
    options?: { engine?: EngineId; cause?: unknown },
  ) {
    super(
      message,
      options?.cause !== undefined ? { cause: options.cause } : undefined,
    );
    this.name = "EngineError";
    this.code = code;
    this.engine = options?.engine;
  }
}

/**
 * A worker boundary crossing (postMessage, or an RPC layer like Comlink) can
 * hand back something that is no longer `instanceof EngineError` even though
 * it started as one — the browser's structured clone algorithm does not
 * preserve a custom Error subclass's prototype (or even its own properties;
 * see errors.test.ts for what Node's `structuredClone` actually does to one).
 * Anything that wants `code` to survive the trip has to serialize it as a
 * plain `{name: "EngineError", code, ...}` payload on purpose. This accepts
 * both the real class and that plain shape, so callers can check engine
 * errors uniformly regardless of which side of a worker they run on.
 */
export function isEngineError(e: unknown): e is EngineError {
  if (e instanceof EngineError) {
    return true;
  }
  return (
    typeof e === "object" &&
    e !== null &&
    "name" in e &&
    (e as { name: unknown }).name === "EngineError" &&
    "code" in e &&
    typeof (e as { code: unknown }).code === "string"
  );
}

/** Normalizes an unknown thrown value into an `EngineError`. */
export function toEngineError(e: unknown, engine?: EngineId): EngineError {
  if (e instanceof EngineError) {
    return e;
  }
  if (e instanceof DOMException && e.name === "AbortError") {
    return new EngineError("aborted", e.message, { engine, cause: e });
  }
  if (e instanceof RangeError && /memory|allocation/i.test(e.message)) {
    return new EngineError("out-of-memory", e.message, { engine, cause: e });
  }
  const message = e instanceof Error ? e.message : String(e);
  return new EngineError("internal", message, { engine, cause: e });
}
