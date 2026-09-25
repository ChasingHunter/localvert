import { readFileSync } from "node:fs";
import { test as base, expect } from "@playwright/test";

/**
 * End to end against a real built `out/`, served by `wrangler dev` with the
 * real `_headers` — see playwright.config.ts's doc comment and
 * `e2e/jpg-to-png.spec.ts` for why. Every test here re-verifies the
 * product's core promise (files never leave the browser) in addition to
 * exercising its own tool.
 *
 * Covers the six WebP/AVIF/JPEG XL -> JPG/PNG tools from this slice as one
 * parameterised matrix rather than six near-identical spec files.
 */
const JPG_MAGIC = [0xff, 0xd8, 0xff];
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];

function hasMagic(bytes: Uint8Array, magic: readonly number[]): boolean {
  return magic.every((b, i) => bytes[i] === b);
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

const cases = [
  { slug: "webp-to-jpg", fixture: "sample.webp", magic: JPG_MAGIC },
  { slug: "webp-to-png", fixture: "sample.webp", magic: PNG_MAGIC },
  { slug: "avif-to-jpg", fixture: "sample.avif", magic: JPG_MAGIC },
  { slug: "avif-to-png", fixture: "sample.avif", magic: PNG_MAGIC },
  { slug: "jxl-to-jpg", fixture: "sample.jxl", magic: JPG_MAGIC },
  { slug: "jxl-to-png", fixture: "sample.jxl", magic: PNG_MAGIC },
] as const;

for (const { slug, fixture, magic } of cases) {
  test.describe(slug, () => {
    test(`converts ${fixture} to a valid output`, async ({ page }) => {
      await page.goto(`/tools/${slug}`);

      await page
        .locator('input[type="file"]')
        .setInputFiles(fixturePath(fixture));

      const downloadLink = page.getByRole("link", { name: "Download" });
      await expect(downloadLink).toBeVisible({ timeout: 15_000 });

      const downloadPromise = page.waitForEvent("download");
      await downloadLink.click();
      const download = await downloadPromise;
      const path = await download.path();
      if (!path) throw new Error("download produced no local path");
      const bytes = readFileSync(path);

      expect(hasMagic(bytes, magic)).toBe(true);
    });
  });
}
