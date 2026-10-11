# Localvert

[![CI](https://github.com/ChasingHunter/localvert/actions/workflows/ci.yml/badge.svg)](https://github.com/ChasingHunter/localvert/actions/workflows/ci.yml)

Convert, compress and edit files in the browser: images, video, audio, PDF and
documents. **Files never leave your device.**

Live at [localvert.dpdns.org](https://localvert.dpdns.org).

## Features

- About 130 tools across images, video, audio, PDF, documents, archives and
  data. HEIC and camera RAW to JPEG, video to MP4 or GIF, Word and
  spreadsheets to PDF, and more.
- Compress, resize, merge and split.
- Drop any file to see every format it can be converted to, or pick the
  source and target formats directly.
- A PDF editor for annotating, signing, filling forms, editing text and
  redacting.
- Installable as an app. Files can be opened from the file manager or the
  share sheet, and each converter works offline after its first use.

The full list is in [docs/CONVERTERS.md](docs/CONVERTERS.md).

## Privacy

Every conversion runs in a Web Worker on your device, using WebAssembly or
built-in browser APIs. There is no conversion server and no upload endpoint.
The Content-Security-Policy in `public/_headers` sets `connect-src 'self'`, so
the page cannot send a file to any other server. To confirm, open the Network
tab in your browser's developer tools and run a conversion: the only requests
are for the app's own files.

## How it works

Each tool is defined as data (input format, output format, an options schema
and a pipeline of steps) rather than hand-written code. Routes, option forms
and SEO pages are generated from these definitions. The main thread only
renders the page. Decoding, encoding and zipping run in a worker, where a
router checks what the browser supports and picks an engine. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for details.

## Development

```sh
pnpm i
pnpm dev      # dev server with the COOP/COEP headers SharedArrayBuffer needs
pnpm check    # typecheck, lint and unit tests
pnpm verify   # check plus build, size budget and CSP checks
```

[CLAUDE.md](CLAUDE.md) lists every command and the rules each change must
follow. [CONTRIBUTING.md](CONTRIBUTING.md) covers adding a conversion or an
engine.

## Deployment

The site is a static export served by a Cloudflare Worker with static assets.
Engines too large for static assets (ffmpeg, LibreOffice, Typst) are served
from an R2 bucket bound to the same Worker, so everything stays on one origin
and the CSP does not need to allow other hosts.
[ADR-0003](docs/adr/0003-workers-static-assets-over-pages.md) explains the
choice of Workers over Pages.

## License

MIT, see [LICENSE](LICENSE). Localvert loads third-party WebAssembly engines
at runtime under their own licenses, some of them GPL or LGPL. See
[docs/THIRD_PARTY_LICENSES.md](docs/THIRD_PARTY_LICENSES.md).
