import {
  ALL_FORMATS,
  AudioBufferSource,
  BufferTarget,
  CanvasSource,
  canEncodeAudio,
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
import adapter from "./adapter";

const SAMPLE_RATE = 44_100;
const DURATION_SECONDS = 1;

const ID3_MAGIC = ascii("ID3");
const MPEG_FRAME_SYNCS = [
  [0xff, 0xfb],
  [0xff, 0xf3],
  [0xff, 0xf2],
  [0xff, 0xfa],
];
const OGG_MAGIC = ascii("OggS");

function ascii(s: string): number[] {
  return Array.from(s, (c) => c.charCodeAt(0));
}

function hasMagic(bytes: Uint8Array, magic: readonly number[]): boolean {
  return magic.every((b, i) => bytes[i] === b);
}

function isMp3(bytes: Uint8Array): boolean {
  return (
    hasMagic(bytes, ID3_MAGIC) ||
    MPEG_FRAME_SYNCS.some((sync) => hasMagic(bytes, sync))
  );
}

/**
 * Builds a 1s, 44.1kHz mono sine-wave WAV entirely by hand — a plain RIFF/
 * WAVE header (PCM, 16-bit) followed by the raw samples. No fixture file,
 * no network, no Web Audio API dependency; matches this suite's other
 * adapters (see adapter.browser.test.ts's `buildTestMp4` for the same
 * "build the test input in-test" approach on the video side).
 */
function buildSineWav(): Blob {
  const numSamples = SAMPLE_RATE * DURATION_SECONDS;
  const dataSize = numSamples * 2; // 16-bit mono
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeAscii = (offset: number, s: string): void => {
    for (let i = 0; i < s.length; i++)
      view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(36, "data");
  view.setUint32(40, dataSize, true);

  const frequency = 440;
  for (let i = 0; i < numSamples; i++) {
    const sample = Math.sin((2 * Math.PI * frequency * i) / SAMPLE_RATE) * 0.5;
    view.setInt16(44 + i * 2, Math.round(sample * 0x7fff), true);
  }

  return new Blob([buffer], { type: "audio/wav" });
}

/**
 * Builds a tiny real MP4 with both a moving-rectangle video track (same
 * shape as adapter.browser.test.ts's `buildTestMp4`) and a sine-wave audio
 * track, so `extract-audio` has a real audio stream to pull out. Audio is
 * added via `AudioBufferSource` from a plain `AudioBuffer` populated by
 * hand — no `AudioContext` dependency (constructing an `AudioBuffer`
 * doesn't need one; only playback/decoding APIs do).
 */
async function buildTestMp4WithAudio(): Promise<Blob> {
  const width = 320;
  const height = 240;
  const fps = 15;
  const frameCount = 30;

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context in test setup");

  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat(), target });

  const videoSource = new CanvasSource(canvas, {
    codec: "avc",
    quality: QUALITY_LOW,
  });
  output.addVideoTrack(videoSource);

  const audioSource = new AudioBufferSource({ codec: "aac", bitrate: 128_000 });
  output.addAudioTrack(audioSource);

  await output.start();

  for (let i = 0; i < frameCount; i++) {
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#3366ff";
    ctx.fillRect((i * 10) % width, height / 2 - 20, 40, 40);
    await videoSource.add(i / fps, 1 / fps);
  }
  videoSource.close();

  const numSamples = SAMPLE_RATE * DURATION_SECONDS;
  const audioBuffer = new AudioBuffer({
    length: numSamples,
    numberOfChannels: 1,
    sampleRate: SAMPLE_RATE,
  });
  const channel = audioBuffer.getChannelData(0);
  const frequency = 440;
  for (let i = 0; i < numSamples; i++) {
    channel[i] = Math.sin((2 * Math.PI * frequency * i) / SAMPLE_RATE) * 0.5;
  }
  await audioSource.add(audioBuffer);
  audioSource.close();

  await output.finalize();

  const buffer = target.buffer;
  if (!buffer) throw new Error("test MP4 builder produced no buffer");
  return new Blob([buffer], { type: "video/mp4" });
}

const canEncodeOpus = await canEncodeAudio("opus");
const canEncodeAac = await canEncodeAudio("aac");
const canEncodeAvc = await canEncodeVideo("avc");

