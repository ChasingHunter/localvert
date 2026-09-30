/**
 * ADR-0013: every compress tool must never hand back a file bigger than what
 * it started from. Environment-neutral (no DOM, no wasm) so it's unit-tested
 * directly in Node, same as `target-size.ts`.
 */

export interface NeverLargerResult {
  bytes: ArrayBuffer;
  /** Set only when `original` won — surfaced on the job card via
   * `EngineResult`'s `note` field (see `job-engine.ts`'s `applyResult`). */
  note?: string;
}

const DEFAULT_MESSAGE =
  "Already about as small as it gets. You got the original file back.";

/**
 * Returns `candidate` unless `original` is the same size or smaller, in
 * which case `original` wins and `note` explains why. Byte-length only — the
 * two buffers are never compared byte-for-byte, since a compress tool's
 * whole point is producing *different* bytes at a smaller size, not the same
 * bytes.
 */
export function neverLarger(
  original: ArrayBuffer,
  candidate: ArrayBuffer,
  message: string = DEFAULT_MESSAGE,
): NeverLargerResult {
  if (candidate.byteLength < original.byteLength) {
    return { bytes: candidate };
  }
  return { bytes: original, note: message };
}
