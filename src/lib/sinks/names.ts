/**
 * Entry names for the zip sink. Two independent problems live here:
 *
 * `sanitizeEntryName` makes a filename safe to write as a zip entry at all —
 * in particular, it strips any directory component so a crafted name like
 * `../../etc/passwd` can never escape the extraction directory ("zip slip")
 * when a user unzips the archive somewhere on their machine.
 *
 * `uniqueName` makes a batch of otherwise-independent sanitized names
 * collision-free, since a batch conversion can easily produce two outputs
 * that sanitize to the same string (two files named `IMG_0001.HEIC` in
 * different source folders, say).
 */

const RESERVED_CHARS = /[<>:"|?*]/g;
// Control characters (C0 + DEL) have no business in a filename and some
// zip extractors choke on them.
// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional — stripping them is the point.
const CONTROL_CHARS = /[\x00-\x1f\x7f]/g;

/** Generous but finite — long enough for any real filename, short enough
 * that no filesystem's own path-length limit ever gets hit by an entry
 * extracted next to other files. */
const MAX_NAME_LENGTH = 200;

/** Truncates `name` to `max` characters, keeping its extension intact. */
function capLength(name: string, max: number): string {
  if (name.length <= max) return name;
  const dot = name.lastIndexOf(".");
  // No extension (or a leading-dot name that survived sanitization) — just
  // hard-truncate.
  if (dot <= 0) return name.slice(0, max);
  const ext = name.slice(dot);
  if (ext.length >= max) return name.slice(0, max);
  return name.slice(0, max - ext.length) + ext;
}

/**
 * Makes `name` safe to use as a zip entry name: strips any directory
 * component (both `/` and `\`, so this is safe regardless of which OS the
 * file came from), drops control characters, swaps characters that are
 * reserved on Windows for `_`, and caps the length. A name that is empty or
 * only dots after all that becomes `"file"` rather than something that
 * could resolve to the extraction directory itself.
 */
export function sanitizeEntryName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? "";
  let result = base
    .replace(CONTROL_CHARS, "")
    .replace(RESERVED_CHARS, "_")
    .trim();

  if (result === "." || result === "..") result = "file";
  result = capLength(result, MAX_NAME_LENGTH);

  return result === "" ? "file" : result;
}

/**
 * Picks a name that hasn't been used yet in this batch, comparing
 * case-insensitively (a zip is commonly extracted onto a case-insensitive
 * filesystem — Windows, default macOS — so `Photo.png` and `photo.png`
 * collide there even though they differ in a zip's own name table). On
 * collision, appends " (2)", " (3)", ... before the extension.
 *
 * Mutates `taken` by adding the chosen name's lower-cased form — callers
 * seed it with one `new Set()` and reuse it across a whole batch so each
 * call sees every name chosen so far.
 */
export function uniqueName(taken: Set<string>, name: string): string {
  const dot = name.lastIndexOf(".");
  const base = dot === -1 ? name : name.slice(0, dot);
  const ext = dot === -1 ? "" : name.slice(dot);

  let candidate = name;
  let n = 2;
  while (taken.has(candidate.toLowerCase())) {
    candidate = `${base} (${n})${ext}`;
    n++;
  }
  taken.add(candidate.toLowerCase());
  return candidate;
}
