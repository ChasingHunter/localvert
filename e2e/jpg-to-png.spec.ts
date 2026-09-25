import { readFileSync } from "node:fs";
import { test as base, expect } from "@playwright/test";
import { unzipSync } from "fflate";

/**
 * End to end against a real built `out/`, served by `wrangler dev` with the
 * real `_headers` — see playwright.config.ts's doc comment for why. Every
 * test here re-verifies the product's core promise (files never leave the
 * browser) in addition to whatever behaviour it's actually testing.
 *
 * Fixture dimensions are known at generation time (see the throwaway script
 * noted in the commit that added `e2e/fixtures/*`), so the "converted PNG's
 * dimensions match the source" check compares against that recorded truth
 * rather than re-decoding the source JPEG — no image library needed on
 * either side.
 */
const SOURCE_DIMENSIONS: Record<string, { width: number; height: number }> = {
  "photo-small.jpg": { width: 24, height: 24 },
  "photo-medium.jpg": { width: 96, height: 64 },
  "photo-large.jpg": { width: 160, height: 120 },
};

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function hasPngSignature(bytes: Uint8Array): boolean {
  return PNG_SIGNATURE.every((b, i) => bytes[i] === b);
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

test.describe("jpg-to-png", () => {
  test("converts a single JPG to a valid PNG of the same dimensions", async ({
    page,
  }) => {
    await page.goto("/tools/jpg-to-png");

    await page
      .locator('input[type="file"]')
      .setInputFiles(fixturePath("photo-small.jpg"));

    const downloadLink = page.getByRole("link", { name: "Download" });
    await expect(downloadLink).toBeVisible({ timeout: 15_000 });

    const downloadPromise = page.waitForEvent("download");
    await downloadLink.click();
    const download = await downloadPromise;
    const path = await download.path();
    if (!path) throw new Error("download produced no local path");
    const bytes = readFileSync(path);

    expect(hasPngSignature(bytes)).toBe(true);
    expect(readPngDimensions(bytes)).toEqual(
      SOURCE_DIMENSIONS["photo-small.jpg"],
    );
  });

  test("batch-converts three JPGs and zips them", async ({ page }) => {
    await page.goto("/tools/jpg-to-png");

    // Reload once so the service worker installed by the first load is the
    // one *controlling* this page for the rest of the test, instead of
    // leaving that to timing — a SW-controlled page is exactly the
    // condition that used to make the zip worker fail ~50% of the time (the
    // precached Turbopack worker-bootstrap script's URL fragment was lost
    // once it came back from the SW's cache; see src/sw-helpers.ts).
    // `ready` resolves once an active worker exists for this scope, so the
    // reload below lands on a navigation that worker is already eligible to
    // control — without it, the reload can race the first install.
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    const controlled = await page.evaluate(
      () => !!navigator.serviceWorker.controller,
    );
    expect(controlled).toBe(true);

    const names = ["photo-small.jpg", "photo-medium.jpg", "photo-large.jpg"];
    await page
      .locator('input[type="file"]')
      .setInputFiles(names.map(fixturePath));

    await expect(page.getByRole("link", { name: "Download" })).toHaveCount(3, {
      timeout: 20_000,
    });

    const downloadAll = page.getByRole("button", {
      name: "Download all (.zip)",
    });
    await expect(downloadAll).toBeEnabled();

    const downloadPromise = page.waitForEvent("download");
    await downloadAll.click();
    const download = await downloadPromise;
    const path = await download.path();
    if (!path) throw new Error("download produced no local path");
    const zipBytes = readFileSync(path);

    const entries = unzipSync(zipBytes);
    const entryNames = Object.keys(entries);
    expect(entryNames).toHaveLength(3);
    for (const entryName of entryNames) {
      expect(entryName.endsWith(".png")).toBe(true);
      expect(hasPngSignature(entries[entryName] as Uint8Array)).toBe(true);
    }
  });

  test("rejects a PNG dropped on a JPG-only tool without creating a job", async ({
    page,
  }) => {
    await page.goto("/tools/jpg-to-png");

    await page
      .locator('input[type="file"]')
      .setInputFiles(fixturePath("not-a-jpg.png"));

    await expect(page.getByText(/Detected as PNG/)).toBeVisible();
    // No job list heading ("N files") and no download link — nothing was
    // ever submitted to the job engine for this rejected file. Scoped to
    // that heading's own text: the tool page's "Related tools" section (see
    // src/app/tools/[slug]/page.tsx) also renders an <h2>, unconditionally,
    // and would make a bare heading-count check fail regardless of whether
    // a job was created.
    await expect(
      page.getByRole("heading", { level: 2, name: /\d+ files?/ }),
    ).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Download" })).toHaveCount(0);
  });
});
