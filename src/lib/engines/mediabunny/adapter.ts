/**
 * Video transcode via mediabunny (ADR-0010), which wraps native WebCodecs —
 * no wasm codec of its own, hence `location: "bundled"` (pure JS, ships
 * inside this adapter's own dynamic-imported worker chunk, same as `psd`).
 *
 * Input reads incrementally from the dropped `File` via `BlobSource` — never
 * a full read. Output prefers OPFS (`FileSystemSyncAccessHandle`, worker-only)
 * through a `StreamTarget`, so a multi-hundred-MB transcode never has to sit
 * fully in the worker heap; a `BufferTarget` fallback (in-memory, size-capped)
 * covers the browsers/modes where OPFS isn't available. See ADR-0010 for the
 * full design and why `StreamTarget`'s non-sequential writes specifically
 * need a sync access handle rather than a sequential `createWritable()`.
 */
import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  canEncodeAudio,
  canEncodeVideo,
  Input,
  Output,
  StreamTarget,
  type StreamTargetChunk,
  WebMOutputFormat,
} from "mediabunny";
import type { Operation, StepFormat } from "@/lib/registry";
import { FORMATS } from "@/lib/registry";
import { defineEngine } from "../define-engine";
import { EngineError, toEngineError } from "../errors";
import { ENGINE_MANIFEST } from "../manifest";
import type {
  EngineAdapter,
  EngineInput,
  EngineInstance,
  EngineLoadContext,
  EngineResult,
  EngineTask,
} from "../types";
import meta from "./engine.json";

const metadata = {
  ...(meta as Pick<
    EngineAdapter,
    "id" | "license" | "location" | "needsIsolation" | "heavy"
  >),
  version: ENGINE_MANIFEST.mediabunny.version,
} satisfies Pick<
  EngineAdapter,
  "id" | "version" | "license" | "location" | "needsIsolation" | "heavy"
>;

/**
 * ADR-0010's temp directory, duplicated as a literal here rather than
 * imported from `@/lib/jobs/opfs-temp`: engines are a lower layer than
 * `jobs`, which orchestrates them, and this adapter only ever needs the
 * directory name, not any of that module's main-thread-oriented helpers
 * (`readOpfsFile`/`sweepOpfsTemp`). Keep the literal in sync with that file's
 * `OPFS_TEMP_DIR` if the convention ever changes.
 */
const OPFS_TEMP_DIR = "localvert-tmp";

/** In-memory output cap when OPFS isn't available (ADR-0010's fallback) —
 * past this, a multi-hundred-MB accumulation risks the worker's heap rather
 * than failing cleanly. */
const MAX_BUFFERED_OUTPUT_BYTES = 300 * 1024 * 1024;

function supports(
  op: Operation,
  input: StepFormat,
  output: StepFormat,
): boolean {
  return (
    op === "transcode" &&
    (input === "mp4" || input === "mov") &&
    output === "webm"
  );
}

/** Reads `task.input` down to a `Blob` — `BlobSource` reads it incrementally
 * from there, so this never materializes the file's bytes itself. */
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
        { engine: metadata.id },
      );
    case "raster":
      throw new EngineError(
        "internal",
        "mediabunny expected a bytes/blob input, got a raster",
        { engine: metadata.id },
      );
  }
}

/** True when `navigator.storage.getDirectory()` and, critically, dedicated-
 * worker-only `createSyncAccessHandle()` are both available — probed by
 * trying to open a handle rather than feature-testing the method name,
 * since a private-mode Safari can advertise the API but throw on use. */
async function tryOpenOpfsSyncHandle(
  name: string,
): Promise<FileSystemSyncAccessHandle | null> {
  try {
    if (!("storage" in navigator) || !navigator.storage.getDirectory) {
      return null;
    }
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(OPFS_TEMP_DIR, { create: true });
    const fileHandle = await dir.getFileHandle(name, { create: true });
    // `createSyncAccessHandle` exists only in a dedicated worker context —
    // absent (or throws) on the main thread and in some private modes.
    if (typeof fileHandle.createSyncAccessHandle !== "function") return null;
    return await fileHandle.createSyncAccessHandle();
  } catch {
    return null;
  }
}

