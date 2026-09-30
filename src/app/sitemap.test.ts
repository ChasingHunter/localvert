import { describe, expect, it } from "vitest";
import { SITE_URL } from "@/lib/site";
import { TOOLS } from "@/tools";
import sitemap from "./sitemap";

/**
 * Tests the actual `sitemap()` function (a plain data function, not a
 * component — safe to import directly, unlike `[category]/page.test.ts`
 * which avoids importing its JSX page).
 */
describe("sitemap", () => {
  const entries = sitemap();
  const urls = entries.map((entry) => entry.url);

  it("includes the home page", () => {
    expect(urls).toContain(`${SITE_URL}/`);
  });

  it("includes one entry per registered tool", () => {
    for (const tool of TOOLS) {
      expect(urls).toContain(`${SITE_URL}/tools/${tool.slug}`);
    }
  });

  it("includes one entry per category that has a tool", () => {
    const toolCategories = new Set(TOOLS.map((tool) => tool.category));
    for (const category of toolCategories) {
      expect(urls).toContain(`${SITE_URL}/${category}`);
    }
  });

  it("excludes the offline fallback page", () => {
    expect(urls.some((url) => url.includes("/offline"))).toBe(false);
  });

  it("every URL is absolute against SITE_URL", () => {
    for (const url of urls) {
      expect(url.startsWith(SITE_URL)).toBe(true);
    }
  });

  it("no URL has a trailing slash except the root", () => {
    for (const url of urls) {
      if (url === `${SITE_URL}/`) continue;
      expect(url.endsWith("/")).toBe(false);
    }
  });

  it("has no duplicate URLs", () => {
    expect(new Set(urls).size).toBe(urls.length);
  });
});
