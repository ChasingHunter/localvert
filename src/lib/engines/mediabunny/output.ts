/**
 * Shared output plumbing for every mediabunny `Conversion` run: OPFS-backed
 * `StreamTarget` (ADR-0010's primary path) with a size-capped `BufferTarget`
 * fallback, `isValid` validation, abort normalisation, and cleanup-on-failure
 * of any partial OPFS file. Extracted out of `adapter.ts` (which started as
 * the mp4/mov -> webm transcode only) so every other video op — container
 * conversion, trim, mute, resize, compress, rotate — drives the same
 * `Conversion.init`/`execute` machinery through one `runConversion` call
 * instead of duplicating it per op.
 */
import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  type ConversionAudioOptions,
  type ConversionVideoOptions,
  Input,
  Output,
  type OutputFormat,
  StreamTarget,
  type StreamTargetChunk,
} from "mediabunny";
import type { EngineId } from "@/lib/registry";
import { EngineError, NO_AUDIO_MESSAGE } from "../errors";
import type { EngineInput, EngineResult, EngineTask } from "../types";

/** ADR-0010's temp directory — see the same literal + doc comment in
 * `adapter.ts` (kept in sync manually; see that file's own note). */
const OPFS_TEMP_DIR = "localvert-tmp";

/** In-memory output cap when OPFS isn't available (ADR-0010's fallback). */
const MAX_BUFFERED_OUTPUT_BYTES = 300 * 1024 * 1024;

/** Reads `task.input` down to a `Blob` — `BlobSource` reads it incrementally
 * from there, so this never materializes the file's bytes itself. Exported
 * for `adapter.ts`'s `runVideo`, which needs the same blob a second time
 * (before `runConversion` is even called) to probe the source's own
 * bitrate via `video.ts`'s `sourceBitrates`. */
export function inputToBlob(input: EngineInput, engineId: EngineId): Blob {
  switch (input.kind) {
    case "blob":
      return input.blob;
    case "bytes":
      return new Blob([input.bytes]);
    case "opfs":
      throw new EngineError(
        "unsupported",
        "mediabunny engine does not read OPFS inputs",
        { engine: engineId },
      );
    case "raster":
      throw new EngineError(
        "internal",
        "mediabunny expected a bytes/blob input, got a raster",
        { engine: engineId },
      );
  }
}

/** Structural subset of the DOM's `FileSystemSyncAccessHandle` — see
 * `adapter.ts`'s identical interface for why this is declared locally
 * rather than referencing the lib type by name. */
interface OpfsSyncAccessHandle {
  write(buffer: BufferSource, options?: { at?: number }): number;
  flush(): void;
  close(): void;
  getSize(): number;
}

interface FileHandleWithSyncAccess {
  createSyncAccessHandle?(): Promise<OpfsSyncAccessHandle>;
}

/** True when `navigator.storage.getDirectory()` and, critically, dedicated-
 * worker-only `createSyncAccessHandle()` are both available. */
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

/** Tracks the final byte size of an OPFS-backed output as it's written —
 * see `adapter.ts`'s original doc comment on why this can't just be read
 * back from the handle after `close()`. */
class OpfsSizeTracker {
  size = 0;
  record(position: number, byteLength: number): void {
    this.size = Math.max(this.size, position + byteLength);
  }
}

/**
 * Overwrites an ISO-BMFF file's major brand (bytes 8-11, right after the
 * leading `ftyp` box's size + type) with `brand`, if `data` — written at
 * absolute file offset `position` — covers those bytes and the box type at
 * 4-7 really is `ftyp`. Mutates `data` in place; a chunk that doesn't cover
 * the brand is left alone, so it's safe to call on every chunk a
 * `StreamTarget` writes, and on a whole `BufferTarget` buffer at position 0.
 */
export function patchFtypMajorBrand(
  data: Uint8Array,
  position: number,
  brand: string,
): void {
  if (brand.length !== 4) {
    throw new Error(`ftyp major brand must be 4 characters, got "${brand}"`);
  }
  const typeAt = 4 - position;
  const brandAt = 8 - position;
  if (typeAt < 0 || brandAt + 4 > data.byteLength) return;
  const isFtyp =
    data[typeAt] === 0x66 && // f
    data[typeAt + 1] === 0x74 && // t
    data[typeAt + 2] === 0x79 && // y
    data[typeAt + 3] === 0x70; // p
  if (!isFtyp) return;
  for (let i = 0; i < 4; i++) data[brandAt + i] = brand.charCodeAt(i);
}

