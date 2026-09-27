import type { FormatId, Operation, StepFormat } from "@/lib/registry";
import { FORMATS } from "@/lib/registry";
import { defineEngine } from "../define-engine";
import { EngineError, toEngineError } from "../errors";
import { computeResizeDims, parseResizeOptions } from "../shared/resize-box";
import type {
  EngineAdapter,
  EngineInput,
  EngineInstance,
  EngineLoadContext,
  EngineResult,
  EngineTask,
  RasterImage,
} from "../types";
import { encodeBmp } from "./bmp";
import meta from "./engine.json";
import { encodeGif } from "./gif";
import {
  buildIcoContainer,
  decodeIcoDib,
  extractIcoEntryBytes,
  type IcoEncodeEntry,
  icoSizesForPreset,
  isPngIcoEntry,
  parseIcoDirectory,
  pickLargestIcoEntry,
} from "./ico";

/**
 * `engine.json` is the single source of truth for this adapter's metadata,
 * shared with the codegen that builds `manifest.ts`. A JSON import widens
 * literal types (e.g. `location: string` instead of `EngineLocation`), so
 * this cast narrows it back to what `EngineAdapter` expects. `defineEngine`
 * below validates the actual values at runtime, so a typo in engine.json
 * (a bad semver, a stray space in `license`) still fails loudly rather than
 * silently passing the cast.
 */
const metadata = meta as Pick<
  EngineAdapter,
  "id" | "version" | "license" | "location" | "needsIsolation" | "heavy"
>;

/**
 * Formats `<canvas>` can both decode from and encode to through a single
 * `OffscreenCanvas.convertToBlob` round trip — what `transcode` (decode +
 * encode in one step, no raster ever leaves this adapter) supports.
 */
const TRANSCODE_DECODABLE: readonly FormatId[] = [
  "jpg",
  "png",
  "webp",
  "bmp",
  "gif",
];
const TRANSCODE_ENCODABLE: readonly FormatId[] = ["jpg", "png", "webp"];

/**
 * Formats the standalone `decode`/`encode` ops support — a superset of the
 * `transcode` lists above. `bmp`/`gif`/`ico` decode/encode go through this
 * adapter's own pure-TS code (`bmp.ts`/`gif.ts`/`ico.ts`), not
 * `convertToBlob`, which the browser has no support for on any of the
 * three — see `runEncode`'s and `runDecode`'s special cases below. `ico`
 * decode never goes through `runTranscode`'s single-blob shortcut (it needs
 * its own directory parsing first), which is why it's absent from
 * `TRANSCODE_DECODABLE` but present here.
 */
const DECODABLE: readonly FormatId[] = [
  "jpg",
  "png",
  "webp",
  "bmp",
  "gif",
  "ico",
];
const ENCODABLE: readonly FormatId[] = [
  "jpg",
  "png",
  "webp",
  "bmp",
  "gif",
  "ico",
];

function supports(
  op: Operation,
  input: StepFormat,
  output: StepFormat,
): boolean {
  switch (op) {
    case "transcode":
      return (
        input !== "raster" &&
        output !== "raster" &&
        TRANSCODE_DECODABLE.includes(input) &&
        TRANSCODE_ENCODABLE.includes(output)
      );
    case "decode":
      return (
        input !== "raster" && output === "raster" && DECODABLE.includes(input)
      );
    case "encode":
      return (
        input === "raster" && output !== "raster" && ENCODABLE.includes(output)
      );
    case "resize":
    case "rotate":
    case "crop":
      return input === "raster" && output === "raster";
    default:
      return false;
  }
}

async function load(_ctx: EngineLoadContext): Promise<EngineInstance> {
  if (
    typeof OffscreenCanvas !== "function" ||
    typeof createImageBitmap !== "function"
  ) {
    throw new EngineError(
      "unsupported",
      "OffscreenCanvas or createImageBitmap is not available",
      { engine: metadata.id },
    );
  }
  return { run, dispose };
}

