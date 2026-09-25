import decode, { init as initDecode } from "@jsquash/webp/decode";
import encode, { init as initEncode } from "@jsquash/webp/encode";
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
 * see the identical cast in `../canvas/adapter.ts`.
 */
const metadata = meta as Pick<
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

/** encode: `RasterImage` -> webp bytes. `quality` is 0..1 in `EngineTask`
 * options (the option-form convention); jSquash's own scale is 0..100. */
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

  const quality = clamp01(
    typeof options.quality === "number" ? options.quality : 0.92,
  );
  const lossless = options.lossless === true;

  let bytes: ArrayBuffer;
  try {
    bytes = await encode(new ImageData(image.data, image.width, image.height), {
      quality: Math.round(quality * 100),
      lossless: lossless ? 1 : 0,
    });
  } catch (e) {
    throw new EngineError("encode-failed", "failed to encode webp", {
      engine: metadata.id,
      cause: e,
    });
  }

  onProgress?.(1);
  return { kind: "bytes", bytes, mime: FORMATS.webp.mime };
}

export default defineEngine({
  ...metadata,
  // Checked by check-sizes.ts against built chunks — must be a string
  // literal (see EngineMarker's doc comment in ../types.ts), never computed.
  marker: "localvert-engine:jsquash-webp",
  supports,
  load,
});
