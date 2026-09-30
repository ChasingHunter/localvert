/** `1536` -> "1.5 KB". Matches the precision the download link's size needs, no more. */
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

/** "1 file", "3 files". */
export function pluralFiles(count: number): string {
  return `${count} ${count === 1 ? "file" : "files"}`;
}

/**
 * The sizes half of a job card's status line, after "Done · ":
 * "1.2 MB → 557 KB (−54%)". The saving is shown only when `showSaving` is
 * set (a compress tool, where the shrink is the point) and the output is
 * really smaller than the input. Uses a true minus sign, not a hyphen.
 */
export function jobSizeSummary(
  job: {
    inputSize: number;
    output?: { size: number };
    outputs?: readonly { size: number }[];
  },
  showSaving = false,
): string {
  let text = formatBytes(job.inputSize);
  if (job.output) {
    text += ` → ${formatBytes(job.output.size)}`;
    const { size } = job.output;
    if (showSaving && job.inputSize > 0 && size < job.inputSize) {
      const percent = Math.round((1 - size / job.inputSize) * 100);
      if (percent >= 1) text += ` (−${percent}%)`;
    }
  }
  if (job.outputs) {
    const total = job.outputs.reduce((sum, o) => sum + o.size, 0);
    text += ` → ${pluralFiles(job.outputs.length)}, ${formatBytes(total)}`;
  }
  return text;
}
