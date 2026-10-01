import type { EngineId } from "@/lib/registry";

export type EngineErrorCode =
  | "unsupported"
  | "aborted"
  | "load-failed"
  | "load-timeout"
  | "offline"
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

/** What the user sees when they ask for audio from a video that has none. */
export const NO_AUDIO_MESSAGE = "This video has no sound to extract.";

/**
 * True when ffmpeg's log says an audio-only run had nothing to write: with
 * `-vn` and no audio stream, nothing is mapped to the output, which ffmpeg
 * reports as "Output file #0 does not contain any stream" (older builds drop
 * the "#0") or "Stream map ... matches no streams".
 */
export function isNoStreamsLog(lines: readonly string[]): boolean {
  return lines.some((l) =>
    /does not contain any stream|matches no streams/i.test(l),
  );
}
