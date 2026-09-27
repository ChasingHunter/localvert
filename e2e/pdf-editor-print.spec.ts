import { test as base, expect } from "@playwright/test";

/**
 * End to end against a real built `out/` — same reasoning as
 * `e2e/pdf-editor.spec.ts`. Covers E6b's Print button: `window.print` is
 * stubbed via `addInitScript` (Playwright/Chromium never actually opens a
 * print dialog), so this checks the mechanism `handlePrint`
 * (`pdf-editor-app.tsx`) is responsible for — a `#pdf-editor-print-sheets`
 * container with one `<img>` per page, appended to `<body>` before
 * `window.print()` is called, and torn down again on `afterprint`.
 */

function fixturePath(name: string): string {
  return `e2e/fixtures/${name}`;
}

interface Fixtures {
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
        "no request should ever leave the page's own origin",
      ).toEqual([]);
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

test("clicking Print renders both pages into the print container and calls window.print", async ({
  page,
}) => {
  await page.addInitScript(() => {
    // @ts-expect-error — test-only counter read back below.
    window.__printCalls = 0;
    window.print = () => {
      // @ts-expect-error — same counter.
      window.__printCalls += 1;
    };
  });

  await openEditor(page);
  await page.getByRole("button", { name: "Print" }).click();

  // `pdf-editor.pdf` is the 2-page fixture (see pdf-editor.spec.ts's doc
  // comment) — `handlePrint` renders one `<img>` per page.
  await expect(page.locator("#pdf-editor-print-sheets img")).toHaveCount(2, {
    timeout: 15_000,
  });

  const printCalls = await page.evaluate(
    // @ts-expect-error — test-only counter set above.
    () => window.__printCalls as number,
  );
  expect(printCalls).toBe(1);
});
