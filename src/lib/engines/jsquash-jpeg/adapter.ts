import decodeJpeg, { init as initJpegDecode } from "@jsquash/jpeg/decode";
import encodeJpeg, { init as initJpegEncode } from "@jsquash/jpeg/encode";
import type { EncodeOptions } from "@jsquash/jpeg/meta";
import type { Operation, StepFormat } from "@/lib/registry";
import { FORMATS } from "@/lib/registry";
import { defineEngine } from "../define-engine";
import { EngineError, toEngineError } from "../errors";
import { stripJpeg } from "../exif/strip";
import { ENGINE_MANIFEST } from "../manifest";
import { searchBestQuality } from "../shared/best-quality-search";
import { computeDownscaleDims } from "../shared/downscale-for-target";
import { downscaleRasterAreaAverage } from "../shared/downscale-raster";
import { estimateJpegQuality } from "../shared/jpeg-quality";
import { neverLarger } from "../shared/never-larger";
import { classifyImageKind } from "../shared/photo-or-graphic";
import { percentToTargetBytes } from "../shared/reduce-percent";
import { ssim } from "../shared/ssim";
import { encodeToTargetSize } from "../shared/target-size";
import { formatTargetSizeNote } from "../shared/target-size-note";
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
 * option) switches to `encodeToTargetSize`: it searches `quality` instead of
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
  | "target-size"
  | "percent";

/** ADR-0017: SSIM thresholds for the two perceptual-search modes. "High
 * quality" (this tool's default, `visually-lossless`) requires the encode to
 * be visually indistinguishable from the source; "Smaller" (`strong`) trades
 * a little more, still-not-obviously-visible quality for a smaller file. */
const SSIM_THRESHOLD_BY_MODE: Record<"visually-lossless" | "strong", number> = {
  "visually-lossless": 0.9999,
  strong: 0.999,
};

/** ADR-0017: integer quality search floor for the perceptual search — never
 * go below 40, regardless of how low the source's own quality estimate (or
 * the SSIM threshold) would otherwise allow. */
const BEST_QUALITY_SEARCH_MIN = 40;

/** ADR-0017: target-size/percent search floor. Below this, the ADR calls
 * for a downscale round instead of pushing quality any lower. */
const TARGET_SIZE_QUALITY_FLOOR = 0.3;

/** At least how many resize rounds ADR-0017 allows when quality alone can't
 * reach a target size. */
const MAX_DOWNSCALE_ROUNDS = 2;

/**
 * ADR-0017's mozjpeg chroma-subsampling heuristic: 4:2:0 (`chroma_subsample:
 * 2`) for photos, 4:4:4 (`chroma_subsample: 1`) for graphics/text or once
 * quality reaches 90+ (subsampling savings aren't worth it at that quality
 * anyway). `auto_subsample: false` is required alongside this — mozjpeg's
 * own `auto_subsample: true` default silently ignores `chroma_subsample` and
 * picks a subsampling itself based on quality, which would make this
 * heuristic a no-op.
 */
function chromaOptionsFor(
  kind: "photo" | "graphic",
  qualityInt: number,
): Partial<EncodeOptions> {
  const fullChroma = kind === "graphic" || qualityInt >= 90;
  return { auto_subsample: false, chroma_subsample: fullChroma ? 1 : 2 };
}

