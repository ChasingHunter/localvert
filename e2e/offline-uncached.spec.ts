import { test as base, expect } from "@playwright/test";

/**
 * End to end against a real built `out/` — see `e2e/jpg-to-png.spec.ts`'s
 * doc comment for why. Covers the bug fixed by `src/lib/workers/engine-
 * host.ts`'s idle-timeout wrapping (see `idle-timeout.ts`,
 * `engine-load-error.ts`): offline, on a converter whose engine was never
 * fetched (so the SW's `CacheFirst` `/engines/*` cache — src/sw.ts — has
 * nothing to serve), the job used to sit on "Loading…" forever. It must now
 * fail fast with a clear, actionable message instead.
 *
 * `png-to-jpg` (same tool `offline.spec.ts` uses) resolves to the
 * `jsquash-png`/`jsquash-jpeg` engines, which really do fetch `/engines/*`
 * assets — unlike a canvas-only tool, which would never touch the network at
 * all and so couldn't exercise this hang either way.
 *
 * The critical difference from `offline.spec.ts`: this spec never runs a
 * conversion while online, so the engine's wasm is never fetched — let alone
 * cached — before the network is cut. `offline.spec.ts` warms the engine
 * cache on purpose; this one deliberately doesn't.
 */
const PNG_FIXTURE = "e2e/fixtures/not-a-jpg.png";

interface Fixtures {
  /** Autouse: fails the test if any request left the page's own origin. */
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
        "no request should ever leave the page's own origin — files never leave the browser",
      ).toEqual([]);
    },
    { auto: true },
  ],
});

test.describe("offline + never-cached engine", () => {
  test("shows a clear offline error instead of hanging on Loading…", async ({
    page,
    context,
  }) => {
    await page.goto("/tools/png-to-jpg");

    // Reload once so the SW installed by the first load is the one
    // *controlling* this page — same reasoning as `offline.spec.ts`. This
    // caches the app shell (and the page's own route), but — unlike
    // `offline.spec.ts` — no conversion runs here yet, so `/engines/*` is
    // never fetched and the jsquash engine stays uncached.
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    const controlled = await page.evaluate(
      () => !!navigator.serviceWorker.controller,
    );
    expect(controlled).toBe(true);

    await context.setOffline(true);
    try {
      // The page itself is precached app shell, so it still opens offline.
      await expect(page.locator('input[type="file"]')).toBeVisible();

      await page.locator('input[type="file"]').setInputFiles(PNG_FIXTURE);

      // The bug: this job would previously sit on "Converting…" forever
      // (`src/components/job-card.tsx`'s label for `status: "running"`),
      // because a stalled/never-settling `/engines/*` fetch had nothing
      // racing it. It must now settle — as a visible error, not a spinner —
      // well within this window (the idle timeout itself is 60s; offline,
      // the underlying fetch fails immediately, so this should be quick).
      await expect(
        page.getByText(
          "This converter needs a one-time download and you're offline. Connect once and it will work offline afterwards.",
        ),
      ).toBeVisible({ timeout: 10_000 });

      // Never a lingering "Converting…" once the error has appeared.
      await expect(page.getByText("Converting…")).not.toBeVisible();
    } finally {
      await context.setOffline(false);
    }
  });
});
