import decode, { init as initDecode } from "@jsquash/webp/decode";
import encode, { init as initEncode } from "@jsquash/webp/encode";
import type { Operation, StepFormat } from "@/lib/registry";
import { FORMATS } from "@/lib/registry";
import { defineEngine } from "../define-engine";
import { EngineError, toEngineError } from "../errors";
import { stripWebp } from "../exif/strip";
import { ENGINE_MANIFEST } from "../manifest";
import { searchBestQuality } from "../shared/best-quality-search";
import { computeDownscaleDims } from "../shared/downscale-for-target";
import { downscaleRasterAreaAverage } from "../shared/downscale-raster";
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
 * see the identical cast in `../canvas/adapter.ts`.
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
  version: ENGINE_MANIFEST["jsquash-webp"].version,
} satisfies Pick<
  EngineAdapter,
  "id" | "version" | "license" | "location" | "needsIsolation" | "heavy"
>;

const DECODE_WASM_FILE = "webp_dec.wasm";
const ENCODE_WASM_FILE = "webp_enc.wasm";
const ENCODE_SIMD_WASM_FILE = "webp_enc_simd.wasm";

/**
 * The exact probe `wasm-feature-detect`'s own `simd()` runs (a minimal
 * module using a v128 SIMD opcode), copied here so this adapter can decide
 * *synchronously, before compiling anything* which of the encoder's two
 * prebuilt variants to fetch. `@jsquash/webp/encode`'s own `init()` reruns
 * the identical check internally (via that same package) to pick which JS
 * glue module to load — since both checks run in the same browser, they
 * always agree, so the wasm binary this adapter compiles always matches the
 * glue jSquash ends up using.
 */
const SIMD_PROBE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8,
  0, 65, 0, 253, 15, 253, 98, 11,
]);

function supportsSimd(): boolean {
  try {
    return WebAssembly.validate(SIMD_PROBE);
  } catch {
    return false;
  }
}

function supports(
  op: Operation,
  input: StepFormat,
  output: StepFormat,
): boolean {
  switch (op) {
    case "decode":
      return input === "webp" && output === "raster";
    case "encode":
      return input === "raster" && output === "webp";
    // ADR-0013: compress-webp's single byte-to-byte step (runCompress below)
    // rather than the generic ADR-0007 raster pipeline — see the identical
    // reasoning on jsquash-jpeg's own "compress" case.
    case "compress":
      return input === "webp" && output === "webp";
    default:
      return false;
  }
}

/**
 * Fetches `${baseUrl}${file}` and compiles it without instantiating —
 * the resulting `WebAssembly.Module` is what gets handed to jSquash's
 * `instantiateWasm` override below, so jSquash never performs a fetch of
 * its own (it would otherwise resolve a URL relative to the npm package,
 * which doesn't exist in our build and would violate `connect-src 'self'`
 * even if it did).
 */
async function compileWasm(
  baseUrl: string,
  file: string,
): Promise<WebAssembly.Module> {
  try {
    return await WebAssembly.compileStreaming(fetch(`${baseUrl}${file}`));
  } catch (e) {
    throw new EngineError("load-failed", `failed to compile ${file}`, {
      engine: metadata.id,
      cause: e,
    });
  }
}

/**
 * Emscripten's `Module.instantiateWasm` hook, pointed at an already-compiled
 * `WebAssembly.Module` — mirrors what `@jsquash/webp`'s own (untyped, so not
 * reusable directly — see the call sites below) `initEmscriptenModule`
 * helper does when given a module up front. `WebAssembly.Module` is declared
 * as an empty interface in lib.dom, so handing the callback a real
 * `WebAssembly.Instance` (as Emscripten's actual runtime API expects) still
 * satisfies its declared type.
 */
function instantiateWasmWith(module: WebAssembly.Module) {
  return (
    imports: WebAssembly.Imports,
    successCallback: (instance: WebAssembly.Module) => void,
  ): WebAssembly.Exports => {
    const instance = new WebAssembly.Instance(module, imports);
    successCallback(instance);
    return instance.exports;
  };
}

