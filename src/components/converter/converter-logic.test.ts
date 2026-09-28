import { describe, expect, it } from "vitest";
import type { AcceptedFile, RejectedFile } from "@/components/dropzone-logic";
import type { PopularEntry } from "@/lib/converter/catalog";
import {
  describeCategoryMismatch,
  describeDetection,
  describeGroupCounts,
  describeMixed,
  describeUndetected,
  formatBytes,
  groupByFormat,
  popularChipLabel,
} from "./converter-logic";

function accepted(
  name: string,
  format: AcceptedFile["format"],
  size = 100,
): AcceptedFile {
  const file = new File([new Uint8Array(size)], name);
  return { file, format, extensionMismatch: false };
}

function rejected(name: string): RejectedFile {
  return {
    file: new File(["x"], name),
    reason: "unknown-format",
    detected: null,
  };
}

function rejectedAs(
  name: string,
  detected: RejectedFile["detected"],
): RejectedFile {
  return { file: new File(["x"], name), reason: "not-accepted", detected };
}

describe("formatBytes", () => {
  it("formats sub-KB sizes in bytes", () => {
    expect(formatBytes(512)).toBe("512 B");
  });

  it("formats KB and MB with one decimal", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1_258_291)).toBe("1.2 MB");
  });
});

describe("groupByFormat", () => {
  it("returns one group for a single-format drop", () => {
    const groups = groupByFormat([
      accepted("a.jpg", "jpg"),
      accepted("b.jpg", "jpg"),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.format).toBe("jpg");
    expect(groups[0]?.files).toHaveLength(2);
  });

  it("splits a mixed drop into groups in first-seen order", () => {
    const groups = groupByFormat([
      accepted("a.pdf", "pdf"),
      accepted("b.jpg", "jpg"),
      accepted("c.pdf", "pdf"),
    ]);
    expect(groups.map((g) => g.format)).toEqual(["pdf", "jpg"]);
    expect(groups[0]?.files).toHaveLength(2);
    expect(groups[1]?.files).toHaveLength(1);
  });

  it("returns an empty array for no files", () => {
    expect(groupByFormat([])).toEqual([]);
  });
});

describe("describeDetection", () => {
  it("names the file for a single-file group", () => {
    const group = {
      format: "pdf" as const,
      files: [accepted("report.pdf", "pdf", 1_258_291)],
    };
    expect(describeDetection(group, 14)).toBe(
      "Detected report.pdf — PDF document, 1.2 MB. 14 options available.",
    );
  });

  it("uses singular 'option' for a count of one", () => {
    const group = {
      format: "pdf" as const,
      files: [accepted("report.pdf", "pdf")],
    };
    expect(describeDetection(group, 1)).toContain("1 option available.");
  });

  it("names the count and total size for a multi-file group", () => {
    const group = {
      format: "jpg" as const,
      files: [accepted("a.jpg", "jpg", 500), accepted("b.jpg", "jpg", 524)],
    };
    expect(describeDetection(group, 5)).toBe(
      "Detected 2 JPEG files, 1.0 KB. 5 options available.",
    );
  });
});

describe("describeGroupCounts / describeMixed", () => {
  const groups = groupByFormat([
    accepted("a.pdf", "pdf"),
    accepted("b.pdf", "pdf"),
    accepted("c.pdf", "pdf"),
    accepted("d.jpg", "jpg"),
    accepted("e.jpg", "jpg"),
  ]);

  it("summarizes counts per group", () => {
    expect(describeGroupCounts(groups)).toBe("3 PDF, 2 JPEG");
  });

  it("wraps the summary in a call to action", () => {
    expect(describeMixed(groups)).toBe(
      "Mixed formats detected: 3 PDF, 2 JPEG. Choose one to continue.",
    );
  });
});

describe("describeUndetected", () => {
  it("lists every rejected file's name", () => {
    expect(describeUndetected([rejected("a.xyz"), rejected("b.bin")])).toBe(
      "Couldn't detect the format of: a.xyz, b.bin.",
    );
  });
});

describe("describeCategoryMismatch", () => {
  it("points to the PDF category page when a PDF is dropped on /audio", () => {
    const mismatch = describeCategoryMismatch(
      [rejectedAs("report.pdf", "pdf")],
      "audio",
    );
    expect(mismatch).toEqual({
      message: "This is a PDF file.",
      linkHref: "/pdf",
      linkText: "Try the PDF tools.",
    });
  });

  it("returns null when the rejection's format is undetected", () => {
    expect(
      describeCategoryMismatch([rejected("mystery.bin")], "audio"),
    ).toBeNull();
  });

  it("returns null when every rejected file already belongs to this category", () => {
    // mp4 is accepted on the audio page (extract-audio) even though its own
    // format category is "video" — but here it's simulating a rejection for
    // a different reason, so this only checks the "same category" branch.
    expect(
      describeCategoryMismatch([rejectedAs("song.mp3", "mp3")], "audio"),
    ).toBeNull();
  });

  it("reports only the first foreign-category rejection", () => {
    const mismatch = describeCategoryMismatch(
      [rejectedAs("doc.docx", "docx"), rejectedAs("report.pdf", "pdf")],
      "audio",
    );
    expect(mismatch?.linkHref).toBe("/document");
  });
});

describe("popularChipLabel", () => {
  it("reads the tool's own catalog title for a format target", () => {
    const entry: PopularEntry = {
      kind: "format",
      label: "Word",
      slug: "pdf-to-word",
      format: "docx",
      from: "pdf",
      rank: 1,
      title: "PDF to Word",
    };
    expect(popularChipLabel(entry)).toBe("PDF to Word");
  });

  it("reads the tool's own catalog title for an action target", () => {
    const entry: PopularEntry = {
      kind: "action",
      label: "Compress",
      slug: "compress-pdf",
      from: "pdf",
      rank: 4,
      title: "Compress PDF",
    };
    expect(popularChipLabel(entry)).toBe("Compress PDF");
  });
});
