/**
 * Pure, environment-neutral document-structure reconstruction for
 * `pdf-to-word` (docs/adr/0014-pdf-to-word.md). No pdf.js types and no DOM —
 * `pdfjs/adapter.ts`'s `runExtractLayout` is the only caller, and it maps
 * pdf.js's own `TextItem`s down to the plain `RawItem` shape below before
 * calling in here. Kept separate (like `never-larger.ts`/`target-size.ts`)
 * so the actual grouping/heading logic is unit-tested directly in Node,
 * with no worker, no wasm, and no real PDF required.
 */

/** One `getTextContent()` item, reduced to what this module needs. `x`/`y`
 * are `item.transform[4]`/`[5]` (PDF user-space points, y increasing
 * upward); `sizePt` is `item.transform[3]` (or `item.height` — see the
 * adapter), which approximates the run's font size in points since PDF user
 * space is already 72 units/inch. */
export interface RawItem {
  text: string;
  x: number;
  y: number;
  sizePt: number;
  bold: boolean;
  italic: boolean;
  hasEOL: boolean;
}

export interface LayoutRun {
  text: string;
  bold: boolean;
  italic: boolean;
  sizePt: number;
}

/** 0 = body text; 1-3 = heading level (see `classifyHeading`). */
export type HeadingLevel = 0 | 1 | 2 | 3;

export interface LayoutParagraph {
  runs: LayoutRun[];
  heading: HeadingLevel;
  /** Baseline of the paragraph's first line, PDF user space (y up). Only
   * used to slot images in between paragraphs (`orderPageBlocks`). */
  y?: number;
}

/** One picture from the PDF (docs/adr/0014-pdf-to-word.md, "Images"). */
export interface LayoutImage {
  /** Top edge on the page, PDF user space (y up) — compared with
   * `LayoutParagraph.y`. */
  top: number;
  /** Size as drawn on the page, in points. */
  widthPt: number;
  heightPt: number;
  /** Width of the page the image sits on, in points: the image's width in
   * the docx is this same fraction of the content width. */
  pageWidthPt: number;
  /** JPEG passes through untouched; everything else is PNG. */
  mime: "image/jpeg" | "image/png";
  /** The encoded image file, base64 (the hand-off between engines is JSON). */
  data: string;
}

export interface LayoutPage {
  paragraphs: LayoutParagraph[];
  images?: LayoutImage[];
}

/** Images under this many pixels on either side are rules, bullets and dots,
 * not pictures. */
export const MIN_IMAGE_PX = 24;

/**
 * PDFium renders an image object at its size on the page (72 dpi), which
 * throws away most of a photo's pixels. Scaling the object up by this factor
 * first makes the rendered bitmap match the image's own pixel size, capped at
 * `maxSide` pixels on the longest side. Never below 1: a picture drawn
 * larger than its pixels is not shrunk.
 */
export function imageRenderScale(
  pxWidth: number,
  pxHeight: number,
  widthPt: number,
  heightPt: number,
  maxSide: number,
): number {
  const native = Math.max(pxWidth / widthPt, pxHeight / heightPt);
  const cap = maxSide / Math.max(widthPt, heightPt);
  return Math.max(1, Math.min(native, cap));
}

export type PageBlock =
  | { kind: "paragraph"; paragraph: LayoutParagraph }
  | { kind: "image"; image: LayoutImage };

/**
 * Merges a page's images into its paragraphs by vertical position. Paragraph
 * order is kept exactly as given; an image goes in front of the first
 * paragraph whose first-line baseline sits below the image's top edge, so a
 * caption under a picture follows it and text above it stays above. Text
 * beside an image therefore comes after it. Images with equal tops keep their
 * input order. A paragraph with no `y` (older JSON) never pulls an image in
 * front of itself; leftover images go last.
 */
export function orderPageBlocks(
  paragraphs: readonly LayoutParagraph[],
  images: readonly LayoutImage[] = [],
): PageBlock[] {
  const pending = images
    .map((image, index) => ({ image, index }))
    .sort((a, b) => b.image.top - a.image.top || a.index - b.index)
    .map((e) => e.image);
  const blocks: PageBlock[] = [];
  let next = 0;
  for (const paragraph of paragraphs) {
    if (paragraph.y !== undefined) {
      while (next < pending.length && (pending[next]?.top ?? 0) > paragraph.y) {
        const image = pending[next++];
        if (image) blocks.push({ kind: "image", image });
      }
    }
    blocks.push({ kind: "paragraph", paragraph });
  }
  while (next < pending.length) {
    const image = pending[next++];
    if (image) blocks.push({ kind: "image", image });
  }
  return blocks;
}

