import { describe, expect, it } from "vitest";
import { TOOLS } from "@/tools";
import { COMPRESS_SLUGS, orderedCompressors } from "./compress-tools";

describe("orderedCompressors", () => {
  it("follows the /compress page order, not the input order", () => {
    const shuffled = [...COMPRESS_SLUGS].reverse().map((slug) => ({ slug }));
    expect(orderedCompressors(shuffled).map((t) => t.slug)).toEqual([
      ...COMPRESS_SLUGS,
    ]);
  });

  it("skips slugs that are not in the list", () => {
    const tools = [{ slug: "compress-audio" }, { slug: "compress-other" }];
    expect(orderedCompressors(tools).map((t) => t.slug)).toEqual([
      "compress-audio",
    ]);
  });

  it("every listed slug is a registered tool", () => {
    expect(orderedCompressors(TOOLS)).toHaveLength(COMPRESS_SLUGS.length);
  });
});
