/**
 * `libraw-wasm` only ships types for its documented `index.js` entry point
 * (the `LibRaw` class from the package root) — see `load`'s doc comment
 * below for why this adapter bypasses that entry point and loads the
 * lower-level Emscripten glue, `dist/libraw.js`, directly instead. That file
 * ships no `.d.ts` of its own; since `load()` now loads it at runtime rather
 * than importing it as a module specifier (see below), there is no static
 * import site for TypeScript to type at all. `load()` casts the loaded
 * module's shape straight to the local interfaces below instead — reusing
 * the field shapes the package's own `index.d.ts` already documents for the
 * wrapped `index.js` class (confirmed by reading `worker.js`'s published
 * source that it forwards args/results to these same instance methods
 * untouched, so the same shapes apply here too).
 */
import type { LibRawSettings, Metadata, RawImageData } from "libraw-wasm";
import type { Operation, StepFormat } from "@/lib/registry";
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

interface LibRawInstance {
  /**
   * Opens and decodes a RAW buffer. The public class types this as
   * `Promise<void>`; empirically (see `runDecode`'s `open` call) this raw
   * embind binding can also throw synchronously on invalid input rather
   * than reject — callers must wrap it in try/catch, not just `.catch()`.
   */
  open(bytes: BufferSource, settings?: LibRawSettings): Promise<void>;
  metadata(fullOutput?: boolean): Promise<Metadata | undefined>;
  imageData(): Promise<RawImageData | undefined>;
  /** Frees this instance's wasm-side (C++) memory — embind's convention. */
  delete(): void;
}

interface LibRawWasmModule {
  LibRaw: new () => LibRawInstance;
}

interface LibRawFactoryOptions {
  /**
   * Overrides where the module fetches `libraw.wasm` from. Without it, the
   * module resolves the wasm relative to this file's own `import.meta.url`
   * — exactly what this adapter must avoid, per invariant 3 (no CDN, and
   * the wasm must come from this engine's own `ctx.baseUrl`).
   */
  locateFile?: (path: string, prefix: string) => string;
}

type CreateLibRawModule = (
  options?: LibRawFactoryOptions,
) => Promise<LibRawWasmModule>;

/**
 * `engine.json` is the single source of truth for this adapter's metadata —
 * see the identical cast in `../canvas/adapter.ts`. ADR-0002 governs this
 * engine specifically: `libraw-wasm` wraps LibRaw, LGPL-2.1/CDDL-1.0 dual —
 * treated as copyleft, same arms-length rules as the GPL engines in that ADR.
 */
const metadata = meta as Pick<
  EngineAdapter,
  "id" | "version" | "license" | "location" | "needsIsolation" | "heavy"
>;

/**
 * A decoded raw image over this many pixels is rejected before decoding
 * rather than risking the allocation: `RasterImage` is 4 bytes/pixel, so 60
 * MP is already ~230 MB for one image, before the wasm heap's own copy of
 * the same pixels. Checked against `metadata()`'s cheap header read, ahead
 * of the expensive `imageData()` demosaic — see `runDecode`.
 */
const MAX_PIXELS = 60_000_000;

function supports(
  op: Operation,
  input: StepFormat,
  output: StepFormat,
): boolean {
  return op === "decode" && input === "raw" && output === "raster";
}

/** Reads `task.input` down to the `BufferSource` `LibRaw.open` wants. */
async function inputToBytes(input: EngineInput): Promise<ArrayBuffer> {
  switch (input.kind) {
    case "blob":
      return input.blob.arrayBuffer();
    case "bytes":
      return input.bytes;
    case "opfs":
      throw new EngineError(
        "unsupported",
        "libraw engine does not read OPFS inputs",
        { engine: metadata.id },
      );
    case "raster":
      throw new EngineError(
        "internal",
        "libraw expected a bytes/blob input, got a raster",
        { engine: metadata.id },
      );
  }
}

/**
 * `libraw-wasm`'s documented entry point (`import LibRaw from "libraw-wasm"`,
 * i.e. `dist/index.js`) spawns its own internal Worker
 * (`new Worker(new URL("./worker.js", import.meta.url))`), and that worker
 * resolves `libraw.wasm` relative to *its own* module URL, hardcoded — there
 * is no hook to point either the worker or the wasm at this engine's own
 * `ctx.baseUrl`. Bundled through our adapter's dynamic import, that URL
 * would resolve to wherever the app bundler places the package's worker
 * chunk, not to `public/engines/libraw@<version>/` — invariant 3 territory,
 * and unversioned besides.
 *
 * `dist/libraw.js` is the lower-level Emscripten glue `worker.js` is itself
 * built on. Loaded directly — we already run inside our own worker, so there
 * is no need for `libraw-wasm`'s nested one — its factory function accepts a
 * `locateFile` hook (confirmed by reading its published source and by
 * calling it directly in Node: `locateFile` is invoked with `"libraw.wasm"`
 * and its return value used as the fetch URL), which this adapter points at
 * `ctx.baseUrl`.
 *
 * That glue is loaded here at *runtime*, from our own served copy
 * (`sync-engines` copies `dist/libraw.js` next to `dist/libraw.wasm`, per
 * `engine.json`), rather than statically `import`ed like every other
 * engine's dependencies. `dist/libraw.js` is Emscripten's pthreads build: it
 * contains `new Worker(new URL("libraw.js", import.meta.url), ...)` — a
 * worker that loads *itself* by its own module URL, for spawning additional
 * threads. Turbopack's bundler follows that `new URL(..., import.meta.url)`
 * into the same module it is already compiling, and never terminates —
 * confirmed by bisect (`next build` hangs from the commit that first
 * statically imported this file onward, times out clean before it). The
 * `webpackIgnore`/`turbopackIgnore` directive comments below tell both
 * bundlers to leave this one `import()` call alone rather than trace into
 * it, so `libraw.js` ships as a plain static asset (like `libraw.wasm`) and
 * is fetched as real ESM by the browser at runtime, where its own
 * self-referential `new URL(..., import.meta.url)` resolves correctly
 * against `ctx.baseUrl` and is never a bundling concern.
 */
