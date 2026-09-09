# Roadmap

**Read this first in a new session.** It is the handoff between sessions that
share no context: what is done, what is next, and why.

Check items off **with the date** as you complete them (`- [x] … (2026-09-09)`).
An unchecked box is work not started or not finished — never a box checked
optimistically.

Status legend: `[ ]` todo · `[x] (date)` done · `[~]` in progress · `[-]` cut,
with a one-line reason.

---

## Phase 0 — Foundation

Goal: a fresh clone builds, verifies, deploys, and converts one real file
end-to-end with zero network I/O.

### 0.1 Repo bootstrap
- [x] git init on `main`, `.gitignore`, `.gitattributes` (LF everywhere) (2026-09-09)
- [x] MIT LICENSE (2026-09-09)
- [x] CLAUDE.md — agent entrypoint, invariants, commit rules (2026-09-09)
- [x] `.claude/settings.json` — permissions, format hook, no AI attribution (2026-09-09)
- [x] `.claude/skills/` — add-converter, add-engine, preflight, release (2026-09-09)

### 0.2 Docs skeleton
- [x] ARCHITECTURE.md, ADDING_A_TOOL.md, this file (2026-09-09)
- [x] ADR 0001 client-side only · 0002 MIT + GPL isolation ·
      0003 Workers static assets over Pages · 0004 release-please (2026-09-09)
- [x] CONVERTERS.md, ENGINES.md, THIRD_PARTY_LICENSES.md (headers + empty tables) (2026-09-09)

### 0.3 App scaffold
- [ ] Next.js 16 `output: "export"` + React 19 + TypeScript (tsgo)
- [ ] Tailwind 4 + shadcn/ui init
- [ ] Biome (replaces ESLint + Prettier)
- [ ] Vitest (unit + browser mode) and Playwright configs
- [ ] `package.json` scripts: `dev build typecheck lint test verify gen sync-engines`
- [ ] `pnpm verify` green on an empty app

### 0.4 Core plumbing
One small commit per bullet — these are the contracts everything else hangs on.
- [ ] `src/lib/registry/` — `ToolDefinition`, `Category`, format table
      (ext + mime + **magic bytes**, so input is sniffed not trusted)
- [ ] `src/lib/engines/types.ts` — `EngineAdapter` / `EngineInstance` contracts
- [ ] `scripts/gen-registry.ts` + `pnpm gen` — generated barrels, checked in
- [ ] `src/lib/workers/` — pool, Comlink RPC, lazy module workers
- [ ] `src/lib/jobs/` — job engine, FIFO queue, progress, zustand store
- [ ] `src/lib/router/` — capability probes (WebCodecs, SAB, OffscreenCanvas,
      OPFS) and the engine router that reads them
- [ ] `src/lib/sinks/` — blob sink, streaming ZIP sink (fflate)
- [ ] UI: dropzone, job card, generated options form

### 0.5 First tool end-to-end
- [ ] `canvas` engine adapter
- [ ] `src/tools/image/jpg-to-png.ts` registry entry
- [ ] Unit tests (registry, router) + browser-mode test (real worker, real canvas)
- [ ] E2E: single file, and batch of 3 → streaming ZIP, magic-bytes asserted
- [ ] `feat(tool): jpg to png via canvas engine`

### 0.6 PWA and headers
- [ ] `public/_headers` — COOP/COEP + the CSP that makes upload impossible
- [ ] Serwist SW via `@serwist/turbopack` (precache shell, CacheFirst `/engines/*`)
- [ ] Offline page; verify a used tool still converts with the network cut

### 0.7 Infrastructure
- [ ] `infra/wrangler.jsonc` — static assets from `out/`, R2 binding,
      `run_worker_first: ["/engines/xl/*"]`
- [ ] `infra/worker/index.ts` — xl-engine range/cache/R2 handler (~40 lines)
- [ ] `scripts/sync-engines.ts` — npm → `public/engines/<id>@<ver>/`;
      >20 MiB flagged for R2
