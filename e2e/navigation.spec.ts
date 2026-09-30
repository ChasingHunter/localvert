import { expect, test } from "@playwright/test";

/**
 * Finding things: the header search (Ctrl+K and "/"), the Compress menu,
 * the /vs index, the per-category Popular row, and the structured data
 * (JSON-LD, llms.txt) that helps crawlers and assistants find them.
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

test("a tool page's JSON-LD parses and its FAQ matches the visible questions", async ({
  page,
}) => {
  // The page's meta CSP only allows hashed inline scripts; a JSON-LD block
  // with a stale hash would show up here as a violation.
  const violations: string[] = [];
  page.on("console", (message) => {
    if (/content security policy/i.test(message.text())) {
      violations.push(message.text());
    }
  });
  await page.goto("/tools/compress-pdf");

  const raw = await page
    .locator('script[type="application/ld+json"]')
    .textContent();
  const graph = JSON.parse(raw ?? "")["@graph"] as {
    "@type": string;
    mainEntity?: { name: string }[];
    itemListElement?: { name: string }[];
  }[];
  expect(graph.map((node) => node["@type"])).toEqual([
    "WebApplication",
    "BreadcrumbList",
    "FAQPage",
  ]);

  const faq = page.getByRole("region", { name: "Questions" });
  await expect(faq.getByRole("term")).toHaveText(
    graph[2]?.mainEntity?.map((q) => q.name) ?? [],
  );
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toHaveText(
    (graph[1]?.itemListElement ?? []).map((item) => item.name).join("›"),
  );
  expect(violations).toEqual([]);
});

test("the home page carries WebSite JSON-LD", async ({ page }) => {
  await page.goto("/");
  const raw = await page
    .locator('script[type="application/ld+json"]')
    .textContent();
  expect(JSON.parse(raw ?? "")).toMatchObject({
    "@type": "WebSite",
    name: "Localvert",
  });
});

test("/llms.txt is plain text and lists the tools", async ({ request }) => {
  const response = await request.get("/llms.txt");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("text/plain");
  const body = await response.text();
  expect(body.startsWith("# Localvert\n")).toBe(true);
  expect(body).toContain("/tools/compress-pdf): ");
});
