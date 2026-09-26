import decodeAvif, { init as initAvifDecode } from "@jsquash/avif/decode";
import type { EncodeOptions } from "@jsquash/avif/meta";
import { defaultOptions } from "@jsquash/avif/meta";
import type { Operation, StepFormat } from "@/lib/registry";
import { FORMATS } from "@/lib/registry";
import { defineEngine } from "../define-engine";
import { EngineError, toEngineError } from "../errors";
import { ENGINE_MANIFEST } from "../manifest";
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
  version: ENGINE_MANIFEST["jsquash-avif"].version,
} satisfies Pick<
  EngineAdapter,
  "id" | "version" | "license" | "location" | "needsIsolation" | "heavy"
>;

const DECODE_WASM_FILE = "avif_dec.wasm";
const ENCODE_WASM_FILE = "avif_enc.wasm";

function supports(
  op: Operation,
  input: StepFormat,
  output: StepFormat,
): boolean {
  switch (op) {
    case "decode":
      return input === "avif" && output === "raster";
    case "encode":
      return input === "raster" && output === "avif";
    default:
      return false;
  }
}

/**
 * Fetches `${baseUrl}${file}` and compiles it without instantiating — the
 * resulting `WebAssembly.Module` is what gets handed to Emscripten's
 * `instantiateWasm` override, so neither jSquash's own default (import-meta-
 * relative) URL nor its `wasm-feature-detect`-based module selection ever
 * runs. `engine.json` ships only the single-threaded `avif_enc.wasm` — never
 * `avif_enc_mt.wasm` — precisely so this engine's `needsIsolation: false` is
 * honest: unlike jsquash-webp's SIMD choice (which only ever changes which
 * wasm binary loads), avif's multi-threaded encoder needs
 * `crossOriginIsolated` (SharedArrayBuffer-backed worker pool threads), which
 * this engine never asks for. Decode has no such split — it takes the
 * package's own `init(module)` entry point directly, same as jsquash-jpeg.
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
 * `WebAssembly.Module` — see the identical helper in `../jsquash-webp/adapter.ts`.
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

/**
 * The encoder's Emscripten module shape — `module.encode` is the only member
 * this adapter calls. Mirrors `@jsquash/avif/codec/enc/avif_enc.d.ts`'s
 * `AVIFModule`, which isn't itself importable as a value (only its module
 * factory is), so the shape is restated narrowly here rather than imported.
 */
interface AvifEncoderModule {
  encode(
    data: BufferSource,
    width: number,
    height: number,
    options: EncodeOptions,
  ): Uint8Array | null;
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
        "jsquash-avif does not read OPFS inputs",
        { engine: metadata.id },
      );
    case "raster":
      throw new EngineError(
        "internal",
        "jsquash-avif decode expected a bytes/blob input, got a raster",
        { engine: metadata.id },
      );
  }
}

