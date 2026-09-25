import { readFileSync } from "node:fs";
import { test as base, expect } from "@playwright/test";

/**
 * End to end against a real built `out/`, served by `wrangler dev` with the
 * real `_headers` — see `e2e/jpg-to-png.spec.ts` and playwright.config.ts's
 * doc comment for why. Covers the seven jpg/png source tools from slice
 * 1C-tools-G1 (jpg-to-webp, jpg-to-avif, jpg-to-jxl, png-to-jpg,
 * png-to-webp, png-to-avif, png-to-jxl): one parameterised test per tool,
 * each re-verifying the product's core privacy promise (files never leave
 * the browser) alongside the actual conversion.
 *
 * `not-a-jpg.png` (already a fixture, used elsewhere to test rejection on a
 * jpg-only tool) doubles as the PNG source here — a real, valid, tiny PNG,
 * so there's no need to generate one via an in-page canvas.
 */

const PNG_SOURCE = "not-a-jpg.png";
const JPG_SOURCE = "photo-small.jpg";

function fixturePath(name: string): string {
  return `e2e/fixtures/${name}`;
}

function hasBytesAt(
  bytes: Uint8Array,
  offset: number,
  expected: readonly number[],
): boolean {
  return expected.every((b, i) => bytes[offset + i] === b);
}

function isWebp(bytes: Uint8Array): boolean {
  return (
    hasBytesAt(bytes, 0, [0x52, 0x49, 0x46, 0x46]) && // "RIFF"
    hasBytesAt(bytes, 8, [0x57, 0x45, 0x42, 0x50]) // "WEBP"
  );
}

function isAvif(bytes: Uint8Array): boolean {
  const ftyp = hasBytesAt(bytes, 4, [0x66, 0x74, 0x79, 0x70]); // "ftyp"
  const brand =
    hasBytesAt(bytes, 8, [0x61, 0x76, 0x69, 0x66]) || // "avif"
    hasBytesAt(bytes, 8, [0x61, 0x76, 0x69, 0x73]); // "avis"
  return ftyp && brand;
}

function isJxl(bytes: Uint8Array): boolean {
  const bareCodestream = bytes[0] === 0xff && bytes[1] === 0x0a;
  const container = hasBytesAt(
    bytes,
    0,
    [0x00, 0x00, 0x00, 0x0c, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a],
  );
  return bareCodestream || container;
}

function isJpg(bytes: Uint8Array): boolean {
  return hasBytesAt(bytes, 0, [0xff, 0xd8, 0xff]);
}

interface MatrixCase {
  slug: string;
  source: string;
  isExpectedFormat: (bytes: Uint8Array) => boolean;
}

const MATRIX: MatrixCase[] = [
  { slug: "jpg-to-webp", source: JPG_SOURCE, isExpectedFormat: isWebp },
  { slug: "jpg-to-avif", source: JPG_SOURCE, isExpectedFormat: isAvif },
  { slug: "jpg-to-jxl", source: JPG_SOURCE, isExpectedFormat: isJxl },
  { slug: "png-to-jpg", source: PNG_SOURCE, isExpectedFormat: isJpg },
  { slug: "png-to-webp", source: PNG_SOURCE, isExpectedFormat: isWebp },
  { slug: "png-to-avif", source: PNG_SOURCE, isExpectedFormat: isAvif },
  { slug: "png-to-jxl", source: PNG_SOURCE, isExpectedFormat: isJxl },
];

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

test.describe("image format matrix — jpg/png sources", () => {
  for (const { slug, source, isExpectedFormat } of MATRIX) {
    test(`${slug} converts and downloads a file with the right magic bytes`, async ({
      page,
    }) => {
      await page.goto(`/tools/${slug}`);

      await page
        .locator('input[type="file"]')
        .setInputFiles(fixturePath(source));

      const downloadLink = page.getByRole("link", { name: "Download" });
      await expect(downloadLink).toBeVisible({ timeout: 20_000 });

      const downloadPromise = page.waitForEvent("download");
      await downloadLink.click();
      const download = await downloadPromise;
      const path = await download.path();
      if (!path) throw new Error("download produced no local path");
      const bytes = readFileSync(path);

      expect(
        isExpectedFormat(bytes),
        `unexpected magic bytes for ${slug}`,
      ).toBe(true);
    });
  }
});
