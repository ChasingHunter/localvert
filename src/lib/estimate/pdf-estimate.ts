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

/** What `PDF_COMPRESS_LADDER`'s strongest rung (72 dpi, quality 0.35) tends
 * to keep of a photo's image bytes. Deliberately on the pessimistic side
 * (2026-09-30 audit, B8): a scan at 300 dpi keeps closer to 10%, but a PDF
 * whose images are already at 72 dpi (nothing to downsample) kept 45%
 * (`e2e/fixtures/photos.pdf`: 1.25 MB of image, 557 KB at the bottom of the
 * ladder), and an estimate that promises a size the run then misses is worse
 * than one that is a bit gloomy. */
const STRONGEST_RETENTION = 0.45;

/** "Looks reachable" is only said when the likely floor sits at least this
 * far under the target. Between the margin and the target we say it might
 * land a little over instead of promising. */
const REACHABLE_MARGIN = 0.8;

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
    return `${formatMB(targetBytes)} may not be reachable. The smallest we can likely make it is about ${formatAchieved(smallestLikely)}.`;
  }
  if (smallestLikely > targetBytes * REACHABLE_MARGIN) {
    return `Might land a little over ${formatMB(targetBytes)}. We'll get as close as we can.`;
  }

  return `About ${formatMB(targetBytes)} looks reachable.`;
}
