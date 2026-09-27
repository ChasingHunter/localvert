# ADR-0012: LibreOffice wasm for office-to-PDF conversion

- **Status:** Accepted
- **Date:** 2026-09-27

## Context

Phase 4c needs word/excel/powerpoint-to-pdf: docx/doc/odt/rtf,
xlsx/xls/ods, pptx/ppt/odp -> pdf, fully client-side, no server round trip.

A hand-rolled parser (mammoth for docx, docx-preview, a custom OOXML/ODF
reader) can only ever cover a slice of what these formats actually contain —
styles, headers/footers/section breaks, tracked changes, embedded objects,
charts, pivot tables, master slides. Office documents in the wild routinely
use all of this, and a partial renderer fails silently (wrong output, not an
error) far more often than it fails loudly. The only renderer that reliably
reproduces what Word/Excel/PowerPoint/LibreOffice itself would print is
LibreOffice's own layout engine.

`@bentopdf/libreoffice-wasm` (npm, 2.3.1) ships LibreOfficeDev 24.8 compiled
to wasm/pthreads via Emscripten: `soffice.wasm.gz` (~46.5 MB), `soffice.
data.gz` (~27.3 MB, the packed virtual filesystem — program files, bundled
fonts, config), `soffice.js` (Emscripten JS glue), `soffice.worker.js`
(pthread bootstrap), and its own `browser.worker.global.js` — a driver
worker that instantiates all of the above and exposes a small postMessage
protocol (init/convert/progress/result/error). The package has **no
repository field, no README, and a single, otherwise-anonymous maintainer**
("bentopdf" on npm) — real provenance risk for a ~74 MB binary blob nobody
else has reviewed. We read `browser.worker.global.js`'s source directly
(there is no other option) to confirm its message protocol and that it does
nothing beyond LibreOfficeKit calls and file I/O against its own virtual
filesystem.

This risk is bounded by what this app already guarantees everywhere else:
every engine runs in its own worker with no elevated privileges, and
`connect-src 'self'` (invariant 1, `public/_headers`) means no script running
in this origin — LibreOffice's included or not — can ever make a network
request anywhere but this origin. A malicious engine could still read the
file it's given and misbehave locally, but it cannot exfiltrate it. That is
the same trust boundary ADR-0002 already draws for `ffmpeg`, just applied to
a worse-provenance package.

The wasm build needs `SharedArrayBuffer` (pthreads) — met by the COOP/COEP
headers this app already sends for every route (`public/_headers`,
`next.config.ts`'s dev server) — and a real machine's worth of memory: there
is no built-in floor, so a phone or a low-RAM tablet can OOM partway through
boot with an opaque wasm abort rather than a clear error.

## Decision

Ship `@bentopdf/libreoffice-wasm` as an r2-hosted, consent-gated, heavy
engine (`src/lib/engines/libreoffice/`), following the `ffmpeg` engine's
precedent (ADR-0002): its own dedicated worker, fetched only on the user's
explicit download consent, unmodified upstream files. Unlike every wasm/JS
glue engine here, this one's own worker does the Emscripten instantiation —
this adapter's job is narrower: decompress the two `.gz` assets to blob
URLs, spawn `browser.worker.global.js` as a nested classic worker, and speak
its postMessage protocol. The nested worker is cached for the life of the
outer engine worker so only the first job in a session pays the ~74 MB/boot
cost.

Guard the known failure mode explicitly rather than let it surface as an
opaque abort: refuse up front when `navigator.deviceMemory` reports under
4 GiB, and map a `RangeError`/"out of memory" during init to the same
user-facing message ("needs a desktop browser with at least 4 GB of
memory"). This is a floor, not a guarantee — `deviceMemory` is Chromium-only
and self-reported, so Firefox/Safari and a lying UA both fall through to the
same OOM handling as a plain runtime error.

Three tools (`src/tools/document/`): `word-to-pdf` (docx/doc/odt/rtf),
`excel-to-pdf` (xlsx/xls/ods), `powerpoint-to-pdf` (pptx/ppt/odp), all
routed to this one engine via a single generic `transcode` step (no fixed
`from`; `job-engine.ts` resolves it from whatever the dropped file actually
sniffs as).

Because the wasm build ships no CJK fonts (only Latin/Cyrillic/Greek/
Arabic/Hebrew and similar — verified against the package's bundled font
list), a CJK-heavy document renders with missing glyphs today. Documented as
a known limitation rather than worked around: adding a font pack is
possible later (`FS.writeFile` into the wasm instance's
`/instdir/share/fonts/` before conversion) but is its own scoped follow-up,
not part of this slice.

## Consequences

- Full-fidelity office-to-PDF conversion, fully offline, matching what a
  real desktop install would produce — not achievable with a JS-only
  parser.
- ~74 MB one-time download per browser (gzipped; ~174 MB decompressed in
  memory), consent-gated and cached client-side after the first grant —
  the largest engine this app ships by a wide margin (`ffmpeg` is ~31 MB,
  `typst` ~30.6 MB).
- Desktop-only in practice: the memory guard refuses low-RAM devices
  outright rather than let them fail opaquely, but that means these three
  tools simply don't work on a lot of phones/tablets.
- Provenance risk accepted, not eliminated: a single anonymous npm
  maintainer ships a large wasm binary with no public source diff against
  upstream LibreOffice to review. Mitigated by sandboxing (own worker, no
  elevated APIs) and this app's `connect-src 'self'` CSP, not by an
  independent audit of the wasm itself.
- No CJK font support in this initial ship — a known, documented gap, not
  a silent one.
- `needsIsolation: true` is new metadata for this codebase (every existing
  engine is `false`) — nothing yet gates engine selection on cross-origin
  isolation at runtime; this app already sends COOP/COEP everywhere, so it
  is not exercised as a real constraint yet, but the field is now honestly
  populated for the day something does read it.

## Addendum (2026-09-27): CSP-safe embind, following the typst-glue pattern

`soffice.js` (built without `-sDYNAMIC_EXECUTION=0`) turned out to embed two
runtime code-generation sites — embind's `craftInvokerFunction` (the generic
invoker factory behind every bound class method, constructor and free
function) and the emval `__emval_get_method_caller` — both routed through
`newFunc(Function, args)`, i.e. `new Function(...)`. CSP's `script-src` (no
`unsafe-eval`, invariant 1) blocks that outright: the first bound-class-method
call during LibreOfficeKit init threw `EvalError: Evaluating a string as
JavaScript violates ... 'unsafe-eval'`, surfacing to the user as a generic
"WASM initialization timeout".

