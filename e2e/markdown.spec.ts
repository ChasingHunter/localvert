import { readFileSync } from "node:fs";
import { test as base, expect } from "@playwright/test";

/**
 * Live end-to-end run of the typst engine (ADR-0011): `location: "r2"`,
 * ~30 MB (compiler wasm + vendored fonts/cmarker), fetched through
 * `wrangler dev`'s local R2 simulation (seeded by `scripts/seed-r2-local.ts`)
 * behind the same download-consent gate `e2e/legacy-video.spec.ts` exercises
 * for ffmpeg — see that file's doc comment for why an r2/consent engine's
 * real exercise lives in e2e rather than a vitest browser test (no local R2
 * route exists outside `wrangler dev`).
 */
function fixturePath(name: string): string {
  return `e2e/fixtures/${name}`;
}

function hasPdfMagic(bytes: Uint8Array): boolean {
  return Buffer.from(bytes).subarray(0, 5).toString("latin1") === "%PDF-";
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

test.describe("markdown to pdf (typst engine, ADR-0011)", () => {
  test("gates the typst download behind consent, then converts a real markdown file to pdf", async ({
    page,
  }) => {
    // Real wasm fetch (~30 MB from local R2 sim) + a real typst compile.
    test.setTimeout(120_000);
    const engineRequests: { url: string; status: number }[] = [];
    page.on("response", (response) => {
      if (response.url().includes("/engines/xl/typst@")) {
        engineRequests.push({ url: response.url(), status: response.status() });
      }
    });

    await page.goto("/tools/markdown-to-pdf");

    await page
      .locator('input[type="file"]')
      .setInputFiles(fixturePath("sample.md"));

    const dialog = page.getByRole("dialog", {
      name: "Download the typst engine?",
    });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Download and convert" }).click();
    await expect(dialog).toBeHidden();

    const downloadLink = page.getByRole("link", { name: "Download" });
    await expect(downloadLink).toBeVisible({ timeout: 60_000 });

    expect(
      engineRequests.length,
      "the typst engine must be fetched from this origin's /engines/xl/ prefix",
    ).toBeGreaterThan(0);
    for (const req of engineRequests) {
      // 206 is a legitimate success here too: a range-capable R2 read.
      expect([200, 206], `${req.url} should succeed`).toContain(req.status);
    }

    const downloadPromise = page.waitForEvent("download");
    await downloadLink.click();
    const download = await downloadPromise;
    const path = await download.path();
    if (!path) throw new Error("download produced no local path");
    expect(hasPdfMagic(readFileSync(path))).toBe(true);
  });
});
