import { test as base, expect } from "@playwright/test";

/**
 * "Run again with new settings": drop runs immediately with the current
 * options, changing a setting afterwards shows one button, and pressing it
 * replaces the finished result with one made from the new settings.
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
      expect(foreign, "no request should leave the page's origin").toEqual([]);
    },
    { auto: true },
  ],
});

test.describe("run again with new settings", () => {
  test("compress-jpg re-runs with the new mode and replaces the result", async ({
    page,
  }) => {
    await page.goto("/tools/compress-jpg");
    await page
      .locator('input[type="file"]')
      .setInputFiles("e2e/fixtures/photo-large.jpg");

    const status = page.getByText(/^Done/);
    await expect(status).toBeVisible({ timeout: 30_000 });
    const before = await status.textContent();

    const rerun = page.getByRole("button", {
      name: "Run again with new settings",
    });
    await expect(rerun).toHaveCount(0);

    await page.getByRole("combobox", { name: "Mode" }).click();
    await page.getByRole("option", { name: "Smallest file" }).click();
    await expect(rerun).toBeVisible();

    await rerun.click();
    // Hidden as soon as the new run starts, and shown again only on a change.
    await expect(rerun).toHaveCount(0);
    await expect(status).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("link", { name: "Download" })).toHaveCount(1);
    expect(await status.textContent()).not.toBe(before);
  });
});
