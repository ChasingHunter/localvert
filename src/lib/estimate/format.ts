/** "19.4 MB" / "3.1 MB" / "20 MB" — one decimal, trailing ".0" dropped, same
 * rule as `mediabunny/audio-target.ts`'s and `shared/pdf-compress-target.ts`'s
 * own `formatMB`, deliberately duplicated here rather than imported: this
 * module runs on the *main* thread (`size-estimate.tsx`), and importing
 * either of those would work today (both are pure, DOM-free math) but ties
 * this file's bundle to staying that way — a three-line formatter isn't
 * worth that coupling. */
export function formatMB(bytes: number): string {
  const rounded = Math.round((bytes / (1024 * 1024)) * 10) / 10;
  const text = Number.isInteger(rounded)
    ? rounded.toFixed(0)
    : rounded.toFixed(1);
  return `${text} MB`;
}

/** Same idea as `pdf-compress-target.ts`'s `formatAchieved`: anything under
 * 1 MB reads in KB, so a small estimate says "307 KB" rather than "0.3 MB". */
export function formatAchieved(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return formatMB(bytes);
}