- [ ] `scripts/upload-r2.ts` — content-hash-aware upload
- [ ] `scripts/check-sizes.ts` — core <300 KB gz; fail if an engine lands in a
      core chunk

### 0.8 CI/CD
All `uses:` pinned to full commit SHAs. Top-level `permissions: {}`.
- [ ] `ci.yml` — verify + gen-drift + size budget
- [ ] `deploy.yml` — production environment, scoped Cloudflare token
- [ ] `release-please.yml`
- [ ] `codeql.yml`, `dependency-review.yml`, `dependabot.yml`
- [ ] Issue/PR templates, README, CONTRIBUTING, SECURITY, CODE_OF_CONDUCT

### 0.9 Ship
- [ ] `gh repo create ChasingHunter/localvert --public`, first push **(owner)**
- [ ] Branch ruleset on `main`: require `verify`, block force-push and deletion,
      do not require PRs **(owner)**
- [ ] Cloudflare: account, R2 bucket `localvert-engines`,
      `CLOUDFLARE_API_TOKEN` in the `production` environment **(owner)**
- [ ] First deploy green; E2E against the live URL
- [ ] Privacy assertion in CI: Playwright fails the run if **any** request
      leaves the origin during a conversion

---

## Phase 1 — Images

Goal: the image matrix people actually search for, fast and batched.

- [ ] Format matrix: jpg · png · webp · avif · jxl (jSquash, MT when isolated)
- [ ] heic/heif → jpg/png (heic-to; LGPL — record in THIRD_PARTY_LICENSES)
- [ ] svg → png/jpg (resvg-wasm) and raster → svg trace (later)
- [ ] tiff (utif2), psd (@webtoon/psd), camera raw (libraw-wasm)
- [ ] Compress with a **target size** (binary search on quality)
- [ ] Resize, crop, rotate, strip EXIF (default on — privacy)
- [ ] Golden-file tests per codec (byte-stable output)
- [ ] Batch of 50 images stays under ~1.5 GB peak memory

## Phase 2 — PDF

- [ ] merge, split, rotate, reorder, delete pages (@cantoo/pdf-lib)
- [ ] images ↔ PDF both directions
- [ ] Compress: ≥40% reduction on an image-heavy fixture
- [ ] Protect / unlock (password), flatten forms
- [ ] Render to image (pdfjs-dist, self-hosted worker + cmaps)
- [ ] OCR (tesseract.js; self-host traineddata — the default CDN fetch
      violates our CSP, which is the point)

## Phase 3 — Video and audio

- [ ] mediabunny (WebCodecs) as the primary path — mp4/webm/mov, audio extract,
      trim, mute, resize
- [ ] Faster than realtime on 1080p via WebCodecs
- [ ] ffmpeg.wasm **fallback only**: avi, wmv, flv, GIF out (GPL — isolated
      worker, lazy fetch, ADR-0002)
- [ ] Audio: mp3/wav/flac/ogg/m4a, bitrate and sample-rate control

## Phase 4 — Documents

- [ ] Markdown → PDF (typst.ts)
- [ ] Office → PDF via LibreOffice wasm (~80 MB, **opt-in download gate**, MPL-2.0)
- [ ] Text-ish conversions: csv/json/yaml/xlsx

## Phase 5 — Polish

- [ ] i18n
- [ ] `file_handlers` and `share_target` in the manifest (open files from the OS)
- [ ] Cache manager UI + `navigator.storage.estimate()`
- [ ] Accessibility pass, Lighthouse ≥95 across the board
- [ ] Per-tool SEO pages generated from the registry

---

## Decisions still open

- Custom domain (currently `localvert.<account>.workers.dev`)
- Whether to trace raster → SVG at all, or link out
- TypeScript 7 (tsgo) friction: if it bites, pin 5.9 and write an ADR
