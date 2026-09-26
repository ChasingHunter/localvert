import resize, { initResize } from "@jsquash/resize";
import type { Operation, StepFormat } from "@/lib/registry";
import { defineEngine } from "../define-engine";
import { EngineError, toEngineError } from "../errors";
import { ENGINE_MANIFEST } from "../manifest";
import { computeResizeDims, parseResizeOptions } from "../shared/resize-box";
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
  version: ENGINE_MANIFEST["jsquash-resize"].version,
} satisfies Pick<
  EngineAdapter,
  "id" | "version" | "license" | "location" | "needsIsolation" | "heavy"
>;

const RESIZE_WASM_FILE = "squoosh_resize_bg.wasm";

function supports(
  op: Operation,
  input: StepFormat,
  output: StepFormat,
): boolean {
  return op === "resize" && input === "raster" && output === "raster";
}

/**
 * Fetches `${baseUrl}${file}` and compiles it without instantiating.
 * `@jsquash/resize`'s `initResize` accepts a precompiled `WebAssembly.Module`
 * directly (its `InitInput` union includes it), so — unlike jsquash-webp's
 * Emscripten build — no `instantiateWasm` indirection is needed here. Never
 * calling `initResize()` with no argument at all is what matters: with no
 * argument it fetches `squoosh_resize_bg.wasm` relative to the installed npm
 * package, a URL that doesn't exist in our build and would violate
 * `connect-src 'self'` even if it did.
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

async function load(ctx: EngineLoadContext): Promise<EngineInstance> {
  const { baseUrl } = ctx;

  // Memoized so a second `run()` on this instance reuses the same wasm
  // module instead of recompiling it. `.catch` clears the memo on failure —
  // a transient fetch error shouldn't permanently strand this engine
  // instance, matching `engine-host.ts`'s `loadEngine`.
  let resizeReady: Promise<void> | undefined;
  function ensureResizeReady(): Promise<void> {
    if (!resizeReady) {
      resizeReady = (async () => {
        const module = await compileWasm(baseUrl, RESIZE_WASM_FILE);
        await initResize(module);
      })().catch((e: unknown) => {
        resizeReady = undefined;
        throw e;
      });
    }
    return resizeReady;
  }

  async function run(task: EngineTask): Promise<EngineResult> {
    try {
      if (task.op !== "resize") {
        throw new EngineError(
          "unsupported",
          `jsquash-resize cannot run op "${task.op}"`,
          { engine: metadata.id },
        );
      }
      return await runResize(task, ensureResizeReady);
    } catch (e) {
      throw toEngineError(e, metadata.id);
    }
  }

  function dispose(): void {
    // wasm-bindgen's linear memory isn't reclaimable from JS once
    // allocated — the worker pool terminates the whole worker to actually
    // free it (see the add-engine skill and docs/ENGINES.md, "Terminate the
    // worker to free the heap"). Nothing for this adapter to do on its own.
  }

  return { run, dispose };
}

/** Reads `task.input` down to a `RasterImage` — the only shape `resize` accepts. */
function inputToRaster(input: EngineInput): RasterImage {
  if (input.kind !== "raster") {
    throw new EngineError(
      "internal",
      `jsquash-resize expected a raster input, got "${input.kind}"`,
      { engine: metadata.id },
    );
  }
  return input.image;
}

/**
 * resize: `RasterImage` -> `RasterImage`, scaled per `computeResizeDims`
 * (`../shared/resize-box`, shared with `canvas` so both engines agree on the
 * output size for the same options). The target box is already fully
 * resolved by the time jSquash's `resize` runs, so it always gets called
 * with `fitMethod: "stretch"` — jSquash's own "contain" fit would duplicate
 * (and, if it ever diverged, contradict) the shared helper's math.
 */
async function runResize(
  task: EngineTask,
  ensureResizeReady: () => Promise<void>,
): Promise<EngineResult> {
  const { input, options, signal, onProgress } = task;
  signal.throwIfAborted();

  const image = inputToRaster(input);
  const resizeOpts = parseResizeOptions(options);

  if (resizeOpts.width === undefined && resizeOpts.height === undefined) {
    onProgress?.(1);
    return { kind: "raster", image };
  }

  const dims = computeResizeDims(image.width, image.height, resizeOpts);

  await ensureResizeReady();
  signal.throwIfAborted();
  onProgress?.(0.3);

  let result: ImageData;
  try {
    result = await resize(
      new ImageData(image.data, image.width, image.height),
      {
        width: dims.width,
        height: dims.height,
        method: "lanczos3",
        fitMethod: "stretch",
      },
    );
  } catch (e) {
    throw new EngineError(
      "internal",
      "jsquash-resize failed to resize the image",
      {
        engine: metadata.id,
        cause: e,
      },
    );
  }

  onProgress?.(1);
  return {
    kind: "raster",
    image: { width: result.width, height: result.height, data: result.data },
  };
}

export default defineEngine({
  ...metadata,
  // Checked by check-sizes.ts against built chunks — must be a string
  // literal (see EngineMarker's doc comment in ../types.ts), never computed.
  marker: "localvert-engine:jsquash-resize",
  supports,
  load,
});
