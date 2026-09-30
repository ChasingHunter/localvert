import { describe, expect, it } from "vitest";
import { SITE_URL } from "@/lib/site";
import { TOOLS } from "@/tools";
import { buildLlmsTxt } from "./llms-txt";

describe("buildLlmsTxt", () => {
  const text = buildLlmsTxt(TOOLS);

  it("starts with the H1 and a blockquote summary", () => {
    const [h1, blank, summary] = text.split("\n");
    expect(h1).toBe("# Localvert");
    expect(blank).toBe("");
    expect(summary).toMatch(/^> .*never uploaded/);
  });

  it("links every tool by absolute url", () => {
    for (const tool of TOOLS) {
      expect(text, tool.slug).toContain(
        `- [${tool.title}](${SITE_URL}/tools/${tool.slug}): ${tool.description}`,
      );
    }
  });

  it("links the about pages and has one H2 per populated category plus About", () => {
    for (const path of ["/privacy", "/compress", "/vs"]) {
      expect(text).toContain(`](${SITE_URL}${path})`);
    }
    expect(text).toContain("## Image");
    expect(text).toContain("## About");
  });

  it("uses no em dashes and ends with one newline", () => {
    expect(text).not.toContain("—");
    expect(text.endsWith("\n")).toBe(true);
    expect(text.endsWith("\n\n")).toBe(false);
  });
});
