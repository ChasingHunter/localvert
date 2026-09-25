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
} from "../types";
import meta from "./engine.json";
import { stripJpeg, stripPng, stripWebp } from "./strip";

/**
 * `engine.json` is the single source of truth for this adapter's metadata —
 * see the matching comment in `../canvas/adapter.ts` for why this cast is
 * safe (`defineEngine` below validates the real values at runtime).
 */
const metadata = meta as Pick<
  EngineAdapter,
  "id" | "version" | "license" | "location" | "needsIsolation" | "heavy"
>;

/** The only formats this engine's one op (`strip`) knows how to walk. */
const STRIPPABLE: readonly StepFormat[] = ["jpg", "png", "webp"];

function isStrippable(format: StepFormat): format is "jpg" | "png" | "webp" {
  return (STRIPPABLE as readonly string[]).includes(format);
}

/**
 * `strip` is byte-to-byte (ADR-0007: "Tools that can keep the file's bytes
 * ... still use a single byte-to-byte step") — input and output format are
 * always the same concrete format, never `"raster"`.
 */
function supports(
  op: Operation,
  input: StepFormat,
  output: StepFormat,
): boolean {
  return op === "strip" && input === output && isStrippable(input);
}

async function load(_ctx: EngineLoadContext): Promise<EngineInstance> {
  // Pure JS, no wasm/asset init — see engine.json's location: "bundled".
  return { run, dispose };
}

/** Reads `task.input` down to bytes — the only shape `strip.ts`'s functions
 * accept. */
async function inputToBytes(input: EngineInput): Promise<Uint8Array> {
  switch (input.kind) {
    case "blob":
      return new Uint8Array(await input.blob.arrayBuffer());
    case "bytes":
      return new Uint8Array(input.bytes);
    case "opfs":
      throw new EngineError(
        "unsupported",
        "exif engine does not read OPFS inputs",
        { engine: metadata.id },
      );
    case "raster":
      throw new EngineError(
        "internal",
        "exif expected a blob/bytes input, got a raster",
        { engine: metadata.id },
      );
  }
}

async function run(task: EngineTask): Promise<EngineResult> {
  try {
    if (task.op !== "strip") {
      throw new EngineError("unsupported", `exif cannot run op "${task.op}"`, {
        engine: metadata.id,
      });
    }
    const format = task.inputFormat;
    if (!isStrippable(format)) {
      throw new EngineError(
        "unsupported",
        `exif cannot strip format "${format}"`,
        { engine: metadata.id },
      );
    }

    task.signal.throwIfAborted();
    const bytes = await inputToBytes(task.input);
    task.signal.throwIfAborted();

    const keepOrientation = task.options.keepOrientation !== false;
    let stripped: Uint8Array;
    switch (format) {
      case "jpg":
        stripped = stripJpeg(bytes, { keepOrientation });
        break;
      case "png":
        stripped = stripPng(bytes);
        break;
      case "webp":
        stripped = stripWebp(bytes);
        break;
    }

    task.onProgress?.(1);
    return {
      kind: "bytes",
      bytes: stripped.buffer as ArrayBuffer,
      mime: FORMATS[format].mime,
    };
  } catch (e) {
    throw toEngineError(e, metadata.id);
  }
}

function dispose(): void {
  // No engine-owned resources (no wasm heap, no worker) to release.
}

export default defineEngine({
  ...metadata,
  // Checked by check-sizes.ts against built chunks — must be a string
  // literal (see EngineMarker's doc comment in ../types.ts), never computed.
  marker: "localvert-engine:exif",
  supports,
  load,
});
