import { test as base, expect } from "@playwright/test";

/**
 * End to end against a real built `out/` — see jpg-to-png.spec.ts's doc
 * comment for why (`_headers`, COOP/COEP, the real CSP). Covers ADR-0015's
 * Converter island: the From/To pickers' keyboard contract, alias search,
 * the To list's format/action grouping, the drop-detect-navigate flow (both
 * single- and mixed-format), and the Popular chips.
 */

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

function fixturePath(name: string): string {
  return `e2e/fixtures/${name}`;
}

test.describe("Converter", () => {
  test("keyboard-only From -> To -> Go lands on the pair page with the heading focused", async ({
    page,
  }) => {
    await page.goto("/");

    // "jpg" rather than the ADR's own example query "jpe": "jpe" is a
    // substring of both JPEG's ext ("jpeg") and JPEG XL's label ("JPEG XL"),
    // so it matches two options — ArrowDown would then correctly (per the
    // no-wrap, "move to the next match" contract in combobox-logic.ts) land
    // on the second one instead of committing the first. "jpg" matches only
    // JPEG's ext, so ArrowDown highlights the one match already active from
    // typing and Enter commits it.
    const from = page.getByRole("combobox", { name: "Convert from" });
    await from.focus();
    await from.pressSequentially("jpg");
    await from.press("ArrowDown");
    await from.press("Enter");
    await expect(from).toHaveValue("JPEG");

    await page.keyboard.press("Tab");
    const to = page.getByRole("combobox", { name: "Convert to" });
    await expect(to).toBeFocused();
    await to.pressSequentially("png");
    await to.press("Enter");
    await expect(to).toHaveValue("PNG");

    await page.getByRole("button", { name: "Go" }).click();
    await expect(page).toHaveURL(/\/tools\/jpg-to-png$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("aliases: typing 'word' in From offers Word Document", async ({
    page,
  }) => {
    await page.goto("/");

    const from = page.getByRole("combobox", { name: "Convert from" });
    await from.focus();
    await from.pressSequentially("word");
    await expect(
      page.getByRole("option", { name: /Word Document/ }),
    ).toBeVisible();
  });

  test("PDF's To list has a Word conversion and an Actions group with Compress", async ({
    page,
  }) => {
    await page.goto("/");

    const from = page.getByRole("combobox", { name: "Convert from" });
    await from.focus();
    await from.pressSequentially("pdf");
    await from.press("Enter");
    await expect(from).toHaveValue("PDF");

    const to = page.getByRole("combobox", { name: "Convert to" });
    await to.press("ArrowDown");
    await expect(page.getByRole("option", { name: /Word/ })).toBeVisible();
    await expect(page.getByRole("group", { name: "Actions" })).toBeVisible();
    await expect(page.getByRole("option", { name: "Compress" })).toBeVisible();
  });

  test("dropping a single-format file detects it, focuses To, and hands off the file on choosing a target", async ({
    page,
  }) => {
    await page.goto("/");

    await page
      .locator('input[type="file"]')
      .setInputFiles(fixturePath("sample.gif"));

    await expect(page.getByRole("status")).toContainText(/Detected .*GIF/i);

    const to = page.getByRole("combobox", { name: "Convert to" });
    await expect(to).toBeFocused();
    await to.pressSequentially("png");
    await to.press("Enter");

    await expect(page).toHaveURL(/\/tools\/gif-to-png$/);

    const downloadLink = page.getByRole("link", { name: "Download" });
    await expect(downloadLink).toBeVisible({ timeout: 15_000 });
  });

  test("dropping mixed formats shows one group per format", async ({
    page,
  }) => {
    await page.goto("/");

    await page
      .locator('input[type="file"]')
      .setInputFiles([fixturePath("a.pdf"), fixturePath("photo-small.jpg")]);

    await expect(page.getByRole("button", { name: "1 PDF" })).toBeVisible();
    await expect(page.getByRole("button", { name: "1 JPEG" })).toBeVisible();
  });

  test("a Popular chip navigates to its pair page", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("link", { name: /PDF to Word/ }).click();
    await expect(page).toHaveURL(/\/tools\/pdf-to-word$/);
  });

  test("From combobox exposes combobox/option ARIA and toggles aria-expanded", async ({
    page,
  }) => {
    await page.goto("/");

    const from = page.getByRole("combobox", { name: "Convert from" });
    await expect(from).toHaveAttribute("aria-expanded", "false");

    await from.focus();
    await from.press("ArrowDown");
    await expect(from).toHaveAttribute("aria-expanded", "true");

    const firstOption = page.getByRole("option").first();
    await expect(firstOption).toHaveAttribute("role", "option");
    await firstOption.click();
    await expect(from).toHaveAttribute("aria-expanded", "false");

    // Re-open: the just-committed option is now the selected one.
    await from.press("ArrowDown");
    const value = await from.inputValue();
    await expect(
      page.getByRole("option", { name: new RegExp(value) }).first(),
    ).toHaveAttribute("aria-selected", "true");
  });
});