/** Reads `task.input` down to a `Blob`, the only shape `createImageBitmap` accepts. */
function inputToBlob(input: EngineInput): Blob {
  switch (input.kind) {
    case "blob":
      return input.blob;
    case "bytes":
      return new Blob([input.bytes]);
    case "opfs":
      throw new EngineError(
        "unsupported",
        "canvas engine does not read OPFS inputs",
        { engine: metadata.id },
      );
    case "raster":
      throw new EngineError(
        "internal",
        "canvas expected a blob/bytes input, got a raster",
        { engine: metadata.id },
      );
  }
}

/** Reads `task.input` down to a `RasterImage` — the shape every raster-side
 * op (`encode`/`resize`/`rotate`/`crop`) requires. */
function inputToRaster(input: EngineInput): RasterImage {
  if (input.kind !== "raster") {
    throw new EngineError(
      "internal",
      `canvas expected a raster input, got "${input.kind}"`,
      { engine: metadata.id },
    );
  }
  return input.image;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function newContext(
  width: number,
  height: number,
): OffscreenCanvasRenderingContext2D {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new EngineError("internal", "failed to acquire a 2d canvas context", {
      engine: metadata.id,
    });
  }
  return ctx;
}

/**
 * Dispatches by `task.op`. Every stage below normalizes its own thrown
 * errors through `toEngineError` at this single boundary, so a raw
 * `DOMException`/`RangeError`/etc. from any of them still comes out as a
 * proper `EngineError`.
 */
async function run(task: EngineTask): Promise<EngineResult> {
  try {
    switch (task.op) {
      case "transcode":
        return await runTranscode(task);
      case "decode":
        return await runDecode(task);
      case "encode":
        return await runEncode(task);
      case "resize":
        return await runResize(task);
      case "rotate":
        return await runRotate(task);
      case "crop":
        return await runCrop(task);
      default:
        throw new EngineError(
          "unsupported",
          `canvas cannot run op "${task.op}"`,
          { engine: metadata.id },
        );
    }
  } catch (e) {
    throw toEngineError(e, metadata.id);
  }
}

/**
 * Re-encodes an image through `<canvas>` in one step. This drops EXIF and
 * other embedded metadata (including GPS) on every conversion — intentional
 * for privacy, not a bug to fix. An animated GIF or WebP input decodes to
 * its first frame only; `createImageBitmap` has no concept of subsequent
 * frames.
 */
async function runTranscode(task: EngineTask): Promise<EngineResult> {
  const { input, outputFormat, options, signal, onProgress } = task;
  signal.throwIfAborted();

  const blob = inputToBlob(input);

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob, {
      imageOrientation: "from-image",
      premultiplyAlpha: "none",
      colorSpaceConversion: "default",
    });
  } catch (e) {
    throw new EngineError("decode-failed", "failed to decode source image", {
      engine: metadata.id,
      cause: e,
    });
  }

  try {
    onProgress?.(0.1);
    signal.throwIfAborted();

    if (outputFormat === "raster") {
      throw new EngineError(
        "internal",
        "canvas transcode requires a concrete output format",
        { engine: metadata.id },
      );
    }

    const ctx = newContext(bitmap.width, bitmap.height);

    if (outputFormat === "jpg") {
      // jpg has no alpha channel — without a fill, transparent source pixels
      // encode as black instead of whatever background the user expects.
      const background =
        typeof options.background === "string" ? options.background : "#ffffff";
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    }
    ctx.drawImage(bitmap, 0, 0);

    signal.throwIfAborted();
    onProgress?.(0.9);

    return await encodeCanvas(ctx.canvas, outputFormat, options, onProgress);
  } finally {
    bitmap.close();
  }
}

/** decode: a real format's bytes -> `RasterImage`. */
async function runDecode(task: EngineTask): Promise<EngineResult> {
  const { input, inputFormat, signal, onProgress } = task;
  signal.throwIfAborted();

  if (inputFormat === "ico") {
    return await runDecodeIco(task);
  }

  const blob = inputToBlob(input);

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob, {
      imageOrientation: "from-image",
      premultiplyAlpha: "none",
      colorSpaceConversion: "default",
    });
  } catch (e) {
    throw new EngineError("decode-failed", "failed to decode source image", {
      engine: metadata.id,
      cause: e,
    });
  }

  try {
    onProgress?.(0.3);
    signal.throwIfAborted();

    const ctx = newContext(bitmap.width, bitmap.height);
    ctx.drawImage(bitmap, 0, 0);
    const { data, width, height } = ctx.getImageData(
      0,
      0,
      ctx.canvas.width,
      ctx.canvas.height,
    );

    onProgress?.(1);
    return { kind: "raster", image: { width, height, data } };
  } finally {
    bitmap.close();
  }
}