async function load(ctx: EngineLoadContext): Promise<EngineInstance> {
  const { baseUrl } = ctx;

  // Lazy and memoized per direction: a given pipeline only ever decodes webp
  // (webp -> some other format) or encodes it (some other format -> webp),
  // never both in the same job, so eagerly loading both wasm files here
  // would waste a fetch neither run needs. `.catch` clears the memo on
  // failure — a transient fetch error shouldn't permanently strand this
  // engine instance, matching `engine-host.ts`'s `loadEngine`.
  let decodeReady: Promise<void> | undefined;
  function ensureDecodeReady(): Promise<void> {
    if (!decodeReady) {
      decodeReady = (async () => {
        const module = await compileWasm(baseUrl, DECODE_WASM_FILE);
        await initDecode({ instantiateWasm: instantiateWasmWith(module) });
      })().catch((e: unknown) => {
        decodeReady = undefined;
        throw e;
      });
    }
    return decodeReady;
  }

  let encodeReady: Promise<void> | undefined;
  function ensureEncodeReady(): Promise<void> {
    if (!encodeReady) {
      encodeReady = (async () => {
        const file = supportsSimd() ? ENCODE_SIMD_WASM_FILE : ENCODE_WASM_FILE;
        const module = await compileWasm(baseUrl, file);
        await initEncode({ instantiateWasm: instantiateWasmWith(module) });
      })().catch((e: unknown) => {
        encodeReady = undefined;
        throw e;
      });
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
            `jsquash-webp cannot run op "${task.op}"`,
            { engine: metadata.id },
          );
      }
    } catch (e) {
      throw toEngineError(e, metadata.id);
    }
  }

  function dispose(): void {
    // Emscripten's wasm heap isn't reclaimable from JS once allocated — the
    // worker pool terminates the whole worker to actually free it (see the
    // add-engine skill and docs/ENGINES.md, "Terminate the worker to free
    // the heap"). Nothing for this adapter to do on its own.
  }

  return { run, dispose };
}

/** Reads `task.input` down to an `ArrayBuffer` — the shape `decode` accepts. */
async function inputToBytes(input: EngineInput): Promise<ArrayBuffer> {
  switch (input.kind) {
    case "blob":
      return input.blob.arrayBuffer();
    case "bytes":
      return input.bytes;
    case "opfs":
      throw new EngineError(
        "unsupported",
        "jsquash-webp does not read OPFS inputs",
        { engine: metadata.id },
      );
    case "raster":
      throw new EngineError(
        "internal",
        "jsquash-webp decode expected a bytes/blob input, got a raster",
        { engine: metadata.id },
      );
  }
}

/** Reads `task.input` down to a `RasterImage` — the shape `encode` requires. */
function inputToRaster(input: EngineInput): RasterImage {
  if (input.kind !== "raster") {
    throw new EngineError(
      "internal",
      `jsquash-webp expected a raster input, got "${input.kind}"`,
      { engine: metadata.id },
    );
  }
  return input.image;
}

