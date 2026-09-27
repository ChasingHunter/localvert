import { unzipSync } from "fflate";
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
import { epubFilesToHtml } from "./epub";

/**
 * `epub-to-pdf`'s first step (docs/adr/0012-libreoffice-office-to-pdf.md's
 * EPUB addendum): epub -> html, so the second step can hand the result to
 * `libreoffice`'s own `html -> pdf` transcode — LibreOffice has no EPUB
 * import filter of its own. Pure JS, no wasm: `fflate` (already a
 * dependency) unzips the epub; `./epub.ts` does the OPF/spine/image-inlining
 * work. See that file's own doc comment for what this deliberately doesn't
 * handle (NCX/nav fallback, encryption, fixed-layout metadata).
 */
const metadata = {
  ...(meta as Pick<
    EngineAdapter,
    "id" | "license" | "location" | "needsIsolation" | "heavy"
  >),
  version: ENGINE_MANIFEST.epub.version,
} satisfies Pick<
  EngineAdapter,
  "id" | "version" | "license" | "location" | "needsIsolation" | "heavy"
>;

function supports(
  op: Operation,
  input: StepFormat,
  output: StepFormat,
): boolean {
  return op === "transcode" && input === "epub" && output === "html";
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
        "epub engine does not read OPFS inputs",
        { engine: metadata.id },
      );
    case "raster":
      throw new EngineError(
        "internal",
        "epub expected a bytes/blob input, got a raster",
        { engine: metadata.id },
      );
  }
}

async function run(task: EngineTask): Promise<EngineResult> {
  try {
    if (task.op !== "transcode") {
      throw new EngineError(
        "unsupported",
        `epub engine cannot run op "${task.op}"`,
        { engine: metadata.id },
      );
    }
    task.signal.throwIfAborted();

    const bytes = await inputToBytes(task.input);
    let zipFiles: Record<string, Uint8Array>;
    try {
      zipFiles = unzipSync(bytes);
    } catch (e) {
      throw new EngineError(
        "decode-failed",
        `epub: not a valid zip archive (${e instanceof Error ? e.message : String(e)})`,
        { engine: metadata.id, cause: e },
      );
    }

    // `warnings` (a missing spine chapter or manifest entry) is deliberately
    // not surfaced here: this is an intermediate pipeline step (epub -> html
    // -> pdf, see this file's doc comment) whose `EngineResult` never
    // reaches `Job.output` — `engine-host.ts`'s `resultToInput` only forwards
    // `bytes` between steps. A missing *image* still gets an in-place marker
    // (see `inlineImages`'s HTML comment) since that lands in the document
    // itself either way; a missing chapter is dropped silently rather than
    // failing the whole conversion.
    const { html } = epubFilesToHtml(new Map(Object.entries(zipFiles)));

    task.onProgress?.(1);
    return {
      kind: "bytes",
      bytes: new TextEncoder().encode(html).buffer,
      mime: "text/html",
    };
  } catch (e) {
    throw toEngineError(e, metadata.id);
  }
}

export default defineEngine({
  ...metadata,
  marker: "localvert-engine:epub",
  supports,
  load,
});
