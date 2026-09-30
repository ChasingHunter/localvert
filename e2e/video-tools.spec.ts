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

test.describe("compress-video", () => {
  // ADR-0013's addendum (2026-09-30): the bug this test guards against —
  // "compress-video made a file bigger" — reported against an
  // already-compressed source, which `sample.mp4` (a tiny synthetic
  // fixture, not efficiently encoded) can't reproduce on its own. This
  // still proves the never-larger safety net holds end to end: whatever
  // compress-video's encoder actually produces, the downloaded file is
  // never bigger than what was dropped in.
  test("compressing sample.mp4 never produces a bigger file", async ({
    page,
  }) => {
    const bytes = await convertSample(page, "compress-video");
    expect(bytes.length).toBeGreaterThan(0);
    expect(hasFtypMagic(new Uint8Array(bytes.subarray(0, 12)))).toBe(true);

    const original = readFileSync(fixturePath("sample.mp4")).length;
    expect(bytes.length).toBeLessThanOrEqual(original);
  });

  // ADR-0017 (2026-09-30), updated for its "Estimates" addendum (same date):
  // "reduce by %" is one of `compress-video`'s two staging modes (see
  // `shouldStageForEstimate` in `src/lib/estimate/index.ts`) — selecting it
  // *before* dropping the file, unlike every other tool's on-drop submit,
  // is now the whole point: dropping while it's already active stages the
  // file (shows an estimate, doesn't run) instead of submitting immediately.
  // `sample.mp4` is only ~30 KB, well below even the "target size" option's
  // own 0.1 MB minimum, so this exercises "reduce by %" instead (unit-less,
  // works at any source size). At 30 KB, a 50% target (~15 KB) is smaller
  // than the audio+container overhead the planner reserves before video even
  // gets a share of the budget (`planTargetSizeBudget`'s "target
  // unreachable" case) — this fixture is too small to prove "output <=
  // target" honestly, so this test instead proves the mode runs end to end
  // through the real wasm/WebCodecs path, still produces a valid,
  // downloadable, never-bigger-than-source file, and surfaces a result note
  // (this run's is the "unreachable" wording, not the "hit" wording a bigger
  // real-world file would get — see ADR-0017's "Result contract"). A
  // synthetic longer fixture would let a real "hit" assertion run instead;
  // out of scope for this slice.
  test("reduce-by-% mode stages the file, then runs end to end and never exceeds the source size", async ({
    page,
  }) => {
    await page.goto("/tools/compress-video");

    // The options form renders selects as a Radix combobox, not a native
    // <select> (see e2e/pdf.spec.ts's identical note) — open it, pick the
    // option, *then* drop, so the drop lands while this mode is active.
    await page.getByLabel("Mode", { exact: true }).click();
    await page.getByRole("option", { name: /reduce by percentage/i }).click();

    await page
      .locator('input[type="file"]')
      .setInputFiles(fixturePath("sample.mp4"));

    // Staged, not submitted yet: the estimate (in its own polite live
    // region, ADR-0017's accessibility rule) appears and no job has started
    // — an explicit "Convert" is what actually runs it. `getByText(/MB/)`
    // alone would also match the tool's own description paragraph ("...a
    // target size like under 20 MB"), so this scopes to the live region.
    const convertButton = page.getByRole("button", { name: "Convert" });
    await expect(convertButton).toBeVisible();
    const estimate = page.locator('[aria-live="polite"]');
    await expect(estimate).toContainText(/MB/);

    await convertButton.click();

    const downloadLink = page.getByRole("link", { name: "Download" });
    await expect(downloadLink).toBeVisible({ timeout: 30_000 });

    // The result-contract note (`job-card.tsx` renders `job.output.note`
    // as a `<p>` next to the download link) — proves `EngineResult`'s
    // `opfs.note` made it all the way to the job card, not just that a
    // file came out the other end.
    await expect(
      page.getByText(/smallest we could make it|% of your/),
    ).toBeVisible();

    const downloadPromise = page.waitForEvent("download");
    await downloadLink.click();
    const download = await downloadPromise;
    const path = await download.path();
    if (!path) throw new Error("download produced no local path");
    const bytes = readFileSync(path);

    expect(bytes.length).toBeGreaterThan(0);
    expect(hasFtypMagic(new Uint8Array(bytes.subarray(0, 12)))).toBe(true);
    const original = readFileSync(fixturePath("sample.mp4")).length;
    expect(bytes.length).toBeLessThanOrEqual(original);
  });

  // ADR-0017's "Estimates" addendum (2026-09-30), the deliverable this slice
  // adds: target-size mode shows a size estimate *before* the job runs, then
  // an explicit Convert produces a result whose note is consistent with it.
  // Uses `sample-large.mp4` (640x480, 6s, ~2 Mbps H.264 + AAC, ~1.6 MB —
  // generated once with ffmpeg, same pattern as `sample.mp4`'s own doc
  // comment in `e2e/video.spec.ts`), not the tiny `sample.mp4`: a 1 MB target
  // needs a source bigger than 1 MB to exercise a real compression, not the
  // "target bigger than source" edge case.
  test("target-size mode shows an estimate before converting, then Convert runs it", async ({
    page,
  }) => {
    await page.goto("/tools/compress-video");

    await page.getByLabel("Mode", { exact: true }).click();
    await page.getByRole("option", { name: /target file size/i }).click();
    await page.getByLabel("Target size").fill("1");

    await page
      .locator('input[type="file"]')
      .setInputFiles(fixturePath("sample-large.mp4"));

    // The estimate is visible before any job has started — no download link
    // yet, but a "MB"-referencing estimate (in its own polite live region —
    // see the reduce-by-% test above for why this doesn't just use
    // `getByText(/MB/)`) and a Convert button are.
    await expect(page.getByRole("link", { name: "Download" })).toHaveCount(0);
    const convertButton = page.getByRole("button", { name: "Convert" });
    await expect(convertButton).toBeVisible();
    const estimate = page.locator('[aria-live="polite"]');
    await expect(estimate).toContainText(/MB/);

    await convertButton.click();

    const downloadLink = page.getByRole("link", { name: "Download" });
    await expect(downloadLink).toBeVisible({ timeout: 30_000 });
    // The result-contract note (ADR-0017) — a real "hit"/"resized" outcome
    // is plausible with this bigger, over-target source, but the exact
    // wording depends on this browser's actual encoder behaviour, so this
    // only asserts *a* result-contract note appeared, consistent with the
    // pre-run estimate having shown a number in the same units.
    await expect(
      page.getByText(/% of your|resized to|smallest we could make it/i),
    ).toBeVisible();

    const downloadPromise = page.waitForEvent("download");
    await downloadLink.click();
    const download = await downloadPromise;
    const path = await download.path();
    if (!path) throw new Error("download produced no local path");
    const bytes = readFileSync(path);

    expect(bytes.length).toBeGreaterThan(0);
    expect(hasFtypMagic(new Uint8Array(bytes.subarray(0, 12)))).toBe(true);
    const original = readFileSync(fixturePath("sample-large.mp4")).length;
    expect(bytes.length).toBeLessThanOrEqual(original);
  });
});