async function load(ctx: EngineLoadContext): Promise<EngineInstance> {
  // @vite-ignore — vitest's browser mode is Vite-powered; same reasoning as
  // the two directives below, for the bundler this file's own tests run
  // under.
  const imported = (await import(
    /* webpackIgnore: true */
    /* turbopackIgnore: true */
    /* @vite-ignore */
    `${ctx.baseUrl}libraw.js`
  )) as { default: CreateLibRawModule };
  const createLibRawModule = imported.default;
  const module = await createLibRawModule({
    locateFile: (path) => `${ctx.baseUrl}${path}`,
  });
  return { run: (task) => run(task, module), dispose };
}

async function run(
  task: EngineTask,
  module: LibRawWasmModule,
): Promise<EngineResult> {
  try {
    switch (task.op) {
      case "decode":
        return await runDecode(task, module);
      default:
        throw new EngineError(
          "unsupported",
          `libraw cannot run op "${task.op}"`,
          { engine: metadata.id },
        );
    }
  } catch (e) {
    throw toEngineError(e, metadata.id);
  }
}

/**
 * decode: camera raw bytes -> `RasterImage`, via LibRaw's own demosaic and
 * color pipeline — camera white balance, sRGB, 8-bit output, full size
 * unless `options.halfSize` asks for LibRaw's own faster half-size decode.
 * `metadata()` is read first (cheap: header only) to enforce `MAX_PIXELS`
 * before `imageData()` (the expensive demosaic) ever runs.
 */
async function runDecode(
  task: EngineTask,
  module: LibRawWasmModule,
): Promise<EngineResult> {
  const { input, options, signal, onProgress } = task;
  signal.throwIfAborted();

  const bytes = await inputToBytes(input);
  signal.throwIfAborted();

  const settings = {
    useCameraWb: true,
    outputColor: 1, // sRGB
    outputBps: 8,
    halfSize: options.halfSize === true,
  };

  const raw: LibRawInstance = new module.LibRaw();
  try {
    try {
      await raw.open(bytes, settings);
    } catch (e) {
      throw new EngineError("decode-failed", "failed to open raw image", {
        engine: metadata.id,
        cause: e,
      });
    }
    signal.throwIfAborted();
    onProgress?.(0.3);

    const fileMeta = await raw.metadata(false);
    if (fileMeta && fileMeta.width * fileMeta.height > MAX_PIXELS) {
      throw new EngineError(
        "decode-failed",
        `raw image too large to decode (${fileMeta.width}x${fileMeta.height} exceeds the ${MAX_PIXELS / 1_000_000} MP cap)`,
        { engine: metadata.id },
      );
    }
    signal.throwIfAborted();

    let img: Awaited<ReturnType<LibRawInstance["imageData"]>>;
    try {
      img = await raw.imageData();
    } catch (e) {
      throw new EngineError("decode-failed", "failed to decode raw image", {
        engine: metadata.id,
        cause: e,
      });
    }
    if (!img) {
      throw new EngineError("decode-failed", "raw image produced no data", {
        engine: metadata.id,
      });
    }
    if (img.bits !== 8) {
      throw new EngineError(
        "decode-failed",
        `libraw: unsupported output bit depth (${img.bits})`,
        { engine: metadata.id },
      );
    }
    if (img.colors !== 3) {
      throw new EngineError(
        "decode-failed",
        `libraw: unsupported output color count (${img.colors}) — only RGB is supported`,
        { engine: metadata.id },
      );
    }

    onProgress?.(0.8);
    const image = toRasterImage(img.width, img.height, img.data as Uint8Array);
    onProgress?.(1);
    return { kind: "raster", image };
  } finally {
    raw.delete();
  }
}

/**
 * RGB (LibRaw's `imageData()` output) -> RGBA. Camera raw has no alpha
 * channel of its own, so every pixel comes out fully opaque.
 */
function toRasterImage(
  width: number,
  height: number,
  rgb: Uint8Array,
): RasterImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0, j = 0; j < data.length; i += 3, j += 4) {
    data[j] = rgb[i] ?? 0;
    data[j + 1] = rgb[i + 1] ?? 0;
    data[j + 2] = rgb[i + 2] ?? 0;
    data[j + 3] = 255;
  }
  return { width, height, data };
}

function dispose(): void {
  // No engine-owned resource persists between `run()` calls — each decode
  // creates and frees (`raw.delete()`) its own LibRaw instance. Same
  // wasm-heap-not-freed constraint as every other Emscripten-built engine
  // here (see jsquash-jpeg's dispose): reclaiming the module itself still
  // requires terminating the worker that hosts this instance.
}

export default defineEngine({
  ...metadata,
  // Checked by check-sizes.ts against built chunks — must be a string
  // literal (see EngineMarker's doc comment in ../types.ts), never computed.
  marker: "localvert-engine:libraw",
  supports,
  load,
});
