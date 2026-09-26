import { readFileSync } from "node:fs";
import { PDFDict, PDFDocument, PDFName } from "@cantoo/pdf-lib";
import { test as base, expect } from "@playwright/test";

/**
 * End to end against a real built `out/` — same reasoning as `e2e/pdf.spec.ts`.
 * Covers the app-mode PDF editor (ADR-0009): open a fixture PDF, draw a
 * highlight, add a free-text annotation, undo the last one, export, and
 * check the exported PDF's own annotation dictionary (not just that a
 * download happened) — `/Subtype` entries prove PDFium's engine actually
 * wrote the annotation, not just that the UI drew something on screen.
 */

function fixturePath(name: string): string {
  return `e2e/fixtures/${name}`;
}

/** Every annotation `/Subtype` name on one page, e.g. ["Highlight", "FreeText"]. */
async function annotSubtypes(bytes: Buffer, pageIndex = 0): Promise<string[]> {
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPages()[pageIndex];
  if (!page) throw new Error(`no page ${pageIndex}`);
  const annots = page.node.Annots();
  if (!annots) return [];
  const subtypes: string[] = [];
  for (let i = 0; i < annots.size(); i++) {
    const dict = annots.lookup(i, PDFDict);
    const subtype = dict.get(PDFName.of("Subtype"));
    subtypes.push(subtype ? subtype.toString().replace(/^\//, "") : "unknown");
  }
  return subtypes;
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

test.describe("pdf-editor", () => {
  test("highlights, adds free text, undoes the last annotation, then exports", async ({
    page,
  }) => {
    await page.goto("/tools/pdf-editor");

    await page
      .locator('input[type="file"]')
      .setInputFiles(fixturePath("a.pdf"));

    // The rendered page image is the signal the editor finished opening the
    // document and rendering page 1 — the toolbar/canvas only exist once
    // `doc` is set.
    const pageImage = page.getByAltText("Page 1");
    await expect(pageImage).toBeVisible({ timeout: 15_000 });
    const box = await pageImage.boundingBox();
    if (!box) throw new Error("page image has no bounding box");

    await page.getByRole("button", { name: "Highlight" }).click();
    await page.mouse.move(box.x + 20, box.y + 20);
    await page.mouse.down();
    await page.mouse.move(box.x + 120, box.y + 60, { steps: 5 });
    await page.mouse.up();

    // Adding a free-text annotation opens a window.prompt() — Playwright
    // auto-accepts dialogs with the given text unless a handler is
    // registered, so this must be wired up before the click that triggers it.
    page.once("dialog", (dialog) => dialog.accept("Localvert"));
    await page.getByRole("button", { name: "Add text" }).click();
    await page.mouse.click(box.x + 20, box.y + 100);

    // Undo removes the free-text annotation (the last one added) before
    // export — asserted below by its absence from the exported PDF.
    await page.keyboard.press("Control+z");

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export PDF" }).click();
    const download = await downloadPromise;
    const path = await download.path();
    if (!path) throw new Error("download produced no local path");
    const bytes = readFileSync(path);

    const subtypes = await annotSubtypes(bytes);
    expect(subtypes).toContain("Highlight");
    expect(subtypes).not.toContain("FreeText");
  });

  test("free-text annotation survives export when not undone", async ({
    page,
  }) => {
    await page.goto("/tools/pdf-editor");

    await page
      .locator('input[type="file"]')
      .setInputFiles(fixturePath("a.pdf"));

    const pageImage = page.getByAltText("Page 1");
    await expect(pageImage).toBeVisible({ timeout: 15_000 });
    const box = await pageImage.boundingBox();
    if (!box) throw new Error("page image has no bounding box");

    page.once("dialog", (dialog) => dialog.accept("Localvert"));
    await page.getByRole("button", { name: "Add text" }).click();
    await page.mouse.click(box.x + 20, box.y + 100);

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export PDF" }).click();
    const download = await downloadPromise;
    const path = await download.path();
    if (!path) throw new Error("download produced no local path");
    const bytes = readFileSync(path);

    expect(await annotSubtypes(bytes)).toContain("FreeText");
  });
});
