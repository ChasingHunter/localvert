/**
 * Pure planner math for ADR-0017's video compression modes — everything
 * `bitrate.ts` doesn't already cover: the "best quality" bits-per-pixel
 * ceiling, target-size/percent budget splitting, the measure-and-retry
 * rescale, the resolution/fps step-down ladder, and the result-note
 * wording. Environment-neutral (no DOM, no wasm, no mediabunny import) so
 * every rule here is unit-tested directly in Node — `adapter.ts` is the
 * only place that wires these numbers into an actual `Conversion`.
 */

/** The two codec families ADR-0017 gives distinct bpp numbers for. Any
 * other output codec (vp8, a future av1) is treated as the VP9 family —
 * closer to VP9's efficiency than H.264's, and no tool in this slice writes
 * anything else yet. */
export type CodecFamily = "avc" | "vp9";

/** Bits-per-pixel ceiling for "best quality" mode's bitrate cap, and the
 * floor below which the resolution/fps ladder (see `stepDownForBpp`) starts
 * stepping down — both from ADR-0017's "Video" section. */
const BPP_CEILING: Record<CodecFamily, number> = { avc: 0.15, vp9: 0.09 };
const BPP_FLOOR: Record<CodecFamily, number> = { avc: 0.07, vp9: 0.045 };

export function bppCeiling(codec: CodecFamily): number {
  return BPP_CEILING[codec];
}

export function bppFloor(codec: CodecFamily): number {
  return BPP_FLOOR[codec];
}

/**
 * "Best quality" mode's target video bitrate: `min(0.7 × source, a bpp
 * ceiling at the output's own resolution/fps)`. Both operands already cap
 * the result at or below 0.7 × source, so this is the entire "never
 * re-encode above what the source itself used" rule for this mode — no
 * separate quantizer path (mediabunny's quantizer mode has no bitrate cap
 * at all, which is the root cause ADR-0017 fixes, so this slice never uses
 * it — see the ADR's "never pass a bare Quality level" rule and this
 * repo's compress-video commit history for why bitrate mode is the only
 * mode used anywhere in this file).
 *
 * `sourceBps` undefined (the source's own bitrate couldn't be determined at
 * all) falls back to the bpp ceiling alone — same shape as `bitrate.ts`'s
 * `chooseVideoBitrateBps`. Always a positive integer (rounded, floored at
 * 1) — mediabunny's `Quality` constructor rejects a fractional bitrate
 * outright ("options.bitrate, when provided, must be a positive integer"),
 * and a source's own container-reported bitrate is frequently fractional
 * (`InputTrack.getAverageBitrate()`), so this can't just pass floats
 * through the way `bitrate.ts`'s original preset-ceiling table (all integer
 * literals) never had to worry about.
 */
export function bestQualityVideoBitrateBps(params: {
  sourceBps: number | undefined;
  width: number;
  height: number;
  fps: number;
  codec: CodecFamily;
}): number {
  const { sourceBps, width, height, fps, codec } = params;
  const ceilingBps = bppCeiling(codec) * width * height * fps;
  const raw =
    sourceBps === undefined
      ? ceilingBps
      : Math.min(sourceBps * 0.7, ceilingBps);
  return Math.max(1, Math.round(raw));
}

/** `T = source × (1 − p)` — "reduce by %" mode is target-size mode with a
 * computed target, per ADR-0017. `percent` is 0-100 (10-90 is the option
 * field's own clamp; this function doesn't re-clamp so it can be unit
 * tested against the raw formula too). */
export function targetBytesFromPercent(
  sourceBytes: number,
  percent: number,
): number {
  return sourceBytes * (1 - percent / 100);
}

/** Total-budget audio bitrate tiers, keyed by the overall target bitrate in
 * kbps (`targetBytes*8/duration/1000`) — ADR-0017 / the research doc's
 * section F. Never exceeds the source's own audio bitrate. */
export function audioReserveBps(params: {
  targetBytes: number;
  durationSeconds: number;
  sourceAudioBps: number | undefined;
}): number {
  const { targetBytes, durationSeconds, sourceAudioBps } = params;
  const totalKbps = (targetBytes * 8) / durationSeconds / 1000;
  const tier =
    totalKbps > 2000
      ? 128_000
      : totalKbps > 800
        ? 96_000
        : totalKbps > 300
          ? 64_000
          : 48_000;
  // Rounded — see `bestQualityVideoBitrateBps`'s doc comment: mediabunny's
  // `Quality` constructor rejects a fractional bitrate, and `sourceAudioBps`
  // (a container-reported average bitrate) is frequently fractional.
  return sourceAudioBps === undefined
    ? tier
    : Math.max(1, Math.round(Math.min(tier, sourceAudioBps)));
}

