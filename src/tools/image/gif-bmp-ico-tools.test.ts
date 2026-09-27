import { describe, expect, it } from "vitest";
import type { EngineId, FormatId, ToolDefinition } from "@/lib/registry";
import { resolvePipeline } from "@/lib/router";
import { makeCaps } from "@/test/caps";
import bmpToJpg from "./bmp-to-jpg";
import bmpToPng from "./bmp-to-png";
import gifToJpg from "./gif-to-jpg";
import gifToPng from "./gif-to-png";
import icoToPng from "./ico-to-png";
import jpgToBmp from "./jpg-to-bmp";
import jpgToGif from "./jpg-to-gif";
import jpgToIco from "./jpg-to-ico";
import pngToBmp from "./png-to-bmp";
import pngToGif from "./png-to-gif";
import pngToIco from "./png-to-ico";

/**
 * Covers the eleven gif/bmp/ico tools (wave-b-image). Every decode/encode
 * candidate for gif/bmp/ico is `["canvas"]` (`image-pipeline.ts`'s
 * preference tables); jpg/png's own side of the pair still prefers its
 * dedicated jsquash codec first, same as `format-tools.test.ts`'s cases —
 * these tools don't change that preference, only add gif/bmp/ico as the
 * other end of the pipeline.
 */
const ENGINE_FOR: Partial<Record<FormatId, EngineId>> = {
  jpg: "jsquash-jpeg",
  png: "jsquash-png",
  gif: "canvas",
  bmp: "canvas",
  ico: "canvas",
};
interface Case {
  name: string;
  tool: ToolDefinition;
  from: FormatId;
  to: FormatId;
}

const cases: Case[] = [
  { name: "gif-to-png", tool: gifToPng, from: "gif", to: "png" },
  { name: "gif-to-jpg", tool: gifToJpg, from: "gif", to: "jpg" },
  { name: "bmp-to-png", tool: bmpToPng, from: "bmp", to: "png" },
  { name: "bmp-to-jpg", tool: bmpToJpg, from: "bmp", to: "jpg" },
  { name: "ico-to-png", tool: icoToPng, from: "ico", to: "png" },
  { name: "png-to-bmp", tool: pngToBmp, from: "png", to: "bmp" },
  { name: "jpg-to-bmp", tool: jpgToBmp, from: "jpg", to: "bmp" },
  { name: "png-to-ico", tool: pngToIco, from: "png", to: "ico" },
  { name: "jpg-to-ico", tool: jpgToIco, from: "jpg", to: "ico" },
  { name: "png-to-gif", tool: pngToGif, from: "png", to: "gif" },
  { name: "jpg-to-gif", tool: jpgToGif, from: "jpg", to: "gif" },
];

describe.each(cases)("$name", ({ tool, from, to }) => {
  it("is a valid definition accepting the source and producing the target", () => {
    expect(tool.accepts).toEqual([from]);
    expect(tool.produces).toBe(to);
    expect(tool.batch).toBe(true);
    expect(tool.category).toBe("image");
  });

  it("resolves decode/encode to each side's preferred engine", () => {
    const resolved = resolvePipeline(tool, makeCaps());
    const decodeStep = resolved.find((s) => s.op === "decode");
    const encodeStep = resolved.find((s) => s.op === "encode");
    expect(decodeStep?.engine).toBe(ENGINE_FOR[from]);
    expect(encodeStep?.engine).toBe(ENGINE_FOR[to]);
  });

  it("parses its own defaults against its own options schema", () => {
    const result = tool.options.safeParse(tool.defaults);
    expect(result.success).toBe(true);
  });
});
