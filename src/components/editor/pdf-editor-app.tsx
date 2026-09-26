"use client";

import { createPluginRegistration } from "@embedpdf/core";
import {
  EmbedPDF,
  type PluginBatchRegistrations,
  useRegistry,
} from "@embedpdf/core/react";
import type { PdfWidgetAnnoObject } from "@embedpdf/models";
import { AnnotationPluginPackage } from "@embedpdf/plugin-annotation";
import {
  AnnotationLayer,
  useAnnotation,
  useAnnotationCapability,
} from "@embedpdf/plugin-annotation/react";
import { DocumentManagerPluginPackage } from "@embedpdf/plugin-document-manager";
import {
  useActiveDocument,
  useDocumentManagerCapability,
} from "@embedpdf/plugin-document-manager/react";
import { ExportPluginPackage } from "@embedpdf/plugin-export";
import { useExport } from "@embedpdf/plugin-export/react";
import { HistoryPluginPackage } from "@embedpdf/plugin-history";
import { useHistoryCapability } from "@embedpdf/plugin-history/react";
import { InteractionManagerPluginPackage } from "@embedpdf/plugin-interaction-manager";
import {
  GlobalPointerProvider,
  PagePointerProvider,
} from "@embedpdf/plugin-interaction-manager/react";
import { RenderPluginPackage } from "@embedpdf/plugin-render";
import { RenderLayer } from "@embedpdf/plugin-render/react";
import { ScrollPluginPackage } from "@embedpdf/plugin-scroll";
import { Scroller, useScroll } from "@embedpdf/plugin-scroll/react";
import { SelectionPluginPackage } from "@embedpdf/plugin-selection";
import { SelectionLayer } from "@embedpdf/plugin-selection/react";
import { ThumbnailPluginPackage } from "@embedpdf/plugin-thumbnail";
import { ThumbImg, ThumbnailsPane } from "@embedpdf/plugin-thumbnail/react";
import { ViewportPluginPackage } from "@embedpdf/plugin-viewport";
import { Viewport } from "@embedpdf/plugin-viewport/react";
import { ZoomMode, ZoomPluginPackage } from "@embedpdf/plugin-zoom";
import { useZoom } from "@embedpdf/plugin-zoom/react";
import {
  Highlighter,
  ImagePlus,
  type LucideIcon,
  Minus,
  MousePointer2,
  PenLine,
  Redo2,
  Signature,
  Square as SquareIcon,
  Strikethrough,
  Type,
  Underline as UnderlineIcon,
  Undo2,
  Waves,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dropzone } from "@/components/dropzone";
import type { AcceptedFile } from "@/components/dropzone-logic";
import { SignatureDialog } from "@/components/editor/signature-dialog";
import { Button } from "@/components/ui/button";
import { flattenExportedForms } from "@/lib/editor/flatten-forms";
import { createPdfiumWorkerEngine } from "@/lib/editor/pdfium-engine";
import { FormLayer, isFillableWidget } from "./form-layer";

/**
 * The PDF editor's app-mode UI (ADR-0009), built on `@embedpdf/core`'s
 * plugin architecture (E1b Unit 2) rather than the bare `PdfEngine` calls
 * E1 used directly — a virtualised multi-page scroll, zoom, thumbnails and
 * a real undo/redo timeline all come from MIT plugins instead of hand-rolled
 * state. The one non-MIT exclusion (`@embedpdf/plugin-form`, unlicensed) is
 * never imported, per ADR-0009.
 *
 * The `engine` prop `<EmbedPDF>` receives is `createPdfiumWorkerEngine()`'s
 * `WebWorkerEngine` — a proxy over OUR OWN worker (`pdfium.worker.ts`), never
 * an EmbedPDF-spawned one (see docs/editor/EMBEDPDF_NOTES.md, "E0b — the fix
 * and what's proven now"). Every plugin's PDFium call — render, annotate,
 * export — crosses that same `postMessage` proxy; this component only ever
 * touches DOM (invariant 2).
 */

