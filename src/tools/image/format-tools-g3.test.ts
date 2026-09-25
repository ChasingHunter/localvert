import { describe, expect, it } from "vitest";
import type { ToolDefinition } from "@/lib/registry";
import heicToJpg from "./heic-to-jpg";
import heicToPng from "./heic-to-png";
import psdToJpg from "./psd-to-jpg";
import psdToPng from "./psd-to-png";
import svgToJpg from "./svg-to-jpg";
import svgToPng from "./svg-to-png";
import tiffToJpg from "./tiff-to-jpg";
import tiffToPng from "./tiff-to-png";

/**
 * Covers the eight tools added for HEIC/SVG/TIFF/PSD input in this slice.
 * `defineTool` (imported transitively via `imagePipeline`) already throws at
 * each module's own load time if a definition is malformed — these tests
 * import every module (so any such throw fails the suite immediately) and
 * then assert the specific contract this slice's brief calls out: which
 * engine each pipeline's decode/encode step resolves to, and that every
 * tool's `defaults` actually satisfies its own `options` schema.
 */
const TOOLS: readonly [string, ToolDefinition][] = [
  ["heic-to-jpg", heicToJpg],
  ["heic-to-png", heicToPng],
  ["svg-to-jpg", svgToJpg],
  ["svg-to-png", svgToPng],
  ["tiff-to-jpg", tiffToJpg],
  ["tiff-to-png", tiffToPng],
  ["psd-to-jpg", psdToJpg],
  ["psd-to-png", psdToPng],
];

const DECODE_ENGINE: Record<string, string> = {
  heic: "heic",
  svg: "resvg",
  tiff: "utif",
  psd: "psd",
};

const ENCODE_ENGINE: Record<string, string> = {
  jpg: "jsquash-jpeg",
  png: "jsquash-png",
};

describe("format-tools-g3", () => {
  it.each(TOOLS)("%s: slug matches its file basename", (slug, tool) => {
    expect(tool.slug).toBe(slug);
  });

  it.each(TOOLS)("%s: is a batch, image-category tool", (_slug, tool) => {
    expect(tool.category).toBe("image");
    expect(tool.batch).toBe(true);
  });

  it.each(TOOLS)(
    "%s: pipeline decodes via the right engine, then encodes via the right engine",
    (_slug, tool) => {
      const [from] = tool.accepts;
      const to = tool.produces;
      if (!from) throw new Error("tool has no accepted formats");

      const decodeStep = tool.pipeline.find((s) => s.op === "decode");
      const encodeStep = tool.pipeline.find((s) => s.op === "encode");
      if (!decodeStep || !encodeStep) {
        throw new Error("expected both a decode and an encode step");
      }

      expect(decodeStep.candidates[0]?.engine).toBe(DECODE_ENGINE[from]);
      expect(encodeStep.candidates[0]?.engine).toBe(ENCODE_ENGINE[to]);
    },
  );

  it.each(TOOLS)(
    "%s: defaults satisfy its own options schema",
    (_slug, tool) => {
      const result = tool.options.safeParse(tool.defaults);
      expect(result.success).toBe(true);
    },
  );

  it("svg tools expose an optional width option (1-8192px)", () => {
    for (const tool of [svgToPng, svgToJpg]) {
      const shape = tool.options.shape as Record<string, unknown>;
      expect(shape.width).toBeDefined();
      // Omitting width entirely must still satisfy the schema.
      expect(tool.options.safeParse(tool.defaults).success).toBe(true);
    }
  });

  it("jpg-producing tools expose quality (0.1-1) and background options", () => {
    for (const tool of [heicToJpg, svgToJpg, tiffToJpg, psdToJpg]) {
      expect(tool.defaults).toMatchObject({
        quality: 0.85,
        background: "#ffffff",
      });
      const parsed = tool.options.safeParse({
        ...tool.defaults,
        quality: 0.05,
      });
      expect(parsed.success).toBe(false);
    }
  });

  it("png-producing tools have no options", () => {
    for (const tool of [heicToPng, tiffToPng, psdToPng]) {
      expect(tool.defaults).toEqual({});
    }
  });
});
