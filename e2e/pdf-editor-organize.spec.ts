import { readFileSync } from "node:fs";
import { PDFDocument } from "@cantoo/pdf-lib";
import { expect, test } from "@playwright/test";

/**
 * E3 — the page organizer. Uses `e2e/fixtures/pdf-editor.pdf` (2 pages),
 * same fixture `e2e/pdf-editor.spec.ts` opens, so this doesn't need its own.
 *
 * Flow: open the organizer, move page 2 before page 1 via the KEYBOARD path
 * (select, Alt+ArrowLeft — not drag, which real-mouse-only Playwright
 * pointer emulation makes flaky), rotate the (now-first) tile right, insert
 * a blank page after the last tile, Apply, then Export and assert on the
 * resulting bytes: 3 pages, first page rotated 90, last page blank (no
 * content stream — never drawn to).
 */

function fixturePath(name: string): string {
  return `e2e/fixtures/${name}`;
}

async function openEditor(page: import("@playwright/test").Page) {
  await page.goto("/tools/pdf-editor");
  await page
    .locator('input[type="file"]')
    .setInputFiles(fixturePath("pdf-editor.pdf"));
  await expect(page.locator('[data-page-index="0"] img')).toBeVisible({
    timeout: 45_000,
  });
}

async function exportBytes(
  page: import("@playwright/test").Page,
): Promise<Buffer> {
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export PDF" }).click();
  const download = await downloadPromise;
  const path = await download.path();
  if (!path) throw new Error("download produced no local path");
  return readFileSync(path);
}

test.describe("pdf-editor page organizer", () => {
  test.use({ viewport: { width: 1280, height: 1100 } });
  test.setTimeout(60_000);

  test("reorder (keyboard), rotate, insert blank, apply, export", async ({
    page,
  }) => {
    await openEditor(page);

    await page.getByRole("button", { name: "Organize pages" }).click();
    const dialog = page.getByRole("dialog", { name: "Organize pages" });
    await expect(dialog).toBeVisible();

    // Select page 2, move it before page 1 via Alt+ArrowLeft (the
    // keyboard reorder path — see PageOrganizer's window keydown handler).
    await page.getByRole("option", { name: "Page 2" }).click();
    await page.keyboard.press("Alt+ArrowLeft");

    // The tile now first (originally page 2) — rotate it right 90°. Each
    // tile's per-page buttons are named by their current (post-reorder)
    // 1-based position, so the first tile's is "...page 1...".
    const firstTile = dialog.getByRole("option").first();
    await firstTile
      .getByRole("button", { name: "Rotate page 1 right" })
      .click();

    // Insert a blank page after the last tile (originally page 1, now at
    // position 2).
    const lastTile = dialog.getByRole("option").last();
    await lastTile
      .getByRole("button", { name: "Insert blank page after page 2" })
      .click();

    await expect(dialog.getByRole("option")).toHaveCount(3);

    await dialog.getByRole("button", { name: "Apply" }).click();
    // The dialog closes once Apply finishes (reopen succeeded).
    await expect(dialog).not.toBeVisible({ timeout: 20_000 });

    // The editor re-mounted on the new (reorganized) document — wait for
    // its first page to render again before exporting.
    await expect(page.locator('[data-page-index="0"] img')).toBeVisible({
      timeout: 20_000,
    });

    const bytes = await exportBytes(page);
    const doc = await PDFDocument.load(bytes);
    const pages = doc.getPages();
    expect(pages.length).toBe(3);
    expect(pages[0]?.getRotation().angle).toBe(90);

    const lastPage = pages[2];
    if (!lastPage) throw new Error("expected a third page");
    // A blank page never drawn to has no `/Contents` entry at all.
    expect(lastPage.node.Contents()).toBeUndefined();
  });
});
