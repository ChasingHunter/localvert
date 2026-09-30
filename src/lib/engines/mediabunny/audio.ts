/**
 * Audio transcode via mediabunny (ADR-0010, extended for Phase 3b), covering
 * both "extract the audio track from a video container" and "re-encode one
 * audio container/codec as another". Drives the same `Conversion` machinery
 * as every video op, through the shared `runConversion()` helper in
 * `output.ts` — this file's own job is picking the output container/codec
 * (`outputPlan`/`pickAudioCodec`) and mapping each tool's zod options onto
 * `Conversion`'s audio options (`bitrateOf`/`sampleRateOf`/
 * `numberOfChannelsOf`).
 *
 * `video: { discard: true }` is passed for every conversion here, audio-only
 * inputs included — harmless (there's no video track to discard) and it
 * means the same code path serves `extract-audio` (mp4/mov/webm -> audio)
 * and a plain audio-to-audio re-encode identically.
 */
import { registerFlacEncoder } from "@mediabunny/flac-encoder";
import { registerMp3Encoder } from "@mediabunny/mp3-encoder";
import {
  ALL_FORMATS,
  type AudioCodec,
  BlobSource,
  canEncodeAudio,
  FlacOutputFormat,
  Input,
  Mp3OutputFormat,
  Mp4OutputFormat,
  OggOutputFormat,
  type OutputFormat,
  WavOutputFormat,
} from "mediabunny";
import type { Operation, StepFormat } from "@/lib/registry";
import { FORMATS } from "@/lib/registry";
import { EngineError } from "../errors";
import type { EngineInput, EngineResult, EngineTask } from "../types";
import {
  type AudioTargetCodec,
  alreadyUnderTargetNote,
  bestQualityBitrate,
  bitrateForTargetSize,
  resultNote,
  stepDown,
  targetBytesForPercent,
} from "./audio-target";
import { runConversion } from "./output";

const ENGINE_ID = "mediabunny";

/** The audio-only formats this file knows how to produce, and the tools
 * that read from them. `extract-audio`'s video/container inputs (mp4, mov,
 * webm, mkv) are supported as inputs but never as outputs here. */
const AUDIO_OUTPUT_FORMATS = new Set<StepFormat>([
  "mp3",
  "wav",
  "flac",
  "ogg",
  "opus",
  "m4a",
]);

const AUDIO_INPUT_FORMATS = new Set<StepFormat>([
  "mp4",
  "mov",
  "webm",
  "mkv",
  "mp3",
  "wav",
  "flac",
  "ogg",
  "opus",
  "m4a",
  "aac",
]);

/** True for every (op, input, output) triple this file's `run` handles —
 * checked by `adapter.ts`'s `supports` before the video-transcode branch's
 * own (mp4/mov -> webm) check, so the two never overlap. */
export function supportsAudioTranscode(
  op: Operation,
  input: StepFormat,
  output: StepFormat,
): boolean {
  return (
    op === "transcode" &&
    AUDIO_INPUT_FORMATS.has(input) &&
    AUDIO_OUTPUT_FORMATS.has(output)
  );
}

let mp3EncoderRegistered = false;
let flacEncoderRegistered = false;

/** Registers the LAME wasm MP3 encoder (WebCodecs itself has no MP3
 * encoder in any browser) exactly once per worker, and only when the
 * browser doesn't already have a native one — mirrors the package's own
 * documented usage pattern. */
async function ensureMp3Encoder(): Promise<void> {
  if (mp3EncoderRegistered) return;
  if (!(await canEncodeAudio("mp3"))) {
    registerMp3Encoder();
  }
  mp3EncoderRegistered = true;
}

/** Registers the libFLAC wasm encoder exactly once per worker, and only
 * when the browser doesn't already have a native one — Chromium has no
 * built-in FLAC encoder at all (only decode), so this is what makes
 * wav-to-flac work there; mirrors `ensureMp3Encoder` above. */
async function ensureFlacEncoder(): Promise<void> {
  if (flacEncoderRegistered) return;
  if (!(await canEncodeAudio("flac"))) {
    registerFlacEncoder();
  }
  flacEncoderRegistered = true;
}

/** Picks the output container + the codec candidates worth trying for it,
 * in preference order. `wav` uses PCM, which mediabunny encodes itself (no
 * WebCodecs involved, so no capability probe needed) — every other target
 * codec is probed via `canEncodeAudio` before use. */
