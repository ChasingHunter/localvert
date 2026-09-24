import type { FormatId, Operation } from "@/lib/registry";
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
} from "../types";
import meta from "./engine.json";

/**
 * `engine.json` is the single source of truth for this adapter's metadata,
 * shared with the codegen that builds `manifest.ts`. A JSON import widens
 * literal types (e.g. `location: string` instead of `EngineLocation`), so
 * this cast narrows it back to what `EngineAdapter` expects. `defineEngine`
 * below validates the actual values at runtime, so a typo in engine.json
 * (a bad semver, a stray space in `license`) still fails loudly rather than
 * silently passing the cast.
 */
const metadata = meta as Pick<
  EngineAdapter,
  "id" | "version" | "license" | "location" | "needsIsolation" | "heavy"
>;

const SUPPORTED_INPUTS: readonly FormatId[] = [
  "jpg",
  "png",
  "webp",
  "bmp",
  "gif",
];
const SUPPORTED_OUTPUTS: readonly FormatId[] = ["jpg", "png", "webp"];

function supports(op: Operation, input: FormatId, output: FormatId): boolean {
  return (
    op === "transcode" &&
    SUPPORTED_INPUTS.includes(input) &&
    SUPPORTED_OUTPUTS.includes(output)
  );
}

async function load(_ctx: EngineLoadContext): Promise<EngineInstance> {
  if (
    typeof OffscreenCanvas !== "function" ||
    typeof createImageBitmap !== "function"
  ) {
    throw new EngineError(
      "unsupported",
      "OffscreenCanvas or createImageBitmap is not available",
      { engine: metadata.id },
    );
  }
  return { run, dispose };
}

/** Reads `task.input` down to a `Blob`, the only shape `createImageBitmap` accepts. */
function inputToBlob(input: EngineInput): Blob {
  switch (input.kind) {
    case "blob":
      return input.blob;
    case "bytes":
      return new Blob([input.bytes]);
    case "opfs":
      throw new EngineError(
        "unsupported",
        "canvas engine does not read OPFS inputs",
        { engine: metadata.id },
      );
  }
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/**
 * Re-encodes an image through `<canvas>`. This drops EXIF and other embedded
 * metadata (including GPS) on every conversion — intentional for privacy, not
 * a bug to fix. An animated GIF or WebP input decodes to its first frame
 * only; `createImageBitmap` has no concept of subsequent frames.
 */
async function run(task: EngineTask): Promise<EngineResult> {
  try {
    return await runStages(task);
  } catch (e) {
    // Normalizes any raw thrown value at this adapter's boundary — notably
    // the DOMException `signal.throwIfAborted()` throws, which becomes a
    // proper `EngineError("aborted", ...)` here. An `EngineError` thrown by
    // a stage below (decode-failed, encode-failed, unsupported) passes
    // through toEngineError unchanged.
    throw toEngineError(e, metadata.id);
  }
}

async function runStages(task: EngineTask): Promise<EngineResult> {
  const { input, outputFormat, options, signal, onProgress } = task;
  signal.throwIfAborted();

  const blob = inputToBlob(input);

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob, {
      imageOrientation: "from-image",
      premultiplyAlpha: "none",
      colorSpaceConversion: "default",
    });
  } catch (e) {
    throw new EngineError("decode-failed", "failed to decode source image", {
      engine: metadata.id,
      cause: e,
    });
  }

  try {
    onProgress?.(0.1);
    signal.throwIfAborted();

    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new EngineError(
        "internal",
        "failed to acquire a 2d canvas context",
        {
          engine: metadata.id,
        },
      );
    }

    if (outputFormat === "jpg") {
      // jpg has no alpha channel — without a fill, transparent source pixels
      // encode as black instead of whatever background the user expects.
      const background =
        typeof options.background === "string" ? options.background : "#ffffff";
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(bitmap, 0, 0);

    signal.throwIfAborted();

    const mime = FORMATS[outputFormat].mime;
    const quality =
      outputFormat === "jpg" || outputFormat === "webp"
        ? clamp01(typeof options.quality === "number" ? options.quality : 0.92)
        : undefined;

    const encoded = await canvas.convertToBlob(
      quality === undefined ? { type: mime } : { type: mime, quality },
    );
    // Browsers silently fall back to PNG for a type they cannot encode
    // (e.g. webp on Safari) rather than rejecting the promise.
    if (encoded.type !== mime) {
      throw new EngineError("encode-failed", `browser cannot encode ${mime}`, {
        engine: metadata.id,
      });
    }

    onProgress?.(0.9);
    signal.throwIfAborted();

    const bytes = await encoded.arrayBuffer();
    onProgress?.(1);
    return { kind: "bytes", bytes, mime };
  } finally {
    bitmap.close();
  }
}

function dispose(): void {
  // No engine-owned resources (no wasm heap, no worker) to release.
}

export default defineEngine({
  ...metadata,
  // Checked by check-sizes.ts against built chunks — must be a string
  // literal (see EngineMarker's doc comment in ../types.ts), never computed.
  marker: "localvert-engine:canvas",
  supports,
  load,
});
