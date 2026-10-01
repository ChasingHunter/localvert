import { describe, expect, it } from "vitest";
import {
  classifyHeading,
  detectBold,
  detectItalic,
  dominantBodySize,
  groupItemsIntoLines,
  groupLinesIntoParagraphs,
  imageExtentEmu,
  imageRenderScale,
  type LayoutImage,
  type LayoutParagraph,
  orderPageBlocks,
  type RawItem,
} from "./pdf-layout";

describe("detectBold / detectItalic", () => {
  it("matches the documented style keywords", () => {
    expect(detectBold("ArialMT,Bold")).toBe(true);
    expect(detectBold("Helvetica-Black")).toBe(true);
    expect(detectBold("Roboto-Heavy")).toBe(true);
    expect(detectBold("OpenSans-Semibold")).toBe(true);
    expect(detectBold("ArialMT")).toBe(false);
  });

  it("is case-insensitive (subsetted names can carry a lowercase suffix)", () => {
    expect(detectBold("abcdef+arial-bold")).toBe(true);
    expect(detectItalic("abcdef+times-italic")).toBe(true);
  });

  it("matches oblique as italic", () => {
    expect(detectItalic("Helvetica-Oblique")).toBe(true);
    expect(detectItalic("Helvetica-BoldOblique")).toBe(true);
    expect(detectItalic("Helvetica")).toBe(false);
  });
});

describe("dominantBodySize", () => {
  it("picks the size covering the most characters, not the most items", () => {
    const items = [
      { sizePt: 24, length: 12 }, // one big title, few characters
      { sizePt: 11, length: 400 },
      { sizePt: 11, length: 380 },
    ];
    expect(dominantBodySize(items)).toBe(11);
  });

  it("falls back to 11 for no measurable text", () => {
    expect(dominantBodySize([])).toBe(11);
    expect(dominantBodySize([{ sizePt: 0, length: 0 }])).toBe(11);
  });

  it("buckets sizes to the nearest 0.5pt", () => {
    const items = [
      { sizePt: 10.98, length: 100 },
      { sizePt: 11.02, length: 100 },
    ];
    expect(dominantBodySize(items)).toBe(11);
  });
});

describe("classifyHeading", () => {
  it("promotes only past each documented ratio threshold", () => {
    expect(classifyHeading(11, 11)).toBe(0); // 1.0x — body
    expect(classifyHeading(12, 11)).toBe(0); // 1.09x — still body
    expect(classifyHeading(12.65, 11)).toBe(3); // 1.15x — H3
    expect(classifyHeading(14.3, 11)).toBe(2); // 1.3x — H2
    expect(classifyHeading(17.6, 11)).toBe(1); // 1.6x — H1
  });

  it("never divides by zero", () => {
    expect(classifyHeading(20, 0)).toBe(0);
  });
});

describe("groupItemsIntoLines", () => {
  function item(over: Partial<RawItem>): RawItem {
    return {
      text: "",
      x: 0,
      y: 0,
      sizePt: 11,
      bold: false,
      italic: false,
      hasEOL: false,
      ...over,
    };
  }

  it("merges same-style items into one run per line", () => {
    const lines = groupItemsIntoLines([
      item({ text: "Hello ", x: 10, y: 100 }),
      item({ text: "world", x: 40, y: 100 }),
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.runs).toEqual([
      { text: "Hello world", bold: false, italic: false, sizePt: 11 },
    ]);
    expect(lines[0]?.x).toBe(10);
    expect(lines[0]?.y).toBe(100);
  });

  it("splits into a new run when style changes mid-line", () => {
    const lines = groupItemsIntoLines([
      item({ text: "plain ", x: 10, y: 100 }),
      item({ text: "bold", x: 40, y: 100, bold: true }),
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.runs).toEqual([
      { text: "plain ", bold: false, italic: false, sizePt: 11 },
      { text: "bold", bold: true, italic: false, sizePt: 11 },
    ]);
  });

  it("breaks the line on hasEOL", () => {
    const lines = groupItemsIntoLines([
      item({ text: "line one", x: 10, y: 100, hasEOL: true }),
      item({ text: "line two", x: 10, y: 88 }),
    ]);
    expect(lines).toHaveLength(2);
  });

  it("breaks the line on a y-jump even without hasEOL", () => {
    const lines = groupItemsIntoLines([
      item({ text: "line one", x: 10, y: 100 }),
      item({ text: "line two", x: 10, y: 88 }),
    ]);
    expect(lines).toHaveLength(2);
  });

  it("tracks the largest size on the line", () => {
    const lines = groupItemsIntoLines([
      item({ text: "small ", x: 10, y: 100, sizePt: 10 }),
      item({ text: "BIG", x: 30, y: 100, sizePt: 20 }),
    ]);
    expect(lines[0]?.maxSizePt).toBe(20);
  });
});

describe("groupLinesIntoParagraphs", () => {
  it("merges wrapped lines (small gap) into one paragraph", () => {
    const lines = groupItemsIntoLines([
      {
        text: "first line ",
        x: 10,
        y: 100,
        sizePt: 11,
        bold: false,
        italic: false,
        hasEOL: false,
      },
      {
        text: "second line",
        x: 10,
        y: 87,
        sizePt: 11,
        bold: false,
        italic: false,
        hasEOL: false,
      },
    ]);
    const paragraphs = groupLinesIntoParagraphs(lines, 11);
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]?.runs[0]?.text).toBe("first line second line");
  });

  it("splits on a large vertical gap", () => {
    const lines = groupItemsIntoLines([
      {
        text: "para one",
        x: 10,
        y: 200,
        sizePt: 11,
        bold: false,
        italic: false,
        hasEOL: true,
      },
      {
        text: "para two",
        x: 10,
        y: 150,
        sizePt: 11,
        bold: false,
        italic: false,
        hasEOL: false,
      },
    ]);
    const paragraphs = groupLinesIntoParagraphs(lines, 11);
    expect(paragraphs).toHaveLength(2);
  });

  it("splits on a first-line indent even with ordinary line spacing", () => {
    const lines = groupItemsIntoLines([
      {
        text: "para one",
        x: 10,
        y: 200,
        sizePt: 11,
        bold: false,
        italic: false,
        hasEOL: true,
      },
      {
        text: "para two",
        x: 45,
        y: 187,
        sizePt: 11,
        bold: false,
        italic: false,
        hasEOL: false,
      },
    ]);
    const paragraphs = groupLinesIntoParagraphs(lines, 11);
    expect(paragraphs).toHaveLength(2);
  });

  it("classifies a paragraph's heading level from its weighted average size", () => {
    const lines = groupItemsIntoLines([
      {
        text: "Big Title",
        x: 10,
        y: 200,
        sizePt: 20,
        bold: true,
        italic: false,
        hasEOL: true,
      },
    ]);
    const paragraphs = groupLinesIntoParagraphs(lines, 11);
    expect(paragraphs[0]?.heading).toBe(1);
  });

  it("returns no paragraphs for no lines", () => {
    expect(groupLinesIntoParagraphs([], 11)).toEqual([]);
  });
});

