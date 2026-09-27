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
import meta from "./engine.json";
import { runToGif } from "./gif";
import { runConversion } from "./output";
import {
  isVideoContainer,
  outputFormatFor,
  pickAudioCodec,
  pickVideoCodec,
  type QualityPreset,
  qualityForPreset,
  type ResizeOptions,
  type ResizePreset,
  resizeToVideoOptions,
  rotationFor,
  validateTrim,
} from "./video";

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
    (op === "toGif" && isVideoContainer(input) && output === "gif")
  );
}

async function run(task: EngineTask): Promise<EngineResult> {
  try {
    switch (task.op) {
      case "transcode":
        return await runVideo(task);
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

  const video = {
    codec: videoCodec,
    ...(resize ? resizeToVideoOptions(resize) : {}),
    ...(opts.quality ? { quality: qualityForPreset(opts.quality) } : {}),
    ...(opts.rotate
      ? { rotate: rotationFor(Number(opts.rotate) as 90 | 180 | 270) }
      : {}),
  };

  const audio = opts.mute
    ? { discard: true as const }
    : audioCodec
      ? { codec: audioCodec }
      : { discard: true as const };

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
    trim = { start, end: opts.end };
  }

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