/**
 * decode: ICO bytes -> `RasterImage`. Parses the ICONDIR to find every
 * embedded size, picks the largest, and decodes just that one entry — a PNG
 * entry (Vista+ format) through the ordinary `createImageBitmap` path, a
 * legacy DIB entry through `decodeIcoDib`'s hand-rolled pixel decode (see
 * that function's doc comment for why `createImageBitmap` can't be reused
 * here: standalone BMP decoders don't know ICO's doubled-height/AND-mask
 * convention).
 */
async function runDecodeIco(task: EngineTask): Promise<EngineResult> {
  const { input, signal, onProgress } = task;

  const blob = inputToBlob(input);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  signal.throwIfAborted();

  const entries = parseIcoDirectory(bytes);
  const chosen = pickLargestIcoEntry(entries);
  const entryBytes = extractIcoEntryBytes(bytes, chosen);
  onProgress?.(0.3);

  if (isPngIcoEntry(entryBytes)) {
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(
        new Blob([new Uint8Array(entryBytes)], { type: "image/png" }),
        { imageOrientation: "from-image", premultiplyAlpha: "none" },
      );
    } catch (e) {
      throw new EngineError(
        "decode-failed",
        "failed to decode ico's embedded png entry",
        { engine: metadata.id, cause: e },
      );
    }
    try {
      const ctx = newContext(bitmap.width, bitmap.height);
      ctx.drawImage(bitmap, 0, 0);
      const { data, width, height } = ctx.getImageData(
        0,
        0,
        ctx.canvas.width,
        ctx.canvas.height,
      );
      onProgress?.(1);
      return { kind: "raster", image: { width, height, data } };
    } finally {
      bitmap.close();
    }
  }

  onProgress?.(1);
  return { kind: "raster", image: decodeIcoDib(entryBytes) };
}

/** encode: `RasterImage` -> a real format's bytes. */
async function runEncode(task: EngineTask): Promise<EngineResult> {
  const { input, outputFormat, options, signal, onProgress } = task;
  signal.throwIfAborted();

  if (outputFormat === "raster") {
    throw new EngineError(
      "internal",
      "canvas encode requires a concrete output format",
      { engine: metadata.id },
    );
  }

  const image = inputToRaster(input);

  // bmp/gif/ico have no browser-native `convertToBlob` support — each is a
  // pure-TS writer instead (`bmp.ts`/`gif.ts`/`ico.ts`), operating on the
  // raster directly rather than through an `OffscreenCanvas`.
  if (outputFormat === "bmp") {
    const bytes = encodeBmp(image);
    onProgress?.(1);
    return {
      kind: "bytes",
      bytes: bytes.buffer as ArrayBuffer,
      mime: FORMATS.bmp.mime,
    };
  }
  if (outputFormat === "gif") {
    const bytes = encodeGif(image);
    onProgress?.(1);
    return {
      kind: "bytes",
      bytes: bytes.buffer as ArrayBuffer,
      mime: FORMATS.gif.mime,
    };
  }
  if (outputFormat === "ico") {
    return await runEncodeIco(image, options, signal, onProgress);
  }

  const ctx = newContext(image.width, image.height);
  const imageData = new ImageData(image.data, image.width, image.height);

  if (outputFormat === "jpg") {
    // jpg has no alpha channel — fill the background first, then composite
    // the raster over it so transparent source pixels blend to the
    // background instead of encoding as black. `putImageData` can't do
    // this: it writes pixels directly, ignoring whatever's already on the
    // canvas, so the raster has to go through an ImageBitmap + drawImage
    // instead, same as runTranscode's fill.
    const background =
      typeof options.background === "string" ? options.background : "#ffffff";
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    const sourceBitmap = await createImageBitmap(imageData);
    try {
      ctx.drawImage(sourceBitmap, 0, 0);
    } finally {
      sourceBitmap.close();
    }
  } else {
    ctx.putImageData(imageData, 0, 0);
  }

  signal.throwIfAborted();
  onProgress?.(0.5);

  return await encodeCanvas(ctx.canvas, outputFormat, options, onProgress);
}

