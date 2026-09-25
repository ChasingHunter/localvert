import type { Operation, StepFormat } from "@/lib/registry";
import { FORMATS, parsePageRange } from "@/lib/registry";
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
  if (input !== "pdf" || output !== "pdf") return false;
  return op === "merge" || op === "split";
}

/**
 * ADR-0008: byte-level PDF structure edits, not a raster pipeline — `merge`
 * and `split` both go pdf -> pdf (or pdf -> many pdfs), never through a
 * `RasterImage` intermediate. `@cantoo/pdf-lib` is pure JS (no wasm, no
 * separate fetched assets), so — like `psd`/`tracer`/`utif`/`exif` — this
 * adapter's whole implementation ships inside its own lazily-imported worker
 * chunk; `load()` has nothing to initialise ahead of time, and the actual
 * `import("@cantoo/pdf-lib")` happens inside `run()`, once per call.
 */
async function load(_ctx: EngineLoadContext): Promise<EngineInstance> {
  return { run, dispose };
}

/** Reads one `EngineInput` down to an `ArrayBuffer` — what `PDFDocument.load`
 * requires. Mirrors `psd/adapter.ts`'s `inputToArrayBuffer`. */
function inputToArrayBuffer(input: EngineInput): Promise<ArrayBuffer> {
  switch (input.kind) {
    case "blob":
      return input.blob.arrayBuffer();
    case "bytes":
      return Promise.resolve(input.bytes);
    case "opfs":
      throw new EngineError(
        "unsupported",
        "pdf-lib engine does not read OPFS inputs",
        { engine: metadata.id },
      );
    case "raster":
      throw new EngineError(
        "internal",
        "pdf-lib expected a blob/bytes input, got a raster",
        { engine: metadata.id },
      );
  }
}

/**
 * The basename (no extension) of a `"blob"` input's own filename, for
 * naming `split`'s output files (e.g. `report-page-3.pdf`). `EngineInput`'s
 * `blob` is typed as a plain `Blob`, but `job-engine.ts` always wraps the
 * real dropped `File` in it, which carries `.name` — read defensively
 * (`"name" in blob`) rather than assumed, since a bare `Blob` (e.g. in a
 * unit test) legitimately has none. Falls back to `fallback` either way.
 */
function inputBaseName(input: EngineInput, fallback: string): string {
  if (input.kind !== "blob") return fallback;
  const { blob } = input;
  const name =
    "name" in blob && typeof blob.name === "string" ? blob.name : undefined;
  if (!name) return fallback;
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? name : name.slice(0, dot);
}

async function run(task: EngineTask): Promise<EngineResult> {
  try {
    switch (task.op) {
      case "merge":
        return await runMerge(task);
      case "split":
        return await runSplit(task);
      default:
        throw new EngineError(
          "unsupported",
          `pdf-lib cannot run op "${task.op}"`,
          { engine: metadata.id },
        );
    }
  } catch (e) {
    throw toEngineError(e, metadata.id);
  }
}

type PdfLibModule = typeof import("@cantoo/pdf-lib");

/**
 * Loads a PDF, mapping `@cantoo/pdf-lib`'s own errors onto ours: an
 * encrypted document (the library refuses to touch it unless the caller
 * explicitly opts in with `ignoreEncryption`, which we never do — unlocking
 * is its own tool) becomes `"unsupported"` with a message a user can act on;
 * anything else that fails to parse becomes `"decode-failed"`. Takes the
 * already-imported module (rather than importing it itself) so `runMerge`'s
 * loop pays for `import("@cantoo/pdf-lib")` once, not once per input file —
 * the browser's module cache makes repeat calls cheap either way, but there
 * is no reason to call it N times in a loop when the caller already has it.
 */
async function loadPdf(
  mod: PdfLibModule,
  bytes: ArrayBuffer,
): Promise<Awaited<ReturnType<PdfLibModule["PDFDocument"]["load"]>>> {
  try {
    return await mod.PDFDocument.load(bytes);
  } catch (e) {
    if (e instanceof mod.EncryptedPDFError) {
      throw new EngineError(
        "unsupported",
        "This PDF is password-protected — unlock it first",
        { engine: metadata.id, cause: e },
      );
    }
    throw new EngineError("decode-failed", "failed to parse PDF", {
      engine: metadata.id,
      cause: e,
    });
  }
}

