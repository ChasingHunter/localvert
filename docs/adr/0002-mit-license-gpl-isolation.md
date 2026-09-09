# ADR-0002: MIT for our code, arms-length isolation for GPL engines

- **Status:** Accepted
- **Date:** 2026-09-09

## Context

Localvert is MIT by preference: maximum reuse, no obligations pushed onto
anyone who forks it or borrows a module.

Some engines we need are not MIT.

| Engine | License | Why we want it |
|---|---|---|
| `@ffmpeg/core-mt` | **GPL-2.0+** (via x264) | Fallback only: avi, wmv, flv, GIF output |
| `heic-to` (libheif) | **LGPL-3.0** | HEIC/HEIF from iPhones — a top-requested conversion |
| `@bentopdf/libreoffice-wasm` | MPL-2.0 | Office to PDF (Phase 4) |
| `mediabunny` | MIT | The **primary** video and audio path |

MPL and LGPL are straightforward here. GPL is the real question: if the
deployed site "links" GPL code, a strict reading says the whole site must be
GPL, which contradicts the MIT intent.

Worth stating plainly: this is a judgment call about a legal question that has
never been settled for WebAssembly delivered to a browser. There is no case law
on whether a lazily fetched wasm binary running in a separate worker
constitutes a derivative work. What follows is a defensible position and an
exit plan, not a guarantee.

## Decision

License our own code MIT, and keep GPL engines at arms length structurally, so
the "combined work" argument is as weak as we can make it:

1. **Never vendor GPL binaries.** No GPL artifact is committed to this
   repository. `scripts/sync-engines.ts` pulls them from npm at build time.
   The repo — the thing people clone and fork — is MIT end to end.
2. **Unmodified upstream artifacts only.** We ship the published build exactly
   as released. We do not patch, recompile, or statically combine it with our
   code. If an engine ever needs a patch, it gets its own ADR.
3. **Separate execution context.** GPL engines load in a dedicated Web Worker
   via dynamic `import()`, communicating only by message passing across the
   worker boundary. Our code never links against them in any build step; there
   is no shared address space with the app bundle and no shared symbol table.
4. **Fetched at runtime, on demand.** The engine is not part of the app
   payload. It downloads only when a user picks a format that needs it —
   avi, wmv, flv, or GIF output — behind an explicit size-gated prompt.
5. **Full attribution and source offer.** [THIRD_PARTY_LICENSES.md](../THIRD_PARTY_LICENSES.md)
   and an in-app licenses page list every engine with its license text and a
   link to upstream source. For unmodified binaries, pointing at upstream
   satisfies the GPL source-offer requirement.
6. **Prefer the permissive path.** mediabunny (MIT) handles all common video
   and audio. ffmpeg is reached only for formats WebCodecs cannot do. Most
   users never download it.

## Consequences

**What it buys**

- Our code is genuinely MIT. A fork, a borrowed sink, a copied registry
  pattern carries no copyleft obligation.
- Users get HEIC and legacy video support rather than a gap in the matrix.
- The clone is clean: no GPL bytes in git history, so no license question
  attaches to the repository itself.

**What it costs**

- **The honest caveat:** a strict reader could still argue the *deployed site*
  — app plus fetched GPL engine, running together in one browser session — is
  a combined work and therefore GPL-encumbered. We think message-passing
  across a worker boundary with a lazily fetched, unmodified binary is the
  arms-length end of the spectrum, and closer to "aggregation" than "linking".
  We are not certain, and we are not lawyers.
- Extra machinery: `sync-engines` must fetch rather than read from the tree,
  and the license table is a maintenance obligation on every engine change.
- The download gate is a worse UX for those formats than bundling would be.

**If the position is ever challenged**, two mitigations are ready and neither
loses a feature:

- **GIF output** → replace ffmpeg with `gifenc` (MIT) or a similar JS encoder.
  GIF is the only *common* reason a user reaches ffmpeg today.
- **Legacy containers** → build a custom ffmpeg with `--disable-gpl` and
  without x264, which is LGPL. x264 is only needed for H.264 *encoding*, and
  WebCodecs already encodes H.264 natively. Decoding avi/wmv/flv does not need
  the GPL components.

Taken together, dropping GPL entirely is a bounded amount of work, not a
rewrite. That is the point of keeping it at arms length.

## Alternatives considered

**License the whole project GPL.** Would end the question outright. Rejected:
it pushes copyleft onto every fork and every borrowed module, for the sake of
one fallback engine that most users never download. The tail wagging the dog.

**Drop GPL engines now.** Rejected as premature. It would cut avi/wmv/flv and
GIF output on day one to solve a hypothetical, when the escape hatch above is
a few days of work whenever it is actually needed.

**Dual-license, or a linking exception.** Not ours to grant — we do not hold
copyright on ffmpeg or x264.

**Ship ffmpeg from a third-party CDN so we "never touch" it.** Rejected on
privacy grounds, which outrank licensing here. It would require widening
`connect-src` beyond `'self'` and break the ADR-0001 guarantee. It is also
transparently a fig leaf.
