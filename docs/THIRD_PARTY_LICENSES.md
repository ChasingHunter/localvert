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

## Copyleft engines

Engines under GPL or LGPL, listed separately because they carry obligations
beyond attribution. Each is loaded at arms length as described above.

| Engine | License | Obligation | How it is met |
|---|---|---|---|
| `heic` (`heic-to`, wraps libheif) | LGPL-3.0 | Source offer for the LGPL library; users must be able to relink against a modified libheif | We ship `heic-to`'s published build unmodified, fetched from npm at build time and never vendored or patched (ADR-0002) — the link to https://github.com/hoppergee/heic-to above satisfies the source offer. `heic-to` itself wraps libheif compiled to asm.js/wasm, unmodified from upstream. |
| `libraw` (`libraw-wasm`, wraps LibRaw) | LGPL-2.1 / CDDL-1.0 dual (LibRaw itself; the `libraw-wasm` JS/wasm wrapper is ISC) | Source offer for LibRaw; users must be able to relink against a modified LibRaw | We ship `libraw-wasm`'s published build unmodified, fetched from npm at build time and never vendored or patched (ADR-0002) — https://github.com/ybouane/LibRaw-Wasm satisfies the source offer. `libraw-wasm` itself wraps LibRaw compiled to WebAssembly via Emscripten, unmodified from upstream. |

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
