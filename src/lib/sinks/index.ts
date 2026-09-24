/**
 * Where converted output goes: a `Blob` for a single file (`collect.ts`), a
 * streaming zip for a batch (`zip.ts`, `names.ts`), or straight to disk via
 * the File System Access API where the browser supports it (`fs-access.ts`
 * — main thread only, see the comment at the top of that file).
 *
 * TODO: an OPFS spill sink for outputs too large to hold as a `Blob`
 * (~200 MB+, per docs/ARCHITECTURE.md "Concurrency and memory") is not part
 * of this slice. See docs/ROADMAP.md for when it's planned.
 */
export { collectToBlob } from "./collect";
export {
  canSaveToFileSystem,
  saveStreamToFile,
} from "./fs-access";
export { sanitizeEntryName, uniqueName } from "./names";
export type { ZipEntry, ZipSink } from "./zip";
export { createZipSink } from "./zip";