function outputPlan(output: StepFormat): {
  format: OutputFormat;
  mime: string;
  candidates: readonly AudioCodec[];
  majorBrand?: string;
} {
  switch (output) {
    case "mp3":
      return {
        format: new Mp3OutputFormat(),
        mime: FORMATS.mp3.mime,
        candidates: ["mp3"],
      };
    case "wav":
      return {
        format: new WavOutputFormat(),
        mime: FORMATS.wav.mime,
        candidates: ["pcm-s16"],
      };
    case "flac":
      return {
        format: new FlacOutputFormat(),
        mime: FORMATS.flac.mime,
        candidates: ["flac"],
      };
    case "ogg":
      return {
        format: new OggOutputFormat(),
        mime: FORMATS.ogg.mime,
        candidates: ["opus", "vorbis"],
      };
    case "opus":
      // Same Ogg container as `ogg` above, opus-only — see that format's
      // FORMATS.ts comment on why the two share a container.
      return {
        format: new OggOutputFormat(),
        mime: FORMATS.opus.mime,
        candidates: ["opus"],
      };
    case "m4a":
      return {
        format: new Mp4OutputFormat(),
        mime: FORMATS.m4a.mime,
        candidates: ["aac"],
        // mediabunny only ever writes an "isom"/"iso5" major brand, so an
        // m4a it produces would sniff as mp4 (see FORMATS.m4a). Stamp
        // Apple's audio-only brand instead — see `runConversion`.
        majorBrand: "M4A ",
      };
    default:
      throw new EngineError(
        "unsupported",
        `mediabunny audio cannot produce "${output}"`,
        { engine: ENGINE_ID },
      );
  }
}

/** Probes `candidates` in order and returns the first the browser can
 * actually encode, registering the LAME encoder first if `mp3` is in the
 * list and needed. `null` means none of them are supported here. */
async function pickAudioCodec(
  candidates: readonly AudioCodec[],
): Promise<AudioCodec | null> {
  for (const codec of candidates) {
    if (codec === "mp3") await ensureMp3Encoder();
    if (codec === "flac") await ensureFlacEncoder();
    if (codec.startsWith("pcm-")) return codec; // mediabunny encodes PCM itself.
    if (await canEncodeAudio(codec)) return codec;
  }
  return null;
}

/**
 * All three of these read a tool's already-zod-validated options object.
 * The shared option fields (`_shared-options.ts`'s `audioBitrateSelect` /
 * `audioSampleRateSelect` / `audioChannelsSelect`) are `select` controls,
 * which only ever render `z.enum` **string** values (see `describeField` in
 * `src/lib/options/fields.ts`) — so these parse those strings back into the
 * numbers (or `undefined`, for "keep the source's own value") that
 * `Conversion.init`'s audio options actually want. A tool with no bitrate
 * field at all (a lossless output target) simply never has `options.bitrate`
 * set, which reads the same as `undefined` here.
 */
export function bitrateOf(
  options: Readonly<Record<string, unknown>>,
): number | undefined {
  const kbps = options.bitrate;
  return typeof kbps === "string" ? Number(kbps) * 1000 : undefined;
}

export function sampleRateOf(
  options: Readonly<Record<string, unknown>>,
): number | undefined {
  const value = options.sampleRate;
  return typeof value === "string" && value !== "keep"
    ? Number(value)
    : undefined;
}

export function numberOfChannelsOf(
  options: Readonly<Record<string, unknown>>,
): number | undefined {
  const value = options.channels;
  if (value === "mono") return 1;
  if (value === "stereo") return 2;
  return undefined; // "keep" (or unset) — let the source's own channel count through.
}

/**
 * `extract-audio` is one tool with a runtime-selectable output container
 * (its own `format` option: mp3/m4a/wav/ogg/opus) rather than one tool per
 * output format — `ToolDefinition.produces` can't express "depends on an
 * option value", so that tool's `produces` stays a fixed `"mp3"` (its
 * default) and its `outputName` computes the real extension from
 * `opts.format` instead. This reads that same option back out on the
 * engine side, so the actual container written matches what the user
 * picked rather than always following the tool's static `produces`. Every
 * other audio tool has a fixed, single output format and never sets this
 * option, so `task.outputFormat` (from the tool's `produces`) is used as-is.
 */
export function chosenOutputFormat(task: EngineTask): StepFormat {
  const { format } = task.options;
  return typeof format === "string" && format in FORMATS
    ? (format as StepFormat)
    : task.outputFormat;
}

