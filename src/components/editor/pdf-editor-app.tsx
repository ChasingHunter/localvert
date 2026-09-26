"use client";

import type {
  PdfAnnotationObject,
  PdfDocumentObject,
  PdfPageObject,
} from "@embedpdf/models";
import {
  PdfAnnotationBorderStyle,
  PdfAnnotationSubtype,
  PdfStandardFont,
  PdfTextAlignment,
  PdfVerticalAlignment,
} from "@embedpdf/models";
import {
  Highlighter,
  ImagePlus,
  type LucideIcon,
  Minus,
  MousePointer2,
  PenLine,
  Redo2,
  Square,
  Strikethrough,
  Type,
  Underline as UnderlineIcon,
  Undo2,
} from "lucide-react";
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Dropzone } from "@/components/dropzone";
import type { AcceptedFile } from "@/components/dropzone-logic";
import { Button } from "@/components/ui/button";
import { createPdfiumWorkerEngine } from "@/lib/editor/pdfium-engine";

/**
 * The PDF editor's app-mode UI (ADR-0009). Built directly on the bare
 * `PdfEngine` API (`createPdfiumWorkerEngine`), not `@embedpdf/core` +
 * `plugin-*` — the plugin/React layer pulls in a UI framework this codebase
 * doesn't otherwise use, for interaction handling this component implements
 * directly instead (see the "Decide" bullet in
 * docs/editor/EMBEDPDF_NOTES.md, left open as of E1). One page is shown at a
 * time (prev/next), not a virtualised multi-page scroll with a thumbnail
 * rail — a scoped-down first cut; the full ADR-0009 viewer shape is
 * follow-up work.
 *
 * Every PDFium call goes through `engine`, which proxies to
 * `pdfium.worker.ts` — this component only ever touches DOM (the rendered
 * page `<img>`, pointer events for drawing) and object URLs (invariant 2).
 */

type ToolId =
  | "select"
  | "highlight"
  | "underline"
  | "strikeout"
  | "ink"
  | "rectangle"
  | "ellipse"
  | "line"
  | "freetext"
  | "stamp";

interface ToolSpec {
  id: ToolId;
  label: string;
  icon: LucideIcon;
}

const TOOLS: readonly ToolSpec[] = [
  { id: "select", label: "Select", icon: MousePointer2 },
  { id: "highlight", label: "Highlight", icon: Highlighter },
  { id: "underline", label: "Underline", icon: UnderlineIcon },
  { id: "strikeout", label: "Strikethrough", icon: Strikethrough },
  { id: "ink", label: "Draw", icon: PenLine },
  { id: "rectangle", label: "Rectangle", icon: Square },
  { id: "ellipse", label: "Ellipse", icon: Square },
  { id: "line", label: "Line / arrow", icon: Minus },
  { id: "freetext", label: "Add text", icon: Type },
  { id: "stamp", label: "Insert image", icon: ImagePlus },
];

const RENDER_SCALE = 1.5;

interface PdfPoint {
  x: number;
  y: number;
}

/** One undoable action: the annotation as it was created, plus the page it
 * lives on. Undo removes it; redo re-creates the exact same object (same id,
 * so it round-trips through export identically either way). */
interface HistoryEntry {
  page: PdfPageObject;
  annotation: PdfAnnotationObject;
}

let nextAnnotationId = 1;
function newAnnotationId(): string {
  return `localvert-annot-${nextAnnotationId++}`;
}

/** Screen-space (top-left origin, y-down) -> PDF page space (bottom-left
 * origin, y-up) — annotation rects are always in the latter, regardless of
 * how the page happens to be rendered on screen. */
function toPdfPoint(
  screenX: number,
  screenY: number,
  renderedWidth: number,
  renderedHeight: number,
  page: PdfPageObject,
): PdfPoint {
  const scaleX = page.size.width / renderedWidth;
  const scaleY = page.size.height / renderedHeight;
  return {
    x: screenX * scaleX,
    y: page.size.height - screenY * scaleY,
  };
}

function boundingRect(a: PdfPoint, b: PdfPoint) {
  const minX = Math.min(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  return {
    origin: { x: minX, y: minY },
    size: { width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) },
  };
}

