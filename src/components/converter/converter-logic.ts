/**
 * ADR-0015: pure helpers for the Converter island (`converter.tsx`) —
 * grouping dropped files by detected format and building the polite live
 * region's announcement text. Kept framework-free and unit-tested, same
 * split as `combobox-logic.ts` and `dropzone-logic.ts`.
 */

import type { AcceptedFile, RejectedFile } from "@/components/dropzone-logic";
import type { PopularEntry } from "@/lib/converter/catalog";
import { FORMATS, type FormatId } from "@/lib/registry/formats";

/** One detected format among a drop's files, in first-seen order. */
export interface DetectedGroup {
  format: FormatId;
  files: AcceptedFile[];
}

/**
 * Splits a drop's accepted files by detected format, preserving the order
 * each format was first seen in — so a single-format drop always yields
 * exactly one group, and a mixed drop's groups render in a stable order
 * across re-renders.
 */
export function groupByFormat(files: readonly AcceptedFile[]): DetectedGroup[] {
  const order: FormatId[] = [];
  const byFormat = new Map<FormatId, AcceptedFile[]>();
  for (const file of files) {
    let group = byFormat.get(file.format);
    if (!group) {
      group = [];
      byFormat.set(file.format, group);
      order.push(file.format);
    }
    group.push(file);
  }
  return order.map((format) => ({
    format,
    files: byFormat.get(format) as AcceptedFile[],
  }));
}

/** "1.2 MB" / "840 KB" / "512 B" — no library, matches the ADR's example. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

/**
 * The live region's announcement once a drop resolves to exactly one
 * detected format — the ADR's own example: "Detected report.pdf — PDF
 * document, 1.2 MB. 14 options available." A multi-file drop of the same
 * format instead names the count, since no single filename applies.
 */
export function describeDetection(
  group: DetectedGroup,
  optionCount: number,
): string {
  const label = FORMATS[group.format].label;
  const options = `${optionCount} option${optionCount === 1 ? "" : "s"} available.`;
  if (group.files.length === 1) {
    const file = group.files[0] as AcceptedFile;
    const size = formatBytes(file.file.size);
    return `Detected ${file.file.name} — ${label} document, ${size}. ${options}`;
  }
  const totalSize = formatBytes(
    group.files.reduce((sum, f) => sum + f.file.size, 0),
  );
  return `Detected ${group.files.length} ${label} files, ${totalSize}. ${options}`;
}

/** A mixed drop's "3 PDF, 2 JPG" summary — one clause per group, in the
 * order `groupByFormat` returned them. */
export function describeGroupCounts(groups: readonly DetectedGroup[]): string {
  return groups
    .map((g) => `${g.files.length} ${FORMATS[g.format].label}`)
    .join(", ");
}

/** The live region's announcement for a mixed-format drop, before the user
 * picks which group to continue with. */
export function describeMixed(groups: readonly DetectedGroup[]): string {
  return `Mixed formats detected: ${describeGroupCounts(groups)}. Choose one to continue.`;
}

/** The live region's announcement when nothing in the drop could be
 * identified — always names the files, never a silent no-op (ADR-0015). */
export function describeUndetected(rejected: readonly RejectedFile[]): string {
  const names = rejected.map((r) => r.file.name).join(", ");
  return `Couldn't detect the format of: ${names}.`;
}

/** A Popular chip's link text — the tool's own catalog title ("PDF to
 * Word", "Compress PDF"), already short and chip-ready for every ranked
 * tool. Composing it from `FORMATS` labels instead (e.g. "JPEG to PNG")
 * would be longer and duplicate a string the catalog already carries. */
export function popularChipLabel(entry: PopularEntry): string {
  return entry.title;
}
