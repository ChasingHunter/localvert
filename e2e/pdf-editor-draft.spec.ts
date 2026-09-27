import { test as base, expect } from "@playwright/test";

/**
 * End to end against a real built `out/` — same reasoning as
 * `e2e/pdf-editor.spec.ts`. Covers E6b's opt-in local draft autosave: the
 * "Keep a local draft" switch, the 30s save interval (advanced with
 * `page.clock` rather than a real 30s wait), the restore banner on reload,
 * and Discard removing the IndexedDB record.
 */

function fixturePath(name: string): string {
  return `e2e/fixtures/${name}`;
}

interface Fixtures {
  /** Autouse: fails the test if any request left the page's own origin —
   * a local draft must never touch the network. */
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

      expect(
        foreign,
        "no request should ever leave the page's own origin — a draft is IndexedDB-only",
      ).toEqual([]);
    },
    { auto: true },
  ],
});

function pageImage(page: import("@playwright/test").Page, pageIndex = 0) {
  // A bare `img` descendant selector also matches a FreeText annotation's own
  // rendered appearance image (EmbedPDF's `plugin-annotation` renders one
  // several levels deep, alongside its "Insert text" placeholder span) once
  // the page has any annotation on it — the "Restore reopens it" case below
  // does, via the restored draft's own saved annotation. `RenderLayer`'s page
  // image is a direct child of `PagePointerProvider`'s wrapper div (see
  // `pdf-editor-app.tsx`'s `renderPage`), so `> div > img` is unambiguous.
  return page.locator(`[data-page-index="${pageIndex}"] > div > img`);
}

async function openEditor(page: import("@playwright/test").Page) {
  await page.goto("/tools/pdf-editor");
  await page
    .locator('input[type="file"]')
    .setInputFiles(fixturePath("pdf-editor.pdf"));
  await expect(pageImage(page, 0)).toBeVisible({ timeout: 45_000 });
}

/** Reads the one "pdf-editor" draft record straight out of IndexedDB's
 * "localvert" database — the same db/store/key `draft-store.ts` uses. */
async function readDraftRecord(page: import("@playwright/test").Page) {
  return page.evaluate(
    () =>
      new Promise<{ name: string; savedAt: number } | null>(
        (resolve, reject) => {
          const req = indexedDB.open("localvert");
          req.onsuccess = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains("drafts")) {
              resolve(null);
              return;
            }
            const tx = db.transaction("drafts", "readonly");
            const get = tx.objectStore("drafts").get("pdf-editor");
            get.onsuccess = () => {
              const value = get.result as
                | { name: string; savedAt: number }
                | undefined;
              resolve(
                value ? { name: value.name, savedAt: value.savedAt } : null,
              );
            };
            get.onerror = () => reject(get.error);
          };
          req.onerror = () => reject(req.error);
        },
      ),
  );
}

test("turning on autosave, editing and advancing 30s saves a draft; reload offers Restore; Restore reopens it", async ({
  page,
}) => {
  await openEditor(page);

  // Fake the clock BEFORE turning the switch on, so the effect's
  // `setInterval(..., 30_000)` is scheduled against it.
  await page.clock.install();

  await page.getByLabel("Keep a local draft").check();

  await page.getByRole("button", { name: "Add text" }).click();
  const point = await page.locator('[data-page-index="0"]').boundingBox();
  if (!point) throw new Error("page 0 has no bounding box");
  await page.mouse.click(point.x + point.width / 2, point.y + point.height / 4);
  await page.keyboard.type("Localvert draft");
  await page.keyboard.press("Escape");

  await page.clock.fastForward(31_000);

  await expect
    .poll(async () => readDraftRecord(page), {
      message: "a draft record should appear in IndexedDB after 30s",
      timeout: 10_000,
    })
    .not.toBeNull();

  await page.reload();
  await expect(
    page.getByText(/Restore your unsaved draft of .*pdf-editor\.pdf/),
  ).toBeVisible();

  await page.getByRole("button", { name: "Restore" }).click();
  await expect(pageImage(page, 0)).toBeVisible({ timeout: 45_000 });
});

test("Discard removes the draft from IndexedDB", async ({ page }) => {
  await openEditor(page);
  await page.clock.install();
  await page.getByLabel("Keep a local draft").check();

  await page.getByRole("button", { name: "Add text" }).click();
  const point = await page.locator('[data-page-index="0"]').boundingBox();
  if (!point) throw new Error("page 0 has no bounding box");
  await page.mouse.click(point.x + point.width / 2, point.y + point.height / 4);
  await page.keyboard.type("Localvert draft");
  await page.keyboard.press("Escape");
  await page.clock.fastForward(31_000);

  await expect
    .poll(async () => readDraftRecord(page), { timeout: 10_000 })
    .not.toBeNull();

  await page.reload();
  await expect(page.getByText(/Restore your unsaved draft/)).toBeVisible();
  await page.getByRole("button", { name: "Discard" }).click();

  expect(await readDraftRecord(page)).toBeNull();
});
