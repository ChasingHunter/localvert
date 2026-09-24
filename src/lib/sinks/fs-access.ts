// MAIN THREAD ONLY. `showSaveFilePicker` is a `window`-scoped API with no
// worker equivalent, so nothing in this file can run inside a worker.
// Everything else under src/lib/sinks/ is environment-neutral by design —
// this is the one deliberate exception.
//
// Piping a produced byte stream into the resulting file handle is I/O, not
// decode/encode/zip, so doing it here does not violate invariant 2 (no
// decode/encode/zip on the main thread, see docs/ARCHITECTURE.md
// "Concurrency and memory") — by the time this module sees the stream, the
// conversion (or zipping) that produced it has already happened in a
// worker. This module only moves already-produced bytes to disk.

/**
 * Minimal local typing for the parts of the File System Access API this
 * module uses. Not in lib.dom.d.ts yet, and adding an @types package for a
 * handful of members isn't worth the dependency.
 */
interface FileSystemFileHandle {
  createWritable(): Promise<FileSystemWritableFileStream>;
}

interface FileSystemWritableFileStream extends WritableStream<Uint8Array> {
  write(data: BufferSource | Blob | string): Promise<void>;
  close(): Promise<void>;
}

interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: readonly {
    description?: string;
    accept: Record<string, readonly string[]>;
  }[];
}

declare global {
  // Optional because most browsers (Firefox, Safari) don't implement it —
  // that's exactly what `canSaveToFileSystem` below detects.
  var showSaveFilePicker:
    | ((options?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>)
    | undefined;
}

/** True when the File System Access save picker is available in this browser. */
export function canSaveToFileSystem(): boolean {
  return typeof showSaveFilePicker === "function";
}

/**
 * Prompts the user for a save location, then pipes `stream` into it.
 * Resolves `"cancelled"` if the user dismisses the picker (the picker
 * rejects with an `AbortError` `DOMException` in that case); any other
 * failure propagates.
 */
export async function saveStreamToFile(
  stream: ReadableStream<Uint8Array>,
  suggestedName: string,
  mime: string,
): Promise<"saved" | "cancelled"> {
  if (typeof showSaveFilePicker !== "function") {
    throw new Error("File System Access API is not available");
  }

  const dot = suggestedName.lastIndexOf(".");
  const ext = dot === -1 ? [] : [suggestedName.slice(dot)];

  let handle: FileSystemFileHandle;
  try {
    handle = await showSaveFilePicker({
      suggestedName,
      types: [{ accept: { [mime]: ext } }],
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return "cancelled";
    }
    throw err;
  }

  const writable = await handle.createWritable();
  // pipeTo closes `writable` on a clean finish, so no explicit close() call
  // is needed here.
  await stream.pipeTo(writable);
  return "saved";
}
