"use client";

import { useDocumentState } from "@embedpdf/core/react";
import type { Rect } from "@embedpdf/models";
import { useCallback, useRef, useState } from "react";
import { rectToCssBox } from "./form-layer";

/**
 * Slice E4a -- true (content-level) redaction. Marking is a two-step flow:
 * this layer only lets the user draw/review rectangles ("marks") in PDF-point
 * space; nothing is destroyed until `pdf-editor-app.tsx`'s "Apply
 * redactions" button runs `redactTextInRects` + `applyAllRedactions` against
 * every marked page (see that file's `applyRedactions`). Marks live in the
 * parent (`Editor`'s `redactionMarks` state, keyed by page index) rather than
 * here, because "Apply" needs to see every page's marks at once, and
 * "Find & mark" (also in the parent, driven by `engine.searchAllPages`) adds
 * marks without any drag gesture at all.
 */

export interface RedactionMark {
  id: string;
  /** PDF-point rect, same convention as `form-layer.tsx`'s `rectToCssBox`
   * (top-left origin, no y-flip). */
  rect: Rect;
}

/** Screen-space (CSS pixel, relative to this layer's own bounding box)
 * rect -> PDF-point `Rect` at the page's current render `scale` -- the
 * inverse of `rectToCssBox`. Exported for unit testing. */
export function cssBoxToRect(
  box: { left: number; top: number; width: number; height: number },
  scale: number,
): Rect {
  return {
    origin: { x: box.left / scale, y: box.top / scale },
    size: { width: box.width / scale, height: box.height / scale },
  };
}

interface RedactionLayerProps {
  documentId: string;
  pageIndex: number;
  /** True while the toolbar's "Redact" tool is the active tool -- gates the
   * drag-to-mark gesture the same way `FormLayer`'s `toolActive` gates
   * pointer events, just inverted (this layer wants pointer events ONLY
   * while active; existing marks still render either way so a user can
   * review/remove them with any other tool selected). */
  active: boolean;
  marks: RedactionMark[];
  onAddMark: (pageIndex: number, rect: Rect) => void;
  onRemoveMark: (pageIndex: number, id: string) => void;
}

/** Minimum drag distance (CSS px) before a pointer gesture becomes a mark --
 * filters out an accidental click-with-no-drag from leaving a zero-size box
 * behind. */
const MIN_MARK_SIZE = 4;

export function RedactionLayer({
  documentId,
  pageIndex,
  active,
  marks,
  onAddMark,
  onRemoveMark,
}: RedactionLayerProps) {
  const documentState = useDocumentState(documentId);
  const scale = documentState?.scale ?? 1;
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [drag, setDrag] = useState<{
    startX: number;
    startY: number;
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);

  const pointFromEvent = useCallback((e: React.PointerEvent) => {
    const box = containerRef.current?.getBoundingClientRect();
    if (!box) return { x: 0, y: 0 };
    return { x: e.clientX - box.left, y: e.clientY - box.top };
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!active || e.button !== 0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      const { x, y } = pointFromEvent(e);
      setDrag({ startX: x, startY: y, left: x, top: y, width: 0, height: 0 });
    },
    [active, pointFromEvent],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!drag) return;
      const { x, y } = pointFromEvent(e);
      const left = Math.min(drag.startX, x);
      const top = Math.min(drag.startY, y);
      const width = Math.abs(x - drag.startX);
      const height = Math.abs(y - drag.startY);
      setDrag({ ...drag, left, top, width, height });
    },
    [drag, pointFromEvent],
  );

  const handlePointerUp = useCallback(() => {
    if (!drag) return;
    if (drag.width >= MIN_MARK_SIZE && drag.height >= MIN_MARK_SIZE) {
      onAddMark(
        pageIndex,
        cssBoxToRect(
          {
            left: drag.left,
            top: drag.top,
            width: drag.width,
            height: drag.height,
          },
          scale,
        ),
      );
    }
    setDrag(null);
  }, [drag, onAddMark, pageIndex, scale]);

  return (
    <div
      ref={containerRef}
      data-redaction-layer
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: active ? "auto" : "none",
        cursor: active ? "crosshair" : undefined,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {marks.map((mark) => {
        const box = rectToCssBox(mark.rect, scale);
        return (
          <div
            key={mark.id}
            data-redaction-mark
            style={{
              position: "absolute",
              left: box.left,
              top: box.top,
              width: box.width,
              height: box.height,
              border: "2px solid var(--color-danger, #dc2626)",
              background: "rgba(220, 38, 38, 0.15)",
              pointerEvents: "none",
            }}
          >
            <button
              type="button"
              aria-label="Remove redaction mark"
              onClick={() => onRemoveMark(pageIndex, mark.id)}
              style={{
                position: "absolute",
                top: -10,
                right: -10,
                width: 20,
                height: 20,
                lineHeight: "18px",
                borderRadius: "50%",
                border: "1px solid var(--color-danger, #dc2626)",
                background: "var(--color-surface, #fff)",
                color: "var(--color-danger, #dc2626)",
                fontSize: 12,
                pointerEvents: "auto",
                cursor: "pointer",
              }}
            >
              ×
            </button>
          </div>
        );
      })}
      {drag && (
        <div
          data-redaction-drag-preview
          style={{
            position: "absolute",
            left: drag.left,
            top: drag.top,
            width: drag.width,
            height: drag.height,
            border: "2px dashed var(--color-danger, #dc2626)",
            background: "rgba(220, 38, 38, 0.1)",
            pointerEvents: "none",
          }}
        />
      )}
    </div>
  );
}
