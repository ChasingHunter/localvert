import { readFileSync } from "node:fs";
import { PDFDict, PDFDocument, PDFName, PDFRawStream } from "@cantoo/pdf-lib";
import { test as base, expect } from "@playwright/test";

/**
 * End to end against a real built `out/` — regression coverage for the four
 * owner-reported interaction bugs fixed alongside this file (2026-09-27):
 * stamp-tool image reuse, stamp drag/nudge, restyling a SELECTED annotation
 * (plus per-tool colour defaults), and the new "Close" toolbar action.
 * Split from `e2e/pdf-editor.spec.ts` (which already covers open/highlight/
 * free-text/undo/export) so this file's setup can stay focused on
 * stamp/signature placement and selection.
 */

function fixturePath(name: string): string {
  return `e2e/fixtures/${name}`;
}

/** Every `/Subtype` annotation dict on one page, alongside its raw
 * dictionary — callers dig out whatever field (`/AP`, `/DA`, ...) their
 * assertion needs. */
async function pageAnnotDicts(
  bytes: Buffer,
  pageIndex = 0,
): Promise<PDFDict[]> {
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPages()[pageIndex];
  if (!page) throw new Error(`no page ${pageIndex}`);
  const annots = page.node.Annots();
  if (!annots) return [];
  const dicts: PDFDict[] = [];
  for (let i = 0; i < annots.size(); i++) {
    dicts.push(annots.lookup(i, PDFDict));
  }
  return dicts;
}

function subtypeOf(dict: PDFDict): string {
  const subtype = dict.get(PDFName.of("Subtype"));
  return subtype ? subtype.toString().replace(/^\//, "") : "unknown";
}

/** The raw bytes of a Stamp annotation's normal appearance stream (`/AP
 * /N`) — the actual placed image content, as PDFium wrote it. Two stamps
 * placed from different source images must produce different bytes here;
 * this is the direct regression check for "Insert image always inserted
 * the signature". */
function stampAppearanceBytes(dict: PDFDict): Uint8Array {
  const ap = dict.lookup(PDFName.of("AP"), PDFDict);
  const n = ap.lookup(PDFName.of("N"));
  if (!(n instanceof PDFRawStream)) {
    throw new Error("stamp annotation has no /AP /N raw stream");
  }
  return n.contents;
}

/** A Rect array `[llx, lly, urx, ury]` off an annotation dict, as plain
 * numbers, for comparing "did this annotation's position change". */
function rectOf(dict: PDFDict): number[] {
  const rect = dict.lookup(PDFName.of("Rect")) as unknown as {
    asArray(): { asNumber(): number }[];
  };
  return rect.asArray().map((n) => n.asNumber());
}

function daOf(dict: PDFDict): string {
  const da = dict.lookup(PDFName.of("DA")) as unknown as {
    asString(): string;
  };
  return da.asString();
}

interface Fixtures {
  privacyGuard: undefined;
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
      expect(foreign, "no request should leave the page's own origin").toEqual(
        [],
      );
    },
    { auto: true },
  ],
});

// The rendered page image is a direct child of `PagePointerProvider`'s
// wrapper div (see `pdf-editor-app.tsx`'s `renderPage`), so `> div > img` is
// unambiguous — a bare `img` descendant selector also matches a placed
// stamp/signature image (an `<img>` inside the annotation layer), same fix
// as `e2e/pdf-editor-draft.spec.ts`'s `pageImage`.
function pageImage(page: import("@playwright/test").Page, pageIndex = 0) {
  return page.locator(`[data-page-index="${pageIndex}"] > div > img`);
}

async function exportBytes(
  page: import("@playwright/test").Page,
): Promise<Buffer> {
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export PDF" }).click();
  const download = await downloadPromise;
  const path = await download.path();
  if (!path) throw new Error("download produced no local path");
  return readFileSync(path);
}

async function openEditor(page: import("@playwright/test").Page) {
  await page.goto("/tools/pdf-editor");
  await page
    .locator('input[type="file"]')
    .setInputFiles(fixturePath("pdf-editor.pdf"));
  await expect(pageImage(page, 0)).toBeVisible({ timeout: 45_000 });
}

