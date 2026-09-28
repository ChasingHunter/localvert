import type { EngineId } from "@/lib/registry";
import { EngineError } from "../errors";

/**
 * A `fetch()` that returned a non-OK status. Thrown as-is out of
 * `fetchAsset` (never retried, never wrapped in the stalled-download
 * `EngineError` below) so a caller can build its own "asset not found"
 * message the way every adapter's own `fetchBytes` wrapper already did
 * before this module existed — see `libreoffice/adapter.ts` and
 * `typst/adapter.ts`.
 */
export class FetchAssetHttpError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`fetch failed with status ${status}`);
    this.name = "FetchAssetHttpError";
    this.status = status;
  }
}

export interface FetchAssetOptions {
  /** Attached to the `EngineError` thrown when every attempt stalls out. */
  engine: EngineId;
  /** The caller's own abort signal. Aborting it stops the current attempt
   * immediately and skips any remaining retries. */
  signal?: AbortSignal;
  /** How long a single attempt may go without a new chunk arriving before
   * it's abandoned as stalled. Reset on every chunk (and once up front, at
   * the start of the attempt, and again once headers arrive). */
  stallMs?: number;
  /** How many additional attempts to make after the first, each one a
   * fresh `fetch()` from scratch — a failed `fetch()` isn't cached the way
   * a failed dynamic `import()` can be, so retrying genuinely helps. */
  retries?: number;
  /** Called with cumulative bytes read after every chunk. `total` is
   * `Content-Length` when the response declares one, else `undefined`. */
  onProgress?: (loaded: number, total: number | undefined) => void;
}

const DEFAULT_STALL_MS = 30_000;
const DEFAULT_RETRIES = 1;

/**
 * Fetches `url` reading its body chunk by chunk, so a connection that stops
 * delivering bytes partway through a large download (a flaky network, a
 * dev/e2e server dropping connections under load) is detected instead of
 * hanging silently until whatever much coarser timeout sits above this call
 * (see `src/lib/workers/engine-host.ts`'s run idle timeout).
 *
 * A stall aborts just that attempt and, unless it was the last one allowed,
 * retries with a brand new `fetch()`. A non-OK response (404, 403, ...)
 * throws immediately as a `FetchAssetHttpError` — that's not a transient
 * condition a retry can fix. The caller's own `signal` aborting also skips
 * straight to throwing, with no retry.
 *
 * Every attempt exhausted on stalls throws `EngineError("load-failed", ...)`
 * with a message meant for a person, not a status code.
 */
export async function fetchAsset(
  url: string,
  options: FetchAssetOptions,
): Promise<Uint8Array> {
  const {
    engine,
    signal,
    stallMs = DEFAULT_STALL_MS,
    retries = DEFAULT_RETRIES,
    onProgress,
  } = options;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    signal?.throwIfAborted();
    try {
      return await fetchOnce(url, { signal, stallMs, onProgress });
    } catch (e) {
      if (e instanceof FetchAssetHttpError) throw e;
      if (signal?.aborted) throw e;
      lastError = e;
    }
  }
  throw new EngineError(
    "load-failed",
    "The download stalled. Check your connection and try again.",
    { engine, cause: lastError },
  );
}

interface FetchOnceOptions {
  signal?: AbortSignal;
  stallMs: number;
  onProgress?: (loaded: number, total: number | undefined) => void;
}

/** One attempt: a fresh `fetch()`, its own stall timer, and its own
 * `AbortController` so a stall aborts only this attempt's request — never
 * the caller's own signal. */
async function fetchOnce(
  url: string,
  { signal, stallMs, onProgress }: FetchOnceOptions,
): Promise<Uint8Array> {
  const controller = new AbortController();
  const onCallerAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", onCallerAbort, { once: true });

  let stallTimer: ReturnType<typeof setTimeout> | undefined;
  const armStall = () => {
    if (stallTimer !== undefined) clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      controller.abort(new DOMException("download stalled", "AbortError"));
    }, stallMs);
  };
  const disarmStall = () => {
    if (stallTimer !== undefined) clearTimeout(stallTimer);
    stallTimer = undefined;
  };

  try {
    armStall();
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      disarmStall();
      throw new FetchAssetHttpError(res.status);
    }

    const totalHeader = res.headers.get("content-length");
    const total = totalHeader ? Number(totalHeader) : undefined;

    if (!res.body) {
      // No streaming body available (some test/polyfill environments) —
      // fall back to reading it whole. Still subject to the abort signal
      // above, just without per-chunk stall detection.
      const buf = await res.arrayBuffer();
      disarmStall();
      const bytes = new Uint8Array(buf);
      onProgress?.(bytes.byteLength, total ?? bytes.byteLength);
      return bytes;
    }

    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    for (;;) {
      armStall();
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        loaded += value.byteLength;
        onProgress?.(loaded, total);
      }
    }
    disarmStall();
    return concat(chunks, loaded);
  } finally {
    disarmStall();
    signal?.removeEventListener("abort", onCallerAbort);
  }
}

function concat(chunks: readonly Uint8Array[], length: number): Uint8Array {
  const out = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
