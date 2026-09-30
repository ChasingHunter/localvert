/**
 * Video ops via mediabunny (ADR-0010), which wraps native WebCodecs — no
 * wasm codec of its own, hence `location: "bundled"` (pure JS, ships inside
 * this adapter's own dynamic-imported worker chunk, same as `psd`).
 *
 * This file is a thin dispatcher: `supports()` says which op/container pairs
 * it handles, `run()` switches on `task.op` and delegates to `runVideo()`,
 * which maps the tool's own options onto mediabunny's `Conversion` options
 * (via `video.ts`) and drives the run through the shared `runConversion()`
 * helper (`output.ts` — OPFS `StreamTarget` + `BufferTarget` fallback +
 * `isValid` check + abort/cleanup, extracted here because every video op
 * needs the exact same plumbing, container conversion or in-place edit
 * alike). See ADR-0010 for the full output-target design.
 */
import {
  type AudioCodec,
  type OutputFormat,
  Quality,
  type VideoCodec,
} from "mediabunny";
import type { Operation, StepFormat } from "@/lib/registry";
import { defineEngine } from "../define-engine";
import { EngineError, toEngineError } from "../errors";
import { ENGINE_MANIFEST } from "../manifest";
import type {
  EngineAdapter,
  EngineInstance,
  EngineLoadContext,
  EngineResult,
  EngineTask,
} from "../types";
import { runAudioTranscode, supportsAudioTranscode } from "./audio";
import { chooseAudioBitrateBps, chooseVideoBitrateBps } from "./bitrate";
import meta from "./engine.json";
import { runToGif } from "./gif";
import { deleteConversionOutput, inputToBlob, runConversion } from "./output";
import { fitClipToDuration } from "./trim-range";
import {
  codecFamilyFor,
  dimensionsForPreset,
  isVideoContainer,
  outputFormatFor,
  pickAudioCodec,
  pickVideoCodec,
  type QualityPreset,
  type ResizeOptions,
  type ResizePreset,
  resizeToVideoOptions,
  rotationFor,
  type SourceBitrates,
  sourceBitrates,
  type VideoContainer,
  validateTrim,
} from "./video";
import {
  alreadyUnderTargetNote,
  bestQualityVideoBitrateBps,
  bppFloor,
  planTargetSizeBudget,
  runWithSizeRetries,
  stepDownForBpp,
  targetBytesFromPercent,
  targetSizeResultNote,
} from "./video-planner";

const metadata = {
  ...(meta as Pick<
    EngineAdapter,
    "id" | "license" | "location" | "needsIsolation" | "heavy"
  >),
  version: ENGINE_MANIFEST.mediabunny.version,
} satisfies Pick<
  EngineAdapter,
  "id" | "version" | "license" | "location" | "needsIsolation" | "heavy"
>;

/**
 * `transcode` covers every video tool in this slice: plain container
 * conversion (webm-to-mp4, mov-to-mp4, …) and every in-place edit
 * (trim/mute/resize/compress/rotate — same container in and out) both boil
 * down to "run one mediabunny `Conversion`", just with different `video`/
 * `audio`/`trim` options built from `task.options`. Both sides of the pair
 * must be one of the four containers this adapter knows how to write.
 */
function supports(
  op: Operation,
  input: StepFormat,
  output: StepFormat,
): boolean {
  return (
    (op === "transcode" &&
      isVideoContainer(input) &&
      isVideoContainer(output)) ||
    (op === "toGif" && isVideoContainer(input) && output === "gif") ||
    supportsAudioTranscode(op, input, output)
  );
}

async function run(task: EngineTask): Promise<EngineResult> {
  try {
    switch (task.op) {
      case "transcode":
        return supportsAudioTranscode(
          task.op,
          task.inputFormat,
          task.outputFormat,
        )
          ? await runAudioTranscode(task)
          : await runVideo(task);
      case "toGif": {
        const { bytes, mime } = await runToGif(task, metadata.id);
        return { kind: "bytes", bytes: bytes.buffer as ArrayBuffer, mime };
      }
      default:
        throw new EngineError(
          "unsupported",
          `mediabunny cannot run op "${task.op}"`,
          { engine: metadata.id },
        );
    }
  } catch (e) {
    throw toEngineError(e, metadata.id);
  }
}

