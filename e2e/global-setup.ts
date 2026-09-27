import { chromium, type FullConfig } from "@playwright/test";

/**
 * Warms the wrangler-served build and its engine assets once, before any
 * test file runs, to fix a cold-start flake seen 2026-09-27: the *first*
 * full `pnpm e2e` run after a fresh build intermittently timed out waiting
 * for a Download link or `navigator.serviceWorker.ready` (pdf-to-png,
 * strip-exif, compress-pdf, jpg-to-png) — green on rerun and with a single
 * worker. The cause is the very first hits against a cold `wrangler dev`
 * asset cache and the first wasm fetch for each engine kind both landing at
 * once, under N parallel workers; running one conversion per engine kind
 * here, serially, before the suite starts, makes those fetches happen once
 * and get cached rather than racing.
 *
 * Runs after `webServer` is already up: Playwright's task order starts the
 * `webServer` plugin (config.webServer) before invoking `config.globalSetup`
 * — see `createGlobalSetupTasks` in `playwright/lib/runner/index.js`, which
 * runs `createPluginSetupTasks` (the webServer plugin included) ahead of
 * the user's `globalSetups`. So `baseURL` below is guaranteed reachable.
 *
 * Picks one jsquash tool (`png-to-jpg`, wasm image codec) and the pdf.js
 * engine (`pdf-to-png`) — the two engine families implicated in the flake
 * above — rather than every engine kind, to keep this fast (<20s).
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL) {
    throw new Error("global-setup: no baseURL configured on the first project");
  }

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();

    await page.goto(baseURL);
    await page.evaluate(() => navigator.serviceWorker.ready);

    await warmTool(page, baseURL, "png-to-jpg", "e2e/fixtures/not-a-jpg.png");
    await warmTool(page, baseURL, "pdf-to-png", "e2e/fixtures/a.pdf");

    await page.close();
  } finally {
    await browser.close();
  }
}

/** Runs one real conversion on `slug` and waits for its Download link, the
 * same signal every e2e spec waits on — see e.g. `e2e/jpg-to-png.spec.ts`. */
async function warmTool(
  page: import("@playwright/test").Page,
  baseURL: string,
  slug: string,
  fixturePath: string,
): Promise<void> {
  await page.goto(new URL(`/tools/${slug}`, baseURL).toString());
  await page.locator('input[type="file"]').setInputFiles(fixturePath);
  await page
    .getByRole("link", { name: "Download" })
    .first()
    .waitFor({ state: "visible", timeout: 15_000 });
}
