# ADR-0018: Open files from the OS and the share sheet

- **Status:** Accepted
- **Date:** 2026-10-01

## Context

Localvert had no web app manifest and no icons, so it couldn't be installed,
and there was no way to get a file into it except opening the site and
dropping or picking one. Two entry points people expect from an installed app
were missing: "Open with Localvert" from the OS, and Localvert in a phone's
share sheet.

Both are browser features that hand a page a file the user chose. Neither
needs a server, but both need care: a share is delivered as a `POST`, and
invariant 1 says user file data never touches the network.

## Decision

**Manifest.** `src/app/manifest.ts` emits `/manifest.webmanifest` at build
time (`force-static`): name, standalone display, the icon set
(`public/icons/`, plus `src/app/icon.svg` and `src/app/apple-icon.png`) and
the canvas and accent colours from ADR-0016. The icon is a rounded accent
square with two opposing arrows.

**File handlers.** One `file_handlers` entry points at `/open`. Its `accept`
map (mime to extensions) is built by `fileHandlerAccept()` from the generated
catalog, so every input format some tool accepts is registered with the OS,
and a new tool's format shows up on the next `pnpm gen`. `launch_type` is
`single-client`, so a second file opens in the window that's already there.

**Share target.** `share_target` is a `POST` with `multipart/form-data` to
`/share-target`, with the same accept list. A static host has no handler for
that and would answer 405, so the service worker answers it (`src/sw.ts`).
The fetch handler reads `request.formData()`, writes each file into a
dedicated Cache Storage cache (`localvert-share-v1`) under synthetic
same-origin keys, with the name and type kept in headers, and returns a 303
to `/open?share=1`. It always calls `respondWith`, and it ends the event
before Serwist's listener runs, so the request is never passed on.

**`/open`.** A small client island (noindex, not in the sitemap). It takes
files from `window.launchQueue` or, for `?share=1`, from the stash (copying
the bytes out and deleting the cache). It classifies them with the same
sniffing a drop uses, then reuses the ADR-0015 handoff store: if exactly one
non-app tool accepts every detected format it goes to that tool page,
otherwise to the home converter, which reads a second handoff key
(`HOME_HANDOFF_KEY`) on mount. With nothing to open it says so and links
home.

**Privacy.** The share `POST` is intercepted on the device. It never reaches
the network, because the worker produces the redirect itself. The stash is
same-origin Cache Storage and is emptied on first read (and replaced on the
next share if a read never happened). `public/_headers` is unchanged:
`manifest-src` falls back to `default-src 'self'`, the icons are same-origin,
and a share target isn't a page form submission, so `form-action 'none'`
doesn't apply to it.

## Consequences

- Browser support is uneven, and that's fine. `file_handlers` works in
  Chromium on desktop once the app is installed. `share_target` works in
  Chrome on Android. iOS Safari supports neither, so iOS users keep using the
  drop zone.
- A share only works once the service worker is controlling the page. On a
  first-ever visit with no worker, the OS would get a 405. Installing the app
  implies the worker is already there.
- Shared files are copied into memory when read from the stash, so a very
  large share costs its size once more until it is handed off.
- The accept list is long (46 input formats), and an OS may show Localvert as
  an "Open with" option for all of them. That follows from the registry and
  is what we want.

## Alternatives considered

- **`protocol_handlers`.** Nothing in Localvert is addressed by a custom
  protocol. Skipped.
- **`launch_handler` tuning beyond `single-client`.** The default behaviour
  is enough for now. Revisit if multi-window launches turn out confusing.
- **Hand shared files over without a stash** (for example `postMessage` to
  the opened client). The client doesn't exist yet when the worker answers
  the `POST`, so the files need somewhere to wait.
- **A GET share target with a URL.** It can't carry files.
- **IndexedDB for the stash.** Cache Storage stores a `Response` body without
  an extra serialisation step, and the worker already uses it.