/**
 * Size of an image in the docx, in EMU (914400 per inch): the same fraction
 * of the content width as it takes of the PDF page's width, never wider than
 * the content area, never taller than it either (aspect ratio kept).
 */
export function imageExtentEmu(
  image: Pick<LayoutImage, "widthPt" | "heightPt" | "pageWidthPt">,
  contentWidthEmu: number,
  contentHeightEmu: number,
): { cx: number; cy: number } {
  const aspect = image.heightPt / image.widthPt;
  let cx = Math.min(
    contentWidthEmu,
    (image.widthPt / image.pageWidthPt) * contentWidthEmu,
  );
  let cy = cx * aspect;
  if (cy > contentHeightEmu) {
    cy = contentHeightEmu;
    cx = cy / aspect;
  }
  return { cx: Math.max(1, Math.round(cx)), cy: Math.max(1, Math.round(cy)) };
}

export interface LayoutDocument {
  pages: LayoutPage[];
}

/** One reconstructed visual line: still position-tagged (needed for
 * paragraph grouping) but already merged into same-style runs. */
export interface RawLine {
  x: number;
  y: number;
  /** Largest `sizePt` among the line's runs — used for both the
   * paragraph-gap threshold and, weighted by text length, the document's
   * dominant body size. */
  maxSizePt: number;
  runs: LayoutRun[];
}

/**
 * docs/adr/0014-pdf-to-word.md's bold/italic heuristic. Matched against a
 * font's real PDF base font name (e.g. "ArialMT,Bold",
 * "Helvetica-BoldOblique") — case-insensitive, since a subsetted name can
 * carry a lowercase style suffix some producers emit.
 */
export function detectBold(fontName: string): boolean {
  return /Bold|Black|Heavy|Semibold/i.test(fontName);
}

export function detectItalic(fontName: string): boolean {
  return /Italic|Oblique/i.test(fontName);
}

/**
 * The document's "body text" size: the `sizePt` bucket (rounded to the
 * nearest 0.5pt) covering the most total characters, not just the most
 * *items* — a title page with three huge items and a body of a thousand
 * small ones must not let the title's bucket win by item count. Falls back
 * to 11 (a reasonable default body size) for a document with no measurable
 * text at all, so `classifyHeading` never divides by zero.
 */
export function dominantBodySize(
  items: readonly { sizePt: number; length: number }[],
): number {
  const weight = new Map<number, number>();
  for (const { sizePt, length } of items) {
    if (sizePt <= 0 || length <= 0) continue;
    const bucket = Math.round(sizePt * 2) / 2;
    weight.set(bucket, (weight.get(bucket) ?? 0) + length);
  }
  let best = 11;
  let bestWeight = 0;
  for (const [bucket, w] of weight) {
    if (w > bestWeight) {
      bestWeight = w;
      best = bucket;
    }
  }
  return best;
}

/**
 * Font size relative to the document's own body size decides heading level,
 * not an absolute pt value (a 9pt-body document's 14pt headings should still
 * read as headings). Thresholds match the brief: a size ratio has to clear
 * 1.6x for H1, 1.3x for H2, 1.15x for H3 — chosen so a merely "slightly
 * bigger" run (e.g. 12pt in an 11pt-body document, ratio 1.09) stays body
 * text rather than being promoted, while genuinely large headings (most
 * real-world H1s run 1.8-2.5x body size, H2s 1.3-1.6x) clear their bucket
 * with margin. See docs/adr/0014-pdf-to-word.md for the worked examples this
 * was checked against.
 */
export function classifyHeading(
  sizePt: number,
  bodySizePt: number,
): HeadingLevel {
  if (bodySizePt <= 0) return 0;
  const ratio = sizePt / bodySizePt;
  if (ratio >= 1.6) return 1;
  if (ratio >= 1.3) return 2;
  if (ratio >= 1.15) return 3;
  return 0;
}

/**
 * Reassembles one page's flat `RawItem` run into `RawLine`s. Line breaks are
 * the same two signals `pdfjs/adapter.ts`'s `reconstructPageText` already
 * uses for `pdf-to-text` (`hasEOL`, or a y-jump of more than a point) —
 * reused here rather than duplicated differently, since both tools are
 * reading the same content stream the same way. Within a line, adjacent
 * items with the same bold/italic/sizePt collapse into one run (most PDFs
 * emit one `TextItem` per word or per glyph run, not per visual line) —
 * `Math.abs(sizePt - lastSizePt) < 0.1` treats a sub-pixel size wobble
 * between adjacent glyphs of the same nominal font as "the same run" rather
 * than fragmenting every line into dozens of near-identical runs.
 */
