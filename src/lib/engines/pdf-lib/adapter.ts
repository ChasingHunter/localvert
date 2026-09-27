import type { PDFDict } from "@cantoo/pdf-lib";
import {
  DEFAULT_BLANK_SIZE,
  normalizeRotation,
  validatePlan,
} from "@/lib/editor/page-organizer-plan";
import type { Operation, StepFormat } from "@/lib/registry";
import {
  FORMATS,
  parsePageOrder,
  parsePageRange,
  sniffFormat,
} from "@/lib/registry";
import { defineEngine } from "../define-engine";
import { EngineError, toEngineError } from "../errors";
import { ENGINE_MANIFEST } from "../manifest";
import { neverLarger } from "../shared/never-larger";
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
const metadata = {
  ...(meta as Pick<
    EngineAdapter,
    "id" | "license" | "location" | "needsIsolation" | "heavy"
  >),
  // engine.json has no "version" for this engine (derived from its
  // installed npm package) -- pnpm gen resolves the real value into
  // manifest.ts, which this reads at build time. See docs/ENGINES.md,
  // "How engine assets ship".
  version: ENGINE_MANIFEST["pdf-lib"].version,
} satisfies Pick<
  EngineAdapter,
  "id" | "version" | "license" | "location" | "needsIsolation" | "heavy"
>;

function supports(
  op: Operation,
  input: StepFormat,
  output: StepFormat,
): boolean {
  if (output !== "pdf") return false;
  // images-to-pdf (ADR-0008 many-to-one): jpg/png pages embedded into a new
  // document — the only non-pdf input this engine ever takes.
  if (input === "jpg" || input === "png") return op === "merge";
  if (input !== "pdf") return false;
  return (
    op === "merge" ||
    op === "split" ||
    op === "rotate" ||
    op === "extract" ||
    op === "reorder" ||
    op === "protect" ||
    op === "unlock" ||
    op === "compress" ||
    op === "flatten" ||
    // E4a redaction flatten-to-images step -- see `Operation`'s doc comment
    // on this op. Not reachable from any `defineTool` pipeline; listed here
    // only so a direct `pool.run` call (like `flattenExportedForms`'s) can
    // route to this adapter the same way every other op does.
    op === "replacePagesWithImages" ||
    op === "sanitize" ||
    op === "organize" ||
    op === "watermark" ||
    op === "addPageNumbers"
  );
}

/**
 * ADR-0008: byte-level PDF structure edits, not a raster pipeline — every op
 * here goes pdf -> pdf (or pdf -> many pdfs, or jpg/png -> pdf for
 * images-to-pdf), never through this codebase's own `RasterImage`
 * intermediate (`compress`'s per-image `OffscreenCanvas` re-encode, see
 * below, stays entirely inside this one op — nothing crosses the
 * `EngineTask`/`EngineResult` boundary as a raster).
 * `@cantoo/pdf-lib` is pure JS (no wasm, no separate fetched assets), so —
 * like `psd`/`tracer`/`utif`/`exif` — this adapter's whole implementation
 * ships inside its own lazily-imported worker chunk; `load()` has nothing to
 * initialise ahead of time, and the actual `import("@cantoo/pdf-lib")`
 * happens inside `run()`, once per call.
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
        // Same op, two shapes of input (ADR-0008's images-to-pdf reuses
        // "merge" rather than inventing a second op for "combine N inputs
        // into one output") — `inputFormat` (set by `supports`'s check
        // above, from the tool's own declared/sniffed format) says which.
        return task.inputFormat === "pdf"
          ? await runMergePdfs(task)
          : await runMergeImages(task);
      case "split":
        return await runSplit(task);
      case "rotate":
        return await runRotate(task);
      case "extract":
        return await runExtract(task);
      case "reorder":
        return await runReorder(task);
      case "protect":
        return await runProtect(task);
      case "unlock":
        return await runUnlock(task);
      case "compress":
        return await runCompress(task);
      case "flatten":
        return await runFlatten(task);
      case "replacePagesWithImages":
        return await runReplacePagesWithImages(task);
      case "sanitize":
        return await runSanitize(task);
      case "organize":
        return await runOrganize(task);
      case "watermark":
        return await runWatermark(task);
      case "addPageNumbers":
        return await runAddPageNumbers(task);
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
 *
 * `loadOptions` defaults to `@cantoo/pdf-lib`'s own defaults (every op but
 * `sanitize`); `runSanitize` is the one caller that passes
 * `{ updateMetadata: false }` — see its doc comment for why.
 */
