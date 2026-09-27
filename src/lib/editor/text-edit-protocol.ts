/**
 * E5 — message protocol for editing existing text objects, spoken over the
 * SAME `pdfium.worker.ts` module worker `pdfium-engine.ts` already spawns,
 * but on a channel of its own (`self.addEventListener("message", ...)`,
 * separate from `EngineRunner`'s `self.onmessage`) — see that file's doc
 * comment for why: the bare `PdfEngine` API has no text-editing method, only
 * `getPageTextRuns`/`getPageGlyphs`, so this talks to raw PDFium functions
 * `pdfium.worker.ts` calls directly instead.
 */

/** One TEXT page object, as reported by the `list` op. */
export interface TextObjectInfo {
  objectIndex: number;
  text: string;
  /** PDF-point bounds, PDFium's own bottom-left-origin convention (see
   * `FPDFPageObj_GetBounds`) — NOT the same as `@embedpdf/models`'s
   * top-left-origin `Rect`. Converted to a CSS box by the UI layer. */
  bounds: { left: number; bottom: number; right: number; top: number };
  fontSize: number;
  baseFontName: string;
  fill: { r: number; g: number; b: number; a: number };
}

export interface TextEditListRequest {
  type: "localvert:text";
  id: string;
  op: "list";
  documentId: string;
  pageIndex: number;
}

export interface TextEditReplaceRequest {
  type: "localvert:text";
  id: string;
  op: "replace";
  documentId: string;
  pageIndex: number;
  objectIndex: number;
  newText: string;
}

export type TextEditRequest = TextEditListRequest | TextEditReplaceRequest;

export interface TextEditReplaceResult {
  /** True if the original (subset-embedded) font couldn't be reused because
   * `newText` has a character `oldText` didn't — see `needsFallbackFont` in
   * `text-edit-font.ts` — and a standard PDFium font was substituted. */
  usedFallbackFont: boolean;
}

export type TextEditOpResult<Op extends TextEditRequest["op"]> =
  Op extends "list" ? TextObjectInfo[] : TextEditReplaceResult;

export interface TextEditResultMessage {
  type: "localvert:text:result";
  id: string;
  ok: boolean;
  value?: unknown;
  error?: string;
}
