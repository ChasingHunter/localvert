# ADR-0014: PDF to Word without LibreOffice, layout approximate

- **Status:** Accepted
- **Date:** 2026-09-28

## Context

Wave E's `pdf-to-word` was deferred: docs/adr/0012's own addendum
("PDF import is Draw-only — no pdf-to-word") found, from the wrapper's own
protocol source, that this app's `libreoffice-wasm` build always imports a
`.pdf` as a Draw document and refuses to export a Draw document to
`docx` — not a missing feature to work around, a rule the wrapper enforces
on purpose. Getting `pdf-to-word` at all means not routing through
LibreOffice.

The owner still wants it, labelled plainly as **layout approximate** — text,
headings and paragraph breaks in reading order, not a facsimile.

## Decision

Reconstruct the document ourselves, in two engines:

1. **`pdfjs`'s own `extractLayout` op** (pdf -> json): reads
   `getTextContent()` per page — the same API `pdf-to-text` already uses —
   and reassembles it into a `LayoutDocument` (pages of paragraphs of styled
   runs; see `src/lib/engines/shared/pdf-layout.ts`), serialised as JSON
   bytes. The pure grouping/classification logic lives in that one
   environment-neutral file so it's unit-tested directly in Node, with no
   pdf.js, no worker, no real PDF required — `pdfjs/adapter.ts`'s
   `runExtractLayout` is a thin wrapper that maps pdf.js's own `TextItem`s
   down to that module's plain `RawItem` shape.
2. **A new `docx` engine's `transcode` op** (json -> docx): reads that JSON
   back and writes a real `.docx` — `[Content_Types].xml`, `_rels/.rels`,
   `word/document.xml`, `word/styles.xml`, `word/_rels/document.xml.rels`,
   `docProps/core.xml` — using `fflate`'s `zipSync` (already a dependency,
   already used for the read side by the `epub` engine). Pure TS, no wasm,
   `bundled` location, same shape as `epub`.

Two steps, not a single composite op, because the intermediate
(`LayoutDocument`) has no byte-for-byte format of its own to hand between
engines other than "JSON" — the same reasoning `epub-to-pdf` already
established for its own epub -> html -> pdf pipeline (`ADR-0012`'s EPUB
addendum). `json` was already a registered `FormatId`
(`src/lib/registry/formats.ts`), so no new `StepFormat` variant was needed —
unlike ADR-0007's `"raster"`, which threads through a large number of
call sites, `"json"` is just an ordinary format on both ends of an ordinary
`transcode` step.

### Structure reconstruction

**Lines and paragraphs.** Per page, text items are grouped into lines by the
same two signals `pdf-to-text`'s `reconstructPageText` already uses
(`item.hasEOL`, or a y-jump of more than a point) — reused rather than
duplicated differently, since both tools read the same content stream the
same way. Lines are grouped into paragraphs when either signal fires:

- **Vertical gap** over 1.35x the line's own font size. Normal line-to-line
  leading (single- through 1.5-line-spaced body text) stays well under that;
  a genuine paragraph break (a blank line, a heading's extra leading) clears
  it with margin.
- **Indentation jump** of more than 2x the document's body font size. A
  typical first-line indent (0.3-0.5in at a 10-12pt body size) is roughly
  that ratio; a document with no first-line indent at all (common in
  business documents that use paragraph spacing instead) simply never
  triggers this signal and falls back to the gap check alone.

Both are heuristics tuned by inspection, not measured against a corpus —
documented here so a future regression has a stated baseline to check
against, not just "it looked right." A document with unusually tight/loose
leading degrades gracefully to "every ordinary-sized gap merges", the same
behaviour `pdf-to-text` already ships with no complaints.

**Reading order** is top-to-bottom per page only. No column detection: a
reliable left/right split heuristic (the brief's own suggested escape
hatch) would need to distinguish a genuine two-column layout from a single
column containing an indented block, a pull-quote, or a table — cheap ways
to get this wrong (interleaving column text) outnumber the cheap ways to
get it right. Documented as a limitation rather than shipped half-working:
a multi-column PDF comes out as one reading-order stream that may interleave
the two columns' text.

**Headings** are inferred from font size relative to the document's own
dominant body size (weighted by character count, not item count, so a
title page's few large characters can't outweigh a thousand small body
characters) — a ratio, not an absolute pt value, so a 9pt-body document's
14pt headings still promote correctly:

| Ratio  | Level |
| ------ | ----- |
| ≥ 1.6x | H1    |
| ≥ 1.3x | H2    |
| ≥ 1.15x| H3    |
| else   | body  |

Checked by hand against a few worked examples (11pt body: 12pt stays body
at 1.09x; 12.65pt clears H3 at 1.15x; 14.3pt clears H2 at 1.3x; 17.6pt
clears H1 at 1.6x — see `pdf-layout.test.ts`), not a real-document study.

**Bold/italic**: `PDFPageProxy.commonObjs` (fully public/documented on
`pdfjs-dist`'s own `.d.ts`, unlike the internal `CanvasFactory`/
`FilterFactory` shapes `pdfjs/adapter.ts` already has to reimplement from
reading pdf.js's published source) is populated with each page's fonts as a
side effect of `page.getOperatorList()` — called once per page purely for
this, its own return value discarded. Reading `pdf.worker.mjs`'s bundled
source (`Font` class) confirms:

- For a font with **no embedded font program** (a base-14/system font),
  pdf.js computes `.bold`/`.italic` itself with the exact same keyword
  regex this feature uses (`/bold/i`, `/oblique|italic/i` against the
  font's real name) — read straight off that instance when present.
- For an **embedded** font (the common case), pdf.js never sets those
  flags at all; this falls back to running the brief's own regex
  (`/Bold|Black|Heavy|Semibold/i`, `/Italic|Oblique/i`) against `.name` —
  the font's real PDF `/BaseFont`, which survives fallback processing even
  though `TextStyle.fontFamily` (the field `getTextContent()` exposes
  directly) does not (it collapses to a generic `"serif"`/`"sans-serif"`/
  `"monospace"` keyword, useless for this).

A font this document can't resolve into `commonObjs` at all (a malformed
xref, an unusual font dictionary) falls back to "neither bold nor italic"
rather than failing the page.

### Images: not in this slice

The brief allowed shipping text-only if image extraction "proves
unreliable." It was never implemented far enough to test unreliability —
this call was made up front, on engineering grounds, before writing image
code that couldn't be verified: this repo's rule against accepting
"flaky/contention" without a per-stage trace from a failing run applies
just as much to "unverified" code with no way to get that trace at all.
Extracting a `paintImageXObject`'s pixel data reliably needs a hand-rolled
interpreter replaying the operator list's transform stack (`save`/
`restore`/`cm`) to recover each image's position — genuinely undocumented
territory, un-testable without a real browser (`OffscreenCanvas`, `page.objs`
resolution timing) and un-runnable in this slice's Node-only worktree
(no `next dev`, no browser test execution, no build). Shipping that
untested is a worse outcome than shipping text-only and saying so plainly:
`pdf-to-word`'s own description states it's text-only up front. A follow-up
slice that can actually run browser tests against real PDFs is better
positioned to get image extraction right.

### DOCX output shape

Minimal but valid: one `Normal` + `Heading1`-`Heading3` style set (docProps
plus the six parts listed above), Letter-size `sectPr` with 1in margins
(not derived from the source PDF's own page size — this is a reflowable
Word document, not a facsimile), runs carry `w:b`/`w:i`/`w:sz` (half-points,
clamped to a 4-72pt range so a garbled size can't hand Word something it
rejects), headings via `w:pStyle`, an optional page break
(`pageBreaks` option, default on) between each PDF page's content. All text
goes through `stripIllegalXmlChars` (XML 1.0's own valid-character ranges)
then `escapeXml` before landing in a `w:t` or `dc:title`.

## Consequences

- `pdf-to-word` ships as text-only in this slice — no images, no column
  detection, no table reconstruction, no exact positioning. The tool's own
  description says so plainly, and points scanned/image-only PDFs at
  `pdf-to-searchable-pdf` (OCR) first, same pattern `pdf-to-text` already
  uses.
- Heading/paragraph-gap/indent thresholds are hand-tuned, not corpus-tested
  — a real-world document that uses unusual spacing or no first-line indent
  degrades to "every line in one flowing paragraph," not a crash.
- Reading `page.commonObjs` for font metadata is undocumented-but-public
  territory (a public, typed accessor; untyped values) — a future
  `pdfjs-dist` upgrade that changes what a translated `Font`'s exported
  shape carries (unlikely, but not contractually guaranteed) could silently
  degrade bold/italic detection back to "always false" without a build
  error, since the read is defensive (`has()` before `get()`, optional
  chaining on the result). Worth a spot-check on the next `pdfjs-dist`
  version bump.
- No new `StepFormat`/pipeline-runner changes — `json` already existed as a
  `FormatId`, so this pipeline is exactly as ordinary as any other two-step
  `transcode` tool from the runner's point of view.

## Alternatives considered

- **A different `libreoffice-wasm` build that exposes `FilterName`.**
  Rejected: no such build is in evidence, and vendoring/patching a
  from-scratch LibreOffice build to add a load-time filter override is a
  far larger undertaking than a from-scratch text-reflow engine, for the
  same eventual "approximate layout" ceiling either way (Draw import into
  Writer's own text-reflow wouldn't itself preserve columns/tables any
  better than this ADR's own approach).
- **A single composite op (pdf -> docx in one engine), like `tesseract`'s
  `ocrPdf`.** Considered, since `tesseract/adapter.ts` already establishes
  that pattern for exactly this reason ("a `'files'` one-to-many result has
  no clean handoff"). Rejected here because the two steps are genuinely
  independent, reusable capabilities (`extractLayout` is useful on its own;
  a `docx` writer that only ever runs immediately after `pdfjs` would be an
  artificial coupling) and `json` already had a clean two-step
  representation available — the composite-op escape hatch is for when no
  such representation exists, not the default.
- **Extracting images now, best-effort, flagged experimental.** Considered
  and rejected — see "Images: not in this slice" above. An untested,
  unverifiable feature flagged "experimental" still ships broken code paths
  users can hit; text-only that's actually been run (`pnpm test`, real
  assertions on real generated PDFs) is more honest than a wider feature
  surface nobody has watched fail yet.
