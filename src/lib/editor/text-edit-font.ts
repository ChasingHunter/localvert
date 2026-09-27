/**
 * Pure helpers for E5 (edit existing text) — no PDFium/DOM dependency, so
 * these are unit-tested directly rather than only through the (unrun, per
 * the brief) browser/e2e tests that exercise the real worker.
 */

/**
 * Picks one of PDFium's 14 built-in standard fonts from an embedded font's
 * `FPDFFont_GetBaseFontName` string (e.g. "ABCDEF+Helvetica-Bold",
 * "TimesNewRomanPSMT"). Used only as a FALLBACK when the original (likely
 * subset-embedded) font can't represent the new text — see
 * `needsFallbackFont` below. This is a coarse name match, not a real font
 * classification: it exists to pick a plausible substitute, not to
 * reproduce the original font exactly.
 */
export function pickStandardFontName(baseFontName: string): string {
  const lower = baseFontName.toLowerCase();
  const bold = /bold/.test(lower);
  const italic = /italic|oblique/.test(lower);

  if (lower.includes("times")) {
    if (bold && italic) return "Times-BoldItalic";
    if (bold) return "Times-Bold";
    if (italic) return "Times-Italic";
    return "Times-Roman";
  }
  if (lower.includes("courier")) {
    if (bold && italic) return "Courier-BoldOblique";
    if (bold) return "Courier-Bold";
    if (italic) return "Courier-Oblique";
    return "Courier";
  }
  if (bold && italic) return "Helvetica-BoldOblique";
  if (bold) return "Helvetica-Bold";
  if (italic) return "Helvetica-Oblique";
  return "Helvetica";
}

/**
 * True if `newText` contains any character `oldText` didn't have. The
 * original text object's font is very likely a subset-embedded font (most
 * PDF producers only embed the glyphs actually used), so a character the
 * old text never used has no guarantee of a glyph in that font — this is a
 * conservative, cheap proxy for "does the original font cover the new
 * text?" rather than a real glyph-coverage check (which would need to
 * inspect the font's embedded glyph/cmap tables). False positives (falling
 * back when the font actually would have covered the new character) are
 * acceptable; false negatives (keeping a font that's missing a glyph) are
 * not, which is why this errs toward fallback.
 */
export function needsFallbackFont(oldText: string, newText: string): boolean {
  const oldChars = new Set(Array.from(oldText));
  for (const ch of newText) {
    if (!oldChars.has(ch)) return true;
  }
  return false;
}
