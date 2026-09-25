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

function supports(
  op: Operation,
  input: StepFormat,
  output: StepFormat,
): boolean {
  return op === "decode" && input === "psd" && output === "raster";
}

/**
 * `@webtoon/psd` is "bundled" (ADR: see `engine.json`'s `location`) — a
 * zero-dependency package whose own decoder (including its RLE wasm, inlined
 * as a base64 data URL in its published JS) ships inside this adapter's
 * lazily-imported chunk, not as a separate fetched asset. There is nothing
 * for `load()` to initialise ahead of time.
 */
async function load(_ctx: EngineLoadContext): Promise<EngineInstance> {
  return { run, dispose };
}

/** Reads `task.input` down to an `ArrayBuffer` — what `Psd.parse` requires. */
function inputToArrayBuffer(input: EngineInput): Promise<ArrayBuffer> {
  switch (input.kind) {
    case "blob":
      return input.blob.arrayBuffer();
    case "bytes":
      return Promise.resolve(input.bytes);
    case "opfs":
      throw new EngineError(
        "unsupported",
        "psd engine does not read OPFS inputs",
        { engine: metadata.id },
      );
    case "raster":
      throw new EngineError(
        "internal",
        "psd expected a blob/bytes input, got a raster",
        { engine: metadata.id },
      );
  }
}

/**
 * Dispatches by `task.op`. Mirrors the canvas adapter's `run`: every stage
 * normalizes its own thrown errors, and this boundary catches anything that
 * escapes anyway so a raw parser exception still comes out as an
 * `EngineError`.
 */
async function run(task: EngineTask): Promise<EngineResult> {
  try {
    switch (task.op) {
      case "decode":
        return await runDecode(task);
      default:
        throw new EngineError("unsupported", `psd cannot run op "${task.op}"`, {
          engine: metadata.id,
        });
    }
  } catch (e) {
    throw toEngineError(e, metadata.id);
  }
}

/**
 * decode: PSD bytes -> `RasterImage`, via `@webtoon/psd`'s own flattened
 * composite (the "merged image" Photoshop stores in the file, not a
 * from-scratch layer composite) — the same shape every other decode-only
 * engine in this pipeline hands back (ADR-0007).
 */
async function runDecode(task: EngineTask): Promise<EngineResult> {
  const { input, signal, onProgress } = task;
  signal.throwIfAborted();

  const buffer = await inputToArrayBuffer(input);
  signal.throwIfAborted();

  const { default: Psd, Depth, ColorMode } = await import("@webtoon/psd");

  let psd: InstanceType<typeof Psd>;
  try {
    psd = Psd.parse(buffer);
  } catch (e) {
    throw new EngineError("decode-failed", "failed to parse PSD", {
      engine: metadata.id,
      cause: e,
    });
  }

  // The library only decodes 8-bit-per-channel, non-CMYK image data — see
  // its ImageData/generateRgba sources. Fail clearly here instead of
  // letting `composite()` throw (or worse, misdecode) further down.
  if (psd.depth !== Depth.Eight) {
    throw new EngineError(
      "decode-failed",
      `psd: unsupported bit depth (${psd.depth}) — only 8-bit PSD files are supported`,
      { engine: metadata.id },
    );
  }
  if (psd.colorMode === ColorMode.Cmyk) {
    throw new EngineError(
      "decode-failed",
      "psd: CMYK color mode is not supported",
      { engine: metadata.id },
    );
  }

  onProgress?.(0.3);
  signal.throwIfAborted();

  let pixels: Uint8ClampedArray;
  try {
    pixels = await psd.composite();
  } catch (e) {
    throw new EngineError("decode-failed", "failed to composite PSD image", {
      engine: metadata.id,
      cause: e,
    });
  }

  const image: RasterImage = {
    width: psd.width,
    height: psd.height,
    // Copied into a fresh, plainly-backed array — see the identical note in
    // ../resvg/adapter.ts — rather than trusting whatever buffer the
    // library's own decode returned.
    data: new Uint8ClampedArray(pixels),
  };
  onProgress?.(1);
  return { kind: "raster", image };
}

function dispose(): void {
  // No engine-owned resources (no wasm heap of our own, no worker) to
  // release — see `load`'s doc comment.
}

export default defineEngine({
  ...metadata,
  // Checked by check-sizes.ts against built chunks — must be a string
  // literal (see EngineMarker's doc comment in ../types.ts), never computed.
  marker: "localvert-engine:psd",
  supports,
  load,
});
