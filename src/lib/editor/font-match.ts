/**
 * Font picker for FreeText annotations (owner bug #5) — pure helpers, no
 * PDFium/DOM dependency, same split as `text-edit-font.ts`.
 *
 * A FreeText annotation can only reference one of PDFium's 14 standard
 * fonts (`PdfStandardFont`, `@embedpdf/models`'s `pdf.d.ts`) — it has no way
 * to embed or reference an arbitrary document font. So "Match document"
 * never literally reuses the nearest text's font; it picks the closest of
 * the 12 non-symbol standard fonts and says so (see `matchDocumentFont`'s
 * `hint`).
 */

import { PdfStandardFont } from "@embedpdf/models";
import type { TextObjectInfo } from "./text-edit-protocol";

/** The 12 standard fonts a FreeText annotation can actually use (Symbol and
 * ZapfDingbats are symbol fonts, not text fonts — excluded from the picker
 * the same way `text-edit-font.ts`'s fallback never picks them either). */
export const FONT_SELECT_OPTIONS: ReadonlyArray<{
  value: PdfStandardFont;
  label: string;
}> = [
  { value: PdfStandardFont.Helvetica, label: "Sans (Helvetica)" },
  { value: PdfStandardFont.Helvetica_Bold, label: "Sans Bold" },
  { value: PdfStandardFont.Helvetica_Oblique, label: "Sans Italic" },
  { value: PdfStandardFont.Helvetica_BoldOblique, label: "Sans Bold Italic" },
  { value: PdfStandardFont.Times_Roman, label: "Serif (Times)" },
  { value: PdfStandardFont.Times_Bold, label: "Serif Bold" },
  { value: PdfStandardFont.Times_Italic, label: "Serif Italic" },
  { value: PdfStandardFont.Times_BoldItalic, label: "Serif Bold Italic" },
  { value: PdfStandardFont.Courier, label: "Mono (Courier)" },
  { value: PdfStandardFont.Courier_Bold, label: "Mono Bold" },
  { value: PdfStandardFont.Courier_Oblique, label: "Mono Italic" },
  { value: PdfStandardFont.Courier_BoldOblique, label: "Mono Bold Italic" },
];

/** Sentinel `<select>` value for "Match document" — never a real tool
 * default (there's no `PdfStandardFont.Match`), since a concrete font can
 * only be resolved once there's a click point to match against. See
 * `pdf-editor-app.tsx`'s `onAnnotationEvent` listener. */
export const MATCH_DOCUMENT_VALUE = "match";

const TIMES_HINTS = [
  "times",
  "serif",
  "georgia",
  "garamond",
  "cambria",
  "book",
  "palatino",
  "minion",
];
const COURIER_HINTS = ["courier", "mono", "consolas", "menlo", "monaco"];

/** The exact PostScript names of PDFium's 14 standard fonts — used to
 * decide whether "Match document" is a real approximation (worth a hint) or
 * already an exact match (the nearest text already IS a standard font). */
const STANDARD_FONT_NAMES = new Set([
  "Courier",
  "Courier-Bold",
  "Courier-BoldOblique",
  "Courier-Oblique",
  "Helvetica",
  "Helvetica-Bold",
  "Helvetica-BoldOblique",
  "Helvetica-Oblique",
  "Times-Roman",
  "Times-Bold",
  "Times-BoldItalic",
  "Times-Italic",
]);

function pick(
  regular: PdfStandardFont,
  bold: PdfStandardFont,
  italic: PdfStandardFont,
  boldItalic: PdfStandardFont,
  isBold: boolean,
  isItalic: boolean,
): PdfStandardFont {
  if (isBold && isItalic) return boldItalic;
  if (isBold) return bold;
  if (isItalic) return italic;
  return regular;
}

/** Strips a PDF font subset prefix ("ABCDEE+TimesNewRomanPS-BoldMT" ->
 * "TimesNewRomanPS-BoldMT") for display in the "Closest match" hint. Cosmetic
 * only — the family/style heuristic below matches on the full lowercased
 * name regardless of a subset prefix being present. */
