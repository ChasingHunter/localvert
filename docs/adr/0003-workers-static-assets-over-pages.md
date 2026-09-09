# ADR-0003: Deploy as a Cloudflare Worker with static assets, not Pages

- **Status:** Accepted
- **Date:** 2026-09-09

## Context

The build output is a fully static `out/` directory (ADR-0001: no server). The
obvious host is Cloudflare Pages, which is purpose-built for exactly that. The
owner's question was whether Pages is the right target.

Two facts decide it.

**Pages is feature-frozen.** Cloudflare's own documentation now steers new
projects to Workers static assets and describes Pages as maintained but not
receiving new capabilities. Building on a frozen product means a migration
later, at a worse time.

**We need R2 in the same deploy unit.** Static assets on both Pages and Workers
have a **25 MiB per-file limit**. Several engines exceed it:

| Engine | Size | Placement |
|---|---|---|
| Most jSquash codecs, canvas, pdf-lib | < 5 MB | static |
| `@ffmpeg/core-mt` | ~32 MB | **too large** |
| LibreOffice wasm | ~80 MB | **too large** |
| Large tesseract traineddata | 10–40 MB | varies |

Those oversized engines must be served from R2. And they must be served from
**the same origin**, because `connect-src 'self'` (ADR-0001) forbids fetching
them from anywhere else. Widening the CSP is not on the table — it is the
product's guarantee.

A Worker can bind an R2 bucket and serve it under our own path in the same
deployment. Pages cannot do this as cleanly, and the direction of travel is
away from it regardless.

## Decision

Deploy one Cloudflare Worker that serves the static assets from `out/`, with an
R2 bucket `localvert-engines` bound as `ENGINES` and
`run_worker_first: ["/engines/xl/*"]`.

Everything except `/engines/xl/*` is served directly as a static asset and
never invokes Worker code. The Worker runs only for oversized engine fetches:
check `caches.default`, fall back to R2, respond with `immutable` cache headers
and `Cross-Origin-Resource-Policy: same-origin`. Roughly forty lines.

`scripts/sync-engines.ts` enforces placement mechanically: engines ≤20 MiB are
copied into `public/engines/<id>@<ver>/` and ship as static assets; anything
larger is flagged and uploaded to R2 under `xl/<id>@<ver>/`. The 20 MiB
threshold leaves headroom under the 25 MiB hard limit. Version-in-path makes
every URL immutable, so both the edge cache and the service worker can keep it
forever.

## Consequences

**What it buys**

- On a supported, actively developed platform.
- Oversized engines on the same origin, so the CSP stays at `'self'`.
- One deploy unit: app, worker, and R2 binding ship together with one
  `wrangler deploy`.
- Static requests — the entire app plus every engine ≤20 MiB — are free and
  unmetered. Worker quota is only consumed by first-time xl-engine fetches.

**Free-tier arithmetic** (a stated constraint, so it is recorded):

| Quota | Limit | Our usage |
|---|---|---|
| Static asset requests and bandwidth | unlimited, free | the whole app |
| Worker requests | 100k/day | only `/engines/xl/*` first fetches |
| Worker CPU | 10 ms/invocation | R2 streaming is I/O, not CPU |
| R2 storage / egress | 10 GB / zero egress | engines total < 200 MB |
| Worker script size | 3 MiB | ours is ~40 lines |
| Files per deploy | 20,000 | well under |

An xl engine is 2–3 files, so 100k Worker requests/day covers roughly 30–50k
*first-time* users of an exotic format per day. Repeat users are served by the
service worker and never touch the Worker. If the quota is ever exceeded, only
xl-engine downloads fail — the core app, and every engine ≤20 MiB, keep working
because they are static assets. The paid tier ($5/mo, 10M requests) is the
trivial fix.

**What it costs**

- Slightly more configuration than Pages: a `wrangler.jsonc`, a small Worker,
  and an R2 bucket to provision.
- Deploys run from GitHub Actions with a scoped API token rather than Pages'
  git integration. Cloudflare offers no GitHub OIDC path, so a scoped token is
  the security ceiling: Workers Scripts:Edit and Workers R2 Storage:Edit only,
  stored in the `production` environment.
- Two placement paths for engines instead of one, which `sync-engines` has to
  keep honest.

**Scale path, if the Worker quota ever becomes the binding constraint:** serve
xl engines directly from an R2 custom domain. R2 Class B reads are 10M/month
free with zero egress and no Worker invocation at all. The cost is a custom
domain, bucket CORS and CORP configuration, and widening the CSP by exactly one
subdomain we control. Noted here so the option is not rediscovered under
pressure — but it is a last resort, since it weakens the single-origin story.

## Alternatives considered

**Cloudflare Pages.** Rejected: feature-frozen, and does not give a clean R2
binding in the same deploy unit. Same 25 MiB per-file limit, so it does not
even solve the problem that forced the question.

**Any static host (Netlify, Vercel, GitHub Pages) plus a separate CDN for
engines.** Rejected: a second origin breaks `connect-src 'self'`. Every one of
these would force a CSP widening, which is the one thing that cannot be traded.

**Ship every engine as a static asset and skip R2.** Not possible — the 25 MiB
per-file limit is hard, and ffmpeg core-mt and LibreOffice are both over it.

**Split large engines into <25 MiB chunks and reassemble in the browser.**
Rejected: real complexity, defeats browser and edge caching of the real
artifact, and breaks streaming instantiation for a self-inflicted reason.
