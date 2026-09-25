# Testing

Five layers, each answering a different question, each with a different cost.
Run the cheapest layer that still buys real signal for what you touched — see
[CLAUDE.md](../CLAUDE.md)'s Definition of Done for how that maps to gates
(`pnpm check` vs `pnpm verify`).

## The layers

| Layer | Command | What it proves | Speed |
| --- | --- | --- | --- |
| Unit | `pnpm test` | Pure logic: registry, format table, naming, option coercion, `src/test/image-metrics.ts`. No browser, no wasm — a jsdom shim of those APIs would test the shim, not the engine. | Fast (seconds) |
| Browser | `pnpm test:browser` | Real workers, real wasm, real canvas/OPFS — every `*.browser.test.ts` under `src/`, run in a real headless Chromium via `vitest.browser.config.ts`. The only place an engine adapter is actually exercised. | Slower (a real browser boots) |
| Golden-file | part of `pnpm test:browser` (`src/lib/engines/golden.browser.test.ts`) | Codec regressions on a dependency bump — a new mozjpeg/oxipng/libwebp/libavif/libjxl, a browser update — without brittle exact-byte assertions. See [Golden-file tests](#golden-file-tests) below. | Same as browser layer |
| E2E | `pnpm e2e` | The real built `out/`, served the way production serves it (`wrangler dev` + real `_headers`): routing, the privacy/CSP guards, a full convert-and-download flow. Not part of `pnpm check`/`pnpm verify` yet — see `playwright.config.ts`'s doc comment. | Slow (build + serve + browser) |
| Slow E2E | `E2E_SLOW=1 pnpm e2e` | Load-shaped checks that are correct but too slow for a normal run — currently just `e2e/batch-memory.spec.ts`. See [Slow tests](#slow-tests) below. | Slowest |

Unit and browser tests are split by config (`vitest.config.ts` vs
`vitest.browser.config.ts`) because they need different environments, not
because one is more important. `pnpm check` runs only the **unit** layer
(`pnpm test`) plus typecheck and lint — the browser layer is deliberately
left out (it needs a browser binary and is slower). Run it yourself with
`pnpm test:browser` before trusting an engine change; it still runs in CI
regardless.

## Golden-file tests

`src/lib/engines/golden.browser.test.ts` encodes one fixed, deterministic
64x64 test pattern (a gradient, a hard-edged block, a transparent corner)
through each encoder — canvas (png/jpg/webp) and jSquash
(jpeg/png/webp/avif/jxl) — decodes the result back, and checks two things
instead of exact output bytes (which drift on every encoder point release
even when nothing is actually wrong):

- **Perceptual quality** — PSNR of the round-trip against the source (or,
  for a format with no alpha channel like jpg, against the source composited
  onto white — the same blend the encoder itself performs). Lossless formats
  require an exact pixel match (`Infinity` dB); lossy ones have a dB floor
  loose enough to survive a normal point release but tight enough to catch a
  real regression.
- **Output size** — within +/-25% of a golden byte count recorded in
  `src/lib/engines/golden.json`.

### Filling in `golden.json`

`golden.json` ships with every value `null`. A `null` entry is **record
mode**: the test measures the size, logs it via `console.warn` (so it
survives a default-level log filter) in the form

```
[golden:record] <key> measured <N> bytes. Paste into src/lib/engines/golden.json: "<key>": <N>
```

and passes without asserting a size ratio. To fill them in: run
`pnpm test:browser`, copy each printed line's `"<key>": <N>` into
`golden.json`, commit. From then on that entry enforces the +/-25% band.

This is the deliberately simple option over having the test write
`golden.json` back to disk itself (via the vitest browser mode
commands/server-file API) — a real file write from inside a browser-mode
test is more moving parts for a one-time, human-reviewed step. A golden size
is exactly the kind of number a person should glance at before it becomes a
gate.

## Slow tests

`e2e/batch-memory.spec.ts` batch-converts 50 realistically-sized (~hundreds
of KB) JPEGs, generated in-browser, and asserts the peak main-thread JS heap
(sampled every 500ms via `Performance.getMetrics` over CDP) stays under
400MB — per [ADR-0007](adr/0007-raster-pipeline.md), the raster pipeline
holds one full frame per in-flight job, not per batch, so peak memory should
be bounded by the worker pool's size, not the batch size. It's tagged
`@slow` and, since this slice's brief didn't touch `playwright.config.ts`,
gated by `test.skip(!process.env.E2E_SLOW, ...)` rather than a `grepInvert`
config — run it explicitly:

```sh
E2E_SLOW=1 pnpm e2e batch-memory
```

It is not part of the default `pnpm e2e` run, and not part of `pnpm verify`.

## ULTRA-FAST mode (delegated slices)

An `implementer` agent working a single scoped slice under a tight timebox
typically runs `pnpm typecheck && pnpm lint` only, **not** `pnpm test` /
`pnpm test:browser` / `pnpm e2e` — those run once, for real, in the
planner's mass pass after a batch of slices lands (see
`CLAUDE.local.md`'s "Parallel waves"). That means a new test file's
assertions (thresholds, golden values, timing) are unverified at commit
time; treat a freshly-added test as a hypothesis until the mass pass
actually runs it, and expect to tune thresholds — PSNR floors, golden sizes,
generated-fixture size targets — once real numbers come back.
