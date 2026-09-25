import { describe, expect, it } from "vitest";
import type { EngineId, FormatId, ToolDefinition } from "@/lib/registry";
import { resolvePipeline } from "@/lib/router";
import { makeCaps } from "@/test/caps";
import jpgToAvif from "./jpg-to-avif";
import jpgToJxl from "./jpg-to-jxl";
import jpgToWebp from "./jpg-to-webp";
import pngToAvif from "./png-to-avif";
import pngToJpg from "./png-to-jpg";
import pngToJxl from "./png-to-jxl";
import pngToWebp from "./png-to-webp";

/**
 * Covers the seven jpg/png source format tools added alongside this file
 * (slice 1C-tools-G1). Every tool here is built with `imagePipeline`, whose
 * candidate lists are unconditional (`image-pipeline.ts`'s doc comment) —
 * so `resolvePipeline` against *any* `Capabilities` always picks each
 * step's first, most-preferred candidate: the dedicated jsquash codec, never
 * the `canvas` fallback. That is what "decode/encode engine = jsquash
 * codec" asserts below; `canvas` only ever gets used at runtime if a
 * jsquash wasm module actually fails to load, which this resolution-level
 * test doesn't exercise.
 */
const JSQUASH_CODEC: Partial<Record<FormatId, EngineId>> = {
  jpg: "jsquash-jpeg",
  png: "jsquash-png",
  webp: "jsquash-webp",
  avif: "jsquash-avif",
  jxl: "jsquash-jxl",
};

interface Case {
  name: string;
  tool: ToolDefinition;
  from: FormatId;
  to: FormatId;
}

const cases: Case[] = [
  { name: "jpg-to-webp", tool: jpgToWebp, from: "jpg", to: "webp" },
  { name: "jpg-to-avif", tool: jpgToAvif, from: "jpg", to: "avif" },
  { name: "jpg-to-jxl", tool: jpgToJxl, from: "jpg", to: "jxl" },
  { name: "png-to-jpg", tool: pngToJpg, from: "png", to: "jpg" },
  { name: "png-to-webp", tool: pngToWebp, from: "png", to: "webp" },
  { name: "png-to-avif", tool: pngToAvif, from: "png", to: "avif" },
  { name: "png-to-jxl", tool: pngToJxl, from: "png", to: "jxl" },
];

describe.each(cases)("$name", ({ tool, from, to }) => {
  it("is a valid definition accepting the source and producing the target", () => {
    expect(tool.accepts).toEqual([from]);
    expect(tool.produces).toBe(to);
    expect(tool.batch).toBe(true);
  });

  it("resolves decode to the source's jsquash codec and encode to the target's", () => {
    const resolved = resolvePipeline(tool, makeCaps());
    const decodeStep = resolved.find((s) => s.op === "decode");
    const encodeStep = resolved.find((s) => s.op === "encode");
    expect(decodeStep?.engine).toBe(JSQUASH_CODEC[from]);
    expect(encodeStep?.engine).toBe(JSQUASH_CODEC[to]);
  });

  it("parses its own defaults against its own options schema", () => {
    const result = tool.options.safeParse(tool.defaults);
    expect(result.success).toBe(true);
  });
});