/**
 * encode: `RasterImage` -> ICO, Vista+ format (PNG-compressed entries) at
 * every size in `options.sizes`'s preset (`icoSizesForPreset`). A
 * non-square source is fit inside each size's square, scaled by
 * `computeResizeDims`'s existing "contain" math (the same math `runResize`
 * uses, so this and a plain resize agree on scale), and centered over a
 * transparent background rather than cropped or stretched.
 */
async function runEncodeIco(
  image: RasterImage,
  options: Readonly<Record<string, unknown>>,
  signal: AbortSignal,
  onProgress: ((fraction: number) => void) | undefined,
): Promise<EngineResult> {
  const preset = typeof options.sizes === "string" ? options.sizes : "favicon";
  const sizes = icoSizesForPreset(preset);

  const sourceBitmap = await createImageBitmap(
    new ImageData(image.data, image.width, image.height),
  );
  try {
    const entries: IcoEncodeEntry[] = [];
    for (const size of sizes) {
      signal.throwIfAborted();

      const dims = computeResizeDims(image.width, image.height, {
        width: size,
        height: size,
        fit: "contain",
        allowUpscale: true,
      });
      const offsetX = Math.floor((size - dims.width) / 2);
      const offsetY = Math.floor((size - dims.height) / 2);

      const ctx = newContext(size, size);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      // The canvas starts fully transparent — no fill needed before
      // compositing, unlike jpg's opaque background.
      ctx.drawImage(sourceBitmap, offsetX, offsetY, dims.width, dims.height);

      const pngBlob = await ctx.canvas.convertToBlob({ type: "image/png" });
      const png = new Uint8Array(await pngBlob.arrayBuffer());
      entries.push({ size, png });
      onProgress?.(entries.length / sizes.length);
    }

    const bytes = buildIcoContainer(entries);
    return {
      kind: "bytes",
      bytes: bytes.buffer as ArrayBuffer,
      mime: FORMATS.ico.mime,
    };
  } finally {
    sourceBitmap.close();
  }
}

/** Shared `convertToBlob` + arrayBuffer step for `runTranscode`/`runEncode`. */
async function encodeCanvas(
  canvas: OffscreenCanvas,
  outputFormat: FormatId,
  options: Readonly<Record<string, unknown>>,
  onProgress: ((fraction: number) => void) | undefined,
): Promise<EngineResult> {
  const mime = FORMATS[outputFormat].mime;
  const quality =
    outputFormat === "jpg" || outputFormat === "webp"
      ? clamp01(typeof options.quality === "number" ? options.quality : 0.92)
      : undefined;

  const encoded = await canvas.convertToBlob(
    quality === undefined ? { type: mime } : { type: mime, quality },
  );
  // Browsers silently fall back to PNG for a type they cannot encode (e.g.
  // webp on Safari) rather than rejecting the promise.
  if (encoded.type !== mime) {
    throw new EngineError("encode-failed", `browser cannot encode ${mime}`, {
      engine: metadata.id,
    });
  }

  const bytes = await encoded.arrayBuffer();
  onProgress?.(1);
  return { kind: "bytes", bytes, mime };
}

/** resize: `RasterImage` -> `RasterImage`, scaled per `computeResizeDims`
 * (`../shared/resize-box`, shared with `jsquash-resize` so both engines
 * agree on the output size for the same options). */
