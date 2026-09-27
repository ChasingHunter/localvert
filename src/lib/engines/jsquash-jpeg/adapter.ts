import decodeJpeg, { init as initJpegDecode } from "@jsquash/jpeg/decode";
import encodeJpeg, { init as initJpegEncode } from "@jsquash/jpeg/encode";
import type { EncodeOptions } from "@jsquash/jpeg/meta";
import type { Operation, StepFormat } from "@/lib/registry";
import { FORMATS } from "@/lib/registry";
import { defineEngine } from "../define-engine";
import { EngineError, toEngineError } from "../errors";
import { stripJpeg } from "../exif/strip";
import { ENGINE_MANIFEST } from "../manifest";
import { neverLarger } from "../shared/never-larger";
import { encodeToTargetSize } from "../shared/target-size";
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
const metadata = {
  ...(meta as Pick<
    EngineAdapter,
    "id" | "license" | "location" | "needsIsolation" | "heavy"
  >),
  // engine.json has no "version" for this engine (derived from its
  // installed npm package) -- pnpm gen resolves the real value into
  // manifest.ts, which this reads at build time. See docs/ENGINES.md,
  // "How engine assets ship".
  version: ENGINE_MANIFEST["jsquash-jpeg"].version,
} satisfies Pick<
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
    // ADR-0013: compress-jpg's single byte-to-byte step (runCompress below)
    // rather than the generic ADR-0007 raster pipeline — mode "lossless"
    // never even touches the wasm decoder/encoder (byte-level strip only),
    // and every mode's never-larger check needs the exact original input
    // bytes alongside the final result, which a two-step decode/encode
    // pipeline can't give it.
    case "compress":
      return input === "jpg" && output === "jpg";
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
 *
 * `options.targetSizeKB` (a positive number, from a tool's "Target size"
 * option) switches to `encodeToTargetSize`: it bisects `quality` instead of
 * using `options.quality` directly, re-encoding until the output fits that
 * byte budget. Without it, behaviour is unchanged from before target-size
 * support existed.
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
  const progressive = options.progressive !== false;

  const encodeAtQuality = async (quality: number): Promise<ArrayBuffer> => {
    try {
      return await encodeJpeg(imageData, {
        progressive,
        quality: Math.round(clamp01(quality) * 100),
      });
    } catch (e) {
      throw new EngineError("encode-failed", "failed to encode jpeg", {
        engine: metadata.id,
        cause: e,
      });
    }
  };

  const targetSizeKB = options.targetSizeKB;
  let bytes: ArrayBuffer;
  if (typeof targetSizeKB === "number" && targetSizeKB > 0) {
    let iteration = 0;
    const result = await encodeToTargetSize(
      async (quality) => {
        const out = await encodeAtQuality(quality);
        iteration += 1;
        onProgress?.(0.3 + 0.6 * Math.min(iteration / 8, 1));
        return out;
      },
      targetSizeKB * 1024,
      { signal },
    );
    bytes = result.bytes;
  } else {
    const encodeOptions: Partial<EncodeOptions> = { progressive };
    if (typeof options.quality === "number") {
      encodeOptions.quality = Math.round(clamp01(options.quality) * 100);
    }
    try {
      bytes = await encodeJpeg(imageData, encodeOptions);
    } catch (e) {
      throw new EngineError("encode-failed", "failed to encode jpeg", {
        engine: metadata.id,
        cause: e,
      });
    }
  }

  onProgress?.(1);
  return { kind: "bytes", bytes, mime: FORMATS.jpg.mime };
}

type CompressMode =
  | "lossless"
  | "visually-lossless"
  | "strong"
  | "custom"
  | "target-size";

/**
 * Fixed quality per non-custom, non-target-size mode (ADR-0013):
 * `visually-lossless` (this tool's actual default) is mozjpeg's own
 * commonly-cited "artifacts start being visible on typical photos at normal
 * viewing distance" threshold; `strong` is a real, visibly-lossy size win.
 */
const QUALITY_BY_MODE: Record<"visually-lossless" | "strong", number> = {
  "visually-lossless": 0.85,
  strong: 0.6,
};

