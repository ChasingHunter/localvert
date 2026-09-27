/**
 * Audio transcode via mediabunny (ADR-0010, extended for Phase 3b), covering
 * both "extract the audio track from a video container" and "re-encode one
 * audio container/codec as another". Shares its shape with `adapter.ts`'s
 * `runTranscode` (same `Conversion`/OPFS/`BufferTarget`-fallback plumbing),
 * but lives in its own file so this slice doesn't collide with the parallel
 * `output.ts` refactor of that plumbing — see this file's own OPFS helpers
 * below, a deliberate small duplication rather than an import of
 * `adapter.ts`'s private (unexported) versions.
 *
 * `video: { discard: true }` is passed for every conversion here, audio-only
 * inputs included — harmless (there's no video track to discard) and it
 * means the same code path serves `extract-audio` (mp4/mov/webm -> audio)
 * and a plain audio-to-audio re-encode identically.
 */
import { registerMp3Encoder } from "@mediabunny/mp3-encoder";
import {
  ALL_FORMATS,
  type AudioCodec,
  BlobSource,
  BufferTarget,
  Conversion,
  canEncodeAudio,
  FlacOutputFormat,
  Input,
  Mp3OutputFormat,
  Mp4OutputFormat,
  OggOutputFormat,
  Output,
  type OutputFormat,
  StreamTarget,
  type StreamTargetChunk,
  WavOutputFormat,
} from "mediabunny";
import type { Operation, StepFormat } from "@/lib/registry";
import { FORMATS } from "@/lib/registry";
import { EngineError, toEngineError } from "../errors";
import type { EngineInput, EngineResult, EngineTask } from "../types";

const ENGINE_ID = "mediabunny";

/** Duplicated from adapter.ts's own `OPFS_TEMP_DIR` literal — see that
 * file's doc comment on why the directory name is a literal, not an
 * import, at this layer. Keep the two in sync if the convention changes. */
const OPFS_TEMP_DIR = "localvert-tmp";

/** Same cap as adapter.ts's `MAX_BUFFERED_OUTPUT_BYTES` — audio output is
 * far smaller than video in practice, but the fallback still needs a firm
 * ceiling rather than an unbounded in-memory accumulation. */
const MAX_BUFFERED_OUTPUT_BYTES = 300 * 1024 * 1024;

/** The audio-only formats this file knows how to produce, and the tools
 * that read from them. `extract-audio`'s video/container inputs (mp4, mov,
 * webm) are supported as inputs but never as outputs here. */
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
  "mp3",
  "wav",
  "flac",
  "ogg",
  "opus",
  "m4a",
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

/** Picks the output container + the codec candidates worth trying for it,
 * in preference order. `wav` uses PCM, which mediabunny encodes itself (no
 * WebCodecs involved, so no capability probe needed) — every other target
 * codec is probed via `canEncodeAudio` before use. */
function outputPlan(output: StepFormat): {
  format: OutputFormat;
  mime: string;
  candidates: readonly AudioCodec[];
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
    if (codec.startsWith("pcm-")) return codec; // mediabunny encodes PCM itself.
    if (await canEncodeAudio(codec)) return codec;
  }
  return null;
}

function inputToBlob(input: EngineInput): Blob {
  switch (input.kind) {
    case "blob":
      return input.blob;
    case "bytes":
      return new Blob([input.bytes]);
    case "opfs":
      throw new EngineError(
        "unsupported",
        "mediabunny engine does not read OPFS inputs",
        { engine: ENGINE_ID },
      );
    case "raster":
      throw new EngineError(
        "internal",
        "mediabunny expected a bytes/blob input, got a raster",
        { engine: ENGINE_ID },
      );
  }
}

/** Structural subset of `FileSystemSyncAccessHandle` — duplicated from
 * adapter.ts's identical local interface; see that file's doc comment for
 * why it's declared locally rather than referencing the DOM lib type. */
interface OpfsSyncAccessHandle {
  write(buffer: BufferSource, options?: { at?: number }): number;
  flush(): void;
  close(): void;
  getSize(): number;
}

interface FileHandleWithSyncAccess {
  createSyncAccessHandle?(): Promise<OpfsSyncAccessHandle>;
}

async function tryOpenOpfsSyncHandle(
  name: string,
): Promise<OpfsSyncAccessHandle | null> {
  try {
    if (!("storage" in navigator) || !navigator.storage.getDirectory) {
      return null;
    }
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(OPFS_TEMP_DIR, { create: true });
    const fileHandle = (await dir.getFileHandle(name, {
      create: true,
    })) as FileSystemFileHandle & FileHandleWithSyncAccess;
    if (typeof fileHandle.createSyncAccessHandle !== "function") return null;
    return await fileHandle.createSyncAccessHandle();
  } catch {
    return null;
  }
}