/** The default annotation tools this editor exposes, in toolbar order. Ids
 * match `@embedpdf/plugin-annotation`'s default tool set exactly — no custom
 * tools are registered, just a subset surfaced in the UI. */
const ANNOTATION_TOOLS: ReadonlyArray<{
  id: string;
  label: string;
  icon: LucideIcon;
}> = [
  { id: "highlight", label: "Highlight", icon: Highlighter },
  { id: "underline", label: "Underline", icon: UnderlineIcon },
  { id: "strikeout", label: "Strikethrough", icon: Strikethrough },
  { id: "squiggly", label: "Squiggly underline", icon: Waves },
  { id: "ink", label: "Draw", icon: PenLine },
  { id: "square", label: "Rectangle", icon: SquareIcon },
  { id: "circle", label: "Ellipse", icon: SquareIcon },
  { id: "lineArrow", label: "Line / arrow", icon: Minus },
  { id: "freeText", label: "Add text", icon: Type },
  { id: "stamp", label: "Insert image", icon: ImagePlus },
];

/** Tool ids whose creation context takes a stroke/fill color. FreeText takes
 * `fontColor` instead — see `buildToolContext`. Stamp takes neither. */
const COLOR_STYLE_TOOLS = new Set([
  "highlight",
  "underline",
  "strikeout",
  "squiggly",
  "ink",
  "square",
  "circle",
  "lineArrow",
]);

/** Maps the toolbar's color/stroke-width/font-size pickers onto the field
 * names `@embedpdf/plugin-annotation`'s built-in tools actually read off
 * `tool.defaults` (see its `default-tools` module): color-style tools read
 * `color`/`strokeColor`/`strokeWidth`, FreeText reads `fontColor`/`fontSize`.
 * Used as the patch for `AnnotationCapability.setToolDefaults` — NOT as
 * `setActiveTool`'s second argument. That argument only lands in
 * `activeToolContext`, which no shipped pointer handler ever reads (grep
 * `getToolContext` in the plugin's dist bundle); a tool's *actual* creation
 * defaults always come from `tool.defaults` via `getTool()`, so
 * `setToolDefaults` is the only thing that can change what the next
 * annotation looks like. */
function buildToolContext(
  toolId: string,
  color: string,
  strokeWidth: number,
  fontSize: number,
): Record<string, unknown> | undefined {
  if (COLOR_STYLE_TOOLS.has(toolId)) {
    return { color, strokeColor: color, strokeWidth };
  }
  if (toolId === "freeText") {
    return { fontColor: color, fontSize };
  }
  return undefined;
}

/** Registered once per mount — plugin *packages* are plain config objects,
 * never the source of PDFium/CDN string literals themselves (those live in
 * `@embedpdf/engines`, dynamic-imported only from inside `pdfium.worker.ts`
 * and this lazily-loaded editor chunk — see `src/components/app-registry.tsx`
 * and `scripts/check-sizes.ts`'s `@embedpdf` first-load guard). */
const plugins: PluginBatchRegistrations = [
  createPluginRegistration(DocumentManagerPluginPackage, {}),
  createPluginRegistration(ViewportPluginPackage, {}),
  createPluginRegistration(ScrollPluginPackage, {}),
  createPluginRegistration(RenderPluginPackage, {}),
  createPluginRegistration(ZoomPluginPackage, {
    defaultZoomLevel: ZoomMode.FitWidth,
  }),
  createPluginRegistration(ThumbnailPluginPackage, {}),
  createPluginRegistration(SelectionPluginPackage, {}),
  createPluginRegistration(InteractionManagerPluginPackage, {}),
  createPluginRegistration(AnnotationPluginPackage, {
    // A newly created FreeText annotation starts in edit mode so the user
    // (or the e2e suite) can type right away instead of needing a separate
    // double-click-to-edit gesture.
    editAfterCreate: true,
  }),
  createPluginRegistration(HistoryPluginPackage, {}),
  createPluginRegistration(ExportPluginPackage, {
    defaultFileName: "document-edited.pdf",
  }),
];