/**
 * compress (jpg -> jpg, ADR-0013/0017): a single byte-to-byte step, not the
 * generic ADR-0007 raster pipeline — `mode: "lossless"` never even touches
 * the wasm decoder/encoder (a pure metadata strip only), and every other
 * mode's never-larger check needs the exact original input bytes alongside
 * its own final result, which a two-step decode/encode handoff can't give
 * it.
 *
 * `visually-lossless`/`strong` run `searchBestQuality` (SSIM-thresholded
 * bisection, ADR-0017) instead of a fixed quality number.
 * `target-size`/`percent` run `encodeToTargetSize` (log-size interpolation)
 * and, if quality alone can't reach the target even at the search floor,
 * fall back to up to `MAX_DOWNSCALE_ROUNDS` resize rounds.
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
    options.mode === "target-size" ||
    options.mode === "percent"
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

  await ensureEncodeReady();
  signal.throwIfAborted();
  onProgress?.(0.45);

  const progressive = options.progressive !== false;
  const imageKind = classifyImageKind(composited);

  /** Encodes `raster` at integer mozjpeg quality `qualityInt` (0-100), with
   * the chroma heuristic applied. */
  const encodeRasterAtQuality = async (
    raster: RasterImage,
    qualityInt: number,
  ): Promise<ArrayBuffer> => {
    try {
      const imageData = new ImageData(raster.data, raster.width, raster.height);
      return await encodeJpeg(imageData, {
        progressive,
        quality: qualityInt,
        ...chromaOptionsFor(imageKind, qualityInt),
      });
    } catch (e) {
      throw new EngineError("encode-failed", "failed to encode jpeg", {
        engine: metadata.id,
        cause: e,
      });
    }
  };

  let encoded: ArrayBuffer;
  let resultNote: string | undefined;

  if (mode === "target-size" || mode === "percent") {
    const targetSizeKB = options.targetSizeKB;
    const targetBytes =
      mode === "percent"
        ? percentToTargetBytes(
            originalBytes.byteLength,
            typeof options.percent === "number" ? options.percent : 50,
          )
        : typeof targetSizeKB === "number" && targetSizeKB > 0
          ? targetSizeKB * 1024
          : undefined;

    if (targetBytes === undefined) {
      throw new EngineError(
        "internal",
        "target-size mode requires a positive targetSizeKB",
        { engine: metadata.id },
      );
    }

    let raster = composited;
    let resizedTo: { width: number; height: number } | undefined;
    let iteration = 0;
    let searchResult = await encodeToTargetSize(
      async (q) => {
        const out = await encodeRasterAtQuality(
          raster,
          Math.round(clamp01(q) * 100),
        );
        iteration += 1;
        onProgress?.(0.45 + 0.4 * Math.min(iteration / 8, 1));
        return out;
      },
      targetBytes,
      { min: TARGET_SIZE_QUALITY_FLOOR, max: 0.95, signal },
    );

    // ADR-0017: quality alone hit its floor and still overshoots — try
    // shrinking the raster instead, up to MAX_DOWNSCALE_ROUNDS times.
    for (
      let round = 0;
      round < MAX_DOWNSCALE_ROUNDS &&
      !searchResult.hitTarget &&
      searchResult.quality <= TARGET_SIZE_QUALITY_FLOOR + 1e-9;
      round++
    ) {
      const dims = computeDownscaleDims(
        raster.width,
        raster.height,
        searchResult.bytes.byteLength,
        targetBytes,
      );
      if (dims.width >= raster.width && dims.height >= raster.height) break;

      raster = downscaleRasterAreaAverage(raster, dims.width, dims.height);
      resizedTo = { width: raster.width, height: raster.height };

      searchResult = await encodeToTargetSize(
        async (q) => {
          const out = await encodeRasterAtQuality(
            raster,
            Math.round(clamp01(q) * 100),
          );
          iteration += 1;
          onProgress?.(0.45 + 0.4 * Math.min(iteration / 8, 1));
          return out;
        },
        targetBytes,
        { min: TARGET_SIZE_QUALITY_FLOOR, max: 0.95, signal },
      );
    }

    encoded = searchResult.bytes;
    resultNote = formatTargetSizeNote({
      achievedBytes: encoded.byteLength,
      targetBytes,
      hitTarget: searchResult.hitTarget,
      resizedTo,
      // Only meaningful when no downscale round ran (`resizedTo` is what
      // formatTargetSizeNote checks first) — a downscale round means the
      // ceiling alone wasn't the end of the story.
      atBestQuality: !resizedTo && searchResult.atCeiling,
    });
  } else if (mode === "visually-lossless" || mode === "strong") {
    const sourceQuality = estimateJpegQuality(new Uint8Array(originalBytes));
    const maxQuality = Math.min(95, sourceQuality ?? 95);
    const minQuality = Math.min(BEST_QUALITY_SEARCH_MIN, maxQuality);

    let iteration = 0;
    const searchResult = await searchBestQuality(
      composited,
      async (qualityInt) => {
        const out = await encodeRasterAtQuality(composited, qualityInt);
        iteration += 1;
        onProgress?.(0.45 + 0.4 * Math.min(iteration / 6, 1));
        return out;
      },
      async (bytes) => {
        const id = await decodeJpeg(bytes);
        return { width: id.width, height: id.height, data: id.data };
      },
      (a, b) => ssim(a, b),
      {
        min: minQuality,
        max: maxQuality,
        threshold: SSIM_THRESHOLD_BY_MODE[mode],
        signal,
      },
    );
    encoded = searchResult.bytes;
  } else {
    // custom
    const quality =
      typeof options.quality === "number" ? options.quality : 0.75;
    encoded = await encodeRasterAtQuality(
      composited,
      Math.round(clamp01(quality) * 100),
    );
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
    "This JPG was already about as small as it gets at this quality. You " +
      "got the original back, with metadata removed.",
  );

  onProgress?.(1);
  return {
    kind: "bytes",
    bytes: picked.bytes,
    mime: FORMATS.jpg.mime,
    ...(picked.note
      ? { note: picked.note }
      : resultNote
        ? { note: resultNote }
        : {}),
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
