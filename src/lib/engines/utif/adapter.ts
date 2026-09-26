import { decode, decodeImage, toRGBA8 } from "utif2";
import type { Operation, StepFormat } from "@/lib/registry";
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
  version: ENGINE_MANIFEST.utif.version,
} satisfies Pick<
  EngineAdapter,
  "id" | "version" | "license" | "location" | "needsIsolation" | "heavy"
>;

function supports(
  op: Operation,
  input: StepFormat,
  output: StepFormat,
): boolean {
  return op === "decode" && input === "tiff" && output === "raster";
}

/**
 * `utif2` is pure JS (plus `pako` for LZW/deflate-compressed TIFFs) — no
 * wasm, no fetched asset, hence `location: "bundled"` and nothing for
 * `load()` to initialise ahead of time.
 */
async function load(_ctx: EngineLoadContext): Promise<EngineInstance> {
  return { run, dispose };
}

/** Reads `task.input` down to the `ArrayBuffer` `UTIF.decode` wants. */
async function inputToBytes(input: EngineInput): Promise<ArrayBuffer> {
  switch (input.kind) {
    case "blob":
      return input.blob.arrayBuffer();
    case "bytes":
      return input.bytes;
    case "opfs":
      throw new EngineError(
        "unsupported",
        "utif engine does not read OPFS inputs",
        { engine: metadata.id },
      );
    case "raster":
      throw new EngineError(
        "internal",
        "utif expected a bytes/blob input, got a raster",
        { engine: metadata.id },
      );
  }
}

async function run(task: EngineTask): Promise<EngineResult> {
  try {
    switch (task.op) {
      case "decode":
        return await runDecode(task);
      default:
        throw new EngineError(
          "unsupported",
          `utif cannot run op "${task.op}"`,
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
 * decode: TIFF bytes -> `RasterImage`, first page only (ADR-0007: animated/
 * multi-page sources convert as their first frame). `UTIF.decode` reads
 * every IFD's tags (dimensions, compression, ...) without touching pixel
 * data; `decodeImage` then decompresses that one page's pixels into it, and
 * `toRGBA8` normalises whatever channel layout/bit depth the page actually
 * used down to the 8-bit RGBA this pipeline's `RasterImage` always is.
 */
async function runDecode(task: EngineTask): Promise<EngineResult> {
  const { input, signal, onProgress } = task;
  signal.throwIfAborted();

  const bytes = await inputToBytes(input);
  signal.throwIfAborted();

  let ifds: ReturnType<typeof decode>;
  try {
    ifds = decode(bytes);
  } catch (e) {
    throw new EngineError("decode-failed", "failed to parse TIFF", {
      engine: metadata.id,
      cause: e,
    });
  }
  const ifd = ifds[0];
  if (!ifd) {
    throw new EngineError("decode-failed", "TIFF has no image pages", {
      engine: metadata.id,
    });
  }

  onProgress?.(0.3);
  signal.throwIfAborted();

  let rgba: Uint8Array;
  try {
    // `decodeImage` is what actually sets `ifd.width`/`ifd.height` (an IFD
    // from `decode` alone only has its *tags*, not decoded dimensions —
    // see the doc comment on `decodeImage` in utif2's own .d.ts) and
    // decompresses the pixel data into it.
    decodeImage(bytes, ifd);
    rgba = toRGBA8(ifd);
  } catch (e) {
    throw new EngineError("decode-failed", "failed to decode TIFF image data", {
      engine: metadata.id,
      cause: e,
    });
  }
  // `UTIF.decodeImage` doesn't always throw on unparseable image data either
  // — on garbage input it can silently leave `width`/`height` unset instead.
  // A "successfully decoded" page with no real dimensions is exactly as
  // unusable as a thrown error, so it's rejected the same way here.
  if (typeof ifd.width !== "number" || typeof ifd.height !== "number") {
    throw new EngineError(
      "decode-failed",
      "TIFF page has no readable dimensions",
      {
        engine: metadata.id,
      },
    );
  }

  onProgress?.(1);
  return {
    kind: "raster",
    image: {
      width: ifd.width,
      height: ifd.height,
      // Copied into a fresh, plainly-backed array — see the identical note
      // in ../resvg/adapter.ts and ../psd/adapter.ts — rather than trusting
      // whatever buffer the library's own decode returned.
      data: new Uint8ClampedArray(rgba),
    },
  };
}

function dispose(): void {
  // No engine-owned resources (no wasm heap, no worker) to release.
}

export default defineEngine({
  ...metadata,
  // Checked by check-sizes.ts against built chunks — must be a string
  // literal (see EngineMarker's doc comment in ../types.ts), never computed.
  marker: "localvert-engine:utif",
  supports,
  load,
});
