import { readFileSync } from "node:fs";
import { test as base, expect } from "@playwright/test";

/**
 * End to end against a real built `out/`, served by `wrangler dev` with the
 * real `_headers` — see `e2e/jpg-to-png.spec.ts` and playwright.config.ts's
 * doc comment for why. Every test here re-verifies the product's core
 * promise (files never leave the browser) in addition to whatever
 * conversion it's actually exercising.
 *
 * Covers the HEIC/SVG/TIFF/PSD tools added in this slice, except the two
 * HEIC ones (`heic-to-jpg`, `heic-to-png`): no HEIC fixture exists in this
 * repo (the format's binary complexity makes a hand-built or
 * from-a-throwaway-script fixture impractical the way `sample.tiff`/
 * `sample.psd` are below), so HEIC is left untested here. The `heic`
 * engine's own decode logic is covered by
 * `src/lib/engines/heic/adapter.browser.test.ts` instead.
 */
const JPG_MAGIC = [0xff, 0xd8, 0xff];
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function hasMagic(bytes: Uint8Array, magic: readonly number[]): boolean {
  return magic.every((b, i) => bytes[i] === b);
}

/** Reads width/height straight out of a PNG's IHDR chunk — no image library needed. */
function readPngDimensions(bytes: Uint8Array): {
  width: number;
  height: number;
} {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

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

/**
 * Uploads `fixture` to the given tool page and returns the converted file's
 * bytes, once the download link appears. Submission happens on drop with
 * whatever options are set at that moment (see `ToolRunner`'s doc comment),
 * so any option field must be filled in *before* this is called.
 */
async function convertAndDownload(
  page: import("@playwright/test").Page,
  fixture: string,
): Promise<Uint8Array> {
  await page.locator('input[type="file"]').setInputFiles(fixturePath(fixture));

  const downloadLink = page.getByRole("link", { name: "Download" });
  await expect(downloadLink).toBeVisible({ timeout: 15_000 });

  const downloadPromise = page.waitForEvent("download");
  await downloadLink.click();
  const download = await downloadPromise;
  const path = await download.path();
  if (!path) throw new Error("download produced no local path");
  return readFileSync(path);
}

test.describe("image-matrix-g3", () => {
  test("svg-to-png converts at a chosen width", async ({ page }) => {
    await page.goto("/tools/svg-to-png");

    await page.getByLabel("Output width").fill("200");
    const bytes = await convertAndDownload(page, "sample.svg");

    expect(hasMagic(bytes, PNG_MAGIC)).toBe(true);
    expect(readPngDimensions(bytes).width).toBe(200);
  });

  test("svg-to-jpg converts to a valid JPG", async ({ page }) => {
    await page.goto("/tools/svg-to-jpg");
    const bytes = await convertAndDownload(page, "sample.svg");
    expect(hasMagic(bytes, JPG_MAGIC)).toBe(true);
  });

  test("tiff-to-jpg converts to a valid JPG", async ({ page }) => {
    await page.goto("/tools/tiff-to-jpg");
    const bytes = await convertAndDownload(page, "sample.tiff");
    expect(hasMagic(bytes, JPG_MAGIC)).toBe(true);
  });

  test("tiff-to-png converts to a valid PNG", async ({ page }) => {
    await page.goto("/tools/tiff-to-png");
    const bytes = await convertAndDownload(page, "sample.tiff");
    expect(hasMagic(bytes, PNG_MAGIC)).toBe(true);
  });

  test("psd-to-png converts to a valid PNG", async ({ page }) => {
    await page.goto("/tools/psd-to-png");
    const bytes = await convertAndDownload(page, "sample.psd");
    expect(hasMagic(bytes, PNG_MAGIC)).toBe(true);
  });

  test("psd-to-jpg converts to a valid JPG", async ({ page }) => {
    await page.goto("/tools/psd-to-jpg");
    const bytes = await convertAndDownload(page, "sample.psd");
    expect(hasMagic(bytes, JPG_MAGIC)).toBe(true);
  });
});