/**
 * merge: every input, in the user's own order (`task.inputs` — ADR-0008),
 * copied page-for-page into one new document. `task.input` (the first file
 * again) is unused here; `inputs` is the source of truth for a many-to-one
 * step.
 */
async function runMerge(task: EngineTask): Promise<EngineResult> {
  const { inputs, signal, onProgress } = task;
  signal.throwIfAborted();

  if (!inputs || inputs.length === 0) {
    throw new EngineError("internal", "merge requires at least one input", {
      engine: metadata.id,
    });
  }

  const mod = await import("@cantoo/pdf-lib");
  const outDoc = await mod.PDFDocument.create();

  for (let i = 0; i < inputs.length; i++) {
    signal.throwIfAborted();
    const current = inputs[i];
    if (!current) continue; // unreachable: guarded by `i < inputs.length`
    const bytes = await inputToArrayBuffer(current);
    signal.throwIfAborted();
    const srcDoc = await loadPdf(mod, bytes);
    const copied = await outDoc.copyPages(srcDoc, srcDoc.getPageIndices());
    for (const page of copied) outDoc.addPage(page);
    onProgress?.((i + 1) / inputs.length);
  }

  const bytes = await outDoc.save();
  return { kind: "bytes", bytes: bytes.slice().buffer, mime: FORMATS.pdf.mime };
}

interface SplitPart {
  name: string;
  indices: number[];
}

/** Builds each output part's name + page indices from `options` (the tool's
 * whole parsed options object — see `EngineTask.options`'s doc comment).
 * `"each"` (the default) is one part per page; `"ranges"` splits
 * `options.ranges` on `;` — each segment is its own output, itself parsed by
 * the shared `parsePageRange` (so "1-3,5; 8-" is two parts, the first with
 * its own comma list). */
function buildParts(
  options: Readonly<Record<string, unknown>>,
  pageCount: number,
  base: string,
): SplitPart[] {
  const mode = options.mode === "ranges" ? "ranges" : "each";

  if (mode === "each") {
    return Array.from({ length: pageCount }, (_, i) => ({
      name: `${base}-page-${i + 1}.pdf`,
      indices: [i],
    }));
  }

  const raw = typeof options.ranges === "string" ? options.ranges : "";
  return raw
    .split(";")
    .map((segment) => segment.trim())
    .filter((segment) => segment !== "")
    .map((segment, k) => ({
      name: `${base}-part-${k + 1}.pdf`,
      indices: parsePageRange(segment, pageCount),
    }));
}

/** split: one input PDF -> N output PDFs (ADR-0008 one-to-many), named by
 * `buildParts` above. */
async function runSplit(task: EngineTask): Promise<EngineResult> {
  const { input, options, signal, onProgress } = task;
  signal.throwIfAborted();

  const bytes = await inputToArrayBuffer(input);
  signal.throwIfAborted();

  const mod = await import("@cantoo/pdf-lib");
  const srcDoc = await loadPdf(mod, bytes);

  const base = inputBaseName(input, "document");
  const parts = buildParts(options, srcDoc.getPageCount(), base);
  if (parts.length === 0) {
    throw new EngineError("internal", "split produced no output pages", {
      engine: metadata.id,
    });
  }

  const files: { name: string; bytes: ArrayBuffer; mime: string }[] = [];
  for (let i = 0; i < parts.length; i++) {
    signal.throwIfAborted();
    const part = parts[i];
    if (!part) continue; // unreachable: guarded by `i < parts.length`
    const outDoc = await mod.PDFDocument.create();
    const copied = await outDoc.copyPages(srcDoc, part.indices);
    for (const page of copied) outDoc.addPage(page);
    const outBytes = await outDoc.save();
    files.push({
      name: part.name,
      bytes: outBytes.slice().buffer,
      mime: FORMATS.pdf.mime,
    });
    onProgress?.((i + 1) / parts.length);
  }

  return { kind: "files", files };
}

function dispose(): void {
  // No engine-owned resources (no wasm heap, no worker) to release — see
  // `load`'s doc comment.
}

export default defineEngine({
  ...metadata,
  // Checked by check-sizes.ts against built chunks — must be a string
  // literal (see EngineMarker's doc comment in ../types.ts), never computed.
  marker: "localvert-engine:pdf-lib",
  supports,
  load,
});