Following ADR-0011's precedent for typst-ts's wasm-bindgen glue, `scripts/
sync-engines.ts`'s `patchLibreOfficeEmbind` replaces both functions' exact
source with eval-free closures that reproduce the generated bodies'
semantics — arg-count check, wire-type conversion, destructor bookkeeping,
return conversion, and (for emval) the pointer-packet reads and construct/
call dispatch — matched and applied while copying `soffice.js` in `pnpm
sync-engines`, not hand-edited in the vendored file. Unlike typst's patch
(a closed lookup over five fixed dummy bodies), this one can't enumerate the
call sites in advance — embind and emval invoke these for every bound class
method the C++ side registers, with arbitrary argument shapes — so the
replacement has to be a general, correct reimplementation of Emscripten's own
`-sDYNAMIC_EXECUTION=0` invoker, not a fixed table. See
`docs/THIRD_PARTY_LICENSES.md` for the MPL-2.0 note this creates (`soffice.js`
is now modified, not shipped verbatim).

### Addendum (2026-09-27): pthread pool deadlock on spreadsheets

Every xlsx hung forever inside `lok_documentLoad` while docx converted in
seconds. `soffice.js` prespawns 4 pthread workers (`-sPTHREAD_POOL_SIZE=4`);
Calc's import creates a fifth thread, Emscripten then constructs a new
`Worker` on demand — and a nested worker cannot start while its creator is
blocked waiting for it. A 5-worker pool converted the same file in under a
second. `patchLibreOfficePthreadPool` now raises the literal to 8 (headroom
over the measured 5), matched exactly once and failing `pnpm sync-engines`
if the shape changes. Both patches run as the `"libreoffice-glue"` patch
(`patchLibreOfficeGlue`). Cost: four more idle workers per LibreOffice
session, each an instance on the shared memory — negligible next to the
74 MB engine.

### Addendum (2026-09-28): PDF import is Draw-only — no pdf-to-word

Wave E's brief was word/txt/html/epub -> pdf plus a `pdf-to-word` (pdf ->
docx) tool, feasibility-gated on whether this build's PDF import actually
lands in Writer (which would let a real Writer document, editable text and
all, come back out). It doesn't, and the wrapper forecloses it on purpose —
evidence, not a guess:

- `soffice.data`'s own installation config strings (found by gunzipping
  `soffice.data.gz`/`soffice.wasm.gz` and scanning for ASCII runs) contain
  both `writer_pdf_import` and `draw_pdf_import` — the real LibreOffice
  install ships both filters, statically linked into `libpdfimportlo.a`.
  Their presence alone proves nothing about which one this wrapper's
  protocol actually reaches.
- `browser.worker.global.js` hardcodes a `pdf: "drawing"` entry in its own
  input-classification table (the `ne` object, right next to the `q`
  export-filter table read for the existing three tools) — every other
  input format maps to `"text"`/`"spreadsheet"`/`"presentation"`, but `pdf`
  is `"drawing"`. Its own valid-output table for the `"drawing"` doc type is
  `["pdf", "png", "svg", "html"]` — no `docx`/`doc` — and its
  `ie()` error-message builder has a literal, unconditional string for
  exactly this case: `"PDF files are imported as Draw documents and cannot
  be exported to Office formats."` This isn't an omission to work around;
  the wrapper enforces it as a rule.
