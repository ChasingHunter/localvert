import type { Operation, StepFormat } from "@/lib/registry";
import { FORMATS } from "@/lib/registry";
import { defineEngine } from "../define-engine";
import { EngineError, toEngineError } from "../errors";
import { ENGINE_MANIFEST } from "../manifest";
import { computeResizeDims } from "../shared/resize-box";
import type {
  EngineAdapter,
  EngineInput,
  EngineInstance,
  EngineLoadContext,
  EngineResult,
  EngineTask,
  RasterImage,
} from "../types";
import meta from "./engine.json";

/** See the doc comment on the same cast in `../canvas/adapter.ts`. */
const metadata = {
  ...(meta as Pick<
    EngineAdapter,
    "id" | "license" | "location" | "needsIsolation" | "heavy"
  >),
  // engine.json has no "version" for this engine (derived from its
  // installed npm package) -- pnpm gen resolves the real value into
  // manifest.ts, which this reads at build time. See docs/ENGINES.md,
  // "How engine assets ship".
  version: ENGINE_MANIFEST.tracer.version,
} satisfies Pick<
  EngineAdapter,
  "id" | "version" | "license" | "location" | "needsIsolation" | "heavy"
>;

type TraceOptions = Partial<import("@image-tracer-ts/core").Options>;

/** Longest side a raster is allowed to reach before tracing — see
 * `parseTracerOptions`'s `maxSize` and `downscaleIfNeeded` below. */
const DEFAULT_MAX_SIZE = 1600;

type DetailLevel = "low" | "medium" | "high";

/**
 * `options.detail` maps to the library's own tracer-stage knobs (step 3 of
 * its README): `lineErrorMargin`/`curveErrorMargin` are the squared max
 * distance a point can be off a line/curve trajectory and still be merged
 * onto it, so a *larger* margin means fewer, coarser path nodes.
 * `minShapeOutline` discards traced areas with an outline shorter than the
 * given number of points — raising it drops small stray shapes, which
 * matters more once the trace is already coarse. `medium` is an empty
 * override, i.e. the library's own shipped defaults (not its README, which
 * is stale here — `Options.buildFrom(null)` in the installed 1.0.2 actually
 * defaults to `lineErrorMargin`/`curveErrorMargin` `1` and `minShapeOutline`
 * `8`), so `medium` and library-default output are identical.
 */
const DETAIL_PRESETS: Record<DetailLevel, TraceOptions> = {
  low: { lineErrorMargin: 4, curveErrorMargin: 4, minShapeOutline: 16 },
  medium: {},
  high: { lineErrorMargin: 0.5, curveErrorMargin: 0.5, minShapeOutline: 0 },
};

function supports(
  op: Operation,
  input: StepFormat,
  output: StepFormat,
): boolean {
  return op === "encode" && input === "raster" && output === "svg";
}

/**
 * `@image-tracer-ts/core` is "bundled" (see `engine.json`'s `location`) — a
 * pure-TS, zero-wasm rewrite of imagetracerjs that ships inside this
 * adapter's lazily-imported chunk, not as a separate fetched asset. There is
 * nothing for `load()` to initialise ahead of time — mirrors `../psd/adapter.ts`.
 */
async function load(_ctx: EngineLoadContext): Promise<EngineInstance> {
  return { run, dispose };
}

/** Reads `task.input` down to a `RasterImage` — the shape `encode` requires. */
function inputToRaster(input: EngineInput): RasterImage {
  if (input.kind !== "raster") {
    throw new EngineError(
      "internal",
      `tracer expected a raster input, got "${input.kind}"`,
      { engine: metadata.id },
    );
  }
  return input.image;
}

interface TracerOptions {
  colors: number;
  detail: DetailLevel;
  maxSize: number;
}

function parseTracerOptions(
  options: Readonly<Record<string, unknown>>,
): TracerOptions {
  return {
    colors: typeof options.colors === "number" ? options.colors : 16,
    detail:
      options.detail === "low" || options.detail === "high"
        ? options.detail
        : "medium",
    maxSize:
      typeof options.maxSize === "number" ? options.maxSize : DEFAULT_MAX_SIZE,
  };
}

