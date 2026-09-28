import { describe, expect, it } from "vitest";
import { CATEGORIES } from "@/lib/registry/categories";
import { FORMATS, type FormatId } from "@/lib/registry/formats";
import { TOOLS_BY_SLUG } from "@/tools";
import {
  inputFormats,
  matchFormat,
  matchTarget,
  popular,
  type Target,
  targetsFor,
} from "./catalog";

describe("inputFormats", () => {
  const groups = inputFormats();
  const all = groups.flatMap((g) => g.formats);

  it("includes exactly the 46 formats at least one non-app tool accepts", () => {
    expect(all.length).toBe(46);
    // "zip" is never accepted as an input by any tool — the one FORMATS
    // entry that doesn't qualify (47 total formats - 1 = 46, ADR-0015).
    expect(all).not.toContain("zip");
  });

  it("has no duplicate formats across groups", () => {
    expect(new Set(all).size).toBe(all.length);
  });

  it("groups formats under their own category, in CATEGORIES order", () => {
    for (const group of groups) {
      for (const format of group.formats) {
        expect(FORMATS[format].category).toBe(group.category);
      }
    }
    const categoryOrder = groups.map((g) => g.category);
    const expectedOrder = CATEGORIES.filter((c) => categoryOrder.includes(c));
    expect(categoryOrder).toEqual(expectedOrder);
  });

  it("includes common formats like jpg, pdf and docx", () => {
    expect(all).toContain("jpg");
    expect(all).toContain("pdf");
    expect(all).toContain("docx");
  });
});

describe("targetsFor", () => {
  it("returns empty lists for a format no tool accepts", () => {
    // "zip" is never in any tool's accepts.
    expect(targetsFor("zip" as FormatId)).toEqual({
      conversions: [],
      actions: [],
    });
  });

  it("every target's slug names a real tool", () => {
    const allFormats = Object.keys(FORMATS) as FormatId[];
    for (const from of allFormats) {
      const { conversions, actions } = targetsFor(from);
      for (const target of [...conversions, ...actions]) {
        expect(TOOLS_BY_SLUG.has(target.slug)).toBe(true);
      }
    }
  });

  describe("pdf", () => {
    const { conversions, actions } = targetsFor("pdf");

    it("includes Word, Text, JPG and PNG conversions", () => {
      const slugs = conversions.map((c) => c.slug);
      expect(slugs).toContain("pdf-to-word");
      expect(slugs).toContain("pdf-to-text");
      expect(slugs).toContain("pdf-to-jpg");
      expect(slugs).toContain("pdf-to-png");
    });

    it("includes Compress, Merge, Rotate and Edit actions", () => {
      const labels = actions.map((a) => a.label);
      expect(labels).toContain("Compress");
      expect(labels).toContain("Merge");
      expect(labels).toContain("Rotate");
      expect(labels).toContain("Edit PDF");
    });

    it("orders actions by rank, then the fixed priority list, Compress first", () => {
      const labels = actions.map((a) => a.label);
      expect(labels.slice(0, 5)).toEqual([
        "Compress",
        "Merge",
        "Rotate",
        "Split",
        "Edit PDF",
      ]);
    });
  });

  describe("duplicate pairs resolve to exactly one default", () => {
    const cases: [FormatId, FormatId][] = [
      ["mp4", "mp3"],
      ["mov", "mp3"],
      ["webm", "mp3"],
      ["jpg", "pdf"],
      ["png", "pdf"],
      ["mov", "webm"],
    ];

    it.each(cases)("%s -> %s has exactly one default target", (from, to) => {
      const { conversions } = targetsFor(from);
      const defaults = conversions.filter(
        (c) => c.format === to && c.variant === undefined,
      );
      expect(defaults).toHaveLength(1);
    });

    it("mp4 -> mp3 prefers mp4-to-mp3 (ranked) over extract-audio", () => {
      const { conversions } = targetsFor("mp4");
      const target = conversions.find((c) => c.format === "mp3");
      expect(target?.slug).toBe("mp4-to-mp3");
    });

    it("mov -> mp3 and webm -> mp3 prefer the exact pair tool", () => {
      expect(
        targetsFor("mov").conversions.find((c) => c.format === "mp3")?.slug,
      ).toBe("mov-to-mp3");
      expect(
        targetsFor("webm").conversions.find((c) => c.format === "mp3")?.slug,
      ).toBe("webm-to-mp3");
    });

    it("jpg -> pdf prefers jpg-to-pdf (ranked) and keeps the OCR variant", () => {
      const { conversions } = targetsFor("jpg");
      const pdfTargets = conversions.filter((c) => c.format === "pdf");
      expect(pdfTargets.find((t) => t.variant === undefined)?.slug).toBe(
        "jpg-to-pdf",
      );
      expect(pdfTargets.some((t) => t.slug === "image-to-searchable-pdf")).toBe(
        true,
      );
      // images-to-pdf is the same UX as jpg-to-pdf for a jpg-only drop — see
      // the doc comment on targetsFor — so it never appears here.
      expect(pdfTargets.some((t) => t.slug === "images-to-pdf")).toBe(false);
    });

    it("png -> pdf prefers png-to-pdf (exact pair) over images-to-pdf", () => {
      const { conversions } = targetsFor("png");
      const pdfTargets = conversions.filter((c) => c.format === "pdf");
      expect(pdfTargets.find((t) => t.variant === undefined)?.slug).toBe(
        "png-to-pdf",
      );
      expect(pdfTargets.some((t) => t.slug === "images-to-pdf")).toBe(false);
    });

    it("mov -> webm prefers mov-to-webm (exact pair) over mp4-to-webm", () => {
      const { conversions } = targetsFor("mov");
      const webmTarget = conversions.find((c) => c.format === "webm");
      expect(webmTarget?.slug).toBe("mov-to-webm");
    });
  });
});

