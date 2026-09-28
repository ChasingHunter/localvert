import { describe, expect, it } from "vitest";
import type { ToolDefinition } from "@/lib/registry/types";
import {
  categoriesWithTools,
  groupToolsByCategory,
  shortToolLabel,
} from "./tool-groups";

/** Minimal fixtures — only the fields `groupToolsByCategory` reads. */
function tool(
  slug: string,
  category: ToolDefinition["category"],
): ToolDefinition {
  return { slug, category } as ToolDefinition;
}

describe("groupToolsByCategory", () => {
  it("groups tools by category, preserving input order within a group", () => {
    const tools = [
      tool("jpg-to-png", "image"),
      tool("mp4-to-webm", "video"),
      tool("png-to-webp", "image"),
    ];

    const byCategory = groupToolsByCategory(tools);

    expect([...byCategory.keys()]).toEqual(["image", "video"]);
    expect(byCategory.get("image")?.map((t) => t.slug)).toEqual([
      "jpg-to-png",
      "png-to-webp",
    ]);
    expect(byCategory.get("video")?.map((t) => t.slug)).toEqual([
      "mp4-to-webm",
    ]);
  });

  it("returns an empty map for no tools", () => {
    expect(groupToolsByCategory([]).size).toBe(0);
  });
});

describe("categoriesWithTools", () => {
  it("keeps only categories that have at least one tool, in the given order", () => {
    const byCategory = groupToolsByCategory([tool("jpg-to-png", "image")]);

    expect(categoriesWithTools(["image", "video", "pdf"], byCategory)).toEqual([
      "image",
    ]);
  });

  it("returns an empty array when nothing has tools", () => {
    expect(categoriesWithTools(["image", "video"], new Map())).toEqual([]);
  });
});

describe("shortToolLabel", () => {
  it("cuts an em-dash subtitle", () => {
    expect(
      shortToolLabel("PSD to PNG — flatten Photoshop files without Photoshop"),
    ).toBe("PSD to PNG");
  });

  it("cuts a colon subtitle", () => {
    expect(shortToolLabel("Merge PDF: combine multiple files")).toBe(
      "Merge PDF",
    );
  });

  it("passes a plain title through unchanged", () => {
    expect(shortToolLabel("JPG to PNG")).toBe("JPG to PNG");
  });
});
