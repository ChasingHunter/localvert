import { expect, test } from "@playwright/test";

/**
 * Finding things: the header search (Ctrl+K and "/"), the Compress menu,
 * the /vs index and the per-category Popular row.
 */

test.describe("header search", () => {
  test("Ctrl+K opens it and Enter on 'compress pdf' lands on that tool", async ({
    page,
  }) => {
    await page.goto("/");
    // Wait for hydration: the shortcut listener is attached in an effect.
    await expect(
      page.getByRole("button", { name: /Search tools/ }),
    ).toBeVisible();
    await page.waitForLoadState("networkidle");

    await page.keyboard.press("Control+k");
    const search = page.getByRole("combobox", { name: "Search tools" });
    await expect(search).toBeFocused();

    await search.pressSequentially("compress pdf");
    await expect(page.getByRole("option").first()).toHaveText(/Compress PDF/);
    await search.press("Enter");
    await expect(page).toHaveURL(/\/tools\/compress-pdf$/);
  });

  test("shows a friendly empty state", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: /Search tools/ }).click();
    await page
      .getByRole("combobox", { name: "Search tools" })
      .pressSequentially("xyz");
    await expect(
      page.getByText('No tools match "xyz". Try a format like PDF or JPG.'),
    ).toBeVisible();
  });

  test("'/' opens it, but not while typing in a picker", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const from = page.getByRole("combobox", { name: "Convert from" });
    await from.focus();
    await page.keyboard.press("/");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(from).toHaveValue("/");

    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("/");
    await expect(
      page.getByRole("dialog", { name: "Search tools" }),
    ).toBeVisible();
  });
});

test.describe("compress menu", () => {
  test("opens with Enter, lists the compressors, Esc closes and restores focus", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const nav = page.getByRole("navigation", { name: "Main" });
    const button = nav.getByRole("button", { name: "Compress" });
    await button.focus();
    await page.keyboard.press("Enter");
    await expect(button).toHaveAttribute("aria-expanded", "true");
    await expect(nav.getByRole("link", { name: "Compress PDF" })).toBeVisible();
    await expect(
      nav.getByRole("link", { name: "All compress tools" }),
    ).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await expect(button).toBeFocused();
    await expect(nav.getByRole("link", { name: "Compress PDF" })).toBeHidden();
  });

  test("a click outside closes it", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const button = page.getByRole("button", { name: "Compress" });
    await button.click();
    await expect(button).toHaveAttribute("aria-expanded", "true");
    await page.locator("main").click({ position: { x: 5, y: 5 } });
    await expect(button).toHaveAttribute("aria-expanded", "false");
  });
});

test("the /vs index lists the three comparisons", async ({ page }) => {
  await page.goto("/vs");
  const links = page.getByRole("main").getByRole("link");
  await expect(links).toHaveText([
    "Localvert vs iLovePDF",
    "Localvert vs Smallpdf",
    "Localvert vs VERT",
  ]);
});

test("a category page shows its own Popular row", async ({ page }) => {
  await page.goto("/audio");
  const popular = page.getByRole("navigation", { name: "Popular conversions" });
  await expect(popular.getByRole("link")).toHaveCount(5);
  await expect(popular.getByRole("link", { name: "MP4 to MP3" })).toBeVisible();
});
