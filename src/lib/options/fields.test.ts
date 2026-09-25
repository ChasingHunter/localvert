import { describe, expect, it } from "vitest";
import { z } from "zod";
import { describeFields, validateOptions } from "./fields";

describe("describeFields", () => {
  it("describes a switch control from a boolean field", () => {
    const schema = z.object({
      grayscale: z.boolean().meta({ label: "Grayscale", control: "switch" }),
    });
    expect(describeFields(schema)).toEqual([
      { key: "grayscale", label: "Grayscale", control: "switch" },
    ]);
  });

  it("describes a select control from an enum field, value as label", () => {
    const schema = z.object({
      format: z
        .enum(["jpg", "png", "webp"])
        .meta({ label: "Output format", control: "select" }),
    });
    expect(describeFields(schema)).toEqual([
      {
        key: "format",
        label: "Output format",
        control: "select",
        options: [
          { value: "jpg", label: "jpg" },
          { value: "png", label: "png" },
          { value: "webp", label: "webp" },
        ],
      },
    ]);
  });

  it("describes a slider control with min/max/step from zod checks", () => {
    const schema = z.object({
      quality: z
        .number()
        .min(0)
        .max(100)
        .meta({ label: "Quality", control: "slider", unit: "%" }),
    });
    expect(describeFields(schema)).toEqual([
      {
        key: "quality",
        label: "Quality",
        control: "slider",
        unit: "%",
        min: 0,
        max: 100,
        step: 1,
      },
    ]);
  });

  it("uses step 1 for an .int() slider instead of (max-min)/100", () => {
    const schema = z.object({
      rotate: z
        .number()
        .int()
        .min(0)
        .max(270)
        .meta({ label: "Rotate", control: "slider" }),
    });
    expect(describeFields(schema)).toMatchObject([
      { min: 0, max: 270, step: 1 },
    ]);
  });

  it("uses a fractional step for a non-integer slider", () => {
    const schema = z.object({
      opacity: z
        .number()
        .min(0)
        .max(1)
        .meta({ label: "Opacity", control: "slider" }),
    });
    expect(describeFields(schema)).toMatchObject([
      { min: 0, max: 1, step: 0.01 },
    ]);
  });

  it("uses an explicit meta.step over the derived (max-min)/100", () => {
    const schema = z.object({
      quality: z
        .number()
        .min(0.1)
        .max(1)
        .meta({ label: "Quality", control: "slider", step: 0.01 }),
    });
    expect(describeFields(schema)).toMatchObject([
      { min: 0.1, max: 1, step: 0.01 },
    ]);
  });

  it("uses an explicit meta.step for an .int() slider too, overriding step 1", () => {
    const schema = z.object({
      effort: z
        .number()
        .int()
        .min(1)
        .max(9)
        .meta({ label: "Effort", control: "slider", step: 2 }),
    });
    expect(describeFields(schema)).toMatchObject([{ min: 1, max: 9, step: 2 }]);
  });

  it("describes a number control without requiring finite bounds", () => {
    const schema = z.object({
      seed: z.number().meta({ label: "Seed", control: "number" }),
    });
    expect(describeFields(schema)).toMatchObject([
      {
        key: "seed",
        control: "number",
        min: Number.NEGATIVE_INFINITY,
        max: Number.POSITIVE_INFINITY,
      },
    ]);
  });

  it("describes a text control from a string field", () => {
    const schema = z.object({
      suffix: z.string().meta({ label: "Suffix", control: "text" }),
    });
    expect(describeFields(schema)).toEqual([
      { key: "suffix", label: "Suffix", control: "text" },
    ]);
  });

  it("describes a crop control from an object field, optional and all", () => {
    const schema = z.object({
      crop: z
        .object({
          x: z.number().int().nonnegative(),
          y: z.number().int().nonnegative(),
          width: z.number().int().nonnegative(),
          height: z.number().int().nonnegative(),
        })
        .meta({ label: "Crop", control: "crop" })
        .optional(),
    });
    expect(describeFields(schema)).toEqual([
      { key: "crop", label: "Crop", control: "crop" },
    ]);
  });

  it("carries help text through", () => {
    const schema = z.object({
      strip: z.boolean().meta({
        label: "Strip metadata",
        control: "switch",
        help: "Removes EXIF and other embedded metadata.",
      }),
    });
    expect(describeFields(schema)).toMatchObject([
      { help: "Removes EXIF and other embedded metadata." },
    ]);
  });

  it("unwraps an optional wrapper to reach the meta beneath it", () => {
    const schema = z.object({
      grayscale: z
        .boolean()
        .meta({ label: "Grayscale", control: "switch" })
        .optional(),
    });
    expect(describeFields(schema)).toEqual([
      { key: "grayscale", label: "Grayscale", control: "switch" },
    ]);
  });

  it("unwraps a default wrapper to reach the meta beneath it", () => {
    const schema = z.object({
      quality: z
        .number()
        .min(0)
        .max(100)
        .meta({ label: "Quality", control: "slider" })
        .default(80),
    });
    expect(describeFields(schema)).toMatchObject([
      { key: "quality", control: "slider", min: 0, max: 100 },
    ]);
  });

  it("preserves schema.shape declaration order", () => {
    const schema = z.object({
      c: z.boolean().meta({ label: "C", control: "switch" }),
      a: z.boolean().meta({ label: "A", control: "switch" }),
      b: z.boolean().meta({ label: "B", control: "switch" }),
    });
    expect(describeFields(schema).map((f) => f.key)).toEqual(["c", "a", "b"]);
  });

  it("throws when a field has no meta at all", () => {
    const schema = z.object({ grayscale: z.boolean() });
    expect(() => describeFields(schema)).toThrow(
      /^\[options\] field grayscale:/,
    );
  });

  it("throws when meta has a control but no label", () => {
    const schema = z.object({
      grayscale: z.boolean().meta({ control: "switch" }),
    });
    expect(() => describeFields(schema)).toThrow(
      /^\[options\] field grayscale:/,
    );
  });

  it("throws when meta has a label but no control", () => {
    const schema = z.object({
      grayscale: z.boolean().meta({ label: "Grayscale" }),
    });
    expect(() => describeFields(schema)).toThrow(
      /^\[options\] field grayscale:/,
    );
  });

  it("throws when control is switch but the field is not boolean", () => {
    const schema = z.object({
      grayscale: z.string().meta({ label: "Grayscale", control: "switch" }),
    });
    expect(() => describeFields(schema)).toThrow(
      /^\[options\] field grayscale:/,
    );
  });

  it("throws when control is select but the field is not an enum", () => {
    const schema = z.object({
      format: z.string().meta({ label: "Format", control: "select" }),
    });
    expect(() => describeFields(schema)).toThrow(/^\[options\] field format:/);
  });

  it("throws when control is slider but the field is not a number", () => {
    const schema = z.object({
      quality: z.string().meta({ label: "Quality", control: "slider" }),
    });
    expect(() => describeFields(schema)).toThrow(/^\[options\] field quality:/);
  });

  it("throws when control is number but the field is not a number", () => {
    const schema = z.object({
      seed: z.boolean().meta({ label: "Seed", control: "number" }),
    });
    expect(() => describeFields(schema)).toThrow(/^\[options\] field seed:/);
  });

  it("throws when control is text but the field is not a string", () => {
    const schema = z.object({
      suffix: z.number().meta({ label: "Suffix", control: "text" }),
    });
    expect(() => describeFields(schema)).toThrow(/^\[options\] field suffix:/);
  });

  it("throws when control is crop but the field is not an object", () => {
    const schema = z.object({
      crop: z.number().meta({ label: "Crop", control: "crop" }),
    });
    expect(() => describeFields(schema)).toThrow(/^\[options\] field crop:/);
  });

  it("throws when a slider has no finite min", () => {
    const schema = z.object({
      quality: z
        .number()
        .max(100)
        .meta({ label: "Quality", control: "slider" }),
    });
    expect(() => describeFields(schema)).toThrow(/^\[options\] field quality:/);
  });

  it("throws when a slider has no finite max", () => {
    const schema = z.object({
      quality: z.number().min(0).meta({ label: "Quality", control: "slider" }),
    });
    expect(() => describeFields(schema)).toThrow(/^\[options\] field quality:/);
  });

  it("throws when a slider has neither bound", () => {
    const schema = z.object({
      quality: z.number().meta({ label: "Quality", control: "slider" }),
    });
    expect(() => describeFields(schema)).toThrow(/^\[options\] field quality:/);
  });
});

describe("validateOptions", () => {
  const schema = z.object({
    quality: z
      .number()
      .min(0)
      .max(100)
      .meta({ label: "Quality", control: "slider" }),
    format: z.enum(["jpg", "png"]).meta({ label: "Format", control: "select" }),
  });

  it("returns ok:true with the parsed value on success", () => {
    const result = validateOptions(schema, { quality: 50, format: "png" });
    expect(result).toEqual({ ok: true, value: { quality: 50, format: "png" } });
  });

  it("returns ok:false with one message per top-level field on failure", () => {
    const result = validateOptions(schema, { quality: 500, format: "gif" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.errors).sort()).toEqual(["format", "quality"]);
    }
  });

  it("keys errors by the top-level path for nested issues", () => {
    const result = validateOptions(schema, {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.quality).toBeDefined();
      expect(result.errors.format).toBeDefined();
    }
  });
});
