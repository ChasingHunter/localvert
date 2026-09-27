import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test as base, expect } from "@playwright/test";

/**
 * End to end against a real built `out/` — see jpg-to-png.spec.ts's doc
 * comment for why (wrangler dev + real `_headers`). Every test here
 * re-verifies the product's core promise (files never leave the browser) in
 * addition to whatever behaviour it's actually testing.
 *
 * `e2e/fixtures/sample.csv` exists for when a csv-accepting tool ships (see
 * this slice's own commit message / the planner's notes: `csv` has no
 * reliable magic-byte signature, so `FORMATS.csv` and any csv conversion
 * tool are blocked on a registry change — an extension-only accept path
 * `classifyFiles` doesn't have yet — not on anything in this file).
 * These tests exercise the two data tools that do ship this slice:
 * json-to-xlsx and xlsx-to-json, run back to back so the second's input is
 * the first's real output, round-tripping `sample.json` through an actual
 * xlsx file.
 */
const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];

function hasZipSignature(bytes: Uint8Array): boolean {
  return ZIP_SIGNATURE.every((b, i) => bytes[i] === b);
}

function fixturePath(name: string): string {
  return `e2e/fixtures/${name}`;
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

test.describe
  .serial("data tools", () => {
    // Populated by the first test, consumed by the second — see the module
    // doc comment on why these two run back to back instead of independently.
    let xlsxPath = "";

    test("json-to-xlsx converts sample.json to a real xlsx file", async ({
      page,
    }) => {
      await page.goto("/tools/json-to-xlsx");

      await page
        .locator('input[type="file"]')
        .setInputFiles(fixturePath("sample.json"));

      const downloadLink = page.getByRole("link", { name: "Download" });
      await expect(downloadLink).toBeVisible({ timeout: 15_000 });

      const downloadPromise = page.waitForEvent("download");
      await downloadLink.click();
      const download = await downloadPromise;
      const path = await download.path();
      if (!path) throw new Error("download produced no local path");
      const bytes = readFileSync(path);

      // xlsx is a ZIP container — see FORMATS.xlsx's magic comment in
      // src/lib/registry/formats.ts.
      expect(hasZipSignature(bytes)).toBe(true);

      xlsxPath = join(tmpdir(), "localvert-e2e-sample.xlsx");
      writeFileSync(xlsxPath, bytes);
    });

    test("xlsx-to-json converts that xlsx back to the original JSON", async ({
      page,
    }) => {
      expect(xlsxPath, "the json-to-xlsx test must run first").not.toBe("");

      await page.goto("/tools/xlsx-to-json");

      await page.locator('input[type="file"]').setInputFiles(xlsxPath);

      const downloadLink = page.getByRole("link", { name: "Download" });
      await expect(downloadLink).toBeVisible({ timeout: 15_000 });

      const downloadPromise = page.waitForEvent("download");
      await downloadLink.click();
      const download = await downloadPromise;
      const path = await download.path();
      if (!path) throw new Error("download produced no local path");
      const json = JSON.parse(readFileSync(path, "utf8"));

      const original = JSON.parse(
        readFileSync(fixturePath("sample.json"), "utf8"),
      );
      expect(json).toEqual(original);
    });
  });
