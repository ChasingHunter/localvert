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
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",

  use: {
    baseURL: `http://localhost:${port}`,
    trace: "on-first-retry",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  webServer: {
    command: `pnpm exec wrangler dev --config infra/wrangler.jsonc --port ${port} --local`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