async function pointOnPage(
  page: import("@playwright/test").Page,
  pageIndex: number,
  fx: number,
  fy: number,
): Promise<{ x: number; y: number }> {
  const img = pageImage(page, pageIndex);
  await img.scrollIntoViewIfNeeded();
  const box = await img.boundingBox();
  if (!box) throw new Error(`page ${pageIndex} image has no bounding box`);
  const point = { x: box.x + box.width * fx, y: box.y + box.height * fy };
  const viewportSize = page.viewportSize();
  if (!viewportSize) throw new Error("page has no viewport size");
  if (
    point.x < 0 ||
    point.y < 0 ||
    point.x > viewportSize.width ||
    point.y > viewportSize.height
  ) {
    throw new Error(
      `point (${point.x}, ${point.y}) is outside the ${viewportSize.width}x${viewportSize.height} viewport`,
    );
  }
  return point;
}

/** Types "Localvert" into the Sign dialog's Type tab and clicks Place —
 * the fastest deterministic way to produce a signature stamp in e2e (no
 * synthetic drag needed, unlike the Draw tab). */
async function signAndPlace(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Sign" }).click();
  await page.getByRole("tab", { name: "Type" }).click();
  await page.getByLabel("Type your signature").fill("Localvert");
  await page.getByRole("button", { name: "Place" }).click();
  const point = await pointOnPage(page, 0, 0.3, 0.3);
  await page.mouse.click(point.x, point.y);
}

