/**
 * Proper display names for the engines a person can actually be told about —
 * today, the consent-gated ones (`ffmpeg`, `libreoffice`). The manifest only
 * carries lowercase ids, which read fine in code but not in a sentence
 * (`engine-consent-dialog.tsx`'s title, `tool-runner.tsx`'s decline
 * message). Kept as a tiny standalone module, not exported from either of
 * those, so importing it never pulls the (code-split) consent dialog into a
 * page that only needs the name.
 */
const ENGINE_DISPLAY_NAMES: Record<string, string> = {
  ffmpeg: "FFmpeg",
  libreoffice: "LibreOffice",
};

/** Falls back to the id itself for any engine this map hasn't caught up with. */
export function engineDisplayName(engineId: string): string {
  return ENGINE_DISPLAY_NAMES[engineId] ?? engineId;
}