async function loadPdf(
  mod: PdfLibModule,
  bytes: ArrayBuffer,
  loadOptions?: Parameters<PdfLibModule["PDFDocument"]["load"]>[1],
): Promise<Awaited<ReturnType<PdfLibModule["PDFDocument"]["load"]>>> {
  try {
    return await mod.PDFDocument.load(bytes, loadOptions);
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
 * merge (pdf -> pdf): every input, in the user's own order (`task.inputs` —
 * ADR-0008), copied page-for-page into one new document. `task.input` (the
 * first file again) is unused here; `inputs` is the source of truth for a
 * many-to-one step.
 */
async function runMergePdfs(task: EngineTask): Promise<EngineResult> {
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

type PageSizeOption = "fit" | "a4" | "letter";
type OrientationOption = "auto" | "portrait" | "landscape";

/**
 * merge (jpg/png -> pdf, `images-to-pdf`): every input becomes its own page,
 * in the user's own order — same `task.inputs` contract as `runMergePdfs`,
 * just embedding an image instead of copying pages. Each input is sniffed by
 * its own bytes (`sniffFormat`, never trusted from a filename or from the
 * job's single aggregate `inputFormat`, which only reflects the *first*
 * file) so a mixed drop of jpgs and pngs embeds each one correctly.
 *
 * `"fit"` sizes the page to the image's own pixel dimensions, 1 px = 1 pt —
 * the same assumption `PDFImage.width`/`height` already make, so the image
 * fills the page exactly with no scaling. `"a4"`/`"letter"` instead fix the
 * page size and `scaleToFit` the image inside it, minus `margin` pt on every
 * side, centred.
 */
async function runMergeImages(task: EngineTask): Promise<EngineResult> {
  const { inputs, options, signal, onProgress } = task;
  signal.throwIfAborted();

  if (!inputs || inputs.length === 0) {
    throw new EngineError("internal", "merge requires at least one input", {
      engine: metadata.id,
    });
  }

  const pageSize: PageSizeOption =
    options.pageSize === "a4" || options.pageSize === "letter"
      ? options.pageSize
      : "fit";
  const orientation: OrientationOption =
    options.orientation === "portrait" || options.orientation === "landscape"
      ? options.orientation
      : "auto";
  const margin = typeof options.margin === "number" ? options.margin : 0;

  const mod = await import("@cantoo/pdf-lib");
  const outDoc = await mod.PDFDocument.create();

  for (let i = 0; i < inputs.length; i++) {
    signal.throwIfAborted();
    const current = inputs[i];
    if (!current) continue; // unreachable: guarded by `i < inputs.length`
    const bytes = await inputToArrayBuffer(current);
    signal.throwIfAborted();

    const format = sniffFormat(new Uint8Array(bytes));
    if (format !== "jpg" && format !== "png") {
      throw new EngineError(
        "unsupported",
        `images-to-pdf only accepts jpg/png, got "${format ?? "an unrecognized format"}"`,
        { engine: metadata.id },
      );
    }
    const image =
      format === "png"
        ? await outDoc.embedPng(bytes)
        : await outDoc.embedJpg(bytes);

    if (pageSize === "fit") {
      const page = outDoc.addPage([image.width, image.height]);
      page.drawImage(image, {
        x: 0,
        y: 0,
        width: image.width,
        height: image.height,
      });
    } else {
      const [a, b] = mod.PageSizes[pageSize === "a4" ? "A4" : "Letter"];
      const isLandscape =
        orientation === "landscape" ||
        (orientation === "auto" && image.width > image.height);
      const pageWidth = isLandscape ? Math.max(a, b) : Math.min(a, b);
      const pageHeight = isLandscape ? Math.min(a, b) : Math.max(a, b);
      const page = outDoc.addPage([pageWidth, pageHeight]);

      const scaled = image.scaleToFit(
        Math.max(pageWidth - margin * 2, 1),
        Math.max(pageHeight - margin * 2, 1),
      );
      page.drawImage(image, {
        x: (pageWidth - scaled.width) / 2,
        y: (pageHeight - scaled.height) / 2,
        width: scaled.width,
        height: scaled.height,
      });
    }
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

/**
 * rotate (pdf -> pdf): adds `options.angle` degrees, clockwise, to whatever
 * rotation each selected page already carries — never overwrites it, so a
 * page rotated 90 that's rotated 90 again ends up at 180. `options.pages`
 * (`""` = every page) is the shared page-range spec, same as `split`'s
 * `ranges`. `angle` arrives as the string a `select` option field always
 * produces (`describeFields` requires a real `z.enum(...)`, which can't
 * `.transform()` into a number without breaking `defineTool`'s
 * defaults-satisfy-options check) — coerced here the same way the `canvas`
 * engine's own `runRotate` coerces its "rotate" option.
 */
async function runRotate(task: EngineTask): Promise<EngineResult> {
  const { input, options, signal, onProgress } = task;
  signal.throwIfAborted();

  const bytes = await inputToArrayBuffer(input);
  signal.throwIfAborted();

  const mod = await import("@cantoo/pdf-lib");
  const doc = await loadPdf(mod, bytes);

  const pagesSpec = typeof options.pages === "string" ? options.pages : "";
  const indices = parsePageRange(pagesSpec, doc.getPageCount());

  const angleValue =
    typeof options.angle === "string" ? Number(options.angle) : options.angle;
  const delta: 0 | 90 | 180 | 270 =
    angleValue === 90 || angleValue === 180 || angleValue === 270
      ? angleValue
      : 0;

  const pages = doc.getPages();
  for (const index of indices) {
    signal.throwIfAborted();
    const page = pages[index];
    if (!page) continue; // unreachable: indices are validated against doc.getPageCount()
    const current = page.getRotation().angle;
    page.setRotation(mod.degrees((current + delta) % 360));
  }
  onProgress?.(1);

  const outBytes = await doc.save();
  return {
    kind: "bytes",
    bytes: outBytes.slice().buffer,
    mime: FORMATS.pdf.mime,
  };
}

/**
 * extract (pdf -> pdf): one op behind two tools — `extract-pdf-pages`
 * (`options.mode: "keep"`, `options.pages` names the pages to keep, in the
 * given order) and `delete-pdf-pages` (`options.mode: "remove"`,
 * `options.pages` names the pages to drop; the rest survive in their
 * original order). Either way the result is a single new document, never
 * `EngineResult`'s `"files"` kind — unlike `split`, this never produces more
 * than one output.
 */
async function runExtract(task: EngineTask): Promise<EngineResult> {
  const { input, options, signal, onProgress } = task;
  signal.throwIfAborted();

  const bytes = await inputToArrayBuffer(input);
  signal.throwIfAborted();

  const mod = await import("@cantoo/pdf-lib");
  const srcDoc = await loadPdf(mod, bytes);
  const pageCount = srcDoc.getPageCount();

  const pagesSpec = typeof options.pages === "string" ? options.pages : "";
  const specified = parsePageRange(pagesSpec, pageCount);
  const mode = options.mode === "remove" ? "remove" : "keep";

  let keepIndices: number[];
  if (mode === "keep") {
    keepIndices = specified;
  } else {
    const toRemove = new Set(specified);
    keepIndices = srcDoc.getPageIndices().filter((i) => !toRemove.has(i));
  }

  if (keepIndices.length === 0) {
    throw new EngineError(
      "internal",
      mode === "remove"
        ? "cannot delete every page from a PDF"
        : "no pages selected to keep",
      { engine: metadata.id },
    );
  }

  const outDoc = await mod.PDFDocument.create();
  const copied = await outDoc.copyPages(srcDoc, keepIndices);
  for (const page of copied) outDoc.addPage(page);
  onProgress?.(1);

  const outBytes = await outDoc.save();
  return {
    kind: "bytes",
    bytes: outBytes.slice().buffer,
    mime: FORMATS.pdf.mime,
  };
}

/**
 * reorder (pdf -> pdf): rebuilds the document with pages copied in the
 * order `options.order` names — see `parsePageOrder`'s doc comment for the
 * full grammar (ranges may run backwards; repeating a page number
 * duplicates that page in the output; a page left out of the spec is
 * dropped). `""` means unchanged: every page copied in its original order,
 * nothing dropped or duplicated. Same shape as `runExtract` (one input, one
 * output document, `copyPages` + `addPage`) but its own op rather than a
 * third `extract` mode — `extract`'s "keep"/"remove" both select a *subset*
 * without reordering or duplicating; this always reproduces every named
 * index exactly, including repeats.
 */
async function runReorder(task: EngineTask): Promise<EngineResult> {
  const { input, options, signal, onProgress } = task;
  signal.throwIfAborted();

  const bytes = await inputToArrayBuffer(input);
  signal.throwIfAborted();

  const mod = await import("@cantoo/pdf-lib");
  const srcDoc = await loadPdf(mod, bytes);

  const orderSpec = typeof options.order === "string" ? options.order : "";
  const indices = parsePageOrder(orderSpec, srcDoc.getPageCount());

  const outDoc = await mod.PDFDocument.create();
  const copied = await outDoc.copyPages(srcDoc, indices);
  for (const page of copied) outDoc.addPage(page);
  onProgress?.(1);

  const outBytes = await outDoc.save();
  return {
    kind: "bytes",
    bytes: outBytes.slice().buffer,
    mime: FORMATS.pdf.mime,
  };
}

/**
 * protect (pdf -> pdf): encrypts with `options.password` as the user
 * password, AES-256 (`PDFDocument.encrypt`'s own default — ISO 32000-2's
 * only recommended algorithm, and the only one this adapter ever asks for).
 * No separate owner password: `@cantoo/pdf-lib` falls back to the user
 * password as the owner password when none is given, so the same password
 * both opens the document and carries full (owner) access — the same
 * consumer-grade single-password model most "protect a PDF" tools offer.
 * `permissions` are advisory (honored by compliant viewers, not a real
 * access boundary — anyone with the password has full access via the owner
 * fallback above), which is why `unlock` below doesn't need a separate
 * "permissions password" concept at all.
 */
async function runProtect(task: EngineTask): Promise<EngineResult> {
  const { input, options, signal, onProgress } = task;
  signal.throwIfAborted();

  const password = typeof options.password === "string" ? options.password : "";
  if (password === "") {
    throw new EngineError("internal", "protect requires a password", {
      engine: metadata.id,
    });
  }

  const bytes = await inputToArrayBuffer(input);
  signal.throwIfAborted();

  const mod = await import("@cantoo/pdf-lib");
  const doc = await loadPdf(mod, bytes);

  const allowPrinting = options.allowPrinting !== false;
  const allowCopying = options.allowCopying === true;
  doc.encrypt({
    userPassword: password,
    permissions: { printing: allowPrinting, copying: allowCopying },
  });
  onProgress?.(1);

  const outBytes = await doc.save();
  return {
    kind: "bytes",
    bytes: outBytes.slice().buffer,
    mime: FORMATS.pdf.mime,
  };
}

/**
 * `PDFDocument.load(bytes, {password})` clears the trailer's own `/Encrypt`
 * *pointer* once the password checks out (that's what `doc.isEncrypted`
 * reads), but `@cantoo/pdf-lib` 2.11.1 never evicts the encryption
 * dictionary *object* itself from the document's object table — its own
 * source still has that removal call commented out. Left in place, a plain
 * `doc.save()` writes the orphaned dictionary straight back out, and a
 * reader that finds it by scanning objects rather than trusting the trailer
 * alone (`PDFDocument.load` itself included — confirmed by hand: a
 * password-loaded-then-saved round trip still refused to reopen without a
 * password until this ran first) sees the file as still encrypted. The
 * dictionary is unambiguous — ISO 32000's standard security handler always
 * names itself `/Filter /Standard` — so it's safe to find and delete by
 * that signature alone, no matter what triggered it (a matching object can
 * only be the encryption dictionary).
 */
function stripOrphanedEncryptDict(
  mod: PdfLibModule,
  doc: Awaited<ReturnType<PdfLibModule["PDFDocument"]["load"]>>,
): void {
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (
      obj instanceof mod.PDFDict &&
      obj.get(mod.PDFName.of("Filter"))?.toString() === "/Standard"
    ) {
      doc.context.delete(ref);
    }
  }
}

/**
 * unlock (pdf -> pdf): loads with `options.password` and re-saves without
 * encryption. Unlike every other op here, this deliberately doesn't go
 * through the shared `loadPdf` helper — `loadPdf` never passes a password
 * (an encrypted input there is always a hard `"unsupported"` failure, by
 * design: unlocking is this separate tool, not a side effect of merge/
 * split/rotate/extract) — so it has its own password-aware load and its own
 * error mapping: a wrong password surfaces as `EngineError("decode-failed",
 * "Wrong password")`, not the "password-protected, unlock it first" message
 * `loadPdf` gives every other op.
 */
async function runUnlock(task: EngineTask): Promise<EngineResult> {
  const { input, options, signal, onProgress } = task;
  signal.throwIfAborted();

  const bytes = await inputToArrayBuffer(input);
  signal.throwIfAborted();

  const password = typeof options.password === "string" ? options.password : "";
  const mod = await import("@cantoo/pdf-lib");

  let doc: Awaited<ReturnType<PdfLibModule["PDFDocument"]["load"]>>;
  try {
    doc = await mod.PDFDocument.load(bytes, { password });
  } catch (e) {
    if (
      e instanceof mod.EncryptedPDFError ||
      (e instanceof Error && e.message === "Password incorrect")
    ) {
      throw new EngineError("decode-failed", "Wrong password", {
        engine: metadata.id,
        cause: e,
      });
    }
    throw new EngineError("decode-failed", "failed to parse PDF", {
      engine: metadata.id,
      cause: e,
    });
  }
  stripOrphanedEncryptDict(mod, doc);
  onProgress?.(1);

  const outBytes = await doc.save();
  return {
    kind: "bytes",
    bytes: outBytes.slice().buffer,
    mime: FORMATS.pdf.mime,
  };
}

type CompressMode = "lossless" | "balanced" | "strong";

/**
 * Downscale ceiling (long side, px) and JPEG re-encode quality per non-
 * lossless mode (ADR-0013) — ADR-0008 rejected PDFium for this (see docs/
 * adr/0008's 2026-09-26 update): embedded raster images dominate PDF size,
 * so re-encoding them through OffscreenCanvas gets most of a dedicated
 * PDF-compression engine's benefit with no extra wasm download. `lossless`
 * (the tool's default) never reaches this table — it does no image
 * recompression at all, see `runCompress`.
 */
const COMPRESS_PRESETS: Record<
  Exclude<CompressMode, "lossless">,
  { maxDim: number; quality: number }
> = {
  strong: { maxDim: 1000, quality: 0.5 },
  balanced: { maxDim: 1600, quality: 0.7 },
};

/**
 * Reachability sweep from the trailer's `/Root` and `/Info` entries
 * (ADR-0013's `lossless` mode's "drop unreferenced objects"): `doc.save()`
 * always serializes every object still in `doc.context`, reachable or not
 * (`stripOrphanedEncryptDict` above works around the same gap for one
 * specific orphan by name, since `PDFDocument.load` doesn't evict it either)
 * — a document that's been edited (pages deleted, images swapped) can carry
 * indirect objects nothing points to any more. This walks every object
 * transitively reachable from the trailer and deletes everything else.
 * Cycle-safe: a ref is marked reachable *before* its target is walked, so a
 * page <-> Pages-tree parent/child cycle terminates instead of looping.
 * Best-effort by design — `runCompress` treats a thrown error here as "don't
 * prune," never as a reason to fail the whole compress.
 */
function pruneUnreferencedObjects(
  mod: PdfLibModule,
  doc: Awaited<ReturnType<PdfLibModule["PDFDocument"]["load"]>>,
): void {
  type PDFRefLike = ReturnType<PdfLibModule["PDFRef"]["of"]>;

  const reachable = new Set<string>();
  const stack: PDFRefLike[] = [];

  const walk = (value: unknown): void => {
    if (value instanceof mod.PDFRef) {
      stack.push(value);
    } else if (value instanceof mod.PDFDict) {
      for (const v of value.values()) walk(v);
    } else if (value instanceof mod.PDFStream) {
      for (const v of value.dict.values()) walk(v);
    } else if (value instanceof mod.PDFArray) {
      for (const v of value.asArray()) walk(v);
    }
    // Every other PDFObject kind (PDFNumber/PDFName/PDFString/PDFHexString/
    // PDFBool/PDFNull) is a leaf — nothing further to walk.
  };

  const { Root, Info } = doc.context.trailerInfo;
  walk(Root);
  walk(Info);

  while (stack.length > 0) {
    const ref = stack.pop();
    if (!ref) continue; // unreachable: guarded by `stack.length > 0`
    const key = ref.toString();
    if (reachable.has(key)) continue;
    reachable.add(key);
    walk(doc.context.lookup(ref));
  }

  for (const [ref] of doc.context.enumerateIndirectObjects()) {
    if (!reachable.has(ref.toString())) doc.context.delete(ref);
  }
}

type RawStream = ReturnType<PdfLibModule["PDFRawStream"]["of"]>;

/** Every indirect object in `doc` whose dict says `/Subtype /Image` and
 * which is a `PDFRawStream` (the shape every image XObject this adapter can
 * touch takes — a `PDFContentStream` is never an image). */
function findImageStreams(
  mod: PdfLibModule,
  doc: Awaited<ReturnType<PdfLibModule["PDFDocument"]["load"]>>,
): RawStream[] {
  const streams: RawStream[] = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof mod.PDFRawStream)) continue;
    const subtype = obj.dict.lookupMaybe(
      mod.PDFName.of("Subtype"),
      mod.PDFName,
    );
    // `PDFName.asString()` includes the leading slash (it's the raw encoded
    // token, e.g. `"/Image"`) — unlike `decodeText()`, which strips it. Every
    // name comparison in this file matches on the encoded form, same as
    // `stripOrphanedEncryptDict`'s existing `"/Standard"` check above.
    if (subtype?.asString() === "/Image") streams.push(obj);
  }
  return streams;
}

