/**
 * Video-domain logic shared across every mediabunny video tool: container ->
 * `OutputFormat` instance, codec capability probing, and the pure option ->
 * `Conversion` option mappings (quality preset, resize preset, trim
 * validation). Kept separate from `output.ts` (the generic OPFS/BufferTarget
 * plumbing, format-agnostic) and `adapter.ts` (the thin dispatcher) so the
 * pure pieces here can be unit-tested without a worker/WebCodecs environment.
 */
import {
  ALL_FORMATS,
  type AudioCodec,
  BlobSource,
  type ConversionVideoOptions,
  canEncodeAudio,
  canEncodeVideo,
  Input,
  MkvOutputFormat,
  MovOutputFormat,
  Mp4OutputFormat,
  type OutputFormat,
  QUALITY_HIGH,
  QUALITY_LOW,
  QUALITY_MEDIUM,
  type Quality,
  type Rotation,
  type VideoCodec,
  WebMOutputFormat,
} from "mediabunny";
import { FORMATS } from "@/lib/registry";
import { estimateSourceVideoBps } from "./bitrate";

/** The container formats every video tool in this slice reads or writes.
 * `StepFormat` is wider (every `FormatId`); this narrows it to what
 * `adapter.ts`'s `supports()` actually accepts. */
export type VideoContainer = "mp4" | "mov" | "webm" | "mkv";

export function isVideoContainer(format: string): format is VideoContainer {
  return (
    format === "mp4" ||
    format === "mov" ||
    format === "webm" ||
    format === "mkv"
  );
}

/** `fastStart: false` for both ISOBMFF containers — our `StreamTarget`
 * writes to an OPFS sync access handle (arbitrary-offset writes), so there's
 * no benefit to `'in-memory'` fast-start buffering the whole file, and
 * `'fragmented'` isn't needed since we're not streaming playback mid-write
 * (ADR-0010). */
export function outputFormatFor(container: VideoContainer): {
  format: OutputFormat;
  ext: string;
  mime: string;
} {
  switch (container) {
    case "mp4":
      return {
        format: new Mp4OutputFormat({ fastStart: false }),
        ext: "mp4",
        mime: FORMATS.mp4.mime,
      };
    case "mov":
      return {
        format: new MovOutputFormat({ fastStart: false }),
        ext: "mov",
        mime: FORMATS.mov.mime,
      };
    case "webm":
      return {
        format: new WebMOutputFormat(),
        ext: "webm",
        mime: FORMATS.webm.mime,
      };
    case "mkv":
      return {
        format: new MkvOutputFormat(),
        ext: "mkv",
        mime: FORMATS.mkv.mime,
      };
  }
}

/** ADR-0010's capability probe, extended to every container this slice
 * writes: avc + aac for the ISOBMFF containers (mp4/mov), vp9-falling-
 * back-to-vp8 + opus for the Matroska family (webm/mkv). Returns `null` for
 * a track kind the browser can't encode at all, which callers turn into a
 * clear up-front error rather than an opaque mid-transcode failure. */
export async function pickVideoCodec(
  container: VideoContainer,
): Promise<VideoCodec | null> {
  if (container === "mp4" || container === "mov") {
    return (await canEncodeVideo("avc")) ? "avc" : null;
  }
  if (await canEncodeVideo("vp9")) return "vp9";
  if (await canEncodeVideo("vp8")) return "vp8";
  return null;
}

export async function pickAudioCodec(
  container: VideoContainer,
): Promise<AudioCodec | null> {
  if (container === "mp4" || container === "mov") {
    return (await canEncodeAudio("aac")) ? "aac" : null;
  }
  return (await canEncodeAudio("opus")) ? "opus" : null;
}

/** UI-facing quality preset -> mediabunny's own `Quality` constants
 * (`encode.d.ts`). Kept as a three-way select rather than exposing a raw
 * bitrate/CRF number, matching `compress-jpg`'s quality-slider precedent but
 * coarser: video bitrate/quality tradeoffs are far more codec-dependent, so
 * a slider would imply more precision than these constants actually give. */
export type QualityPreset = "low" | "medium" | "high";

export function qualityForPreset(preset: QualityPreset): Quality {
  switch (preset) {
    case "low":
      return QUALITY_LOW;
    case "medium":
      return QUALITY_MEDIUM;
    case "high":
      return QUALITY_HIGH;
  }
}

