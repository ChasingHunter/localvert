import { readFileSync } from "node:fs";
import { PDFDict, PDFDocument, PDFName } from "@cantoo/pdf-lib";
import { test as base, expect } from "@playwright/test";

/**
 * Slice E4a — true (content-level) redaction. Same `wrangler dev --local`
 * setup as `e2e/pdf-editor.spec.ts`; see that file for the privacy/CSP
 * guards and `openEditor`/`pointOnPage` reasoning, reused here unchanged.
 *
 * Uses `e2e/fixtures/pdf-editor.pdf` page 0's real text run ("Sample text
 * for page 1", per `e2e/pdf-editor.spec.ts`'s own comment on that fixture) —
 * "Sample" is searched and marked via "Find & mark", then Apply removes it.
 * "text" (a different word from the same run) must survive a flatten-OFF
 * apply, proving the whole page wasn't blanked.
 */

function fixturePath(name: string): string {
  return `e2e/fixtures/${name}`;
}

/** Extracts every page's plain text via `pdfjs-dist` (legacy/Node build) —
 * the same library `e2e/pdf-editor.spec.ts`'s doc comment on this fixture
 * assumes readers would use, and already a project dependency (the `pdfjs`
 * engine adapter). */
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

/** True if page `pageIndex` has at least one `/XObject` whose `/Subtype` is
 * `/Image` in its `/Resources` — the signature of a flattened (image-only)
 * page. */
async function pageHasImageXObject(
  bytes: Buffer,
  pageIndex: number,
): Promise<boolean> {
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPages()[pageIndex];
  if (!page) throw new Error(`no page ${pageIndex}`);
  const resources = page.node.Resources();
  const xobjectsRef = resources?.get(PDFName.of("XObject"));
  if (!xobjectsRef) return false;
  const xobjects = doc.context.lookup(xobjectsRef, PDFDict);
  for (const key of xobjects.keys()) {
    const streamRef = xobjects.get(key);
    if (!streamRef) continue;
    const stream = doc.context.lookup(streamRef);
    // biome-ignore lint/suspicious/noExplicitAny: pdf-lib's PDFStream union has no shared `.dict` type guard exported publicly.
    const subtype = (stream as any)?.dict?.get?.(PDFName.of("Subtype"));
    if (subtype?.toString() === "/Image") return true;
  }
  return false;
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

/** Enters redact mode, searches `word`, waits for at least one mark, opens
 * the confirm dialog, sets the flatten checkbox to `flatten`, and confirms. */
async function findMarkAndApply(
  page: import("@playwright/test").Page,
  word: string,
  flatten: boolean,
) {
  await page.getByRole("button", { name: "Redact" }).click();
  await page.getByLabel("Text to find and mark for redaction").fill(word);
  await page.getByRole("button", { name: "Find & mark" }).click();
  await expect(
    page.getByText(/area.? marked/, { exact: false }),
  ).not.toHaveText("0 areas marked", { timeout: 10_000 });

  await page.getByRole("button", { name: "Apply redactions" }).click();
  const flattenCheckbox = page.getByRole("checkbox", {
    name: /Also flatten redacted pages to images/,
  });
  if (flatten) {
    await flattenCheckbox.check();
  } else {
    await flattenCheckbox.uncheck();
  }
  // The dialog's own "Apply redactions" button (distinct from the toolbar
  // button already clicked above) — scoped to the dialog so the two never
  // collide.
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Apply redactions" })
    .click();
  // Waits for the reopened document to render again before this helper
  // returns — `applyRedactions` reopens the exported bytes as a fresh
  // document (see `pdf-editor-app.tsx`'s comment on why), which briefly
  // unmounts/remounts the page image.
  await expect(pageImage(page, 0)).toBeVisible({ timeout: 15_000 });
}

test.describe("pdf-editor redaction", () => {
  test.use({ viewport: { width: 1280, height: 1100 } });
  test.setTimeout(60_000);

  test("marking and applying without flatten removes only the marked word's text", async ({
    page,
  }) => {
    await openEditor(page);
    await findMarkAndApply(page, "Sample", false);

    const bytes = await exportBytes(page);
    const text = await extractText(bytes);
    expect(text).not.toContain("Sample");
    // A different word from the same text run must survive — proves the
    // redaction removed the marked run only, not the whole page.
    expect(text).toContain("text");
    expect(await pageHasImageXObject(bytes, 0)).toBe(false);
  });

  test("marking and applying with flatten removes all text and rasterizes the page", async ({
    page,
  }) => {
    await openEditor(page);
    await findMarkAndApply(page, "Sample", true);

    const bytes = await exportBytes(page);
    const text = await extractText(bytes);
    // Flattening replaces the WHOLE page with an image, so even the
    // never-marked "text" word is no longer extractable.
    expect(text).not.toContain("Sample");
    expect(text).not.toContain("text");
    expect(await pageHasImageXObject(bytes, 0)).toBe(true);
  });
});