type CompressAudioMode = "best" | "target-size" | "percent" | "custom";

/** `compress-audio`'s own `mode` option (ADR-0017) — every other audio tool
 * (`extract-audio`, any future re-encode tool) never sets this option, so
 * this reads `undefined` there and `runAudioTranscode` falls through to the
 * original fixed-bitrate-select behaviour unchanged. */
function modeOf(
  options: Readonly<Record<string, unknown>>,
): CompressAudioMode | undefined {
  const mode = options.mode;
  return mode === "best" ||
    mode === "target-size" ||
    mode === "percent" ||
    mode === "custom"
    ? mode
    : undefined;
}

function targetSizeMBOf(options: Readonly<Record<string, unknown>>): number {
  const value = options.targetSizeMB;
  return typeof value === "number" && value > 0 ? value : 10;
}

function percentOf(options: Readonly<Record<string, unknown>>): number {
  const value = options.percent;
  return typeof value === "number" && value > 0 && value < 100 ? value : 50;
}

/** `audio-target.ts`'s target-size math only covers the three codecs
 * `compress-audio` can ever pick (its `accepts`/`produces` never reach wav/
 * flac/pcm/vorbis) — narrows `pickAudioCodec`'s wider `AudioCodec` return
 * type down to the one this module's bitrate math actually handles. */
function isTargetCodec(codec: AudioCodec): codec is AudioTargetCodec {
  return codec === "mp3" || codec === "aac" || codec === "opus";
}

/** Cheap-as-possible probe of the source file for `"best"`/`"target-size"`/
 * `"percent"` mode's own math: file size (free — `Blob.size`), channel count
 * (from the primary audio track's own metadata) and duration. Tries
 * `getDurationFromMetadata` first (reads the container's own duration field,
 * no packet scan) and only falls back to the expensive `computeDuration`
 * (walks every packet) when the container doesn't carry one — some ogg/webm
 * files don't. This is a second, separate `Input` from the one
 * `runConversion` builds for the actual encode (that one isn't available
 * yet — bitrate has to be picked *before* the `Conversion` is built), so a
 * small header-parse cost is paid twice; still far cheaper than a decode.
 */
function blobFrom(input: EngineInput): Blob {
  if (input.kind === "blob") return input.blob;
  if (input.kind === "bytes") return new Blob([input.bytes]);
  throw new EngineError(
    "internal",
    "mediabunny audio expected a blob/bytes input",
    { engine: ENGINE_ID },
  );
}

async function probeSourceAudio(input: EngineInput): Promise<{
  durationSec: number;
  sizeBytes: number;
  channels: number;
}> {
  const blob = blobFrom(input);

  const probe = new Input({
    source: new BlobSource(blob),
    formats: ALL_FORMATS,
  });
  try {
    const track = await probe.getPrimaryAudioTrack();
    const channels = track ? await track.getNumberOfChannels() : 2;
    const fromMetadata = await probe.getDurationFromMetadata();
    const durationSec = fromMetadata ?? (await probe.computeDuration());
    return { durationSec, sizeBytes: blob.size, channels };
  } finally {
    probe.dispose();
  }
}

/**
 * ADR-0017's "Estimates" addendum (2026-09-30): the same cheap probe
 * `runAudioTranscode` runs internally before its own target-size/percent
 * math, exposed for `src/lib/workers/probe.worker.ts` to call ahead of a job
 * even existing — a dropped file staged in the options form (not yet
 * submitted) has no `EngineTask` to build an `EngineInput` from, just a
 * `File`. Thin wrapper: `File` already satisfies `Blob`, and `probeSourceAudio`
 * only ever reads its input as one.
 */
export async function probeAudioMetadata(file: Blob): Promise<{
  durationSec: number;
  sizeBytes: number;
  channels: number;
}> {
  return probeSourceAudio({ kind: "blob", blob: file });
}

/** The byte size of a `runConversion` result — always `"bytes"` or `"opfs"`
 * (the only two kinds it ever returns, see `output.ts`). */
function resultByteSize(result: EngineResult): number {
  if (result.kind === "bytes") return result.bytes.byteLength;
  if (result.kind === "opfs") return result.size;
  throw new EngineError(
    "internal",
    `mediabunny audio target-size measurement got an unexpected result kind "${result.kind}"`,
    { engine: ENGINE_ID },
  );
}

