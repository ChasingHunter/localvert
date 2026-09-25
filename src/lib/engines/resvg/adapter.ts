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

/** See the doc comment on the same cast in `../canvas/adapter.ts`. */
const metadata = meta as Pick<
  EngineAdapter,
  "id" | "version" | "license" | "location" | "needsIsolation" | "heavy"
>;

/** Must match `engine.json`'s `files[0].to`. */
const WASM_FILE = "resvg.wasm";

type ResvgHandle = InstanceType<typeof import("@resvg/resvg-wasm").Resvg>;

/**
 * Longest side a rasterised SVG is allowed to reach, in pixels, when neither
 * `width` nor `height` is given. An SVG's `viewBox` can declare an
 * arbitrarily large intrinsic size (e.g. "0 0 1000000 1000000") — without a
 * cap, resvg would happily rasterise that to a many-gigabyte RGBA buffer.
 */
const MAX_DIMENSION = 8192;

function supports(
  op: Operation,
  input: StepFormat,
  output: StepFormat,
): boolean {
  return op === "decode" && input === "svg" && output === "raster";
}

/**
 * `@resvg/resvg-wasm`'s `initWasm()` throws "Already initialized" if called
 * a second time (see its `wasm-binding.ts`) — this module-level promise is
 * what makes `load()` idempotent across repeat calls in the same worker (or
 * the same test file), per the add-engine skill's "load() initialises wasm
 * once".
 */
let wasmReady: Promise<void> | undefined;

async function load(ctx: EngineLoadContext): Promise<EngineInstance> {
  if (!wasmReady) {
    const { initWasm } = await import("@resvg/resvg-wasm");
    wasmReady = initWasm(fetch(`${ctx.baseUrl}${WASM_FILE}`)).catch((e) => {
      // Allow a retry (e.g. after a transient fetch failure) instead of
      // permanently wedging this engine for the life of the worker.
      wasmReady = undefined;
      throw e;
    });
  }
  await wasmReady;
  return { run, dispose };
}

/** Reads `task.input` down to a `Blob` — the only shape SVG text can come from. */
function inputToBlob(input: EngineInput): Blob {
  switch (input.kind) {
    case "blob":
      return input.blob;
    case "bytes":
      return new Blob([input.bytes]);
    case "opfs":
      throw new EngineError(
        "unsupported",
        "resvg engine does not read OPFS inputs",
        { engine: metadata.id },
      );
    case "raster":
      throw new EngineError(
        "internal",
        "resvg expected a blob/bytes input, got a raster",
        { engine: metadata.id },
      );
  }
}

/**
 * Dispatches by `task.op`. Mirrors the canvas adapter's `run`: every stage
 * normalizes its own thrown errors, and this boundary catches anything that
 * escapes anyway so a raw wasm exception still comes out as an `EngineError`.
 */
async function run(task: EngineTask): Promise<EngineResult> {
  try {
    switch (task.op) {
      case "decode":
        return await runDecode(task);
      default:
        throw new EngineError(
          "unsupported",
          `resvg cannot run op "${task.op}"`,
          { engine: metadata.id },
        );
    }
  } catch (e) {
    throw toEngineError(e, metadata.id);
  }
}

/**
 * Builds the `Resvg` instance to render, per `options.width`/`options.height`
 * (`fitTo`'s "width"/"height" mode rasterises crisply at that target instead
 * of decoding at a small intrinsic size and upscaling later). With neither
 * option, renders at the SVG's own intrinsic size — probed with one throwaway
 * instance — unless that exceeds `MAX_DIMENSION` on its long side, in which
 * case a second instance is built with a capping `fitTo`.
 *
 * No system fonts are loaded (`font.loadSystemFonts: false`) — a worker has
 * none to load anyway, and SVG text without an embedded font simply won't
 * render. Known limitation; bundling a default font is future work.
 *
 * resvg-wasm has no network access at all (it's wasm) and never fetches an
 * `<image href="...">`'s target on its own — `imagesToResolve()`/
 * `resolveImage()` exist for a caller who wants to supply one, which this
 * adapter never calls, so an external href simply renders as empty space
 * rather than triggering any request. See the "does not fetch" test below.
 */
async function buildResvg(
  svgText: string,
  options: Readonly<Record<string, unknown>>,
): Promise<ResvgHandle> {
  const { Resvg } = await import("@resvg/resvg-wasm");
  const font = { loadSystemFonts: false } as const;

  const optWidth =
    typeof options.width === "number" ? options.width : undefined;
  const optHeight =
    typeof options.height === "number" ? options.height : undefined;

  if (optWidth !== undefined) {
    return new Resvg(svgText, {
      fitTo: { mode: "width", value: optWidth },
      font,
    });
  }
  if (optHeight !== undefined) {
    return new Resvg(svgText, {
      fitTo: { mode: "height", value: optHeight },
      font,
    });
  }

  const probe = new Resvg(svgText, { font });
  const longSide = Math.max(probe.width, probe.height);
  if (longSide <= MAX_DIMENSION) {
    return probe;
  }

  const capFitTo =
    probe.width >= probe.height
      ? ({ mode: "width", value: MAX_DIMENSION } as const)
      : ({ mode: "height", value: MAX_DIMENSION } as const);
  probe.free();
  return new Resvg(svgText, { fitTo: capFitTo, font });
}

/** decode: SVG bytes -> `RasterImage`, rasterised by resvg. */
async function runDecode(task: EngineTask): Promise<EngineResult> {
  const { input, options, signal, onProgress } = task;
  signal.throwIfAborted();

  const svgText = await inputToBlob(input).text();
  signal.throwIfAborted();

  let resvg: ResvgHandle;
  try {
    resvg = await buildResvg(svgText, options);
  } catch (e) {
    throw new EngineError("decode-failed", "failed to parse SVG", {
      engine: metadata.id,
      cause: e,
    });
  }

  try {
    signal.throwIfAborted();
    onProgress?.(0.5);

    const rendered = resvg.render();
    try {
      const image: RasterImage = {
        width: rendered.width,
        height: rendered.height,
        data: new Uint8ClampedArray(rendered.pixels),
      };
      onProgress?.(1);
      return { kind: "raster", image };
    } finally {
      rendered.free();
    }
  } finally {
    resvg.free();
  }
}

function dispose(): void {
  // wasm-bindgen's `initWasm()` runs once per module instance and exposes no
  // API to free the underlying WebAssembly.Memory — same constraint as an
  // Emscripten-built engine (docs/ENGINES.md, "Terminate the worker to free
  // the heap"). Per-decode `Resvg`/`RenderedImage` instances are already
  // freed in `runDecode`; reclaiming what's left means terminating the
  // worker that hosts this engine.
}

export default defineEngine({
  ...metadata,
  // Checked by check-sizes.ts against built chunks — must be a string
  // literal (see EngineMarker's doc comment in ../types.ts), never computed.
  marker: "localvert-engine:resvg",
  supports,
  load,
});
