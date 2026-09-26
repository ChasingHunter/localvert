import { readFileSync } from "node:fs";
import { test as base, expect } from "@playwright/test";

/**
 * End to end against a real built `out/` — see `e2e/jpg-to-png.spec.ts`'s
 * doc comment for why. Covers `image-to-text`, the OCR tool on the
 * `tesseract` engine.
 *
 * No committed fixture image: the source PNG is rendered *in the page*, via
 * `page.evaluate` drawing large, high-contrast text on an `OffscreenCanvas`
 * and encoding it to a PNG blob, whose bytes come back to Node as a plain
 * array and are handed to `setInputFiles` as an in-memory buffer — same
 * bit-identical-across-machines reasoning as the adapter's own browser test
 * (`src/lib/engines/tesseract/adapter.browser.test.ts`), just driven through
 * the real UI this time instead of the adapter directly.
 */

const TIMEOUT = 120_000;

async function renderTextPng(
  page: import("@playwright/test").Page,
  text: string,
) {
  return page.evaluate(async (t) => {
    const width = 640;
    const height = 120;
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#000000";
    ctx.font = "bold 48px sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillText(t, 20, height / 2);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return Array.from(bytes);
  }, text);
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

test.describe("image-to-text", () => {
  test("extracts large, high-contrast text from an image", async ({ page }) => {
    // First run also loads the wasm core + language model into a fresh
    // nested worker — well past Playwright's default 30s test timeout.
    test.setTimeout(TIMEOUT);

    await page.goto("/tools/image-to-text");

    const bytes = await renderTextPng(page, "LOCALVERT 2026");
    await page.locator('input[type="file"]').setInputFiles({
      name: "text.png",
      mimeType: "image/png",
      buffer: Buffer.from(bytes),
    });

    const downloadLink = page.getByRole("link", { name: "Download" });
    await expect(downloadLink).toBeVisible({ timeout: TIMEOUT });

    const downloadPromise = page.waitForEvent("download");
    await downloadLink.click();
    const download = await downloadPromise;
    const path = await download.path();
    if (!path) throw new Error("download produced no local path");
    const text = readFileSync(path, "utf8").toLowerCase();

    expect(text).toContain("localvert");
    expect(text).toContain("2026");
  });
});