/** Attaches ADR-0017's result-contract `note` to whichever result kind
 * `runConversion` actually produced — both kinds carry `note` today (see
 * `EngineResult`'s "opfs" doc comment for why that field was added there). */
function withNote(result: EngineResult, note: string): EngineResult {
  if (result.kind === "bytes" || result.kind === "opfs") {
    return { ...result, note };
  }
  return result;
}

export async function runAudioTranscode(
  task: EngineTask,
): Promise<EngineResult> {
  const { signal } = task;
  signal.throwIfAborted();

  const outputFormat = chosenOutputFormat(task);
  const { format, mime, candidates, majorBrand } = outputPlan(outputFormat);
  const codec = await pickAudioCodec(candidates);
  if (!codec) {
    throw new EngineError(
      "unsupported",
      `your browser can't encode ${outputFormat}`,
      { engine: ENGINE_ID },
    );
  }
  signal.throwIfAborted();

  const mode = modeOf(task.options);
  const runOnce = (
    bitrate: number | undefined,
    numberOfChannels: number | undefined,
  ): Promise<EngineResult> =>
    runConversion({
      task,
      engineId: ENGINE_ID,
      format,
      // `runConversion`'s `ext` is a bare extension (no dot) — mediabunny's
      // own `fileExtension` getter always includes the leading dot.
      ext: format.fileExtension.slice(1),
      mime,
      ...(majorBrand !== undefined && { majorBrand }),
      video: { discard: true },
      audio: {
        codec,
        bitrate,
        sampleRate: sampleRateOf(task.options),
        numberOfChannels,
      },
    });

  if (!mode || mode === "custom" || !isTargetCodec(codec)) {
    return runOnce(bitrateOf(task.options), numberOfChannelsOf(task.options));
  }

  const probe = await probeSourceAudio(task.input);
  signal.throwIfAborted();

  if (mode === "best") {
    const sourceBitrateBps =
      probe.durationSec > 0
        ? (probe.sizeBytes * 8) / probe.durationSec
        : undefined;
    const bitrate = bestQualityBitrate(codec, sourceBitrateBps);
    // Keep the source's own channel count — "best quality" never downmixes.
    return runOnce(bitrate, undefined);
  }

  // mode is "target-size" or "percent" from here — both reduce to the same
  // byte-budget math (ADR-0017: "percent maps to target = source * (1 -
  // p), then behaves exactly like target size").
  const targetBytes =
    mode === "target-size"
      ? targetSizeMBOf(task.options) * 1024 * 1024
      : targetBytesForPercent(probe.sizeBytes, percentOf(task.options));

  // ADR-0017 addendum (2026-09-30): a target the source already meets has
  // nothing to squeeze — see `alreadyUnderTargetNote`'s doc comment for the
  // `no_encodable_target_codec` bug this closes on the audio side.
  // `"percent"` can never trip this (its target is always strictly smaller
  // than the source), but a typed-in `"target-size"` MB value can be
  // anything.
  if (probe.sizeBytes <= targetBytes) {
    return {
      kind: "bytes",
      bytes: await blobFrom(task.input).arrayBuffer(),
      mime,
      note: alreadyUnderTargetNote({
        sourceBytes: probe.sizeBytes,
        targetBytes,
      }),
    };
  }

  const picked = bitrateForTargetSize({
    codec,
    targetBytes,
    durationSec: probe.durationSec,
    sourceChannels: probe.channels,
  });
  signal.throwIfAborted();

  let result = await runOnce(picked.bitrateBps, picked.channels);
  signal.throwIfAborted();
  let actualBytes = resultByteSize(result);

  // "Measure the real output. If it's over the target, step down one rate
  // and retry once" (ADR-0017) — only worth trying when the pre-encode
  // estimate thought the target was reachable at all; an already-unreachable
  // pick has nowhere lower to usefully step to.
  if (picked.reachable && actualBytes > targetBytes) {
    const lower = stepDown(codec, picked.bitrateBps);
    if (lower !== null) {
      const retry = await runOnce(lower, picked.channels);
      signal.throwIfAborted();
      result = retry;
      actualBytes = resultByteSize(retry);
    }
  }

  const note = resultNote({
    targetBytes,
    actualBytes,
    reachable: actualBytes <= targetBytes,
    downmixedToMono: picked.channels === 1,
  });

  return withNote(result, note);
}