function displayFontName(baseFontName: string): string {
  return baseFontName.replace(/^[A-Z]{6}\+/, "");
}

/** Maps a PDFium base-font name (`TextObjectInfo.baseFontName`, e.g.
 * "ABCDEE+TimesNewRomanPS-BoldMT", "Calibri", "Garamond-Bold") to the
 * closest of the 12 standard text fonts, and a friendly label for the
 * family alone (used in the "Closest match to this document's X: Y" hint).
 * Coarse name matching, same spirit as `text-edit-font.ts`'s
 * `pickStandardFontName` — not a real font classification. */
export function nearestStandardFont(baseFontName: string): {
  font: PdfStandardFont;
  familyLabel: string;
} {
  const lower = baseFontName.toLowerCase();
  const bold = /bold|black|semibold/.test(lower);
  const italic = /italic|oblique/.test(lower);

  if (TIMES_HINTS.some((hint) => lower.includes(hint))) {
    return {
      font: pick(
        PdfStandardFont.Times_Roman,
        PdfStandardFont.Times_Bold,
        PdfStandardFont.Times_Italic,
        PdfStandardFont.Times_BoldItalic,
        bold,
        italic,
      ),
      familyLabel: "Serif (Times)",
    };
  }
  if (COURIER_HINTS.some((hint) => lower.includes(hint))) {
    return {
      font: pick(
        PdfStandardFont.Courier,
        PdfStandardFont.Courier_Bold,
        PdfStandardFont.Courier_Oblique,
        PdfStandardFont.Courier_BoldOblique,
        bold,
        italic,
      ),
      familyLabel: "Mono (Courier)",
    };
  }
  return {
    font: pick(
      PdfStandardFont.Helvetica,
      PdfStandardFont.Helvetica_Bold,
      PdfStandardFont.Helvetica_Oblique,
      PdfStandardFont.Helvetica_BoldOblique,
      bold,
      italic,
    ),
    familyLabel: "Sans (Helvetica)",
  };
}

/** Picks the `TextObjectInfo` whose bounds center is closest to `point` —
 * both in the SAME coordinate frame (PDFium's bottom-left-origin page
 * points, matching `TextObjectInfo.bounds`; see `pdf-editor-app.tsx` for how
 * a top-left-origin annotation rect is converted before calling this). Pure
 * and side-effect-free so it's unit-testable with synthetic char boxes. */
export function nearestTextObject(
  objects: readonly TextObjectInfo[],
  point: { x: number; y: number },
): TextObjectInfo | null {
  let best: TextObjectInfo | null = null;
  let bestDistanceSq = Number.POSITIVE_INFINITY;
  for (const obj of objects) {
    const cx = (obj.bounds.left + obj.bounds.right) / 2;
    const cy = (obj.bounds.top + obj.bounds.bottom) / 2;
    const dx = cx - point.x;
    const dy = cy - point.y;
    const distanceSq = dx * dx + dy * dy;
    if (distanceSq < bestDistanceSq) {
      bestDistanceSq = distanceSq;
      best = obj;
    }
  }
  return best;
}

export interface DocumentFontMatch {
  font: PdfStandardFont;
  /** Null when the nearest text is already an exact standard font (nothing
   * to be honest about); otherwise the "Closest match..." hint copy
   * (ADR-0016: plain, no em dashes). */
  hint: string | null;
}

/** "Match document" (owner bug #5): finds the nearest existing text to
 * `point` and resolves the standard font closest to it. Returns null when
 * the page has no other text at all — the caller falls back to Helvetica
 * and its own "nothing to match" copy in that case. */
export function matchDocumentFont(
  objects: readonly TextObjectInfo[],
  point: { x: number; y: number },
): DocumentFontMatch | null {
  const nearest = nearestTextObject(objects, point);
  if (!nearest) return null;
  const { font, familyLabel } = nearestStandardFont(nearest.baseFontName);
  const name = displayFontName(nearest.baseFontName);
  const hint = STANDARD_FONT_NAMES.has(name)
    ? null
    : `Closest match to this document's ${name}: ${familyLabel}.`;
  return { font, hint };
}
