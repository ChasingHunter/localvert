/**
 * Shared OPFS (Origin Private File System) helpers for `"opfs"`-kind engine
 * results (ADR-0010). A large media output is written by a worker (via
 * `FileSystemSyncAccessHandle`, which only exists in a dedicated worker) and
 * read back here by the main thread — both sides use this module for the
 * naming convention and cleanup logic, so they never drift apart.
 *
 * Every temp file lives under `/localvert-tmp/` and is named after the job
 * that produced it, so a stale sweep and a per-job delete both address the
 * same path a fresh job would have written.
 */

export const OPFS_TEMP_DIR = "localvert-tmp";

/** How long a temp file may outlive its job before the startup sweep treats
 * it as abandoned (a crashed tab, a closed window before cleanup ran). */
export const OPFS_TEMP_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** The path an "opfs" `EngineResult` for `jobId` should be written under —
 * always relative to the OPFS root, always inside `OPFS_TEMP_DIR`. */
export function opfsTempPath(jobId: string, ext: string): string {
  return `${OPFS_TEMP_DIR}/${jobId}.${ext}`;
}

/** Pure age check — `now` and `lastModified` both epoch ms — kept separate
 * from any real filesystem call so the sweep's threshold is unit-testable
 * without OPFS being available at all (e.g. under plain Vitest, no browser). */
export function isStaleOpfsTempFile(
  lastModified: number,
  now: number,
): boolean {
  return now - lastModified > OPFS_TEMP_MAX_AGE_MS;
}

/** True when this context can use OPFS at all — absent in a handful of
 * older or private-mode browsers per ADR-0010's fallback path. */
export function opfsAvailable(): boolean {
  return (
    typeof navigator !== "undefined" &&
    "storage" in navigator &&
    typeof navigator.storage.getDirectory === "function"
  );
}

/** Splits a `opfsTempPath`-shaped path into its directory segments and the
 * leaf file name — `getOpfsTempDir`/`readOpfsFile`/`deleteOpfsFile` all walk
 * from the OPFS root the same way. */
function splitPath(path: string): { dirs: string[]; name: string } {
  const parts = path.split("/").filter(Boolean);
  const name = parts.pop();
  if (!name) throw new Error(`invalid OPFS path: "${path}"`);
  return { dirs: parts, name };
}

async function walkDir(
  dirs: string[],
  create: boolean,
): Promise<FileSystemDirectoryHandle> {
  let dir = await navigator.storage.getDirectory();
  for (const segment of dirs) {
    dir = await dir.getDirectoryHandle(segment, { create });
  }
  return dir;
}

/** The `/localvert-tmp/` directory handle, creating it if it doesn't exist
 * yet (the common case: the first media job of a session). */
export async function getOpfsTempDir(): Promise<FileSystemDirectoryHandle> {
  return walkDir([OPFS_TEMP_DIR], true);
}

/**
 * Reads back an `"opfs"` result as a `File` — disk-backed, exactly like the
 * `Blob` outputs every other engine result already produces. Never reads the
 * bytes into memory itself; `File` is a `Blob` subclass and the caller (an
 * object URL, the zip sink, File System Access) streams it same as any other.
 */
export async function readOpfsFile(path: string): Promise<File> {
  const { dirs, name } = splitPath(path);
  const dir = await walkDir(dirs, false);
  const handle = await dir.getFileHandle(name);
  return handle.getFile();
}

/** Deletes one temp file. Best-effort: a file that's already gone (double
 * cleanup, a sweep racing a per-job delete) is not an error. */
export async function deleteOpfsFile(path: string): Promise<void> {
  try {
    const { dirs, name } = splitPath(path);
    const dir = await walkDir(dirs, false);
    await dir.removeEntry(name);
  } catch {
    // Already gone, or OPFS unavailable — nothing more to do either way.
  }
}

/**
 * Startup sweep: deletes every file directly under `/localvert-tmp/` whose
 * `lastModified` is older than `OPFS_TEMP_MAX_AGE_MS`. Run once per app load
 * (see `createJobEngine`) — cheap, since this directory only ever holds a
 * handful of in-flight jobs' temp files, never a long-lived archive.
 */
export async function sweepOpfsTemp(now: number = Date.now()): Promise<void> {
  if (!opfsAvailable()) return;
  try {
    const dir = await getOpfsTempDir();
    // `FileSystemDirectoryHandle` is async-iterable per the spec; not all
    // lib.dom.d.ts versions type `.entries()` yet, hence the cast.
    const entries = dir as unknown as AsyncIterable<[string, FileSystemHandle]>;
    for await (const [name, handle] of entries) {
      if (handle.kind !== "file") continue;
      const file = await (handle as FileSystemFileHandle).getFile();
      if (isStaleOpfsTempFile(file.lastModified, now)) {
        await dir.removeEntry(name).catch(() => {});
      }
    }
  } catch {
    // No OPFS support, or a transient failure listing the directory — the
    // sweep is best-effort cleanup, never load-bearing for correctness.
  }
}
