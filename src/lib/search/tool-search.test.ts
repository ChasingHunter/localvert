import { describe, expect, it } from "vitest";
import { FORMATS } from "@/lib/registry/formats";
import { CATALOG } from "@/tools/catalog";
import { buildSearchIndex, MAX_RESULTS, searchTools } from "./tool-search";

const index = buildSearchIndex(CATALOG, FORMATS);
const slugs = (query: string) => searchTools(index, query).map((e) => e.slug);

describe("searchTools", () => {
  it("finds a tool by its format name, title prefix first", () => {
    const result = slugs("heic");
    expect(result.slice(0, 2).sort()).toEqual(["heic-to-jpg", "heic-to-png"]);
    expect(result[0]).toBe("heic-to-jpg");
  });

  it("finds a format by an alias", () => {
    expect(slugs("iphone photo").slice(0, 2).sort()).toEqual([
      "heic-to-jpg",
      "heic-to-png",
    ]);
  });

  it("matches an action by its full title", () => {
    expect(slugs("compress pdf")[0]).toBe("compress-pdf");
  });

  it("finds Word tools from the alias 'word'", () => {
    expect(slugs("word")).toContain("word-to-pdf");
    expect(slugs("word")[0]).toBe("word-to-pdf");
  });

  it("puts title-prefix matches before format matches for 'mp3'", () => {
    const result = searchTools(index, "mp3");
    expect(result[0]?.lowerTitle.startsWith("mp3")).toBe(true);
    expect(result).toHaveLength(MAX_RESULTS);
  });

  it("finds merge", () => {
    expect(slugs("merge")[0]).toBe("merge-pdf");
  });

  it("matches words in any order", () => {
    expect(slugs("pdf compress")).toContain("compress-pdf");
  });

  it("is case and whitespace insensitive", () => {
    expect(slugs("  Compress   PDF ")[0]).toBe("compress-pdf");
  });

  it("returns nothing for gibberish and for an empty query", () => {
    expect(slugs("xyz")).toEqual([]);
    expect(slugs("   ")).toEqual([]);
  });

  it("never returns more than the limit, or the same tool twice", () => {
    const result = slugs("pdf");
    expect(result.length).toBeLessThanOrEqual(MAX_RESULTS);
    expect(new Set(result).size).toBe(result.length);
  });

  it("breaks ties by popularity", () => {
    // pdf-to-word carries the site-wide rank 1.
    expect(slugs("pdf")[0]).toBe("pdf-to-word");
  });
});