/**
 * Adapts a `FileSystemSyncAccessHandle` into the `WritableStream` mediabunny's
 * `StreamTarget` writes muxed chunks through. Containers seek backward to
 * patch box sizes/lengths as they finalize, hence `chunk.position` — a sync
 * access handle's `write(data, {at})` is what makes that possible without
 * buffering the whole output first (a sequential File System Access
 * `createWritable()` stream cannot do this — see ADR-0010).
 */
function opfsWritable(
  handle: FileSystemSyncAccessHandle,
): WritableStream<StreamTargetChunk> {
  return new WritableStream<StreamTargetChunk>({
    write(chunk) {
      handle.write(chunk.data, { at: chunk.position });
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

/** Picks the first video codec this browser can actually encode, VP9 first —
 * ADR-0010's capability probe. Returns `null` if neither works, which the
 * caller turns into a clear "your browser can't encode video/webm" error
 * rather than an opaque failure partway through a long transcode. */
async function pickVideoCodec(): Promise<"vp9" | "vp8" | null> {
  if (await canEncodeVideo("vp9")) return "vp9";
  if (await canEncodeVideo("vp8")) return "vp8";
  return null;
}

async function pickAudioCodec(): Promise<"opus" | null> {
  return (await canEncodeAudio("opus")) ? "opus" : null;
}

async function run(task: EngineTask): Promise<EngineResult> {
  try {
    switch (task.op) {
      case "transcode":
        return await runTranscode(task);
      default:
        throw new EngineError(
          "unsupported",
          `mediabunny cannot run op "${task.op}"`,
          { engine: metadata.id },
        );
    }
  } catch (e) {
    throw toEngineError(e, metadata.id);
  }
}

/** transcode: mp4/mov -> webm (VP9-or-VP8 video + Opus audio), streamed
 * through OPFS when available, buffered in memory (size-capped) otherwise. */
async function runTranscode(task: EngineTask): Promise<EngineResult> {
  const { signal, onProgress } = task;
  signal.throwIfAborted();

  const videoCodec = await pickVideoCodec();
  if (!videoCodec) {
    throw new EngineError(
      "unsupported",
      "your browser can't encode video/webm",
      { engine: metadata.id },
    );
  }
  const audioCodec = await pickAudioCodec();
  signal.throwIfAborted();

  const blob = inputToBlob(task.input);
  const input = new Input({
    source: new BlobSource(blob),
    formats: ALL_FORMATS,
  });
  const format = new WebMOutputFormat();

  const mime = FORMATS.webm.mime;
  const opfsName = `${crypto.randomUUID()}.webm`;
  const syncHandle = await tryOpenOpfsSyncHandle(opfsName);

  const target = syncHandle
    ? new StreamTarget(opfsWritable(syncHandle))
    : new BufferTarget();

  const output = new Output({ format, target });

  const conversion = await Conversion.init({
    input,
    output,
    video: { codec: videoCodec },
    audio: audioCodec ? { codec: audioCodec } : { discard: true },
  });
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
    const size = syncHandle.getSize();
    return {
      kind: "opfs",
      path: `${OPFS_TEMP_DIR}/${opfsName}`,
      mime,
      size,
    };
  }

  const buffer = (target as BufferTarget).buffer;
  if (!buffer) {
    throw new EngineError(
      "encode-failed",
      "mediabunny produced no output buffer",
      { engine: metadata.id },
    );
  }
  if (buffer.byteLength > MAX_BUFFERED_OUTPUT_BYTES) {
    throw new EngineError(
      "unsupported",
      "output too large for this browser; try a browser with OPFS support",
      { engine: metadata.id },
    );
  }
  return { kind: "bytes", bytes: buffer, mime };
}

async function load(_ctx: EngineLoadContext): Promise<EngineInstance> {
  return { run, dispose };
}

function dispose(): void {
  // No engine-owned resource persists between `run()` calls — each
  // transcode opens its own `Input`/`Output`/sync access handle and closes
  // them within `runTranscode` itself.
}

export default defineEngine({
  ...metadata,
  marker: "localvert-engine:mediabunny",
  supports,
  load,
});
