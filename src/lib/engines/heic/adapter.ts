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
} from "../types";
import meta from "./engine.json";

/**
 * `engine.json` is the single source of truth for this adapter's metadata —
 * see the identical cast in `../canvas/adapter.ts`. ADR-0002 governs this
 * engine specifically: `heic-to` wraps libheif, LGPL-3.0.
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
  return op === "decode" && input === "heic" && output === "raster";
}

/**
 * Decode only, per ADR-0007 — this engine never appears on the encode side
 * of any pipeline, and `heic-to` has no encoder of its own anyway.
 *
 * `heic-to/next` (not the bare `heic-to` or `heic-to/csp` entry points) is
 * the variant its own README documents for use inside a Web Worker, which is
 * exactly where this adapter always runs. It is a single self-contained
 * module with no relative imports of its own — no wasm/asm.js asset for
 * `engine.json` to place under `public/engines/`, hence `location:
 * "bundled"`. It ships as libheif compiled to asm.js (built with
 * `USE_WASM=0` — see its own `README.md`'s build instructions), not actual
 * WebAssembly, and internally spins up its own nested Worker (via a `blob:`
 * URL, not a network fetch) to isolate that heavy synchronous decode off
 * this worker's own event loop. Both are implementation details of the
 * library; neither changes this adapter's contract.
 */
async function load(_ctx: EngineLoadContext): Promise<EngineInstance> {
  const { heicTo } = await import("heic-to/next");
  return { run: (task) => run(task, heicTo), dispose };
}

/** Reads `task.input` down to a `Blob` — the only shape `heicTo` accepts. */
function inputToBlob(input: EngineInput): Blob {
  switch (input.kind) {
    case "blob":
      return input.blob;
    case "bytes":
      return new Blob([input.bytes]);
    case "opfs":
      throw new EngineError(
        "unsupported",
        "heic engine does not read OPFS inputs",
        { engine: metadata.id },
      );
    case "raster":
      throw new EngineError(
        "internal",
        "heic expected a blob/bytes input, got a raster",
        { engine: metadata.id },
      );
  }
}

type HeicTo = typeof import("heic-to/next").heicTo;

async function run(task: EngineTask, heicTo: HeicTo): Promise<EngineResult> {
  try {
    switch (task.op) {
      case "decode":
        return await runDecode(task, heicTo);
      default:
        throw new EngineError(
          "unsupported",
          `heic cannot run op "${task.op}"`,
          {
            engine: metadata.id,
          },
        );
    }
  } catch (e) {
    throw toEngineError(e, metadata.id);
  }
}

/**
 * decode: HEIC/HEIF bytes -> `RasterImage`. `heicTo`'s `type: "bitmap"`
 * variant hands back an `ImageBitmap` directly (no intermediate re-encode to
 * a lossy format), which is then read down to raw pixels through
 * OffscreenCanvas + `getImageData` — the same last step every other
 * decode-only engine in this pipeline ends with (ADR-0007).
 */
async function runDecode(
  task: EngineTask,
  heicTo: HeicTo,
): Promise<EngineResult> {
  const { input, signal, onProgress } = task;
  signal.throwIfAborted();

  const blob = inputToBlob(input);

  let bitmap: ImageBitmap;
  try {
    bitmap = await heicTo({
      blob,
      type: "bitmap",
      options: { imageOrientation: "from-image" },
    });
  } catch (e) {
    throw new EngineError("decode-failed", "failed to decode heic/heif", {
      engine: metadata.id,
      cause: e,
    });
  }

  try {
    signal.throwIfAborted();
    onProgress?.(0.7);

    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new EngineError(
        "internal",
        "failed to acquire a 2d canvas context",
        { engine: metadata.id },
      );
    }
    ctx.drawImage(bitmap, 0, 0);
    const { data, width, height } = ctx.getImageData(
      0,
      0,
      canvas.width,
      canvas.height,
    );

    onProgress?.(1);
    return { kind: "raster", image: { width, height, data } };
  } finally {
    bitmap.close();
  }
}

function dispose(): void {
  // `heic-to` owns and tears down its own internal worker per call — no
  // engine-owned resource persists between `run()` calls for this adapter to
  // release.
}

export default defineEngine({
  ...metadata,
  // Checked by check-sizes.ts against built chunks — must be a string
  // literal (see EngineMarker's doc comment in ../types.ts), never computed.
  marker: "localvert-engine:heic",
  supports,
  load,
});
