import {
  ALL_FORMATS,
  BufferTarget,
  CanvasSource,
  canEncodeVideo,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_LOW,
  UrlSource,
} from "mediabunny";
import { describe, expect, it } from "vitest";
import { ENGINE_MANIFEST } from "@/lib/engines/manifest";
import { createWorkerPool, spawnEngineWorker } from "@/lib/workers";
import { isEngineError } from "../errors";
import adapter from "./adapter";

const WIDTH = 320;
const HEIGHT = 240;
const FRAME_COUNT = 45;
const FPS = 15;

const EBML_MAGIC = [0x1a, 0x45, 0xdf, 0xa3];

// Top-level await: probed once at module load, same pattern as the fixture
// existence checks in heic/libraw's `describe.skipIf` blocks. `avc` (H.264)
// is what mediabunny calls the codec this probes; every current Chromium
// supports it, but the whole video-encoding suite still gates on it rather
// than assuming so.
const canEncodeAvc = await canEncodeVideo("avc");

function hasEbmlMagic(bytes: Uint8Array): boolean {
  return EBML_MAGIC.every((b, i) => bytes[i] === b);
}

/**
 * Builds a tiny real MP4 (H.264 + moving rectangle, no audio) entirely with
 * mediabunny itself — a `CanvasSource` over an `OffscreenCanvas`, muxed by
 * `Mp4OutputFormat` into a `BufferTarget`. No fixture file, no network,
 * matching this suite's other adapters (see canvas/adapter.browser.test.ts).
 * `avc` (H.264) is what mediabunny calls the codec `canEncodeVideo` probes;
 * every current Chromium supports it, but the probe still gates the whole
 * `describe` block rather than assuming so.
 */
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
    ctx.fillStyle = "#3366ff";
    // A rectangle that moves across frames, so consecutive frames differ —
    // matters for the encoder actually doing inter-frame work, not for any
    // assertion this suite makes.
    ctx.fillRect((i * 10) % WIDTH, HEIGHT / 2 - 20, 40, 40);
    await source.add(i / FPS, 1 / FPS);
  }
  source.close();
  await output.finalize();

  const buffer = target.buffer;
  if (!buffer) throw new Error("test MP4 builder produced no buffer");
  return new Blob([buffer], { type: "video/mp4" });
}

