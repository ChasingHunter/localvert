import AxeBuilder from "@axe-core/playwright";
import { test as base, expect } from "@playwright/test";

/**
 * ADR-0015's accessibility gate: `@axe-core/playwright` against the real
 * built `out/` (same reasoning as jpg-to-png.spec.ts — real `_headers`,
 * real CSP). Zero `serious`/`critical` violations on the home page, a
 * category page, a tool page, and the home page with the To listbox open —
 * the one interactive state that only exists once the Converter island has
 * mounted and a From format is chosen.
 *
 * Never narrows this by excluding rules or elements to get green (CLAUDE.md,
 * ADR-0015) — a real violation gets fixed instead. See the tags list: every
 * level the ADR calls out (wcag2a/aa, wcag21a/aa, wcag22aa).
 */

interface Fixtures {
  /** Autouse: fails the test if any request left the page's own origin. */
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

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function assertNoSeriousViolations(
  page: import("@playwright/test").Page,
): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const serious = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
}

test.describe("accessibility", () => {
  test("home page", async ({ page }) => {
    await page.goto("/");
    await assertNoSeriousViolations(page);
  });

  test("a category page", async ({ page }) => {
    await page.goto("/image");
    await assertNoSeriousViolations(page);
  });

  test("a tool page", async ({ page }) => {
    await page.goto("/tools/jpg-to-png");
    await assertNoSeriousViolations(page);
  });

  test("the pdf hub", async ({ page }) => {
    await page.goto("/pdf");
    await assertNoSeriousViolations(page);
  });

  test("the compress hub", async ({ page }) => {
    await page.goto("/compress");
    await assertNoSeriousViolations(page);
  });

  test("the privacy page", async ({ page }) => {
    await page.goto("/privacy");
    await assertNoSeriousViolations(page);
  });

  test("the storage page", async ({ page }) => {
    await page.goto("/storage");
    await assertNoSeriousViolations(page);
  });

  test("the comparison index", async ({ page }) => {
    await page.goto("/vs");
    await assertNoSeriousViolations(page);
  });

  test("a comparison page", async ({ page }) => {
    await page.goto("/vs/ilovepdf");
    await assertNoSeriousViolations(page);
  });

  test("header search open with results", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: /Search tools/ }).click();
    await page
      .getByRole("combobox", { name: "Search tools" })
      .pressSequentially("compress");
    await expect(page.getByRole("option").first()).toBeVisible();
    await assertNoSeriousViolations(page);
  });

  test("home page with the To listbox open", async ({ page }) => {
    await page.goto("/");

    const from = page.getByRole("combobox", { name: "Convert from" });
    await from.focus();
    await from.pressSequentially("jpg");
    await from.press("ArrowDown");
    await from.press("Enter");

    const to = page.getByRole("combobox", { name: "Convert to" });
    await to.focus();
    await to.press("ArrowDown");
    await expect(
      page.getByRole("listbox", { name: "Convert to" }),
    ).toBeVisible();

    await assertNoSeriousViolations(page);
  });

  test("the skip link is the first tab stop and moves focus to the content", async ({
    page,
  }) => {
    await page.goto("/privacy");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to content" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.locator("main")).toBeFocused();
  });

  test("a tool page with options (slider)", async ({ page }) => {
    await page.goto("/tools/compress-jpg");
    await page.getByRole("combobox", { name: "Mode" }).click();
    await page.getByRole("option", { name: "Custom quality" }).click();
    await expect(page.getByRole("slider").first()).toBeVisible();
    await expect(
      page.getByRole("slider").first(),
      "the slider thumb carries its field's name",
    ).toHaveAccessibleName(/\S/);
    await assertNoSeriousViolations(page);
  });

  test("the compress menu open", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Compress" }).first().click();
    await expect(
      page.getByRole("link", { name: "Compress JPG" }).first(),
    ).toBeVisible();
    await assertNoSeriousViolations(page);
  });

  test("the engine consent dialog", async ({ page }) => {
    await page.goto("/tools/avi-to-mp4");
    await page
      .locator('input[type="file"]')
      .setInputFiles("e2e/fixtures/sample.avi");
    await expect(page.getByRole("dialog")).toBeVisible();
    await assertNoSeriousViolations(page);
  });

  test("the crop editor, with focus moved into it", async ({ page }) => {
    await page.goto("/tools/crop-jpg");
    await page
      .locator('input[type="file"]')
      .setInputFiles("e2e/fixtures/photo-medium.jpg");
    const editor = page.getByRole("group", { name: /^Crop photo-medium/ });
    await expect(editor).toBeVisible();
    await expect(editor).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("button", { name: /^Crop region/ }),
    ).toBeFocused();
    await assertNoSeriousViolations(page);
  });

  test("the trim preview, with focus moved into it", async ({ page }) => {
    await page.goto("/tools/trim-video");
    await page
      .locator('input[type="file"]')
      .setInputFiles("e2e/fixtures/sample.mp4");
    await expect(page.getByText("Length:")).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole("group", { name: /sample\.mp4/ }),
    ).toBeFocused();
    await assertNoSeriousViolations(page);
  });

  test("the pdf editor with a document open", async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto("/tools/pdf-editor");
    await page
      .locator('input[type="file"]')
      .setInputFiles("e2e/fixtures/pdf-editor.pdf");
    await expect(page.locator('[data-page-index="0"] img')).toBeVisible({
      timeout: 45_000,
    });
    await assertNoSeriousViolations(page);
  });
});
