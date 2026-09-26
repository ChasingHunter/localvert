# ADR-0009: A PDF editor on PDFium (via EmbedPDF), as a stateful app-mode tool

- **Status:** Accepted
- **Date:** 2026-09-26

## Context

The owner wants a PDF editor that holds up against Sejda, iLovePDF and
Smallpdf, while staying fully offline and client-side (ADR-0001). The minimum
is: annotating (highlight, ink, shapes, text boxes, images and stamps),
signatures, form filling, page organisation, **true** redaction, and
editing text that is already in the PDF.

Options considered, with what each can and cannot do:

- **pdf.js editor layer** (already installed, Apache-2.0). It covers free
  text, ink, stamps, highlights, signatures and saving. It cannot do true
  redaction, and it cannot edit existing text: it writes annotations only.
- **PDFium via EmbedPDF** (Chrome's PDF engine compiled to wasm; npm v2.15.1,
  MIT, about 4.5k stars). It includes annotation, redaction ("content is
  actually removed"), signature, stamp, thumbnail, selection, export and print
  plugins, and it runs the engine in a Web Worker. Because it has
  page-object access, removing and re-inserting text objects is possible,
  which is what editing existing text needs.
  - Its **form plugin ships with no licence**, so it is not usable. We fill
    forms ourselves with pdf-lib or the PDFium form API instead.
  - Its **v3 is still unstable**, so we stay on v2.
- **mupdf** — AGPL, rejected as in ADR-0008.
- **Building our own editor on pdf.js + pdf-lib.** Rejected: months of work,
  and it still could not do true redaction or edit existing text.

## Decision

Build the editor on **PDFium via EmbedPDF v2** (MIT plugins only).

- **App-mode tool.** Converter tools run a one-shot job. The editor is a
  registry tool of a new kind, `kind: "app"`, which renders its own component.
  Its route, SEO and listing stay registry-derived. It holds one open
  document in a dedicated, heavy PDFium worker session, applies edits as the
  user works, and exports on demand. Closing the editor terminates the worker
  and frees the wasm heap.
- **Invariant 2 holds.** Parsing, rendering, editing and saving all happen in
  the worker. The main thread only displays rendered bitmaps and the editing
  overlay.
- **Self-hosted and offline.** The PDFium wasm and every font pack ship as
  versioned static engine assets on our own origin, and are never fetched from
  a CDN. CSP is unchanged. A test asserts that no request goes off-origin.
  Assets are fetched only when the editor opens, and the service worker caches
  them after that.
- **Editing existing text** works by removing the original text objects and
  inserting new ones in the same position, size and colour. Where the embedded
  font subset is missing glyphs, a bundled open font is substituted.
  Limitations we state openly: the substituted font may differ slightly, and
  paragraphs do not reflow.
- **Redaction** must truly remove content. It is verified by extracting text
  and images from the output and asserting the redacted content is gone. A
  "sanitize" option strips metadata, JavaScript, attachments and hidden
  layers.
- **Saved signature** is opt-in and stored only in the user's own IndexedDB,
  with a "forget" control. It never leaves the device.
- **Fallback.** Slice E0 is a timeboxed spike with go/no-go criteria. If
  EmbedPDF v2 cannot meet them (self-hosting, worker, CSP, proven true
  redaction), we fall back to the pdf.js editor layer plus our own pdf-lib
  page tools, and record what is lost.

## Consequences

**What it buys**

- A Sejda-class editor that works fully offline.
- True redaction, and editing of existing text. Browser tools that only
  "white out" text cannot offer either.
- One engine for rendering and editing, with Chrome-grade fidelity.

**What it costs**

- A heavier engine, about 4.6 MB of wasm plus font packs. It is fetched only
  when the editor is opened.
- A dependency on a young project. Mitigations: pin to v2, use MIT plugins
  only, and have CI run real-document tests on every Dependabot bump.
  Majors never auto-merge.
- A new tool kind (app mode) alongside the job pipeline.
