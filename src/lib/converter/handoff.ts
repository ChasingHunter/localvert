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

/**
 * Handoff key for the home Converter island (ADR-0018). `/open` stages files
 * under it when no single tool fits, and the Converter classifies and offers
 * targets for them on mount. Not a valid tool slug, so it can't collide.
 */
export const HOME_HANDOFF_KEY = "@home";

/** Stages `files` for the tool page at `/tools/<slug>` to pick up on mount. */
export function setPendingFiles(slug: string, files: readonly File[]): void {
  pending.set(slug, [...files]);
}

const pendingOptions = new Map<string, Record<string, string>>();

/**
 * Stages option values for the tool page at `/tools/<slug>` to start with
 * (a picker row that preselects an option, `producesAlso`), or clears any
 * staged for `slug` when `options` is undefined.
 */
export function setPendingOptions(
  slug: string,
  options: Record<string, string> | undefined,
): void {
  if (options) pendingOptions.set(slug, { ...options });
  else pendingOptions.delete(slug);
}

/** The options staged for `slug`, without consuming them (safe to call from
 * a state initializer that React may run twice). */
export function peekPendingOptions(
  slug: string,
): Record<string, string> | undefined {
  return pendingOptions.get(slug);
}

/**
 * `defaults` with the staged `preset` laid over it. Only keys the tool
 * really has are taken, and each value is read as its default's type (the
 * preset travels as strings), so a stray key can't leak into the options.
 */
export function applyPresetOptions(
  defaults: Readonly<Record<string, unknown>>,
  preset: Readonly<Record<string, string>> | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...defaults };
  for (const [key, value] of Object.entries(preset ?? {})) {
    if (!(key in defaults)) continue;
    const base = defaults[key];
    out[key] =
      typeof base === "number"
        ? Number(value)
        : typeof base === "boolean"
          ? value === "true"
          : value;
  }
  return out;
}

/** Clears the options staged for `slug`; call once the page has applied them. */
export function clearPendingOptions(slug: string): void {
  pendingOptions.delete(slug);
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
