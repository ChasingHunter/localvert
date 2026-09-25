import { describe, expect, it } from "vitest";
import { resolvePipeline } from "@/lib/router";
import { makeCaps } from "@/test/caps";
import avifToJpg from "./avif-to-jpg";
import avifToPng from "./avif-to-png";
import jxlToJpg from "./jxl-to-jpg";
import jxlToPng from "./jxl-to-png";
import webpToJpg from "./webp-to-jpg";
import webpToPng from "./webp-to-png";

/**
 * Covers the six WebP/AVIF/JPEG XL -> JPG/PNG tools as a batch: each one's
 * `defineTool` call already ran (and would have thrown) at import time
 * above, so a passing import is itself the "definition is valid" assertion.
 * What is left to check per tool is what `defineTool` can't: that the
 * pipeline actually *resolves* to the dedicated jSquash codecs — not just
 * that some candidate exists — and that the declared defaults parse.
 */
describe("format tools: webp/avif/jxl -> jpg/png", () => {
  const cases = [
    {
      tool: webpToJpg,
      decodeEngine: "jsquash-webp",
      encodeEngine: "jsquash-jpeg",
    },
    {
      tool: webpToPng,
      decodeEngine: "jsquash-webp",
      encodeEngine: "jsquash-png",
    },
    {
      tool: avifToJpg,
      decodeEngine: "jsquash-avif",
      encodeEngine: "jsquash-jpeg",
    },
    {
      tool: avifToPng,
      decodeEngine: "jsquash-avif",
      encodeEngine: "jsquash-png",
    },
    {
      tool: jxlToJpg,
      decodeEngine: "jsquash-jxl",
      encodeEngine: "jsquash-jpeg",
    },
    {
      tool: jxlToPng,
      decodeEngine: "jsquash-jxl",
      encodeEngine: "jsquash-png",
    },
  ] as const;

  for (const { tool, decodeEngine, encodeEngine } of cases) {
    describe(tool.slug, () => {
      it("resolves to the dedicated decode/encode codecs at full capability", () => {
        const resolved = resolvePipeline(tool, makeCaps());
        expect(resolved).toEqual([
          { op: "decode", engine: decodeEngine },
          { op: "encode", engine: encodeEngine },
        ]);
      });

      it("accepts and produces the formats its slug promises", () => {
        expect(tool.accepts).toEqual([tool.slug.split("-to-")[0]]);
        expect(tool.produces).toBe(tool.slug.split("-to-")[1]);
      });

      it("parses its own declared defaults", () => {
        const parsed = tool.options.safeParse(tool.defaults);
        expect(parsed.success).toBe(true);
      });

      it("is batchable", () => {
        expect(tool.batch).toBe(true);
      });
    });
  }

  describe("jpg-producing tools (webp/avif/jxl -to-jpg)", () => {
    const jpgTools = [webpToJpg, avifToJpg, jxlToJpg];

    it("default quality is 0.85 within the 0.1-1 slider range", () => {
      for (const tool of jpgTools) {
        expect(tool.defaults).toMatchObject({ quality: 0.85 });
      }
    });

    it("rejects a quality outside the 0.1-1 range", () => {
      for (const tool of jpgTools) {
        expect(
          tool.options.safeParse({ quality: 0, background: "#ffffff" }).success,
        ).toBe(false);
        expect(
          tool.options.safeParse({ quality: 1.5, background: "#ffffff" })
            .success,
        ).toBe(false);
      }
    });

    it("defaults background to #ffffff", () => {
      for (const tool of jpgTools) {
        expect(tool.defaults).toMatchObject({ background: "#ffffff" });
      }
    });
  });

  describe("png-producing tools (webp/avif/jxl -to-png)", () => {
    const pngTools = [webpToPng, avifToPng, jxlToPng];

    it("declare no options", () => {
      for (const tool of pngTools) {
        expect(tool.options.safeParse({}).success).toBe(true);
        expect(Object.keys(tool.defaults as object)).toEqual([]);
      }
    });
  });
});
