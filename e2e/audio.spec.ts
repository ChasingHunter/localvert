import { readFileSync } from "node:fs";
import { test as base, expect } from "@playwright/test";

/**
 * End to end against a real built `out/` — see e2e/jpg-to-png.spec.ts's doc
 * comment for why. Covers Phase 3b's `extract-audio` on the `mediabunny`
 * engine: a real transcode (AAC audio, discarding the video track) through
 * a real dedicated worker, producing a downloadable MP3 — not just the
 * in-vitest coverage in src/lib/engines/mediabunny/audio.browser.test.ts.
 *
 * `e2e/fixtures/sample.mp4` (320x240, 2s, H.264 + AAC, ~30KB) is the same
 * fixture e2e/video.spec.ts uses — it already carries an AAC audio track.
 */
const ID3_MAGIC = [0x49, 0x44, 0x33]; // "ID3"
const MPEG_FRAME_SYNCS = [
  [0xff, 0xfb],
  [0xff, 0xf3],
  [0xff, 0xf2],
  [0xff, 0xfa],
];

function hasMagic(bytes: Uint8Array, magic: readonly number[]): boolean {
  return magic.every((b, i) => bytes[i] === b);
}

function isMp3(bytes: Uint8Array): boolean {
  return (
    hasMagic(bytes, ID3_MAGIC) ||
    MPEG_FRAME_SYNCS.some((sync) => hasMagic(bytes, sync))
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

test.describe("extract-audio", () => {
  test("extracts a dropped MP4's audio track as a valid, downloadable MP3", async ({
    page,
  }) => {
    await page.goto("/tools/extract-audio");

    await page
      .locator('input[type="file"]')
      .setInputFiles(fixturePath("sample.mp4"));

    const downloadLink = page.getByRole("link", { name: "Download" });
    // A real transcode (demux -> decode -> re-encode as MP3, discarding
    // video) is slower than the image-pipeline tools this timeout was
    // copied from — generous but still well under the suite's patience for
    // a 2s, 320x240 source.
    await expect(downloadLink).toBeVisible({ timeout: 30_000 });

    const downloadPromise = page.waitForEvent("download");
    await downloadLink.click();
    const download = await downloadPromise;

    expect(download.suggestedFilename().endsWith(".mp3")).toBe(true);

    const path = await download.path();
    if (!path) throw new Error("download produced no local path");
    const bytes = readFileSync(path);

    expect(bytes.length).toBeGreaterThan(256);
    expect(isMp3(new Uint8Array(bytes.subarray(0, 4)))).toBe(true);
  });
});
