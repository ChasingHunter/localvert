/**
 * ADR-0017's "Estimates" addendum (2026-09-30) — the generic surface
 * `ToolRunner`/`SizeEstimate` (both main-thread) use, keyed only by
 * `ToolDefinition.estimateKind` so neither has to know each compress tool's
 * own option shape. Every real number here comes from `video-estimate.ts`/
 * `audio-estimate.ts`/`pdf-estimate.ts`, which in turn call the same planner
 * functions the engines themselves use — see each file's own doc comment.
 */

import { targetBytesForPercent } from "@/lib/engines/mediabunny/audio-target";
import type { CodecFamily } from "@/lib/engines/mediabunny/video-planner";
import { targetBytesFromPercent } from "@/lib/engines/mediabunny/video-planner";
import type { FormatId } from "@/lib/registry/formats";
import type { ToolDefinition } from "@/lib/registry/types";
import {
  audioCodecForFormat,
  estimateAudioBestQuality,
  estimateAudioTargetSize,
} from "./audio-estimate";
import { estimatePdfTargetSize } from "./pdf-estimate";
import type { MediaProbeResult, PdfProbeResult, ProbeResult } from "./types";
import {
  estimateVideoBestQuality,
  estimateVideoTargetSize,
} from "./video-estimate";

export type { MediaProbeResult, PdfProbeResult, ProbeResult } from "./types";

/**
 * Which of a tool's own `mode` values should hold a dropped file back for an
 * explicit "Convert" instead of submitting on drop — see `ToolRunner`'s doc
 * comment on why: a target/percent job can be unreachable, so running it
 * immediately (today's behaviour for every mode) would burn a real encode
 * before the user has any idea whether the number they typed makes sense.
 * "Best quality" and every fixed-preset mode (`custom`/`lossless`/
 * `balanced`/`strong`) keep submitting on drop, unchanged.
 */
const STAGE_MODES: Record<
  NonNullable<ToolDefinition["estimateKind"]>,
  readonly string[]
> = {
  video: ["target-size", "reduce-percent"],
  audio: ["target-size", "percent"],
  pdf: ["target-size", "percent"],
};

export function shouldStageForEstimate(
  estimateKind: ToolDefinition["estimateKind"],
  options: Readonly<Record<string, unknown>>,
): boolean {
  if (!estimateKind) return false;
  const mode = options.mode;
  return typeof mode === "string" && STAGE_MODES[estimateKind].includes(mode);
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function videoCodecFamilyFor(format: FormatId): CodecFamily {
  // Approximation, documented: `compress-video`'s output container always
  // matches the input (`produces: "same"`), and only a webm container's own
  // codec choices land in the vp9-family bpp numbers — mp4/mov/mkv are
  // treated as avc, the overwhelmingly common case for those containers, and
  // the only one this tool's own real encode ever writes to them
  // (`video.ts`'s output codec selection). See `mediabunny/video.ts`'s
  // `codecFamilyFor`, which this mirrors for the *chosen output* codec
  // rather than a guess from the container alone.
  return format === "webm" ? "vp9" : "avc";
}

function videoEstimate(
  options: Readonly<Record<string, unknown>>,
  probe: MediaProbeResult,
  sourceBytes: number,
  sourceFormat: FormatId,
): string | undefined {
  if (
    probe.durationSeconds === undefined ||
    probe.durationSeconds <= 0 ||
    probe.width === undefined ||
    probe.height === undefined
  ) {
    return undefined;
  }
  const codec = videoCodecFamilyFor(sourceFormat);
  const fps = probe.fps ?? 30;
  const mode = typeof options.mode === "string" ? options.mode : "best-quality";

  if (mode === "best-quality") {
    return estimateVideoBestQuality(
      {
        durationSeconds: probe.durationSeconds,
        width: probe.width,
        height: probe.height,
        fps,
        videoBitrate: probe.videoBitrate,
        audioBitrate: probe.audioBitrate,
      },
      codec,
    );
  }

  if (mode !== "target-size" && mode !== "reduce-percent") return undefined;

  const targetBytes =
    mode === "target-size"
      ? numberOr(options.targetSizeMB, 20) * 1024 * 1024
      : targetBytesFromPercent(
          sourceBytes,
          numberOr(options.reducePercent, 50),
        );

  const maxHeightOpt = options.maxHeight;
  const maxHeight =
    maxHeightOpt === "1080p"
      ? 1080
      : maxHeightOpt === "720p"
        ? 720
        : maxHeightOpt === "480p"
          ? 480
          : undefined;

  return estimateVideoTargetSize({
    targetBytes,
    probe: {
      durationSeconds: probe.durationSeconds,
      width: probe.width,
      height: probe.height,
      fps,
      videoBitrate: probe.videoBitrate,
      audioBitrate: probe.audioBitrate,
    },
    codec,
    maxHeight,
  });
}

function audioEstimate(
  options: Readonly<Record<string, unknown>>,
  probe: MediaProbeResult,
  sourceBytes: number,
  sourceFormat: FormatId,
): string | undefined {
  const codec = audioCodecForFormat(sourceFormat);
  if (
    !codec ||
    probe.durationSeconds === undefined ||
    probe.durationSeconds <= 0
  ) {
    return undefined;
  }
  const channels = probe.audioChannels ?? 2;
  const mode = typeof options.mode === "string" ? options.mode : "best";

  if (mode === "best") {
    const sourceBitrateBps = (sourceBytes * 8) / probe.durationSeconds;
    return estimateAudioBestQuality(codec, {
      durationSeconds: probe.durationSeconds,
      channels,
      sourceBitrateBps,
    });
  }

  if (mode !== "target-size" && mode !== "percent") return undefined;

  const targetBytes =
    mode === "target-size"
      ? numberOr(options.targetSizeMB, 10) * 1024 * 1024
      : targetBytesForPercent(sourceBytes, numberOr(options.percent, 50));

  return estimateAudioTargetSize({
    codec,
    targetBytes,
    probe: { durationSeconds: probe.durationSeconds, channels },
  });
}

function pdfEstimate(
  options: Readonly<Record<string, unknown>>,
  probe: PdfProbeResult,
  sourceBytes: number,
): string | undefined {
  const mode = typeof options.mode === "string" ? options.mode : "lossless";
  if (mode !== "target-size" && mode !== "percent") return undefined;

  const targetBytes =
    mode === "target-size"
      ? numberOr(options.targetSizeMB, 10) * 1024 * 1024
      : sourceBytes * (1 - numberOr(options.percent, 50) / 100);

  return estimatePdfTargetSize({ targetBytes, probe });
}

/**
 * The one entry point `SizeEstimate` calls: dispatches on `tool.estimateKind`
 * alone, `undefined` for a tool/mode combination with no estimate to show
 * (an image tool, or a fixed-preset mode with no target to reason about —
 * ADR-0017 only promises estimates "where the size is arithmetic").
 */
export function computeEstimateText(
  tool: ToolDefinition,
  options: Readonly<Record<string, unknown>>,
  probe: ProbeResult,
  sourceBytes: number,
  sourceFormat: FormatId,
): string | undefined {
  switch (tool.estimateKind) {
    case "video":
      return videoEstimate(
        options,
        probe as MediaProbeResult,
        sourceBytes,
        sourceFormat,
      );
    case "audio":
      return audioEstimate(
        options,
        probe as MediaProbeResult,
        sourceBytes,
        sourceFormat,
      );
    case "pdf":
      return pdfEstimate(options, probe as PdfProbeResult, sourceBytes);
    default:
      return undefined;
  }
}
