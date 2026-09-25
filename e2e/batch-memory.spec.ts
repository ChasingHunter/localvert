import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { unzipSync } from "fflate";

/**
 * Guards Localvert's real promise under load, not just correctness: a batch
 * of realistically-sized photos should convert without the main thread's JS
 * heap ballooning. Per ADR-0007, a raster pipeline holds one full RGBA frame
 * per in-flight job, not per batch, so peak main-thread memory should stay
 * bounded regardless of batch size — the worker pool, not the main thread,
 * does the decode/encode work, and the main thread should only be holding
 * Blobs and object URLs (which live outside the JS heap). This is the one
 * place that bound gets a real number attached to it.
 *
 * Slow — 50 real conversions plus in-browser fixture generation — and not
 * part of the default `pnpm e2e` run. Tagged `@slow` for discoverability,
 * but the actual gate is the `test.skip` below: this slice's brief
 * deliberately doesn't touch `playwright.config.ts`, so there is no
 * `grepInvert` wired up to the tag yet. Run explicitly with
 * `E2E_SLOW=1 pnpm e2e batch-memory`. See docs/TESTING.md.
 */

const BATCH_SIZE = 50;
const WIDTH = 1600;
const HEIGHT = 1200;
const MAX_MAIN_THREAD_HEAP_BYTES = 400 * 1024 * 1024;
const HEAP_POLL_INTERVAL_MS = 500;

interface GetMetricsResult {
  metrics: { name: string; value: number }[];
}

/**
 * Generates `count` distinct "noisy" JPEGs entirely in the browser via
 * OffscreenCanvas — no fixture files, no network. Each pixel comes from a
 * cheap per-image formula (the same shape as the existing adapter tests'
 * `noisySourceJpeg` helpers — e.g. `../src/lib/engines/canvas/
 * adapter.browser.test.ts` — scaled up to a real photo resolution) rather
 * than true random noise: fast enough to generate 50 of these in one
 * `page.evaluate` call, and — because it has structure a codec can exploit,
 * unlike incompressible white noise — lands in a realistic photo size range
 * once JPEG-encoded, instead of an unrealistic worst case.
 */
async function generateNoisyJpegs(
  page: Page,
  count: number,
  width: number,
  height: number,
): Promise<{ name: string; mimeType: string; buffer: Buffer }[]> {
  const base64Files = await page.evaluate(
    async ({ count, width, height }) => {
      const results: string[] = [];
      for (let i = 0; i < count; i++) {
        const canvas = new OffscreenCanvas(width, height);
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("no 2d context in test setup");

        const imageData = ctx.createImageData(width, height);
        const data = imageData.data;
        const seed = i * 97;
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * 4;
            data[idx] = (x * 7 + seed) % 256;
            data[idx + 1] = (y * 13 + seed) % 256;
            data[idx + 2] = (x + y + seed) % 256;
            data[idx + 3] = 255;
          }
        }
        ctx.putImageData(imageData, 0, 0);

        const blob = await canvas.convertToBlob({
          type: "image/jpeg",
          quality: 0.85,
        });
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let binary = "";
        for (let b = 0; b < bytes.length; b++) {
          binary += String.fromCharCode(bytes[b] ?? 0);
        }
        results.push(btoa(binary));
      }
      return results;
    },
    { count, width, height },
  );

  return base64Files.map((base64, i) => ({
    name: `photo-${i}.jpg`,
    mimeType: "image/jpeg",
    buffer: Buffer.from(base64, "base64"),
  }));
}

/**
 * `performance.measureUserAgentSpecificMemory` is still an experimental,
 * cross-origin-isolation-gated API — not in lib.dom.d.ts, and not available
 * in every browser. Declared locally rather than widening a shared type.
 */
interface MemoryMeasurement {
  bytes: number;
}
interface PerformanceWithMemoryMeasurement extends Performance {
  measureUserAgentSpecificMemory?: () => Promise<MemoryMeasurement>;
}

test("batch-converts 50 JPGs to PNG and stays under the main-thread heap budget", {
  tag: "@slow",
}, async ({ page }) => {
  test.skip(
    !process.env.E2E_SLOW,
    "slow batch-memory test — set E2E_SLOW=1 to run it",
  );

  // CDP session for `Performance.getMetrics`, the only way to read the
  // real JS heap from outside the page. Started before the batch so the
  // very first samples (fixture generation, upload) count toward the
  // peak too, not just the conversions themselves.
  const client = await page.context().newCDPSession(page);
  await client.send("Performance.enable");

  let peakHeapBytes = 0;
  let polling = true;
  const pollLoop = (async () => {
    while (polling) {
      try {
        const { metrics } = (await client.send(
          "Performance.getMetrics",
        )) as GetMetricsResult;
        const used = metrics.find((m) => m.name === "JSHeapUsedSize")?.value;
        if (typeof used === "number" && used > peakHeapBytes) {
          peakHeapBytes = used;
        }
      } catch {
        // Transient — e.g. a sample landing during navigation. A missed
        // sample doesn't matter when the peak is taken over many.
      }
      await new Promise((resolve) =>
        setTimeout(resolve, HEAP_POLL_INTERVAL_MS),
      );
    }
  })();

  await page.goto("/tools/jpg-to-png");

  const files = await generateNoisyJpegs(page, BATCH_SIZE, WIDTH, HEIGHT);
  await page.locator('input[type="file"]').setInputFiles(files);

  await expect(page.getByRole("link", { name: "Download" })).toHaveCount(
    BATCH_SIZE,
    { timeout: 120_000 },
  );

  const agentMemoryBytes = await page.evaluate(async () => {
    const perf = performance as PerformanceWithMemoryMeasurement;
    if (
      !self.crossOriginIsolated ||
      typeof perf.measureUserAgentSpecificMemory !== "function"
    ) {
      return null;
    }
    // The API can exist yet throw SecurityError (e.g. headless Chromium
    // without the feature enabled). It's informational only, so treat any
    // failure as "unavailable" rather than failing the memory test.
    try {
      const result = await perf.measureUserAgentSpecificMemory();
      return result.bytes;
    } catch {
      return null;
    }
  });

  const downloadAll = page.getByRole("button", {
    name: "Download all (.zip)",
  });
  await expect(downloadAll).toBeEnabled();

  const downloadPromise = page.waitForEvent("download");
  await downloadAll.click();
  const download = await downloadPromise;
  const path = await download.path();
  if (!path) throw new Error("download produced no local path");
  const zipBytes = readFileSync(path);

  const entries = unzipSync(zipBytes);
  expect(Object.keys(entries)).toHaveLength(BATCH_SIZE);

  polling = false;
  await pollLoop;

  console.warn(
    `[batch-memory] peak main-thread JS heap: ${(
      peakHeapBytes / (1024 * 1024)
    ).toFixed(1)} MB` +
      (agentMemoryBytes !== null
        ? `, measureUserAgentSpecificMemory: ${(
            agentMemoryBytes / (1024 * 1024)
          ).toFixed(1)} MB`
        : ", measureUserAgentSpecificMemory unavailable"),
  );

  // Sanity: the poller actually sampled something before asserting on it.
  expect(peakHeapBytes).toBeGreaterThan(0);
  expect(peakHeapBytes).toBeLessThan(MAX_MAIN_THREAD_HEAP_BYTES);
});
