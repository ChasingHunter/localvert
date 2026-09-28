import { readFileSync } from "node:fs";
import { test as base, expect } from "@playwright/test";

/**
 * First live end-to-end run of the ADR-0002 GPL/r2 path: the ffmpeg engine
 * (`location: "r2"`, ~31 MB, GPL-2.0-or-later), fetched through
 * `wrangler dev`'s local R2 simulation (seeded by `scripts/seed-r2-local.ts`),
 * behind the download-consent gate `src/lib/engines/consent.ts` and
 * `tool-runner.tsx`'s `ensureConsent` add in front of it.
 *
 * `e2e/fixtures/sample.avi`/`sample.flv` (both under 200 KB) were generated
 * once with ffmpeg's `testsrc`/`sine` lavfi sources and committed, the same
 * pattern as `sample.mp4` in `e2e/video.spec.ts`.
 */
function fixturePath(name: string): string {
  return `e2e/fixtures/${name}`;
}

/** MP4's `ftyp` box sits a few bytes into the file (after the box's own
 * 4-byte size) — same "contains the magic bytes" check as `hasEbmlMagic` in
 * e2e/video.spec.ts, just searched rather than at a fixed offset since an
 * ffmpeg-muxed mp4 doesn't guarantee `ftyp` is the very first box. */
function hasFtyp(bytes: Uint8Array): boolean {
  return Buffer.from(bytes).includes("ftyp");
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

test.describe("ffmpeg download consent (ADR-0002 rule 4)", () => {
  test("gates the ffmpeg download behind consent, then remembers it across tools", async ({
    page,
  }) => {
    // This one test walks the whole gate end to end — decline, re-fetch, two
    // real ffmpeg transcodes, then a third tool reusing stored consent — so
    // it needs more room than Playwright's 30s default (see the per-step
    // 60s waits below, generous for a real wasm fetch + transcode).
    test.setTimeout(180_000);
    // Same-origin fetches of the r2-backed engine, tracked separately from
    // `privacyGuard` (which only fails on a *foreign* origin) so this test
    // can assert the actual wasm request happened and succeeded.
    const engineRequests: { url: string; status: number }[] = [];
    page.on("response", (response) => {
      if (response.url().includes("/engines/xl/ffmpeg@")) {
        engineRequests.push({ url: response.url(), status: response.status() });
      }
    });

    await page.goto("/tools/avi-to-mp4");

    // First drop: no consent stored yet — the dialog must appear before
    // anything downloads.
    await page
      .locator('input[type="file"]')
      .setInputFiles(fixturePath("sample.avi"));

    const dialog = page.getByRole("dialog", {
      name: "Download FFmpeg to convert this file?",
    });
    await expect(dialog).toBeVisible();

    // Cancel: the file must stay un-run, with a visible status and no
    // download ever offered for it.
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await expect(
      page.getByText("Not converted. FFmpeg wasn't downloaded."),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Download" })).toHaveCount(0);

    // Drop again: still no stored consent, so the dialog asks again.
    await page
      .locator('input[type="file"]')
      .setInputFiles(fixturePath("sample.avi"));
    await expect(dialog).toBeVisible();

    // ADR-0016: initial focus lands on the primary action, not the first
    // focusable element in DOM order (the "Upstream source" link) — hitting
    // Enter right after the dialog opens must download, not follow a link.
    await expect(
      dialog.getByRole("button", { name: "Download and convert" }),
    ).toBeFocused();

    // Download and convert: grants consent, fetches the engine from R2, and
    // runs the actual transcode.
    await dialog.getByRole("button", { name: "Download and convert" }).click();
    await expect(dialog).toBeHidden();

    const downloadLink = page.getByRole("link", { name: "Download" });
    // Real ffmpeg init (fetch ~31MB from local R2 sim, instantiate wasm) plus
    // a real transcode — generous but still well under the suite's patience.
    await expect(downloadLink).toBeVisible({ timeout: 60_000 });

    expect(
      engineRequests.length,
      "the ffmpeg engine must be fetched from this origin's /engines/xl/ prefix",
    ).toBeGreaterThan(0);
    for (const req of engineRequests) {
      // 206 is a legitimate success here too: the browser's wasm streaming
      // fetch (or a range-capable R2 read) can ask for a partial range.
      expect([200, 206], `${req.url} should succeed`).toContain(req.status);
    }

    const firstDownload = await (async () => {
      const downloadPromise = page.waitForEvent("download");
      await downloadLink.click();
      return downloadPromise;
    })();
    const firstPath = await firstDownload.path();
    if (!firstPath) throw new Error("download produced no local path");
    expect(hasFtyp(readFileSync(firstPath))).toBe(true);

    // Drop a third time: consent is already stored for this engine version —
    // no dialog, straight to conversion.
    await page
      .locator('input[type="file"]')
      .setInputFiles(fixturePath("sample.avi"));
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("link", { name: "Download" })).toHaveCount(2, {
      timeout: 60_000,
    });

    // A different tool, same engine: consent is per-engine (not per-tool),
    // so flv-to-mp4 also gets no dialog once ffmpeg is already granted.
    await page.goto("/tools/flv-to-mp4");
    await page
      .locator('input[type="file"]')
      .setInputFiles(fixturePath("sample.flv"));
    await expect(page.getByRole("dialog")).toHaveCount(0);

    const flvDownloadLink = page.getByRole("link", { name: "Download" });
    await expect(flvDownloadLink).toBeVisible({ timeout: 60_000 });
    const flvDownload = await (async () => {
      const downloadPromise = page.waitForEvent("download");
      await flvDownloadLink.click();
      return downloadPromise;
    })();
    const flvPath = await flvDownload.path();
    if (!flvPath) throw new Error("download produced no local path");
    expect(hasFtyp(readFileSync(flvPath))).toBe(true);
  });
});
