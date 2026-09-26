import decodeJxl, { init as initJxlDecode } from "@jsquash/jxl/decode";
import type { EncodeOptions } from "@jsquash/jxl/meta";
import { defaultOptions } from "@jsquash/jxl/meta";
import type { Operation, StepFormat } from "@/lib/registry";
import { FORMATS } from "@/lib/registry";
import { defineEngine } from "../define-engine";
import { EngineError, toEngineError } from "../errors";
import { ENGINE_MANIFEST } from "../manifest";
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
  version: ENGINE_MANIFEST["jsquash-jxl"].version,
} satisfies Pick<
  EngineAdapter,
  "id" | "version" | "license" | "location" | "needsIsolation" | "heavy"
>;

const DECODE_WASM_FILE = "jxl_dec.wasm";
const ENCODE_WASM_FILE = "jxl_enc.wasm";

function supports(
  op: Operation,
  input: StepFormat,
  output: StepFormat,
): boolean {
  switch (op) {
    case "decode":
      return input === "jxl" && output === "raster";
    case "encode":
      return input === "raster" && output === "jxl";
    default:
      return false;
  }
}

/**
 * Fetches `${baseUrl}${file}` and compiles it without instantiating — same
 * role as `../jsquash-avif/adapter.ts`'s identical helper. `engine.json`
 * ships only the plain `jxl_enc.wasm` — never `jxl_enc_mt.wasm` or
 * `jxl_enc_mt_simd.wasm` — so this engine's `needsIsolation: false` stays
 * honest: jSquash's own `encode.js` would otherwise pick one of those two
 * multi-threaded variants via `wasm-feature-detect`'s `threads()`/`simd()`,
 * which need `crossOriginIsolated`. Decode has no such split — it takes the
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
 * `WebAssembly.Module` — see the identical helper in `../jsquash-webp/adapter.ts`
 * and `../jsquash-avif/adapter.ts`.
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
 * this adapter calls. Mirrors `@jsquash/jxl/codec/enc/jxl_enc.d.ts`'s
 * `JXLModule`, which isn't itself importable as a value (only its module
 * factory is), so the shape is restated narrowly here rather than imported —
 * same approach as `../jsquash-avif/adapter.ts`'s `AvifEncoderModule`.
 */
interface JxlEncoderModule {
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
        "jsquash-jxl does not read OPFS inputs",
        { engine: metadata.id },
      );
    case "raster":
      throw new EngineError(
        "internal",
        "jsquash-jxl decode expected a bytes/blob input, got a raster",
        { engine: metadata.id },
      );
  }
}

/** Reads `task.input` down to the `RasterImage` `encode` requires. */
function inputToRaster(input: EngineInput): RasterImage {
  if (input.kind !== "raster") {
    throw new EngineError(
      "internal",
      `jsquash-jxl encode expected a raster input, got "${input.kind}"`,
      { engine: metadata.id },
    );
  }
  return input.image;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/** decode: jxl bytes -> `RasterImage`. */
async function runDecode(
  task: EngineTask,
  ensureDecodeReady: () => Promise<void>,
): Promise<EngineResult> {
  const { input, inputFormat, signal, onProgress } = task;
  signal.throwIfAborted();

  if (inputFormat !== "jxl") {
    throw new EngineError(
      "internal",
      `jsquash-jxl decode expects a jxl input, got "${inputFormat}"`,
      { engine: metadata.id },
    );
  }

  const bytes = await inputToBytes(input);
  await ensureDecodeReady();
  signal.throwIfAborted();
  onProgress?.(0.3);

  let imageData: ImageData;
  try {
    imageData = await decodeJxl(bytes);
  } catch (e) {
    throw new EngineError("decode-failed", "failed to decode jxl", {
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
 * encode: `RasterImage` -> jxl bytes. `options.quality` is 0..1 on our side
 * (jxl's own scale is 0..100, `defaultOptions.quality` is 75);
 * `options.effort` passes straight through (jxl's own 1..9 scale, default 7
 * — `defaultOptions.effort`). `options.lossless` forces
 * quality/lossyModular/lossyPalette to jxl's own lossless-mode values, same
 * as jSquash's own `encode()` — duplicated here (rather than delegating to
 * `@jsquash/jxl/encode.js`) because that function's `init()` is what
 * performs the `wasm-feature-detect` thread/simd check this adapter exists
 * to avoid.
 */
async function runEncode(
  task: EngineTask,
  ensureEncodeReady: () => Promise<JxlEncoderModule>,
): Promise<EngineResult> {
  const { input, outputFormat, options, signal, onProgress } = task;
  signal.throwIfAborted();

  if (outputFormat !== "jxl") {
    throw new EngineError(
      "internal",
      `jsquash-jxl encode expects a jxl output, got "${outputFormat}"`,
      { engine: metadata.id },
    );
  }

  const image = inputToRaster(input);
  const module = await ensureEncodeReady();
  signal.throwIfAborted();
  onProgress?.(0.3);

  const encodeOptions: EncodeOptions = { ...defaultOptions };
  if (typeof options.quality === "number") {
    encodeOptions.quality = Math.round(clamp01(options.quality) * 100);
  }
  if (typeof options.effort === "number") {
    encodeOptions.effort = options.effort;
  }
  if (options.lossless === true) {
    encodeOptions.quality = 100;
    encodeOptions.lossyModular = false;
    encodeOptions.lossyPalette = false;
  }

  let bytes: Uint8Array | null;
  try {
    bytes = module.encode(image.data, image.width, image.height, encodeOptions);
  } catch (e) {
    throw new EngineError("encode-failed", "failed to encode jxl", {
      engine: metadata.id,
      cause: e,
    });
  }
  if (!bytes) {
    throw new EngineError("encode-failed", "failed to encode jxl", {
      engine: metadata.id,
    });
  }

  onProgress?.(1);
  // `bytes.slice()` (no args) copies into a fresh, exactly-sized
  // `ArrayBuffer` — see the identical note in `../jsquash-avif/adapter.ts`.
  return { kind: "bytes", bytes: bytes.slice().buffer, mime: FORMATS.jxl.mime };
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
        await initJxlDecode(module);
      })().catch((e: unknown) => {
        decodeReady = undefined;
        throw e;
      });
    }
    return decodeReady;
  }

  let encodeReady: Promise<JxlEncoderModule> | undefined;
  function ensureEncodeReady(): Promise<JxlEncoderModule> {
    if (!encodeReady) {
      encodeReady = (async () => {
        const module = await compileWasm(baseUrl, ENCODE_WASM_FILE);
        const { default: jxlEncFactory } = await import(
          "@jsquash/jxl/codec/enc/jxl_enc.js"
        );
        return (await jxlEncFactory({
          noInitialRun: true,
          instantiateWasm: instantiateWasmWith(module),
        })) as unknown as JxlEncoderModule;
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
            `jsquash-jxl cannot run op "${task.op}"`,
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
  marker: "localvert-engine:jsquash-jxl",
  supports,
  load,
});