/** `2% of T + 32 KB` — container/muxing overhead reserved out of the target
 * before splitting the rest between audio and video. */
export function containerOverheadBytes(targetBytes: number): number {
  return 0.02 * targetBytes + 32 * 1024;
}

export interface TargetSizeBudget {
  audioBps: number;
  overheadBytes: number;
  /** `undefined` when the budget is already exhausted by audio + overhead
   * alone (the target is unreachable before video even gets a share) — see
   * `stepDownForBpp`'s `unreachable` case for what a caller does then. */
  videoBps: number | undefined;
}

/**
 * Splits a byte budget `T` into audio/overhead/video shares — ADR-0017's
 * "Target size T" steps 1-2: reserve audio and container overhead first,
 * then `video_bps = (0.95·T − audio − overhead) × 8 / duration`.
 */
export function planTargetSizeBudget(params: {
  targetBytes: number;
  durationSeconds: number;
  sourceAudioBps: number | undefined;
}): TargetSizeBudget {
  const { targetBytes, durationSeconds, sourceAudioBps } = params;
  const audioBps = audioReserveBps({
    targetBytes,
    durationSeconds,
    sourceAudioBps,
  });
  const overheadBytes = containerOverheadBytes(targetBytes);
  const audioBytes = (audioBps * durationSeconds) / 8;
  const videoBudgetBytes = 0.95 * targetBytes - audioBytes - overheadBytes;
  return {
    audioBps,
    overheadBytes,
    videoBps:
      videoBudgetBytes > 0
        ? (videoBudgetBytes * 8) / durationSeconds
        : undefined,
  };
}

export interface RetryDecision {
  /** True when the current pass's result should be accepted as final. */
  done: boolean;
  /** The bitrate to re-encode at — set only when `done` is false. */
  nextBitrateBps?: number;
}

/**
 * ADR-0017's measure-and-retry step: rescale by `0.97·T / actual` when over
 * target, capped at 2 retries (1 for clips over 10 minutes); one optional
 * upward retry toward `0.97·T` when the result undershoots by more than 15%
 * on a clip of 3 minutes or less. `passesUsed` counts passes already spent
 * (1 after the first encode) — the caller stops calling this once `done` is
 * true or `passesUsed` reaches its own budget.
 */
export function nextTargetSizeRetry(params: {
  actualBytes: number;
  targetBytes: number;
  currentBitrateBps: number;
  durationSeconds: number;
  passesUsed: number;
}): RetryDecision {
  const {
    actualBytes,
    targetBytes,
    currentBitrateBps,
    durationSeconds,
    passesUsed,
  } = params;
  const maxRetries = durationSeconds > 600 ? 1 : 2;

  if (actualBytes > targetBytes) {
    if (passesUsed > maxRetries) return { done: true };
    return {
      done: false,
      nextBitrateBps: currentBitrateBps * ((0.97 * targetBytes) / actualBytes),
    };
  }

  if (
    actualBytes < 0.85 * targetBytes &&
    durationSeconds <= 180 &&
    passesUsed <= maxRetries
  ) {
    return {
      done: false,
      nextBitrateBps: currentBitrateBps * ((0.97 * targetBytes) / actualBytes),
    };
  }

  return { done: true };
}

/** The step-down ladder `stepDownForBpp` walks, source resolution first
 * (represented as `undefined` — "use the source's own height, unscaled"),
 * then each fixed rung from ADR-0017's "Resolution by bits per pixel". */
const RESOLUTION_LADDER: readonly (number | undefined)[] = [
  undefined,
  1080,
  720,
  540,
  480,
  360,
];
const FPS_LADDER: readonly number[] = [30, 24];

/** Even-dimension width for `height`, preserving `sourceWidth/sourceHeight`'s
 * aspect ratio — WebCodecs/most encoders require even dimensions for 4:2:0
 * chroma subsampling. */
function evenWidthFor(
  height: number,
  sourceWidth: number,
  sourceHeight: number,
): number {
  const raw = Math.round((height * sourceWidth) / sourceHeight);
  return raw % 2 === 0 ? raw : raw + 1;
}

