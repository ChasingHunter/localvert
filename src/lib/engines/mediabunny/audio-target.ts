/**
 * Pure bitrate math for `compress-audio`'s target-size and reduce-by-percent
 * modes (docs/adr/0017-smart-compression.md, "Audio"). Kept separate from
 * `audio.ts` (like `shared/target-size.ts` for the image codecs) so the
 * arithmetic — and its snapping/floor/downmix rules — is unit-tested
 * directly in Node, with no worker, no wasm, and no real audio file
 * required. Audio-only: never imported by `video.ts`/`bitrate.ts`.
 */

export type AudioTargetCodec = "mp3" | "aac" | "opus";

/** ADR-0017: below the stereo floor, downmix to mono; below the mono floor,
 * the target is unreachable at any bitrate this codec can encode. */
const FLOORS_BPS: Record<AudioTargetCodec, { stereo: number; mono: number }> = {
  opus: { stereo: 48_000, mono: 24_000 },
  aac: { stereo: 64_000, mono: 32_000 },
  mp3: { stereo: 64_000, mono: 32_000 },
};

/**
 * MPEG-1 Layer III only ever encodes at these 14 standard bitrates — LAME's
 * CBR mode (which `@mediabunny/mp3-encoder` drives) snaps to the nearest one
 * regardless of what's asked for, so this is a genuine encoder constraint,
 * not a stylistic ladder. AAC and Opus (via WebCodecs `AudioEncoder`) take
 * an arbitrary integer bits-per-second instead — see `ladderFor` below.
 */
const MP3_BITRATES_BPS = [
  32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320,
].map((kbps) => kbps * 1000);

/**
 * AAC/Opus have no fixed bitrate table (any positive integer bps is valid),
 * but encoding at e.g. 96_437 bps instead of 96_000 buys nothing audible —
 * this rounds to the nearest whole kbps, which is both a "sensible" number
 * to show the user and a stable step to retry one rate down from.
 */
function roundDownToKbps(bps: number): number {
  return Math.max(1000, Math.floor(bps / 1000) * 1000);
}

/** The largest bitrate `<= bps` this codec can actually encode at,
 * respecting `codec`'s own constraint (a fixed table for mp3, the nearest
 * kbps for aac/opus). Never returns less than the smallest step on that
 * scale (1 kbps for aac/opus, 32 kbps for mp3) — callers compare the
 * *requested* `bps` against a floor themselves before calling this. */
function snapDown(codec: AudioTargetCodec, bps: number): number {
  if (codec !== "mp3") return roundDownToKbps(bps);
  let best = MP3_BITRATES_BPS[0] as number;
  for (const rate of MP3_BITRATES_BPS) {
    if (rate <= bps) best = rate;
    else break;
  }
  return best;
}

/** One step down from `bps` on `codec`'s own scale — used for "measure the
 * real output; if it's over target, step down one rate and retry once." A
 * `null` return means `bps` is already the lowest step available. */
export function stepDown(codec: AudioTargetCodec, bps: number): number | null {
  if (codec !== "mp3") {
    const stepped = roundDownToKbps(bps) - 1000;
    return stepped >= 1000 ? stepped : null;
  }
  const idx = MP3_BITRATES_BPS.indexOf(snapDown(codec, bps));
  return idx > 0 ? (MP3_BITRATES_BPS[idx - 1] as number) : null;
}

export interface TargetBitrateResult {
  bitrateBps: number;
  /** `undefined` when the source's own channel count should be kept
   * (`numberOfChannelsOf`'s "keep" contract) — set to `1` only when this
   * calculation itself decided to downmix. */
  channels: 1 | undefined;
  /** False only when even a mono encode at this codec's mono floor would
   * still overshoot `targetBytes` — the target can't be reached at all. */
  reachable: boolean;
}

/**
 * ADR-0017: `bitrate = (0.97*T - 8 KB) * 8 / duration`, snapped down to a
 * rate `codec` accepts. `sourceChannels` (1 or 2 — anything else is treated
 * as stereo, the common case) decides whether the stereo floor even applies:
 * a source that's already mono only ever needs to clear the mono floor.
 */
