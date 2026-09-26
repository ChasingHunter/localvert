import { readFileSync } from "node:fs";
import { PDFDict, PDFDocument, PDFName } from "@cantoo/pdf-lib";
import { test as base, expect } from "@playwright/test";

/**
 * End to end against a real built `out/` — same reasoning as `e2e/pdf.spec.ts`.
 * Covers the app-mode PDF editor (ADR-0009), rebuilt on `@embedpdf/core` +
 * MIT plugins (E1b Unit 2): a virtualised multi-page scroll, zoom, a
 * thumbnail rail, and plugin-driven annotate/undo/export.
 *
 * Uses `e2e/fixtures/pdf-editor.pdf` (2 pages, each with a short real text
 * run), not `e2e/fixtures/a.pdf` (2 blank 150x150 pages, shared by
 * `pdf.spec.ts`'s page-organisation tests): the annotation plugin's
 * highlight/underline/strikeout/squiggly tools are *text-markup* tools —
 * they commit whatever text is selected under the drag, not an arbitrary
 * drag rectangle (see `@embedpdf/plugin-annotation`'s
 * `textMarkupSelectionHandler`) — so a highlight needs real, selectable text
 * to drag across.
 */

function fixturePath(name: string): string {
  return `e2e/fixtures/${name}`;
}

/** Every annotation `/Subtype` name on one page, e.g. ["Highlight", "FreeText"]. */
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

/** The real rendered page's bitmap for `pageIndex` (0-based), inside the
 * main scrollable viewport — NOT the thumbnail rail's own `<img>`, which
 * sits earlier in DOM order (`ThumbnailsPane` is laid out before
 * `Viewport`/`Scroller`) and would otherwise win a bare
 * `page.locator("img").first()`. Scoped via the `data-page-index` hook
 * `pdf-editor-app.tsx`'s `renderPage` callback adds to each page wrapper. */
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

/** Opens the fixture and waits for the first page's rendered bitmap — the
 * signal the editor finished opening the document and the viewer mounted. */
async function openEditor(page: import("@playwright/test").Page) {
  await page.goto("/tools/pdf-editor");
  await page
    .locator('input[type="file"]')
    .setInputFiles(fixturePath("pdf-editor.pdf"));
  // A generous timeout: this suite's own `wrangler dev --local` cold-starts
  // serving the editor's chunk plus the 4.6MB pdfium.wasm asset, and the
  // first couple of navigations in a run can take much longer than a warm
  // one (single-digit seconds) before the render pipeline produces a
  // bitmap -- not a real app hang, just first-request codegen/asset-read
  // cost in the local dev server.
  await expect(pageImage(page, 0)).toBeVisible({ timeout: 45_000 });
}

/** A viewport point at fractional coordinates `(fx, fy)` (0..1, from the
 * page image's top-left) on page `pageIndex`. Scrolls the page into view
 * first and asserts the resulting point is inside Playwright's actual
 * viewport — a click outside it is silently dropped by Chromium (no
 * element at that point for `elementsFromPoint`) even though the
 * synthetic event still "succeeds", which was the root cause of every
 * earlier "no annotation is ever created" symptom in this suite. See the
 * `wip(editor): root-cause annotation-creation click landing outside
 * viewport` commit. */
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

