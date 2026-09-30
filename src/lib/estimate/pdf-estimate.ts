/**
 * Pre-run size estimate for `compress-pdf`'s target-size/percent modes —
 * ADR-0017's "Estimates" addendum (2026-09-30). Unlike video/audio, PDF's
 * real target-size run (`runCompressToTarget` in `pdf-lib/adapter.ts`) walks
 * a ladder of real mozjpeg re-encodes (`PDF_COMPRESS_LADDER`) — there's no
 * closed-form "final size" the way a bitrate * duration gives one, since how
 * much a given image actually shrinks at a given dpi/quality depends on its
 * own content. This file only ever asserts what the planner math genuinely
 * knows for free from `probePdf`'s cheap image-bytes split: whether the
 * non-image bytes alone already blow the budget (exact, reused from
 * `runCompressToTarget`'s own first check), and — approximately — whether
 * the ladder's *strongest* rung has a realistic shot at the rest. The
 * retention fractions below are a documented rule of thumb, not measured
 * per-file; calibrated loosely against the ladder's own (dpi, quality) pairs
 * in docs/adr/0017-smart-compression.md, and never claimed as exact — the
 * wording says "likely", never "will".
 */
import { formatAchieved, formatMB } from "./format";

export interface PdfEstimateProbe {
  imageBytes: number;
  nonImageBytes: number;
}

/** Roughly what `PDF_COMPRESS_LADDER`'s strongest rung (72 dpi, quality
 * 0.35) tends to keep of a photo's original JPEG re-encode size — DPI down
 * from a typical scan/photo's effective 150-300 to 72 is itself close to a
 * 4-9x pixel-count cut, and quality 0.35 is aggressive on top of that. Used
 * only to say "likely still too big" before a real encode — never shown as
 * the estimate itself. */
const STRONGEST_RETENTION = 0.12;

export function estimatePdfTargetSize(params: {
  targetBytes: number;
  probe: PdfEstimateProbe;
}): string {
  const { targetBytes, probe } = params;

  if (probe.nonImageBytes > targetBytes) {
    return `Too small. The text and fonts alone are ${formatAchieved(probe.nonImageBytes)}, so ${formatMB(targetBytes)} isn't possible.`;
  }

  const smallestLikely =
    probe.nonImageBytes + probe.imageBytes * STRONGEST_RETENTION;
  if (smallestLikely > targetBytes) {
    return `${formatMB(targetBytes)} may not be reachable — the smallest we can likely make it is about ${formatAchieved(smallestLikely)}.`;
  }

  return `About ${formatMB(targetBytes)} looks reachable.`;
}
