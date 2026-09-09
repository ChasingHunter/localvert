import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against a real built `out/`, served the way production
 * serves it.
 *
 * The `webServer` block is wired up in Phase 0.7 alongside `infra/`, so that
 * these tests run against `wrangler dev` — the same static-asset handling,
 * the same `_headers`, the same origin shape as production. Serving `out/`
 * with a generic static server would not apply `_headers`, so
 * `crossOriginIsolated` would be false and the CSP absent: the two things
 * these tests exist to verify.
 *
 * Until then there are no specs (Phase 0.5 adds the first) and `pnpm e2e` is
 * not part of `pnpm verify`.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",

  use: {
    baseURL: "http://localhost:8788",
    trace: "on-first-retry",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
