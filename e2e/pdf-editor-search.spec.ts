import { test as base, expect } from "@playwright/test";

/**
 * End to end against a real built `out/` — same reasoning as
 * `e2e/pdf-editor.spec.ts` (which this file deliberately does not import
 * from, to keep each spec file's own `beforeAll` warmup independent; see
 * that file's comment on why a warmup run exists at all).
 *
 * Slice E6a: search, copy and keyboard shortcuts. Uses the same
 * `e2e/fixtures/pdf-editor.pdf` fixture as `pdf-editor.spec.ts` — 2 pages,
 * each with a short real text run ("Sample text for page 1" / "... page 2"),
 * built with `Tm 1 0 0 1 20 250` at 18pt on a 300x300 MediaBox (see that
 * file's comment on `pointOnPage` for the exact glyph-box math). "Sample" is
 * present on both pages, so a search for it always has at least one hit.
 */

const test = base.extend<{
  clipboardPermissions: undefined;
}>({
  clipboardPermissions: [
    async ({ context }, use) => {
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      await use(undefined);
    },
    { auto: true },
  ],
});

function fixturePath(name: string): string {
  return `e2e/fixtures/${name}`;
}

function pageImage(page: import("@playwright/test").Page, pageIndex = 0) {
  return page.locator(`[data-page-index="${pageIndex}"] img`);
}

/** Same reasoning as `pdf-editor.spec.ts`'s own `openEditor` — see that
 * file's comment on the generous timeout (cold-start cost of the editor
 * chunk + 4.6MB pdfium.wasm against a fresh `wrangler dev --local`). */
async function openEditor(page: import("@playwright/test").Page) {
  await page.goto("/tools/pdf-editor");
  await page
    .locator('input[type="file"]')
    .setInputFiles(fixturePath("pdf-editor.pdf"));
  await expect(pageImage(page, 0)).toBeVisible({ timeout: 45_000 });
}

/** Same viewport/point-on-page helper as `pdf-editor.spec.ts` — see that
 * file's comment on why a click outside the real Playwright viewport is
 * silently dropped. */
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
      `point (${point.x}, ${point.y}) is outside the ${viewportSize.width}x${viewportSize.height} viewport — it would be silently dropped`,
    );
  }
  return point;
}

test.describe("pdf-editor search, copy and shortcuts", () => {
  test.use({ viewport: { width: 1280, height: 1100 } });
  test.setTimeout(60_000);

  test("Ctrl+F opens search, finds a hit, highlights it, and Escape closes", async ({
    page,
  }) => {
    await openEditor(page);

    await page.keyboard.press("Control+f");
    const searchInput = page.getByRole("textbox", { name: "Search text" });
    await expect(searchInput).toBeVisible();
    await expect(searchInput).toBeFocused();

    await searchInput.fill("Sample");

    // The search is debounced (250ms); poll the "n of m" counter rather than
    // asserting immediately after fill.
    await expect(
      page.getByText(/\d+ of \d+/),
      "search should find at least one hit for a word the fixture contains",
    ).toBeVisible({ timeout: 5_000 });

    // At least one highlight box rendered on page 1.
    await expect(
      page.locator('[data-page-index="0"] [data-search-hit]').first(),
    ).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(searchInput).not.toBeVisible();
  });

  test("selecting text and Ctrl+C copies it to the clipboard", async ({
    page,
  }) => {
    await openEditor(page);

    // Drags across the fixture's text run, same coordinates
    // `pdf-editor.spec.ts`'s highlight test uses to guarantee real,
    // selectable text under the drag.
    const start = await pointOnPage(page, 0, 0.1, 0.15);
    const end = await pointOnPage(page, 0, 0.7, 0.15);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 10 });
    await page.mouse.up();

    await expect(page.getByRole("button", { name: "Copy" })).toBeVisible();

    await page.keyboard.press("Control+c");

    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()), {
        message: "clipboard should contain the selected text",
        timeout: 5_000,
      })
      .not.toBe("");
  });
});