describe("mediabunny audio", () => {
  describe("supports", () => {
    it("accepts the declared audio transcode pairs through the adapter", () => {
      expect(adapter.supports("transcode", "wav", "mp3")).toBe(true);
      expect(adapter.supports("transcode", "mp3", "wav")).toBe(true);
      expect(adapter.supports("transcode", "mp4", "mp3")).toBe(true);
    });
  });

  function mediabunnyStep(outputFormat: "mp3" | "wav" | "ogg" | "opus") {
    return {
      engine: "mediabunny" as const,
      baseUrl: ENGINE_MANIFEST.mediabunny.baseUrl,
      op: "transcode" as const,
      inputFormat: "wav" as const,
      outputFormat,
    };
  }

  // MP3 encoding never depends on native browser support — `audio.ts`
  // registers the LAME wasm encoder automatically when the browser can't
  // encode MP3 itself, so this suite doesn't gate on `canEncodeMp3Native`.
  it("converts a generated WAV to a valid MP3 (registering the LAME encoder if needed)", async () => {
    const blob = buildSineWav();
    const pool = createWorkerPool({
      size: 1,
      spawn: spawnEngineWorker,
      isHeavy: (engine) => ENGINE_MANIFEST[engine].heavy,
    });

    try {
      const result = await pool.run({
        jobId: "audio-wav-to-mp3-job",
        input: { kind: "blob", blob },
        steps: [mediabunnyStep("mp3")],
        options: { bitrate: "192", sampleRate: "keep", channels: "keep" },
      });

      const { bytes, mime } = await bytesAndMimeOf(result);
      expect(mime).toBe("audio/mpeg");
      expect(isMp3(bytes.slice(0, 4))).toBe(true);

      const readBack = new Input({
        source: new UrlSource(URL.createObjectURL(new Blob([bytes]))),
        formats: ALL_FORMATS,
      });
      const duration = await readBack.computeDuration();
      expect(duration).toBeGreaterThan(0.9);
      expect(duration).toBeLessThan(1.2);
    } finally {
      pool.destroy();
    }
  });

  describe.skipIf(!canEncodeOpus)("wav to ogg", () => {
    it("converts a generated WAV to a valid Ogg/Opus file", async () => {
      const blob = buildSineWav();
      const pool = createWorkerPool({
        size: 1,
        spawn: spawnEngineWorker,
        isHeavy: (engine) => ENGINE_MANIFEST[engine].heavy,
      });

      try {
        const result = await pool.run({
          jobId: "audio-wav-to-ogg-job",
          input: { kind: "blob", blob },
          steps: [mediabunnyStep("ogg")],
          options: { bitrate: "192", sampleRate: "keep", channels: "keep" },
        });

        const { bytes, mime } = await bytesAndMimeOf(result);
        expect(mime).toBe("audio/ogg");
        expect(hasMagic(bytes.slice(0, 4), OGG_MAGIC)).toBe(true);
      } finally {
        pool.destroy();
      }
    });
  });

  describe.skipIf(!canEncodeAvc || !canEncodeAac)("extract-audio", () => {
    it("extracts the audio track from a generated MP4 as MP3", async () => {
      const blob = await buildTestMp4WithAudio();
      const pool = createWorkerPool({
        size: 1,
        spawn: spawnEngineWorker,
        isHeavy: (engine) => ENGINE_MANIFEST[engine].heavy,
      });

      try {
        const result = await pool.run({
          jobId: "extract-audio-job",
          input: { kind: "blob", blob },
          steps: [
            {
              engine: "mediabunny",
              baseUrl: ENGINE_MANIFEST.mediabunny.baseUrl,
              op: "transcode",
              inputFormat: "mp4",
              outputFormat: "mp3",
            },
          ],
          options: {
            format: "mp3",
            bitrate: "192",
            sampleRate: "keep",
            channels: "keep",
          },
        });

        const { bytes, mime } = await bytesAndMimeOf(result);
        expect(mime).toBe("audio/mpeg");
        expect(isMp3(bytes.slice(0, 4))).toBe(true);
      } finally {
        pool.destroy();
      }
    });
  });
});

/**
 * Every conversion in this suite produces either a `"bytes"` or an `"opfs"`
 * result (never `"raster"`/`"stream"`/`"files"` — those are other engines'
 * shapes), narrowed here once so each test doesn't repeat the same
 * exhaustiveness dance as adapter.browser.test.ts's inline `if (result.kind
 * !== "opfs") throw ...` checks.
 */
async function bytesAndMimeOf(
  result: Awaited<ReturnType<ReturnType<typeof createWorkerPool>["run"]>>,
): Promise<{ bytes: Uint8Array<ArrayBuffer>; mime: string }> {
  if (result.kind === "bytes") {
    return { bytes: new Uint8Array(result.bytes), mime: result.mime };
  }
  if (result.kind === "opfs") {
    return { bytes: await readOpfsBytes(result.path), mime: result.mime };
  }
  throw new Error(`unexpected EngineResult kind "${result.kind}"`);
}

/** Reads an OPFS path (`"<dir>/<name>"`, as returned in an `"opfs"`
 * `EngineResult`) back into bytes from the main thread — reading doesn't
 * need a sync access handle, only creating one does (ADR-0010). */
async function readOpfsBytes(path: string): Promise<Uint8Array<ArrayBuffer>> {
  const root = await navigator.storage.getDirectory();
  const [dirName, fileName] = path.split("/");
  const dir = await root.getDirectoryHandle(dirName as string);
  const fileHandle = await dir.getFileHandle(fileName as string);
  const file = await fileHandle.getFile();
  const buffer = await file.arrayBuffer();
  await dir.removeEntry(fileName as string);
  return new Uint8Array(buffer);
}
