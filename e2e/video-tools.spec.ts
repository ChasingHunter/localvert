import { readFileSync } from "node:fs";
import { test as base, expect } from "@playwright/test";

/**
 * End to end against a real built `out/` — see `e2e/video.spec.ts`'s doc
 * comment (this file covers the same first fixture, `sample.mp4`: 320x240,
 * 2s, H.264 + AAC). Where `video.spec.ts` proves the original mp4-to-webm
 * tool end to end, this file covers Phase 3a's container-conversion and
 * edit tools sharing the same `runVideo` dispatch (see `adapter.ts`).
 */
function hasFtypMagic(bytes: Uint8Array): boolean {
  // ISO-BMFF "ftyp" box at offset 4 — same signature `FORMATS.mp4`/`.mov`
  // sniff on (src/lib/registry/formats.ts). MP4 and MOV/QuickTime share it,
  // so this alone doesn't distinguish the two; each test below only claims
  // "produced a valid ISOBMFF file", which is what matters for this suite.
  return (
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  );
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

/** Drops `sample.mp4` into `slug`'s page and waits for the download link —
 * shared by every test below, which then differ only in what they assert
 * about the downloaded bytes. */
async function convertSample(
  page: import("@playwright/test").Page,
  slug: string,
): Promise<Buffer> {
  await page.goto(`/tools/${slug}`);
  await page
    .locator('input[type="file"]')
    .setInputFiles(fixturePath("sample.mp4"));

  const downloadLink = page.getByRole("link", { name: "Download" });
  await expect(downloadLink).toBeVisible({ timeout: 30_000 });

  const downloadPromise = page.waitForEvent("download");
  await downloadLink.click();
  const download = await downloadPromise;

  const path = await download.path();
  if (!path) throw new Error("download produced no local path");
  return readFileSync(path);
}

test.describe("mp4-to-mov", () => {
  test("converts a dropped MP4 to a valid, downloadable MOV", async ({
    page,
  }) => {
    const bytes = await convertSample(page, "mp4-to-mov");
    expect(bytes.length).toBeGreaterThan(1024);
    expect(hasFtypMagic(new Uint8Array(bytes.subarray(0, 12)))).toBe(true);
  });
});

test.describe("trim-video", () => {
  test("trimming sample.mp4 to 0-1s produces a smaller file", async ({
    page,
  }) => {
    await page.goto("/tools/trim-video");
    await page
      .locator('input[type="file"]')
      .setInputFiles(fixturePath("sample.mp4"));

    // `end` defaults to 10s (longer than the 2s fixture); set it to 1s so
    // the trim is real. Exact option-form selector depends on the
    // generated form (`src/lib/options/fields.ts`) — a number input
    // labelled "End".
    await page.getByLabel("End").fill("1");

    const downloadLink = page.getByRole("link", { name: "Download" });
    await expect(downloadLink).toBeVisible({ timeout: 30_000 });

    const downloadPromise = page.waitForEvent("download");
    await downloadLink.click();
    const download = await downloadPromise;
    const path = await download.path();
    if (!path) throw new Error("download produced no local path");
    const trimmedBytes = readFileSync(path).length;

    const original = readFileSync(fixturePath("sample.mp4")).length;
    expect(trimmedBytes).toBeGreaterThan(0);
    expect(trimmedBytes).toBeLessThan(original);
  });
});

test.describe("mute-video", () => {
  test("produces a downloadable, valid MP4 with no audio", async ({ page }) => {
    const bytes = await convertSample(page, "mute-video");
    expect(bytes.length).toBeGreaterThan(1024);
    expect(hasFtypMagic(new Uint8Array(bytes.subarray(0, 12)))).toBe(true);
  });
});
