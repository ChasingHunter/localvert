/**
 * ADR-0017's result-note contract for target-size/percent modes, shared by
 * every compress adapter so the wording is identical everywhere:
 *
 * - Hit: "19.4 MB, 97% of your 20 MB target."
 * - Hit with a compromise (the image was downscaled to get there):
 *   "Resized to 1600 × 1200 to fit 50 KB."
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
}

export function formatTargetSizeNote(opts: TargetSizeNoteOptions): string {
  const { achievedBytes, targetBytes, hitTarget, resizedTo } = opts;

  if (resizedTo) {
    return `Resized to ${resizedTo.width} × ${resizedTo.height} to fit ${formatBytes(targetBytes)}.`;
  }

  if (hitTarget) {
    const percent = Math.round((achievedBytes / targetBytes) * 100);
    return `${formatBytes(achievedBytes)}, ${percent}% of your ${formatBytes(targetBytes)} target.`;
  }

  return `The smallest we could make it is ${formatBytes(achievedBytes)}.`;
}