/**
 * Decodes one image XObject to an `ImageBitmap`, or `undefined` for anything
 * outside this adapter's deliberately narrow scope (ADR-0008 update):
 * anything but a plain DCTDecode JPEG or an 8-bit DeviceRGB/DeviceGray
 * FlateDecode raster with no `/SMask` and no `/Decode` is left untouched —
 * CMYK, indexed palettes, JBIG2, JPX, soft masks and 16-bit data all decode
 * to something this narrow path would get wrong.
 */
async function decodeImageStream(
  mod: PdfLibModule,
  stream: RawStream,
  width: number,
  height: number,
): Promise<ImageBitmap | undefined> {
  const dict = stream.dict;
  const filter = dict.get(mod.PDFName.of("Filter"));
  if (!(filter instanceof mod.PDFName)) return undefined;

  if (filter.asString() === "/DCTDecode") {
    const blob = new Blob([new Uint8Array(stream.getContents())], {
      type: "image/jpeg",
    });
    try {
      return await createImageBitmap(blob);
    } catch {
      return undefined;
    }
  }

  if (filter.asString() !== "/FlateDecode") return undefined;
  if (dict.has(mod.PDFName.of("SMask"))) return undefined;
  if (dict.has(mod.PDFName.of("Decode"))) return undefined;

  const bits = dict.lookupMaybe(
    mod.PDFName.of("BitsPerComponent"),
    mod.PDFNumber,
  );
  if (bits?.asNumber() !== 8) return undefined;

  const colorSpace = dict.lookupMaybe(
    mod.PDFName.of("ColorSpace"),
    mod.PDFName,
  );
  const csName = colorSpace?.asString();
  if (csName !== "/DeviceRGB" && csName !== "/DeviceGray") return undefined;
  const channels = csName === "/DeviceGray" ? 1 : 3;

  let raw: Uint8Array;
  try {
    raw = mod.decodePDFRawStream(stream).decode();
  } catch {
    return undefined;
  }
  if (raw.length < width * height * channels) return undefined;

  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const r = raw[i * channels] ?? 0;
    const g = channels === 1 ? r : (raw[i * channels + 1] ?? 0);
    const b = channels === 1 ? r : (raw[i * channels + 2] ?? 0);
    rgba[i * 4] = r;
    rgba[i * 4 + 1] = g;
    rgba[i * 4 + 2] = b;
    rgba[i * 4 + 3] = 255;
  }

  try {
    return await createImageBitmap(new ImageData(rgba, width, height));
  } catch {
    return undefined;
  }
}

