# ADR-0001: Convert entirely client-side, and make it verifiable

- **Status:** Accepted
- **Date:** 2026-09-09

## Context

Every mainstream file converter uploads. iLovePDF, Smallpdf, CloudConvert,
Zamzar and the long tail of "free converter" sites all take the file to a
server, convert it there, and hand back a link. Their privacy pages promise
deletion after N hours. That promise is unfalsifiable from the outside — a
user cannot check it, and a breach or a policy change invalidates it
retroactively for files already sent.

The files people convert are exactly the sensitive ones: passports for a visa
application, medical scans, signed contracts, tax documents, unreleased media.
"We delete it later" is the wrong shape of guarantee for that content.

Browsers can now do this work locally. WebAssembly runs the same codecs the
servers run; WebCodecs gives hardware-accelerated video; the File System Access
API and OPFS handle files larger than memory. The technical reason to upload
has largely evaporated — what remains is inertia and the ad-supported business
model that a server round-trip enables.

Surveying the local-first field: VERT converts images locally but sends video
to a server. BentoPDF is local but PDF-only. Squoosh is local but images-only
and effectively unmaintained. Nothing covers the full matrix locally.

## Decision

Every conversion runs in the user's browser, in a Web Worker, via WebAssembly
or a native browser API. No server, no API route, no upload path.

Enforce it, do not merely promise it. `public/_headers` ships
`Content-Security-Policy: … connect-src 'self'`. The page cannot open a
connection to any other origin — not by accident, not by a compromised
dependency, not by a future contributor's mistake. A user who does not trust
us can open devtools, watch the network tab during a conversion, and see
nothing leave. The guarantee is checkable in ten seconds by a non-expert.

Two supporting rules follow from this and are recorded as invariants in
[ARCHITECTURE.md](../ARCHITECTURE.md):

- CI asserts it. A Playwright test intercepts every request during a real
  conversion and fails the run if anything leaves the origin.
- No telemetry on file content, ever. Not filenames, not sizes, not formats.
  If analytics is ever added it covers page views only, and it will need its
  own ADR arguing why the CSP should permit it.

## Consequences

**What it buys**

- A privacy claim that is a property of the artifact, not of our conduct. It
  survives us being acquired, breached, or careless.
- No infrastructure cost that scales with usage. No conversion servers, no
  egress bill for user files, no queue, no storage lifecycle policy.
- Nothing to breach. There is no bucket of user documents to leak.
- Works offline once the service worker has cached the engine.
- No file size limit imposed by an upload timeout — limits are the device's.

**What it costs**

- Engine payloads. ffmpeg core-mt is ~32 MB, LibreOffice ~80 MB. These must be
  lazily fetched behind an explicit user gate, which is a worse first-run
  experience than a server that already has ffmpeg installed.
- Conversion speed is bounded by the user's device. A cheap phone converting
  4K video will be slow, and we cannot fix that by scaling up.
- Browser support becomes a product constraint. Missing `SharedArrayBuffer` or
  WebCodecs means a slower path or no path, hence the capability router.
- Memory ceilings are real. Large files need OPFS spill and streaming sinks
  rather than "load it all into an ArrayBuffer".
- Some conversions may stay out of reach — anything needing a licensed binary
  or a font library too large to ship.
- No server logs. Debugging a user's failed conversion means reproducing it,
  because we will never see their file.

## Alternatives considered

**Client-side with a server fallback for hard formats.** Rejected. The moment
one path uploads, the guarantee becomes conditional, the CSP has to be widened,
and the user has to understand which conversions are private. A guarantee with
an asterisk is a marketing claim, not a property. The whole differentiator is
that there is no asterisk.

**Server-side with a strong deletion policy.** Rejected. This is what everyone
already does, done no better, and it is unverifiable by construction.

**Desktop app.** Rejected as the primary form. It solves privacy but loses the
zero-install reach that makes a converter useful — people find these tools
through search when they need one, once. A PWA gets most of the benefit; the
installability story covers the rest.