async function runResize(task: EngineTask): Promise<EngineResult> {
  const { input, options, signal, onProgress } = task;
  signal.throwIfAborted();

  const image = inputToRaster(input);
  const resizeOpts = parseResizeOptions(options);

  if (resizeOpts.width === undefined && resizeOpts.height === undefined) {
    onProgress?.(1);
    return { kind: "raster", image };
  }

  const dims = computeResizeDims(image.width, image.height, resizeOpts);

  const sourceBitmap = await createImageBitmap(
    new ImageData(image.data, image.width, image.height),
  );
  try {
    signal.throwIfAborted();

    const ctx = newContext(dims.width, dims.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(sourceBitmap, 0, 0, dims.width, dims.height);

    const { data, width, height } = ctx.getImageData(
      0,
      0,
      dims.width,
      dims.height,
    );
    onProgress?.(1);
    return { kind: "raster", image: { width, height, data } };
  } finally {
    sourceBitmap.close();
  }
}

/**
 * rotate: `RasterImage` -> `RasterImage`, rotated clockwise by
 * `options.rotate` degrees (0/90/180/270; anything else passes through
 * unchanged). Accepts a number or a numeric string: a tool's "Rotate"
 * option is a `control: "select"` field, and `describeFields`
 * (`src/lib/options/fields.ts`) requires a `select` field to be a real
 * `z.enum(...)`, which always parses to a string — there's no
 * `.transform()` available that would turn it into a number without also
 * breaking `defineTool`'s defaults-satisfy-options check (input and output
 * types would differ). So rotate tools pass "90"/"180"/"270" as strings, and
 * this coerces before comparing. 90/270 swap width and height.
 */
async function runRotate(task: EngineTask): Promise<EngineResult> {
  const { input, options, signal, onProgress } = task;
  signal.throwIfAborted();

  const image = inputToRaster(input);
  const rotate =
    typeof options.rotate === "string"
      ? Number(options.rotate)
      : options.rotate;
  const angle: 0 | 90 | 180 | 270 =
    rotate === 90 || rotate === 180 || rotate === 270 ? rotate : 0;

  if (angle === 0) {
    onProgress?.(1);
    return { kind: "raster", image };
  }

  const sourceBitmap = await createImageBitmap(
    new ImageData(image.data, image.width, image.height),
  );
  try {
    signal.throwIfAborted();

    const swapped = angle === 90 || angle === 270;
    const outWidth = swapped ? image.height : image.width;
    const outHeight = swapped ? image.width : image.height;

    const ctx = newContext(outWidth, outHeight);
    ctx.translate(outWidth / 2, outHeight / 2);
    ctx.rotate((angle * Math.PI) / 180);
    ctx.drawImage(sourceBitmap, -image.width / 2, -image.height / 2);

    const { data, width, height } = ctx.getImageData(0, 0, outWidth, outHeight);
    onProgress?.(1);
    return { kind: "raster", image: { width, height, data } };
  } finally {
    sourceBitmap.close();
  }
}

interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function isCropRect(v: unknown): v is CropRect {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as CropRect).x === "number" &&
    typeof (v as CropRect).y === "number" &&
    typeof (v as CropRect).width === "number" &&
    typeof (v as CropRect).height === "number"
  );
}

/** crop: `RasterImage` -> `RasterImage`, cut to `options.crop` — clamped to
 * the source bounds. Absent `crop` passes through unchanged. */
async function runCrop(task: EngineTask): Promise<EngineResult> {
  const { input, options, signal, onProgress } = task;
  signal.throwIfAborted();

  const image = inputToRaster(input);
  const rawCrop = options.crop;

  if (!isCropRect(rawCrop)) {
    onProgress?.(1);
    return { kind: "raster", image };
  }

  const x = Math.max(0, Math.min(rawCrop.x, image.width));
  const y = Math.max(0, Math.min(rawCrop.y, image.height));
  const width = Math.max(1, Math.min(rawCrop.width, image.width - x));
  const height = Math.max(1, Math.min(rawCrop.height, image.height - y));

  const ctx = newContext(image.width, image.height);
  ctx.putImageData(new ImageData(image.data, image.width, image.height), 0, 0);

  signal.throwIfAborted();
  const cropped = ctx.getImageData(x, y, width, height);
  onProgress?.(1);
  return {
    kind: "raster",
    image: { width: cropped.width, height: cropped.height, data: cropped.data },
  };
}

function dispose(): void {
  // No engine-owned resources (no wasm heap, no worker) to release.
}

export default defineEngine({
  ...metadata,
  // Checked by check-sizes.ts against built chunks — must be a string
  // literal (see EngineMarker's doc comment in ../types.ts), never computed.
  marker: "localvert-engine:canvas",
  supports,
  load,
});