function opfsWritable(
  handle: OpfsSyncAccessHandle,
  sizeTracker: OpfsSizeTracker,
  majorBrand: string | undefined,
): WritableStream<StreamTargetChunk> {
  return new WritableStream<StreamTargetChunk>({
    write(chunk) {
      if (majorBrand !== undefined) {
        patchFtypMajorBrand(chunk.data, chunk.position, majorBrand);
      }
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

/** Best-effort cleanup for a partial OPFS output after a failed or aborted
 * conversion — see `adapter.ts`'s original doc comment for the double-close
 * reasoning. */
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
 * Deletes an OPFS output produced by a superseded `runConversion` pass — used
 * by ADR-0017's target-size retry loop (`adapter.ts`'s `runVideoTargetSize`,
 * via `video-planner.ts`'s `runWithSizeRetries`) to keep only one encoded
 * attempt on disk at a time instead of accumulating one per retry. A no-op
 * for a `bytes`/`stream` result — nothing was ever written to disk for
 * those, so there's nothing to clean up.
 */
export async function deleteConversionOutput(
  result: EngineResult,
): Promise<void> {
  if (result.kind !== "opfs") return;
  try {
    const slash = result.path.indexOf("/");
    const dirName = slash === -1 ? OPFS_TEMP_DIR : result.path.slice(0, slash);
    const name = slash === -1 ? result.path : result.path.slice(slash + 1);
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(dirName, { create: false });
    await dir.removeEntry(name);
  } catch {
    // Already removed, or OPFS unavailable — nothing more to do.
  }
}

/** Everything one `Conversion` run needs beyond the task itself: the output
 * container, the file extension its OPFS temp name gets, its mime, and the
 * per-track/trim options to pass to `Conversion.init`. */
export interface RunConversionArgs {
  task: EngineTask;
  engineId: EngineId;
  format: OutputFormat;
  ext: string;
  mime: string;
  /** Replaces the output's ISO-BMFF major brand (e.g. "M4A " for an
   * audio-only mp4) — see `patchFtypMajorBrand`. */
  majorBrand?: string;
  video?: ConversionVideoOptions;
  audio?: ConversionAudioOptions;
  trim?: { start?: number; end?: number };
}

/**
 * Drives one mediabunny `Conversion` end to end: builds the `Input` from
 * `task.input`, wires the given `format`/`video`/`audio`/`trim` options,
 * validates `conversion.isValid`, streams to OPFS when available (falling
 * back to a size-capped in-memory buffer), and normalises both abort and
 * partial-output cleanup. Shared by every mediabunny op — see this file's
 * top doc comment.
 */
export async function runConversion(
  args: RunConversionArgs,
): Promise<EngineResult> {
  const { task, engineId, format, ext, mime, majorBrand, video, audio, trim } =
    args;
  const { signal, onProgress } = task;
  signal.throwIfAborted();

  const blob = inputToBlob(task.input, engineId);
  const input = new Input({
    source: new BlobSource(blob),
    formats: ALL_FORMATS,
  });

  const opfsName = `${crypto.randomUUID()}.${ext}`;
  // Test-only escape hatch for ADR-0010's `BufferTarget` fallback — see
  // adapter.ts's original comment. Never set by any real tool.
  const forceBufferTarget = task.options.__forceBufferTarget === true;
  const syncHandle = forceBufferTarget
    ? null
    : await tryOpenOpfsSyncHandle(opfsName);
  const sizeTracker = new OpfsSizeTracker();

  const target = syncHandle
    ? new StreamTarget(opfsWritable(syncHandle, sizeTracker, majorBrand))
    : new BufferTarget();

  const output = new Output({ format, target });

  try {
    const conversion = await Conversion.init({
      input,
      output,
      video,
      audio,
      trim,
    });

    if (!conversion.isValid) {
      // Audio-only output from a video (video discarded) with no audio track
      // leaves nothing to write; say so plainly.
      if (audio && video?.discard && !(await input.getPrimaryAudioTrack())) {
        throw new EngineError("unsupported", NO_AUDIO_MESSAGE, {
          engine: engineId,
        });
      }
      const reasons = conversion.discardedTracks
        .map((d) => d.reason)
        .join(", ");
      throw new EngineError(
        "unsupported",
        "can't produce a valid output from this input in this browser" +
          (reasons ? ` (${reasons})` : ""),
        { engine: engineId },
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
        { engine: engineId },
      );
    }
    if (buffer.byteLength > MAX_BUFFERED_OUTPUT_BYTES) {
      throw new EngineError(
        "unsupported",
        "output too large for this browser; try a browser with OPFS support",
        { engine: engineId },
      );
    }
    if (majorBrand !== undefined) {
      patchFtypMajorBrand(new Uint8Array(buffer), 0, majorBrand);
    }
    return { kind: "bytes", bytes: buffer, mime };
  } catch (e) {
    if (syncHandle) {
      await cleanupFailedOpfsOutput(syncHandle, opfsName);
    }
    // `conversion.cancel()` (triggered by `onAbort` above) rejects
    // `execute()` with mediabunny's own `ConversionCanceledError`, not a
    // `DOMException` `toEngineError` would recognize as an abort —
    // normalize it here so an aborted task always surfaces as
    // `EngineError("aborted")` like every other engine's abort path.
    if (signal.aborted) {
      throw new EngineError("aborted", "conversion aborted", {
        engine: engineId,
        cause: e,
      });
    }
    throw e;
  }
}
