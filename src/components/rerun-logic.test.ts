import { describe, expect, it } from "vitest";
import { nextRunFiles, type RerunState, shouldShowRerun } from "./rerun-logic";

const base: RerunState = {
  hasOptions: true,
  hasCropField: false,
  lastOptions: { mode: "best" },
  currentOptions: { mode: "small" },
  jobStatuses: ["done"],
  hasStagedFiles: false,
};

describe("shouldShowRerun", () => {
  it("shows once settings changed after a finished run", () => {
    expect(shouldShowRerun(base)).toBe(true);
  });

  it("also shows after a failed or cancelled run", () => {
    expect(shouldShowRerun({ ...base, jobStatuses: ["error"] })).toBe(true);
    expect(shouldShowRerun({ ...base, jobStatuses: ["cancelled"] })).toBe(true);
  });

  it("hides when the settings match the last run", () => {
    expect(shouldShowRerun({ ...base, currentOptions: { mode: "best" } })).toBe(
      false,
    );
  });

  it("hides again while anything is queued or running", () => {
    expect(shouldShowRerun({ ...base, jobStatuses: ["done", "running"] })).toBe(
      false,
    );
    expect(shouldShowRerun({ ...base, jobStatuses: ["queued"] })).toBe(false);
  });

  it("hides with no run yet or no results on screen", () => {
    expect(shouldShowRerun({ ...base, lastOptions: null })).toBe(false);
    expect(shouldShowRerun({ ...base, jobStatuses: [] })).toBe(false);
  });

  it("hides for tools with no options, crop tools and staged tools", () => {
    expect(shouldShowRerun({ ...base, hasOptions: false })).toBe(false);
    expect(shouldShowRerun({ ...base, hasCropField: true })).toBe(false);
    expect(shouldShowRerun({ ...base, hasStagedFiles: true })).toBe(false);
  });

  it("treats a newly added option key as a change", () => {
    expect(
      shouldShowRerun({
        ...base,
        lastOptions: { mode: "best" },
        currentOptions: { mode: "best", quality: 0.5 },
      }),
    ).toBe(true);
  });
});

describe("nextRunFiles", () => {
  it("adds to the set while earlier results are still shown", () => {
    expect(nextRunFiles(["a"], ["b"], true, true)).toEqual(["a", "b"]);
  });

  it("replaces the set when settings changed or results were cleared", () => {
    expect(nextRunFiles(["a"], ["b"], false, true)).toEqual(["b"]);
    expect(nextRunFiles(["a"], ["b"], true, false)).toEqual(["b"]);
  });
});
