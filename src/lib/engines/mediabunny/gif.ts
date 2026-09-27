/// <reference path="../gifenc.d.ts" />
/**
 * video-to-gif: mp4/mov/webm -> gif, on gifenc (MIT) rather than ffmpeg —
 * ADR-0002's dated mitigation note and ADR-0010's media pipeline. Kept in
 * its own module (not inlined in adapter.ts) so parallel work on that file's
 * `transcode` op doesn't collide with this op's dispatch.
 *
 * Frames come from mediabunny's `CanvasSink`, which already handles
 * resizing and rotation/flip metadata — no separate canvas-drawing step is
 * needed beyond what `CanvasSinkOptions` does. Each frame is then
 * gifenc-quantized to its own palette (see `runToGif`'s doc comment for why
 * per-frame rather than one global palette) and written with
 * `GIFEncoder().writeFrame`.
 */

import { applyPalette, GIFEncoder, quantize } from "gifenc";
import { ALL_FORMATS, BlobSource, CanvasSink, Input } from "mediabunny";
import type { EngineId } from "@/lib/registry";
import { EngineError } from "../errors";
import type { EngineInput, EngineTask } from "../types";

/** ADR-mandated limits (Phase 3c brief): keep the encode bounded so a
 * pathological request (a 2-hour source at 800px/30fps) can't hang the
 * worker or produce a multi-hundred-MB GIF. */
export const MAX_DURATION_SECONDS = 30;
export const MAX_WIDTH = 800;
export const MAX_FPS = 30;

export interface ToGifOptions {
  start: number;
  duration: number;
  fps: number;
  width: number;
  colors: number;
  loop: boolean;
}

/** The tool's raw parsed options (`video-to-gif.ts`) — `fps`/`width`/
 * `colors` are string enums there (zod's `enum` control is string-only; see
 * that tool's doc comment), parsed back to numbers here. */
interface RawToGifOptions {
  start: number;
  duration: number;
  fps: string;
  width: string;
  colors: string;
  loop: boolean;
}

function parseToGifOptions(raw: RawToGifOptions): ToGifOptions {
  return {
    start: raw.start,
    duration: raw.duration,
    fps: Number(raw.fps),
    width: Number(raw.width),
    colors: Number(raw.colors),
    loop: raw.loop,
  };
}

/** Reads `task.input` down to a `Blob` — same contract as adapter.ts's
 * `inputToBlob`, duplicated here rather than imported: that function isn't
 * exported, and this op has the same narrow set of input kinds it accepts. */
function inputToBlob(input: EngineInput, engine: EngineId): Blob {
  switch (input.kind) {
    case "blob":
      return input.blob;
    case "bytes":
      return new Blob([input.bytes]);
    case "opfs":
      throw new EngineError(
        "unsupported",
        "mediabunny engine does not read OPFS inputs",
        { engine },
      );
    case "raster":
      throw new EngineError(
        "internal",
        "mediabunny expected a bytes/blob input, got a raster",
        { engine },
      );
  }
}

/**
 * Validates the tool's parsed options against the fixed limits above. Pure
 * (no engine/task dependency) so it's directly unit-testable — thrown
 * `EngineError`s surface through `run()`'s existing `toEngineError` catch in
 * adapter.ts exactly like any other engine failure.
 */
export function validateToGifOptions(
  options: ToGifOptions,
  engine: EngineId,
): void {
  if (options.duration <= 0 || options.duration > MAX_DURATION_SECONDS) {
    throw new EngineError(
      "unsupported",
      `gif duration must be between 0 and ${MAX_DURATION_SECONDS}s`,
      { engine },
    );
  }
  if (options.start < 0) {
    throw new EngineError("unsupported", "gif start must be >= 0", {
      engine,
    });
  }
  if (options.fps <= 0 || options.fps > MAX_FPS) {
    throw new EngineError(
      "unsupported",
      `gif fps must be between 0 and ${MAX_FPS}`,
      { engine },
    );
  }
  if (options.width <= 0 || options.width > MAX_WIDTH) {
    throw new EngineError(
      "unsupported",
      `gif width must be between 0 and ${MAX_WIDTH}px`,
      { engine },
    );
  }
}

/**
 * The frame sample schedule: one timestamp every `1/fps` seconds, starting
 * at `start`, for `duration` seconds — half-open at the end (`[start,
 * start + duration)`) so a `duration` that's an exact multiple of the frame
 * interval doesn't sample one frame past the requested window. Pure, so the
 * schedule itself (not the decode/encode around it) is unit-testable
 * without a browser.
 */
export function frameTimestamps(
  start: number,
  duration: number,
  fps: number,
): number[] {
  const interval = 1 / fps;
  const count = Math.max(1, Math.round(duration * fps));
  const timestamps: number[] = [];
  for (let i = 0; i < count; i++) {
    const t = start + i * interval;
    if (t >= start + duration) break;
    timestamps.push(t);
  }
  return timestamps;
}

