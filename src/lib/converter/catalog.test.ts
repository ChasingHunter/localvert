import { describe, expect, it } from "vitest";
import { CATEGORIES } from "@/lib/registry/categories";
import { FORMATS, type FormatId } from "@/lib/registry/formats";
import { TOOLS_BY_SLUG } from "@/tools";
import { CATALOG } from "@/tools/catalog";
import {
  formatsSummaryText,
  inputFormats,
  inputFormatsForCategory,
  matchFormat,
  matchTarget,
  nativeInputFormats,
  popular,
  popularInCategory,
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

describe("inputFormatsForCategory", () => {
  it("audio: includes mp3 and every native audio format, excludes pdf and jpg", () => {
    const all = inputFormatsForCategory("audio").flatMap((g) => g.formats);
    expect(all).toContain("mp3");
    expect(all).toContain("wav");
    expect(all).toContain("flac");
    expect(all).toContain("ogg");
    expect(all).toContain("opus");
    expect(all).toContain("m4a");
    expect(all).toContain("aac");
    expect(all).toContain("wma");
    expect(all).not.toContain("pdf");
    expect(all).not.toContain("jpg");
  });

  it("audio: includes mp4 (extract-audio accepts it) under a labelled video group", () => {
    const groups = inputFormatsForCategory("audio");
    const videoGroup = groups.find((g) => g.category === "video");
    expect(videoGroup).toBeDefined();
    expect(videoGroup?.formats).toContain("mp4");
    expect(videoGroup?.formats).toContain("mov");
    expect(videoGroup?.formats).toContain("webm");
    expect(videoGroup?.formats).toContain("mkv");
    expect(videoGroup?.label).toBe("Video (extract the audio)");
    // avi and flv are video-to-video-only tools (no audio tool accepts
    // them), so they never show up on the audio page.
    expect(videoGroup?.formats).not.toContain("avi");
    expect(videoGroup?.formats).not.toContain("flv");
  });

  it("audio: the audio group is first, before the cross-category video group", () => {
    const groups = inputFormatsForCategory("audio");
    expect(groups[0]?.category).toBe("audio");
    expect(groups[0]?.label).toBe("Audio");
  });

  it("image: only image formats, no cross-category group", () => {
    const groups = inputFormatsForCategory("image");
    expect(groups).toHaveLength(1);
    expect(groups[0]?.category).toBe("image");
    const all = groups.flatMap((g) => g.formats);
    expect(all).toContain("jpg");
    expect(all).toContain("png");
    expect(all).not.toContain("pdf");
    expect(all).not.toContain("mp3");
  });

  it("pdf: includes pdf plus image formats under a labelled group (images-to-pdf tools)", () => {
    const groups = inputFormatsForCategory("pdf");
    const nativeGroup = groups.find((g) => g.category === "pdf");
    expect(nativeGroup?.formats).toContain("pdf");
    const imageGroup = groups.find((g) => g.category === "image");
    expect(imageGroup?.formats).toContain("jpg");
    expect(imageGroup?.formats).toContain("png");
    expect(imageGroup?.label).toBe("Image (create a PDF)");
    expect(groups.flatMap((g) => g.formats)).not.toContain("mp3");
  });

  it("data: only data formats", () => {
    const all = inputFormatsForCategory("data").flatMap((g) => g.formats);
    expect(all).toContain("csv");
    expect(all).toContain("json");
    expect(all).toContain("xlsx");
    expect(all).not.toContain("pdf");
    expect(all).not.toContain("jpg");
  });
});

describe("nativeInputFormats", () => {
  it("audio: excludes the cross-category video formats", () => {
    const formats = nativeInputFormats("audio");
    expect(formats).toContain("mp3");
    expect(formats).not.toContain("mp4");
    expect(formats).not.toContain("mov");
  });
});

describe("formatsSummaryText", () => {
  it("names every format outright when 8 or fewer", () => {
    const formats = nativeInputFormats("audio"); // exactly 8 today
    expect(formats.length).toBe(8);
    const text = formatsSummaryText(formats);
    expect(text.startsWith("Works with ")).toBe(true);
    expect(text.endsWith(".")).toBe(true);
    expect(text).not.toContain("and more");
    for (const f of formats) {
      expect(text).toContain(FORMATS[f].label);
    }
  });

  it("truncates to the first 8 plus 'and more' for a longer list", () => {
    const formats = nativeInputFormats("image"); // well over 8
    expect(formats.length).toBeGreaterThan(8);
    const text = formatsSummaryText(formats);
    expect(text.endsWith("and more.")).toBe(true);
  });

  it("returns an empty string for an empty list", () => {
    expect(formatsSummaryText([])).toBe("");
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

  describe("category scoping", () => {
    it("mp4 on the audio category only offers extract-audio's mp3 target, not video tools", () => {
      const { conversions, actions } = targetsFor("mp4", {
        category: "audio",
      });
      const slugs = [...conversions, ...actions].map((t) => t.slug);
      expect(slugs).toContain("mp4-to-mp3");
      expect(slugs).not.toContain("mp4-to-mov");
      expect(slugs).not.toContain("mp4-to-webm");
      expect(slugs).not.toContain("compress-video");
    });

    it("with no category, mp4 offers both audio and video tools", () => {
      const { conversions, actions } = targetsFor("mp4");
      const slugs = [...conversions, ...actions].map((t) => t.slug);
      expect(slugs).toContain("mp4-to-mp3");
      expect(slugs).toContain("mp4-to-mov");
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

describe("popularInCategory", () => {
  const withTools = CATEGORIES.filter((c) =>
    CATALOG.some((t) => t.category === c),
  );

  it("gives every category that has tools at least three popular entries", () => {
    expect(withTools.length).toBeGreaterThan(0);
    for (const category of withTools) {
      expect(
        popularInCategory(category).length,
        category,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it("only lists real tools that belong to that category, capped at six", () => {
    for (const category of withTools) {
      const rows = popularInCategory(category);
      expect(rows.length, category).toBeLessThanOrEqual(6);
      for (const row of rows) {
        expect(TOOLS_BY_SLUG.get(row.slug), row.slug).toBeDefined();
        expect(row.category, row.slug).toBe(category);
      }
    }
  });

  it("orders by categoryRank and puts the expected leaders first", () => {
    const audio = popularInCategory("audio").map((t) => t.slug);
    expect(audio[0]).toBe("mp4-to-mp3");
    const ranks = popularInCategory("image").map((t) => t.categoryRank ?? 0);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });
});
