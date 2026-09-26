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
          input: { kind: "blob", blob: pngBlob },
          steps: [
            {
              engine: "canvas",
              baseUrl: ENGINE_MANIFEST.canvas.baseUrl,
              op: "transcode",
              inputFormat: "png",
              outputFormat: "jpg",
            },
          ],
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

      // Cancellation: the canvas transcode op only has one checkpoint that
      // a real, message-delivered cancel can land on — the
      // `signal.throwIfAborted()` right after `createImageBitmap` decodes
      // the source (see canvas/adapter.ts `runTranscode`). Every checkpoint
      // after that runs back-to-back with no yield to the event loop until
      // the final `convertToBlob` encode, which isn't itself preceded or
      // followed by another check — so once decode has finished, this op
      // cannot observe an abort at all (only the pool's cancel-grace
      // timeout could still catch it, and that defaults to 2s, far longer
      // than this op takes end to end). A tiny source image decodes fast
      // enough that the abort — sent right after dispatch, itself a
      // message round trip — can lose that race under load: the whole
      // conversion finishes and resolves before cancellation lands. A
      // decode with real work in it (a large image) keeps that one
      // checkpoint open long enough for the cancel to always win.
      const bigCanvas = new OffscreenCanvas(4000, 3000);
      const bigCtx = bigCanvas.getContext("2d");
      if (!bigCtx) throw new Error("no 2d context in test setup");
      bigCtx.fillStyle = "#3366ff";
      bigCtx.fillRect(0, 0, 4000, 3000);
      const bigPngBlob = await bigCanvas.convertToBlob({ type: "image/png" });

      const controller = new AbortController();
      const cancelledRun = pool.run(
        {
          jobId: "pipeline-job-2",
          input: { kind: "blob", blob: bigPngBlob },
          steps: [
            {
              engine: "canvas",
              baseUrl: ENGINE_MANIFEST.canvas.baseUrl,
              op: "transcode",
              inputFormat: "png",
              outputFormat: "jpg",
            },
          ],
          options: {},
        },
        { signal: controller.signal },
      );
      // Attach a handler immediately (rather than only via the `expect`
      // below, after `controller.abort()`) so a fast rejection can never be
      // reported as an unhandled rejection.
      const cancelledOutcome = cancelledRun.then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      controller.abort();

      const outcome = await cancelledOutcome;
      if (outcome.ok) {
        throw new Error(
          "conversion completed before the abort landed — the test's " +
            "source image needs to decode more slowly so cancellation has " +
            "time to win",
        );
      }
      expect(
        isEngineError(outcome.error) && outcome.error.code === "aborted",
      ).toBe(true);

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

  it("runs a real decode -> resize -> encode pipeline (ADR-0007) through the real pool, all on canvas", async () => {
    const pool = createWorkerPool({
      size: 2,
      spawn: spawnEngineWorker,
      isHeavy: (engine) => ENGINE_MANIFEST[engine].heavy,
    });

    try {
      // A rectangular source so the resize step's dimensions are unambiguous.
      const canvas = new OffscreenCanvas(20, 10);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d context in test setup");
      ctx.fillStyle = "#3366ff";
      ctx.fillRect(0, 0, 20, 10);
      const pngBlob = await canvas.convertToBlob({ type: "image/png" });

      const result = await pool.run({
        jobId: "raster-pipeline-job",
        input: { kind: "blob", blob: pngBlob },
        steps: [
          {
            engine: "canvas",
            baseUrl: ENGINE_MANIFEST.canvas.baseUrl,
            op: "decode",
            inputFormat: "png",
            outputFormat: "raster",
          },
          {
            engine: "canvas",
            baseUrl: ENGINE_MANIFEST.canvas.baseUrl,
            op: "resize",
            inputFormat: "raster",
            outputFormat: "raster",
          },
          {
            engine: "canvas",
            baseUrl: ENGINE_MANIFEST.canvas.baseUrl,
            op: "encode",
            inputFormat: "raster",
            outputFormat: "jpg",
          },
        ],
        options: { width: 10, height: 5 },
      });

      if (result.kind !== "bytes") throw new Error("expected a bytes result");
      const jpgBytes = new Uint8Array(result.bytes);
      expect(sniffFormat(jpgBytes)).toBe("jpg");

      const outBitmap = await createImageBitmap(
        new Blob([jpgBytes], { type: result.mime }),
      );
      expect(outBitmap.width).toBe(10);
      expect(outBitmap.height).toBe(5);
      outBitmap.close();
    } finally {
      pool.destroy();
    }
  });
});
