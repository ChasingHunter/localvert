import decodePng, { init as initPngDecode } from "@jsquash/png/decode";
import encodePng, { init as initPngEncode } from "@jsquash/png/encode";
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
      return input === "png" && output === "raster";
    case "encode":
      return input === "raster" && output === "png";
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
        "jsquash-png does not read OPFS inputs",
        { engine: metadata.id },
      );
    case "raster":
      throw new EngineError(
        "internal",
        "jsquash-png decode expected a bytes/blob input, got a raster",
        { engine: metadata.id },
      );
  }
}

/** Reads `task.input` down to the `RasterImage` `encode` requires. */
function inputToRaster(input: EngineInput): RasterImage {
  if (input.kind !== "raster") {
    throw new EngineError(
      "internal",
      `jsquash-png encode expected a raster input, got "${input.kind}"`,
      { engine: metadata.id },
    );
  }
  return input.image;
}

/** decode: png bytes -> `RasterImage`, always 8-bit (we never ask for the
 * 16-bit-per-channel decode path). */
async function runDecode(
  task: EngineTask,
  ensureReady: () => Promise<void>,
): Promise<EngineResult> {
  const { input, inputFormat, signal, onProgress } = task;
  signal.throwIfAborted();

  if (inputFormat !== "png") {
    throw new EngineError(
      "internal",
      `jsquash-png decode expects a png input, got "${inputFormat}"`,
      { engine: metadata.id },
    );
  }

  const bytes = await inputToBytes(input);
  await ensureReady();
  signal.throwIfAborted();
  onProgress?.(0.3);

  let imageData: ImageData;
  try {
    imageData = await decodePng(bytes);
  } catch (e) {
    throw new EngineError("decode-failed", "failed to decode png", {
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

/** encode: `RasterImage` -> lossless png bytes. oxipng-style recompression
 * options aren't exposed by `@jsquash/png` (that's the separate `oxipng`
 * package); this is a straight, lossless 8-bit encode — no options. */
async function runEncode(
  task: EngineTask,
  ensureReady: () => Promise<void>,
): Promise<EngineResult> {
  const { input, outputFormat, signal, onProgress } = task;
  signal.throwIfAborted();

  if (outputFormat !== "png") {
    throw new EngineError(
      "internal",
      `jsquash-png encode expects a png output, got "${outputFormat}"`,
      { engine: metadata.id },
    );
  }

  const image = inputToRaster(input);
  await ensureReady();
  signal.throwIfAborted();
  onProgress?.(0.3);

  const imageData = new ImageData(image.data, image.width, image.height);

  let bytes: ArrayBuffer;
  try {
    bytes = await encodePng(imageData);
  } catch (e) {
    throw new EngineError("encode-failed", "failed to encode png", {
      engine: metadata.id,
      cause: e,
    });
  }

  onProgress?.(1);
  return { kind: "bytes", bytes, mime: FORMATS.png.mime };
}

/**
 * Compiles `<baseUrl>squoosh_png_bg.wasm` and hands the resulting
 * `WebAssembly.Module` to jSquash's own `init` — never letting jSquash fetch
 * from its own default (import-meta-relative) URL, which `connect-src
 * 'self'` would block anyway. Decode and encode share one wasm binary
 * (`@jsquash/png`'s own module-level instance is keyed by that shared wasm,
 * not by which of `decode`/`encode` initialised it first), so one memoised
 * promise, initialising both, covers both ops.
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
  let ready: Promise<void> | undefined;

  function ensureReady(): Promise<void> {
    if (!ready) {
      ready = (async () => {
        const module = await WebAssembly.compileStreaming(
          fetch(`${baseUrl}squoosh_png_bg.wasm`),
        );
        // Both decode's and encode's `init` set the same underlying wasm
        // instance (see the doc comment above); initialising both here
        // means neither op's own internal `await init()` fallback ever runs
        // uninitialised and reaches for jSquash's default URL.
        await Promise.all([initPngDecode(module), initPngEncode(module)]);
      })();
    }
    return ready;
  }

  async function run(task: EngineTask): Promise<EngineResult> {
    try {
      switch (task.op) {
        case "decode":
          return await runDecode(task, ensureReady);
        case "encode":
          return await runEncode(task, ensureReady);
        default:
          throw new EngineError(
            "unsupported",
            `jsquash-png cannot run op "${task.op}"`,
            { engine: metadata.id },
          );
      }
    } catch (e) {
      throw toEngineError(e, metadata.id);
    }
  }

  function dispose(): void {
    // Drops the cached module promise so it (and the wasm instance it
    // resolved to) can be garbage collected. This does not reclaim the wasm
    // heap itself — heap reclaim still requires terminating the worker that
    // hosts this instance (docs/ENGINES.md, "Terminate the worker to free
    // the heap").
    ready = undefined;
  }

  return { run, dispose };
}

export default defineEngine({
  ...metadata,
  // Checked by check-sizes.ts against built chunks — must be a string
  // literal (see EngineMarker's doc comment in ../types.ts), never computed.
  marker: "localvert-engine:jsquash-png",
  supports,
  load,
});