/**
 * Re-encodes one image XObject in place (mutates `stream`'s dict and
 * contents via `updateContents` — never replaces the indirect object
 * itself), downscaling to `preset.maxDim` on the long side and re-encoding
 * as JPEG at `preset.quality`. Only commits the swap when the result is
 * actually smaller than what was there — this is the same "never make a
 * file bigger" rule `runCompress` applies to the whole document, applied
 * per image so a handful of already-tiny icons can't get bloated by a
 * re-encode while the big photos next to them shrink.
 */
async function compressImageStream(
  mod: PdfLibModule,
  stream: RawStream,
  preset: { maxDim: number; quality: number },
): Promise<boolean> {
  const dict = stream.dict;
  const widthObj = dict.lookupMaybe(mod.PDFName.of("Width"), mod.PDFNumber);
  const heightObj = dict.lookupMaybe(mod.PDFName.of("Height"), mod.PDFNumber);
  if (!widthObj || !heightObj) return false;
  const width = widthObj.asNumber();
  const height = heightObj.asNumber();
  if (width <= 0 || height <= 0) return false;

  const bitmap = await decodeImageStream(mod, stream, width, height);
  if (!bitmap) return false;

  try {
    const longSide = Math.max(bitmap.width, bitmap.height);
    const scale = longSide > preset.maxDim ? preset.maxDim / longSide : 1;
    const outWidth = Math.max(1, Math.round(bitmap.width * scale));
    const outHeight = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = new OffscreenCanvas(outWidth, outHeight);
    const ctx = canvas.getContext("2d");
    if (!ctx) return false;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, outWidth, outHeight);

    const encoded = await canvas.convertToBlob({
      type: "image/jpeg",
      quality: preset.quality,
    });
    const newBytes = new Uint8Array(await encoded.arrayBuffer());

    if (newBytes.length >= stream.getContentsSize()) return false;

    dict.set(mod.PDFName.of("Filter"), mod.PDFName.of("DCTDecode"));
    dict.set(mod.PDFName.of("Width"), mod.PDFNumber.of(outWidth));
    dict.set(mod.PDFName.of("Height"), mod.PDFNumber.of(outHeight));
    dict.set(mod.PDFName.of("ColorSpace"), mod.PDFName.of("DeviceRGB"));
    dict.set(mod.PDFName.of("BitsPerComponent"), mod.PDFNumber.of(8));
    dict.delete(mod.PDFName.of("DecodeParms"));
    stream.updateContents(newBytes);
    return true;
  } finally {
    bitmap.close();
  }
}

/**
 * compress (pdf -> pdf, ADR-0013): `mode: "lossless"` (the tool's default)
 * does no image recompression at all — only `pruneUnreferencedObjects` plus
 * `useObjectStreams: true`, both purely structural. `"balanced"`/`"strong"`
 * additionally re-encode every embedded raster image this adapter knows how
 * to decode (see `decodeImageStream`). Every mode goes through the shared
 * `neverLarger` (ADR-0013) against the exact original input bytes — a
 * text-only PDF (no images to shrink, nothing to prune) can come back a few
 * bytes larger after a round trip through `PDFDocument.save`, lossless mode
 * included. An encrypted input is `"unsupported"` via the shared `loadPdf`
 * helper, same as merge/split/rotate/extract — unlocking is its own tool.
 */