/**
 * Builds the `Conversion` options for one video task from `task.options`
 * (the tool's own parsed zod options, shaped differently per tool — a
 * container-conversion tool has none of these; `trim-video` has
 * `start`/`end`; `mute-video` sets `audio.discard`; etc.) and runs it
 * through the shared `runConversion` helper. `task.outputFormat` names the
 * output container directly (set by each tool's pipeline step, or falling
 * back to the file's own sniffed format for a `produces: "same"` edit tool)
 * — no per-tool switch needed here.
 */
async function runVideo(task: EngineTask): Promise<EngineResult> {
  const { signal } = task;
  signal.throwIfAborted();

  const container = task.outputFormat;
  if (!isVideoContainer(container)) {
    throw new EngineError(
      "unsupported",
      `mediabunny cannot write output format "${container}"`,
      { engine: metadata.id },
    );
  }

  // Every video tool's options land here as one flat shape — each tool
  // schema only ever sets the subset of these keys its own option form
  // exposes (see each tool file), so the fields below are read
  // independently rather than assuming any particular tool set all of
  // them. `preset`/`width`/`height`/`fit` come from `resize-video`;
  // `maxHeight` from `compress-video` (a coarser "cap the resolution"
  // knob, expressed as the same preset vocabulary); `mute` from
  // `mute-video`; `rotate` from `rotate-video`; `start`/`end` from
  // `trim-video`; `quality` from every container-conversion and
  // `compress-video` tool.
  const opts = task.options as {
    quality?: QualityPreset;
    mute?: boolean;
    preset?: ResizePreset | "custom";
    width?: number;
    height?: number;
    fit?: "fill" | "contain" | "cover";
    maxHeight?: ResizePreset | "none";
    rotate?: "90" | "180" | "270";
    start?: number;
    end?: number;
    // ADR-0017: compress-video only. `mode` is absent (`undefined`) on
    // every other video tool's options, which is exactly what routes them
    // through the pre-existing "custom" branch below, unchanged.
    mode?: "best-quality" | "custom" | "target-size" | "reduce-percent";
    targetSizeMB?: number;
    reducePercent?: number;
  };

  const videoCodec = await pickVideoCodec(container);
  if (!videoCodec) {
    throw new EngineError(
      "unsupported",
      `your browser can't encode video/${container}`,
      { engine: metadata.id },
    );
  }
  signal.throwIfAborted();

  const audioCodec = opts.mute ? null : await pickAudioCodec(container);
  signal.throwIfAborted();

  const { format, ext, mime } = outputFormatFor(container);

  let resize: ResizeOptions | undefined;
  if (opts.preset) {
    resize =
      opts.preset === "custom"
        ? { width: opts.width, height: opts.height, fit: opts.fit }
        : { preset: opts.preset, fit: opts.fit };
  } else if (opts.maxHeight && opts.maxHeight !== "none") {
    resize = { preset: opts.maxHeight };
  }

  // ADR-0013's addendum (2026-09-30): every preset here used to pass
  // mediabunny's own `Quality` constant, which resolves to a fixed
  // quantizer or a bitrate computed purely from the *output* resolution —
  // no awareness at all of how efficiently the source was already encoded,
  // so re-encoding an already-compressed source could easily target a
  // *higher* rate than it already used (see docs/adr/0013 for the full
  // mechanism). Every video tool now targets an explicit numeric bitrate
  // instead, capped against the source's own bitrate — `bitrate.ts`'s
  // `chooseVideoBitrateBps`/`chooseAudioBitrateBps`. `opts.quality` defaults
  // to "medium" for every tool here, including the ones with no `quality`
  // option at all (resize/rotate/trim/mute-video) — the same default
  // mediabunny itself falls back to when no quality/bitrate is given.
  const source = await sourceBitrates(inputToBlob(task.input, metadata.id));
  signal.throwIfAborted();

  let trim: { start?: number; end?: number } | undefined;
  if (opts.start !== undefined || opts.end !== undefined) {
    const start = opts.start ?? 0;
    if (opts.end !== undefined) {
      const validation = validateTrim(start, opts.end);
      if (!validation.ok) {
        throw new EngineError("unsupported", validation.message, {
          engine: metadata.id,
        });
      }
    }
    // A start past the end of the video would silently produce an empty
    // file; an end past it is clamped. See `trim-range.ts`.
    const fitted = fitClipToDuration(start, opts.end, source.duration);
    if (!fitted.ok) {
      throw new EngineError("unsupported", fitted.message, {
        engine: metadata.id,
      });
    }
    trim = { start: fitted.start, end: fitted.end };
  }

  // ADR-0017 (2026-09-30): compress-video's target-size and reduce-by-%
  // modes need a whole different shape — a byte budget split across
  // audio/overhead/video, a resolution/fps ladder, and a measure-and-retry
  // loop — so they're handled entirely by `runVideoTargetSize` rather than
  // bending the single-pass shape below to fit. Every other mode (and
  // every other video tool, which has no `mode` option at all) keeps the
  // single-pass shape.
  if (opts.mode === "target-size" || opts.mode === "reduce-percent") {
    return runVideoTargetSize({
      task,
      mode: opts.mode,
      targetSizeMB: opts.targetSizeMB,
      reducePercent: opts.reducePercent,
      mute: opts.mute,
      maxHeight: opts.maxHeight,
      container,
      videoCodec,
      audioCodec,
      format,
      ext,
      mime,
      source,
      trim,
    });
  }

  const targetHeight =
    resize?.preset !== undefined
      ? dimensionsForPreset(resize.preset).height
      : (resize?.height ?? source.height ?? 1080);

  let videoBitrate: number;
  let audio: { discard: true } | { codec: AudioCodec; bitrate?: number };

  if (opts.mode === "best-quality") {
    // ADR-0017's default mode: ceiling = min(0.7x source, a bits-per-pixel
    // ceiling at the output's own resolution/fps) — see
    // `video-planner.ts`'s `bestQualityVideoBitrateBps` doc comment for why
    // this alone is the entire "never bigger" rule for this mode (no
    // quantizer path at all).
    const targetWidth =
      source.width && source.height
        ? Math.round((targetHeight * source.width) / source.height)
        : Math.round((targetHeight * 16) / 9);
    videoBitrate = bestQualityVideoBitrateBps({
      sourceBps: source.video,
      width: targetWidth,
      height: targetHeight,
      fps: source.fps ?? 30,
      codec: codecFamilyFor(videoCodec),
    });

    // Audio: passed through untouched when the source's own codec already
    // matches the output's — mediabunny copies the encoded packets as-is
    // whenever a track's options carry no `codec`/`bitrate` at all and the
    // codec is already supported by the output container (verified in
    // `mediabunny/dist/modules/src/conversion.js`'s `_processAudioTrack`:
    // any explicit `codec`/`bitrate` forces a transcode). Otherwise capped
    // at the source's own audio bitrate via the existing `high`-preset
    // ceiling (160 kbps), same as every other mode here.
    audio = opts.mute
      ? { discard: true }
      : !audioCodec
        ? { discard: true }
        : source.audioCodec === audioCodec
          ? { codec: audioCodec }
          : {
              codec: audioCodec,
              bitrate: chooseAudioBitrateBps("high", source.audio),
            };
  } else {
    // "custom" (or no mode at all, for every other video tool) — the
    // pre-existing ADR-0013-addendum behaviour, unchanged.
    const preset = opts.quality ?? "medium";
    videoBitrate = chooseVideoBitrateBps(preset, targetHeight, source.video);
    audio = opts.mute
      ? { discard: true }
      : audioCodec
        ? {
            codec: audioCodec,
            bitrate: chooseAudioBitrateBps(preset, source.audio),
          }
        : { discard: true };
  }

  const video = {
    codec: videoCodec,
    ...(resize ? resizeToVideoOptions(resize) : {}),
    bitrate: videoBitrate,
    ...(opts.rotate
      ? { rotate: rotationFor(Number(opts.rotate) as 90 | 180 | 270) }
      : {}),
  };

  return runConversion({
    task,
    engineId: metadata.id,
    format,
    ext,
    mime,
    video,
    audio,
    trim,
  });
}

