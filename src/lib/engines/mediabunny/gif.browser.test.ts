import {
  BufferTarget,
  CanvasSource,
  canEncodeVideo,
  Mp4OutputFormat,
  Output,
  QUALITY_LOW,
} from "mediabunny";
import { describe, expect, it } from "vitest";
import { ENGINE_MANIFEST } from "@/lib/engines/manifest";
import { createWorkerPool, spawnEngineWorker } from "@/lib/workers";

/**
 * Real-browser coverage for the `toGif` op (Phase 3c), through a real
 * dedicated worker — same rationale as adapter.browser.test.ts's `transcode`
 * suite: `CanvasSink`/`OffscreenCanvas` work fine on the main thread too, but
 * exercising the actual dispatch path (`pool.run` -> `engine-host.ts` ->
 * `adapter.ts`'s `toGif` case -> `gif.ts`'s `runToGif`) is what this test is
 * for, not just the pure helpers already covered by gif.test.ts.
 */
const WIDTH = 320;
const HEIGHT = 240;
const FPS = 5;
const DURATION_S = 2;
const FRAME_COUNT = FPS * DURATION_S;

const canEncodeAvc = await canEncodeVideo("avc");

/** Same builder as adapter.browser.test.ts's `buildTestMp4` (a moving
 * rectangle over `FRAME_COUNT` frames), sized/timed for a short gif clip
 * instead of a webm transcode. */
async function buildTestMp4(): Promise<Blob> {
  const canvas = new OffscreenCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context in test setup");

  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat(), target });
  const source = new CanvasSource(canvas, {
    codec: "avc",
    quality: QUALITY_LOW,
  });
  output.addVideoTrack(source);

  await output.start();
  for (let i = 0; i < FRAME_COUNT; i++) {
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = "#ff6633";
    ctx.fillRect((i * 20) % WIDTH, HEIGHT / 2 - 20, 40, 40);
    await source.add(i / FPS, 1 / FPS);
  }
  source.close();
  await output.finalize();

  const buffer = target.buffer;
  if (!buffer) throw new Error("test MP4 builder produced no buffer");
  return new Blob([buffer], { type: "video/mp4" });
}

/** Counts Graphic Control Extension blocks (`0x21 0xF9`) — one per encoded
 * GIF frame — the cheapest way to check "roughly this many frames" without
 * a full GIF parser. */
function countGraphicControlExtensions(bytes: Uint8Array): number {
  let count = 0;
  for (let i = 0; i < bytes.length - 1; i++) {
    if (bytes[i] === 0x21 && bytes[i + 1] === 0xf9) count++;
  }
  return count;
}

describe.skipIf(!canEncodeAvc)("mediabunny toGif", () => {
  it("converts a short mp4 clip to an animated GIF", async () => {
    const blob = await buildTestMp4();
    const pool = createWorkerPool({
      size: 1,
      spawn: spawnEngineWorker,
      isHeavy: (engine) => ENGINE_MANIFEST[engine].heavy,
    });

    try {
      const result = await pool.run({
        jobId: "mediabunny-gif-job",
        input: { kind: "blob", blob },
        steps: [
          {
            engine: "mediabunny" as const,
            baseUrl: ENGINE_MANIFEST.mediabunny.baseUrl,
            op: "toGif" as const,
            inputFormat: "mp4" as const,
            outputFormat: "gif" as const,
          },
        ],
        options: {
          start: 0,
          duration: DURATION_S,
          fps: String(FPS),
          width: "320",
          colors: "128",
          loop: true,
        },
      });

      expect(result.kind).toBe("bytes");
      if (result.kind !== "bytes") throw new Error("unreachable");
      expect(result.mime).toBe("image/gif");

      const bytes = new Uint8Array(result.bytes);
      const header = new TextDecoder("ascii").decode(bytes.subarray(0, 6));
      expect(header).toBe("GIF89a");

      // fps 5 over 2s -> ~10 frames; allow slack for the last partial
      // interval frameTimestamps may or may not include.
      const frameCount = countGraphicControlExtensions(bytes);
      expect(frameCount).toBeGreaterThanOrEqual(FRAME_COUNT - 1);
      expect(frameCount).toBeLessThanOrEqual(FRAME_COUNT + 1);
    } finally {
      pool.destroy();
    }
  });
});
