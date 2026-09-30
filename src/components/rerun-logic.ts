/**
 * The "Run again with new settings" button's rules, kept pure so they're
 * unit-testable without rendering `ToolRunner`.
 *
 * `ToolRunner` remembers the options the last run used (`lastOptions`) and
 * the files it ran on. The button appears only when the user has since
 * changed a setting, nothing is running, something has finished, and no
 * staged file is already waiting on its own run button.
 */

export type RerunJobStatus =
  | "queued"
  | "running"
  | "done"
  | "error"
  | "cancelled";

export interface RerunState {
  /** The tool has at least one option field the user can change. */
  hasOptions: boolean;
  /** Crop tools submit through their own editor, never through a re-run. */
  hasCropField: boolean;
  /** Options the last run was submitted with, or `null` if none yet. */
  lastOptions: Readonly<Record<string, unknown>> | null;
  currentOptions: Readonly<Record<string, unknown>>;
  jobStatuses: readonly RerunJobStatus[];
  /** Files sitting in a staged list with their own run button. */
  hasStagedFiles: boolean;
}

/** Option values are plain JSON-ish data, so per-key stringify is enough. */
export function sameOptions(
  a: Readonly<Record<string, unknown>>,
  b: Readonly<Record<string, unknown>>,
): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) return false;
  }
  return true;
}

export function shouldShowRerun(state: RerunState): boolean {
  if (!state.hasOptions || state.hasCropField || state.hasStagedFiles) {
    return false;
  }
  if (state.lastOptions === null) return false;
  if (state.jobStatuses.length === 0) return false;
  if (state.jobStatuses.some((s) => s === "queued" || s === "running")) {
    return false;
  }
  return !sameOptions(state.lastOptions, state.currentOptions);
}

/**
 * The files a re-run should use after a new drop. Files dropped while the
 * earlier results are still on screen with unchanged settings are added to
 * the set; otherwise the new drop replaces it.
 */
export function nextRunFiles<T>(
  previous: readonly T[],
  dropped: readonly T[],
  optionsUnchanged: boolean,
  hasJobs: boolean,
): T[] {
  return optionsUnchanged && hasJobs ? [...previous, ...dropped] : [...dropped];
}