test.describe("pdf-editor", () => {
  // Taller than Playwright's 720px default: the page image's bounding box
  // (pushed down by the toolbar and thumbnail rail) is otherwise taller
  // than the visible window, so a point safely inside the *page* can still
  // fall outside the *viewport* — see `pointOnPage` above.
  test.use({ viewport: { width: 1280, height: 1100 } });
  // `openEditor`'s own wait is 45s (this `wrangler dev --local` instance's
  // cold-start cost for the editor chunk + pdfium.wasm can spike well past
  // a warm open's 1-2s) -- the *test's* default 30s timeout would otherwise
  // cut that assertion off first. See openEditor's comment.
  test.setTimeout(60_000);

  // Primes `wrangler dev --local`'s asset path once, before any test's own
  // `openEditor` call: the first fetch of the editor chunk + 4.6MB
  // pdfium.wasm against a freshly-started server can stall well past 30s,
  // and which test happens to run first (and eats that cost) is effectively
  // random across a suite run -- see openEditor's own comment. Running it
  // here, in a throwaway context, means every real test below hits an
  // already-warm server.
  //
  // `test.setTimeout` above only covers *tests*, not hooks -- `beforeAll`'s
  // own default is a flat 30s regardless, which is shorter than
  // `openEditor`'s 45s wait and made this hook itself time out on a real
  // cold start (the first attempt at this fix). `testInfo.setTimeout` is the
  // hook-scoped equivalent.
  test.beforeAll(async ({ browser }, testInfo) => {
    testInfo.setTimeout(90_000);
    const context = await browser.newContext();
    const page = await context.newPage();
    await openEditor(page);
    await context.close();
  });

  // Regression test for a specific bug: on a cold start, `<EmbedPDF>`'s
  // plugin registry isn't ready the instant it mounts (`useRegistry().
  // pluginsReady` is briefly `false`), so `documentManager.provides` was
  // still `null` when a file arrived. The old `handleFiles` bailed out on
  // `if (!first || !provides) return` and the file was silently dropped —
  // nothing ever opened, no error, no retry. Setting the file on the input
  // the instant the page loads (no wait for "ready") reproduces that
  // race on every run; the fix queues the file and opens it once the
  // registry comes up.
  test("a file set on the input immediately after navigation still opens", async ({
    page,
  }) => {
    await page.goto("/tools/pdf-editor");
    const input = page.locator('input[type="file"]');
    // Attached as soon as `EditorShell`'s first render commits — well before
    // the plugin registry or the PDFium worker is ready. Waiting only for
    // attachment (not "ready") is the point: it reproduces the cold-start
    // race on every run, whereas waiting for anything readiness-related
    // would defeat the regression this test guards.
    await input.waitFor({ state: "attached" });
    await input.setInputFiles(fixturePath("pdf-editor.pdf"));
    await expect(pageImage(page, 0)).toBeVisible({ timeout: 45_000 });
  });

  test("both pages are reachable by scrolling", async ({ page }) => {
    await openEditor(page);
    const viewport = page.locator('[class*="overflow-auto"]').last();
    await viewport.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await expect(pageImage(page, 1)).toBeInViewport({ timeout: 10_000 });
  });

  test("zoom in makes the rendered page wider", async ({ page }) => {
    await openEditor(page);
    const img = pageImage(page, 0);
    const before = await img.boundingBox();
    if (!before) throw new Error("page image has no bounding box");

    await page.getByRole("button", { name: "Zoom in" }).click();
    await page.getByRole("button", { name: "Zoom in" }).click();

    await expect
      .poll(async () => (await img.boundingBox())?.width ?? 0)
      .toBeGreaterThan(before.width);
  });

  test("clicking a thumbnail brings that page into view", async ({ page }) => {
    await openEditor(page);
    await page.getByRole("button", { name: "Go to page 2" }).click();
    await expect(pageImage(page, 1)).toBeInViewport({
      timeout: 10_000,
    });
  });

  test("highlights selected text, then exports a PDF with a Highlight annotation", async ({
    page,
  }) => {
    await openEditor(page);

    await page.getByRole("button", { name: "Highlight" }).click();
    // Drags across the fixture's text run ("Sample text for page 1"), drawn
    // in the fixture with `Tm 1 0 0 1 20 250` at 18pt on a 300x300
    // MediaBox — baseline y=250 (i.e. `1 - 250/300` = 0.167 down from the
    // top) with ~18pt of ascent/descent, and the run runs from x=20 to
    // roughly x=227 (`20/300`=0.067 to `227/300`=0.757 across). fy=0.15
    // and fx 0.1..0.7 stay inside that glyph box on every side, so the
    // text-markup handler always has real text under the drag — the
    // handler commits whatever text falls under the drag as the
    // highlight's segment rects, never an arbitrary drag rectangle.
    const start = await pointOnPage(page, 0, 0.1, 0.15);
    const end = await pointOnPage(page, 0, 0.7, 0.15);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 10 });
    await page.mouse.up();

    // The text-markup handler commits asynchronously (it awaits a worker
    // round-trip for the selected text before creating the annotation —
    // see `@embedpdf/plugin-annotation`'s `textMarkupSelectionHandler`), so
    // the mouseup above returns before the Highlight annotation actually
    // exists. Waiting on the Undo button alone is not a safe signal here:
    // the yellow overlay visible mid-drag is the *live selection preview*
    // (driven by selection state, not a committed annotation), and it was
    // possible to see that preview render while Undo stayed disabled
    // forever, with no annotation ever created. Poll the real export
    // instead — the one ground truth for "the annotation was committed".
    await expect
      .poll(async () => annotSubtypes(await exportBytes(page)), {
        message: "export should eventually contain a Highlight annotation",
        timeout: 10_000,
      })
      .toContain("Highlight");

    // Now that the annotation is confirmed committed, Undo must reflect
    // that — and undoing it must remove it from a subsequent export.
    await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();
    await page.getByRole("button", { name: "Undo" }).click();
    expect(await annotSubtypes(await exportBytes(page))).not.toContain(
      "Highlight",
    );
  });

  // Regression test for a specific bug: an effect that re-ran `setActiveTool`
  // whenever a style picker changed (to push the new color onto the active
  // tool) fired mid-drag too, because `annotation.provides` -- a fresh object
  // every render -- sat in its dependency array. `setActiveTool` mid-drag
  // tears down the interaction manager's active pointer handler, so
  // `onPointerUp` never ran and no annotation was ever committed. Style
  // changes must now flow through `setToolDefaults` only, which never touches
  // the interaction manager.
  test("changing the color picker while highlight is active still commits the drag", async ({
    page,
  }) => {
    await openEditor(page);

    await page.getByRole("button", { name: "Highlight" }).click();
    await page.getByLabel("Annotation color").fill("#00ff00");

    const start = await pointOnPage(page, 0, 0.1, 0.15);
    const end = await pointOnPage(page, 0, 0.7, 0.15);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 10 });
    await page.mouse.up();

    // See the previous test — Undo alone is not a safe "committed" signal.
    await expect
      .poll(async () => annotSubtypes(await exportBytes(page)), {
        message: "export should eventually contain a Highlight annotation",
        timeout: 10_000,
      })
      .toContain("Highlight");

    await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();
  });

  test("adds free text, undo removes it before export", async ({ page }) => {
    await openEditor(page);

    await page.getByRole("button", { name: "Add text" }).click();
    const point = await pointOnPage(page, 0, 0.5, 0.2);
    await page.mouse.click(point.x, point.y);
    // The annotation plugin enters edit mode on create (`editAfterCreate`);
    // an editable region is now focused for this FreeText annotation.
    await page.keyboard.type("Localvert");
    // Commits the edit and blurs the contenteditable region. This matters
    // for undo below: while that region is focused, Ctrl+Z is native
    // browser text-undo (reverts typed characters), not the history
    // plugin's document undo, and either shortcut here would just be
    // consumed by the browser instead of reaching our own handler.
    await page.keyboard.press("Escape");

    // Exports once BEFORE undo, so this test can't pass vacuously (i.e. by
    // a FreeText that was never created in the first place — see the
    // "annotation creation" bug this suite exists to catch). Playwright's
    // `download` event fires once per triggered download, so exporting
    // twice needs the promise re-armed each time.
    const beforeUndoDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export PDF" }).click();
    const beforeUndoPath = await (await beforeUndoDownload).path();
    if (!beforeUndoPath) throw new Error("download produced no local path");
    expect(await annotSubtypes(readFileSync(beforeUndoPath))).toContain(
      "FreeText",
    );

    const undoButton = page.getByRole("button", { name: "Undo" });
    await expect(undoButton).toBeEnabled();
    // A FreeText created with `editAfterCreate` can register more than one
    // history command (the creation itself, plus the typed-text commit
    // from the Escape above), so a single Undo doesn't necessarily unwind
    // the whole annotation -- click it until the plugin's own history
    // stack says there's nothing left to undo, rather than assuming a
    // fixed step count.
    for (let i = 0; i < 5 && (await undoButton.isEnabled()); i++) {
      await undoButton.click();
    }
    await expect(undoButton).toBeDisabled();

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export PDF" }).click();
    const download = await downloadPromise;
    const path = await download.path();
    if (!path) throw new Error("download produced no local path");
    const bytes = readFileSync(path);

    expect(await annotSubtypes(bytes)).not.toContain("FreeText");
  });

  test("free-text annotation survives export when not undone", async ({
    page,
  }) => {
    await openEditor(page);

    await page.getByRole("button", { name: "Add text" }).click();
    const point = await pointOnPage(page, 0, 0.5, 0.2);
    await page.mouse.click(point.x, point.y);
    await page.keyboard.type("Localvert");
    await page.keyboard.press("Escape");

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export PDF" }).click();
    const download = await downloadPromise;
    const path = await download.path();
    if (!path) throw new Error("download produced no local path");
    const bytes = readFileSync(path);

    expect(await annotSubtypes(bytes)).toContain("FreeText");
  });
});
