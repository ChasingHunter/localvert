import type { Operation, StepFormat } from "@/lib/registry";
import { FORMATS } from "@/lib/registry";
import { defineEngine } from "../define-engine";
import { EngineError, toEngineError } from "../errors";
import { ENGINE_MANIFEST } from "../manifest";
import type { LayoutDocument } from "../shared/pdf-layout";
import type {
  EngineAdapter,
  EngineInput,
  EngineInstance,
  EngineLoadContext,
  EngineResult,
  EngineTask,
} from "../types";
import meta from "./engine.json";
import { buildDocx } from "./writer";

/**
 * `pdf-to-word`'s second step: reads the `LayoutDocument` JSON `pdfjs`'s own
 * `extractLayout` op produced (see that op's doc comment in
 * `pdfjs/adapter.ts`) and writes a `.docx` from it via `./writer.ts` — pure
 * JS, no wasm, same "bundled" shape as `epub`'s engine (fflate, already a
 * dependency, is the only library involved).
 */
const metadata = {
  ...(meta as Pick<
    EngineAdapter,
    "id" | "license" | "location" | "needsIsolation" | "heavy"
  >),
  version: ENGINE_MANIFEST.docx.version,
} satisfies Pick<
  EngineAdapter,
  "id" | "version" | "license" | "location" | "needsIsolation" | "heavy"
>;

function supports(
  op: Operation,
  input: StepFormat,
  output: StepFormat,
): boolean {
  return op === "transcode" && input === "json" && output === "docx";
}

async function load(_ctx: EngineLoadContext): Promise<EngineInstance> {
  return { run, dispose: () => {} };
}

function inputToBytes(input: EngineInput): Promise<Uint8Array> | Uint8Array {
  switch (input.kind) {
    case "blob":
      return input.blob.arrayBuffer().then((b) => new Uint8Array(b));
    case "bytes":
      return new Uint8Array(input.bytes);
    case "opfs":
      throw new EngineError(
        "unsupported",
        "docx engine does not read OPFS inputs",
        { engine: metadata.id },
      );
    case "raster":
      throw new EngineError(
        "internal",
        "docx expected a bytes/blob input, got a raster",
        { engine: metadata.id },
      );
  }
}

async function run(task: EngineTask): Promise<EngineResult> {
  try {
    if (task.op !== "transcode") {
      throw new EngineError(
        "unsupported",
        `docx engine cannot run op "${task.op}"`,
        { engine: metadata.id },
      );
    }
    task.signal.throwIfAborted();

    const bytes = await inputToBytes(task.input);
    let layoutDoc: LayoutDocument;
    try {
      const json = new TextDecoder().decode(bytes);
      layoutDoc = JSON.parse(json) as LayoutDocument;
    } catch (e) {
      throw new EngineError(
        "decode-failed",
        `docx: not valid layout JSON (${e instanceof Error ? e.message : String(e)})`,
        { engine: metadata.id, cause: e },
      );
    }
    task.signal.throwIfAborted();

    // No `title`: `EngineTask.options` is the *tool's* options, shared
    // across every pipeline step, not per-step input metadata — the
    // original file name (`job-engine.ts`'s own `fileName`) never reaches a
    // second step's `task.input` (always `{kind: "bytes"}` by then, not the
    // original `Blob`). `writer.ts`'s own "Document" fallback applies.
    const pageBreaks = task.options.pageBreaks !== false;
    const docxBytes = buildDocx(layoutDoc, { pageBreaks });

    task.onProgress?.(1);
    return {
      kind: "bytes",
      bytes: docxBytes.buffer.slice(
        docxBytes.byteOffset,
        docxBytes.byteOffset + docxBytes.byteLength,
      ) as ArrayBuffer,
      mime: FORMATS.docx.mime,
    };
  } catch (e) {
    throw toEngineError(e, metadata.id);
  }
}

export default defineEngine({
  ...metadata,
  marker: "localvert-engine:docx",
  supports,
  load,
});