/**
 * ADR-0017's target-size/percent modes: split the byte budget
 * (`planTargetSizeBudget`), pick a resolution/fps rung whose bpp clears the
 * codec's floor (`stepDownForBpp`), then measure-and-retry
 * (`runWithSizeRetries`) until the result lands inside the target window —
 * or, when the budget can't clear even the floor at 360p/24fps, encode once
 * at that floor and report the result honestly as "unreachable" (ADR-0017's
 * result contract never silently returns something over target).
 */
async function runVideoTargetSize(args: {
  task: EngineTask;
  mode: "target-size" | "reduce-percent";
  targetSizeMB?: number;
  reducePercent?: number;
  mute?: boolean;
  maxHeight?: ResizePreset | "none";
  container: VideoContainer;
  videoCodec: VideoCodec;
  audioCodec: AudioCodec | null;
  format: OutputFormat;
  ext: string;
  mime: string;
  source: SourceBitrates;
  trim?: { start?: number; end?: number };
}): Promise<EngineResult> {
  const {
    task,
    mode,
    targetSizeMB,
    reducePercent,
    mute,
    maxHeight,
    videoCodec,
    audioCodec,
    format,
    ext,
    mime,
    source,
    trim,
  } = args;
  const { signal, onProgress } = task;

  const blob = inputToBlob(task.input, metadata.id);
  const duration = source.duration;
  if (duration === undefined || !(duration > 0)) {
    throw new EngineError(
      "unsupported",
      "can't determine this video's duration, so a target size can't be planned for it",
      { engine: metadata.id },
    );
  }

  const targetBytes =
    mode === "target-size"
      ? (targetSizeMB ?? 20) * 1024 * 1024
      : targetBytesFromPercent(blob.size, reducePercent ?? 50);

  // ADR-0017 addendum (2026-09-30): a target the source already meets has
  // nothing to squeeze — see `alreadyUnderTargetNote`'s doc comment for the
  // `no_encodable_target_codec` bug this specifically closes.
  // `"reduce-percent"` can never trip this (its target is always strictly
  // smaller than the source), but a typed-in `"target-size"` MB value can be
  // anything.
  if (blob.size <= targetBytes) {
    onProgress?.(1);
    return {
      kind: "bytes",
      bytes: await blob.arrayBuffer(),
      mime,
      note: alreadyUnderTargetNote({ sourceBytes: blob.size, targetBytes }),
    };
  }

  const budget = planTargetSizeBudget({
    targetBytes,
    durationSeconds: duration,
    sourceAudioBps: source.audio,
  });

  const codec = codecFamilyFor(videoCodec);
  const sourceWidth = source.width ?? 1920;
  const sourceHeight = source.height ?? 1080;
  const sourceFps = source.fps ?? 30;
  const maxHeightCap =
    maxHeight && maxHeight !== "none"
      ? dimensionsForPreset(maxHeight).height
      : undefined;
  const startingHeight =
    maxHeightCap !== undefined
      ? Math.min(sourceHeight, maxHeightCap)
      : sourceHeight;

  const audio: { discard: true } | { codec: AudioCodec; bitrate: number } =
    mute || !audioCodec
      ? { discard: true }
      : { codec: audioCodec, bitrate: budget.audioBps };

  // `budget.videoBps` is `undefined` when audio + overhead alone already
  // exhaust the target — forcing a tiny positive placeholder here routes
  // that case through the exact same "unreachable" branch as a budget
  // that's merely too low for the floor at every rung, since 1 bps is
  // below every codec's floor at any resolution.
  const step = stepDownForBpp({
    videoBps: budget.videoBps ?? 1,
    sourceWidth,
    sourceHeight,
    sourceFps,
    codec,
    maxHeight: maxHeightCap,
  });

  let passIndex = 0;
  // ADR-0017 shows "Pass N of 3" progress during retries; the job store's
  // `progress` field is a bare 0..1 fraction with no text channel (adding
  // one would mean widening `Job`/the job-row UI well beyond this engine
  // slice — left as a follow-up, noted in this slice's report). This scales
  // each pass's own 0..1 progress into its slice of an assumed 3-pass
  // budget instead, so the bar at least advances monotonically across
  // retries rather than restarting at 0 on every pass.
  const PASSES_ESTIMATE = 3;
  async function encode(
    bitrateBps: number,
    dims: { width: number; height: number; fps: number },
  ): Promise<{ sizeBytes: number; result: EngineResult }> {
    passIndex++;
    signal.throwIfAborted();
    const scopedTask: EngineTask = {
      ...task,
      onProgress: (fraction) => {
        const overall = (passIndex - 1 + fraction) / PASSES_ESTIMATE;
        onProgress?.(Math.min(overall, 0.99));
      },
    };
    const video = {
      codec: videoCodec,
      width: dims.width,
      height: dims.height,
      fit: "contain" as const,
      frameRate: dims.fps,
      bitrate: new Quality({
        bitrate: Math.max(1, Math.round(bitrateBps)),
        bitrateMode: "variable",
      }),
    };
    const result = await runConversion({
      task: scopedTask,
      engineId: metadata.id,
      format,
      ext,
      mime,
      video,
      audio,
      trim,
    });
    const sizeBytes =
      result.kind === "opfs"
        ? result.size
        : result.kind === "bytes"
          ? result.bytes.byteLength
          : 0;
    return { sizeBytes, result };
  }

  function withNote(result: EngineResult, note: string): EngineResult {
    if (result.kind === "bytes" || result.kind === "opfs") {
      return { ...result, note };
    }
    return result;
  }

  if (step.unreachable) {
    const { width, height, fps } = step.smallest;
    const floorBitrateBps = bppFloor(codec) * width * height * fps;
    const { sizeBytes, result } = await encode(floorBitrateBps, {
      width,
      height,
      fps,
    });
    onProgress?.(1);
    return withNote(
      result,
      targetSizeResultNote({ kind: "unreachable", actualBytes: sizeBytes }),
    );
  }

  const { width, height, fps } = step;
  const { final } = await runWithSizeRetries({
    targetBytes,
    durationSeconds: duration,
    initialBitrateBps: budget.videoBps as number,
    encode: (bitrateBps) => encode(bitrateBps, { width, height, fps }),
    cleanup: (pass) => deleteConversionOutput(pass.result),
    signal,
  });
  onProgress?.(1);

  const resized = height < startingHeight;
  const outcome =
    final.sizeBytes > targetBytes
      ? ({ kind: "unreachable", actualBytes: final.sizeBytes } as const)
      : resized
        ? ({
            kind: "resized",
            actualBytes: final.sizeBytes,
            targetBytes,
            resizedToHeight: height,
          } as const)
        : ({
            kind: "hit",
            actualBytes: final.sizeBytes,
            targetBytes,
          } as const);

  return withNote(final.result, targetSizeResultNote(outcome));
}

async function load(_ctx: EngineLoadContext): Promise<EngineInstance> {
  return { run, dispose };
}

function dispose(): void {
  // No engine-owned resource persists between `run()` calls — each
  // conversion opens its own `Input`/`Output`/sync access handle and closes
  // them within `runConversion` itself.
}

export default defineEngine({
  ...metadata,
  marker: "localvert-engine:mediabunny",
  supports,
  load,
});
