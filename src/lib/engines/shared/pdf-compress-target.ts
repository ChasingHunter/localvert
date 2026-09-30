/**
 * Target-size/reduce-by-percent control flow for `compress-pdf` (ADR-0017,
 * "PDF"). Pure and environment-neutral — the actual per-step image
 * re-encode is expensive (mozjpeg + a full `doc.save()`), so this is unit-
 * tested with a fake `encode` that returns canned sizes, the same way
 * `shared/target-size.ts` tests the image codecs' bisection without a real
 * wasm encoder.
 */

export interface PdfLadderStep {
  dpi: number;
  quality: number;
}

/** ADR-0017's exact ladder: "(150,.8)(150,.65)(120,.6)(96,.5)(72,.45)(72,.35)". */
export const PDF_COMPRESS_LADDER: readonly PdfLadderStep[] = [
  { dpi: 150, quality: 0.8 },
  { dpi: 150, quality: 0.65 },
  { dpi: 120, quality: 0.6 },
  { dpi: 96, quality: 0.5 },
  { dpi: 72, quality: 0.45 },
  { dpi: 72, quality: 0.35 },
];

export interface PdfLadderResult {
  step: PdfLadderStep;
  totalBytes: number;
  /** True once `totalBytes <= targetBytes` — the ladder stops at the first
   * step that reaches this. */
  hit: boolean;
}

/**
 * Runs `encode(step)` down `ladder` in order, stopping at the first step
 * whose resulting total byte size is `<= targetBytes` (ADR-0017: "stop at
 * the first result that fits"). If none fits, returns the *smallest* result
 * seen (not necessarily the last step — a later, lower-DPI/quality step is
 * usually smaller, but this doesn't assume monotonicity, since a real
 * mozjpeg re-encode's size isn't perfectly predictable step to step).
 */
export async function runCompressLadder(
  ladder: readonly PdfLadderStep[],
  targetBytes: number,
  encode: (step: PdfLadderStep) => Promise<number>,
): Promise<PdfLadderResult> {
  let smallest: PdfLadderResult | undefined;
  for (const step of ladder) {
    const totalBytes = await encode(step);
    if (totalBytes <= targetBytes) {
      return { step, totalBytes, hit: true };
    }
    if (!smallest || totalBytes < smallest.totalBytes) {
      smallest = { step, totalBytes, hit: false };
    }
  }
  // Unreachable in practice (`ladder` is never empty) — satisfies the
  // return type without a non-null assertion.
  return (
    smallest ?? {
      step: ladder[0] as PdfLadderStep,
      totalBytes: Number.POSITIVE_INFINITY,
      hit: false,
    }
  );
}

/** "19.4 MB" / "3.1 MB" / "20 MB" — one decimal, trailing ".0" dropped so a
 * round number (a typed-in target, or a size that happens to land exactly)
 * reads as "20 MB" rather than "20.0 MB", matching every example in
 * ADR-0017's own "Result contract". Same rule as the audio side's
 * `formatMB` (mediabunny/audio-target.ts), duplicated here rather than
 * imported: that file lives in the `mediabunny` engine's own lazily-loaded
 * chunk, and importing across engine boundaries would pull mediabunny code
 * into the pdf-lib chunk for a three-line formatter. */
/** An achieved size: MB like `formatMB`, but anything under 1 MB in KB, so a
 * small result reads "307 KB" rather than "0.3 MB". Targets keep
 * `formatMB`, since that's the unit the user typed them in. */
export function formatAchieved(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return formatMB(bytes);
}

export function formatMB(bytes: number): string {
  const rounded = Math.round((bytes / (1024 * 1024)) * 10) / 10;
  const text = Number.isInteger(rounded)
    ? rounded.toFixed(0)
    : rounded.toFixed(1);
  return `${text} MB`;
}

/**
 * ADR-0017's PDF "Result contract": non-image bytes alone over target
 * ("The text and fonts alone are 3.1 MB, so 2 MB isn't possible."), a hit
 * ("19.4 MB, 97% of your 20 MB target."), already under target at the
 * ladder's own lightest step ("Already under 1 MB at the lightest
 * compression (0.3 MB)." — real-world validation, 2026-09-30: a photo-heavy
 * PDF whose *first* ladder rung (150 dpi, quality 0.8, the mildest this mode
 * tries) already undershoots the target reported a misleading "29% of your
 * target" instead, the same class of bug as the image codecs' `atCeiling`:
 * there's no lighter step to try, so the percent implies room to improve
 * that doesn't exist), or unreachable even after the whole ladder ("The
 * smallest we could make it is 23 MB.").
 */
export function pdfTargetNote(args: {
  targetBytes: number;
  nonImageBytes: number;
  result?: PdfLadderResult;
  ladder?: readonly PdfLadderStep[];
}): string {
  const { targetBytes, nonImageBytes, result, ladder } = args;
  if (nonImageBytes > targetBytes) {
    return `The text and fonts alone are ${formatAchieved(nonImageBytes)}, so ${formatMB(targetBytes)} isn't possible.`;
  }
  if (!result?.hit) {
    const smallest = result?.totalBytes ?? nonImageBytes;
    return `The smallest we could make it is about ${formatAchieved(smallest)}.`;
  }
  const atLightestStep =
    ladder !== undefined && ladder.length > 0 && result.step === ladder[0];
  if (atLightestStep) {
    return `Already under ${formatMB(targetBytes)} at the lightest compression (${formatAchieved(result.totalBytes)}).`;
  }
  const percentOfTarget = Math.round((result.totalBytes / targetBytes) * 100);
  return `${formatAchieved(result.totalBytes)}, ${percentOfTarget}% of your ${formatMB(targetBytes)} target.`;
}
