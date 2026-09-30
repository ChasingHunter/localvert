/**
 * Source-aware video/audio bitrate selection for the mediabunny video tools
 * (ADR-0013's addendum, 2026-09-30). Fixes "compress-video made a file
 * bigger": mediabunny's `Quality` presets (`QUALITY_LOW`/`MEDIUM`/`HIGH`)
 * resolve to either a fixed quantizer or a bitrate computed purely from the
 * *output* resolution (`computeVideoBitrate` in mediabunny's own
 * `encode.ts`, private) — neither has any idea how efficiently the source
 * was already encoded, so re-encoding an already-compressed source at a
 * "medium" preset can easily target a higher rate than the source ever
 * used. The functions here compute an explicit numeric bitrate — capped at
 * a fraction of the *source's* own bitrate — and that number is passed as
 * `ConversionVideoOptions.bitrate`/`ConversionAudioOptions.bitrate`
 * directly, bypassing `Quality` (and its quantizer path) entirely for every
 * mediabunny video tool. Environment-neutral (no DOM, no wasm) so it's
 * unit-tested directly in Node, same as `never-larger.ts`.
 */
import type { QualityPreset } from "./video";

type ResolutionBucket = "1080p" | "720p" | "480p";

/**
 * Each preset's own bitrate ceiling, keyed by output resolution — what a
 * preset targets with *no* source information at all (the file's own
 * bitrate couldn't be read at all, see `estimateSourceVideoBps`). Same
 * order of magnitude as typical web-delivery guidance (e.g. YouTube's own
 * upload recommendations for 1080p/720p SDR land in this range) — only
 * ever a ceiling once a source bitrate is known; see `chooseVideoBitrateBps`.
 */
const PRESET_VIDEO_BITRATE_BPS: Record<
  QualityPreset,
  Record<ResolutionBucket, number>
> = {
  high: { "1080p": 8_000_000, "720p": 5_000_000, "480p": 2_500_000 },
  medium: { "1080p": 4_000_000, "720p": 2_500_000, "480p": 1_200_000 },
  low: { "1080p": 2_000_000, "720p": 1_200_000, "480p": 700_000 },
};

/** Same idea for audio, independent of resolution. */
const PRESET_AUDIO_BITRATE_BPS: Record<QualityPreset, number> = {
  high: 160_000,
  medium: 128_000,
  low: 96_000,
};

/**
 * How much smaller than the source a preset is allowed to target, as a
 * fraction of the source's own video bitrate — this is what actually stops
 * "compress-video made a file bigger": whatever the preset's own
 * resolution-based ceiling says, the real target never exceeds
 * `sourceBps * factor`.
 *
 * - `high` (0.85): the "barely touch it" tier — still a real ~15% cut over
 *   the source, since a straight remux with no size reduction at all is
 *   what a plain container-conversion tool is for, not compress-video.
 * - `medium` (0.65): the default — a third smaller than the source, the
 *   kind of cut someone reaching for "compress" without picking a mode
 *   actually expects.
 * - `low` (0.45): more than half, for someone who explicitly asked for the
 *   smallest reasonable file.
 */
const SOURCE_FACTOR: Record<QualityPreset, number> = {
  high: 0.85,
  medium: 0.65,
  low: 0.45,
};

function bucketFor(height: number): ResolutionBucket {
  if (height >= 1080) return "1080p";
  if (height >= 720) return "720p";
  return "480p";
}

/** The preset's own bitrate ceiling for `height`, with no source
 * information at all — see this file's top doc comment. */
export function presetVideoBitrateBps(
  preset: QualityPreset,
  height: number,
): number {
  return PRESET_VIDEO_BITRATE_BPS[preset][bucketFor(height)];
}

export function presetAudioBitrateBps(preset: QualityPreset): number {
  return PRESET_AUDIO_BITRATE_BPS[preset];
}

/**
 * The actual target video bitrate for one run: `min(preset's own ceiling
 * for height, source bitrate × the preset's factor)`. `sourceBps` is
 * `undefined` when the source's bitrate couldn't be determined at all (see
 * `estimateSourceVideoBps`) — in that case the preset's ceiling is used
 * unchanged, same as before this fix.
 */
export function chooseVideoBitrateBps(
  preset: QualityPreset,
  height: number,
  sourceBps: number | undefined,
): number {
  const ceiling = presetVideoBitrateBps(preset, height);
  if (sourceBps === undefined) return ceiling;
  return Math.min(ceiling, Math.round(sourceBps * SOURCE_FACTOR[preset]));
}

/** Same idea for audio: never re-encode above the source's own audio
 * bitrate. No shrink factor here — audio is a small fraction of a video's
 * total size, so there's no size-budget reason to also ratchet it down;
 * the only goal is to never make it bigger than it already is. */
export function chooseAudioBitrateBps(
  preset: QualityPreset,
  sourceBps: number | undefined,
): number {
  const ceiling = presetAudioBitrateBps(preset);
  if (sourceBps === undefined) return ceiling;
  return Math.min(ceiling, sourceBps);
}

/**
 * Estimates a source's video bitrate from container-level facts alone —
 * total file size, duration, and (if known) the audio track's own bitrate —
 * for a source whose video track carries no bitrate metadata at all
 * (common for mp4/webm produced by another tool, which often strip or never
 * write that metadata). `video_bps ≈ (fileBytes*8 − audioBps*duration) /
 * duration`.
 *
 * Returns `undefined` when `durationSeconds` isn't positive (nothing to
 * divide by) or the subtraction goes non-positive (an audio-bitrate guess
 * that's clearly too high, or a bad duration) — better to fall back to the
 * preset default (via `chooseVideoBitrateBps`'s `undefined` branch) than
 * encode from a nonsense estimate.
 */
export function estimateSourceVideoBps(
  fileBytes: number,
  durationSeconds: number,
  audioBps: number | undefined,
): number | undefined {
  if (!(durationSeconds > 0)) return undefined;
  const audioBits = (audioBps ?? 0) * durationSeconds;
  const videoBits = fileBytes * 8 - audioBits;
  if (!(videoBits > 0)) return undefined;
  return videoBits / durationSeconds;
}
