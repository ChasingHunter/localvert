import * as Comlink from "comlink";
import type { MediaProbeResult, PdfProbeResult } from "@/lib/estimate/types";

/**
 * ADR-0017's "Estimates" addendum (2026-09-30): reads cheap metadata for a
 * dropped-but-not-yet-submitted file (staged because its tool's mode is
 * target-size/percent — see `shouldStageForEstimate` in
 * `src/lib/estimate/index.ts`) off the main thread, satisfying invariant 2
 * the same way every real conversion does. Spawned per call, one-shot, same
 * pattern as `zip.worker.ts`/`zipInWorker` — a probe is cheap and infrequent
 * enough that pooling it like the real engine worker (`pool.ts`) would be
 * pure overhead.
 *
 * Every engine module this file touches (`mediabunny/*`, `pdf-lib/adapter`)
 * is reached only through `import()` inside each method below, never a
 * top-level import — so probing a PDF never downloads mediabunny's wasm and
 * vice versa (invariant 3's "no engine in the core bundle" applies just as
 * much to a worker's own bundle: this file's own top-level chunk must stay
 * tiny, since it loads on every staged drop).
 *
 * Typechecked by `tsconfig.worker.json` (WebWorker lib, no DOM) — see
 * ADR-0005.
 */

const api = {
  /** Video/audio container metadata for `compress-video`/`compress-audio`'s
   * estimate — `mediabunny/video.ts`'s `sourceBitrates` already reads
   * exactly this (duration/width/height/fps/bitrates) without decoding a
   * frame; `audio.ts`'s `probeAudioMetadata` adds the channel count
   * `sourceBitrates` doesn't carry. Run together since either tool's probe
   * might be asked for either kind of file (`compress-audio` also accepts
   * mp4/mov/webm/mkv as an audio-only source is never the case here, but
   * both probes are equally cheap and neither throws on a track it doesn't
   * find). */
  async probeMedia(file: Blob): Promise<MediaProbeResult> {
    const [{ sourceBitrates }, { probeAudioMetadata }] = await Promise.all([
      import("@/lib/engines/mediabunny/video"),
      import("@/lib/engines/mediabunny/audio"),
    ]);
    const bitrates = await sourceBitrates(file);
    const audio = await probeAudioMetadata(file).catch(() => undefined);
    return {
      durationSeconds: bitrates.duration,
      width: bitrates.width,
      height: bitrates.height,
      fps: bitrates.fps,
      videoBitrate: bitrates.video,
      audioBitrate: bitrates.audio,
      audioChannels: audio?.channels,
    };
  },

  /** `compress-pdf`'s estimate: page count plus the same cheap
   * image-bytes/everything-else split the real target-size run uses. */
  async probePdf(bytes: ArrayBuffer): Promise<PdfProbeResult> {
    const { probePdf } = await import("@/lib/engines/pdf-lib/adapter");
    return probePdf(bytes);
  },
};

export type ProbeWorkerApi = typeof api;

Comlink.expose(api);