/**
 * Downscales `image` so its long side is at most `maxSize`, preserving
 * aspect ratio — tracing cost grows fast with pixel count, so a large photo
 * traced at full resolution would be both slow and produce an unusably large
 * SVG. Returns `image` unchanged when it's already within budget. Uses
 * `computeResizeDims` (shared with `canvas`/`jsquash-resize`, see
 * `../shared/resize-box.ts`) with a square `maxSize x maxSize` "contain" box
 * and no upscaling — for a square box, "contain" is exactly "scale the
 * longer side down to fit", which is what caps the long side here. The
 * actual resample is `OffscreenCanvas#drawImage`'s own high-quality
 * (browser-native area/box-average-ish) downscaling — worker-safe, no DOM.
 */
async function downscaleIfNeeded(
  image: RasterImage,
  maxSize: number,
): Promise<RasterImage> {
  if (Math.max(image.width, image.height) <= maxSize) {
    return image;
  }

  const { width, height } = computeResizeDims(image.width, image.height, {
    width: maxSize,
    height: maxSize,
    fit: "contain",
    allowUpscale: false,
  });

  const sourceBitmap = await createImageBitmap(
    new ImageData(image.data, image.width, image.height),
  );
  try {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new EngineError(
        "internal",
        "failed to acquire a 2d canvas context",
        { engine: metadata.id },
      );
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(sourceBitmap, 0, 0, width, height);

    const scaled = ctx.getImageData(0, 0, width, height);
    return { width: scaled.width, height: scaled.height, data: scaled.data };
  } finally {
    sourceBitmap.close();
  }
}

/**
 * Dispatches by `task.op`. Mirrors the psd adapter's `run`: every stage
 * normalizes its own thrown errors, and this boundary catches anything that
 * escapes anyway so a raw tracer exception still comes out as an
 * `EngineError`.
 */
async function run(task: EngineTask): Promise<EngineResult> {
  try {
    switch (task.op) {
      case "encode":
        return await runEncode(task);
      default:
        throw new EngineError(
          "unsupported",
          `tracer cannot run op "${task.op}"`,
          { engine: metadata.id },
        );
    }
  } catch (e) {
    throw toEngineError(e, metadata.id);
  }
}

/**
 * encode: `RasterImage` -> SVG bytes, by tracing outlines
 * (`@image-tracer-ts/core`'s `ImageTracer`) rather than encoding pixels.
 * Large rasters are downscaled first (`downscaleIfNeeded`) — the tool
 * description calls out that large images are traced at up to `maxSize` (px,
 * default 1600) on their long side.
 */
async function runEncode(task: EngineTask): Promise<EngineResult> {
  const { input, options, signal, onProgress } = task;
  signal.throwIfAborted();

  const image = inputToRaster(input);
  const { colors, detail, maxSize } = parseTracerOptions(options);

  const scaled = await downscaleIfNeeded(image, maxSize);
  signal.throwIfAborted();
  onProgress?.(0.2);

  const { ImageTracer } = await import("@image-tracer-ts/core");
  const imageData = new ImageData(scaled.data, scaled.width, scaled.height);
  const tracerOptions: TraceOptions = {
    numberOfColors: colors,
    ...DETAIL_PRESETS[detail],
  };

  let svgText: string;
  try {
    svgText = new ImageTracer(tracerOptions).traceImageToSvg(imageData);
  } catch (e) {
    throw new EngineError("encode-failed", "failed to trace image to svg", {
      engine: metadata.id,
      cause: e,
    });
  }

  signal.throwIfAborted();
  onProgress?.(0.9);

  const bytes = new TextEncoder().encode(svgText).buffer;
  onProgress?.(1);
  return { kind: "bytes", bytes, mime: FORMATS.svg.mime };
}

function dispose(): void {
  // No engine-owned resources (no wasm heap of our own, no worker) to
  // release — see `load`'s doc comment.
}

export default defineEngine({
  ...metadata,
  // Checked by check-sizes.ts against built chunks — must be a string
  // literal (see EngineMarker's doc comment in ../types.ts), never computed.
  marker: "localvert-engine:tracer",
  supports,
  load,
});