async function runCompress(task: EngineTask): Promise<EngineResult> {
  const { input, options, signal, onProgress } = task;
  signal.throwIfAborted();

  const bytes = await inputToArrayBuffer(input);
  signal.throwIfAborted();

  const mod = await import("@cantoo/pdf-lib");
  const doc = await loadPdf(mod, bytes);

  const mode: CompressMode =
    options.mode === "balanced" || options.mode === "strong"
      ? options.mode
      : "lossless";

  if (mode === "lossless") {
    try {
      pruneUnreferencedObjects(mod, doc);
    } catch {
      // Best-effort structural cleanup — an unusual object graph this walk
      // can't handle just means less is pruned, not a failed compress.
    }
    onProgress?.(0.8);
  } else {
    const preset = COMPRESS_PRESETS[mode];
    const images = findImageStreams(mod, doc);
    if (images.length === 0) {
      onProgress?.(0.8);
    } else {
      for (let i = 0; i < images.length; i++) {
        signal.throwIfAborted();
        const stream = images[i];
        if (!stream) continue; // unreachable: guarded by `i < images.length`
        await compressImageStream(mod, stream, preset);
        onProgress?.(0.8 * ((i + 1) / images.length));
      }
    }
  }

  const outBytes = await doc.save({ useObjectStreams: true });
  onProgress?.(1);

  const picked = neverLarger(bytes, outBytes.slice().buffer as ArrayBuffer);
  return {
    kind: "bytes",
    bytes: picked.bytes,
    mime: FORMATS.pdf.mime,
    ...(picked.note ? { note: picked.note } : {}),
  };
}

/**
 * flatten (pdf -> pdf): `doc.getForm().flatten()` bakes every field's current
 * value into its page's content stream and removes the field/widget itself —
 * `@cantoo/pdf-lib`'s own default (`{ updateFieldAppearances: true }`)
 * regenerates each field's appearance from its value first, so this also
 * fixes fields a non-conforming writer left with a stale or missing
 * appearance stream. No options: unlike `protect`/`unlock`, there's nothing
 * here for a caller to choose. `getForm()` creates an empty AcroForm when the
 * document has none (see its doc comment in `PDFDocument.d.ts`), and
 * flattening that is a no-op — a form-less PDF round-trips through `save()`
 * unchanged in substance, same "safe on a no-op input" contract as
 * `runCompress`.
 */
async function runFlatten(task: EngineTask): Promise<EngineResult> {
  const { input, signal, onProgress } = task;
  signal.throwIfAborted();

  const bytes = await inputToArrayBuffer(input);
  signal.throwIfAborted();

  const mod = await import("@cantoo/pdf-lib");
  const doc = await loadPdf(mod, bytes);

  doc.getForm().flatten();
  onProgress?.(1);

  const outBytes = await doc.save();
  return {
    kind: "bytes",
    bytes: outBytes.slice().buffer,
    mime: FORMATS.pdf.mime,
  };
}

/** One page's worth of `replacePagesWithImages` input: the page it replaces,
 * and a rendered PNG (plus the pixel dimensions it was rendered at, used only
 * to sanity-check the entry -- the page's own existing PDF-point size is what
 * actually sizes the output page, so a redacted page keeps its original
 * paper size regardless of render DPI). */
export interface ReplacePageImage {
  pageIndex: number;
  /** PNG bytes -- `embedPng` below requires a real PNG, never raw pixels. */
  bytes: ArrayBuffer;
  width: number;
  height: number;
}

/** Validates `options.images` before touching pdf-lib at all, so a caller
 * mistake (bad shape, out-of-range index) surfaces as a clear `EngineError`
 * rather than an opaque pdf-lib exception three calls deep. Exported for unit
 * testing -- see `adapter.test.ts`. */
export function parseReplacePageImages(
  options: Readonly<Record<string, unknown>>,
): ReplacePageImage[] {
  const raw = options.images;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new EngineError(
      "internal",
      "replacePagesWithImages requires a non-empty `images` array",
      { engine: metadata.id },
    );
  }
  return raw.map((entry, i) => {
    if (typeof entry !== "object" || entry === null) {
      throw new EngineError(
        "internal",
        `replacePagesWithImages: images[${i}] is not an object`,
        { engine: metadata.id },
      );
    }
    const { pageIndex, bytes, width, height } = entry as Record<
      string,
      unknown
    >;
    if (
      typeof pageIndex !== "number" ||
      !Number.isInteger(pageIndex) ||
      pageIndex < 0
    ) {
      throw new EngineError(
        "internal",
        `replacePagesWithImages: images[${i}].pageIndex must be a non-negative integer`,
        { engine: metadata.id },
      );
    }
    if (!(bytes instanceof ArrayBuffer) || bytes.byteLength === 0) {
      throw new EngineError(
        "internal",
        `replacePagesWithImages: images[${i}].bytes must be a non-empty ArrayBuffer`,
        { engine: metadata.id },
      );
    }
    if (typeof width !== "number" || width <= 0) {
      throw new EngineError(
        "internal",
        `replacePagesWithImages: images[${i}].width must be a positive number`,
        { engine: metadata.id },
      );
    }
    if (typeof height !== "number" || height <= 0) {
      throw new EngineError(
        "internal",
        `replacePagesWithImages: images[${i}].height must be a positive number`,
        { engine: metadata.id },
      );
    }
    return { pageIndex, bytes, width, height };
  });
}

/**
 * replacePagesWithImages (pdf -> pdf, internal-only -- see `Operation`'s doc
 * comment): bakes each named page down to a single full-page PNG, discarding
 * that page's own content stream (and every annotation/vector/image object
 * only it referenced) entirely. Used by the PDF editor's redaction "Apply"
 * step (`src/lib/editor/flatten-redacted-pages.ts`) to remove content
 * PDFium's text-only `redactTextInRects` can't reach -- images and vector
 * graphics under a marked box. Each replaced page keeps its ORIGINAL
 * PDF-point size (read off the page being replaced, before removal) --
 * `images[].width`/`height` are the render's pixel dimensions, only used to
 * validate the entry isn't empty, never to size the output page.
 */
async function runReplacePagesWithImages(
  task: EngineTask,
): Promise<EngineResult> {
  const { input, options, signal, onProgress } = task;
  signal.throwIfAborted();

  const images = parseReplacePageImages(options);

  const bytes = await inputToArrayBuffer(input);
  signal.throwIfAborted();

  const mod = await import("@cantoo/pdf-lib");
  const doc = await loadPdf(mod, bytes);
  const pageCount = doc.getPageCount();

  for (const image of images) {
    if (image.pageIndex >= pageCount) {
      throw new EngineError(
        "internal",
        `replacePagesWithImages: pageIndex ${image.pageIndex} is out of range for a ${pageCount}-page document`,
        { engine: metadata.id },
      );
    }
  }

  for (let i = 0; i < images.length; i++) {
    signal.throwIfAborted();
    const image = images[i];
    if (!image) continue; // unreachable: guarded by `i < images.length`

    const original = doc.getPage(image.pageIndex);
    const { width: pageWidth, height: pageHeight } = original.getSize();
    const png = await doc.embedPng(image.bytes);

    doc.removePage(image.pageIndex);
    const newPage = doc.insertPage(image.pageIndex, [pageWidth, pageHeight]);
    newPage.drawImage(png, {
      x: 0,
      y: 0,
      width: pageWidth,
      height: pageHeight,
    });
    onProgress?.((i + 1) / images.length);
  }

  const outBytes = await doc.save();
  return {
    kind: "bytes",
    bytes: outBytes.slice().buffer,
    mime: FORMATS.pdf.mime,
  };
}

const INFO_DICT_KEYS = [
  "Title",
  "Author",
  "Subject",
  "Keywords",
  "Creator",
  "Producer",
  "CreationDate",
  "ModDate",
] as const;