export function groupItemsIntoLines(items: readonly RawItem[]): RawLine[] {
  const lines: RawLine[] = [];
  let currentRuns: LayoutRun[] = [];
  let lineX: number | undefined;
  let lineY: number | undefined;
  let lineMaxSize = 0;
  let lastY: number | undefined;

  function flushLine(): void {
    if (currentRuns.length === 0) return;
    lines.push({
      x: lineX ?? 0,
      y: lineY ?? 0,
      maxSizePt: lineMaxSize,
      runs: currentRuns,
    });
    currentRuns = [];
    lineX = undefined;
    lineY = undefined;
    lineMaxSize = 0;
  }

  for (const item of items) {
    if (lastY !== undefined && Math.abs(item.y - lastY) > 1) {
      flushLine();
    }
    if (lineX === undefined) {
      lineX = item.x;
      lineY = item.y;
    }
    lineMaxSize = Math.max(lineMaxSize, item.sizePt);
    const last = currentRuns[currentRuns.length - 1];
    if (
      last &&
      last.bold === item.bold &&
      last.italic === item.italic &&
      Math.abs(last.sizePt - item.sizePt) < 0.1
    ) {
      last.text += item.text;
    } else {
      currentRuns.push({
        text: item.text,
        bold: item.bold,
        italic: item.italic,
        sizePt: item.sizePt,
      });
    }
    lastY = item.y;
    if (item.hasEOL) {
      flushLine();
      lastY = undefined;
    }
  }
  flushLine();
  return lines;
}

/**
 * Threshold for "this line starts a new paragraph rather than continuing
 * the last one" — either signal alone is enough:
 *
 * - **Vertical gap**: normal line-to-line leading in body text runs close to
 *   1x the font size (single-spaced) up to about 1.2x (1.5-line spacing is
 *   rarer in body prose but still reads as "the same paragraph, wrapped").
 *   A gap over 1.35x the current line's own size is generously past any
 *   single-spaced or 1.5-line-spaced wrap and reads as an intentional
 *   paragraph break (a blank line, a heading's extra leading above/below).
 * - **Indentation**: a first-line indent is typically 2-4 character widths;
 *   in points that's roughly 2x the body font size for a 0.3-0.5in indent
 *   at a normal 10-12pt body size. A line starting more than
 *   `2 * bodySizePt` to the right of the paragraph's own first line is
 *   treated as a new (indented) paragraph even with ordinary line spacing.
 *
 * Both are heuristics, not a layout parser — a document with unusually
 * tight or loose leading, or no first-line indent at all (common in
 * business documents that use paragraph spacing instead), degrades to
 * "every visual line gap of ordinary size merges", which is the same
 * behaviour `pdf-to-text` already has with no complaints. See
 * docs/adr/0014-pdf-to-word.md.
 */
const PARAGRAPH_GAP_RATIO = 1.35;
const PARAGRAPH_INDENT_RATIO = 2;

export function groupLinesIntoParagraphs(
  lines: readonly RawLine[],
  bodySizePt: number,
): LayoutParagraph[] {
  const paragraphs: LayoutParagraph[] = [];
  let current: RawLine[] = [];

  function flushParagraph(): void {
    if (current.length === 0) return;
    const runs: LayoutRun[] = [];
    let totalWeight = 0;
    let sizeWeighted = 0;
    for (const line of current) {
      for (const run of line.runs) {
        const last = runs[runs.length - 1];
        if (
          last &&
          last.bold === run.bold &&
          last.italic === run.italic &&
          Math.abs(last.sizePt - run.sizePt) < 0.1
        ) {
          last.text += (last.text.endsWith(" ") ? "" : " ") + run.text;
        } else {
          runs.push({ ...run });
        }
        totalWeight += run.text.length;
        sizeWeighted += run.text.length * run.sizePt;
      }
    }
    const avgSize = totalWeight > 0 ? sizeWeighted / totalWeight : bodySizePt;
    paragraphs.push({
      runs,
      heading: classifyHeading(avgSize, bodySizePt),
      y: current[0]?.y,
    });
    current = [];
  }

  let prevLine: RawLine | undefined;
  for (const line of lines) {
    if (prevLine) {
      const gap = prevLine.y - line.y; // positive: line is below prevLine
      const gapThreshold =
        PARAGRAPH_GAP_RATIO * (prevLine.maxSizePt || bodySizePt);
      const indentJump =
        line.x - (current[0]?.x ?? line.x) >
        PARAGRAPH_INDENT_RATIO * bodySizePt;
      if (gap > gapThreshold || indentJump) {
        flushParagraph();
      }
    }
    current.push(line);
    prevLine = line;
  }
  flushParagraph();
  return paragraphs;
}
