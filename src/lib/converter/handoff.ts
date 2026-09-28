/**
 * ADR-0015: the in-memory file handoff between the Converter island and a
 * tool page. When the Converter navigates to `/tools/<slug>` with files
 * already staged (a drop, or choosing a target while files are staged), the
 * files travel through this module-level store instead of the URL or any
 * storage API — `File` objects can't be serialised, and the ADR is explicit
 * that "the files are never serialised and never leave the tab".
 *
 * One-shot by design: `takePendingFiles` both reads and clears an entry, so
 * a hard reload of the tool page (a fresh module instance) never sees stale
 * files, and the same handoff can't be replayed by mounting `ToolRunner`
 * twice. `hasPendingFiles` is a non-consuming peek, for a component (the
 * tool page's heading) that needs to know a handoff happened without being
 * the one that consumes it — see `src/components/tool-heading.tsx`.
 */

const pending = new Map<string, File[]>();

/** Stages `files` for the tool page at `/tools/<slug>` to pick up on mount. */
export function setPendingFiles(slug: string, files: readonly File[]): void {
  pending.set(slug, [...files]);
}

/** Reads and clears the files staged for `slug`, or `null` if none are. */
export function takePendingFiles(slug: string): File[] | null {
  const files = pending.get(slug);
  if (files === undefined) return null;
  pending.delete(slug);
  return files;
}

/** Whether files are staged for `slug`, without consuming them. */
export function hasPendingFiles(slug: string): boolean {
  return pending.has(slug);
}
