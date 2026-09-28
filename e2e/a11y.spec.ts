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
});