export function bitrateForTargetSize(args: {
  codec: AudioTargetCodec;
  targetBytes: number;
  durationSec: number;
  sourceChannels: number;
}): TargetBitrateResult {
  const { codec, targetBytes, durationSec, sourceChannels } = args;
  const floors = FLOORS_BPS[codec];
  const sourceIsMono = sourceChannels === 1;

  if (durationSec <= 0 || targetBytes <= 0) {
    return { bitrateBps: floors.mono, channels: 1, reachable: false };
  }

  const overheadBytes = 8 * 1024;
  const rawBps = ((0.97 * targetBytes - overheadBytes) * 8) / durationSec;

  if (!sourceIsMono && rawBps >= floors.stereo) {
    return {
      bitrateBps: snapDown(codec, rawBps),
      channels: undefined,
      reachable: true,
    };
  }
  if (rawBps >= floors.mono) {
    return {
      bitrateBps: snapDown(codec, rawBps),
      channels: sourceIsMono ? undefined : 1,
      reachable: true,
    };
  }
  return { bitrateBps: floors.mono, channels: 1, reachable: false };
}

/** Reduce-by-% (ADR-0017): "maps to target = source * (1 - p), then behaves
 * exactly like target size." `percent` is 10..90, already validated by the
 * tool's own zod schema. */
export function targetBytesForPercent(
  sourceBytes: number,
  percent: number,
): number {
  return sourceBytes * (1 - percent / 100);
}

/**
 * "Best quality" (the tool's default, ADR-0017): a sensible bitrate below
 * the source's own, never above it. `sourceBitrateBps` is the source file's
 * whole-file average (`fileSize * 8 / duration`) — a ballpark, not a codec
 * probe, but enough to pick a step meaningfully lower than what's already
 * there. Falls back to `fallbackBps` when the source bitrate can't be
 * computed (zero duration) or is already at/under the smallest sensible
 * step, so "best quality" never encodes *up*.
 */
const BEST_QUALITY_LADDER_BPS: Record<AudioTargetCodec, number[]> = {
  mp3: MP3_BITRATES_BPS,
  aac: [32, 48, 64, 96, 128, 160, 192, 224, 256, 320].map((k) => k * 1000),
  opus: [24, 32, 48, 64, 96, 128, 160, 192, 224, 256].map((k) => k * 1000),
};

export function bestQualityBitrate(
  codec: AudioTargetCodec,
  sourceBitrateBps: number | undefined,
  fallbackBps = 96_000,
): number {
  if (sourceBitrateBps === undefined || sourceBitrateBps <= 0) {
    return fallbackBps;
  }
  const ladder = BEST_QUALITY_LADDER_BPS[codec];
  let chosen: number | undefined;
  for (const rate of ladder) {
    if (rate < sourceBitrateBps) chosen = rate;
    else break;
  }
  return chosen ?? fallbackBps;
}

/** "19.4 MB" / "3.1 MB" / "20 MB" — one decimal, trailing ".0" dropped so a
 * round number reads as "20 MB" rather than "20.0 MB", matching every
 * example in ADR-0017's own "Result contract". Same rule (deliberately
 * duplicated, not imported — see that file's own doc comment on why) as
 * `shared/pdf-compress-target.ts`'s `formatMB` for `compress-pdf`. */
export function formatMB(bytes: number): string {
  const rounded = Math.round((bytes / (1024 * 1024)) * 10) / 10;
  const text = Number.isInteger(rounded)
    ? rounded.toFixed(0)
    : rounded.toFixed(1);
  return `${text} MB`;
}

/**
 * ADR-0017's "Result contract" for the target-size/percent modes: a hit
 * ("19.4 MB, 97% of your 20 MB target."), a hit with a compromise
 * ("Downmixed to mono to fit 20 MB." — this tool's only compromise, since
 * there's no resolution/frame-rate knob to fall back on the way video has),
 * or unreachable ("The smallest we could make it is 23 MB."). `reachable`
 * here means "the actual encode landed at or under the target" — the
 * caller passes the *measured* outcome, not `bitrateForTargetSize`'s own
 * (pre-encode) estimate, since a real encode can still land a little over a
 * theoretically-reachable target (container overhead, VBR variance).
 */
export function resultNote(args: {
  targetBytes: number;
  actualBytes: number;
  reachable: boolean;
  downmixedToMono: boolean;
}): string {
  const { targetBytes, actualBytes, reachable, downmixedToMono } = args;
  if (!reachable) {
    return `The smallest we could make it is about ${formatMB(actualBytes)}.`;
  }
  if (downmixedToMono) {
    return `Downmixed to mono to fit ${formatMB(targetBytes)}.`;
  }
  const percentOfTarget = Math.round((actualBytes / targetBytes) * 100);
  return `${formatMB(actualBytes)}, ${percentOfTarget}% of your ${formatMB(targetBytes)} target.`;
}
