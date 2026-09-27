import { readFileSync } from "node:fs";
import { test as base, expect } from "@playwright/test";

/**
 * End to end against a real built `out/` — see e2e/jpg-to-png.spec.ts's doc
 * comment for why. Covers Phase 3c's `video-to-gif` (gifenc, not ffmpeg —
 * ADR-0002's dated mitigation note) on the `mediabunny` engine's `toGif` op,
 * through a real dedicated worker — not just the in-vitest coverage in
 * src/lib/engines/mediabunny/gif.browser.test.ts.
 *
 * Reuses `e2e/fixtures/sample.mp4` (320x240, 2s, H.264 + AAC, ~30KB), the
 * same fixture `mp4-to-webm`'s e2e/video.spec.ts drops.
 */
const GIF_MAGIC = "GIF89a";

function fixturePath(name: string): string {
  return `e2e/fixtures/${name}`;
}

interface Fixtures {
  /** Autouse: fails the test if any request left the page's own origin. */
  privacyGuard: undefined;
  /** Autouse: fails the test if the browser ever reported a CSP violation. */
  cspGuard: undefined;
}

const test = base.extend<Fixtures>({
  privacyGuard: [
    async ({ page, baseURL }, use) => {
      const ownOrigin = new URL(baseURL ?? "http://localhost:8788").origin;
      const foreign: string[] = [];
      page.on("request", (request) => {
        const origin = new URL(request.url()).origin;
        if (origin !== ownOrigin) foreign.push(request.url());
      });

      await use(undefined);

      expect(
        foreign,
        "no request should ever leave the page's own origin — files never leave the browser",
      ).toEqual([]);

      const isolated = await page.evaluate(() => self.crossOriginIsolated);
      expect(
        isolated,
        "page must be cross-origin isolated (COOP/COEP from public/_headers)",
      ).toBe(true);
    },
    { auto: true },
  ],

  cspGuard: [
    async ({ page }, use) => {
      const violations: string[] = [];
      await page.exposeFunction("__onCspViolation", (detail: string) => {
        violations.push(detail);
      });
      await page.addInitScript(() => {
        document.addEventListener("securitypolicyviolation", (e) => {
          // @ts-expect-error — bridged in by exposeFunction above.
          window.__onCspViolation(`${e.violatedDirective}: ${e.blockedURI}`);
        });
      });

      await use(undefined);

      expect(violations, "no CSP violation should occur").toEqual([]);
    },
    { auto: true },
  ],
});

test.describe("video-to-gif", () => {
  test("converts a dropped MP4 clip to a downloadable animated GIF", async ({
    page,
  }) => {
    await page.goto("/tools/video-to-gif");

    await page
      .locator('input[type="file"]')
      .setInputFiles(fixturePath("sample.mp4"));

    const downloadLink = page.getByRole("link", { name: "Download" });
    // Frame-by-frame decode + per-frame quantize is slower than a straight
    // transcode — generous but still well under the suite's patience for a
    // 2s, 320x240 source at the tool's default options (5s window, 10fps).
    await expect(downloadLink).toBeVisible({ timeout: 30_000 });

    const downloadPromise = page.waitForEvent("download");
    await downloadLink.click();
    const download = await downloadPromise;

    expect(download.suggestedFilename().endsWith(".gif")).toBe(true);

    const path = await download.path();
    if (!path) throw new Error("download produced no local path");
    const bytes = readFileSync(path);

    expect(bytes.length).toBeGreaterThan(0);
    expect(bytes.subarray(0, 6).toString("ascii")).toBe(GIF_MAGIC);
  });
});
