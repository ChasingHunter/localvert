import { describe, expect, it } from "vitest";
import { z } from "zod";
import { outputFileName } from "./naming";
import type { ToolDefinition } from "./types";

function tool(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    slug: "jpg-to-png",
    category: "image",
    title: "JPG to PNG",
    description: "Convert JPG images to PNG in your browser.",
    accepts: ["jpg"],
    produces: "png",
    options: z.object({}),
    defaults: {},
    pipeline: [{ op: "transcode", candidates: [{ engine: "canvas" }] }],
    batch: true,
    ...overrides,
  };
}

describe("outputFileName", () => {
  it("swaps the extension, case-insensitively", () => {
    expect(outputFileName(tool(), "photo.JPG", {})).toBe("photo.png");
  });

  it("replaces only the last extension", () => {
    expect(outputFileName(tool(), "archive.tar.gz", {})).toBe(
      "archive.tar.png",
    );
  });

  it("appends an extension when the input has none", () => {
    expect(outputFileName(tool(), "noext", {})).toBe("noext.png");
  });

  it("uses the tool's own outputName when given one", () => {
    const t = tool({
      outputName: (inputName) => `custom-${inputName}`,
    });
    expect(outputFileName(t, "photo.jpg", {})).toBe("custom-photo.jpg");
  });

  it('produces: "same" keeps the input name (and its extension\'s case) unchanged', () => {
    const t = tool({ accepts: ["jpg", "png", "webp"], produces: "same" });
    expect(outputFileName(t, "photo.JPG", {})).toBe("photo.JPG");
    expect(outputFileName(t, "archive.tar.gz", {})).toBe("archive.tar.gz");
    expect(outputFileName(t, "noext", {})).toBe("noext");
  });
});