test.describe("pdf-editor interactions", () => {
  test.use({ viewport: { width: 1280, height: 1100 } });
  test.setTimeout(60_000);

  test.beforeAll(async ({ browser }, testInfo) => {
    testInfo.setTimeout(90_000);
    const context = await browser.newContext();
    const page = await context.newPage();
    await openEditor(page);
    await context.close();
  });

  // Regression for "Insert image always inserted the signature". Cause
  // (confirmed against @embedpdf/plugin-annotation/dist/index.js): stamp's
  // pointer handler caches the fetched image in a closure keyed only on tool
  // ACTIVATION (`onHandlerActiveStart`), and `AnnotationPlugin.setActiveTool`
  // no-ops when "stamp" is already the active tool -- so a second placement
  // reused the first fetch. `placeStamp` now force-deactivates first.
  test("Insert image after Sign places the picked image, not the signature", async ({
    page,
  }) => {
    await openEditor(page);

    await signAndPlace(page);

    await page.getByRole("button", { name: "Insert image" }).click();
    await page
      .locator('input[type="file"][accept="image/*"]')
      .setInputFiles(fixturePath("photo-small.jpg"));
    const point = await pointOnPage(page, 0, 0.7, 0.6);
    await page.mouse.click(point.x, point.y);

    const bytes = await exportBytes(page);
    const dicts = (await pageAnnotDicts(bytes)).filter(
      (d) => subtypeOf(d) === "Stamp",
    );
    expect(dicts.length).toBe(2);

    const [first, second] = dicts.map(stampAppearanceBytes);
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    // The actual regression check: two DIFFERENT source images must produce
    // two DIFFERENT appearance streams. Before the fix, both stamps' bytes
    // were identical (the second placement silently reused the signature).
    expect(
      Buffer.from(first as Uint8Array).equals(
        Buffer.from(second as Uint8Array),
      ),
    ).toBe(false);
  });

  // Regression for "placed stamps can be resized but not moved". Cause: the
  // stamp tool has no `selectAfterCreate`, so the newly placed annotation
  // was never selected and its drag handlers were never attached
  // (`AnnotationContainer` only wires `dragProps` when `isSelected`). The
  // fix listens for the plugin's "create" event and selects the new stamp.
  test("a placed image can be dragged to a new position", async ({ page }) => {
    await openEditor(page);

    await page.getByRole("button", { name: "Insert image" }).click();
    await page
      .locator('input[type="file"][accept="image/*"]')
      .setInputFiles(fixturePath("photo-small.jpg"));
    const placeAt = await pointOnPage(page, 0, 0.3, 0.3);
    await page.mouse.click(placeAt.x, placeAt.y);

    const before = (await pageAnnotDicts(await exportBytes(page))).find(
      (d) => subtypeOf(d) === "Stamp",
    );
    if (!before) throw new Error("no Stamp annotation after placing");
    const rectBefore = rectOf(before);

    // The stamp should already be selected (auto-select-after-create) --
    // drag it 60px right and 40px down.
    const from = await pointOnPage(page, 0, 0.3, 0.3);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 60, from.y + 40, { steps: 5 });
    await page.mouse.up();

    const after = (await pageAnnotDicts(await exportBytes(page))).find(
      (d) => subtypeOf(d) === "Stamp",
    );
    if (!after) throw new Error("no Stamp annotation after dragging");
    const rectAfter = rectOf(after);

    expect(rectAfter).not.toEqual(rectBefore);
  });

  // Regression for "changing font size or colour does nothing to text".
  // Cause: the style pickers only ever pushed into the ACTIVE TOOL's
  // defaults (for the next annotation), never onto a SELECTED one. The fix
  // calls `AnnotationCapability.updateAnnotation` on the selection too.
  test("selecting free text and changing its colour/size restyles it", async ({
    page,
  }) => {
    await openEditor(page);

    await page.getByRole("button", { name: "Add text" }).click();
    const point = await pointOnPage(page, 0, 0.5, 0.2);
    await page.mouse.click(point.x, point.y);
    await page.keyboard.type("Localvert");
    await page.keyboard.press("Escape");

    // Escape leaves FreeText's edit mode but keeps it selected (per
    // `editAfterCreate`'s `selectAfterCreate` companion) -- change style
    // while it's still the selection.
    await page.getByLabel("Annotation color").fill("#000000");
    await page.getByLabel("Font size").fill("24");

    const bytes = await exportBytes(page);
    const dict = (await pageAnnotDicts(bytes)).find(
      (d) => subtypeOf(d) === "FreeText",
    );
    if (!dict) throw new Error("no FreeText annotation after export");
    const da = daOf(dict);
    expect(da).toContain("0 0 0 rg");
    expect(da).toMatch(/\b24\b/);
  });

  // Owner bug #5 -- font picker. Choosing a standard font before placing
  // FreeText should carry through to the exported annotation's /DA. Verified
  // against a real export: PDFium writes the standard font as its own
  // resource name, e.g. "/FXF_Times-Roman 16 Tf" (not the AcroForm "TiRo").
  test("choosing Serif (Times) sets the exported FreeText's font", async ({
    page,
  }) => {
    await openEditor(page);

    await page.getByRole("button", { name: "Add text" }).click();
    await page
      .getByLabel("Font", { exact: true })
      .selectOption({ label: "Serif (Times)" });
    const point = await pointOnPage(page, 0, 0.5, 0.2);
    await page.mouse.click(point.x, point.y);
    await page.keyboard.type("Localvert");
    await page.keyboard.press("Escape");

    const bytes = await exportBytes(page);
    const dict = (await pageAnnotDicts(bytes)).find(
      (d) => subtypeOf(d) === "FreeText",
    );
    if (!dict) throw new Error("no FreeText annotation after export");
    expect(daOf(dict)).toMatch(/Times-Roman/);
  });

  // Owner bug #5 -- "Match document". `e2e/fixtures/pdf-editor.pdf`'s own
  // page text is set in Helvetica (confirmed by reading the fixture's
  // /Resources /Font dict directly), so the nearest-text match should
  // resolve to Sans (Helvetica) -- an exact match, so no "closest match"
  // hint should appear (see `font-match.ts`'s `matchDocumentFont`).
  test("Match document picks the fixture's own font (Helvetica)", async ({
    page,
  }) => {
    await openEditor(page);

    await page.getByRole("button", { name: "Add text" }).click();
    await page
      .getByLabel("Font", { exact: true })
      .selectOption({ label: "Match document" });
    const point = await pointOnPage(page, 0, 0.5, 0.2);
    await page.mouse.click(point.x, point.y);
    await page.keyboard.type("Localvert");
    await page.keyboard.press("Escape");

    // An exact match (the fixture's text IS Helvetica) shows no hint -- see
    // `matchDocumentFont`'s `STANDARD_FONT_NAMES` check.
    await expect(page.getByText(/Closest match/)).not.toBeVisible();

    const bytes = await exportBytes(page);
    const dict = (await pageAnnotDicts(bytes)).find(
      (d) => subtypeOf(d) === "FreeText",
    );
    if (!dict) throw new Error("no FreeText annotation after export");
    expect(daOf(dict)).toMatch(/Helv/);
  });

  // Regression for "no way to close the open PDF and open another".
  test("Close returns to the drop zone, and opening another fixture works", async ({
    page,
  }) => {
    await openEditor(page);

    await page.getByRole("button", { name: "Close" }).click();
    // No unsaved changes yet on a freshly opened, untouched document, so no
    // confirm dialog should appear -- the drop zone should show right away.
    await expect(
      page.getByText(/drag/i).or(page.getByText(/drop/i)),
    ).toBeVisible({
      timeout: 5_000,
    });

    await page
      .locator('input[type="file"]')
      .setInputFiles(fixturePath("pdf-editor.pdf"));
    await expect(pageImage(page, 0)).toBeVisible({ timeout: 45_000 });
  });
});