/** Resize presets, expressed as target height (mediabunny derives width
 * from the input's aspect ratio when only `height` is set). */
export type ResizePreset = "1080p" | "720p" | "480p";

export function dimensionsForPreset(preset: ResizePreset): { height: number } {
  switch (preset) {
    case "1080p":
      return { height: 1080 };
    case "720p":
      return { height: 720 };
    case "480p":
      return { height: 480 };
  }
}

export interface ResizeOptions {
  preset?: ResizePreset;
  width?: number;
  height?: number;
  fit?: "fill" | "contain" | "cover";
}

/** Maps `resize-video`'s options (a preset, or explicit width/height/fit) to
 * the subset of `ConversionVideoOptions` that controls output dimensions. A
 * preset wins over explicit width/height when both are somehow set — the
 * option form only ever shows one or the other (`showWhen`). */
export function resizeToVideoOptions(
  opts: ResizeOptions,
): Pick<ConversionVideoOptions, "width" | "height" | "fit"> {
  if (opts.preset) {
    return { ...dimensionsForPreset(opts.preset), fit: opts.fit ?? "contain" };
  }
  return { width: opts.width, height: opts.height, fit: opts.fit ?? "contain" };
}

/** `trim-video`'s validation: `end` must be strictly greater than `start`,
 * matching `Conversion`'s own `trim` contract ("must be less than `end`").
 * Returns a discriminated result instead of throwing, so both the option
 * form (a synchronous check before a job even starts) and the engine (which
 * wraps this in an `EngineError`) can each react in their own idiom. */
export type TrimValidation = { ok: true } | { ok: false; message: string };

export function validateTrim(start: number, end: number): TrimValidation {
  if (end <= start) {
    return {
      ok: false,
      message: `trim end (${end}s) must be greater than start (${start}s)`,
    };
  }
  return { ok: true };
}

/** What `sourceBitrates` (below) could determine about one input file —
 * every field `undefined` when it couldn't be, which every caller treats
 * as "use the preset's own ceiling, unchanged" (see `bitrate.ts`). */
export interface SourceBitrates {
  video?: number;
  audio?: number;
  /** The source video track's own display height — used as the resolution
   * bucket for `chooseVideoBitrateBps` when the output isn't being resized
   * (so the output resolution *is* the source's). */
  height?: number;
}

/**
 * Reads a source's own video/audio bitrate for `chooseVideoBitrateBps`/
 * `chooseAudioBitrateBps` (`bitrate.ts`) to cap a compress/edit preset
 * against. Prefers each track's own container-metadata bitrate
 * (`InputTrack.getAverageBitrate`, falling back to the peak
 * `getBitrate`) — the same numbers a video player would report — and only
 * falls back to `estimateSourceVideoBps`'s file-size/duration estimate when
 * the container carries no video bitrate metadata at all (common for
 * mp4/webm produced by another tool). Never throws: any failure to read
 * `blob`'s metadata (a corrupt/unusual file `runConversion`'s own
 * `Conversion.init` will separately reject) just means every field comes
 * back `undefined`, same as "couldn't determine" for a well-formed file
 * with no bitrate metadata.
 */
export async function sourceBitrates(blob: Blob): Promise<SourceBitrates> {
  try {
    const input = new Input({
      source: new BlobSource(blob),
      formats: ALL_FORMATS,
    });
    const [videoTrack, audioTrack] = await Promise.all([
      input.getPrimaryVideoTrack(),
      input.getPrimaryAudioTrack(),
    ]);

    const audio =
      (await audioTrack?.getAverageBitrate()) ??
      (await audioTrack?.getBitrate()) ??
      undefined;

    let video =
      (await videoTrack?.getAverageBitrate()) ??
      (await videoTrack?.getBitrate()) ??
      undefined;
    if (video === undefined) {
      const duration =
        (await input.getDurationFromMetadata()) ??
        (await input.computeDuration());
      video = estimateSourceVideoBps(blob.size, duration, audio);
    }

    return { video, audio, height: videoTrack?.displayHeight };
  } catch {
    return {};
  }
}

/** `rotate-video`'s options -> mediabunny's `Rotation` (a plain clockwise
 * degree union, `0 | 90 | 180 | 270`) — this function exists mainly so the
 * option -> `Conversion` mapping has one obvious home next to its siblings
 * above, not because the identity mapping itself needs logic. */
export function rotationFor(degrees: 90 | 180 | 270): Rotation {
  return degrees;
}
