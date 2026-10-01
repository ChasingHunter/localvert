import { expect, test } from "@playwright/test";

/**
 * /storage lists what the service worker cached under /engines/ and lets a
 * person remove it. markdown-to-pdf is the cheapest conversion that fetches a
 * static engine (typst) with no consent prompt, so it fills the cache.
 */
test("storage page lists a downloaded engine and removes it", async ({
  page,
}) => {
  test.setTimeout(150_000);

  await page.goto("/tools/markdown-to-pdf");
  // The runtime cache only fills once the service worker controls the page.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);

  await page
    .locator('input[type="file"]')
    .setInputFiles("e2e/fixtures/sample.md");
  await expect(
    page.getByRole("list").getByRole("link", { name: "Download" }),
  ).toBeVisible({ timeout: 90_000 });

  await page.goto("/storage");
  const row = page.getByRole("listitem").filter({ hasText: "Markdown to PDF" });
  await expect(row).toBeVisible();
  await expect(row).toContainText(/\d(\.\d)? (KB|MB)/);

  await page.getByRole("button", { name: "Remove Markdown to PDF" }).click();
  await expect(row).toHaveCount(0);
  await expect(
    page.getByRole("status").filter({ hasText: "Removed." }),
  ).toBeVisible();
});