export interface ResolutionStep {
  width: number;
  height: number;
  fps: number;
  /** The bits-per-pixel this rung's bitrate actually achieves — always
   * `>=` the codec's floor unless `unreachable` is true. */
  bpp: number;
}

export type StepDownResult =
  | ({ unreachable: false } & ResolutionStep)
  | {
      unreachable: true;
      /** The smallest rung tried (360p, capped fps) — still returned so a
       * caller can encode it anyway per ADR-0017's "unreachable" contract
       * (a real, labelled result beats no output at all). */
      smallest: ResolutionStep;
    };

/**
 * ADR-0017's resolution/fps ladder: given a video bitrate budget that's too
 * low for the bpp floor at the source's own resolution/fps, step down
 * source → 1080 → 720 → 540 → 480 → 360 (never *above* `maxHeight`, the
 * tool's own "Max resolution" option), then cap fps 30 → 24 at 360p. Below
 * half the floor even there, the target is unreachable — the caller still
 * gets the smallest rung's numbers back (`smallest`) to encode anyway and
 * report honestly, per the ADR's result contract.
 */
export function stepDownForBpp(params: {
  videoBps: number;
  sourceWidth: number;
  sourceHeight: number;
  sourceFps: number;
  codec: CodecFamily;
  /** The tool's own "Max resolution" cap, if set — a rung taller than this
   * is skipped even if the source itself is taller. */
  maxHeight?: number;
}): StepDownResult {
  const { videoBps, sourceWidth, sourceHeight, sourceFps, codec, maxHeight } =
    params;
  const floor = bppFloor(codec);

  const cappedSourceHeight =
    maxHeight !== undefined ? Math.min(sourceHeight, maxHeight) : sourceHeight;

  const rungs = RESOLUTION_LADDER.filter(
    (h) => h === undefined || h <= cappedSourceHeight,
  );

  let lastTried: ResolutionStep = {
    width: evenWidthFor(cappedSourceHeight, sourceWidth, sourceHeight),
    height:
      cappedSourceHeight % 2 === 0
        ? cappedSourceHeight
        : cappedSourceHeight + 1,
    fps: sourceFps,
    bpp: 0,
  };

  for (const rung of rungs) {
    const height = rung ?? cappedSourceHeight;
    const evenHeight = height % 2 === 0 ? height : height + 1;
    const width = evenWidthFor(evenHeight, sourceWidth, sourceHeight);
    for (const fps of rung === undefined || rung > 360
      ? [sourceFps]
      : FPS_LADDER) {
      const bpp = videoBps / (width * evenHeight * fps);
      lastTried = { width, height: evenHeight, fps, bpp };
      if (bpp >= floor) return { unreachable: false, ...lastTried };
    }
  }

  if (lastTried.bpp >= floor / 2) {
    return { unreachable: false, ...lastTried };
  }
  return { unreachable: true, smallest: lastTried };
}

/**
 * The "unreachable" pre-run/post-run estimate: the smallest sensible file
 * size for `durationSeconds` of video at the codec's own bpp floor, 360p,
 * 24fps (plus the audio/overhead reserve already computed for the target).
 * Used for both the pre-run "About N MB" note (when a target is already
 * known to be out of reach) and the post-run "smallest we could make it"
 * note.
 */
export function smallestSensibleBytes(params: {
  durationSeconds: number;
  sourceWidth: number;
  sourceHeight: number;
  codec: CodecFamily;
  audioBps: number;
  overheadBytes: number;
}): number {
  const {
    durationSeconds,
    sourceWidth,
    sourceHeight,
    codec,
    audioBps,
    overheadBytes,
  } = params;
  const height = 360;
  const width = evenWidthFor(height, sourceWidth, sourceHeight);
  const fps = 24;
  const videoBps = bppFloor(codec) * width * height * fps;
  const videoBytes = (videoBps * durationSeconds) / 8;
  const audioBytes = (audioBps * durationSeconds) / 8;
  return videoBytes + audioBytes + overheadBytes;
}

function formatMB(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, "");
}

/** Bytes -> "1 MB" / "30 KB" — only `alreadyUnderTargetNote` below needs the
 * KB fallback (every other note in this file is always MB-sized, per
 * ADR-0017's own examples), kept as a tiny local helper rather than a shared
 * import — this engine ships as its own lazily-loaded worker chunk, same
 * reasoning as `audio-target.ts`'s duplicated `formatMB`. */