/**
 * Scales `sourceWidth`x`sourceHeight` so the output is `targetWidth` wide,
 * keeping aspect ratio, with both dimensions rounded to the nearest even
 * number — GIF (like most video codecs' output expectations) plays safest
 * with even dimensions, and this keeps the pipeline consistent even though
 * the GIF format itself doesn't require it. Never upscales past
 * `targetWidth` when the source is already narrower — `targetWidth` is a
 * ceiling, matching `CanvasSinkOptions.width`'s own "deduced automatically"
 * behavior when only one dimension is given.
 */
export function scaledDimensions(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
): { width: number; height: number } {
  const width = Math.min(targetWidth, sourceWidth);
  const scale = width / sourceWidth;
  const rawHeight = sourceHeight * scale;
  const evenWidth = Math.max(2, Math.round(width / 2) * 2);
  const evenHeight = Math.max(2, Math.round(rawHeight / 2) * 2);
  return { width: evenWidth, height: evenHeight };
}

/**
 * Structural subset of `OffscreenCanvas`/`HTMLCanvasElement`'s 2d context
 * that this function needs. Declared locally rather than referencing
 * `OffscreenCanvas`/`HTMLCanvasElement` by name: this file is typechecked
 * under both `tsconfig.worker.json` (`WebWorker` lib — has `OffscreenCanvas`
 * but not `HTMLCanvasElement`) and `tsconfig.browser-tests.json` (`DOM`
 * lib — the reverse), and it only ever runs against an `OffscreenCanvas` at
 * runtime (this engine's `run()` is worker-only, per ADR-0010) — same
 * reasoning as adapter.ts's `OpfsSyncAccessHandle`.
 */
interface CanvasLike {
  width: number;
  height: number;
  getContext(id: "2d"): {
    getImageData(
      sx: number,
      sy: number,
      sw: number,
      sh: number,
    ): { data: Uint8ClampedArray };
  } | null;
}

/** Reads RGBA pixel bytes out of a `CanvasSink`-produced canvas. */
function readRgba(canvas: CanvasLike): Uint8Array {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new EngineError("internal", "gif frame canvas has no 2d context", {});
  }
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

/**
 * mp4/mov/webm -> gif. Reads frames with mediabunny's `CanvasSink` (handles
 * resizing/rotation/flip), quantizes each frame to its own palette (gifenc
 * has no built-in temporal/global palette optimization, and a fresh
 * per-frame palette gives each frame its best local color match — the
 * simpler, more-correct choice for arbitrary content over a shared 5s/10fps
 * clip; a single global palette computed from a few sampled frames would
 * save a little re-quantization time but cost color accuracy on frames that
 * differ a lot from the sample, which is common in short clips with cuts
 * or fast motion), and writes each as a GIF frame via `GIFEncoder`.
 */
export async function runToGif(
  task: EngineTask,
  engine: EngineId,
): Promise<{ bytes: Uint8Array; mime: string }> {
  const { signal, onProgress } = task;
  signal.throwIfAborted();

  const options = parseToGifOptions(task.options as unknown as RawToGifOptions);
  validateToGifOptions(options, engine);

  const blob = inputToBlob(task.input, engine);
  const input = new Input({
    source: new BlobSource(blob),
    formats: ALL_FORMATS,
  });
  const videoTrack = await input.getPrimaryVideoTrack();
  if (!videoTrack) {
    throw new EngineError("unsupported", "no video track found", { engine });
  }

  const { width, height } = scaledDimensions(
    videoTrack.displayWidth,
    videoTrack.displayHeight,
    options.width,
  );

  const sink = new CanvasSink(videoTrack, {
    width,
    height,
    fit: "contain",
  });

  const timestamps = frameTimestamps(
    options.start,
    options.duration,
    options.fps,
  );
  if (timestamps.length === 0) {
    throw new EngineError("unsupported", "no frames in the requested range", {
      engine,
    });
  }

  const gif = GIFEncoder();
  const delay = 1000 / options.fps;
  let done = 0;

  for await (const wrapped of sink.canvasesAtTimestamps(timestamps)) {
    signal.throwIfAborted();
    if (!wrapped) {
      done++;
      continue;
    }
    const rgba = readRgba(wrapped.canvas);
    const palette = quantize(rgba, options.colors);
    const indexed = applyPalette(rgba, palette);
    gif.writeFrame(indexed, width, height, {
      palette,
      delay,
      repeat: options.loop ? 0 : -1,
    });
    done++;
    onProgress?.(done / timestamps.length);
  }

  gif.finish();
  return { bytes: gif.bytes(), mime: "image/gif" };
}
