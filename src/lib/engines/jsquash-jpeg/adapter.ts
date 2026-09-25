import decodeJpeg, { init as initJpegDecode } from "@jsquash/jpeg/decode";
import encodeJpeg, { init as initJpegEncode } from "@jsquash/jpeg/encode";
import type { EncodeOptions } from "@jsquash/jpeg/meta";
import type { Operation, StepFormat } from "@/lib/registry";
import { FORMATS } from "@/lib/registry";
import { defineEngine } from "../define-engine";
import { EngineError, toEngineError } from "../errors";
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

/**
 * `engine.json` is the single source of truth for this adapter's metadata —
 * see the identical cast/comment in `../canvas/adapter.ts`.
 */
const metadata = meta as Pick<
  EngineAdapter,
  "id" | "version" | "license" | "location" | "needsIsolation" | "heavy"
>;

function supports(
  op: Operation,
  input: StepFormat,
  output: StepFormat,
): boolean {
  switch (op) {
    case "decode":
      return input === "jpg" && output === "raster";
    case "encode":
      return input === "raster" && output === "jpg";
    default:
      return false;
  }
}

/** Reads `task.input` down to the `ArrayBuffer` jSquash's `decode` wants. */
async function inputToBytes(input: EngineInput): Promise<ArrayBuffer> {
  switch (input.kind) {
    case "blob":
      return input.blob.arrayBuffer();
    case "bytes":
      return input.bytes;
    case "opfs":
      throw new EngineError(
        "unsupported",
        "jsquash-jpeg does not read OPFS inputs",
        { engine: metadata.id },
      );
    case "raster":
      throw new EngineError(
        "internal",
        "jsquash-jpeg decode expected a bytes/blob input, got a raster",
        { engine: metadata.id },
      );
  }
}

