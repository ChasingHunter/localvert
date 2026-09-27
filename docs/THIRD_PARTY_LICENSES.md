# Third-party licenses

Localvert itself is [MIT](../LICENSE). It ships and lazily fetches third-party
engines, some under copyleft licenses. This file is the attribution record and
the source offer.

**Every engine gets an entry here before its adapter is written.** License
review is the first step of the
[add-engine](../.claude/skills/add-engine/SKILL.md) checklist, not the last.
The rationale for shipping copyleft engines under an MIT project is
[ADR-0002](adr/0002-mit-license-gpl-isolation.md); read it before adding
anything with a GPL or LGPL entry.

## How engines are shipped

No third-party binary is committed to this repository. `scripts/sync-engines.ts`
pulls each engine from npm at build time, and we ship the **published upstream
build, unmodified**. Engines load in a dedicated Web Worker via dynamic
`import()`, communicating only by message passing, and are fetched at runtime
only when a user selects a format that needs them.

For unmodified binaries, the links in the Source column satisfy the source-offer
obligation of the GPL and LGPL. If we ever need to patch an engine, that
requires its own ADR and we must publish the modified source.

---

## Engines

| Engine | Version | License | Copyright | Source |
|---|---|---|---|---|
| `jsquash-jpeg` (`@jsquash/jpeg`, wraps mozjpeg) | 1.6.0 | Apache-2.0 (wrapper); the mozjpeg codec itself is the libjpeg-turbo tri-license (IJG / Modified 3-clause BSD / zlib) | Independent JPEG Group; D. R. Commander and libjpeg-turbo contributors; Google Inc. (Squoosh repackaging); Jamie Sinclair (jSquash) | https://github.com/jamsinclair/jSquash |
| `jsquash-png` (`@jsquash/png`, wraps Squoosh's png codec) | 3.1.1 | Apache-2.0 (wrapper); the png codec itself is BSD-3-Clause | Copyright (c) 2010, Google Inc.; Jamie Sinclair (jSquash) | https://github.com/jamsinclair/jSquash |
| `jsquash-webp` (`@jsquash/webp`, wraps libwebp) | 1.5.0 | Apache-2.0 (wrapper); libwebp itself is BSD-3-Clause | Copyright (c) 2010, Google Inc.; Jamie Sinclair (jSquash) | https://github.com/jamsinclair/jSquash |
| `jsquash-resize` (`@jsquash/resize`) | 2.1.1 | Apache-2.0 (wrapper); the Lanczos3 resize kernel this adapter uses is MIT | Copyright 2015 PistonDevelopers; Jamie Sinclair (jSquash) | https://github.com/jamsinclair/jSquash |
| `jsquash-avif` (`@jsquash/avif`, wraps libavif) | 2.1.1 | Apache-2.0 (wrapper); libavif is BSD-2-Clause, its aom/dav1d codec dependencies are BSD-2-Clause / BSD-2-Clause | Alliance for Open Media; Jamie Sinclair (jSquash) | https://github.com/jamsinclair/jSquash |
| `jsquash-jxl` (`@jsquash/jxl`, wraps libjxl) | 1.3.0 | Apache-2.0 (wrapper); libjxl itself is BSD-3-Clause | JPEG XL contributors; Jamie Sinclair (jSquash) | https://github.com/jamsinclair/jSquash |
| `resvg` (`@resvg/resvg-wasm`) | 2.6.2 | MPL-2.0 (file-level copyleft — see below) | yisibl and resvg-js contributors | https://github.com/yisibl/resvg-js |
| `psd` (`@webtoon/psd`) | 0.4.0 | MIT | NAVER WEBTOON | https://github.com/webtoon/psd |
| `utif` (`utif2`) | 4.1.0 | MIT | photopea and UTIF.js contributors | https://github.com/photopea/UTIF.js |
| `tracer` (`@image-tracer-ts/core`) | 1.0.2 | MIT | Moritz Ringler | https://github.com/mringler/image-tracer-ts |
| `pdf-lib` (`@cantoo/pdf-lib`) | 2.11.1 | MIT | Andrew Dillon (original `pdf-lib`); Cantoo Scribe (this fork) | https://github.com/cantoo-scribe/pdf-lib |
| `pdfjs` (`pdfjs-dist`) | 6.3.289 | Apache-2.0 | Mozilla and pdf.js contributors | https://github.com/mozilla/pdf.js |
| `tesseract` (`tesseract.js`, wraps the Tesseract OCR engine) | 7.0.0 | Apache-2.0 (`tesseract.js` and `tesseract.js-core`) | Jerome Wu, Kevin Kwok, Guillermo Webster and tesseract.js contributors; Google (Tesseract) | https://github.com/naptha/tesseract.js |
| `tesseract`'s English language data (`@tesseract.js-data/eng`) | 1.0.0 | MIT | Balearica and tessdata contributors | https://github.com/naptha/tessdata |
| `pdfium` (`@embedpdf/pdfium`, wraps PDFium/Chrome's PDF engine) | 2.15.1 | MIT (wrapper); PDFium itself is BSD-3-Clause / Apache-2.0 (dual, per file) | EmbedPDF contributors; Google (PDFium) | https://github.com/embedpdf/embed-pdf-viewer |
| `@embedpdf/models`, `@embedpdf/engines` (the PDF editor's engine API and worker-side runner, `EngineRunner`/`WebWorkerEngine`/`PdfEngine`) | 2.15.1 | MIT | EmbedPDF contributors | https://github.com/embedpdf/embed-pdf-viewer |
| `@embedpdf/core` + `plugin-document-manager`, `plugin-viewport`, `plugin-scroll`, `plugin-render`, `plugin-zoom`, `plugin-thumbnail`, `plugin-selection`, `plugin-interaction-manager`, `plugin-annotation`, `plugin-history`, `plugin-export` (the PDF editor's viewer UI) | 2.15.1 | MIT | EmbedPDF contributors | https://github.com/embedpdf/embed-pdf-viewer |
| `mediabunny` (WebCodecs container mux/demux for video and audio) | 1.60.0 | MPL-2.0 (file-level copyleft — see below) | Vanilagy | https://github.com/Vanilagy/mediabunny |
| `@mediabunny/mp3-encoder` (wraps a LAME wasm build; wired into every mp3-output audio tool as of Phase 3b) | 1.60.0 | MPL-2.0 (wrapper); LAME itself is LGPL | Vanilagy; the LAME project | https://github.com/Vanilagy/mediabunny |
| `@mediabunny/flac-encoder` (wraps a libFLAC wasm build; wired into wav-to-flac and every other flac-output audio tool) | 1.60.0 | MPL-2.0 (wrapper); libFLAC itself is BSD | Vanilagy; the FLAC project (Xiph.Org Foundation) | https://github.com/Vanilagy/mediabunny |
| `gifenc` (pure-JS GIF encoder + color quantizer; `video-to-gif`'s `toGif` op, replacing ffmpeg for GIF output per ADR-0002) | 1.0.3 | MIT | Matt DesLauriers | https://github.com/mattdesl/gifenc |
| `ffmpeg` (`@ffmpeg/core`, wraps FFmpeg built with libx264) | 0.12.10 | **GPL-2.0-or-later** (via x264) — see the copyleft table below | ffmpegwasm contributors; the FFmpeg project; x264 (VideoLAN) | https://github.com/ffmpegwasm/ffmpeg.wasm |
| `papaparse` (CSV parse/unparse) | 5.7.0 | MIT | Matt Holt and Papa Parse contributors | https://github.com/mholt/PapaParse |
| `yaml` (YAML parse/stringify) | 2.9.1 | ISC | Eemeli Aro | https://github.com/eemeli/yaml |
| `read-excel-file` (xlsx read) | 9.3.10 | MIT | catamphetamine | https://gitlab.com/catamphetamine/read-excel-file |
| `write-excel-file` (xlsx write) | 4.1.1 | MIT | catamphetamine | https://gitlab.com/catamphetamine/write-excel-file |
| `typst.ts` / `typst-ts-web-compiler` (Markdown/PDF compile, `typst` 0.14.2 core) | 0.7.0 | Apache-2.0 | Myriad-Dreamin and typst.ts contributors; the Typst Project | https://github.com/Myriad-Dreamin/typst.ts |
| `libreoffice` (`@bentopdf/libreoffice-wasm`, wraps LibreOfficeDev 24.8 built to wasm/pthreads) | 2.3.1 | MPL-2.0 (file-level copyleft — see below) | The Document Foundation and LibreOffice contributors; the package's maintainer (npm-only; no repository/README field) | https://www.npmjs.com/package/@bentopdf/libreoffice-wasm (package); https://git.libreoffice.org (LibreOffice core source, the actual MPL-2.0-covered work) |
| `cmarker` (vendored Typst package, markdown -> Typst content) | 0.1.8 | MIT | Sabrina Jewson | https://github.com/SabrinaJewson/cmarker.typ (`vendor/typst-packages/preview/cmarker/0.1.8/`) |
| Libertinus Serif (vendored font, body text) | v0.14.2 (typst-assets pin) | OFL-1.1 | The Libertinus Project Authors | https://github.com/alerque/libertinus (`vendor/typst-fonts/`) |
| DejaVu Sans Mono (vendored font, raw/code text) | v0.14.2 (typst-assets pin) | Bitstream Vera License (+ Public Domain DejaVu changes) | Bitstream, Inc.; the DejaVu fonts team | https://dejavu-fonts.github.io (`vendor/typst-fonts/`) |

`jsquash-webp`'s underlying codec is libwebp, Copyright 2010 Google Inc.,
BSD-3-Clause (`node_modules/@jsquash/webp/codec/LICENSE.codec.md` after
install) — permissive, no additional obligation beyond attribution, recorded
here for completeness since it's a different license than the npm wrapper's.
`jsquash-resize`'s resize kernel (the only one of its three bundled
algorithms this adapter uses — see `src/lib/engines/jsquash-resize/
adapter.ts`) is Copyright 2015 PistonDevelopers, MIT
(`node_modules/@jsquash/resize/lib/resize/LICENSE.codec.md`).

`resvg` (`@resvg/resvg-wasm`) is MPL-2.0, a **file-level** copyleft: it only
requires that modified *files* of the covered work be published under MPL,
not the combining application. We ship the unmodified upstream wasm/JS
build, so this carries no obligation beyond attribution — recorded here
rather than in the copyleft table below, which is for GPL/LGPL's
whole-work-level obligations.

`mediabunny` is MPL-2.0, the same file-level copyleft as `resvg` above: it
only requires that modified *files* of the covered work be published under
MPL, not the combining application. We ship the unmodified upstream npm
build, so this carries no obligation beyond attribution. See
[ADR-0010](adr/0010-media-pipeline.md) (and the corrected mediabunny row in
[ADR-0002](adr/0002-mit-license-gpl-isolation.md), which previously listed it
as MIT). `@mediabunny/mp3-encoder` additionally wraps a LAME wasm build
(LGPL), wired into every mp3-output audio tool as of Phase 3b — its LGPL
source-offer obligation is in the copyleft table below, alongside `heic`
and `libraw`. `@mediabunny/flac-encoder` wraps a libFLAC wasm build instead —
libFLAC is BSD-3-Clause (permissive), so unlike the mp3-encoder it carries no
copyleft obligation beyond attribution, recorded here rather than in the
copyleft table below.

`libreoffice` (`@bentopdf/libreoffice-wasm`) is MPL-2.0, the same file-level
copyleft as `resvg`/`mediabunny` above: it only requires that modified *files*
of the covered work (LibreOffice core, compiled to wasm) be published under
MPL, not the combining application. We ship the unmodified upstream wasm/JS
build, so this carries no obligation beyond attribution and the source link
above — recorded here rather than in the copyleft table below, which is for
GPL/LGPL's whole-work-level obligations. See
[ADR-0012](adr/0012-libreoffice-office-to-pdf.md) for this package's
provenance risk (single, anonymous npm maintainer; no repository or README) and
why we still ship it: sandboxed in its own worker, and `connect-src 'self'`
means it cannot exfiltrate anything even if it wanted to.

`tracer` (`@image-tracer-ts/core`) is a TypeScript reimplementation of
[imagetracerjs](https://github.com/jankovicsandras/imagetracerjs), which is
released under the [Unlicense](https://unlicense.org) (public domain
dedication) — even more permissive than this package's own MIT license. No
additional obligation beyond what MIT already requires; noted here for
completeness since the algorithm's origin carries a different license than
the npm package we actually depend on.

`cmarker` and the two vendored fonts (Libertinus Serif, DejaVu Sans Mono) have
no owning npm package — `scripts/sync-engines.ts`'s "local" package sentinel
(`src/lib/engines/types.ts`'s `EngineSourceFile` doc comment) copies them
straight from this repo's own `vendor/` tree instead. All four files were
fetched once, at dev time, from their respective upstream sources (see
ADR-0011) and committed verbatim, alongside each one's own license file under
`vendor/typst-fonts/`/`vendor/typst-packages/preview/cmarker/0.1.8/` — same
"unmodified upstream build" rule as every npm-sourced engine above, just
without npm as the delivery mechanism.

**Modified:** `typst-ts-web-compiler`'s wasm-bindgen glue
(`typst_ts_web_compiler.mjs`) is not shipped verbatim. Apache-2.0 permits
modification (§4), and `scripts/sync-engines.ts`'s `patchTypstGlue` rewrites
exactly two generated import functions — replacing their `new Function(...)`
string-eval calls with a closed lookup table over the five fixed dummy-method
bodies the wasm module ever actually requests — so the module runs under
this app's CSP (`script-src` has no `unsafe-eval`, and never will — see
CLAUDE.md's invariants). See ADR-0011 for the mechanism and why it's provably
safe (the wasm never passes anything else to those two imports).

## Copyleft engines

Engines under GPL or LGPL, listed separately because they carry obligations
beyond attribution. Each is loaded at arms length as described above.

| Engine | License | Obligation | How it is met |
|---|---|---|---|
| `heic` (`heic-to`, wraps libheif) | LGPL-3.0 | Source offer for the LGPL library; users must be able to relink against a modified libheif | We ship `heic-to`'s published build unmodified, fetched from npm at build time and never vendored or patched (ADR-0002) — the link to https://github.com/hoppergee/heic-to above satisfies the source offer. `heic-to` itself wraps libheif compiled to asm.js/wasm, unmodified from upstream. |
| `libraw` (`libraw-wasm`, wraps LibRaw) | LGPL-2.1 / CDDL-1.0 dual (LibRaw itself; the `libraw-wasm` JS/wasm wrapper is ISC) | Source offer for LibRaw; users must be able to relink against a modified LibRaw | We ship `libraw-wasm`'s published build unmodified, fetched from npm at build time and never vendored or patched (ADR-0002) — https://github.com/ybouane/LibRaw-Wasm satisfies the source offer. `libraw-wasm` itself wraps LibRaw compiled to WebAssembly via Emscripten, unmodified from upstream. |
| `@mediabunny/mp3-encoder` (wraps LAME) | LGPL (LAME itself; the `@mediabunny/mp3-encoder` JS/wasm wrapper is MPL-2.0) | Source offer for LAME; users must be able to relink against a modified LAME | We ship `@mediabunny/mp3-encoder`'s published build unmodified, fetched from npm at build time and never vendored or patched — https://github.com/Vanilagy/mediabunny (package directory `packages/mp3-encoder`) satisfies the source offer. It wraps LAME compiled to WebAssembly, unmodified from upstream. |
| `ffmpeg` (`@ffmpeg/core`, wraps FFmpeg + x264) | **GPL-2.0-or-later** (the strictest license this project ships — see ADR-0002's full discussion) | Source offer for FFmpeg/x264; a strict GPL reading would ask the whole combined work (app + this engine, running together) to be GPL | We ship `@ffmpeg/core`'s published build unmodified, fetched from npm at build time and never vendored or patched — https://github.com/ffmpegwasm/ffmpeg.wasm and https://www.ffmpeg.org satisfy the source offer. Loaded in its own dedicated worker (`heavy: true`, ADR-0002 rule 3), fetched only on demand from R2 when a user picks avi/wmv/flv output (rule 4), never bundled or statically linked against our code (rule 3) — the arms-length position ADR-0002 argues, not a certainty. A download-consent prompt in front of the fetch (naming the license per rule 5) is still open — see the ADR-0002 dated note below. |

## Build and development dependencies

Tooling that does not ship to users — Next.js, React, TypeScript, Biome,
Vitest, Playwright, Wrangler and their transitive dependencies. All permissive
(MIT, Apache-2.0, BSD, ISC). Not enumerated here; `pnpm licenses list` produces
the current set from the lockfile.

Only code that reaches a user's browser is tracked in the tables above.

---

## In-app licenses page

The tables above are mirrored at `/licenses` in the app, so a user can read the
attribution without visiting the repository. Both are generated from the engine
manifest, so they cannot drift — but if you edit one by hand, edit both.
