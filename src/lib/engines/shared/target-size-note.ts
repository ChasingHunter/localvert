/**
 * ADR-0017's result-note contract for target-size/percent modes, shared by
 * every compress adapter so the wording is identical everywhere:
 *
 * - Hit: "19.4 MB, 97% of your 20 MB target."
 * - Hit with a compromise (the image was downscaled to get there):
 *   "Resized to 1600 × 1200 to fit 50 KB."
 * - Already under target at the best quality this mode will try: "Already
 *   under 500 KB at full quality (326 KB)." — found during real-world
 *   validation (2026-09-30): a source already so efficient that even the
 *   ceiling of the quality search fits under target reported a misleading
 *   "65% of your target" instead, because "hit" alone can't tell "landed in
 *   the band" apart from "the best quality available undershoots it".
 * - Unreachable: "The smallest we could make it is 23 MB."
 *
 * Pure string formatting (no DOM, no wasm) — unit-tested directly in Node.
 */
import { formatBytes } from "./format-bytes";

export interface TargetSizeNoteOptions {
  achievedBytes: number;
  targetBytes: number;
  hitTarget: boolean;
  /** Set when a downscale round ran to reach the target — takes priority
   * over the plain hit/miss wording, per ADR-0017's "compromise" case. */
  resizedTo?: { width: number; height: number };
  /** Set when `achievedBytes` came from the highest quality this search was
   * allowed to try, and that quality alone already undershoots the target —
   * see this file's doc comment. Takes priority over the plain "X% of your
   * target" wording, since that percent would misrepresent a result nothing
   * closer to the band could have improved on. */
  atBestQuality?: boolean;
}

export function formatTargetSizeNote(opts: TargetSizeNoteOptions): string {
  const { achievedBytes, targetBytes, hitTarget, resizedTo, atBestQuality } =
    opts;

  if (resizedTo) {
    return `Resized to ${resizedTo.width} × ${resizedTo.height} to fit ${formatBytes(targetBytes)}.`;
  }

  if (hitTarget && atBestQuality) {
    return `Already under ${formatBytes(targetBytes)} at full quality (${formatBytes(achievedBytes)}).`;
  }

  if (hitTarget) {
    const percent = Math.round((achievedBytes / targetBytes) * 100);
    return `${formatBytes(achievedBytes)}, ${percent}% of your ${formatBytes(targetBytes)} target.`;
  }

  return `The smallest we could make it is ${formatBytes(achievedBytes)}.`;
}