class OpfsSizeTracker {
  size = 0;
  record(position: number, byteLength: number): void {
    this.size = Math.max(this.size, position + byteLength);
  }
}

function opfsWritable(
  handle: OpfsSyncAccessHandle,
  sizeTracker: OpfsSizeTracker,
): WritableStream<StreamTargetChunk> {
  return new WritableStream<StreamTargetChunk>({
    write(chunk) {
      handle.write(chunk.data, { at: chunk.position });
      sizeTracker.record(chunk.position, chunk.data.byteLength);
    },
    close() {
      handle.flush();
      handle.close();
    },
    abort() {
      handle.close();
    },
  });
}

async function cleanupFailedOpfsOutput(
  handle: OpfsSyncAccessHandle,
  name: string,
): Promise<void> {
  try {
    handle.close();
  } catch {
    // Already closed by the writable's close()/abort() — fine.
  }
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(OPFS_TEMP_DIR, {
      create: false,
    });
    await dir.removeEntry(name);
  } catch {
    // Never created, or already removed — nothing more to do.
  }
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

export async function runAudioTranscode(
  task: EngineTask,
): Promise<EngineResult> {
  const { signal, onProgress } = task;
  signal.throwIfAborted();

  const outputFormat = chosenOutputFormat(task);
  const { format, mime, candidates } = outputPlan(outputFormat);
  const codec = await pickAudioCodec(candidates);
  if (!codec) {
    throw new EngineError(
      "unsupported",
      `your browser can't encode ${outputFormat}`,
      { engine: ENGINE_ID },
    );
  }
  signal.throwIfAborted();

  const blob = inputToBlob(task.input);
  const input = new Input({
    source: new BlobSource(blob),
    formats: ALL_FORMATS,
  });

  const opfsName = `${crypto.randomUUID()}${format.fileExtension}`;
  // Same test-only escape hatch as adapter.ts's `runTranscode` — never set
  // by a real tool's options schema.
  const forceBufferTarget = task.options.__forceBufferTarget === true;
  const syncHandle = forceBufferTarget
    ? null
    : await tryOpenOpfsSyncHandle(opfsName);
  const sizeTracker = new OpfsSizeTracker();

  const target = syncHandle
    ? new StreamTarget(opfsWritable(syncHandle, sizeTracker))
    : new BufferTarget();

  const output = new Output({ format, target });

  try {
    const conversion = await Conversion.init({
      input,
      output,
      video: { discard: true },
      audio: {
        codec,
        bitrate: bitrateOf(task.options),
        sampleRate: sampleRateOf(task.options),
        numberOfChannels: numberOfChannelsOf(task.options),
      },
    });

    if (!conversion.isValid) {
      const reasons = conversion.discardedTracks
        .map((d) => d.reason)
        .join(", ");
      throw new EngineError(
        "unsupported",
        `can't produce a valid ${outputFormat} from this input in this browser` +
          (reasons ? ` (${reasons})` : ""),
        { engine: ENGINE_ID },
      );
    }

    conversion.onProgress = (fraction) => onProgress?.(fraction);

    const onAbort = (): void => {
      void conversion.cancel();
    };
    signal.addEventListener("abort", onAbort);
    try {
      await conversion.execute();
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
    signal.throwIfAborted();

    if (syncHandle) {
      return {
        kind: "opfs",
        path: `${OPFS_TEMP_DIR}/${opfsName}`,
        mime,
        size: sizeTracker.size,
      };
    }

    const buffer = (target as BufferTarget).buffer;
    if (!buffer) {
      throw new EngineError(
        "encode-failed",
        "mediabunny produced no output buffer",
        { engine: ENGINE_ID },
      );
    }
    if (buffer.byteLength > MAX_BUFFERED_OUTPUT_BYTES) {
      throw new EngineError(
        "unsupported",
        "output too large for this browser; try a browser with OPFS support",
        { engine: ENGINE_ID },
      );
    }
    return { kind: "bytes", bytes: buffer, mime };
  } catch (e) {
    if (syncHandle) {
      await cleanupFailedOpfsOutput(syncHandle, opfsName);
    }
    if (signal.aborted) {
      throw new EngineError("aborted", "transcode aborted", {
        engine: ENGINE_ID,
        cause: e,
      });
    }
    throw toEngineError(e, ENGINE_ID);
  }
}
