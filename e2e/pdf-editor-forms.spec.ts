import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "@cantoo/pdf-lib";
import { expect, test } from "@playwright/test";

/**
 * End to end against a real built `out/` — same reasoning as
 * `pdf-editor.spec.ts`. Covers E2a: filling AcroForm widgets rendered by
 * `FormLayer` (a text field, a checkbox and a dropdown) and the "Flatten
 * forms" export option.
 *
 * The fixture is generated in-process with `@cantoo/pdf-lib` rather than
 * checked in — a form's field geometry only matters relative to what this
 * test itself asserts against, so there's no reason to keep a binary
 * fixture in sync with it by hand.
 */

/** Builds a one-page, 300x300pt PDF with a text field "name", a checkbox
 * "agree" and a 3-option dropdown "color", each large enough to hit
 * reliably with Playwright. Returns the bytes and writes a copy to a temp
 * file Playwright's `setInputFiles` can load. */
async function buildFormFixture(): Promise<string> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 300]);
  const form = doc.getForm();

  const nameField = form.createTextField("name");
  nameField.addToPage(page, { x: 20, y: 220, width: 150, height: 24 });

  const agreeField = form.createCheckBox("agree");
  agreeField.addToPage(page, { x: 20, y: 160, width: 24, height: 24 });

  const colorField = form.createDropdown("color");
  colorField.addOptions(["Red", "Green", "Blue"]);
  colorField.addToPage(page, { x: 20, y: 100, width: 150, height: 24 });

  const bytes = await doc.save();
  const dir = mkdtempSync(join(tmpdir(), "localvert-pdf-editor-forms-"));
  const path = join(dir, "form-fixture.pdf");
  writeFileSync(path, bytes);
  return path;
}

/** The real rendered page's bitmap for `pageIndex` — see `pdf-editor.spec.ts`
 * for why this can't be a bare `img.first()`. */
function pageImage(page: import("@playwright/test").Page, pageIndex = 0) {
  return page.locator(`[data-page-index="${pageIndex}"] img`);
}

/** Opens `path` in the editor and waits for the first page's bitmap. */
async function openEditor(page: import("@playwright/test").Page, path: string) {
  await page.goto("/tools/pdf-editor");
  await page.locator('input[type="file"]').setInputFiles(path);
  await expect(pageImage(page, 0)).toBeVisible({ timeout: 45_000 });
}

/** Clicks Export PDF and returns the downloaded bytes. */
async function exportBytes(
  page: import("@playwright/test").Page,
): Promise<Buffer> {
  const { readFileSync } = await import("node:fs");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export PDF" }).click();
  const download = await downloadPromise;
  const path = await download.path();
  if (!path) throw new Error("download produced no local path");
  return readFileSync(path);
}

test.describe("pdf-editor form filling (E2a)", () => {
  test.use({ viewport: { width: 1280, height: 1100 } });
  test.setTimeout(60_000);

  test("fills a text field, a checkbox and a dropdown, then exports the values", async ({
    page,
  }) => {
    const fixturePath = await buildFormFixture();
    await openEditor(page, fixturePath);

    await page.getByLabel("name").fill("Ada");
    await page.getByLabel("agree").check();
    await page.getByLabel("color").selectOption({ index: 2 });

    // The text field commits on a 250ms debounce (see FormLayer) or on
    // blur — `.fill()` leaves focus in the input, and clicking the next
    // control blurs it, so by the time the dropdown selection above
    // resolves the text commit has already flushed either way. Poll the
    // real export regardless, since it's the only ground truth for "the
    // engine actually has these values".
    await expect
      .poll(
        async () => {
          const bytes = await exportBytes(page);
          const doc = await PDFDocument.load(bytes);
          const form = doc.getForm();
          return {
            name: form.getTextField("name").getText(),
            agree: form.getCheckBox("agree").isChecked(),
            color: form.getDropdown("color").getSelected(),
          };
        },
        {
          message: "export should eventually reflect the filled form values",
          timeout: 10_000,
        },
      )
      .toEqual({ name: "Ada", agree: true, color: ["Blue"] });
  });

  test("Flatten forms export leaves no AcroForm fields", async ({ page }) => {
    const fixturePath = await buildFormFixture();
    await openEditor(page, fixturePath);

    await page.getByLabel("name").fill("Ada");
    await page.getByLabel("name").blur();

    await expect(
      page.getByRole("checkbox", { name: "Flatten forms" }),
    ).toBeVisible();
    await page.getByRole("checkbox", { name: "Flatten forms" }).check();

    const bytes = await exportBytes(page);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getForm().getFields()).toHaveLength(0);
  });
});
