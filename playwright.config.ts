import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against a real built `out/`, served the way production
 * serves it.
 *
 * `webServer` runs `wrangler dev` against `infra/wrangler.jsonc` — the same
 * static-asset handling, the same `_headers`, the same origin shape as
 * production. Serving `out/` with a generic static server would not apply
 * `_headers`, so `crossOriginIsolated` would be false and the CSP absent:
 * the two things these tests exist to verify. It assumes `out/` was already
 * built with `pnpm build` — `wrangler dev` serves what's there, it doesn't
 * build it.
 *
 * There are still no specs (Phase 0.5 adds the first) and `pnpm e2e` is not
 * part of `pnpm verify`.
 */
/**
 * `E2E_PORT` lets parallel agents/worktrees each run their own `wrangler dev`
 * (default 8788). A shared port plus `reuseExistingServer` would silently
 * test another checkout's build.
 */
const port = Number(process.env.E2E_PORT ?? 8788);

export default defineConfig({
  testDir: "./e2e",
  // Runs once, after webServer is up and before any spec — see
  // e2e/global-setup.ts's doc comment for the cold-start flake it fixes.
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Capped locally: 4+ parallel workers against one cold wrangler server
  // pushed engine-heavy tests past their timeouts (2026-09-27, verified:
  // same fresh build green with 1 worker, flaky with the default).
  workers: process.env.CI ? 1 : 2,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",

  use: {
    baseURL: `http://localhost:${port}`,
    trace: "on-first-retry",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      grepInvert: /@libreoffice/,
    },
    // Every test that boots LibreOffice (tagged `@libreoffice`). Each one
    // starts its own 8-thread wasm instance, and several at once starve each
    // other past the app's 60s engine-start watchdog (2026-10-02: excel-to-pdf
    // timed out with ~8 in flight). Real users boot one at a time, so this
    // project runs them serially, after the main project, so nothing else is
    // competing for the machine either.
    {
      name: "libreoffice",
      use: { ...devices["Desktop Chrome"] },
      grep: /@libreoffice/,
      fullyParallel: false,
      workers: 1,
      dependencies: ["chromium"],
    },
  ],

  webServer: {
    // Seeds `wrangler dev --local`'s R2 simulation from `.engines-r2/`
    // (gitignored, populated by `pnpm build`'s `sync-engines` step) before
    // the server starts — see scripts/seed-r2-local.ts's doc comment. A
    // no-op until an r2-hosted engine (ffmpeg) exists to seed.
    command: `node scripts/seed-r2-local.ts && pnpm exec wrangler dev --config infra/wrangler.jsonc --port ${port} --local`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