export function PdfEditorApp() {
  // Lazily created exactly once (the `useState` initializer form, not
  // `useRef(createPdfiumWorkerEngine())`) — a bare `useRef(fn())` still calls
  // `fn()` on every render, since the *argument* is evaluated before `useRef`
  // ever looks at it; only the initial return value is kept, but each
  // re-render still spawned and immediately orphaned a fresh worker. A
  // worker session isn't render state, so this stays outside React state
  // otherwise, and is freed on unmount (route change or the tool page
  // itself unmounting) so a heavy engine + wasm heap is never left running.
  const [engineHandle] = useState(() => createPdfiumWorkerEngine());
  // Tracks `engineHandle.ready` (see its doc comment in pdfium-engine.ts) as
  // render state, so `EditorShell` can gate opening a document on it. The
  // plugin registry (`useRegistry().pluginsReady`) says the DocumentManager
  // *capability* exists; it says nothing about whether the PDFium worker
  // behind it has actually finished fetching + initializing wasm. Those two
  // readinesses are independent — the plugin registry initializes
  // synchronously in JS, while the worker's readiness depends on a network
  // fetch that can take anywhere from milliseconds to (under load, as in a
  // parallel e2e run) many seconds. Calling into the engine before it signals
  // ready sends a `postMessage` the worker isn't listening for yet — and,
  // because there's no built-in queueing, that message is simply never
  // received: the caller hangs forever waiting for a response, with no error.
  const [engineReady, setEngineReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    engineHandle.ready.then(() => {
      if (!cancelled) setEngineReady(true);
    });
    return () => {
      cancelled = true;
      engineHandle.terminate();
    };
  }, [engineHandle]);

  // The Dropzone and the chosen file live HERE, outside `<EmbedPDF>`: once its
  // plugins are ready, EmbedPDF wraps its children in `<AutoMount>` — a
  // different element type — so React unmounts and remounts the whole
  // subtree. A file set on an input inside it around that moment landed on a
  // detached element and was silently lost. Nothing out here ever remounts.
  const [file, setFile] = useState<File | null>(null);
  const [loaded, setLoaded] = useState(false);
  const handleFiles = useCallback((accepted: AcceptedFile[]) => {
    const first = accepted[0];
    if (first) setFile(first.file);
  }, []);

  return (
    <div className="flex flex-col gap-4">
      {!loaded && <Dropzone accepts={["pdf"]} onFiles={handleFiles} />}
      <EmbedPDF engine={engineHandle.engine} plugins={plugins}>
        <EditorShell
          engineReady={engineReady}
          file={file}
          onLoadedChange={setLoaded}
        />
      </EmbedPDF>
    </div>
  );
}

interface EditorShellProps {
  /** True once the PDFium worker has signalled it's actually ready to
   * receive engine calls — see `PdfEditorApp`'s comment above. Opening a
   * document must never happen before this is true. */
  engineReady: boolean;
  /** The file the user picked, held by `PdfEditorApp` (outside EmbedPDF's
   * remounting subtree). Opened as soon as everything below is ready. */
  file: File | null;
  onLoadedChange: (loaded: boolean) => void;
}

