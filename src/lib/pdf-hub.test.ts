import { describe, expect, it } from "vitest";
import { TOOLS } from "@/tools";
import {
  groupPdfHubTools,
  PDF_HUB_GROUP_BY_SLUG,
  PDF_HUB_GROUPS,
} from "./pdf-hub";

describe("pdf hub groups", () => {
  const pdfCategoryTools = TOOLS.filter((tool) => tool.category === "pdf");

  it("has at least one pdf-category tool to check (sanity)", () => {
    expect(pdfCategoryTools.length).toBeGreaterThan(0);
  });

  it("every pdf-category tool lands in exactly one group", () => {
    for (const tool of pdfCategoryTools) {
      expect(PDF_HUB_GROUP_BY_SLUG[tool.slug]).toBeDefined();
    }
  });

  it("every slug in the map is a real, currently registered tool", () => {
    const slugs = new Set(TOOLS.map((tool) => tool.slug));
    for (const slug of Object.keys(PDF_HUB_GROUP_BY_SLUG)) {
      expect(slugs.has(slug)).toBe(true);
    }
  });

  it("groupPdfHubTools drops nothing the map assigns and adds nothing it doesn't", () => {
    const grouped = groupPdfHubTools(TOOLS);
    const total = [...grouped.values()].reduce(
      (sum, list) => sum + list.length,
      0,
    );
    expect(total).toBe(Object.keys(PDF_HUB_GROUP_BY_SLUG).length);
  });

  it("has an entry (possibly empty) for every declared group", () => {
    const grouped = groupPdfHubTools(TOOLS);
    for (const group of PDF_HUB_GROUPS) {
      expect(grouped.has(group)).toBe(true);
    }
  });
});