- The load side of the protocol never lets a caller force an import filter
  either way: `documentLoadWithOptions(path, options)`'s `options` string is
  used for exactly one thing across the whole file —
  `` `,Password=${password}` `` — never a `FilterName`. There is no
  parameter that could ask LibreOfficeKit to import a `.pdf` via Writer's
  `writer_pdf_import` instead of whatever auto-detection picks (which, per
  the `ne`/`ie` evidence above, is Draw's `draw_pdf_import`).

So: PDF import through this package always produces a Draw document, never
an editable Writer one, and the JS layer refuses to export a Draw document
to `docx` even if it were asked to. **`pdf-to-word` is not built** — not a
scope cut, a confirmed infeasibility of this specific engine's exposed
surface. A real pdf-to-word conversion (reflowing a PDF's text/layout back
into an editable Writer document) would need either a different
`libreoffice-wasm` build whose wrapper exposes `FilterName` at load time, or
a from-scratch text-reflow engine — both out of scope for this slice.

### Addendum (2026-09-28): txt/html-to-pdf

Two more direct LibreOffice conversions, same shape as `word-to-pdf`:
`txt-to-pdf` and `html-to-pdf` add `txt`/`html` to `INPUT_EXT` — both
classify as the nested worker's own `"text"` doc type (the `ne` table the
PDF-import addendum above already read), the same Writer import path
docx/odt/rtf use, just via the `Text`/`HTML (StarWriter)` filters. `html`
is a new `FormatSpec` (`src/lib/registry/formats.ts`): a `text` format (no
fixed signature, identified by extension) like md/csv, not a binary one.
LibreOffice runs under this app's `connect-src 'self'` the same as every
other engine, so a dropped HTML file's external images/`@import`ed
stylesheets simply fail to load — stated in `html-to-pdf`'s own description,
not discovered later as a silent rendering gap.

### Addendum (2026-09-28): epub-to-pdf via a new `epub` engine

`epub-to-pdf` needed a second engine, since LibreOffice has no EPUB import
filter at all (absent from both the `ne`/`fe` tables and the filter-name
table `q` — epub only appears in the wrapper's own extension-normalization
table, never as an actual import path). EPUB is just a zip of XHTML
chapters plus an OPF manifest naming their reading order, and `fflate`
(already a dependency, the streaming ZIP sink's writer) can read a zip
synchronously with no new dependency — so `epub-to-pdf` is a two-step
pipeline: a new `epub` engine (`src/lib/engines/epub/`, pure JS, `bundled`
location, no wasm) unzips the file, resolves `META-INF/container.xml` ->
the OPF's `<manifest>`/`<spine>`, concatenates each spine chapter's
`<body>` in order into one HTML document (images inlined as `data:` URIs
resolved against the zip's own files, or dropped with an inline HTML
comment when the zip doesn't actually contain the referenced file — never
a silently-broken relative path), and hands that HTML to the exact same
`libreoffice` `html -> pdf` step `html-to-pdf` uses. Deliberately not a full
XML parser: `container.xml`/OPF are small, fixed-shape documents, and this
reads them with regexes over each self-contained tag rather than pull in a
general (namespace-aware) XML library for it. No NCX/nav fallback, no
encrypted EPUBs, no fixed-layout metadata — spine order only, per the
brief; EPUB's own reflowable CSS isn't preserved either, since the output is
plain HTML into LibreOffice's own HTML import, not a CSS-aware renderer.
Documented in `epub-to-pdf`'s description as approximate layout, same
caveat `markdown-to-pdf` already states for its own image handling.

## Alternatives considered

- **mammoth / docx-preview (JS-only docx renderers).** Rejected: coverage is
  a subset of real-world docx (mammoth explicitly ignores most layout;
  docx-preview is closer but still not print-fidelity), and neither touches
  xlsx/pptx/odt/ods/odp/doc/xls/ppt at all — three more libraries, three
  more fidelity gaps, for a worse result than one engine that actually runs
  the office suite's own layout code.
- **Server-side conversion (a LibreOffice headless service).** Rejected
  outright by ADR-0001 (no server, no upload path) before fidelity even
  enters the discussion.
- **Skip office formats for this phase.** Considered, since the provenance
  risk is real and the size is large. Rejected because word/excel/
  powerpoint-to-pdf are among the most commonly requested conversions this
  project's tool list is missing, and the risk is bounded by sandboxing +
  CSP the same way `ffmpeg`'s GPL/size tradeoff already is.
