import { readFileSync } from "node:fs";
import { PDFDocument } from "@cantoo/pdf-lib";
import { test as base, expect } from "@playwright/test";

/**
 * End to end against a real built `out/` — see `e2e/jpg-to-png.spec.ts`'s
 * doc comment for why. Covers ADR-0008's first two multi-file tools:
 * `merge-pdf` (arity many-to-one, `src/tools/pdf/merge-pdf.ts`) and
 * `split-pdf` (arity one-to-many, `src/tools/pdf/split-pdf.ts`).
 *
 * `e2e/fixtures/a.pdf` (2 pages, 150x150) and `b.pdf` (1 page, 250x250) —
 * generated once by a throwaway `@cantoo/pdf-lib` script, committed as
 * fixtures — use distinct page sizes per source file so merge order and
 * split output are easy to assert on exactly: pdf-lib itself has no
 * text-extraction API to check page *content* by, but `page.getSize()`
 * distinguishes an "a" page from a "b" page just as reliably.
 */

function fixturePath(name: string): string {
  return `e2e/fixtures/${name}`;
}

async function pageSizes(bytes: Buffer): Promise<[number, number][]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((p) => {
    const { width, height } = p.getSize();
    return [width, height];
  });
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

test.describe("merge-pdf", () => {
  test("merges two PDFs in drop order, three pages total", async ({ page }) => {
    await page.goto("/tools/merge-pdf");

    await page
      .locator('input[type="file"]')
      .setInputFiles([fixturePath("a.pdf"), fixturePath("b.pdf")]);

    // FileOrderList shows both files before anything is submitted — no
    // download link yet, and the action button is the explicit submit.
    await expect(page.getByText("a.pdf")).toBeVisible();
    await expect(page.getByText("b.pdf")).toBeVisible();
    await expect(page.getByRole("link", { name: "Download" })).toHaveCount(0);

    const mergeButton = page.getByRole("button", { name: "Merge PDFs" });
    await expect(mergeButton).toBeEnabled();
    await mergeButton.click();

    const downloadLink = page.getByRole("link", { name: "Download" });
    await expect(downloadLink).toBeVisible({ timeout: 15_000 });

    const downloadPromise = page.waitForEvent("download");
    await downloadLink.click();
    const download = await downloadPromise;
    const path = await download.path();
    if (!path) throw new Error("download produced no local path");
    const bytes = readFileSync(path);

    expect(await pageSizes(bytes)).toEqual([
      [150, 150],
      [150, 150],
      [250, 250],
    ]);
  });

  test("reordering via the keyboard controls changes merge order", async ({
    page,
  }) => {
    await page.goto("/tools/merge-pdf");

    await page
      .locator('input[type="file"]')
      .setInputFiles([fixturePath("a.pdf"), fixturePath("b.pdf")]);

    // Dropped as [a, b]; moving b.pdf up puts it first.
    await page.getByRole("button", { name: "Move b.pdf up" }).click();
    await page.getByRole("button", { name: "Merge PDFs" }).click();

    const downloadLink = page.getByRole("link", { name: "Download" });
    await expect(downloadLink).toBeVisible({ timeout: 15_000 });

    const downloadPromise = page.waitForEvent("download");
    await downloadLink.click();
    const download = await downloadPromise;
    const path = await download.path();
    if (!path) throw new Error("download produced no local path");
    const bytes = readFileSync(path);

    const sizes = await pageSizes(bytes);
    expect(sizes[0]).toEqual([250, 250]); // b.pdf's page, now first
    expect(sizes).toHaveLength(3);
  });
});

test.describe("split-pdf", () => {
  test("splits a 2-page PDF into two single-page downloads", async ({
    page,
  }) => {
    await page.goto("/tools/split-pdf");

    await page
      .locator('input[type="file"]')
      .setInputFiles(fixturePath("a.pdf"));

    const downloadLinks = page.getByRole("link", { name: "Download" });
    await expect(downloadLinks).toHaveCount(2, { timeout: 15_000 });

    for (let i = 0; i < 2; i++) {
      const downloadPromise = page.waitForEvent("download");
      await downloadLinks.nth(i).click();
      const download = await downloadPromise;
      const path = await download.path();
      if (!path) throw new Error("download produced no local path");
      const bytes = readFileSync(path);
      expect(await pageSizes(bytes)).toEqual([[150, 150]]);
    }
  });
});
