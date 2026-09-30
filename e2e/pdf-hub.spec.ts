import { expect, test } from "@playwright/test";

/**
 * The PDF hub (docs/ROADMAP.md's "Before cutting v0.4.0"): confirms the
 * static, server-rendered shape actually reaches the browser — all five
 * groups show up with headings, and the "Edit a PDF" entry links straight
 * to the editor tool. Group *membership* is unit-tested in
 * src/lib/pdf-hub.test.ts; this just checks the page renders it.
 */
test.describe("pdf hub", () => {
  test("shows all five groups and the editor link", async ({ page }) => {
    await page.goto("/pdf");

    await expect(
      page.getByRole("heading", { name: /every pdf tool/i, level: 1 }),
    ).toBeVisible();

    for (const group of [
      "Organize",
      "Optimize",
      "Convert",
      "Edit",
      "Security",
    ]) {
      await expect(
        page.getByRole("heading", { name: group, level: 2 }),
      ).toBeVisible();
    }

    const editorLink = page.getByRole("link", { name: "Edit a PDF" });
    await expect(editorLink).toBeVisible();
    await expect(editorLink).toHaveAttribute("href", "/tools/pdf-editor");
  });
});
