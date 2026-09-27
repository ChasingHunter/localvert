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
 * The json-to-xlsx/xlsx-to-json pair runs back to back so the second's
 * input is the first's real output, round-tripping `sample.json` through an
 * actual xlsx file. csv-to-json and json-to-csv exercise `e2e/fixtures/
 * sample.csv` — `csv` is a `text` format (no magic bytes, identified by
 * extension — see docs/ENGINES.md's note on the `data` engine), which is
 * exactly what a real browser `<input type="file">` drop needs to prove:
 * a node-side unit test can inject its own sniff, this can't.
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

    test("csv-to-json converts sample.csv to parsed JSON", async ({ page }) => {
      await page.goto("/tools/csv-to-json");

      await page
        .locator('input[type="file"]')
        .setInputFiles(fixturePath("sample.csv"));

      const downloadLink = page.getByRole("link", { name: "Download" });
      await expect(downloadLink).toBeVisible({ timeout: 15_000 });

      const downloadPromise = page.waitForEvent("download");
      await downloadLink.click();
      const download = await downloadPromise;
      const path = await download.path();
      if (!path) throw new Error("download produced no local path");
      const json = JSON.parse(readFileSync(path, "utf8"));

      expect(json).toEqual([
        { name: "Ada", age: 36 },
        { name: "Grace", age: 85 },
      ]);
    });

    test("json-to-csv converts sample.json to a CSV file", async ({ page }) => {
      await page.goto("/tools/json-to-csv");

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
      const csv = readFileSync(path, "utf8");

      expect(csv).toBe("name,age\r\nAda,36\r\nGrace,85");
    });
  });
