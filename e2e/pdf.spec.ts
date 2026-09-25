import { readFileSync } from "node:fs";
import { PDFDocument } from "@cantoo/pdf-lib";
import { test as base, expect } from "@playwright/test";

/**
 * End to end against a real built `out/` — see `e2e/jpg-to-png.spec.ts`'s
 * doc comment for why. Covers every `src/tools/pdf/*.ts` tool on the
 * `pdf-lib` engine: ADR-0008's multi-file tools `merge-pdf` (many-to-one),
 * `split-pdf` (one-to-many) and `images-to-pdf` (many-to-one), plus the
 * one-to-one tools `rotate-pdf`, `delete-pdf-pages`, `extract-pdf-pages` (via
 * `delete-pdf-pages`'s shared `extract` op), `protect-pdf` and `unlock-pdf`.
 *
 * `e2e/fixtures/a.pdf` (2 pages, 150x150) and `b.pdf` (1 page, 250x250) —
 * generated once by a throwaway `@cantoo/pdf-lib` script, committed as
 * fixtures — use distinct page sizes per source file so merge order and
 * split output are easy to assert on exactly: pdf-lib itself has no
 * text-extraction API to check page *content* by, but `page.getSize()`
 * distinguishes an "a" page from a "b" page just as reliably.
 * `photo-small.jpg`/`photo-medium.jpg` (also in `e2e/fixtures/`, shared with
 * the image-matrix specs) stand in for real jpgs in the `images-to-pdf` test.
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

test.describe("rotate-pdf", () => {
  test("rotates page 1 by 90 degrees, leaving page 2 unrotated", async ({
    page,
  }) => {
    await page.goto("/tools/rotate-pdf");

    // "angle" defaults to 90, so only "pages" needs setting — options are
    // read at drop time, so this has to happen before the file is dropped.
    await page.getByLabel("Pages").fill("1");
    await page
      .locator('input[type="file"]')
      .setInputFiles(fixturePath("a.pdf"));

    const downloadLink = page.getByRole("link", { name: "Download" });
    await expect(downloadLink).toBeVisible({ timeout: 15_000 });

    const downloadPromise = page.waitForEvent("download");
    await downloadLink.click();
    const download = await downloadPromise;
    const path = await download.path();
    if (!path) throw new Error("download produced no local path");
    const bytes = readFileSync(path);

    const doc = await PDFDocument.load(bytes);
    expect(doc.getPages().map((p) => p.getRotation().angle)).toEqual([90, 0]);
  });
});

test.describe("delete-pdf-pages", () => {
  test("deletes page 2 of a 2-page PDF, leaving 1 page", async ({ page }) => {
    await page.goto("/tools/delete-pdf-pages");

    await page.getByLabel("Pages to delete").fill("2");
    await page
      .locator('input[type="file"]')
      .setInputFiles(fixturePath("a.pdf"));

    const downloadLink = page.getByRole("link", { name: "Download" });
    await expect(downloadLink).toBeVisible({ timeout: 15_000 });

    const downloadPromise = page.waitForEvent("download");
    await downloadLink.click();
    const download = await downloadPromise;
    const path = await download.path();
    if (!path) throw new Error("download produced no local path");
    const bytes = readFileSync(path);

    expect(await pageSizes(bytes)).toEqual([[150, 150]]);
  });
});

test.describe("images-to-pdf", () => {
  test("combines two jpg fixtures into a two-page PDF", async ({ page }) => {
    await page.goto("/tools/images-to-pdf");

    await page
      .locator('input[type="file"]')
      .setInputFiles([
        fixturePath("photo-small.jpg"),
        fixturePath("photo-medium.jpg"),
      ]);

    const createButton = page.getByRole("button", { name: "Create PDF" });
    await expect(createButton).toBeEnabled();
    await createButton.click();

    const downloadLink = page.getByRole("link", { name: "Download" });
    await expect(downloadLink).toBeVisible({ timeout: 15_000 });

    const downloadPromise = page.waitForEvent("download");
    await downloadLink.click();
    const download = await downloadPromise;
    const path = await download.path();
    if (!path) throw new Error("download produced no local path");
    const bytes = readFileSync(path);

    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(2);
  });
});

test.describe("protect-pdf / unlock-pdf", () => {
  test("protects a PDF, then unlocks it back to a plain, readable PDF", async ({
    page,
  }) => {
    await page.goto("/tools/protect-pdf");

    await page.getByLabel("Password").fill("e2e-secret");
    await page
      .locator('input[type="file"]')
      .setInputFiles(fixturePath("a.pdf"));

    const protectedLink = page.getByRole("link", { name: "Download" });
    await expect(protectedLink).toBeVisible({ timeout: 15_000 });
    const protectedDownloadPromise = page.waitForEvent("download");
    await protectedLink.click();
    const protectedDownload = await protectedDownloadPromise;
    const protectedPath = await protectedDownload.path();
    if (!protectedPath) throw new Error("download produced no local path");
    const protectedBytes = readFileSync(protectedPath);

    // Confirm it's genuinely encrypted before trying to unlock it.
    await expect(PDFDocument.load(protectedBytes)).rejects.toThrow();

    await page.goto("/tools/unlock-pdf");
    await page.getByLabel("Password").fill("e2e-secret");
    await page.locator('input[type="file"]').setInputFiles({
      name: "protected.pdf",
      mimeType: "application/pdf",
      buffer: protectedBytes,
    });

    const unlockedLink = page.getByRole("link", { name: "Download" });
    await expect(unlockedLink).toBeVisible({ timeout: 15_000 });
    const unlockedDownloadPromise = page.waitForEvent("download");
    await unlockedLink.click();
    const unlockedDownload = await unlockedDownloadPromise;
    const unlockedPath = await unlockedDownload.path();
    if (!unlockedPath) throw new Error("download produced no local path");
    const unlockedBytes = readFileSync(unlockedPath);

    // No password needed this time, and the pages survived the round trip.
    expect(await pageSizes(unlockedBytes)).toEqual([
      [150, 150],
      [150, 150],
    ]);
  });
});

test.describe("pdf-to-png", () => {
  test("renders a 2-page PDF to two PNG downloads", async ({ page }) => {
    await page.goto("/tools/pdf-to-png");

    await page
      .locator('input[type="file"]')
      .setInputFiles(fixturePath("a.pdf"));

    // One-to-many (ADR-0008): a.pdf has 2 pages, so this job produces 2
    // downloadable files, same shape as split-pdf's e2e test above. The
    // privacy guard (autouse fixture, top of this file) already fails the
    // test if pdf.js ever requests anything off this origin — that covers
    // the cmaps/standard_fonts/worker fetches this tool's engine makes.
    const downloadLinks = page.getByRole("link", { name: "Download" });
    await expect(downloadLinks).toHaveCount(2, { timeout: 15_000 });

    for (let i = 0; i < 2; i++) {
      const downloadPromise = page.waitForEvent("download");
      await downloadLinks.nth(i).click();
      const download = await downloadPromise;
      const path = await download.path();
      if (!path) throw new Error("download produced no local path");
      const bytes = readFileSync(path);
      expect(Array.from(bytes.subarray(0, 8))).toEqual([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ]);
    }
  });
});
