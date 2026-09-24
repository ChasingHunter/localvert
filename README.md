# Localvert

[![CI](https://github.com/ChasingHunter/localvert/actions/workflows/ci.yml/badge.svg)](https://github.com/ChasingHunter/localvert/actions/workflows/ci.yml)

A local-first file converter — images, video, audio, PDF, documents,
compression. **Files never leave your browser.**

## Privacy by construction

This isn't a policy, it's a property of how the app is built. Every
conversion runs client-side, in a Web Worker, via WebAssembly or native
browser APIs. There is no server, no API route, and no upload path — and
`public/_headers` sets a Content-Security-Policy of `connect-src 'self'`, so
the page is not merely asked not to upload your file, it is physically unable
to. Open DevTools → Network while converting something and see for yourself:
nothing but the app's own static assets ever leaves the machine.

## Status

Early. This project is currently in **Phase 0 — Foundation**: getting a fresh
clone to build, verify, deploy, and convert one real file end-to-end with zero
network I/O. See [docs/ROADMAP.md](docs/ROADMAP.md) for what's done and what's
next, and [docs/CONVERTERS.md](docs/CONVERTERS.md) for which conversions
currently work.

## How it works

A conversion is a route derived from a data file — format in, format out, an
options schema, a pipeline — not hand-written code per tool. The main thread
only ever touches the DOM and object URLs; decoding, encoding and zipping all
happen in a worker behind a router that probes runtime capabilities and picks
an engine. Full write-up in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Develop

```sh
pnpm i
pnpm dev      # dev server with the COOP/COEP headers SharedArrayBuffer needs
pnpm verify   # typecheck + lint + test + build — the Definition of Done
```

See [CLAUDE.md](CLAUDE.md) for the full command reference and the invariants
every change has to hold, and [CONTRIBUTING.md](CONTRIBUTING.md) to add a
conversion or an engine.

## Deploy

Static export, served as a Cloudflare Worker with static assets — no
server, no Pages. Oversized engines (ffmpeg, LibreOffice) are served from an
R2 bucket bound to the same Worker, so everything stays on one origin and the
CSP never has to widen. Why Workers instead of Pages is recorded in
[ADR-0003](docs/adr/0003-workers-static-assets-over-pages.md).

## License

MIT — see [LICENSE](LICENSE). Localvert loads third-party WebAssembly
conversion engines at runtime under their own licenses (some GPL/LGPL); none
are vendored into this repository. See
[docs/THIRD_PARTY_LICENSES.md](docs/THIRD_PARTY_LICENSES.md).
