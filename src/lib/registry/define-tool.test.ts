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

  it("accepts a tool with no rank", () => {
    const def = validDef();
    expect(() => defineTool(def)).not.toThrow();
  });

  it("accepts a positive integer rank", () => {
    const def = validDef({ rank: 1 });
    expect(() => defineTool(def)).not.toThrow();
  });

  it("rejects a rank of zero", () => {
    const def = validDef({ rank: 0 });
    expect(() => defineTool(def)).toThrow(/^\[tool jpg-to-png\]/);
  });

  it("accepts a positive integer categoryRank and rejects anything else", () => {
    expect(() => defineTool(validDef({ categoryRank: 1 }))).not.toThrow();
    expect(() => defineTool(validDef({ categoryRank: 0 }))).toThrow(
      /^\[tool jpg-to-png\]/,
    );
    expect(() => defineTool(validDef({ categoryRank: 2.5 }))).toThrow(
      /^\[tool jpg-to-png\]/,
    );
  });

  it("rejects a non-integer rank", () => {
    const def = validDef({ rank: 1.5 });
    expect(() => defineTool(def)).toThrow(/^\[tool jpg-to-png\]/);
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

  it("computes requiredOptionKeys from fields meta'd required: true", () => {
    const def = validDef({
      options: z.object({
        password: z
          .string()
          .meta({ label: "Password", control: "password", required: true }),
        allowPrinting: z
          .boolean()
          .meta({ label: "Allow printing", control: "switch" }),
      }),
      defaults: { password: "", allowPrinting: true },
    });
    expect(defineTool(def).requiredOptionKeys).toEqual(["password"]);
  });

  it("hasFormFields is false when every option is crop or hidden", () => {
    const def = validDef({
      options: z.object({
        crop: z
          .object({ x: z.number() })
          .meta({ label: "Crop", control: "crop" }),
        mode: z.enum(["a"]).meta({ label: "Mode", control: "hidden" }),
      }),
      defaults: { crop: { x: 0 }, mode: "a" },
    });
    expect(defineTool(def).hasFormFields).toBe(false);
  });

  it("hasFormFields is true once any option renders", () => {
    const def = validDef({
      options: z.object({
        crop: z
          .object({ x: z.number() })
          .meta({ label: "Crop", control: "crop" }),
        note: z.string().meta({ label: "Note", control: "text" }),
      }),
      defaults: { crop: { x: 0 }, note: "" },
    });
    expect(defineTool(def).hasFormFields).toBe(true);
  });

  it("records the showWhen of a required field that has one", () => {
    const def = validDef({
      options: z.object({
        mode: z.enum(["a", "b"]).meta({ label: "Mode", control: "select" }),
        text: z.string().meta({
          label: "Text",
          control: "text",
          required: true,
          showWhen: { field: "mode", equals: "b" },
        }),
      }),
      defaults: { mode: "a", text: "" },
    });
    const tool = defineTool(def);
    expect(tool.requiredOptionKeys).toEqual(["text"]);
    expect(tool.requiredOptionShowWhen).toEqual({
      text: { field: "mode", equals: "b" },
    });
  });

  it("computes an empty requiredOptionKeys when no field is required", () => {
    const def = validDef();
    expect(defineTool(def).requiredOptionKeys).toEqual([]);
  });
});
