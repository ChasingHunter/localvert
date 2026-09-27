"use client";

import { useDocumentState } from "@embedpdf/core/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { TextEditClient } from "@/lib/editor/pdfium-engine";
import type { TextObjectInfo } from "@/lib/editor/text-edit-protocol";

/**
 * E5 — edit existing text. Renders one faint outline per TEXT page object
 * (from `textEdit.list`), the same absolutely-positioned-overlay pattern
 * `FormLayer` uses for its controls. Clicking an outline opens an inline
 * `<input>` prefilled with that object's text; Enter/blur commits via
 * `textEdit.replace`, Escape cancels. No reflow: `replace` only ever
 * touches the ONE text object clicked.
 */

/** PDFium's `FPDFPageObj_GetBounds` is bottom-left-origin (`bottom` is the
 * distance from the page's bottom edge), unlike `@embedpdf/models`'s `Rect`
 * (top-left origin, the convention `form-layer.tsx`'s `rectToCssBox`
 * assumes). Converts one directly to a CSS box at the page's current render
 * `scale`, flipping the y-axis against the page's full height. Exported for
 * unit testing. */
export function textBoundsToCssBox(
  bounds: TextObjectInfo["bounds"],
  pageHeight: number,
  scale: number,
): { left: number; top: number; width: number; height: number } {
  return {
    left: bounds.left * scale,
    top: (pageHeight - bounds.top) * scale,
    width: Math.max(1, bounds.right - bounds.left) * scale,
    height: Math.max(1, bounds.top - bounds.bottom) * scale,
  };
}

interface TextEditLayerProps {
  documentId: string;
  pageIndex: number;
  /** True only while the "Edit text" tool is the active mode — every other
   * tool is deactivated for the duration (see `pdf-editor-app.tsx`), the
   * same on/off gate `FormLayer`'s `toolActive` uses in reverse. */
  active: boolean;
  textEdit: TextEditClient;
  /** Called after a successful `replace` with whether a fallback standard
   * font had to be substituted. `Editor` (not this layer) owns reopening
   * the document afterwards -- see this component's doc comment on why --
   * so by the time this returns, `documentId`/`page` may already be stale;
   * this layer never touches them again after calling it. */
  onReplaced: (usedFallbackFont: boolean) => void;
}

export function TextEditLayer({
  documentId,
  pageIndex,
  active,
  textEdit,
  onReplaced,
}: TextEditLayerProps) {
  const documentState = useDocumentState(documentId);
  const doc = documentState?.document ?? null;
  const page = doc?.pages[pageIndex] ?? null;
  const scale = documentState?.scale ?? 1;

  const [objects, setObjects] = useState<TextObjectInfo[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Focuses the inline input the moment it appears -- not the `autoFocus`
  // prop (Biome's `noAutofocus`, an a11y lint this repo enforces, flags
  // that unconditionally), but the same effect: the user just clicked a
  // text object and expects to type immediately.
  useEffect(() => {
    if (editingIndex !== null) inputRef.current?.focus();
  }, [editingIndex]);

  // Reloaded whenever this page becomes active — a page's text objects can
  // have changed since last time (this layer's own `replace` calls, or a
  // page reopened after Apply elsewhere in the editor).
  useEffect(() => {
    if (!active || !page) {
      setObjects([]);
      setEditingIndex(null);
      return;
    }
    let cancelled = false;
    textEdit
      .list(documentId, pageIndex)
      .then((result) => {
        if (!cancelled) setObjects(result);
      })
      .catch(() => {
        if (!cancelled) setObjects([]);
      });
    return () => {
      cancelled = true;
    };
  }, [active, documentId, pageIndex, page, textEdit]);

  const startEditing = useCallback((obj: TextObjectInfo) => {
    setEditingIndex(obj.objectIndex);
    setDraft(obj.text);
  }, []);

  const cancelEditing = useCallback(() => {
    setEditingIndex(null);
    setDraft("");
  }, []);

  const commit = useCallback(async () => {
    if (editingIndex === null) return;
    setBusy(true);
    try {
      const result = await textEdit.replace(
        documentId,
        pageIndex,
        editingIndex,
        draft,
      );
      // `Editor` reopens the document to force the on-screen render to
      // reflect the change (see this component's doc comment) -- this
      // remounts the whole viewer subtree under a fresh `documentId`, which
      // will fire this layer's own load effect again, so no local re-list
      // here.
      onReplaced(result.usedFallbackFont);
    } finally {
      setBusy(false);
      setEditingIndex(null);
      setDraft("");
    }
  }, [documentId, pageIndex, editingIndex, draft, textEdit, onReplaced]);

  if (!active || !page) return null;

  return (
    <div style={{ position: "absolute", inset: 0 }} data-text-edit-layer>
      {objects.map((obj) => {
        const box = textBoundsToCssBox(obj.bounds, page.size.height, scale);
        const isEditing = editingIndex === obj.objectIndex;
        return isEditing ? (
          <input
            key={obj.objectIndex}
            ref={inputRef}
            type="text"
            aria-label={`Edit text: ${obj.text}`}
            disabled={busy}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void commit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancelEditing();
              }
            }}
            style={{
              position: "absolute",
              left: box.left,
              top: box.top,
              width: Math.max(box.width, 40),
              height: box.height,
              fontSize: Math.max(8, box.height * 0.85),
              boxSizing: "border-box",
            }}
            className="rounded-sm border border-accent bg-surface px-0.5 text-ink outline-none"
          />
        ) : (
          <button
            key={obj.objectIndex}
            type="button"
            aria-label={`Text object: ${obj.text}`}
            onClick={() => startEditing(obj)}
            style={{
              position: "absolute",
              left: box.left,
              top: box.top,
              width: box.width,
              height: box.height,
            }}
            className="cursor-text border border-dashed border-accent/50 bg-accent/5 hover:bg-accent/15"
          />
        );
      })}
    </div>
  );
}