describe("mediabunny adapter", () => {
  it("carries the metadata defineEngine validated", () => {
    expect(adapter.id).toBe("mediabunny");
    expect(adapter.marker).toBe("localvert-engine:mediabunny");
  });

  describe("supports", () => {
    it("accepts mp4/mov -> webm transcode only", () => {
      expect(adapter.supports("transcode", "mp4", "webm")).toBe(true);
      expect(adapter.supports("transcode", "mov", "webm")).toBe(true);
      expect(adapter.supports("transcode", "mp4", "mov")).toBe(false);
      expect(adapter.supports("decode", "mp4", "webm")).toBe(false);
    });
  });

  // Real dedicated worker (createWorkerPool + spawnEngineWorker, same as
  // pipeline.browser.test.ts), not `adapter.load()`/`run()` called directly
  // from the test's own main-thread context: `createSyncAccessHandle` is
  // dedicated-worker-only per spec (ADR-0010), so calling the adapter
  // in-page would always take the `BufferTarget` fallback and never
  // actually exercise the OPFS path this suite is here to prove works.
  describe.skipIf(!canEncodeAvc)("transcode", () => {
    function mediabunnyStep() {
      return {
        engine: "mediabunny" as const,
        baseUrl: ENGINE_MANIFEST.mediabunny.baseUrl,
        op: "transcode" as const,
        inputFormat: "mp4" as const,
        outputFormat: "webm" as const,
      };
    }

    it("writes to OPFS and produces a readable WebM", async () => {
      const blob = await buildTestMp4();
      const pool = createWorkerPool({
        size: 1,
        spawn: spawnEngineWorker,
        isHeavy: (engine) => ENGINE_MANIFEST[engine].heavy,
      });

      try {
        const result = await pool.run({
          jobId: "mediabunny-opfs-job",
          input: { kind: "blob", blob },
          steps: [mediabunnyStep()],
          options: {},
        });

        expect(result.kind).toBe("opfs");
        if (result.kind !== "opfs") throw new Error("unreachable");
        expect(result.size).toBeGreaterThan(0);
        expect(result.mime).toBe("video/webm");

        // Reading an OPFS file back (no sync access handle involved) works
        // fine from the main thread — only *creating* the sync access
        // handle that wrote it is worker-only.
        const root = await navigator.storage.getDirectory();
        const [dirName, fileName] = result.path.split("/");
        const dir = await root.getDirectoryHandle(dirName as string);
        const fileHandle = await dir.getFileHandle(fileName as string);
        const file = await fileHandle.getFile();
        expect(file.size).toBe(result.size);
        expect(file.size).toBeGreaterThan(0);

        const header = new Uint8Array(await file.slice(0, 4).arrayBuffer());
        expect(hasEbmlMagic(header)).toBe(true);

        const readBack = new Input({
          source: new UrlSource(URL.createObjectURL(file)),
          formats: ALL_FORMATS,
        });
        const videoTracks = await readBack.getVideoTracks();
        expect(videoTracks.length).toBe(1);
        const duration = await readBack.computeDuration();
        expect(duration).toBeGreaterThan(0);

        await dir.removeEntry(fileName as string);
      } finally {
        pool.destroy();
      }
    });

    it("falls back to an in-memory buffer when the __forceBufferTarget test option is set", async () => {
      const blob = await buildTestMp4();
      const pool = createWorkerPool({
        size: 1,
        spawn: spawnEngineWorker,
        isHeavy: (engine) => ENGINE_MANIFEST[engine].heavy,
      });

      try {
        // ADR-0010's `BufferTarget` fallback normally only triggers when
        // OPFS itself is unavailable — genuinely true for some
        // browsers/private modes, but not for the Chromium this suite runs
        // in. `__forceBufferTarget` is a test-only escape hatch the adapter
        // checks in `task.options` (see adapter.ts's `runTranscode`) so this
        // path is exercised deterministically instead of depending on the
        // test environment lacking OPFS.
        const result = await pool.run({
          jobId: "mediabunny-buffer-job",
          input: { kind: "blob", blob },
          steps: [mediabunnyStep()],
          options: { __forceBufferTarget: true },
        });

        expect(result.kind).toBe("bytes");
        if (result.kind !== "bytes") throw new Error("unreachable");
        expect(result.bytes.byteLength).toBeGreaterThan(0);
        expect(result.mime).toBe("video/webm");

        const header = new Uint8Array(result.bytes.slice(0, 4));
        expect(hasEbmlMagic(header)).toBe(true);
      } finally {
        pool.destroy();
      }
    });

    it("aborting mid-run rejects and leaves no file in /localvert-tmp/", async () => {
      const blob = await buildTestMp4();
      const pool = createWorkerPool({
        size: 1,
        spawn: spawnEngineWorker,
        isHeavy: (engine) => ENGINE_MANIFEST[engine].heavy,
      });

      try {
        const controller = new AbortController();
        const run = pool.run(
          {
            jobId: "mediabunny-abort-job",
            input: { kind: "blob", blob },
            steps: [mediabunnyStep()],
            options: {},
          },
          { signal: controller.signal },
        );
        // Attach a handler immediately so a fast rejection is never reported
        // as an unhandled rejection while the abort races the transcode
        // (see pipeline.browser.test.ts's cancellation test for the same
        // pattern and why it's needed).
        const outcome = run.then(
          () => ({ ok: true as const }),
          (error: unknown) => ({ ok: false as const, error }),
        );
        controller.abort();
        const result = await outcome;

        if (result.ok) {
          throw new Error(
            "conversion completed before the abort landed — this test's " +
              "video needs more frames so cancellation has time to win",
          );
        }
        expect(
          isEngineError(result.error) && result.error.code === "aborted",
        ).toBe(true);

        // The partial OPFS output must not survive an aborted run — see
        // adapter.ts's `cleanupFailedOpfsOutput`.
        const root = await navigator.storage.getDirectory();
        const dir = await root.getDirectoryHandle("localvert-tmp", {
          create: true,
        });
        const names: string[] = [];
        const entries = dir as unknown as AsyncIterable<
          [string, FileSystemHandle]
        >;
        for await (const [name] of entries) names.push(name);
        expect(names).toEqual([]);
      } finally {
        pool.destroy();
      }
    });
  });
});