function EditorShell({ engineReady, file, onLoadedChange }: EditorShellProps) {
  const documentManager = useDocumentManagerCapability();
  const { activeDocumentId, activeDocument } = useActiveDocument();
  const { pluginsReady } = useRegistry();
  const [error, setError] = useState<string | null>(null);
  // Ready to actually open a document: the plugin registry has a
  // DocumentManager capability AND the PDFium worker has finished
  // initializing (see `engineReady`). A file picked earlier simply waits in
  // `PdfEditorApp`'s state until this flips — it is never dropped.
  const ready = pluginsReady && engineReady;
  const provides = documentManager.provides;
  const openedRef = useRef<File | null>(null);

  useEffect(() => {
    if (!file || !ready || !provides || openedRef.current === file) return;
    openedRef.current = file;
    setError(null);
    (async () => {
      try {
        const buffer = await file.arrayBuffer();
        const { task } = await provides
          .openDocumentBuffer({ buffer, name: file.name })
          .toPromise();
        await task.toPromise();
      } catch {
        setError("Couldn't open this PDF.");
      }
    })();
  }, [file, ready, provides]);

  const isLoaded = !!activeDocumentId && activeDocument?.status === "loaded";
  useEffect(() => {
    onLoadedChange(isLoaded);
  }, [isLoaded, onLoadedChange]);

  if (!activeDocumentId || !activeDocument || !isLoaded) {
    return (
      <>
        {!ready && (
          <p
            role="status"
            aria-live="polite"
            className="text-sm text-ink-muted"
          >
            Loading editor…
          </p>
        )}
        {error && <p className="text-sm text-danger">{error}</p>}
        {activeDocument?.status === "error" && (
          <p className="text-sm text-danger">
            {activeDocument.error ?? "Couldn't open this PDF."}
          </p>
        )}
      </>
    );
  }

  return (
    <Editor
      documentId={activeDocumentId}
      fileName={activeDocument.name ?? "document.pdf"}
    />
  );
}

interface EditorProps {
  documentId: string;
  fileName: string;
}