function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${formatMB(bytes)} MB`;
}

/**
 * ADR-0017 addendum (2026-09-30, `no_encodable_target_codec` investigation):
 * a target-size the source file already meets or beats has nothing to
 * squeeze — encoding anyway can ask for an arbitrarily high video bitrate
 * (no ceiling exists in this file's target-size budget math, only a floor
 * via `stepDownForBpp`), which is exactly what made a 30 KB, 2-second clip
 * with a 1 MB target throw `no_encodable_target_codec`: the budget math
 * computed a ~3.7 Mbps bitrate for a 320x240/15fps source, a config no
 * browser encoder accepts. `"reduce-percent"` mode can never reach this
 * (`targetBytesFromPercent`'s target is always strictly smaller than the
 * source), but a typed-in `"target-size"` MB value can be anything — this
 * is the caller's guard, checked before any budget math runs at all.
 */
export function alreadyUnderTargetNote(params: {
  sourceBytes: number;
  targetBytes: number;
}): string {
  const { sourceBytes, targetBytes } = params;
  return `Already under your ${formatMB(targetBytes)} MB target (${formatSize(sourceBytes)}). You got the original file back.`;
}

export type TargetSizeOutcome =
  | { kind: "hit"; actualBytes: number; targetBytes: number }
  | {
      kind: "resized";
      actualBytes: number;
      targetBytes: number;
      resizedToHeight: number;
    }
  | { kind: "unreachable"; actualBytes: number };

/** ADR-0017's result-contract wording — the exact three shapes from the
 * "Result notes" deliverable, applied to whichever outcome the target-size/
 * percent run actually landed on. */
export function targetSizeResultNote(outcome: TargetSizeOutcome): string {
  switch (outcome.kind) {
    case "hit": {
      const pct = Math.round((outcome.actualBytes / outcome.targetBytes) * 100);
      return `${formatMB(outcome.actualBytes)} MB, ${pct}% of your ${formatMB(outcome.targetBytes)} MB target.`;
    }
    case "resized":
      return `Resized to ${outcome.resizedToHeight}p to fit your ${formatMB(outcome.targetBytes)} MB target (${formatMB(outcome.actualBytes)} MB).`;
    case "unreachable":
      return `The smallest we could make it is ${formatMB(outcome.actualBytes)} MB.`;
  }
}

export interface EncodePass<T> {
  bitrateBps: number;
  sizeBytes: number;
  result: T;
}

export interface RunWithSizeRetriesResult<T> {
  final: EncodePass<T>;
  /** How many encode passes actually ran (1 = no retry needed). */
  passes: number;
}

/**
 * Drives ADR-0017's measure-and-retry loop against an injected `encode`
 * (real mediabunny run in `adapter.ts`, a fake in tests — see
 * `nextTargetSizeRetry`'s doc comment for the retry rule itself). Every
 * superseded pass's result is handed to `cleanup` (deletes its OPFS temp
 * file in the real adapter) before the next pass runs, so only one
 * encoded output ever exists on disk at a time. `signal` is checked between
 * passes, not mid-encode (opaque to this function, same convention as
 * `encodeToTargetSize` in `shared/target-size.ts`).
 */
export async function runWithSizeRetries<T>(params: {
  targetBytes: number;
  durationSeconds: number;
  initialBitrateBps: number;
  encode: (bitrateBps: number) => Promise<{ sizeBytes: number; result: T }>;
  cleanup?: (pass: EncodePass<T>) => void | Promise<void>;
  signal?: AbortSignal;
}): Promise<RunWithSizeRetriesResult<T>> {
  const {
    targetBytes,
    durationSeconds,
    initialBitrateBps,
    encode,
    cleanup,
    signal,
  } = params;

  let bitrateBps = initialBitrateBps;
  let passesUsed = 0;

  for (;;) {
    signal?.throwIfAborted();
    const { sizeBytes, result } = await encode(bitrateBps);
    passesUsed++;
    const pass: EncodePass<T> = { bitrateBps, sizeBytes, result };

    const decision = nextTargetSizeRetry({
      actualBytes: sizeBytes,
      targetBytes,
      currentBitrateBps: bitrateBps,
      durationSeconds,
      passesUsed,
    });

    if (decision.done || decision.nextBitrateBps === undefined) {
      return { final: pass, passes: passesUsed };
    }

    // Superseded by the next pass — clean it up (deletes its OPFS temp file
    // in the real adapter) before re-encoding.
    await cleanup?.(pass);
    bitrateBps = decision.nextBitrateBps;
  }
}
