/**
 * One-off generator for `e2e/fixtures/ocr-text.png` — a small, high-contrast
 * PNG with clear rendered text, committed alongside this script rather than
 * regenerated at test time. `e2e/all-tools.spec.ts`'s generic smoke test
 * needs a real fixture per accepted format (it doesn't render one in-page
 * like `e2e/ocr.spec.ts` does), and `image-to-text`'s own `accepts` order
 * (jpg first) would otherwise pick `photo-small.jpg` — a real photo with no
 * text at all, which the tesseract engine reads as empty/near-empty output
 * and fails the spec's "output should be non-empty text" check.
 *
 * Uses Playwright's own bundled Chromium (already a dependency) to draw the
 * text on a canvas and encode it to a PNG blob — same approach as
 * `e2e/ocr.spec.ts`'s `renderTextPng`, just run once here and saved to disk
 * instead of generated fresh in every test run. Re-run with
 * `node scripts/gen-ocr-fixture.ts` if the fixture ever needs to change.
 */
import { writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const bytes = await page.evaluate(async () => {
    const width = 640;
    const height = 120;
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#000000";
    ctx.font = "bold 48px sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillText("Localvert OCR Test", 20, height / 2);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  await browser.close();

  const outPath = "e2e/fixtures/ocr-text.png";
  writeFileSync(outPath, Buffer.from(bytes));
  // biome-ignore lint/suspicious/noConsole: this is the script's own completion summary.
  console.log(`wrote ${outPath} (${bytes.length} bytes)`);
}

main();
