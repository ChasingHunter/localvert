# ADR-0008: Tools declare their file arity: one-to-one, many-to-one, one-to-many

- **Status:** Accepted
- **Date:** 2026-09-25

## Context

Every tool so far maps one input file to one output file. Batch mode repeats
that per file and zips the results. Phase 2 (PDF) breaks the assumption in
both directions:

- **Many-to-one:** merge PDF (N PDFs → 1), images → PDF (N images → 1). The
  order of the inputs is part of the result, and the user has to be able to
  change it.
- **One-to-many:** split PDF (1 → N parts), PDF → images (1 → one image per
  page), extract pages.

Forcing these through one-to-one would mean fake batching for merge, or
engines that smuggle several files through one byte buffer for split. Both
would leak into every layer.

## Decision

`ToolDefinition` gains `arity: "one-to-one" | "many-to-one" | "one-to-many"`,
defaulting to `"one-to-one"`, so every existing tool is unchanged.

- **Engine contract.** `EngineTask` gains `inputs?: EngineInput[]` for
  many-to-one: `input` holds the first file, `inputs` holds all of them in
  order. `EngineResult` gains
  `{ kind: "files"; files: { name: string; bytes: ArrayBuffer; mime: string }[] }`
  for one-to-many. All buffers are transferred, never copied.
- **Job model.** A many-to-one submission creates **one** job, which owns N
  inputs and produces one output. A one-to-many job produces N outputs. The
  job card lists them with per-file downloads, plus "Download all (.zip)".
  Output names come from the engine (for example `report-page-3.png`), made
  unique by the existing zip-name logic.
- **UI.** For many-to-one tools the dropzone collects files into an ordered
  list: drag to reorder, keyboard up/down, remove. An explicit action button
  ("Merge PDFs") submits the list instead of auto-submitting on drop.
- **Page selection** is a shared option type, `pages: string`, in the form
  `"1-3, 5, 8-"`. One pure parser turns it into validated page indices for
  every PDF tool.
- **Document operations are byte ops**, not raster pipelines (ADR-0007
  covers images). The new ops are `merge`, `split`, `extract`, `rotate`,
  `reorder`, `compress`, `protect`, `unlock`, `render` and `ocr`. Rendering
  PDF → image is done by the pdfjs engine inside the worker, and its pages
  are encoded with the native OffscreenCanvas encoder. A second image engine
  inside the same job would buy nothing for page renders.

Engines for Phase 2: `@cantoo/pdf-lib` (MIT) for structure edits,
images → PDF and protection; `pdfjs-dist` (Apache-2.0) for render and text,
with `isEvalSupported: false` and its worker, cmaps and standard fonts
self-hosted under `/engines/pdfjs@<ver>/`; `@embedpdf/pdfium` (MIT, PDFium
BSD/Apache) for compression; and `tesseract.js` (Apache-2.0) for OCR, with
the worker, core and traineddata self-hosted, because its default CDN fetch
is blocked by our CSP. **mupdf is rejected**: it is AGPL-3.0, which would
make the whole deployed app AGPL, and that contradicts ADR-0002.

## Consequences

**What it buys**

- Merge, split and render are first-class, not hacks, and their UI is honest
  about ordering and multiple outputs.
- Existing tools and engines are untouched, because the default arity is
  one-to-one.
- A single page-range parser gives consistent behaviour across every PDF tool.

**What it costs**

- The job store, the job card and the zip path each gain a second shape
  (multi-output). The tool runner gains an ordered-list mode.
- A many-to-one job holds all its inputs in worker memory at once. Merging
  many large PDFs is bounded by device memory, and there is no streaming
  merge.
- pdfjs normally spawns its own worker. Running it inside our worker means
  using its in-thread ("fake worker") mode. That's more code at load time,
  but no nested workers.

## Alternatives considered

**Model merge as a batch plus a post-processing step.** Rejected: it hides
ordering from the engine and makes the zip sink a document assembler.

**One job per output page for split.** Rejected: it multiplies worker
dispatch for no benefit, and progress and cancel apply to the whole document
anyway.

**mupdf for everything.** Rejected: AGPL (see above), despite being the most
capable single engine.