export function PdfEditorApp() {
  const engineRef = useRef<ReturnType<typeof createPdfiumWorkerEngine> | null>(
    null,
  );
  const [fileName, setFileName] = useState("document.pdf");
  const [doc, setDoc] = useState<PdfDocumentObject | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageImageUrl, setPageImageUrl] = useState<string | null>(null);
  const [renderedSize, setRenderedSize] = useState({ width: 0, height: 0 });
  const [tool, setTool] = useState<ToolId>("select");
  const [color, setColor] = useState("#ffd400");
  const [strokeWidth, setStrokeWidth] = useState(3);
  const [fontSize, setFontSize] = useState(16);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const undoStack = useRef<HistoryEntry[]>([]);
  const redoStack = useRef<HistoryEntry[]>([]);
  const drawing = useRef<{ start: PdfPoint; points: PdfPoint[] } | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const stampInputRef = useRef<HTMLInputElement | null>(null);
  const pendingStampPoint = useRef<PdfPoint | null>(null);

  // Frees the wasm heap the moment the editor unmounts (route change or the
  // tool page itself unmounting) — a heavy engine is never left running.
  useEffect(() => {
    return () => {
      engineRef.current?.terminate();
    };
  }, []);

  const currentPage = doc?.pages[pageIndex] ?? null;

  const renderCurrentPage = useCallback(async () => {
    const engine = engineRef.current?.engine;
    if (!engine || !doc || !currentPage) return;
    const blob = await engine
      .renderPage(doc, currentPage, { scaleFactor: RENDER_SCALE })
      .toPromise();
    setPageImageUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(blob);
    });
    setRenderedSize({
      width: currentPage.size.width * RENDER_SCALE,
      height: currentPage.size.height * RENDER_SCALE,
    });
  }, [doc, currentPage]);

  useEffect(() => {
    renderCurrentPage();
  }, [renderCurrentPage]);

  const handleFiles = useCallback(async (accepted: AcceptedFile[]) => {
    const first = accepted[0];
    if (!first) return;
    setError(null);
    engineRef.current?.terminate();
    undoStack.current = [];
    redoStack.current = [];
    const created = createPdfiumWorkerEngine();
    engineRef.current = created;
    try {
      const bytes = await first.file.arrayBuffer();
      const opened = await created.engine
        .openDocumentBuffer({ id: "editor-doc", content: bytes })
        .toPromise();
      setFileName(first.file.name);
      setDoc(opened);
      setPageIndex(0);
    } catch {
      setError("Couldn't open this PDF.");
      created.terminate();
      engineRef.current = null;
    }
  }, []);

  const pushHistory = useCallback(
    (page: PdfPageObject, annotation: PdfAnnotationObject) => {
      undoStack.current.push({ page, annotation });
      redoStack.current = [];
    },
    [],
  );

  const createAnnotation = useCallback(
    async (annotation: PdfAnnotationObject) => {
      const engine = engineRef.current?.engine;
      if (!engine || !doc || !currentPage) return;
      await engine
        .createPageAnnotation(doc, currentPage, annotation)
        .toPromise();
      pushHistory(currentPage, annotation);
      await renderCurrentPage();
    },
    [doc, currentPage, pushHistory, renderCurrentPage],
  );

  const handleUndo = useCallback(async () => {
    const engine = engineRef.current?.engine;
    const entry = undoStack.current.pop();
    if (!engine || !doc || !entry) return;
    await engine
      .removePageAnnotation(doc, entry.page, entry.annotation)
      .toPromise();
    redoStack.current.push(entry);
    await renderCurrentPage();
  }, [doc, renderCurrentPage]);

  const handleRedo = useCallback(async () => {
    const engine = engineRef.current?.engine;
    const entry = redoStack.current.pop();
    if (!engine || !doc || !entry) return;
    await engine
      .createPageAnnotation(doc, entry.page, entry.annotation)
      .toPromise();
    undoStack.current.push(entry);
    await renderCurrentPage();
  }, [doc, renderCurrentPage]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      if (e.key.toLowerCase() === "z" && e.shiftKey) {
        e.preventDefault();
        handleRedo();
      } else if (e.key.toLowerCase() === "z") {
        e.preventDefault();
        handleUndo();
      } else if (e.key.toLowerCase() === "y") {
        e.preventDefault();
        handleRedo();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleUndo, handleRedo]);

  const screenPoint = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>): PdfPoint | null => {
      if (!currentPage || renderedSize.width === 0) return null;
      const rect = e.currentTarget.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      return toPdfPoint(
        sx,
        sy,
        renderedSize.width,
        renderedSize.height,
        currentPage,
      );
    },
    [currentPage, renderedSize],
  );

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const point = screenPoint(e);
      if (!point) return;

      if (tool === "freetext") {
        pendingStampPoint.current = point;
        const text = window.prompt("Text to add:");
        if (text?.trim()) {
          const height = Math.max(fontSize * 1.6, 24);
          createAnnotation({
            id: newAnnotationId(),
            type: PdfAnnotationSubtype.FREETEXT,
            pageIndex,
            rect: {
              origin: { x: point.x, y: point.y - height },
              size: { width: 220, height },
            },
            contents: text,
            fontFamily: PdfStandardFont.Helvetica,
            fontSize,
            fontColor: color,
            textAlign: PdfTextAlignment.Left,
            verticalAlign: PdfVerticalAlignment.Top,
            opacity: 1,
          });
        }
        return;
      }

      if (tool === "stamp") {
        pendingStampPoint.current = point;
        stampInputRef.current?.click();
        return;
      }

      if (tool === "select") return;
      drawing.current = { start: point, points: [point] };
    },
    [tool, screenPoint, fontSize, color, pageIndex, createAnnotation],
  );

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!drawing.current || tool !== "ink") return;
      const point = screenPoint(e);
      if (!point) return;
      drawing.current.points.push(point);
    },
    [tool, screenPoint],
  );

  const handlePointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const state = drawing.current;
      drawing.current = null;
      if (!state) return;
      const end = screenPoint(e) ?? state.start;

      if (tool === "ink") {
        if (state.points.length < 2) return;
        const xs = state.points.map((p) => p.x);
        const ys = state.points.map((p) => p.y);
        createAnnotation({
          id: newAnnotationId(),
          type: PdfAnnotationSubtype.INK,
          pageIndex,
          rect: {
            origin: { x: Math.min(...xs), y: Math.min(...ys) },
            size: {
              width: Math.max(...xs) - Math.min(...xs),
              height: Math.max(...ys) - Math.min(...ys),
            },
          },
          inkList: [{ points: state.points }],
          strokeColor: color,
          opacity: 1,
          strokeWidth,
        });
        return;
      }

      const rect = boundingRect(state.start, end);
      if (rect.size.width < 2 && rect.size.height < 2) return;

      if (tool === "highlight") {
        createAnnotation({
          id: newAnnotationId(),
          type: PdfAnnotationSubtype.HIGHLIGHT,
          pageIndex,
          rect,
          segmentRects: [rect],
          opacity: 0.4,
          strokeColor: color,
        });
      } else if (tool === "underline") {
        createAnnotation({
          id: newAnnotationId(),
          type: PdfAnnotationSubtype.UNDERLINE,
          pageIndex,
          rect,
          segmentRects: [rect],
          opacity: 1,
          strokeColor: color,
        });
      } else if (tool === "strikeout") {
        createAnnotation({
          id: newAnnotationId(),
          type: PdfAnnotationSubtype.STRIKEOUT,
          pageIndex,
          rect,
          segmentRects: [rect],
          opacity: 1,
          strokeColor: color,
        });
      } else if (tool === "rectangle") {
        createAnnotation({
          id: newAnnotationId(),
          type: PdfAnnotationSubtype.SQUARE,
          pageIndex,
          rect,
          flags: [],
          color: "transparent",
          opacity: 1,
          strokeWidth,
          strokeColor: color,
          strokeStyle: PdfAnnotationBorderStyle.SOLID,
        });
      } else if (tool === "ellipse") {
        createAnnotation({
          id: newAnnotationId(),
          type: PdfAnnotationSubtype.CIRCLE,
          pageIndex,
          rect,
          flags: [],
          color: "transparent",
          opacity: 1,
          strokeWidth,
          strokeColor: color,
          strokeStyle: PdfAnnotationBorderStyle.SOLID,
        });
      } else if (tool === "line") {
        createAnnotation({
          id: newAnnotationId(),
          type: PdfAnnotationSubtype.LINE,
          pageIndex,
          rect,
          linePoints: { start: state.start, end },
          color,
          opacity: 1,
          strokeWidth,
          strokeColor: color,
          strokeStyle: PdfAnnotationBorderStyle.SOLID,
        });
      }
    },
    [tool, screenPoint, color, strokeWidth, pageIndex, createAnnotation],
  );

  const handleStampFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      const point = pendingStampPoint.current;
      pendingStampPoint.current = null;
      if (!file || !point) return;
      const data = await file.arrayBuffer();
      const size = { width: 150, height: 150 };
      const engine = engineRef.current?.engine;
      if (!engine || !doc || !currentPage) return;
      const annotation: PdfAnnotationObject = {
        id: newAnnotationId(),
        type: PdfAnnotationSubtype.STAMP,
        pageIndex,
        rect: {
          origin: { x: point.x, y: point.y - size.height },
          size,
        },
      };
      await engine
        .createPageAnnotation(doc, currentPage, annotation, {
          data,
          mimeType: file.type as never,
        })
        .toPromise();
      pushHistory(currentPage, annotation);
      await renderCurrentPage();
    },
    [doc, currentPage, pageIndex, pushHistory, renderCurrentPage],
  );

  const handleExport = useCallback(async () => {
    const engine = engineRef.current?.engine;
    if (!engine || !doc) return;
    setExporting(true);
    try {
      const bytes = await engine.saveAsCopy(doc).toPromise();
      const blob = new Blob([bytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const base = fileName.replace(/\.pdf$/i, "");
      const a = document.createElement("a");
      a.href = url;
      a.download = `${base}-edited.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }, [doc, fileName]);

  if (!doc) {
    return (
      <div className="flex flex-col gap-4">
        <Dropzone accepts={["pdf"]} onFiles={handleFiles} />
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        role="toolbar"
        aria-label="Annotation tools"
        className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface p-2"
      >
        {TOOLS.map((t) => (
          <Button
            key={t.id}
            type="button"
            variant={tool === t.id ? "default" : "outline"}
            size="icon"
            aria-label={t.label}
            aria-pressed={tool === t.id}
            onClick={() => setTool(t.id)}
          >
            <t.icon aria-hidden="true" />
          </Button>
        ))}

        <label className="flex items-center gap-1 text-xs text-ink-muted">
          Color
          <input
            type="color"
            aria-label="Annotation color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="size-8 rounded border border-border"
          />
        </label>

        <label className="flex items-center gap-1 text-xs text-ink-muted">
          Stroke
          <input
            type="number"
            aria-label="Stroke width"
            min={1}
            max={20}
            value={strokeWidth}
            onChange={(e) => setStrokeWidth(Number(e.target.value))}
            className="w-14 rounded border border-border bg-canvas px-1 py-0.5 text-ink"
          />
        </label>

        <label className="flex items-center gap-1 text-xs text-ink-muted">
          Font size
          <input
            type="number"
            aria-label="Font size"
            min={8}
            max={72}
            value={fontSize}
            onChange={(e) => setFontSize(Number(e.target.value))}
            className="w-14 rounded border border-border bg-canvas px-1 py-0.5 text-ink"
          />
        </label>

        <div className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Undo"
            onClick={handleUndo}
          >
            <Undo2 aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Redo"
            onClick={handleRedo}
          >
            <Redo2 aria-hidden="true" />
          </Button>
          <Button type="button" onClick={handleExport} disabled={exporting}>
            {exporting ? "Exporting…" : "Export PDF"}
          </Button>
        </div>
      </div>

      <input
        ref={stampInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleStampFile}
      />

      <div className="flex items-center justify-center gap-3 text-sm text-ink-muted">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pageIndex === 0}
          onClick={() => setPageIndex((i) => Math.max(0, i - 1))}
        >
          Previous
        </Button>
        <span>
          Page {pageIndex + 1} of {doc.pageCount}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pageIndex >= doc.pageCount - 1}
          onClick={() =>
            setPageIndex((i) => Math.min(doc.pageCount - 1, i + 1))
          }
        >
          Next
        </Button>
      </div>

      <div className="flex justify-center overflow-auto rounded-md border border-border bg-canvas p-4">
        {pageImageUrl && (
          <div
            className="relative touch-none"
            style={{ width: renderedSize.width, height: renderedSize.height }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          >
            {/* biome-ignore lint/performance/noImgElement: rendered page bitmap from a worker-produced Blob URL, not an optimizable static asset. */}
            <img
              ref={imgRef}
              src={pageImageUrl}
              alt={`Page ${pageIndex + 1}`}
              className="pointer-events-none select-none"
              width={renderedSize.width}
              height={renderedSize.height}
            />
          </div>
        )}
      </div>
    </div>
  );
}
