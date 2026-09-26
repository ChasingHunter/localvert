import { readFileSync } from "node:fs";
import { test as base, expect } from "@playwright/test";

/**
 * End to end against a real built `out/` — see `e2e/jpg-to-png.spec.ts`'s
 * doc comment for why. Covers the product's other core promise: a tool you
 * already opened keeps converting even with no network at all (the
 * `/offline` fallback and Serwist SW in `src/sw.ts` exist for exactly
 * this).
 *
 * `png-to-jpg` is deliberately the tool under test here rather than
 * `jpg-to-png`: it resolves to the `jsquash-png`/`jsquash-jpeg` wasm
 * engines (see that tool file's doc comment), so a real conversion fetches
 * `/engines/*` assets through the SW's `CacheFirst` runtime handler —
 * `jpg-to-png`'s canvas-only pipeline never touches `/engines/` at all, so
 * it wouldn't actually exercise engine caching offline.
 *
 * `e2e/fixtures/not-a-jpg.png` (used elsewhere as a "wrong format" fixture)
 * is a real, tiny PNG — perfectly good input here.
 */
const PNG_FIXTURE = "e2e/fixtures/not-a-jpg.png";
const JPG_SIGNATURE = [0xff, 0xd8, 0xff];

function hasJpgSignature(bytes: Uint8Array): boolean {
  return JPG_SIGNATURE.every((b, i) => bytes[i] === b);
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

async function convertAndDownload(page: import("@playwright/test").Page) {
  await page.locator('input[type="file"]').setInputFiles(PNG_FIXTURE);

  const downloadLink = page.getByRole("link", { name: "Download" });
  await expect(downloadLink).toBeVisible({ timeout: 20_000 });

  const downloadPromise = page.waitForEvent("download");
  await downloadLink.click();
  const download = await downloadPromise;
  const path = await download.path();
  if (!path) throw new Error("download produced no local path");
  return readFileSync(path);
}

test.describe("offline", () => {
  test("a tool already opened online still converts with the network cut", async ({
    page,
    context,
  }) => {
    await page.goto("/tools/png-to-jpg");

    // Reload once so the SW installed by the first load is the one
    // *controlling* this page — a controlled page is what makes its own
    // subresource fetches (including the jsquash engine's /engines/*
    // assets below) go through the SW's runtime caching at all. See
    // `e2e/jpg-to-png.spec.ts`'s equivalent comment.
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    const controlled = await page.evaluate(
      () => !!navigator.serviceWorker.controller,
    );
    expect(controlled).toBe(true);

    // Online run: exercises the real engine fetch, which the SW's
    // `CacheFirst` handler (src/sw.ts) caches as a side effect.
    const onlineBytes = await convertAndDownload(page);
    expect(hasJpgSignature(onlineBytes)).toBe(true);
    expect(onlineBytes.length).toBeGreaterThan(0);

    await context.setOffline(true);
    try {
      // The page itself is precached app shell — served from the SW's
      // precache even though the navigate route handler is `NetworkOnly`
      // (see src/sw.ts's doc comment: only a route *not* in the precache
      // list falls through to the offline fallback).
      await page.reload();
      await expect(page.locator('input[type="file"]')).toBeVisible();

      const offlineBytes = await convertAndDownload(page);
      expect(hasJpgSignature(offlineBytes)).toBe(true);
      expect(offlineBytes.length).toBeGreaterThan(0);

      // A route with no precache entry at all falls through to the
      // precached /offline page once the network fetch fails.
      await page.goto("/this-route-was-never-built-xyz");
      await expect(
        page.getByRole("heading", { name: "You're offline" }),
      ).toBeVisible();
    } finally {
      await context.setOffline(false);
    }
  });
});