/** Reads `task.input` down to the `RasterImage` `encode` requires. */
function inputToRaster(input: EngineInput): RasterImage {
  if (input.kind !== "raster") {
    throw new EngineError(
      "internal",
      `jsquash-avif encode expected a raster input, got "${input.kind}"`,
      { engine: metadata.id },
    );
  }
  return input.image;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/** decode: avif bytes -> `RasterImage`, always 8-bit (we never ask for the
 * 10/12-bit decode path — `RasterImage` is always 8-bit RGBA). */
async function runDecode(
  task: EngineTask,
  ensureDecodeReady: () => Promise<void>,
): Promise<EngineResult> {
  const { input, inputFormat, signal, onProgress } = task;
  signal.throwIfAborted();

  if (inputFormat !== "avif") {
    throw new EngineError(
      "internal",
      `jsquash-avif decode expects an avif input, got "${inputFormat}"`,
      { engine: metadata.id },
    );
  }

  const bytes = await inputToBytes(input);
  await ensureDecodeReady();
  signal.throwIfAborted();
  onProgress?.(0.3);

  let imageData: ImageData | null;
  try {
    imageData = await decodeAvif(bytes);
  } catch (e) {
    throw new EngineError("decode-failed", "failed to decode avif", {
      engine: metadata.id,
      cause: e,
    });
  }
  if (!imageData) {
    throw new EngineError("decode-failed", "failed to decode avif", {
      engine: metadata.id,
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
 * encode: `RasterImage` -> avif bytes. `options.quality` is 0..1 on our side
 * (avif's own scale is 0..100, `defaultOptions.quality` is 50);
 * `options.speed` passes straight through (avif's own 0..10 scale, default
 * 6 — `defaultOptions.speed`). `options.lossless` forces quality/qualityAlpha/
 * subsample to avif's own lossless-mode values, same as jSquash's own
 * `encode()` — duplicated here (rather than delegating to
 * `@jsquash/avif/encode.js`) because that function's `init()` is what
 * performs the `wasm-feature-detect` thread check this adapter exists to
 * avoid.
 *
 * `options.targetSizeKB` (a positive number) switches to
 * `encodeToTargetSize`, bisecting `quality` until the output fits that byte
 * budget — skipped when `lossless` is set, since quality has no effect on a
 * lossless encode's size. Without `targetSizeKB`, behaviour is unchanged.
 */
async function runEncode(
  task: EngineTask,
  ensureEncodeReady: () => Promise<AvifEncoderModule>,
): Promise<EngineResult> {
  const { input, outputFormat, options, signal, onProgress } = task;
  signal.throwIfAborted();

  if (outputFormat !== "avif") {
    throw new EngineError(
      "internal",
      `jsquash-avif encode expects an avif output, got "${outputFormat}"`,
      { engine: metadata.id },
    );
  }

  const image = inputToRaster(input);
  const module = await ensureEncodeReady();
  signal.throwIfAborted();
  onProgress?.(0.3);

  const lossless = options.lossless === true;

  const encodeAtQuality = async (quality: number): Promise<ArrayBuffer> => {
    const encodeOptions: EncodeOptions = { ...defaultOptions };
    encodeOptions.quality = Math.round(clamp01(quality) * 100);
    if (typeof options.speed === "number") {
      encodeOptions.speed = options.speed;
    }
    if (lossless) {
      encodeOptions.quality = 100;
      encodeOptions.qualityAlpha = -1;
      encodeOptions.subsample = 3; // YUV444 — required for lossless.
    }

    let out: Uint8Array | null;
    try {
      out = module.encode(image.data, image.width, image.height, encodeOptions);
    } catch (e) {
      throw new EngineError("encode-failed", "failed to encode avif", {
        engine: metadata.id,
        cause: e,
      });
    }
    if (!out) {
      throw new EngineError("encode-failed", "failed to encode avif", {
        engine: metadata.id,
      });
    }
    // `out.slice()` (no args) copies into a fresh, exactly-sized
    // `ArrayBuffer` — both trimming Emscripten's possibly-larger backing heap
    // down to the real output, and sidestepping `out.buffer`'s own type
    // (`ArrayBuffer | SharedArrayBuffer`, since `Uint8Array.buffer` doesn't
    // know a copy was never shared).
    return out.slice().buffer;
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
      typeof options.quality === "number"
        ? options.quality
        : defaultOptions.quality / 100;
    bytes = await encodeAtQuality(quality);
  }

  onProgress?.(1);
  return { kind: "bytes", bytes, mime: FORMATS.avif.mime };
}

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
  function ensureDecodeReady(): Promise<void> {
    if (!decodeReady) {
      decodeReady = (async () => {
        const module = await compileWasm(baseUrl, DECODE_WASM_FILE);
        await initAvifDecode(module);
      })().catch((e: unknown) => {
        decodeReady = undefined;
        throw e;
      });
    }
    return decodeReady;
  }

  let encodeReady: Promise<AvifEncoderModule> | undefined;
  function ensureEncodeReady(): Promise<AvifEncoderModule> {
    if (!encodeReady) {
      encodeReady = (async () => {
        const module = await compileWasm(baseUrl, ENCODE_WASM_FILE);
        const { default: avifEncFactory } = await import(
          "@jsquash/avif/codec/enc/avif_enc.js"
        );
        return (await avifEncFactory({
          noInitialRun: true,
          instantiateWasm: instantiateWasmWith(module),
        })) as unknown as AvifEncoderModule;
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
        default:
          throw new EngineError(
            "unsupported",
            `jsquash-avif cannot run op "${task.op}"`,
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

export default defineEngine({
  ...metadata,
  // Checked by check-sizes.ts against built chunks — must be a string
  // literal (see EngineMarker's doc comment in ../types.ts), never computed.
  marker: "localvert-engine:jsquash-avif",
  supports,
  load,
});
