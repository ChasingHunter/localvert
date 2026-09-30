import { describe, expect, it } from "vitest";
import { formatBytes, jobSizeSummary, pluralFiles } from "./job-summary";

const out = (size: number) => ({ size });

describe("pluralFiles", () => {
  it("pluralises", () => {
    expect(pluralFiles(1)).toBe("1 file");
    expect(pluralFiles(3)).toBe("3 files");
  });
});

describe("jobSizeSummary", () => {
  it("says '1 file', not '1 files', for a one-file split", () => {
    const text = jobSizeSummary({ inputSize: 2048, outputs: [out(1024)] });
    expect(text).toBe("2.0 KB → 1 file, 1.0 KB");
  });

  it("says '3 files' for several outputs", () => {
    const text = jobSizeSummary({
      inputSize: 4096,
      outputs: [out(1024), out(1024), out(1024)],
    });
    expect(text).toBe("4.0 KB → 3 files, 3.0 KB");
  });

  it("shows the saving with a real minus sign when showSaving is on", () => {
    const text = jobSizeSummary(
      { inputSize: 1_258_291, output: out(570_368) },
      true,
    );
    expect(text).toBe(`${formatBytes(1_258_291)} → 557 KB (−55%)`);
  });

  it("omits the saving when showSaving is off", () => {
    expect(jobSizeSummary({ inputSize: 2000, output: out(1000) }, false)).toBe(
      "2.0 KB → 1000 B",
    );
  });

  it("omits the saving when the output is not smaller", () => {
    expect(jobSizeSummary({ inputSize: 1000, output: out(1000) }, true)).toBe(
      "1000 B → 1000 B",
    );
    expect(jobSizeSummary({ inputSize: 1000, output: out(2000) }, true)).toBe(
      "1000 B → 2.0 KB",
    );
  });
});
