import { readFileSync } from "node:fs";
import { test as base, expect } from "@playwright/test";

/**
 * End to end against a real built `out/` — see e2e/jpg-to-png.spec.ts's doc
 * comment for why. Covers the first ADR-0010 media tool, `mp4-to-webm`, on
 * the `mediabunny` engine: a real transcode, through a real dedicated
 * worker, writing to (and reading back from) real OPFS in the built app —
 * not just the in-vitest coverage in
 * src/lib/engines/mediabunny/adapter.browser.test.ts.
 *
 * `e2e/fixtures/sample.mp4` (320x240, 2s, H.264 + AAC, ~30KB) was generated
 * once with ffmpeg's `testsrc`/`sine` lavfi sources and committed as a
 * fixture, the same pattern as `a.pdf`/`b.pdf` and the `photo-*.jpg` files.
 */
const EBML_MAGIC = [0x1a, 0x45, 0xdf, 0xa3];

function hasEbmlMagic(bytes: Uint8Array): boolean {
  return EBML_MAGIC.every((b, i) => bytes[i] === b);
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

test.describe("mp4-to-webm", () => {
  test("converts a dropped MP4 to a valid, downloadable WebM", async ({
    page,
  }) => {
    await page.goto("/tools/mp4-to-webm");

    await page
      .locator('input[type="file"]')
      .setInputFiles(fixturePath("sample.mp4"));

    const downloadLink = page.getByRole("link", { name: "Download" });
    // A real transcode (demux -> decode -> encode -> mux) is slower than the
    // image-pipeline tools this timeout was copied from — generous but
    // still well under the suite's patience for a 2s, 320x240 source.
    await expect(downloadLink).toBeVisible({ timeout: 30_000 });

    const downloadPromise = page.waitForEvent("download");
    await downloadLink.click();
    const download = await downloadPromise;

    expect(download.suggestedFilename().endsWith(".webm")).toBe(true);

    const path = await download.path();
    if (!path) throw new Error("download produced no local path");
    const bytes = readFileSync(path);

    expect(bytes.length).toBeGreaterThan(1024);
    expect(hasEbmlMagic(new Uint8Array(bytes.subarray(0, 4)))).toBe(true);
  });
});