/**
 * Deletes every standard Info-dict entry (E4b's `metadata` option), plus the
 * catalog's own `/Metadata` XMP stream if present. `PDFDocument`'s own
 * `getInfoDict()` (used by `setTitle`/`getProducer`/etc.) is private, so this
 * reaches the Info dict the same way `stripOrphanedEncryptDict` above reaches
 * arbitrary objects: through `doc.context` directly. `trailerInfo.Info` is
 * `undefined` for a document with no Info dict at all — nothing to clear.
 */
function clearMetadata(
  mod: PdfLibModule,
  doc: Awaited<ReturnType<PdfLibModule["PDFDocument"]["load"]>>,
): void {
  const infoRef = doc.context.trailerInfo.Info;
  if (infoRef) {
    const info = doc.context.lookup(infoRef, mod.PDFDict);
    for (const key of INFO_DICT_KEYS) info.delete(mod.PDFName.of(key));
  }
  doc.catalog.delete(mod.PDFName.of("Metadata"));
}

/** True when `dict`'s `/S` entry (an action dictionary's own type key) names
 * a JavaScript action — used to leave a document's other action types (e.g.
 * `/GoTo`, `/URI`) alone unless a caller specifically wants those gone too
 * (`links`, below). */
function isJavaScriptAction(mod: PdfLibModule, dict: PDFDict): boolean {
  const s = dict.lookupMaybe(mod.PDFName.of("S"), mod.PDFName);
  return s?.asString() === "/JavaScript";
}

/**
 * Removes every document-level JavaScript entry point (E4b's `javascript`
 * option): the catalog's `/OpenAction` (only when it's a JS action — a
 * `/GoTo` destination-array or -dict OpenAction is a normal "open to this
 * page" instruction, not a script, so it's left alone), the catalog's whole
 * `/AA` (additional-actions) dict (every entry there is a JS action per ISO
 * 32000 — no per-entry check needed), and the `/Names /JavaScript` name
 * tree that named scripts (Acrobat's "Document JavaScripts") live in.
 */
function clearDocumentJavaScript(
  mod: PdfLibModule,
  doc: Awaited<ReturnType<PdfLibModule["PDFDocument"]["load"]>>,
): void {
  const openAction = doc.catalog.lookupMaybe(
    mod.PDFName.of("OpenAction"),
    mod.PDFDict,
  );
  if (openAction && isJavaScriptAction(mod, openAction)) {
    doc.catalog.delete(mod.PDFName.of("OpenAction"));
  }
  doc.catalog.delete(mod.PDFName.of("AA"));
  doc.catalog.Names()?.delete(mod.PDFName.of("JavaScript"));
}

/**
 * Walks every page's `/Annots` array once, applying whichever of
 * `javascript`/`links`/`attachments` is on to each annotation dict in place —
 * one pass rather than three, since all three only ever look at the same
 * per-annotation data (`/Subtype`, `/A`, `/AA`). A `FileAttachment`
 * annotation is removed outright via `PDFPageLeaf.removeAnnot` (there's no
 * "keep the annotation, strip the file" — the annotation *is* the attached
 * file); every other case just deletes a key on the dict that survives.
 */
function sanitizePageAnnotations(
  mod: PdfLibModule,
  doc: Awaited<ReturnType<PdfLibModule["PDFDocument"]["load"]>>,
  opts: { javascript: boolean; links: boolean; attachments: boolean },
): void {
  for (const page of doc.getPages()) {
    const annots = page.node.Annots();
    if (!annots) continue;
    // Snapshot refs before mutating -- `removeAnnot` shrinks the live array,
    // which would otherwise skip the entry that shifts into a just-visited
    // index.
    const refs = annots.asArray().filter((o) => o instanceof mod.PDFRef);
    for (const ref of refs) {
      const annot = doc.context.lookup(ref, mod.PDFDict);

      if (opts.attachments) {
        const subtype = annot.lookupMaybe(
          mod.PDFName.of("Subtype"),
          mod.PDFName,
        );
        if (subtype?.asString() === "/FileAttachment") {
          page.node.removeAnnot(ref);
          continue;
        }
      }

      if (opts.javascript) {
        annot.delete(mod.PDFName.of("AA"));
        const action = annot.lookupMaybe(mod.PDFName.of("A"), mod.PDFDict);
        if (action && isJavaScriptAction(mod, action)) {
          annot.delete(mod.PDFName.of("A"));
        }
      }

      if (opts.links) {
        const subtype = annot.lookupMaybe(
          mod.PDFName.of("Subtype"),
          mod.PDFName,
        );
        if (subtype?.asString() === "/Link") {
          const action = annot.lookupMaybe(mod.PDFName.of("A"), mod.PDFDict);
          const s = action?.lookupMaybe(mod.PDFName.of("S"), mod.PDFName);
          if (s?.asString() === "/URI") annot.delete(mod.PDFName.of("A"));
        }
      }
    }
  }
}

/**
 * sanitize (pdf -> pdf, `sanitize-pdf`): strips hidden/embedded data a viewer
 * doesn't show but a document can still carry — metadata, JavaScript and
 * embedded-file attachments, each independently toggleable, plus an
 * opt-in `links` pass that strips URI actions from link annotations (default
 * off: web links are visible, wanted content, not "hidden data" — this is
 * for the rare case a caller wants a fully inert document).
 *
 * Loads with `{ updateMetadata: false }` — `@cantoo/pdf-lib`'s default
 * (`true`) makes `PDFDocument`'s own constructor call its private
 * `updateInfoDict()`, which sets `/Producer` and `/Creator` to
 * `"pdf-lib (https://github.com/Hopding/pdf-lib)"` and stamps `/ModDate` to
 * now, *before* this function gets a chance to clear anything (confirmed by
 * reading `PDFDocument.js`: `updateInfoDict` only ever runs from the
 * constructor, gated on this flag — never from `save()`/`prepareForSave()` —
 * so `{ updateMetadata: false }` at load time is sufficient; no special
 * `save()` options are needed on the way out).
 */
async function runSanitize(task: EngineTask): Promise<EngineResult> {
  const { input, options, signal, onProgress } = task;
  signal.throwIfAborted();

  const bytes = await inputToArrayBuffer(input);
  signal.throwIfAborted();

  const mod = await import("@cantoo/pdf-lib");
  const doc = await loadPdf(mod, bytes, { updateMetadata: false });

  const metadata = options.metadata !== false;
  const javascript = options.javascript !== false;
  const attachments = options.attachments !== false;
  const links = options.links === true;

  if (metadata) clearMetadata(mod, doc);
  if (javascript) clearDocumentJavaScript(mod, doc);
  if (attachments) doc.catalog.Names()?.delete(mod.PDFName.of("EmbeddedFiles"));
  if (javascript || links || attachments) {
    sanitizePageAnnotations(mod, doc, { javascript, links, attachments });
  }
  onProgress?.(1);

  const outBytes = await doc.save();
  return {
    kind: "bytes",
    bytes: outBytes.slice().buffer,
    mime: FORMATS.pdf.mime,
  };
}

/**
 * organize (pdf [+ inserted pdfs] -> pdf, E3): rebuilds a document
 * page-by-page from `options.plan` (`OrganizePlanEntry[]`, validated by the
 * shared `validatePlan` — see its doc comment for the exact shape). `inputs`
 * (ADR-0008's many-to-one shape) is every document the plan can reference —
 * `inputs[0]` is always the main document being organized, `inputs[1..]`
 * any PDFs the user inserted via the organizer's "Insert PDF" button.
 * Unlike `reorder` (same pages, same document, just rearranged), a plan
 * entry can also invent a blank page, and pages from different source
 * documents can interleave freely.
 */