/** Reads `task.input` down to the `RasterImage` `encode` requires. */
function inputToRaster(input: EngineInput): RasterImage {
  if (input.kind !== "raster") {
    throw new EngineError(
      "internal",
      `jsquash-jpeg encode expected a raster input, got "${input.kind}"`,
      { engine: metadata.id },
    );
  }
  return input.image;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/**
 * Parses a CSS hex color (`#rgb` or `#rrggbb`) to 0..255 RGB channels,
 * defaulting to white for anything else — same default as the canvas
 * adapter's background fill (`../canvas/adapter.ts`).
 */
function parseHexColor(color: unknown): readonly [number, number, number] {
  const match =
    typeof color === "string"
      ? color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
      : null;
  if (!match) return [255, 255, 255];

  const digits = match[1];
  if (digits === undefined) return [255, 255, 255];
  if (digits.length === 3) {
    const r = digits.charAt(0);
    const g = digits.charAt(1);
    const b = digits.charAt(2);
    return [
      Number.parseInt(r + r, 16),
      Number.parseInt(g + g, 16),
      Number.parseInt(b + b, 16),
    ];
  }
  return [
    Number.parseInt(digits.slice(0, 2), 16),
    Number.parseInt(digits.slice(2, 4), 16),
    Number.parseInt(digits.slice(4, 6), 16),
  ];
}

/**
 * jpg has no alpha channel — mozjpeg's encoder ignores `data[3]` entirely, so
 * an un-composited transparent pixel encodes with whatever garbage/black is
 * sitting in its RGB channels instead of blending to a background the way
 * the canvas adapter's jpg encode does (`../canvas/adapter.ts`'s `runEncode`,
 * which fills the canvas with `options.background` before compositing).
 * Returns a new `RasterImage` — the source raster may still be read by other
 * steps, so this doesn't mutate it in place.
 */
function compositeOverBackground(
  image: RasterImage,
  background: unknown,
): RasterImage {
  const [bgR, bgG, bgB] = parseHexColor(background);
  const src = image.data;
  const out = new Uint8ClampedArray(src.length);
  for (let i = 0; i < src.length; i += 4) {
    const alpha = (src[i + 3] ?? 0) / 255;
    out[i] = (src[i] ?? 0) * alpha + bgR * (1 - alpha);
    out[i + 1] = (src[i + 1] ?? 0) * alpha + bgG * (1 - alpha);
    out[i + 2] = (src[i + 2] ?? 0) * alpha + bgB * (1 - alpha);
    out[i + 3] = 255;
  }
  return { width: image.width, height: image.height, data: out };
}

/**
 * decode: jpg bytes -> `RasterImage`. `ensureDecodeReady` compiles and
 * initialises the mozjpeg decoder wasm exactly once per `load()`-ed
 * instance — see `load` below.
 */
async function runDecode(
  task: EngineTask,
  ensureDecodeReady: () => Promise<void>,
): Promise<EngineResult> {
  const { input, inputFormat, signal, onProgress } = task;
  signal.throwIfAborted();

  if (inputFormat !== "jpg") {
    throw new EngineError(
      "internal",
      `jsquash-jpeg decode expects a jpg input, got "${inputFormat}"`,
      { engine: metadata.id },
    );
  }

  const bytes = await inputToBytes(input);
  await ensureDecodeReady();
  signal.throwIfAborted();
  onProgress?.(0.3);

  let imageData: ImageData;
  try {
    imageData = await decodeJpeg(bytes);
  } catch (e) {
    throw new EngineError("decode-failed", "failed to decode jpeg", {
      engine: metadata.id,
      cause: e,
    });
  }

  onProgress?.(1);
  return {
    kind: "raster",
    image: {
      width: imageData.width,
      height: imageData.height,
      data: imageData.data,
    },
  };
}

/**
 * encode: `RasterImage` -> jpg bytes. `options.quality` is 0..1 on our side
 * (mozjpeg wants 0..100); `options.progressive` defaults true regardless of
 * jSquash's own default, so this adapter's contract doesn't drift if
 * upstream ever changes theirs.
 */
async function runEncode(
  task: EngineTask,
  ensureEncodeReady: () => Promise<void>,
): Promise<EngineResult> {
  const { input, outputFormat, options, signal, onProgress } = task;
  signal.throwIfAborted();

  if (outputFormat !== "jpg") {
    throw new EngineError(
      "internal",
      `jsquash-jpeg encode expects a jpg output, got "${outputFormat}"`,
      { engine: metadata.id },
    );
  }

  const image = compositeOverBackground(
    inputToRaster(input),
    options.background,
  );
  await ensureEncodeReady();
  signal.throwIfAborted();
  onProgress?.(0.3);

  const imageData = new ImageData(image.data, image.width, image.height);
  const encodeOptions: Partial<EncodeOptions> = {
    progressive: options.progressive !== false,
  };
  if (typeof options.quality === "number") {
    encodeOptions.quality = Math.round(clamp01(options.quality) * 100);
  }

  let bytes: ArrayBuffer;
  try {
    bytes = await encodeJpeg(imageData, encodeOptions);
  } catch (e) {
    throw new EngineError("encode-failed", "failed to encode jpeg", {
      engine: metadata.id,
      cause: e,
    });
  }

  onProgress?.(1);
  return { kind: "bytes", bytes, mime: FORMATS.jpg.mime };
}

/**
 * Compiles `<baseUrl>mozjpeg_dec.wasm`/`mozjpeg_enc.wasm` and hands the
 * resulting `WebAssembly.Module` to jSquash's own `init` — never letting
 * jSquash fetch from its own default (CDN-relative) URL, which
 * `connect-src 'self'` would block anyway. Decode and encode are separate
 * wasm binaries, so each gets its own lazily-initialised, memoised promise;
 * a step that only decodes (or only encodes) never pays for the other.
 */
async function load(ctx: EngineLoadContext): Promise<EngineInstance> {
  if (typeof WebAssembly.compileStreaming !== "function") {
    throw new EngineError(
      "unsupported",
      "WebAssembly.compileStreaming is not available",
      { engine: metadata.id },
    );
  }

  const { baseUrl } = ctx;
  let decodeReady: Promise<void> | undefined;
  let encodeReady: Promise<void> | undefined;

  function ensureDecodeReady(): Promise<void> {
    if (!decodeReady) {
      decodeReady = (async () => {
        const module = await WebAssembly.compileStreaming(
          fetch(`${baseUrl}mozjpeg_dec.wasm`),
        );
        await initJpegDecode(module);
      })();
    }
    return decodeReady;
  }

  function ensureEncodeReady(): Promise<void> {
    if (!encodeReady) {
      encodeReady = (async () => {
        const module = await WebAssembly.compileStreaming(
          fetch(`${baseUrl}mozjpeg_enc.wasm`),
        );
        await initJpegEncode(module);
      })();
    }
    return encodeReady;
  }

  async function run(task: EngineTask): Promise<EngineResult> {
    try {
      switch (task.op) {
        case "decode":
          return await runDecode(task, ensureDecodeReady);
        case "encode":
          return await runEncode(task, ensureEncodeReady);
        default:
          throw new EngineError(
            "unsupported",
            `jsquash-jpeg cannot run op "${task.op}"`,
            { engine: metadata.id },
          );
      }
    } catch (e) {
      throw toEngineError(e, metadata.id);
    }
  }

  function dispose(): void {
    // Drops the cached module promises so they (and the wasm instances they
    // resolved to) can be garbage collected. This does not reclaim the wasm
    // heap itself — Emscripten never frees it — so heap reclaim still
    // requires terminating the worker that hosts this instance (docs/
    // ENGINES.md, "Terminate the worker to free the heap").
    decodeReady = undefined;
    encodeReady = undefined;
  }

  return { run, dispose };
}

export default defineEngine({
  ...metadata,
  // Checked by check-sizes.ts against built chunks — must be a string
  // literal (see EngineMarker's doc comment in ../types.ts), never computed.
  marker: "localvert-engine:jsquash-jpeg",
  supports,
  load,
});
