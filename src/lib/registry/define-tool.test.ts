import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineTool } from "./define-tool";
import type { FormatId } from "./formats";
import type { ToolDefinition } from "./types";

function validDef(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
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

describe("defineTool", () => {
  it("returns the same object for a valid definition", () => {
    const def = validDef();
    expect(defineTool(def)).toBe(def);
  });

  it("rejects a slug that is not lowercase kebab-case", () => {
    const def = validDef({ slug: "JPG_to_PNG" });
    expect(() => defineTool(def)).toThrow(/^\[tool JPG_to_PNG\]/);
  });

  it("rejects an empty title", () => {
    const def = validDef({ title: "  " });
    expect(() => defineTool(def)).toThrow(/^\[tool jpg-to-png\]/);
  });

  it("rejects an empty description", () => {
    const def = validDef({ description: "" });
    expect(() => defineTool(def)).toThrow(/^\[tool jpg-to-png\]/);
  });

  it("rejects an empty accepts list", () => {
    const def = validDef({ accepts: [] });
    expect(() => defineTool(def)).toThrow(/^\[tool jpg-to-png\]/);
  });

  it("rejects an accepts entry that is not a known format", () => {
    const def = validDef({ accepts: ["nope" as FormatId] });
    expect(() => defineTool(def)).toThrow(/^\[tool jpg-to-png\]/);
  });

  it("rejects a produces value that is not a known format", () => {
    const def = validDef({ produces: "nope" as FormatId });
    expect(() => defineTool(def)).toThrow(/^\[tool jpg-to-png\]/);
  });

  it('accepts produces: "same" without requiring a FORMATS entry', () => {
    const def = validDef({ produces: "same" });
    expect(() => defineTool(def)).not.toThrow();
  });

  it("rejects defaults that do not satisfy the options schema", () => {
    const def = validDef({
      options: z.object({ quality: z.number().min(1).max(100) }),
      defaults: { quality: 200 },
    });
    expect(() => defineTool(def)).toThrow(/^\[tool jpg-to-png\]/);
  });

  it("rejects an empty pipeline", () => {
    const def = validDef({ pipeline: [] });
    expect(() => defineTool(def)).toThrow(/^\[tool jpg-to-png\]/);
  });

  it("rejects a pipeline step with no engine candidates", () => {
    const def = validDef({ pipeline: [{ op: "transcode", candidates: [] }] });
    expect(() => defineTool(def)).toThrow(/^\[tool jpg-to-png\]/);
  });

  it("rejects a pipeline step whose last candidate has a when predicate", () => {
    const def = validDef({
      pipeline: [
        {
          op: "transcode",
          candidates: [{ engine: "canvas", when: () => true }],
        },
      ],
    });
    expect(() => defineTool(def)).toThrow(/^\[tool jpg-to-png\]/);
  });
});
