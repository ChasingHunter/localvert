import { readFileSync } from "node:fs";
import { PDFDict, PDFDocument, PDFName } from "@cantoo/pdf-lib";
import { test as base, expect } from "@playwright/test";

/**
 * End to end against a real built `out/` — same reasoning as
 * `e2e/pdf-editor.spec.ts` (which this file deliberately doesn't import
 * from; every spec in this suite duplicates its own small helpers rather
 * than sharing a module — see `e2e/image-matrix-g1.spec.ts` for the same
 * pattern). Covers the "Sign" signature dialog (ADR-0009 slice E2b): draw/
 * type/upload all funnel into the same stamp-placement path the existing
 * "Insert image" tool uses, so a signature ends up as a `Stamp` annotation
 * exactly like an uploaded image would.
 */

function fixturePath(name: string): string {
  return `e2e/fixtures/${name}`;
}

/** Every annotation `/Subtype` name on one page, e.g. ["Stamp"]. */
async function annotSubtypes(bytes: Buffer, pageIndex = 0): Promise<string[]> {
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPages()[pageIndex];
  if (!page) throw new Error(`no page ${pageIndex}`);
  const annots = page.node.Annots();
  if (!annots) return [];
  const subtypes: string[] = [];
  for (let i = 0; i < annots.size(); i++) {
    const dict = annots.lookup(i, PDFDict);
    const subtype = dict.get(PDFName.of("Subtype"));
    subtypes.push(subtype ? subtype.toString().replace(/^\//, "") : "unknown");
  }
  return subtypes;
}

interface Fixtures {
  /** Autouse: fails the test if any request left the page's own origin. */
  privacyGuard: undefined;
  /** Autouse: fails the test if the browser ever reported a CSP violation. */
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

      const isolated = await page.evaluate(() => self.crossOriginIsolated);
      expect(
        isolated,
        "page must be cross-origin isolated (COOP/COEP from public/_headers)",
      ).toBe(true);
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

/** The real rendered page's bitmap for `pageIndex` (0-based) — see
 * `pdf-editor.spec.ts`'s identical helper for why `data-page-index` (not
 * `img.first()`) is required. */
function pageImage(page: import("@playwright/test").Page, pageIndex = 0) {
  return page.locator(`[data-page-index="${pageIndex}"] img`);
}

/** Clicks Export PDF and returns the downloaded bytes. */
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

/** Opens the fixture and waits for the first page's rendered bitmap. */
async function openEditor(page: import("@playwright/test").Page) {
  await page.goto("/tools/pdf-editor");
  await page
    .locator('input[type="file"]')
    .setInputFiles(fixturePath("pdf-editor.pdf"));
  // See `pdf-editor.spec.ts`'s `openEditor` for why this is so generous —
  // same cold-start cost (editor chunk + pdfium.wasm) applies here.
  await expect(pageImage(page, 0)).toBeVisible({ timeout: 45_000 });
}

/** A viewport point at fractional coordinates `(fx, fy)` (0..1, from the
 * page image's top-left) on page `pageIndex` — identical reasoning to
 * `pdf-editor.spec.ts`'s `pointOnPage`: a click outside Playwright's actual
 * viewport is silently dropped. */
async function pointOnPage(
  page: import("@playwright/test").Page,
  pageIndex: number,
  fx: number,
  fy: number,
): Promise<{ x: number; y: number }> {
  const img = pageImage(page, pageIndex);
  await img.scrollIntoViewIfNeeded();
  const box = await img.boundingBox();
  if (!box) throw new Error(`page ${pageIndex} image has no bounding box`);
  const point = { x: box.x + box.width * fx, y: box.y + box.height * fy };
  const viewportSize = page.viewportSize();
  if (!viewportSize) throw new Error("page has no viewport size");
  if (
    point.x < 0 ||
    point.y < 0 ||
    point.x > viewportSize.width ||
    point.y > viewportSize.height
  ) {
    throw new Error(
      `point (${point.x}, ${point.y}) is outside the ${viewportSize.width}x${viewportSize.height} viewport — it would be silently dropped`,
    );
  }
  return point;
}

test.describe("pdf-editor signature dialog", () => {
  // Same generous sizing as pdf-editor.spec.ts — the toolbar + thumbnail
  // rail push the page image's bounding box down, so a taller-than-default
  // viewport keeps `pointOnPage`'s target points actually reachable.
  test.use({ viewport: { width: 1280, height: 1100 } });
  test.setTimeout(60_000);

  test("types a signature, places it, and exports a PDF with a Stamp annotation", async ({
    page,
  }) => {
    await openEditor(page);

    await page.getByRole("button", { name: "Sign" }).click();
    await expect(page.getByRole("tab", { name: "Type" })).toBeVisible();
    await page.getByRole("tab", { name: "Type" }).click();
    await page.getByLabel("Type your signature").fill("Ada Lovelace");
    await page.getByRole("button", { name: "Place" }).click();

    // Placing a signature arms the "stamp" tool exactly like the existing
    // "Insert image" flow (see `placeStamp` in `pdf-editor-app.tsx`) — the
    // user still clicks the page to drop it.
    const point = await pointOnPage(page, 0, 0.5, 0.5);
    await page.mouse.click(point.x, point.y);

    await expect
      .poll(async () => annotSubtypes(await exportBytes(page)), {
        message: "export should eventually contain a Stamp annotation",
        timeout: 10_000,
      })
      .toContain("Stamp");
  });

  test("remembering a signature stores it in IndexedDB, and Forget clears it", async ({
    page,
  }) => {
    await openEditor(page);

    const hasSaved = () =>
      page.evaluate(
        () =>
          new Promise<boolean>((resolve, reject) => {
            const req = indexedDB.open("localvert", 1);
            req.onsuccess = () => {
              const db = req.result;
              if (!db.objectStoreNames.contains("signatures")) {
                db.close();
                resolve(false);
                return;
              }
              const tx = db.transaction("signatures", "readonly");
              const getReq = tx.objectStore("signatures").get("default");
              getReq.onsuccess = () => {
                db.close();
                resolve(getReq.result != null);
              };
              getReq.onerror = () => {
                db.close();
                reject(getReq.error);
              };
            };
            req.onerror = () => reject(req.error);
          }),
      );

    await page.getByRole("button", { name: "Sign" }).click();
    await page.getByRole("tab", { name: "Type" }).click();
    await page.getByLabel("Type your signature").fill("Ada Lovelace");
    await page.getByLabel("Remember this signature on this device").check();
    await page.getByRole("button", { name: "Place" }).click();

    await expect.poll(hasSaved, { timeout: 10_000 }).toBe(true);

    // Reopen the dialog: the saved signature should offer "Use saved" and
    // "Forget" controls, per ADR-0009's opt-in/forget requirement.
    await page.getByRole("button", { name: "Sign" }).click();
    await expect(page.getByRole("button", { name: "Forget" })).toBeVisible();
    await page.getByRole("button", { name: "Forget" }).click();

    await expect.poll(hasSaved, { timeout: 10_000 }).toBe(false);
  });

  test("uploads an image via the Insert image tool, places it, and exports a PDF with a Stamp annotation", async ({
    page,
  }) => {
    await openEditor(page);

    // Same stamp-placement path as a typed/drawn signature ("Insert image"
    // is `applyActiveTool`'s other entry point into `placeStamp` — see its
    // doc comment in `pdf-editor-app.tsx`) — this test exists because both
    // paths shared the same bug: `placeStamp` used to hand the image bytes
    // to `setActiveTool`'s unused `context` argument instead of
    // `setToolDefaults`'s `imageSrc`, so neither an uploaded image nor a
    // signature ever actually placed a stamp. Setting the file directly on
    // the hidden `<input>` mirrors what clicking the toolbar's "Insert
    // image" button, then picking a file, does.
    await page
      .locator('input[type="file"][accept="image/*"]')
      .setInputFiles(fixturePath("not-a-jpg.png"));

    const point = await pointOnPage(page, 0, 0.5, 0.5);
    await page.mouse.click(point.x, point.y);

    await expect
      .poll(async () => annotSubtypes(await exportBytes(page)), {
        message: "export should eventually contain a Stamp annotation",
        timeout: 10_000,
      })
      .toContain("Stamp");
  });
});
