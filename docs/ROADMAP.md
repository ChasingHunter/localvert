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
- [x] Next.js 16 `output: "export"` + React 19 + TypeScript 7 (`tsc`) (2026-09-24)
- [x] Tailwind 4 (shadcn/ui deferred, below) (2026-09-24)
- [x] Biome (replaces ESLint + Prettier) (2026-09-09)
- [x] Vitest (unit + browser mode) and Playwright configs (2026-09-09)
- [x] `package.json` scripts: `dev build typecheck lint test verify` (2026-09-09)
      — `gen` and `sync-engines` land with their scripts in 0.4 and 0.7
- [x] `pnpm verify` green **and idempotent** on an empty app (2026-09-09)
- [x] Playwright `webServer` — deferred to 0.7, needs `wrangler dev` to serve
      `out/` with real `_headers` (a plain static server would not apply them) (2026-09-24)
- [x] shadcn/ui init — hand-written components.json + 8 primitives (2026-09-25)

### 0.4 Core plumbing
One small commit per bullet — these are the contracts everything else hangs on.
- [x] `src/lib/registry/` — `ToolDefinition`, `Category`, format table
      (ext + mime + **magic bytes**, so input is sniffed not trusted) (2026-09-24)
- [x] Worker `lib` setup (ADR-0005: second tsc program, `tsconfig.worker.json`) (2026-09-24): the root `tsconfig.json` has `lib: [DOM, ...]` only.
      `DOM` and `WebWorker` conflict, so worker files need
      `/// <reference lib="webworker" />` or their own tsconfig — decide and
      write it down when the first worker lands.
- [x] `src/lib/engines/types.ts` — `EngineAdapter` / `EngineInstance` contracts (2026-09-24)
- [x] `scripts/gen-registry.ts` + `pnpm gen` — generated barrels, checked in (2026-09-25)
- [x] `src/lib/workers/` — pool, Comlink RPC, lazy module workers (2026-09-25)
- [x] `src/lib/jobs/` — job engine, FIFO queue, progress, zustand store (2026-09-25)
- [x] `src/lib/router/` — capability probes (WebCodecs, SAB, OffscreenCanvas,
      OPFS) and the engine router that reads them (2026-09-24)
- [x] `src/lib/sinks/` — blob sink, streaming ZIP sink (fflate) (2026-09-24)
- [x] UI: dropzone, job card, generated options form (2026-09-25)

### 0.5 First tool end-to-end
- [x] `canvas` engine adapter (2026-09-25)
- [x] `src/tools/image/jpg-to-png.ts` registry entry (2026-09-25)
- [x] Unit tests (registry, router) + browser-mode test (real worker, real canvas) (2026-09-25)
- [x] E2E: single file, and batch of 3 → ZIP, magic-bytes asserted; SW-controlled path covered (2026-09-25)
- [x] `feat(tool): jpg to png via canvas engine` (2026-09-25)

### 0.6 PWA and headers
- [x] `public/_headers` — COOP/COEP + the CSP that makes upload impossible (2026-09-24)
- [x] Serwist SW (post-build injectManifest after CSP injection; precache shell, CacheFirst `/engines/*`) (2026-09-25)
- [x] Offline page (/offline, shown only on real network failure) (2026-09-25)
- [ ] Offline E2E: a used tool still converts with the network cut (with 0.5b e2e)

### 0.7 Infrastructure
- [x] `infra/wrangler.jsonc` — static assets from `out/`, R2 binding,
      `run_worker_first: ["/engines/xl/*"]` (2026-09-24)
- [x] `infra/worker/index.ts` — xl-engine range/cache/R2 handler (~40 lines) (2026-09-24)
- [x] `scripts/sync-engines.ts` — npm → `public/engines/<id>@<ver>/`;
      >20 MiB flagged for R2 (2026-09-25)
- [x] `scripts/upload-r2.ts` — content-hash-aware upload (2026-09-25)
- [x] `scripts/check-sizes.ts` — core <300 KB gz; fail if an engine lands in a
      core chunk (2026-09-24)