describe("orderPageBlocks", () => {
  const para = (text: string, y?: number): LayoutParagraph => ({
    runs: [{ text, bold: false, italic: false, sizePt: 11 }],
    heading: 0,
    y,
  });
  const image = (top: number, data = "x"): LayoutImage => ({
    top,
    widthPt: 100,
    heightPt: 50,
    pageWidthPt: 600,
    mime: "image/png",
    data,
  });
  const label = (blocks: ReturnType<typeof orderPageBlocks>) =>
    blocks.map((b) =>
      b.kind === "image"
        ? `img@${b.image.top}`
        : (b.paragraph.runs[0]?.text ?? ""),
    );

  it("puts each image before the first paragraph that sits below its top", () => {
    const blocks = orderPageBlocks(
      [para("a", 700), para("b", 500), para("c", 200)],
      [image(400), image(650)],
    );
    expect(label(blocks)).toEqual(["a", "img@650", "b", "img@400", "c"]);
  });

  it("keeps a caption under its picture and text above it above", () => {
    const blocks = orderPageBlocks(
      [para("above", 720), para("caption", 480)],
      [image(600)],
    );
    expect(label(blocks)).toEqual(["above", "img@600", "caption"]);
  });

  it("puts images below the last paragraph at the end", () => {
    expect(label(orderPageBlocks([para("a", 700)], [image(100)]))).toEqual([
      "a",
      "img@100",
    ]);
  });

  it("keeps input order for images with the same top", () => {
    const blocks = orderPageBlocks(
      [],
      [image(300, "first"), image(300, "second")],
    );
    expect(blocks.map((b) => (b.kind === "image" ? b.image.data : ""))).toEqual(
      ["first", "second"],
    );
  });

  it("never lets a paragraph without a position pull an image above it", () => {
    expect(
      label(orderPageBlocks([para("a"), para("b")], [image(900)])),
    ).toEqual(["a", "b", "img@900"]);
  });

  it("returns the paragraphs untouched when there are no images", () => {
    expect(label(orderPageBlocks([para("a", 1), para("b", 2)]))).toEqual([
      "a",
      "b",
    ]);
  });
});

describe("imageExtentEmu", () => {
  const CONTENT_W = 6.5 * 914400;
  const CONTENT_H = 9 * 914400;

  it("is the same fraction of the content width as of the page width", () => {
    const { cx, cy } = imageExtentEmu(
      { widthPt: 153, heightPt: 76.5, pageWidthPt: 612 },
      CONTENT_W,
      CONTENT_H,
    );
    expect(cx).toBe(Math.round(CONTENT_W / 4));
    expect(cy).toBe(Math.round(CONTENT_W / 8));
  });

  it("caps a full-page image at the content width and keeps its shape", () => {
    const { cx, cy } = imageExtentEmu(
      { widthPt: 700, heightPt: 350, pageWidthPt: 612 },
      CONTENT_W,
      CONTENT_H,
    );
    expect(cx).toBe(CONTENT_W);
    expect(cy).toBe(Math.round(CONTENT_W / 2));
  });

  it("shrinks a very tall image to the content height, keeping its shape", () => {
    const { cx, cy } = imageExtentEmu(
      { widthPt: 300, heightPt: 1500, pageWidthPt: 612 },
      CONTENT_W,
      CONTENT_H,
    );
    expect(cy).toBe(CONTENT_H);
    expect(cx / cy).toBeCloseTo(300 / 1500, 4);
  });
});

describe("imageRenderScale", () => {
  it("scales a 300 px image drawn at 100 pt up to its own pixels", () => {
    expect(imageRenderScale(300, 300, 100, 100, 3000)).toBe(3);
  });

  it("never shrinks an image drawn larger than its pixels", () => {
    expect(imageRenderScale(80, 80, 100, 100, 3000)).toBe(1);
  });

  it("caps the longest rendered side", () => {
    expect(imageRenderScale(8000, 4000, 400, 200, 3000)).toBe(7.5);
  });
});
