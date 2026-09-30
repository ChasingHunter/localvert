/**
 * Pre-run size estimate for `compress-video`'s modes — ADR-0017's
 * "Estimates" addendum (2026-09-30). Built entirely from
 * `mediabunny/video-planner.ts`'s existing planner functions (the same ones
 * `adapter.ts`'s `runVideoTargetSize` calls for the real encode), so the
 * estimate and the eventual result note are computed from the same
 * arithmetic — this file never invents its own budget math. Pure,
 * environment-neutral: safe to import from `size-estimate.tsx` on the main
 * thread.
 */
import {
  bestQualityVideoBitrateBps,
  type CodecFamily,
  planTargetSizeBudget,
  smallestSensibleBytes,
  stepDownForBpp,
} from "@/lib/engines/mediabunny/video-planner";
import { formatMB } from "./format";

export interface VideoEstimateProbe {
  durationSeconds: number;
  width: number;
  height: number;
  fps: number;
  videoBitrate?: number;
  audioBitrate?: number;
}

/** "Best quality" mode (ADR-0017: "Usually around X MB", 0.7x source as the
 * ceiling) — the exact bitrate `bestQualityVideoBitrateBps` would pick,
 * turned into a file size over the probed duration. */
export function estimateVideoBestQuality(
  probe: VideoEstimateProbe,
  codec: CodecFamily,
): string {
  const videoBps = bestQualityVideoBitrateBps({
    sourceBps: probe.videoBitrate,
    width: probe.width,
    height: probe.height,
    fps: probe.fps,
    codec,
  });
  const audioBps = probe.audioBitrate ?? 0;
  const totalBytes = ((videoBps + audioBps) * probe.durationSeconds) / 8;
  return `Usually around ${formatMB(totalBytes)}.`;
}

/** Target-size/reduce-by-% mode (both reduce to a `targetBytes` before
 * calling this, per ADR-0017: "reduce by % maps to target = source * (1 -
 * p), then behaves exactly like target size"). Runs the same
 * `planTargetSizeBudget` -> `stepDownForBpp` pipeline `runVideoTargetSize`
 * runs for the real encode, so the resolution/reachability this reports is
 * exactly what the engine will land on — only the *measured* output size
 * (which needs a real encode) isn't known yet, so this shows the target
 * itself rather than a guessed final byte count. */
export function estimateVideoTargetSize(params: {
  targetBytes: number;
  probe: VideoEstimateProbe;
  codec: CodecFamily;
  /** The tool's own "Max resolution" option, in pixels — `undefined` for
   * "none". */
  maxHeight?: number;
}): string {
  const { targetBytes, probe, codec, maxHeight } = params;

  const budget = planTargetSizeBudget({
    targetBytes,
    durationSeconds: probe.durationSeconds,
    sourceAudioBps: probe.audioBitrate,
  });

  const unreachableText = () => {
    const smallest = smallestSensibleBytes({
      durationSeconds: probe.durationSeconds,
      sourceWidth: probe.width,
      sourceHeight: probe.height,
      codec,
      audioBps: budget.audioBps,
      overheadBytes: budget.overheadBytes,
    });
    return `Too small for this video. The smallest sensible size is about ${formatMB(smallest)}.`;
  };

  if (budget.videoBps === undefined) return unreachableText();

  const step = stepDownForBpp({
    videoBps: budget.videoBps,
    sourceWidth: probe.width,
    sourceHeight: probe.height,
    sourceFps: probe.fps,
    codec,
    maxHeight,
  });

  if (step.unreachable) return unreachableText();

  const cappedSourceHeight =
    maxHeight !== undefined ? Math.min(probe.height, maxHeight) : probe.height;
  const resized = step.height < cappedSourceHeight;

  return resized
    ? `About ${formatMB(targetBytes)} at ${step.height}p (resized to fit).`
    : `About ${formatMB(targetBytes)} at ${step.height}p.`;
}