### 0.8 CI/CD
All `uses:` pinned to full commit SHAs. Top-level `permissions: {}`.
- [x] `ci.yml` — verify + gen-drift + size budget (2026-09-24)
- [x] Deploy — moving from `deploy.yml` into a `ci.yml` job that ships the verified build artifact (2026-09-24)
- [x] `release-please.yml` (2026-09-24)
- [x] `codeql.yml`, `dependency-review.yml`, `dependabot.yml` (2026-09-24)
- [x] Issue/PR templates, README, CONTRIBUTING, SECURITY, CODE_OF_CONDUCT (2026-09-24)

### 0.9 Ship
- [x] Public repo ChasingHunter/localvert, first push (2026-09-25)
- [x] Branch rulesets on `main`: force-push and deletion blocked for everyone; CI `Check`, `Build`,
      `Browser and wasm integration` required, admins bypass so direct pushes work (2026-09-25)
- [x] Cloudflare: R2 bucket `localvert-engines`, `production` environment with
      `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` secrets **(owner)** (2026-09-24)
- [x] workers.dev subdomain registered (needed before the first CI deploy) **(owner)** (2026-09-25)
- [x] First deploy green (https://localvert.chasinghunter.workers.dev); E2E 3/3 against the live URL (2026-09-25)
- [x] Privacy assertion in CI: Playwright fails the run if **any** request
      leaves the origin during a conversion (2026-09-25)

---

## Phase 1 — Images

Goal: the image matrix people actually search for, fast and batched.

- [x] Raster pipeline foundation: decode → transform → encode in one worker (ADR-0007) (2026-09-25)
- [x] Image engines: jsquash jpeg/png/webp/avif/jxl (single-threaded — MT
      variants still open), heic, resvg, utif, psd (2026-09-25)
- [x] Format matrix: jpg · png · webp · avif · jxl (jSquash, MT when isolated) (2026-09-25)
- [x] heic/heif → jpg/png (heic-to; LGPL — record in THIRD_PARTY_LICENSES) (2026-09-25)
- [x] svg → png/jpg (resvg-wasm) (2026-09-25)
- [x] raster → svg trace (@image-tracer-ts/core, MIT; png/jpg/webp → svg) (2026-09-25)
- [x] tiff (utif2), psd (@webtoon/psd) (2026-09-25)
- [x] camera raw (libraw-wasm; glue loaded at runtime; synthetic DNG fixture added) (2026-09-25)
- [x] Compress with a **target size** (binary search on quality) (2026-09-25)
- [x] Resize, rotate, strip EXIF (default on — privacy) (2026-09-25)
- [x] Crop with interactive crop editor (2026-09-25)
- [x] Golden-file tests per codec (perceptual PSNR + size ±25%, not byte-exact) (2026-09-25)
- [x] Batch of 50 images (1600×1200 JPG → PNG → zip): 14.8 s, main-thread JS heap peak 121 MB (budget 400 MB); worker memory not measurable headless (`E2E_SLOW=1`) (2026-09-25)

## Phase 2 — PDF

- [x] merge, split, rotate, delete/extract pages (@cantoo/pdf-lib; ADR-0008
      many-to-one/one-to-many tools) — reorder still pending (2026-09-26)
- [x] images → PDF (`images-to-pdf`, @cantoo/pdf-lib, many-to-one) — PDF →
      images is the "Render to image" item below (2026-09-26)
- [ ] Compress: ≥40% reduction on an image-heavy fixture
- [x] Protect / unlock (password, AES-256 via @cantoo/pdf-lib — both
      directions genuinely supported, not just protect) — flatten forms
      still pending (2026-09-26)
- [x] Render to image (pdfjs-dist, self-hosted worker + cmaps) (2026-09-26)
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
- TypeScript 7 (tsgo) friction: if it bites, pin 5.9 and write an ADR