async function runOrganize(task: EngineTask): Promise<EngineResult> {
  const { inputs, options, signal, onProgress } = task;
  signal.throwIfAborted();

  if (!inputs || inputs.length === 0) {
    throw new EngineError("internal", "organize requires at least one input", {
      engine: metadata.id,
    });
  }

  const mod = await import("@cantoo/pdf-lib");
  const srcDocs: Awaited<ReturnType<PdfLibModule["PDFDocument"]["load"]>>[] =
    [];
  for (const current of inputs) {
    signal.throwIfAborted();
    const bytes = await inputToArrayBuffer(current);
    signal.throwIfAborted();
    srcDocs.push(await loadPdf(mod, bytes));
  }

  const pageCounts = srcDocs.map((doc) => doc.getPageCount());
  const validated = validatePlan(options.plan, pageCounts);
  if (!validated.ok) {
    throw new EngineError("internal", validated.error, {
      engine: metadata.id,
    });
  }
  const { plan } = validated;

  const outDoc = await mod.PDFDocument.create();
  let previousSize = DEFAULT_BLANK_SIZE;

  for (let i = 0; i < plan.length; i++) {
    signal.throwIfAborted();
    const entry = plan[i];
    if (!entry) continue; // unreachable: guarded by `i < plan.length`

    if (entry.source === "blank") {
      const size = entry.size ?? previousSize;
      const page = outDoc.addPage([size.width, size.height]);
      page.setRotation(mod.degrees(normalizeRotation(0, entry.rotate)));
      previousSize = size;
    } else {
      const srcDoc = srcDocs[entry.source];
      if (!srcDoc) continue; // unreachable: source validated against pageCounts.length
      const [copied] = await outDoc.copyPages(srcDoc, [entry.page ?? 0]);
      if (!copied) continue; // unreachable: page validated against the source's page count
      outDoc.addPage(copied);
      const current = copied.getRotation().angle;
      copied.setRotation(mod.degrees(normalizeRotation(current, entry.rotate)));
      previousSize = copied.getSize();
    }
    onProgress?.((i + 1) / plan.length);
  }

  const outBytes = await outDoc.save();
  return {
    kind: "bytes",
    bytes: outBytes.slice().buffer,
    mime: FORMATS.pdf.mime,
  };
}

type QuarterTurn = 0 | 90 | 180 | 270;

/** `page.getRotation().angle` down to one of the four page-rotation values a
 * viewer actually renders -- a malformed `/Rotate` (not a multiple of 90) is
 * vanishingly rare, but falls back to 0 rather than propagating a fractional
 * angle into the trig-free integer maths below. */
function toQuarterTurn(angle: number): QuarterTurn {
  const normalized = ((angle % 360) + 360) % 360;
  return normalized === 90 || normalized === 180 || normalized === 270
    ? normalized
    : 0;
}

/**
 * Both `watermark` and `addPageNumbers` want to place text at a position
 * that looks right to the *viewer* -- "centered", "bottom-right corner" --
 * regardless of the page's own `/Rotate`. A viewer displays a page's content
 * stream (drawn in the page's own, unrotated coordinate space) rotated
 * `rotation` degrees clockwise, so a point this function is asked to draw at
 * *display* coordinates `(dx, dy)` (origin bottom-left of what the viewer
 * shows, same convention as content space) has to land somewhere else in
 * content space for that rotation to bring it to `(dx, dy)`.
 *
 * Derived by tracking where each of a `boxWidth` x `boxHeight` box's four
 * corners physically ends up after rotating the sheet `rotation` degrees
 * clockwise, then inverting: e.g. at `rotation: 90`, the content-space
 * origin `(0, 0)` ends up at display `(0, boxWidth)`, which inverts to
 * `x = boxWidth - dy, y = dx`. `rotation: 0` is the identity. Callers then
 * add the box's own `x`/`y` origin (a `/CropBox` need not start at `(0,
 * 0)`) on top of this function's result.
 */
function displayToContent(
  dx: number,
  dy: number,
  boxWidth: number,
  boxHeight: number,
  rotation: QuarterTurn,
): { x: number; y: number } {
  switch (rotation) {
    case 90:
      return { x: boxWidth - dy, y: dx };
    case 180:
      return { x: boxWidth - dx, y: boxHeight - dy };
    case 270:
      return { x: dy, y: boxHeight - dx };
    default:
      return { x: dx, y: dy };
  }
}

/** A rotated page's *displayed* width/height -- swapped from the page's own
 * (unrotated) box dimensions whenever the viewer turns it a quarter turn. */
function displaySize(
  boxWidth: number,
  boxHeight: number,
  rotation: QuarterTurn,
): { width: number; height: number } {
  return rotation === 90 || rotation === 270
    ? { width: boxHeight, height: boxWidth }
    : { width: boxWidth, height: boxHeight };
}

const WATERMARK_COLORS: Record<string, [number, number, number]> = {
  gray: [0.5, 0.5, 0.5],
  red: [0.82, 0.1, 0.1],
  blue: [0.1, 0.35, 0.82],
  black: [0, 0, 0],
};

/**
 * Every distinct character in `text` that Helvetica's WinAnsi encoding
 * (`@cantoo/pdf-lib`'s only encoding for a non-Symbol/ZapfDingbats standard
 * font) has no glyph for. `@cantoo/pdf-lib` itself never throws on this --
 * `StandardFontEmbedder.encodeTextAsGlyphs` silently swaps an unencodable
 * character for `"?"` -- so left unchecked, a watermark with (say) CJK text
 * would save without error and come back as a page full of question marks.
 * `canEncodeUnicodeCodePoint` is the same check that embedder itself makes
 * internally; imported from the package's own `standard-fonts` entry point
 * (its public, documented subpath) rather than reimplementing the WinAnsi
 * table by hand.
 */
function unsupportedWinAnsiChars(
  encodings: { WinAnsi: { canEncodeUnicodeCodePoint(cp: number): boolean } },
  text: string,
): string[] {
  const bad = new Set<string>();
  for (const ch of text) {
    const codePoint = ch.codePointAt(0);
    if (
      codePoint !== undefined &&
      !encodings.WinAnsi.canEncodeUnicodeCodePoint(codePoint)
    ) {
      bad.add(ch);
    }
  }
  return Array.from(bad);
}

/**
 * watermark (pdf -> pdf, `watermark-pdf`): stamps `options.text` on every
 * page in `options.pages` (blank = every page), diagonal (45 deg) or
 * horizontal, opacity/size/color/position all user-chosen. The text itself
 * is drawn rotated by `displayAngle + rotation` (see `displayToContent`'s
 * doc comment) so the *net* rotation the viewer shows -- the draw rotation
 * minus the page's own clockwise `/Rotate` -- always comes out to
 * `displayAngle`, keeping the mark diagonal/horizontal from the viewer's
 * seat no matter how the page itself is rotated. Centering is computed
 * against the page's `/CropBox` (falls back to `/MediaBox` when absent --
 * `getCropBox()`'s own default), including its own `x`/`y` origin, rather
 * than assuming every box starts at `(0, 0)`.
 */