/** decode: webp bytes -> `RasterImage`. */
async function runDecode(
  task: EngineTask,
  ensureDecodeReady: () => Promise<void>,
): Promise<EngineResult> {
  const { input, signal, onProgress } = task;
  signal.throwIfAborted();

  const bytes = await inputToBytes(input);
  signal.throwIfAborted();
  onProgress?.(0.1);

  await ensureDecodeReady();
  signal.throwIfAborted();
  onProgress?.(0.3);

  let imageData: ImageData;
  try {
    imageData = await decode(bytes);
  } catch (e) {
    throw new EngineError("decode-failed", "failed to decode webp", {
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

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/**
 * encode: `RasterImage` -> webp bytes. `quality` is 0..1 in `EngineTask`
 * options (the option-form convention); jSquash's own scale is 0..100.
 *
 * `options.targetSizeKB` (a positive number) switches to
 * `encodeToTargetSize`, searching `quality` until the output fits that byte
 * budget — skipped when `lossless` is set, since quality has no effect on a
 * lossless encode's size. Without `targetSizeKB`, behaviour is unchanged.
 */
async function runEncode(
  task: EngineTask,
  ensureEncodeReady: () => Promise<void>,
): Promise<EngineResult> {
  const { input, options, signal, onProgress } = task;
  signal.throwIfAborted();

  const image = inputToRaster(input);

  await ensureEncodeReady();
  signal.throwIfAborted();
  onProgress?.(0.3);

  const imageData = new ImageData(image.data, image.width, image.height);
  const lossless = options.lossless === true;

  const encodeAtQuality = async (quality: number): Promise<ArrayBuffer> => {
    try {
      return await encode(imageData, {
        quality: Math.round(clamp01(quality) * 100),
        lossless: lossless ? 1 : 0,
      });
    } catch (e) {
      throw new EngineError("encode-failed", "failed to encode webp", {
        engine: metadata.id,
        cause: e,
      });
    }
  };

  const targetSizeKB = options.targetSizeKB;
  let bytes: ArrayBuffer;
  if (!lossless && typeof targetSizeKB === "number" && targetSizeKB > 0) {
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
    const quality =
      typeof options.quality === "number" ? options.quality : 0.92;
    bytes = await encodeAtQuality(quality);
  }

  onProgress?.(1);
  return { kind: "bytes", bytes, mime: FORMATS.webp.mime };
}

type CompressMode =
  | "lossless"
  | "visually-lossless"
  | "strong"
  | "custom"
  | "target-size"
  | "percent";

/** ADR-0017: SSIM thresholds for the two perceptual-search modes — see the
 * identical constant on `jsquash-jpeg`'s own adapter. */
const SSIM_THRESHOLD_BY_MODE: Record<"visually-lossless" | "strong", number> = {
  "visually-lossless": 0.9999,
  strong: 0.999,
};

/** ADR-0017: integer quality search floor. WebP has no equivalent of
 * `estimateJpegQuality` (no standard quantization-table read for VP8's own
 * encode), so the ceiling is always 95, unlike jsquash-jpeg's
 * source-quality-capped ceiling. */
const BEST_QUALITY_SEARCH_MIN = 40;
const BEST_QUALITY_SEARCH_MAX = 95;

/** ADR-0017: target-size/percent search floor (as a 0..1 fraction — WebP
 * quality 30 out of 100). Below this, a downscale round runs instead of
 * pushing quality any lower. */
const TARGET_SIZE_QUALITY_FLOOR = 0.3;

/** At least how many resize rounds ADR-0017 allows when quality alone can't
 * reach a target size. */
const MAX_DOWNSCALE_ROUNDS = 2;

/**
 * ADR-0017's WebP encoder settings: `method: 6` (libwebp's slowest,
 * best-compression search — jSquash's own default is 4) always, and
 * `use_sharp_yuv` for graphics/text (sharper chroma upsampling matters most
 * on hard edges; a photo's soft gradients don't show the difference enough
 * to pay the extra encode cost for).
 */
function webpOptionsFor(kind: "photo" | "graphic") {
  return { method: 6, use_sharp_yuv: kind === "graphic" ? 1 : 0 };
}

/**
 * compress (webp -> webp, ADR-0013/0017): a single byte-to-byte step, not
 * the generic ADR-0007 raster pipeline — `mode: "lossless"` is a metadata
 * strip only (the `exif` engine's `stripWebp`), *not* this adapter's own
 * `encode`-level `lossless: true` flag — re-encoding an already-lossy WebP
 * losslessly re-derives every pixel exactly, which produces a *bigger* file
 * than the lossy source on the common case (a photo), the opposite of what
 * a compress tool promises.
 *
 * `visually-lossless`/`strong` run `searchBestQuality` (SSIM-thresholded,
 * ADR-0017) instead of a fixed quality number. `target-size`/`percent` run
 * `encodeToTargetSize` (log-size interpolation) with the same downscale
 * fallback as jsquash-jpeg's own adapter — see that file's identical logic
 * and `downscale-raster.ts`'s doc comment for why it's an area-average
 * resize rather than libwebp's own `target_size` option (ADR-0017 allows
 * trying libwebp's native target size first if a browser test shows it's
 * accurate; that verification wasn't done in this slice, so the shared
 * search is used unconditionally here — see the implementer's report).
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
  onProgress?.(0.1);

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
      stripped = stripWebp(new Uint8Array(originalBytes)).buffer as ArrayBuffer;
    } catch (e) {
      throw new EngineError("decode-failed", "failed to strip webp metadata", {
        engine: metadata.id,
        cause: e,
      });
    }
    onProgress?.(1);
    const picked = neverLarger(originalBytes, stripped);
    return {
      kind: "bytes",
      bytes: picked.bytes,
      mime: FORMATS.webp.mime,
      ...(picked.note ? { note: picked.note } : {}),
    };
  }

  await ensureDecodeReady();
  signal.throwIfAborted();
  onProgress?.(0.25);

  let decoded: ImageData;
  try {
    decoded = await decode(originalBytes);
  } catch (e) {
    throw new EngineError("decode-failed", "failed to decode webp", {
      engine: metadata.id,
      cause: e,
    });
  }
  signal.throwIfAborted();
  onProgress?.(0.4);

  const original: RasterImage = {
    width: decoded.width,
    height: decoded.height,
    data: decoded.data,
  };

  await ensureEncodeReady();
  signal.throwIfAborted();
  onProgress?.(0.5);

  const imageKind = classifyImageKind(original);

  /** Encodes `raster` at fractional quality `quality` (0..1), with the
   * ADR-0017 encoder settings applied. */
  const encodeRasterAtQuality = async (
    raster: RasterImage,
    quality: number,
  ): Promise<ArrayBuffer> => {
    try {
      const imageData = new ImageData(raster.data, raster.width, raster.height);
      return await encode(imageData, {
        quality: Math.round(clamp01(quality) * 100),
        lossless: 0,
        ...webpOptionsFor(imageKind),
      });
    } catch (e) {
      throw new EngineError("encode-failed", "failed to encode webp", {
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

    let raster = original;
    let resizedTo: { width: number; height: number } | undefined;
    let iteration = 0;
    let searchResult = await encodeToTargetSize(
      async (q) => {
        const out = await encodeRasterAtQuality(raster, q);
        iteration += 1;
        onProgress?.(0.5 + 0.4 * Math.min(iteration / 8, 1));
        return out;
      },
      targetBytes,
      { min: TARGET_SIZE_QUALITY_FLOOR, max: 0.95, signal },
    );

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
          const out = await encodeRasterAtQuality(raster, q);
          iteration += 1;
          onProgress?.(0.5 + 0.4 * Math.min(iteration / 8, 1));
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
      atBestQuality: !resizedTo && searchResult.atCeiling,
    });
  } else if (mode === "visually-lossless" || mode === "strong") {
    let iteration = 0;
    const searchResult = await searchBestQuality(
      original,
      async (qualityInt) => {
        const out = await encodeRasterAtQuality(original, qualityInt / 100);
        iteration += 1;
        onProgress?.(0.5 + 0.4 * Math.min(iteration / 6, 1));
        return out;
      },
      async (bytes) => {
        const id = await decode(bytes);
        return { width: id.width, height: id.height, data: id.data };
      },
      (a, b) => ssim(a, b),
      {
        min: BEST_QUALITY_SEARCH_MIN,
        max: BEST_QUALITY_SEARCH_MAX,
        threshold: SSIM_THRESHOLD_BY_MODE[mode],
        signal,
      },
    );
    encoded = searchResult.bytes;
  } else {
    // custom
    const quality =
      typeof options.quality === "number" ? options.quality : 0.75;
    encoded = await encodeRasterAtQuality(original, quality);
  }
  onProgress?.(0.9);

  let strippedOriginal: ArrayBuffer;
  try {
    strippedOriginal = stripWebp(new Uint8Array(originalBytes))
      .buffer as ArrayBuffer;
  } catch {
    // Malformed input would already have failed the decode above.
    strippedOriginal = originalBytes;
  }

  const picked = neverLarger(
    strippedOriginal,
    encoded,
    "This WebP was already about as small as it gets at this quality — " +
      "kept the original (with metadata removed).",
  );

  onProgress?.(1);
  return {
    kind: "bytes",
    bytes: picked.bytes,
    mime: FORMATS.webp.mime,
    ...(picked.note
      ? { note: picked.note }
      : resultNote
        ? { note: resultNote }
        : {}),
  };
}

export default defineEngine({
  ...metadata,
  // Checked by check-sizes.ts against built chunks — must be a string
  // literal (see EngineMarker's doc comment in ../types.ts), never computed.
  marker: "localvert-engine:jsquash-webp",
  supports,
  load,
});
