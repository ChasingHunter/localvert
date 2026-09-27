import { readFileSync } from "node:fs";
import { test as base, expect } from "@playwright/test";

/**
 * Slice E5 — edit existing text in place. Same `wrangler dev --local` setup
 * as `e2e/pdf-editor.spec.ts` and `e2e/pdf-editor-redact.spec.ts`; see those
 * files for the privacy/CSP guards and `openEditor`/fixture reasoning,
 * reused here unchanged. Uses `e2e/fixtures/pdf-editor.pdf` page 0's real
 * text run, "Sample text for page 1" (per `e2e/pdf-editor.spec.ts`'s own
 * comment) — clicks the "Sample" text object, types "Changed", and confirms
 * the exported PDF's text reflects the edit.
 */

function fixturePath(name: string): string {
  return `e2e/fixtures/${name}`;
}

async function extractText(bytes: Buffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
  let text = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    for (const item of content.items) {
      if ("str" in item) text += `${item.str} `;
    }
  }
  return text;
}

interface Fixtures {
  privacyGuard: undefined;
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

function pageImage(page: import("@playwright/test").Page, pageIndex = 0) {
  return page.locator(`[data-page-index="${pageIndex}"] img`);
}

async function openEditor(page: import("@playwright/test").Page) {
  await page.goto("/tools/pdf-editor");
  await page
    .locator('input[type="file"]')
    .setInputFiles(fixturePath("pdf-editor.pdf"));
  await expect(pageImage(page, 0)).toBeVisible({ timeout: 45_000 });
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

test.describe("pdf-editor text edit", () => {
  test.use({ viewport: { width: 1280, height: 1100 }, actionTimeout: 10_000 });
  test.setTimeout(60_000);

  test("editing the 'Sample' text object changes the exported text", async ({
    page,
  }) => {
    await openEditor(page);

    await page.getByRole("button", { name: "Edit text" }).click();
    const sampleObject = page.getByRole("button", {
      name: /Text object: .*Sample/,
    });
    await expect(sampleObject).toBeVisible({ timeout: 10_000 });
    await sampleObject.click();

    const input = page.getByRole("textbox", { name: /Edit text:/ });
    await expect(input).toBeVisible();
    await input.fill("Changed");
    await input.press("Enter");

    // `handleTextReplaced` reopens the document to force a re-render (same
    // fallback `applyRedactions`/`PageOrganizer` use) — wait for that
    // reopened page to render before exporting.
    await expect(pageImage(page, 0)).toBeVisible({ timeout: 15_000 });

    const bytes = await exportBytes(page);
    const text = await extractText(bytes);
    expect(text).toContain("Changed");
    expect(text).not.toContain("Sample");
  });
});