/**
 * compress (jpg -> jpg, ADR-0013): a single byte-to-byte step, not the
 * generic ADR-0007 raster pipeline — `mode: "lossless"` never touches the
 * wasm decoder/encoder at all (a pure metadata strip via the `exif` engine's
 * `stripJpeg`, reused directly), and every other mode's never-larger check
 * needs the exact original input bytes alongside its own final result, which
 * a two-step decode/encode handoff can't give it.
 */
async function runCompress(
  task: EngineTask,
  ensureDecodeReady: () => Promise<void>,
  ensureEncodeReady: () => Promise<void>,
): Promise<EngineResult> {
  const { input, options, signal, onProgress } = task;
  signal.throwIfAborted();

  const originalBytes = await inputToBytes(input);
  signal.throwIfAborted();

  const mode: CompressMode =
    options.mode === "visually-lossless" ||
    options.mode === "strong" ||
    options.mode === "custom" ||
    options.mode === "target-size"
      ? options.mode
      : "lossless";

  if (mode === "lossless") {
    let stripped: ArrayBuffer;
    try {
      stripped = stripJpeg(new Uint8Array(originalBytes)).buffer as ArrayBuffer;
    } catch (e) {
      throw new EngineError("decode-failed", "failed to strip jpeg metadata", {
        engine: metadata.id,
        cause: e,
      });
    }
    onProgress?.(1);
    const picked = neverLarger(originalBytes, stripped);
    return {
      kind: "bytes",
      bytes: picked.bytes,
      mime: FORMATS.jpg.mime,
      ...(picked.note ? { note: picked.note } : {}),
    };
  }

  await ensureDecodeReady();
  signal.throwIfAborted();
  onProgress?.(0.15);

  let decoded: ImageData;
  try {
    decoded = await decodeJpeg(originalBytes);
  } catch (e) {
    throw new EngineError("decode-failed", "failed to decode jpeg", {
      engine: metadata.id,
      cause: e,
    });
  }
  signal.throwIfAborted();
  onProgress?.(0.3);

  const composited = compositeOverBackground(
    { width: decoded.width, height: decoded.height, data: decoded.data },
    options.background,
  );
  const imageData = new ImageData(
    composited.data,
    composited.width,
    composited.height,
  );

  await ensureEncodeReady();
  signal.throwIfAborted();
  onProgress?.(0.45);

  const progressive = options.progressive !== false;
  const encodeAtQuality = async (quality: number): Promise<ArrayBuffer> => {
    try {
      return await encodeJpeg(imageData, {
        progressive,
        quality: Math.round(clamp01(quality) * 100),
      });
    } catch (e) {
      throw new EngineError("encode-failed", "failed to encode jpeg", {
        engine: metadata.id,
        cause: e,
      });
    }
  };

  let encoded: ArrayBuffer;
  if (mode === "target-size") {
    const targetSizeKB = options.targetSizeKB;
    if (typeof targetSizeKB !== "number" || targetSizeKB <= 0) {
      throw new EngineError(
        "internal",
        "target-size mode requires a positive targetSizeKB",
        { engine: metadata.id },
      );
    }
    let iteration = 0;
    const result = await encodeToTargetSize(
      async (quality) => {
        const out = await encodeAtQuality(quality);
        iteration += 1;
        onProgress?.(0.45 + 0.4 * Math.min(iteration / 8, 1));
        return out;
      },
      targetSizeKB * 1024,
      { signal },
    );
    encoded = result.bytes;
  } else {
    const quality =
      mode === "custom"
        ? typeof options.quality === "number"
          ? options.quality
          : 0.75
        : QUALITY_BY_MODE[mode];
    encoded = await encodeAtQuality(quality);
  }
  onProgress?.(0.9);

  let strippedOriginal: ArrayBuffer;
  try {
    strippedOriginal = stripJpeg(new Uint8Array(originalBytes))
      .buffer as ArrayBuffer;
  } catch {
    // Malformed input would already have failed the decode above.
    strippedOriginal = originalBytes;
  }

  const picked = neverLarger(
    strippedOriginal,
    encoded,
    "This JPG was already about as small as it gets at this quality — kept " +
      "the original (with metadata removed).",
  );

  onProgress?.(1);
  return {
    kind: "bytes",
    bytes: picked.bytes,
    mime: FORMATS.jpg.mime,
    ...(picked.note ? { note: picked.note } : {}),
  };
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
        case "compress":
          return await runCompress(task, ensureDecodeReady, ensureEncodeReady);
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
