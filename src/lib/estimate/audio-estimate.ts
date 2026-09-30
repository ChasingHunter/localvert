/**
 * Pre-run size estimate for `compress-audio`'s modes — ADR-0017's
 * "Estimates" addendum (2026-09-30). Built from
 * `mediabunny/audio-target.ts`'s existing planner functions, the same ones
 * `audio.ts`'s `runAudioTranscode` calls for the real encode — see
 * `video-estimate.ts`'s identical reasoning for why this file never
 * reimplements that math. Pure, environment-neutral.
 */
import {
  type AudioTargetCodec,
  bestQualityBitrate,
  bitrateForTargetSize,
} from "@/lib/engines/mediabunny/audio-target";
import type { FormatId } from "@/lib/registry/formats";
import { formatMB } from "./format";

/** `compress-audio`'s `accepts` list, mapped to the codec
 * `bitrateForTargetSize`/`bestQualityBitrate` key their ladders by. mp4/mov/
 * webm/mkv never reach `compress-audio` (its own `accepts`, see that tool's
 * definition) so they're deliberately absent here — `undefined` covers
 * "not a format this tool estimates for" generically instead of every
 * unrelated `FormatId`. */
const CODEC_FOR_FORMAT: Partial<Record<FormatId, AudioTargetCodec>> = {
  mp3: "mp3",
  m4a: "aac",
  ogg: "opus",
  opus: "opus",
};

export function audioCodecForFormat(
  format: FormatId,
): AudioTargetCodec | undefined {
  return CODEC_FOR_FORMAT[format];
}

export interface AudioEstimateProbe {
  durationSeconds: number;
  /** The source's own channel count — 1 downmixes the stereo floor away, see
   * `bitrateForTargetSize`'s doc comment. */
  channels: number;
  /** The whole-file average bitrate (`fileSize * 8 / duration`), same
   * ballpark `bestQualityBitrate` is always called with in `audio.ts`. */
  sourceBitrateBps?: number;
}

/** "Best" mode: the bitrate `bestQualityBitrate` would pick, turned into a
 * file size over the probed duration. */
export function estimateAudioBestQuality(
  codec: AudioTargetCodec,
  probe: AudioEstimateProbe,
): string {
  const bitrateBps = bestQualityBitrate(codec, probe.sourceBitrateBps);
  const bytes = (bitrateBps * probe.durationSeconds) / 8;
  return `Usually around ${formatMB(bytes)}.`;
}

/** Target-size/percent mode (both reduce to `targetBytes` first, same
 * "percent maps to target = source * (1 - p)" rule as video). Calls the
 * exact `bitrateForTargetSize` the real encode uses, so "reachable" and
 * "downmixes to mono" here are exactly what the engine will do — only the
 * measured output size (a real encode's VBR variance) isn't known yet. */
export function estimateAudioTargetSize(params: {
  codec: AudioTargetCodec;
  targetBytes: number;
  probe: AudioEstimateProbe;
}): string {
  const { codec, targetBytes, probe } = params;
  const picked = bitrateForTargetSize({
    codec,
    targetBytes,
    durationSec: probe.durationSeconds,
    sourceChannels: probe.channels,
  });

  if (!picked.reachable) {
    const smallestBytes = (picked.bitrateBps * probe.durationSeconds) / 8;
    return `The smallest we could make it is about ${formatMB(smallestBytes)}, mono.`;
  }

  const downmixedToMono = picked.channels === 1 && probe.channels !== 1;
  return downmixedToMono
    ? `About ${formatMB(targetBytes)}, mono.`
    : `About ${formatMB(targetBytes)}, stereo ${Math.round(picked.bitrateBps / 1000)} kbps.`;
}
