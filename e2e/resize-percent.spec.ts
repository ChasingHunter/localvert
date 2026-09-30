import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

/** photo-medium.jpg is 96x64. Resize JPG now defaults to 50%. */
function readJpegSize(bytes: Uint8Array): { width: number; height: number } {
  let i = 2;
  while (i < bytes.length) {
    if (bytes[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = bytes[i + 1] ?? 0;
    const isSof =
      marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isSof) {
      return {
        height: ((bytes[i + 5] ?? 0) << 8) | (bytes[i + 6] ?? 0),
        width: ((bytes[i + 7] ?? 0) << 8) | (bytes[i + 8] ?? 0),
      };
    }
    i += 2 + (((bytes[i + 2] ?? 0) << 8) | (bytes[i + 3] ?? 0));
  }
  throw new Error("no SOF marker");
}

test.describe("resize-image-jpg", () => {
  test("halves the image on drop with the default percentage mode", async ({
    page,
  }) => {
    await page.goto("/tools/resize-image-jpg");
    await page
      .locator('input[type="file"]')
      .setInputFiles("e2e/fixtures/photo-medium.jpg");

    const link = page.getByRole("link", { name: "Download" });
    await expect(link).toBeVisible({ timeout: 30_000 });
    const downloadPromise = page.waitForEvent("download");
    await link.click();
    const path = await (await downloadPromise).path();
    if (!path) throw new Error("download produced no local path");
    expect(readJpegSize(new Uint8Array(readFileSync(path)))).toEqual({
      width: 48,
      height: 32,
    });
  });

  test("exact size with no width or height waits instead of passing through", async ({
    page,
  }) => {
    await page.goto("/tools/resize-image-jpg");
    await page.getByRole("combobox", { name: "Resize" }).click();
    await page.getByRole("option", { name: "Exact size" }).click();
    await page
      .locator('input[type="file"]')
      .setInputFiles("e2e/fixtures/photo-medium.jpg");

    const resize = page.getByRole("button", { name: "Resize", exact: true });
    await expect(resize).toBeDisabled();
    await expect(page.getByRole("link", { name: "Download" })).toHaveCount(0);

    await page.getByLabel("Width").fill("48");
    await expect(resize).toBeEnabled();
    await resize.click();
    await expect(page.getByRole("link", { name: "Download" })).toBeVisible({
      timeout: 30_000,
    });
  });
});