describe("matchFormat", () => {
  it("matches an empty query", () => {
    expect(matchFormat("", "jpg")).toBe(true);
  });

  it("matches by label, ext and alias", () => {
    expect(matchFormat("jpeg", "jpg")).toBe(true); // ext
    expect(matchFormat("word", "docx")).toBe(true); // alias
    expect(matchFormat("iphone photo", "heic")).toBe(true); // alias
    expect(matchFormat("PNG", "png")).toBe(true); // label, case-insensitive
  });

  it("does not match an unrelated query", () => {
    expect(matchFormat("banana", "jpg")).toBe(false);
  });
});

describe("matchTarget", () => {
  const target: Target = {
    kind: "format",
    label: "Searchable PDF (OCR)",
    slug: "image-to-searchable-pdf",
    format: "pdf",
    variant: "Searchable PDF (OCR)",
  };

  it("matches an empty query", () => {
    expect(matchTarget("", target)).toBe(true);
  });

  it("matches by label and variant text", () => {
    expect(matchTarget("ocr", target)).toBe(true);
    expect(matchTarget("searchable", target)).toBe(true);
  });

  it("does not match an unrelated query", () => {
    expect(matchTarget("banana", target)).toBe(false);
  });
});

describe("popular", () => {
  it("returns rows ascending by rank", () => {
    const rows = popular();
    const ranks = rows.map((r) => r.rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it("includes the expected top-8 slugs with their from format", () => {
    const rows = popular();
    const bySlug = new Map(rows.map((r) => [r.slug, r]));
    expect(bySlug.get("pdf-to-word")).toMatchObject({ from: "pdf", rank: 1 });
    expect(bySlug.get("jpg-to-png")).toMatchObject({ from: "jpg", rank: 2 });
    expect(bySlug.get("mp4-to-mp3")).toMatchObject({ from: "mp4", rank: 3 });
    expect(bySlug.get("compress-pdf")).toMatchObject({
      from: "pdf",
      kind: "action",
      rank: 4,
    });
    expect(bySlug.get("png-to-jpg")).toMatchObject({ from: "png", rank: 5 });
    expect(bySlug.get("heic-to-jpg")).toMatchObject({ from: "heic", rank: 6 });
    expect(bySlug.get("merge-pdf")).toMatchObject({
      from: "pdf",
      kind: "action",
      rank: 7,
    });
    expect(bySlug.get("jpg-to-pdf")).toMatchObject({ from: "jpg", rank: 8 });
  });
});
