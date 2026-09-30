/**
 * Shapes `probe.worker.ts` hands back to the main thread, and the estimate
 * functions in this directory consume — see ADR-0017's "Estimates" addendum
 * (2026-09-30). Kept separate from the worker file itself so a plain
 * `import type` from main-thread code (`size-estimate.tsx`) never drags in
 * `probe.worker.ts`'s own top-level code (none today, but see ADR-0005 on
 * why a `*.worker.ts` file is never imported for its runtime side, only
 * reached through `new Worker(new URL(...))`).
 */

/** Video/audio container metadata — `mediabunny/video.ts`'s `sourceBitrates`
 * and `mediabunny/audio.ts`'s `probeAudioMetadata`, read without decoding a
 * single frame. Every field is `undefined` exactly when the source
 * `sourceBitrates` already treats as "couldn't be determined" — never a
 * thrown error, so a corrupt/unusual file still probes to an all-`undefined`
 * result rather than failing the whole estimate. */
export interface MediaProbeResult {
  durationSeconds?: number;
  width?: number;
  height?: number;
  fps?: number;
  videoBitrate?: number;
  audioBitrate?: number;
  audioChannels?: number;
}

/** `pdf-lib/adapter.ts`'s `probePdf`: a page count and a cheap image-bytes /
 * everything-else split, no image recompression. */
export interface PdfProbeResult {
  pageCount: number;
  imageBytes: number;
  nonImageBytes: number;
}

export type ProbeResult = MediaProbeResult | PdfProbeResult;