function Editor({ documentId, fileName }: EditorProps) {
  // Scoped to `documentId`, for everything that acts on THIS document's
  // annotations (create/select/delete/setActiveTool). Style pickers, below,
  // instead go through the unscoped `useAnnotationCapability()` — tool
  // defaults are global plugin state, not per-document, and (more importantly)
  // `annotation.provides` here is a NEW object every render (`forDocument`
  // wraps a fresh closure each call — see AnnotationPlugin.createAnnotationScope
  // in @embedpdf/plugin-annotation), so it must never sit in a style-driven
  // effect's dependency array. That was the actual highlight-commit bug: an
  // effect keyed on `[color, ..., annotation.provides]` re-ran on every
  // render, including the ones a selection change fires *during* a drag, and
  // called `setActiveTool` again mid-drag — which tears down the active
  // pointer handler (plugin-selection's `onHandlerActiveEnd` resets
  // `dragStarted`) before `onPointerUp` ever commits the annotation.
  const annotation = useAnnotation(documentId);
  const annotationCapability = useAnnotationCapability();
  const history = useHistoryCapability();
  const { provides: exportProvides } = useExport(documentId);
  const zoom = useZoom(documentId);
  const scroll = useScroll(documentId);

  // The toolbar's pressed state now reflects the plugin's own activeToolId
  // (`annotation.state`), not a locally-tracked mirror -- so it can never
  // drift from what the plugin will actually do on the next pointer event.
  const activeTool = annotation.state.activeToolId;
  const [color, setColor] = useState("#ffd400");
  const [strokeWidth, setStrokeWidth] = useState(3);
  const [fontSize, setFontSize] = useState(16);
  const [exporting, setExporting] = useState(false);
  const stampInputRef = useRef<HTMLInputElement | null>(null);
  const [signOpen, setSignOpen] = useState(false);

  // E2a — form filling. Tracks which page indexes currently have at least
  // one fillable widget, reported up by each page's `FormLayer` once it
  // loads (see that component's `onWidgetsLoaded`). The "Flatten forms"
  // export checkbox only ever appears when this is non-empty — a document
  // with no form fields never shows it.
  const [pagesWithFields, setPagesWithFields] = useState<Set<number>>(
    () => new Set(),
  );
  const handleWidgetsLoaded = useCallback(
    (pageIndex: number, widgets: PdfWidgetAnnoObject[]) => {
      const has = widgets.some(isFillableWidget);
      setPagesWithFields((prev) => {
        if (has === prev.has(pageIndex)) return prev;
        const next = new Set(prev);
        if (has) next.add(pageIndex);
        else next.delete(pageIndex);
        return next;
      });
    },
    [],
  );
  const hasFormFields = pagesWithFields.size > 0;
  const [flattenForms, setFlattenForms] = useState(false);

  // `history.provides.canUndo()`/`canRedo()` are plain methods, not reactive
  // state -- calling them doesn't subscribe this component to anything, so
  // the Undo/Redo buttons would never re-render after an undo/redo/register
  // unless something else happened to re-render this tree first. Bumping a
  // counter on the capability's own change event forces that re-render, so
  // `disabled={!history.provides?.canUndo()}` below always reflects the
  // current stack.
  const [, setHistoryTick] = useState(0);
  useEffect(() => {
    const provides = history.provides;
    if (!provides) return;
    return provides.onHistoryChange(() => setHistoryTick((t) => t + 1));
  }, [history.provides]);

  const applyActiveTool = useCallback(
    (toolId: string | null) => {
      const provides = annotation.provides;
      if (!provides) return;
      if (toolId === "stamp") {
        stampInputRef.current?.click();
        return;
      }
      // No style context passed here: the style-defaults effect below fires
      // right after `activeTool` changes and pushes the current picker values
      // onto the tool via `setToolDefaults` — the mechanism that actually
      // affects what gets created (see the effect's comment).
      provides.setActiveTool(toolId);
    },
    [annotation.provides],
  );

  // Pushes the style pickers onto the active tool's *defaults* whenever they
  // change, so the NEXT annotation created picks up the new color/stroke/font
  // size. Deliberately does NOT call `setActiveTool` (that's `applyActiveTool`
  // above, fired once from the toolbar click) -- `setToolDefaults` only
  // merges a patch into the plugin's tool-defaults state, never touches the
  // interaction manager, so it's safe to run on every keystroke even while a
  // drag is in progress (see the comment on `annotation`, above, for why the
  // previous version of this effect broke that). `annotationCapability.provides`
  // is the STABLE, unscoped capability object, unlike `annotation.provides`.
  useEffect(() => {
    const provides = annotationCapability.provides;
    if (!activeTool || !provides) return;
    const patch = buildToolContext(activeTool, color, strokeWidth, fontSize);
    if (patch) provides.setToolDefaults(activeTool, patch);
  }, [activeTool, color, strokeWidth, fontSize, annotationCapability.provides]);

  // Shared by both stamp-placement paths — the file-picker "Insert image"
  // tool below, and `SignatureDialog`'s drawn/typed/uploaded PNG — so the
  // actual stamp-placement call only lives in one place.
  //
  // `setActiveTool`'s `context` argument is unused by the stamp tool's own
  // handler (gotcha #8 in EMBEDPDF_NOTES.md): its `onHandlerActiveStart`
  // reads `tool.defaults.imageSrc` and `fetch()`s it — a `{ data, mimeType }`
  // context passed to `setActiveTool` is simply never read, so no stamp was
  // ever placed. The image bytes must go through `setToolDefaults` instead,
  // as a same-origin `blob:` URL (CSP's `connect-src` already allows
  // `blob:`), *before* activating the tool.
  const stampUrlRef = useRef<string | null>(null);
  const placeStamp = useCallback(
    (data: ArrayBuffer, mimeType: string) => {
      const url = URL.createObjectURL(new Blob([data], { type: mimeType }));
      const previous = stampUrlRef.current;
      stampUrlRef.current = url;
      annotationCapability.provides?.setToolDefaults("stamp", {
        imageSrc: url,
      });
      annotation.provides?.setActiveTool("stamp");
      // The stamp handler's `onHandlerActiveStart` fetches `imageSrc` only
      // once the tool actually activates, so the PREVIOUS url (already
      // fetched and cached, or never activated at all) is safe to revoke
      // now — the new one just set above must not be revoked yet.
      if (previous) URL.revokeObjectURL(previous);
    },
    [annotation.provides, annotationCapability.provides],
  );

  useEffect(() => {
    return () => {
      if (stampUrlRef.current) URL.revokeObjectURL(stampUrlRef.current);
    };
  }, []);

  const handleStampFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      const data = await file.arrayBuffer();
      placeStamp(data, file.type);
    },
    [placeStamp],
  );

  const handleUndo = useCallback(
    () => history.provides?.undo(),
    [history.provides],
  );
  const handleRedo = useCallback(
    () => history.provides?.redo(),
    [history.provides],
  );

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      // A FreeText annotation opens its own contenteditable region on create
      // (`editAfterCreate`, above). While that's focused, Ctrl+Z/Ctrl+Shift+Z
      // must stay native browser text-undo (reverting typed characters), not
      // our history plugin's document-level undo -- otherwise typing "abc"
      // then Ctrl+Z would silently delete the whole annotation instead of the
      // "c", and the plugin's own undo stack would never see the keystroke.
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
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

  const handleExport = useCallback(async () => {
    if (!exportProvides) return;
    setExporting(true);
    try {
      let bytes = await exportProvides.saveAsCopy().toPromise();
      // Runs pdf-lib's `flatten` op on these exported bytes in a fresh
      // engine worker (see flattenExportedForms's doc comment) — the
      // user's open document, still on screen and still editable, is never
      // touched by this.
      if (flattenForms) {
        bytes = await flattenExportedForms(bytes);
      }
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
  }, [exportProvides, fileName, flattenForms]);

  const onWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      if (!e.ctrlKey || !zoom.provides) return;
      e.preventDefault();
      zoom.provides.requestZoomBy(e.deltaY < 0 ? 0.1 : -0.1);
    },
    [zoom.provides],
  );

  const zoomPercent = useMemo(
    () => Math.round((zoom.state.currentZoomLevel || 1) * 100),
    [zoom.state.currentZoomLevel],
  );

  const renderPage = useCallback(
    (layout: { pageIndex: number }) => (
      // `data-page-index` is our own e2e hook (see e2e/pdf-editor.spec.ts):
      // the ThumbnailsPane's own `<img>`s sit earlier in DOM order than this
      // rendered page, so a bare `page.locator("img").first()` would find a
      // thumbnail instead of the real page — this attribute lets the suite
      // target the actual rendered page unambiguously.
      <div
        data-page-index={layout.pageIndex}
        style={{ position: "absolute", inset: 0 }}
      >
        <PagePointerProvider
          documentId={documentId}
          pageIndex={layout.pageIndex}
          style={{ position: "absolute", inset: 0 }}
        >
          <RenderLayer
            documentId={documentId}
            pageIndex={layout.pageIndex}
            style={{ position: "absolute", inset: 0 }}
            // Images are natively draggable in the browser. Without this, a
            // slow mouse-drag across the rendered page (exactly what a
            // text-markup annotation drag is) starts a native HTML5 drag
            // gesture instead: the browser fires `dragstart`/`drag`/`dragend`
            // and never delivers the `pointerup`/`mouseup` that
            // plugin-selection's text handler waits for to end the
            // selection, so `onEnd` — and therefore annotation creation —
            // never runs. No error, no rejection: the drag "succeeds" as a
            // no-op image drag instead.
            draggable={false}
          />
          <SelectionLayer
            documentId={documentId}
            pageIndex={layout.pageIndex}
          />
          <AnnotationLayer
            documentId={documentId}
            pageIndex={layout.pageIndex}
          />
          <FormLayer
            documentId={documentId}
            pageIndex={layout.pageIndex}
            toolActive={activeTool !== null}
            onWidgetsLoaded={handleWidgetsLoaded}
          />
        </PagePointerProvider>
      </div>
    ),
    [documentId, activeTool, handleWidgetsLoaded],
  );

  return (
    <div className="flex flex-col gap-4">
      <div
        role="toolbar"
        aria-label="Annotation tools"
        className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface p-2"
      >
        <Button
          type="button"
          variant={activeTool === null ? "default" : "outline"}
          size="icon"
          aria-label="Select"
          aria-pressed={activeTool === null}
          onClick={() => applyActiveTool(null)}
        >
          <MousePointer2 aria-hidden="true" />
        </Button>
        {ANNOTATION_TOOLS.map((t) => (
          <Button
            key={t.id}
            type="button"
            variant={activeTool === t.id ? "default" : "outline"}
            size="icon"
            aria-label={t.label}
            aria-pressed={activeTool === t.id}
            onClick={() => applyActiveTool(t.id)}
          >
            <t.icon aria-hidden="true" />
          </Button>
        ))}

        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Sign"
          onClick={() => setSignOpen(true)}
        >
          <Signature aria-hidden="true" />
        </Button>

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
            aria-label="Zoom out"
            onClick={() => zoom.provides?.zoomOut()}
          >
            <ZoomOut aria-hidden="true" />
          </Button>
          <span className="w-12 text-center text-xs text-ink-muted">
            {zoomPercent}%
          </span>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Zoom in"
            onClick={() => zoom.provides?.zoomIn()}
          >
            <ZoomIn aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Undo"
            disabled={!history.provides?.canUndo()}
            onClick={handleUndo}
          >
            <Undo2 aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Redo"
            disabled={!history.provides?.canRedo()}
            onClick={handleRedo}
          >
            <Redo2 aria-hidden="true" />
          </Button>
          {hasFormFields && (
            <label className="flex items-center gap-1 text-xs text-ink-muted">
              <input
                type="checkbox"
                checked={flattenForms}
                onChange={(e) => setFlattenForms(e.target.checked)}
              />
              Flatten forms
            </label>
          )}
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

      <SignatureDialog
        open={signOpen}
        onClose={() => setSignOpen(false)}
        onPlace={(data, mimeType) => {
          setSignOpen(false);
          placeStamp(data, mimeType);
        }}
      />

      <div className="flex gap-3">
        <div className="hidden w-32 shrink-0 sm:block">
          <ThumbnailsPane
            documentId={documentId}
            style={{ height: 480 }}
            className="rounded-md border border-border bg-canvas"
          >
            {(meta) => (
              <button
                key={meta.pageIndex}
                type="button"
                aria-label={`Go to page ${meta.pageIndex + 1}`}
                style={{
                  position: "absolute",
                  top: meta.top,
                  left: 0,
                  right: 0,
                  height: meta.wrapperHeight,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  cursor: "pointer",
                }}
                onClick={() =>
                  scroll.provides?.scrollToPage({
                    pageNumber: meta.pageIndex + 1,
                  })
                }
              >
                <ThumbImg
                  documentId={documentId}
                  meta={meta}
                  style={{ width: meta.width, height: meta.height }}
                />
                <span className="text-xs text-ink-muted">
                  {meta.pageIndex + 1}
                </span>
              </button>
            )}
          </ThumbnailsPane>
        </div>

        <Viewport
          documentId={documentId}
          className="flex-1 overflow-auto rounded-md border border-border bg-canvas"
          // `<Viewport>` sets its own inline `style={{ height: "100%", ... }}`
          // internally (see @embedpdf/plugin-viewport/react), which as an
          // inline style always wins over a Tailwind height class on the
          // same element regardless of specificity tricks. `height: "100%"`
          // needs a definite-height ancestor to resolve against; the flex
          // row here (`flex gap-3`, no explicit height) is itself sized to
          // its tallest child, so the two heights depend on each other and
          // the browser collapses the viewport to its content's natural
          // (near-zero) height instead — leaving it permanently gated (see
          // docs/editor/EMBEDPDF_NOTES.md, "The viewport-gate deadlock").
          // Passing an absolute `style` height here is spread in AFTER the
          // component's own defaults, so it overrides "100%" with a real
          // pixel value the flex row no longer needs to help resolve.
          style={{ height: 480 }}
          onWheel={onWheel}
        >
          <GlobalPointerProvider documentId={documentId}>
            <Scroller documentId={documentId} renderPage={renderPage} />
          </GlobalPointerProvider>
        </Viewport>
      </div>
    </div>
  );
}
