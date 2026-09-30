/**
 * `1536` -> "1.5 KB". Shared by every compress adapter's ADR-0017 result
 * notes ("48 KB, 96% of your 50 KB target.") — a worker-side duplicate of
 * `job-card.tsx`'s own `formatBytes` (that one is UI component code, not
 * importable from an engine adapter that must stay DOM-free and run inside a
 * worker), kept in sync by matching precision and unit rules exactly.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}
