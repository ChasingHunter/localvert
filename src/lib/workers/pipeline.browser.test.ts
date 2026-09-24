import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { isEngineError } from "@/lib/engines";
import { ENGINE_MANIFEST } from "@/lib/engines/manifest";
import { sniffFormat } from "@/lib/registry";
import { collectToBlob } from "@/lib/sinks/collect";
import { createWorkerPool } from "./pool";
import { spawnEngineWorker, zipInWorker } from "./spawn";

/**
 * Real workers, real wasm-free engine, real zip. Everything below is what
 * `job-engine.ts`'s node unit tests fake out (`WorkerPool`, `zip`) — this is
 * where that fake is checked against the genuine `new Worker(...)` +
 * Comlink wiring it stands in for.
 */

async function makePngBlob(): Promise<Blob> {
  const canvas = new OffscreenCanvas(8, 8);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context in test setup");
  ctx.fillStyle = "#3366ff";
  ctx.fillRect(0, 0, 8, 8);
  return canvas.convertToBlob({ type: "image/png" });
}

describe("engine worker + zip worker (real browser)", () => {
  it("converts, reports progress, cancels, and zips through real workers", async () => {
    const pool = createWorkerPool({
      size: 2,
      spawn: spawnEngineWorker,
      isHeavy: (engine) => ENGINE_MANIFEST[engine].heavy,
    });

    try {
      const pngBlob = await makePngBlob();

      const progressValues: number[] = [];
      const result = await pool.run(
        {
          jobId: "pipeline-job-1",
          engine: "canvas",
          baseUrl: ENGINE_MANIFEST.canvas.baseUrl,
          op: "transcode",
          input: { kind: "blob", blob: pngBlob },
          inputFormat: "png",
          outputFormat: "jpg",
          options: {},
        },
        { onProgress: (fraction) => progressValues.push(fraction) },
      );

      if (result.kind !== "bytes") throw new Error("expected a bytes result");
      const jpgBytes = new Uint8Array(result.bytes);
      expect(sniffFormat(jpgBytes)).toBe("jpg");

      expect(progressValues.length).toBeGreaterThan(0);
      expect(progressValues.at(-1)).toBe(1);
      // Every value the (throttled) progress callback reports is within
      // range and non-decreasing.
      for (let i = 1; i < progressValues.length; i++) {
        expect(progressValues[i]).toBeGreaterThanOrEqual(
          progressValues[i - 1] as number,
        );
      }

      // Cancellation: abort right after dispatch — the worker round-trip
      // means this always lands well before a real conversion could finish.
      const controller = new AbortController();
      const cancelledRun = pool.run(
        {
          jobId: "pipeline-job-2",
          engine: "canvas",
          baseUrl: ENGINE_MANIFEST.canvas.baseUrl,
          op: "transcode",
          input: { kind: "blob", blob: pngBlob },
          inputFormat: "png",
          outputFormat: "jpg",
          options: {},
        },
        { signal: controller.signal },
      );
      controller.abort();
      await expect(cancelledRun).rejects.toSatisfy(
        (e: unknown) => isEngineError(e) && e.code === "aborted",
      );

      // Zipping: two blobs, through a real zip worker.
      const jpgBlob = new Blob([jpgBytes], { type: "image/jpeg" });
      const { stream, dispose } = await zipInWorker([
        { name: "source.png", blob: pngBlob },
        { name: "converted.jpg", blob: jpgBlob },
      ]);
      const zipBlob = await collectToBlob(stream, "application/zip");
      const zipBytes = new Uint8Array(await zipBlob.arrayBuffer());
      expect(sniffFormat(zipBytes)).toBe("zip");

      const unzipped = unzipSync(zipBytes);
      expect(Object.keys(unzipped).sort()).toEqual([
        "converted.jpg",
        "source.png",
      ]);
      dispose();
    } finally {
      pool.destroy();
    }
  });
});