async function runWatermark(task: EngineTask): Promise<EngineResult> {
  const { input, options, signal, onProgress } = task;
  signal.throwIfAborted();

  const text = typeof options.text === "string" ? options.text : "";
  if (text.trim() === "") {
    throw new EngineError("internal", "watermark requires text", {
      engine: metadata.id,
    });
  }

  const { Encodings } = await import("@cantoo/pdf-lib/standard-fonts");
  const unsupported = unsupportedWinAnsiChars(Encodings, text);
  if (unsupported.length > 0) {
    throw new EngineError(
      "unsupported",
      `The watermark font can't render: ${unsupported.join(", ")} -- try different text`,
      { engine: metadata.id },
    );
  }

  const bytes = await inputToArrayBuffer(input);
  signal.throwIfAborted();

  const mod = await import("@cantoo/pdf-lib");
  const doc = await loadPdf(mod, bytes);

  const pagesSpec = typeof options.pages === "string" ? options.pages : "";
  const indices = parsePageRange(pagesSpec, doc.getPageCount());

  const fontSize = typeof options.fontSize === "number" ? options.fontSize : 48;
  const rawOpacity =
    typeof options.opacity === "number" ? options.opacity : 0.25;
  const opacity = Math.min(1, Math.max(0.05, rawOpacity));
  const displayAngle = options.angle === "horizontal" ? 0 : 45;
  const colorKey =
    typeof options.color === "string" && options.color in WATERMARK_COLORS
      ? options.color
      : "gray";
  const rgbTriple: [number, number, number] = WATERMARK_COLORS[colorKey] ?? [
    0.5, 0.5, 0.5,
  ];
  const [r, g, b] = rgbTriple;
  const position =
    options.position === "top" || options.position === "bottom"
      ? options.position
      : "center";

  const font = await doc.embedFont(mod.StandardFonts.Helvetica);
  const textWidth = font.widthOfTextAtSize(text, fontSize);
  const margin = 36;

  const pages = doc.getPages();
  for (const index of indices) {
    signal.throwIfAborted();
    const page = pages[index];
    if (!page) continue; // unreachable: indices are validated against doc.getPageCount()

    const rotation = toQuarterTurn(page.getRotation().angle);
    const box = page.getCropBox();
    const { width: dispW, height: dispH } = displaySize(
      box.width,
      box.height,
      rotation,
    );

    const dy =
      position === "top"
        ? dispH - margin - fontSize
        : position === "bottom"
          ? margin
          : dispH / 2;
    const dx = dispW / 2 - textWidth / 2;

    const { x, y } = displayToContent(dx, dy, box.width, box.height, rotation);

    page.drawText(text, {
      x: x + box.x,
      y: y + box.y,
      size: fontSize,
      font,
      color: mod.rgb(r, g, b),
      opacity,
      rotate: mod.degrees(displayAngle + rotation),
    });
  }
  onProgress?.(1);

  const outBytes = await doc.save();
  return {
    kind: "bytes",
    bytes: outBytes.slice().buffer,
    mime: FORMATS.pdf.mime,
  };
}

type PageNumberFormat = "1" | "Page 1" | "Page 1 of N" | "1 / N";
type PageNumberPosition =
  | "bottom-center"
  | "bottom-right"
  | "bottom-left"
  | "top-center"
  | "top-right"
  | "top-left";

function formatPageNumber(
  format: PageNumberFormat,
  n: number,
  total: number,
): string {
  switch (format) {
    case "Page 1":
      return `Page ${n}`;
    case "Page 1 of N":
      return `Page ${n} of ${total}`;
    case "1 / N":
      return `${n} / ${total}`;
    default:
      return `${n}`;
  }
}

/**
 * addPageNumbers (pdf -> pdf, `add-page-numbers`): draws a label at one of
 * six corner/edge positions on every page in `options.pages` (blank = every
 * page). Numbering always counts every page in the document
 * (`options.startAt + index`, `index` the page's own 0-based position) even
 * when `options.pages` only selects some of them -- so numbering a 10-page
 * document's pages 5-10 still labels them "5".."10", not "1".."6". `total`
 * (for the "of N" formats) is `startAt + pageCount - 1`, the number the
 * *last* page in the document would carry, not the count of *labeled*
 * pages. Position/rotation handling shares `displayToContent`/`displaySize`
 * with `runWatermark` -- see that function's doc comment -- with
 * `displayAngle` always `0` (a page number reads upright, never diagonal),
 * so the draw rotation is just the page's own `rotation`, canceling it out
 * exactly.
 */
async function runAddPageNumbers(task: EngineTask): Promise<EngineResult> {
  const { input, options, signal, onProgress } = task;
  signal.throwIfAborted();

  const bytes = await inputToArrayBuffer(input);
  signal.throwIfAborted();

  const mod = await import("@cantoo/pdf-lib");
  const doc = await loadPdf(mod, bytes);
  const pageCount = doc.getPageCount();

  const pagesSpec = typeof options.pages === "string" ? options.pages : "";
  const selected = new Set(parsePageRange(pagesSpec, pageCount));

  const position: PageNumberPosition =
    options.position === "bottom-right" ||
    options.position === "bottom-left" ||
    options.position === "top-center" ||
    options.position === "top-right" ||
    options.position === "top-left"
      ? options.position
      : "bottom-center";
  const format: PageNumberFormat =
    options.format === "Page 1" ||
    options.format === "Page 1 of N" ||
    options.format === "1 / N"
      ? options.format
      : "1";
  const startAt =
    typeof options.startAt === "number" &&
    Number.isInteger(options.startAt) &&
    options.startAt >= 1
      ? options.startAt
      : 1;
  const fontSize = typeof options.fontSize === "number" ? options.fontSize : 11;
  const margin = typeof options.margin === "number" ? options.margin : 24;

  const font = await doc.embedFont(mod.StandardFonts.Helvetica);
  const total = startAt + pageCount - 1;
  const isTop = position.startsWith("top");
  const isRight = position.endsWith("right");
  const isCenter = position.endsWith("center");

  const pages = doc.getPages();
  for (let index = 0; index < pages.length; index++) {
    signal.throwIfAborted();
    if (!selected.has(index)) continue;
    const page = pages[index];
    if (!page) continue; // unreachable: guarded by `index < pages.length`

    const number = startAt + index;
    const label = formatPageNumber(format, number, total);
    const textWidth = font.widthOfTextAtSize(label, fontSize);

    const rotation = toQuarterTurn(page.getRotation().angle);
    const box = page.getCropBox();
    const { width: dispW, height: dispH } = displaySize(
      box.width,
      box.height,
      rotation,
    );

    const dy = isTop ? dispH - margin - fontSize : margin;
    const dx = isCenter
      ? dispW / 2 - textWidth / 2
      : isRight
        ? dispW - margin - textWidth
        : margin;

    const { x, y } = displayToContent(dx, dy, box.width, box.height, rotation);

    page.drawText(label, {
      x: x + box.x,
      y: y + box.y,
      size: fontSize,
      font,
      color: mod.rgb(0, 0, 0),
      rotate: mod.degrees(rotation),
    });
    onProgress?.((index + 1) / pages.length);
  }

  const outBytes = await doc.save();
  return {
    kind: "bytes",
    bytes: outBytes.slice().buffer,
    mime: FORMATS.pdf.mime,
  };
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
