# ADR-0006: A two-layer CSP — tolerant header, hash-strict per-page meta

- **Status:** Accepted
- **Date:** 2026-09-24

## Context

`next build` with `output: "export"` inlines a small `<script>` on every page
— the RSC payload and hydration data Next needs before React can attach. A
header `Content-Security-Policy: script-src 'self'` would block that script
on every route, which breaks the app.

The obvious fix — a per-route `_headers` rule listing that route's own script
hash — doesn't scale to a site whose whole premise is a growing matrix of tool
pages. Cloudflare Pages' `_headers` format caps out at 100 rules and 2,000
characters per line; the tool registry alone is already headed well past 100
routes, and a header rule shares a line with every other directive on the
policy. Serving `_headers` off the Cloudflare Worker that fronts `out/`
(ADR-0003) instead of Cloudflare's static-asset header matching would work
around the rule cap, but it means routing every page view through Worker
compute to set headers on an otherwise fully static response — Worker request
quota spent on a response that needs no server logic at all.

## Decision

Enforce the script CSP in two layers, both browser-enforced, aimed at
different things:

1. **Header layer, `public/_headers`, every path.** Strict everywhere that
   guards the no-upload guarantee (`connect-src 'self' blob:`, `object-src
   'none'`, `frame-ancestors 'none'`, `form-action 'none'`, COOP/COEP, …) but
   tolerant on scripts: `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'`.
   This layer alone would let any inline script run — it exists to make the
   rest of the policy match on every response without a per-route rule, not
   to police scripts.
2. **Meta layer, injected per page.** `scripts/csp-inline-hashes.ts` runs as
   part of `pnpm build` (`next build && node scripts/csp-inline-hashes.ts`),
   walks every `out/**/*.html`, hashes that page's own inline `<script>`
   content (sha256, CSP's `'sha256-<base64>'` source format), and inserts
   `<meta http-equiv="Content-Security-Policy" content="script-src 'self'
   'wasm-unsafe-eval' 'sha256-…' …">` as the **first child of `<head>`** —
   meta CSP only governs content that follows it in the document, so it has
   to come before any `<script>` tag, including the inlined one it's
   allow-listing.

When a page ships both layers, the browser enforces the *intersection* of
every `script-src` it sees, per the CSP spec's multiple-policy behavior. The
header's `script-src` includes `'unsafe-inline'`; the meta's does not. The
header layer alone permits inline execution — it is the meta layer, with its
explicit hash list and no `'unsafe-inline'`, that actually forbids any
inline script not on that list. The header's `'unsafe-inline'` is not
"overridden" so much as it becomes moot the instant the stricter meta layer
is present: intersecting with a policy that lacks `'unsafe-inline'` drops it
from the effective policy for anything after that `<meta>` tag.

This was verified empirically with a throwaway Playwright script serving a
built `out/` with the `_headers` CSP applied: zero `securitypolicyviolation`
events on the page's own inlined script, and an extra inline `<script>`
manually appended to the served HTML (simulating an injected/tampered
script) was blocked and reported as a violation.

## Consequences

**What it buys**

- Every route gets a hash-strict script policy without a per-route `_headers`
  rule, so the rule-count and line-length ceilings never come into play no
  matter how large the tool registry grows.
- No Worker compute on the request path for a static response — `out/` keeps
  being served as pure static assets (ADR-0003).
- The guarantee stays checkable per page: open devtools on any route, and the
  only scripts allowed to run are the ones actually shipped with that page.

**What it costs**

- The post-build step is now load-bearing, not cosmetic. Deploys **must** run
  `pnpm build`, which chains `csp-inline-hashes.ts` after `next build`.
  Running `next build` directly ships pages with only the tolerant header
  layer and no meta layer, silently reopening the inline-script hole this ADR
  closes — nothing in the static output itself would flag that it happened.
- Hashes are content-derived, so they differ on every build. They're
  regenerated, not committed, which is fine — they only need to match the
  bytes actually shipped in that same `out/`.
- A meta `http-equiv="Content-Security-Policy"` cannot carry every directive;
  in particular `frame-ancestors` (and `sandbox`, `report-uri`) are ignored
  by browsers when set via `<meta>`. Clickjacking protection therefore has to
  stay solely in the header layer — it is not, and cannot be, duplicated or
  tightened by the meta layer.

## Alternatives considered

**Nonces.** Rejected. A nonce has to be freshly generated per response and
echoed into both the header and the inline `<script nonce="…">` tag, which
needs a request-time server. A static export has no request cycle to
generate one in — this is the same objection as worker-injected headers
below, just for a per-request random value instead of a per-page fixed one.

**Per-route `_headers` rules, one per page, listing that page's script
hashes in the header CSP.** Rejected — this is the problem statement, not a
solution: `_headers` caps at 100 rules and 2,000 characters per line, and the
registry is headed past 100 routes by design.

**Worker-injected headers per response**, computing and setting the CSP (with
that page's hashes) from the Cloudflare Worker instead of `_headers`.
Rejected. It solves the rule-count ceiling but at the cost of routing every
page view through Worker compute instead of Cloudflare's static-asset path —
spending request quota and adding latency to serve a response that is, and
should stay, pure static output. It also duplicates the meta script's job:
whatever the Worker could put in a response header, the post-build script can
put directly in the page it's already generating, for free, at build time
instead of at every request.

**`'unsafe-inline'` only, no meta layer, everywhere.** Rejected. It builds
and ships cleanly, which is exactly the danger — nothing would fail if a
future dependency, build plugin, or contributor's mistake introduced an
inline `<script>` that shouldn't be there. ADR-0001's whole premise is a
privacy claim that's checkable, not promised; a CSP that quietly allows any
inline script isn't checkable the way an empty network tab is.
