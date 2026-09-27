// Subpath import of @jsquash/oxipng's own low-level (single-threaded)
// wasm-bindgen glue, bypassing its `optimise()`/`init()` wrapper — that
// wrapper auto-picks a multi-threaded build (a *different* wasm binary,
// `codec/pkg-parallel/`) whenever it detects a worker with
// `hardwareConcurrency > 1` and wasm threads support, which this adapter's
// single fetched/compiled module (`squoosh_oxipng_bg.wasm`, the
// single-threaded pkg) can't satisfy. See `runCompress`'s doc comment and
// ADR-0013.
import initOxipngWasm, {
  optimise as oxipngOptimiseSync,
} from "@jsquash/oxipng/codec/pkg/squoosh_oxipng.js";
import decodePng, { init as initPngDecode } from "@jsquash/png/decode";
import encodePng, { init as initPngEncode } from "@jsquash/png/encode";
import type { Operation, StepFormat } from "@/lib/registry";
import { FORMATS } from "@/lib/registry";
import { defineEngine } from "../define-engine";
import { EngineError, toEngineError } from "../errors";
import { stripPng } from "../exif/strip";
import { ENGINE_MANIFEST } from "../manifest";
import { neverLarger } from "../shared/never-larger";
import { quantizeToPalette } from "../shared/palette-quantize";
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
  version: ENGINE_MANIFEST["jsquash-png"].version,
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
      return input === "png" && output === "raster";
    case "encode":
      return input === "raster" && output === "png";
    // ADR-0013: compress-png's single byte-to-byte step (decode -> optional
    // palette quantization -> encode -> oxipng, all inside runCompress below)
    // rather than the generic ADR-0007 raster pipeline — the never-larger
    // check needs the original input bytes and the final encoded bytes in
    // the same call, which a two-step decode/encode pipeline can't give it.
    case "compress":
      return input === "png" && output === "png";
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

/** Oxipng's default optimisation level (0-6, higher = smaller but slower).
 * 2 is oxipng's own upstream default — a real size win over a naive re-encode
 * without the multi-second runtimes level 5+ can hit on a large photo. */
const OXIPNG_LEVEL = 2;

/**
 * compress (png -> png, ADR-0013): decode -> optional palette quantization
 * (`mode: "smaller"`) -> re-encode -> oxipng repack, all in one call so the
 * never-larger check at the end can compare against the *original* input
 * bytes directly — a two-step decode/encode pipeline (ADR-0007) never hands
 * the encode step the original bytes, only the decoded raster. Falls back to
 * a metadata-stripped (but not re-encoded) copy of the input, via the `exif`
 * engine's byte-level `stripPng`, rather than the encoded attempt whenever
 * that attempt isn't actually smaller — `stripPng` only drops chunks, so it
 * is itself always the same size or smaller than the input.
 */
async function runCompress(
  task: EngineTask,
  ensurePngReady: () => Promise<void>,
  ensureOxipngReady: () => Promise<void>,
): Promise<EngineResult> {
  const { input, options, signal, onProgress } = task;
  signal.throwIfAborted();

  const originalBytes = await inputToBytes(input);
  signal.throwIfAborted();
  onProgress?.(0.1);

  await ensurePngReady();
  signal.throwIfAborted();

  let decoded: ImageData;
  try {
    decoded = await decodePng(originalBytes);
  } catch (e) {
    throw new EngineError("decode-failed", "failed to decode png", {
      engine: metadata.id,
      cause: e,
    });
  }
  signal.throwIfAborted();
  onProgress?.(0.35);

  const mode = options.mode === "smaller" ? "smaller" : "lossless";
  let toEncode = decoded;
  if (mode === "smaller") {
    const dither = options.dither !== false;
    const quantized = quantizeToPalette(
      { width: decoded.width, height: decoded.height, data: decoded.data },
      { dither },
    );
    toEncode = new ImageData(quantized.data, quantized.width, quantized.height);
  }
  onProgress?.(0.5);

  let encoded: ArrayBuffer;
  try {
    encoded = await encodePng(toEncode);
  } catch (e) {
    throw new EngineError("encode-failed", "failed to encode png", {
      engine: metadata.id,
      cause: e,
    });
  }
  signal.throwIfAborted();
  onProgress?.(0.7);

  await ensureOxipngReady();
  signal.throwIfAborted();

  let optimized: ArrayBuffer;
  try {
    const out = oxipngOptimiseSync(
      new Uint8Array(encoded),
      OXIPNG_LEVEL,
      false, // interlace
      false, // optimiseAlpha
    );
    optimized = out.buffer.slice(
      out.byteOffset,
      out.byteOffset + out.byteLength,
    ) as ArrayBuffer;
  } catch (e) {
    throw new EngineError("encode-failed", "failed to optimise png", {
      engine: metadata.id,
      cause: e,
    });
  }
  onProgress?.(0.95);

  let strippedOriginal: ArrayBuffer;
  try {
    strippedOriginal = stripPng(new Uint8Array(originalBytes))
      .buffer as ArrayBuffer;
  } catch {
    // Malformed input would already have failed the decode above; fall back
    // to the untouched original rather than let a strip-only failure hide a
    // perfectly good compress result.
    strippedOriginal = originalBytes;
  }

  const picked = neverLarger(
    strippedOriginal,
    optimized,
    "This PNG was already about as small as it gets — kept the original " +
      "(with metadata removed).",
  );

  onProgress?.(1);
  return {
    kind: "bytes",
    bytes: picked.bytes,
    mime: FORMATS.png.mime,
    ...(picked.note ? { note: picked.note } : {}),
  };
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

  // ADR-0013: oxipng's own wasm binary, compiled from the same baseUrl as
  // the png codec's — separate memoised promise since it's a different
  // wasm file, lazily loaded only by a "compress" step (a plain
  // decode/encode tool never pays for it).
  let oxipngReady: Promise<void> | undefined;

  function ensureOxipngReady(): Promise<void> {
    if (!oxipngReady) {
      oxipngReady = (async () => {
        const module = await WebAssembly.compileStreaming(
          fetch(`${baseUrl}squoosh_oxipng_bg.wasm`),
        );
        await initOxipngWasm(module);
      })();
    }
    return oxipngReady;
  }

  async function run(task: EngineTask): Promise<EngineResult> {
    try {
      switch (task.op) {
        case "decode":
          return await runDecode(task, ensureReady);
        case "encode":
          return await runEncode(task, ensureReady);
        case "compress":
          return await runCompress(task, ensureReady, ensureOxipngReady);
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
    // Drops the cached module promises so they (and the wasm instances they
    // resolved to) can be garbage collected. This does not reclaim the wasm
    // heap itself — heap reclaim still requires terminating the worker that
    // hosts this instance (docs/ENGINES.md, "Terminate the worker to free
    // the heap").
    ready = undefined;
    oxipngReady = undefined;
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
