"use client";

import { createPluginRegistration } from "@embedpdf/core";
import {
  EmbedPDF,
  type PluginBatchRegistrations,
  useDocumentState,
  useRegistry,
} from "@embedpdf/core/react";
import {
  PdfAnnotationSubtype,
  type PdfDocumentObject,
  type PdfWidgetAnnoObject,
  type Rect,
  type SearchResult,
} from "@embedpdf/models";
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
import {
  SelectionLayer,
  useSelectionCapability,
} from "@embedpdf/plugin-selection/react";
import { ThumbnailPluginPackage } from "@embedpdf/plugin-thumbnail";
import { ThumbImg, ThumbnailsPane } from "@embedpdf/plugin-thumbnail/react";
import { ViewportPluginPackage } from "@embedpdf/plugin-viewport";
import { Viewport } from "@embedpdf/plugin-viewport/react";
import { ZoomMode, ZoomPluginPackage } from "@embedpdf/plugin-zoom";
import { useZoom } from "@embedpdf/plugin-zoom/react";
import {
  Eraser,
  Highlighter,
  ImagePlus,
  Keyboard,
  LayoutGrid,
  type LucideIcon,
  Minus,
  MousePointer2,
  PenLine,
  Printer,
  Redo2,
  Search as SearchIcon,
  Signature,
  Square as SquareIcon,
  Strikethrough,
  TextCursorInput,
  Type,
  Underline as UnderlineIcon,
  Undo2,
  Waves,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dropzone } from "@/components/dropzone";
import type { AcceptedFile } from "@/components/dropzone-logic";
import { PageOrganizer } from "@/components/editor/page-organizer";
import { SignatureDialog } from "@/components/editor/signature-dialog";
import { Button } from "@/components/ui/button";
import {
  deleteDraft,
  formatRelativeTime,
  loadDraft,
  saveDraft,
} from "@/lib/editor/draft-store";
import { flattenExportedForms } from "@/lib/editor/flatten-forms";
import { flattenRedactedPagesToImages } from "@/lib/editor/flatten-redacted-pages";
import { arrowKeyNudge } from "@/lib/editor/nudge";
import {
  createPdfiumWorkerEngine,
  type TextEditClient,
} from "@/lib/editor/pdfium-engine";
import {
  pinchRatioToZoomDelta,
  pointerDistance,
} from "@/lib/editor/pinch-zoom";
import { sanitizeExportedPdf } from "@/lib/editor/sanitize-export";
import {
  isTypingTarget,
  matchShortcut,
  SHORTCUTS,
} from "@/lib/editor/shortcuts";
import {
  colorForTool,
  DEFAULT_TOOL_COLORS,
  setToolColor,
} from "@/lib/editor/tool-colors";
import type { ReplacePageImage } from "@/lib/engines/pdf-lib/adapter";
import { FormLayer, isFillableWidget } from "./form-layer";
import { RedactionLayer, type RedactionMark } from "./redaction-layer";
import { SearchBar, SearchHighlightLayer } from "./search-bar";
import { TextEditLayer } from "./text-edit-layer";

/** Cap on pages the print flow will render at once -- rendering (and holding
 * in memory as object URLs) hundreds of full-page PNGs at once is exactly
 * the kind of thing that should have a clear, deliberate limit rather than
 * quietly hanging the tab. */
const MAX_PRINT_PAGES = 300;

/** localStorage key for the "Keep a local draft" switch's own on/off state
 * (E6b) -- NOT the draft content itself, which lives in IndexedDB
 * (`draft-store.ts`). Read/written with try/catch: private-mode Safari can
 * make `localStorage` throw on access. */
const DRAFT_ENABLED_KEY = "localvert:pdf-editor:draft-enabled";

function readDraftEnabledPref(): boolean {
  try {
    return localStorage.getItem(DRAFT_ENABLED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeDraftEnabledPref(enabled: boolean): void {
  try {
    localStorage.setItem(DRAFT_ENABLED_KEY, enabled ? "1" : "0");
  } catch {
    // Best-effort only -- see the constant's doc comment.
  }
}

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

/** Toolbar icon buttons (ADR-0016): 8px radius, not the pill shape reserved
 * for pickers/chips/CTAs — this is dense, small UI, and a pressed tool shows
 * as an `accent-soft` fill with an `accent`-colored icon (`text-accent`,
 * which every lucide icon here inherits as `currentColor`) instead of the
 * Button component's own solid `accent` "default" variant, which is a
 * heavier fill meant for primary actions, not a toggled tool. */
function TOOL_BUTTON_CLASS(active: boolean): string {
  return active
    ? "rounded-lg border-transparent bg-accent-soft text-accent hover:bg-accent-soft"
    : "rounded-lg";
}

/** The page/thumbnail area sits a shade darker than `canvas` so the pages
 * themselves read as paper set against it, in both themes — `color-mix`
 * against the `canvas` token (rather than a new named token) keeps it
 * exactly in step with light/dark and any future palette tweak. */
const EDITOR_CANVAS_BG =
  "bg-[color-mix(in_oklab,var(--color-canvas),black_5%)]";

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
  // No plugin-wide `editAfterCreate`: it is the fallback for every tool that
  // doesn't set its own, so `true` here put freshly placed stamps into edit
  // mode, where the annotation layer drops their drag handlers ("can't
  // position images"). FreeText and Callout already set `editAfterCreate`
  // in their own tool behavior, so text still opens ready to type.
  createPluginRegistration(AnnotationPluginPackage, {}),
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
  // Owner-reported fix, 2026-09-27 -- "Close" toolbar action. `Editor` (deep
  // inside `<EmbedPDF>`) calls `documentManager.closeDocument` itself (same
  // call `PageOrganizer.handleApply` already uses) and then this, purely to
  // reset the state that lives up HERE, above `<EmbedPDF>` -- clearing `file`
  // makes the drop zone reappear so "open another file" is just dropping one.
  const handleClosed = useCallback(() => {
    setFile(null);
    setLoaded(false);
  }, []);

  // E6b — local draft restore banner. Checked once, on mount, before any
  // file is opened; a draft only ever matters at that point (once a document
  // is loaded, `Editor`'s own autosave effect is what would overwrite it).
  const [draft, setDraft] = useState<{
    name: string;
    bytes: ArrayBuffer;
    savedAt: number;
  } | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadDraft().then((found) => {
      if (!cancelled && found) setDraft(found);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const restoreDraft = useCallback(() => {
    if (!draft) return;
    // Same open path as a dropped file (`handleFiles` above): a plain `File`
    // constructed from the saved bytes, so `EditorShell`'s `file.arrayBuffer()`
    // effect can't tell the difference.
    setFile(new File([draft.bytes], draft.name, { type: "application/pdf" }));
    setDraft(null);
  }, [draft]);
  const discardDraft = useCallback(() => {
    setDraft(null);
    deleteDraft();
  }, []);

  return (
    <div className="flex flex-col gap-4">
      {draft && !file && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface p-3 text-sm">
          <span>
            Restore your unsaved draft of <strong>{draft.name}</strong> (saved{" "}
            {formatRelativeTime(draft.savedAt)})?
          </span>
          <div className="ml-auto flex gap-2">
            <Button type="button" size="sm" onClick={restoreDraft}>
              Restore
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={discardDraft}
            >
              Discard
            </Button>
          </div>
        </div>
      )}
      {/* The tool page's own h1, description and privacy line sit right
          above this, so the empty state is just the drop area. */}
      {!loaded && (
        <Dropzone accepts={["pdf"]} onFiles={handleFiles} hideFooterNote />
      )}
      <EmbedPDF engine={engineHandle.engine} plugins={plugins}>
        <EditorShell
          engineReady={engineReady}
          file={file}
          onLoadedChange={setLoaded}
          onClosed={handleClosed}
          textEdit={engineHandle.textEdit}
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
  /** Owner-reported fix, 2026-09-27 -- see `EditorProps.onClosed`. */
  onClosed: () => void;
  textEdit: TextEditClient;
}

function EditorShell({
  engineReady,
  file,
  onLoadedChange,
  onClosed,
  textEdit,
}: EditorShellProps) {
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
      pageCount={activeDocument.document?.pageCount ?? 0}
      textEdit={textEdit}
      onClosed={onClosed}
    />
  );
}

interface EditorProps {
  documentId: string;
  fileName: string;
  pageCount: number;
  textEdit: TextEditClient;
  /** Owner-reported fix, 2026-09-27 -- "Close" (see the toolbar button
   * below). Called AFTER `documentManager.closeDocument` resolves, so
   * `PdfEditorApp` (which owns the `file`/`loaded` state above `<EmbedPDF>`
   * -- see that component's doc comment on why) can reset back to the drop
   * zone. */
  onClosed: () => void;
}

function Editor({
  documentId,
  fileName,
  pageCount,
  textEdit,
  onClosed,
}: EditorProps) {
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
  const documentManager = useDocumentManagerCapability();
  const selection = useSelectionCapability();

  // E4a -- true redaction. `registry.getEngine()` is the same bare `PdfEngine`
  // `FormLayer` already reads this way (see that file's doc comment) --
  // `redactTextInRects`/`applyAllRedactions`/`searchAllPages`/`renderPage`
  // have no `@embedpdf/plugin-*` wrapper, so this talks to the engine
  // directly, same as forms.
  const { registry } = useRegistry();
  const engine = registry?.getEngine() ?? null;
  const documentState = useDocumentState(documentId);
  const doc = documentState?.document ?? null;

  // The toolbar's pressed state now reflects the plugin's own activeToolId
  // (`annotation.state`), not a locally-tracked mirror -- so it can never
  // drift from what the plugin will actually do on the next pointer event.
  const activeTool = annotation.state.activeToolId;
  // Per-tool colour defaults (owner-reported fix, 2026-09-27): a single
  // shared `color` state meant switching tools never changed what the next
  // annotation actually got -- FreeText's `fontColor` and Highlight's
  // `color` both read the SAME state, so picking black for text also made
  // the next highlight black. `tool-colors.ts` keeps one remembered default
  // per tool id instead.
  const [toolColors, setToolColors] = useState(DEFAULT_TOOL_COLORS);
  const [strokeWidth, setStrokeWidth] = useState(3);
  const [fontSize, setFontSize] = useState(16);
  const [exporting, setExporting] = useState(false);
  const stampInputRef = useRef<HTMLInputElement | null>(null);
  const [signOpen, setSignOpen] = useState(false);
  const [organizerOpen, setOrganizerOpen] = useState(false);

  // Owner-reported fix, 2026-09-27 -- the style pickers must edit the
  // SELECTED annotation (not just the next tool's defaults) once one is
  // selected. `annotationCapability.provides.getSelectedAnnotation()` is a
  // plain getter, not reactive state (same situation as `history.provides`
  // below), so `onStateChange` (the STABLE, unscoped capability's own event
  // -- fires on every selection change too) bumps a tick to force a re-read
  // on every render, the same trick `historyTick` already uses.
  const [, setAnnotationStateTick] = useState(0);
  useEffect(() => {
    const provides = annotationCapability.provides;
    if (!provides) return;
    return provides.onStateChange(() => setAnnotationStateTick((t) => t + 1));
  }, [annotationCapability.provides]);
  const selectedAnnotation =
    annotationCapability.provides?.getSelectedAnnotation() ?? null;
  const selectedType = selectedAnnotation?.object.type ?? null;
  const isFreeTextSelected = selectedType === PdfAnnotationSubtype.FREETEXT;
  // What the colour picker shows: the selected annotation's own colour if
  // one is selected (FreeText reads `fontColor`, everything else reads
  // `strokeColor`/`color`), else the active tool's remembered default.
  const displayColor = selectedAnnotation
    ? isFreeTextSelected
      ? ((selectedAnnotation.object as { fontColor?: string }).fontColor ??
        "#000000")
      : ((selectedAnnotation.object as { strokeColor?: string; color?: string })
          .strokeColor ??
        (selectedAnnotation.object as { color?: string }).color ??
        "#000000")
    : colorForTool(toolColors, activeTool);
  const displayFontSize =
    selectedAnnotation && isFreeTextSelected
      ? ((selectedAnnotation.object as { fontSize?: number }).fontSize ??
        fontSize)
      : fontSize;
  const displayStrokeWidth =
    selectedAnnotation && !isFreeTextSelected
      ? ((selectedAnnotation.object as { strokeWidth?: number }).strokeWidth ??
        strokeWidth)
      : strokeWidth;

  /** Applies a style-picker change: if an annotation is selected, edits it
   * directly through `AnnotationCapability.updateAnnotation` (cited in
   * `EMBEDPDF_NOTES.md`'s API notes); the tool's own remembered default is
   * ALSO updated (via the `patch` callback), so the change also sticks for
   * the next annotation created with that tool -- matching how every other
   * PDF editor's style pickers behave. */
  const applyStyleChange = useCallback(
    (patch: Record<string, unknown>) => {
      if (selectedAnnotation) {
        annotation.provides?.updateAnnotation(
          selectedAnnotation.object.pageIndex,
          selectedAnnotation.object.id,
          patch,
        );
      }
    },
    [selectedAnnotation, annotation.provides],
  );

  // E6a -- search. Results and the current hit index live here (not inside
  // `SearchBar`) because `renderPage`, below, hands each page's own subset of
  // hits to that page's `SearchHighlightLayer` -- a single source of truth
  // both the search bar's "n of m" counter and every page's overlay read
  // from.
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchCurrentIndex, setSearchCurrentIndex] = useState(0);
  const handleSearchResultsChange = useCallback(
    (results: SearchResult[], currentIndex: number) => {
      setSearchResults(results);
      setSearchCurrentIndex(currentIndex);
    },
    [],
  );
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

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
  // E4b — "Remove hidden data" export option: pdf-lib's `sanitize` op
  // (metadata + JavaScript + attachments) on the exported bytes. Always
  // offered (unlike "Flatten forms", which only shows for a document that
  // actually has fields) — every PDF can carry metadata/JS/attachments,
  // regardless of whether it has a form.
  const [sanitizeExport, setSanitizeExport] = useState(false);

  // E4a -- redaction marking. Keyed by page index; `Editor` (not
  // `RedactionLayer`) owns this because "Apply redactions" needs every
  // page's marks at once, and "Find & mark" adds marks with no per-page
  // drag gesture at all. Ids are only ever compared for React's `key` /
  // remove-by-id, so a monotonic counter (never reused, even across pages)
  // is enough -- no uuid dependency needed.
  const [redactMode, setRedactMode] = useState(false);
  // E5 -- edit existing text. Its own mode flag, same shape as `redactMode`:
  // mutually exclusive with every annotation tool AND with redact mode,
  // since `TextEditLayer`'s click-to-edit outlines must never compete with
  // another gesture layer for pointer events over the page.
  const [textEditMode, setTextEditMode] = useState(false);
  const [textEditNotice, setTextEditNotice] = useState<string | null>(null);
  const [marks, setMarks] = useState<Record<number, RedactionMark[]>>({});
  const nextMarkId = useRef(0);
  const addMark = useCallback((pageIndex: number, rect: Rect) => {
    const id = `mark-${nextMarkId.current++}`;
    setMarks((prev) => ({
      ...prev,
      [pageIndex]: [...(prev[pageIndex] ?? []), { id, rect }],
    }));
  }, []);
  const removeMark = useCallback((pageIndex: number, id: string) => {
    setMarks((prev) => {
      const existing = prev[pageIndex];
      if (!existing) return prev;
      return { ...prev, [pageIndex]: existing.filter((m) => m.id !== id) };
    });
  }, []);
  const markCount = useMemo(
    () => Object.values(marks).reduce((sum, list) => sum + list.length, 0),
    [marks],
  );

  const [findText, setFindText] = useState("");
  const [finding, setFinding] = useState(false);
  const handleFindAndMark = useCallback(async () => {
    if (!engine || !doc || findText.trim() === "") return;
    setFinding(true);
    try {
      const { results } = await engine
        .searchAllPages(doc, findText)
        .toPromise();
      for (const result of results) {
        for (const rect of result.rects) {
          addMark(result.pageIndex, rect);
        }
      }
    } finally {
      setFinding(false);
    }
  }, [engine, doc, findText, addMark]);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [flattenRedactedToImages, setFlattenRedactedToImages] = useState(true);
  const [applyingRedactions, setApplyingRedactions] = useState(false);
  const applyRedactions = useCallback(async () => {
    if (!engine || !doc || !exportProvides) return;
    setApplyingRedactions(true);
    try {
      const pageIndices = Object.keys(marks)
        .map(Number)
        .filter((i) => (marks[i]?.length ?? 0) > 0);

      for (const pageIndex of pageIndices) {
        const page = doc.pages[pageIndex];
        const rects = marks[pageIndex]?.map((m) => m.rect) ?? [];
        if (!page || rects.length === 0) continue;
        await engine
          .redactTextInRects(doc, page, rects, { drawBlackBoxes: true })
          .toPromise();
        await engine.applyAllRedactions(doc, page).toPromise();
      }

      let bytes = await exportProvides.saveAsCopy().toPromise();

      // Text-only: `redactTextInRects` removes TEXT under a marked box, but
      // leaves an image or vector graphic underneath untouched. Rendering the
      // (already text-redacted) page to a flat PNG and replacing the page's
      // whole content with it removes those too -- at the cost of the page's
      // text no longer being selectable. Rendered here via the SAME PDFium
      // worker (`engine.renderPage`, `pdfium.worker.ts`'s
      // `offscreenImageConverter`) that does every other engine call --
      // never on the main thread (invariant 2).
      if (flattenRedactedToImages && pageIndices.length > 0) {
        const images: ReplacePageImage[] = [];
        const DPI_SCALE = 200 / 72;
        for (const pageIndex of pageIndices) {
          const page = doc.pages[pageIndex];
          if (!page) continue;
          const blob = await engine
            .renderPage(doc, page, {
              scaleFactor: DPI_SCALE,
              imageType: "image/png",
            })
            .toPromise();
          const imageBytes = await blob.arrayBuffer();
          images.push({
            pageIndex,
            bytes: imageBytes,
            width: Math.round(page.size.width * DPI_SCALE),
            height: Math.round(page.size.height * DPI_SCALE),
          });
        }
        if (images.length > 0) {
          bytes = await flattenRedactedPagesToImages(bytes, images);
        }
      }

      setMarks({});
      setConfirmOpen(false);

      // No render-refresh API exists on the render plugin (checked --
      // see docs/editor/EMBEDPDF_NOTES.md) to force the on-screen page to
      // reflect content PDFium just changed underneath it. Re-opening the
      // just-exported bytes as a fresh document is the documented fallback:
      // `DocumentManagerCapability.openDocumentBuffer` (the same call
      // `EditorShell` uses for the user's original file) replaces the active
      // document, so every plugin (render, thumbnails, history) picks up the
      // new content on its next render.
      const provides = documentManager.provides;
      if (provides) {
        // Close the pre-redaction copy first, as the page organizer does, so
        // it doesn't linger in the worker's memory.
        await provides.closeDocument(documentId).toPromise();
        const { task } = await provides
          .openDocumentBuffer({ buffer: bytes, name: fileName })
          .toPromise();
        await task.toPromise();
      }
    } finally {
      setApplyingRedactions(false);
    }
  }, [
    engine,
    doc,
    exportProvides,
    marks,
    flattenRedactedToImages,
    documentManager.provides,
    fileName,
    documentId,
  ]);

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

  // E6a -- tracks whether there's a live text selection on THIS document, so
  // the toolbar's "Copy" button only appears while there's something to
  // copy. `selection.provides` has no reactive state of its own (same
  // situation as `history.provides.canUndo()` above), so this subscribes to
  // `onSelectionChange` and filters to this document's events.
  const [hasSelection, setHasSelection] = useState(false);
  useEffect(() => {
    const provides = selection.provides;
    if (!provides) return;
    return provides.onSelectionChange((event) => {
      if (event.documentId !== documentId) return;
      setHasSelection(event.selection !== null);
    });
  }, [selection.provides, documentId]);

  // `selection.provides.copyToClipboard` (called by both the "Copy" button
  // above and the Ctrl/Cmd+C shortcut below) only EMITS the selected text on
  // `onCopyToClipboard` -- @embedpdf/plugin-selection never touches the real
  // Clipboard API itself (confirmed by reading its source: `copyToClipboard`
  // is `getSelectedText(...).wait(text => this.copyToClipboard$.emit(...))`,
  // nothing more). Without a listener actually writing that text to
  // `navigator.clipboard`, "Copy" was a complete no-op: no error, no
  // rejection, just an empty clipboard forever. This is that listener.
  useEffect(() => {
    const provides = selection.provides;
    if (!provides) return;
    return provides.onCopyToClipboard(({ text }) => {
      navigator.clipboard.writeText(text).catch(() => {
        // Clipboard permission can be denied by the browser/user; there's no
        // in-app affordance for that failure yet, so it's swallowed rather
        // than surfaced as a crash -- same as every other `ignore`d task in
        // this file's EmbedPDF wiring.
      });
    });
  }, [selection.provides]);

  const applyActiveTool = useCallback(
    (toolId: string | null) => {
      const provides = annotation.provides;
      if (!provides) return;
      if (toolId === "stamp") {
        stampInputRef.current?.click();
        return;
      }
      // Picking any annotation tool (or Select) leaves redact mode, the same
      // way `RedactionLayer`'s own doc comment says the Redact button leaves
      // every annotation tool -- the two gesture layers must never both want
      // pointer events over the page at once.
      setRedactMode(false);
      setTextEditMode(false);
      // No style context passed here: the style-defaults effect below fires
      // right after `activeTool` changes and pushes the current picker values
      // onto the tool via `setToolDefaults` — the mechanism that actually
      // affects what gets created (see the effect's comment).
      provides.setActiveTool(toolId);
    },
    [annotation.provides],
  );

  const enterRedactMode = useCallback(() => {
    annotation.provides?.setActiveTool(null);
    setTextEditMode(false);
    setRedactMode(true);
  }, [annotation.provides]);

  const enterTextEditMode = useCallback(() => {
    annotation.provides?.setActiveTool(null);
    setRedactMode(false);
    setTextEditNotice(null);
    setTextEditMode(true);
  }, [annotation.provides]);

  // Same "no render-refresh API" gap `applyRedactions` documents below --
  // `textEdit.replace` mutates PDFium's live state directly, with nothing to
  // tell the render plugin to re-fetch this page's bitmap. Re-opening the
  // just-exported bytes under a fresh `documentId` is the same proven
  // fallback `PageOrganizer.handleApply` and `applyRedactions` both use.
  const handleTextReplaced = useCallback(
    async (usedFallbackFont: boolean) => {
      setTextEditNotice(
        usedFallbackFont
          ? "Font substituted. The original font didn't include every new character."
          : null,
      );
      const provides = documentManager.provides;
      if (!exportProvides || !provides) return;
      const bytes = await exportProvides.saveAsCopy().toPromise();
      await provides.closeDocument(documentId).toPromise();
      const { task } = await provides
        .openDocumentBuffer({ buffer: bytes, name: fileName })
        .toPromise();
      await task.toPromise();
      // Stays in Edit text mode (per the brief) -- the new document mounts
      // under a fresh `documentId`, so `Editor` itself remounts with it and
      // `textEditMode` naturally carries over as this component's own state.
    },
    [documentManager.provides, exportProvides, documentId, fileName],
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
    const patch = buildToolContext(
      activeTool,
      colorForTool(toolColors, activeTool),
      strokeWidth,
      fontSize,
    );
    if (patch) provides.setToolDefaults(activeTool, patch);
  }, [
    activeTool,
    toolColors,
    strokeWidth,
    fontSize,
    annotationCapability.provides,
  ]);

  // Owner-reported fix, 2026-09-27 -- stamp/signature placement stayed the
  // active tool after committing (its tool config has no
  // `selectAfterCreate`/`deactivateToolAfterCreate`, unlike FreeText's),
  // so the newly placed image could only be dragged after a SEPARATE,
  // manual switch to the Select tool. Listening for the plugin's own
  // "create" event (`AnnotationCapability.onAnnotationEvent`, emitted from
  // `createAnnotation` in the plugin's dist source) and reacting to a STAMP
  // annotation the same way FreeText's own `selectAfterCreate` behavior
  // does -- leave placement mode and select the new annotation -- means a
  // freshly placed stamp is immediately draggable/resizable, no extra click
  // needed. Registered on the STABLE `annotationCapability.provides`, never
  // the per-render `annotation.provides`.
  useEffect(() => {
    const provides = annotationCapability.provides;
    if (!provides) return;
    return provides.onAnnotationEvent((event) => {
      if (
        event.type === "create" &&
        event.documentId === documentId &&
        event.annotation.type === PdfAnnotationSubtype.STAMP
      ) {
        provides.setActiveTool(null);
        provides.selectAnnotation(event.pageIndex, event.annotation.id);
      }
    });
  }, [annotationCapability.provides, documentId]);

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
      // Owner-reported fix, 2026-09-27 -- "Insert image" always inserted the
      // SIGNATURE, whatever image was picked. Cause, confirmed in
      // `@embedpdf/plugin-annotation/dist/index.js`: `AnnotationPlugin
      // .setActiveTool` no-ops (`if (toolId === docState.activeToolId &&
      // !context) return;`) when "stamp" is ALREADY the active tool -- which
      // it is right after placing a signature, since the stamp tool has no
      // `deactivateToolAfterCreate`. The stamp pointer handler's own
      // `imageFetchCache` (keyed by `imageSrc`) is only populated in
      // `onHandlerActiveStart`, which fires on tool ACTIVATION, not on a
      // `setToolDefaults` call -- so with `setActiveTool` a no-op, that
      // handler's closure-held `cachedBuffer` kept the PREVIOUS image
      // forever, and every later placement reused it regardless of the new
      // `imageSrc`. Deactivating first forces `onHandlerActiveStart` (and
      // therefore a fresh fetch of the new `imageSrc`) to run every time,
      // whether or not "stamp" was already active.
      annotation.provides?.setActiveTool(null);
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

  // E6a -- the full shortcut table (`src/lib/editor/shortcuts.ts`) replaces
  // this effect's old hand-rolled undo/redo-only handler. `matchShortcut` is
  // pure (key in, action out); everything DOM/plugin-specific -- reading
  // `e.target`, dispatching to a capability -- stays here.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // A FreeText annotation opens its own contenteditable region on create
      // (`editAfterCreate`, above). While that's focused (or any other text
      // input/textarea/contenteditable is), every shortcut here must stay
      // native browser behavior (e.g. Ctrl+Z reverting typed characters, not
      // our history plugin's document-level undo) -- otherwise typing "abc"
      // then Ctrl+Z would silently delete the whole annotation instead of the
      // "c", and letter shortcuts like "h" would hijack normal typing.
      if (isTypingTarget(e.target)) return;

      // Owner-reported fix, 2026-09-27 -- arrow-key nudge of a selected
      // annotation. Takes priority over `matchShortcut`'s own arrow-key
      // bindings (prev/next page) whenever something is selected, the same
      // way a real editor's canvas shortcuts win over document navigation
      // while an object is selected. `AnnotationCapability.moveAnnotation`
      // (unscoped -- cited in `EMBEDPDF_NOTES.md`'s API notes) is the same
      // update/move API `applyStyleChange` uses for style edits.
      const selected = annotationCapability.provides?.getSelectedAnnotation();
      if (selected) {
        const delta = arrowKeyNudge(e.key, e.shiftKey);
        if (delta) {
          e.preventDefault();
          annotationCapability.provides?.moveAnnotation(
            selected.object.pageIndex,
            selected.object.id,
            delta,
            "delta",
          );
          return;
        }
      }

      const action = matchShortcut(e);
      if (!action) return;

      switch (action.kind) {
        case "search":
          e.preventDefault();
          setSearchOpen(true);
          break;
        case "undo":
          e.preventDefault();
          handleUndo();
          break;
        case "redo":
          e.preventDefault();
          handleRedo();
          break;
        case "copy":
          // No preventDefault: letting the browser's own copy proceed too is
          // harmless (there's no separate text selection outside the PDF
          // viewer to conflict with), and this keeps native copy working
          // anywhere else on the page this handler doesn't otherwise reach.
          selection.provides?.copyToClipboard(documentId);
          break;
        case "zoomIn":
          e.preventDefault();
          zoom.provides?.zoomIn();
          break;
        case "zoomOut":
          e.preventDefault();
          zoom.provides?.zoomOut();
          break;
        case "zoomReset":
          e.preventDefault();
          zoom.provides?.requestZoom(ZoomMode.FitWidth);
          break;
        case "nextPage":
          e.preventDefault();
          scroll.provides?.scrollToNextPage();
          break;
        case "previousPage":
          e.preventDefault();
          scroll.provides?.scrollToPreviousPage();
          break;
        case "escape":
          e.preventDefault();
          if (searchOpen) setSearchOpen(false);
          else applyActiveTool(null);
          break;
        case "activateTool":
          e.preventDefault();
          applyActiveTool(action.toolId === "select" ? null : action.toolId);
          break;
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    handleUndo,
    handleRedo,
    selection.provides,
    documentId,
    zoom.provides,
    scroll.provides,
    searchOpen,
    applyActiveTool,
    annotationCapability.provides,
  ]);

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
      // Sanitize runs AFTER flatten: flatten only touches form fields/
      // appearances, sanitize only touches metadata/JS/attachments — the two
      // never fight over the same bytes, but running sanitize last means its
      // output (what actually gets downloaded) is never re-processed by
      // flatten afterward.
      if (sanitizeExport) {
        bytes = await sanitizeExportedPdf(bytes);
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
  }, [exportProvides, fileName, flattenForms, sanitizeExport]);

  // E6b — print. Renders every page to a PNG through the SAME PDFium worker
  // as every other engine call (invariant 2), then places them as plain
  // `<img>`s in a print-only container revealed by `@media print` (see
  // globals.css) and calls `window.print()`. No iframe (CSP `frame-src`
  // would block it anyway) and no new window -- both would need to load a
  // second document, and this one never leaves the page. The pages are
  // rendered off a throwaway document opened from the SAME exported bytes
  // `handleExport` produces (`engine.openDocumentBuffer`, the bare
  // `PdfEngine` call, not the DocumentManager plugin capability that would
  // replace the on-screen document) -- so the printed pages reflect the
  // current annotations, never the visible document's live PDFium state.
  const [printStatus, setPrintStatus] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [printError, setPrintError] = useState<string | null>(null);
  const handlePrint = useCallback(async () => {
    if (!engine || !exportProvides) return;
    setPrintError(null);
    try {
      const bytes = await exportProvides.saveAsCopy().toPromise();
      const tempDoc: PdfDocumentObject = await engine
        .openDocumentBuffer({ id: `print-${fileName}`, content: bytes })
        .toPromise();
      const total = tempDoc.pages.length;
      if (total > MAX_PRINT_PAGES) {
        setPrintError(
          `This document has ${total} pages. Printing is limited to ${MAX_PRINT_PAGES} pages at a time.`,
        );
        await engine.closeDocument(tempDoc).toPromise();
        return;
      }
      setPrintStatus({ done: 0, total });
      const DPI_SCALE = 150 / 72;
      const urls: string[] = [];
      for (const page of tempDoc.pages) {
        const blob = await engine
          .renderPage(tempDoc, page, {
            scaleFactor: DPI_SCALE,
            imageType: "image/png",
          })
          .toPromise();
        urls.push(URL.createObjectURL(blob));
        setPrintStatus({ done: urls.length, total });
      }
      await engine.closeDocument(tempDoc).toPromise();

      const container = document.createElement("div");
      container.id = "pdf-editor-print-sheets";
      for (const url of urls) {
        const img = document.createElement("img");
        img.src = url;
        container.appendChild(img);
      }
      document.body.appendChild(container);
      const cleanup = () => {
        container.remove();
        for (const url of urls) URL.revokeObjectURL(url);
        window.removeEventListener("afterprint", cleanup);
      };
      window.addEventListener("afterprint", cleanup);
      window.print();
    } catch {
      setPrintError("Couldn't prepare the document for printing.");
    } finally {
      setPrintStatus(null);
    }
  }, [engine, exportProvides, fileName]);

  // E6b — opt-in local draft autosave, OFF by default (sensitive PDFs must
  // never be written to disk unless the user asks). The switch's on/off
  // state is remembered in localStorage (`readDraftEnabledPref`); the draft
  // content itself lives only in IndexedDB (`draft-store.ts`) and is deleted
  // the moment the switch is turned off.
  const [keepDraft, setKeepDraftState] = useState(readDraftEnabledPref);
  const dirtyRef = useRef(false);
  useEffect(() => {
    const provides = history.provides;
    if (!provides) return;
    return provides.onHistoryChange(() => {
      dirtyRef.current = true;
    });
  }, [history.provides]);
  useEffect(() => {
    if (!keepDraft || !exportProvides) return;
    const id = setInterval(async () => {
      if (!dirtyRef.current) return;
      dirtyRef.current = false;
      try {
        const bytes = await exportProvides.saveAsCopy().toPromise();
        await saveDraft({ name: fileName, bytes, savedAt: Date.now() });
      } catch {
        // Best-effort autosave -- a failed save just tries again in 30s.
      }
    }, 30_000);
    return () => clearInterval(id);
  }, [keepDraft, exportProvides, fileName]);
  const setKeepDraft = useCallback((enabled: boolean) => {
    setKeepDraftState(enabled);
    writeDraftEnabledPref(enabled);
    if (!enabled) deleteDraft();
  }, []);

  // Owner-reported fix, 2026-09-27 -- "Close" toolbar action, so the user can
  // close the open PDF and open another without reloading the page. Confirms
  // first if there are unsaved changes (the history plugin's own undo stack
  // -- the same signal `handleUndo`'s disabled state already reads), then
  // closes the document the same way `PageOrganizer.handleApply` does
  // (`DocumentManagerCapability.closeDocument`, cited in that file) and hands
  // control back to `PdfEditorApp` via `onClosed` so it can return to the
  // drop zone.
  const handleClose = useCallback(async () => {
    const dirty = history.provides?.canUndo() ?? false;
    if (
      dirty &&
      !window.confirm(
        "You have unsaved changes. Close this PDF without exporting?",
      )
    ) {
      return;
    }
    await documentManager.provides?.closeDocument(documentId).toPromise();
    onClosed();
  }, [history.provides, documentManager.provides, documentId, onClosed]);

  // E6b — pinch-to-zoom (touch). Two active pointers on the viewport → the
  // ratio of their current span to the span at the previous move event drives
  // `zoom.provides.requestZoomBy` (`@embedpdf/plugin-zoom`'s
  // `ZoomScope.requestZoomBy(delta, center?)`, `dist/lib/types.d.ts`). A
  // single pointer is left completely alone -- `touch-action: pan-x pan-y`
  // on the viewport (below) hands one-finger scroll straight to the browser,
  // same as before this feature existed.
  const activePointers = useRef(new Map<number, { x: number; y: number }>());
  const lastPinchDistance = useRef<number | null>(null);
  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "touch") return;
    activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (activePointers.current.size !== 2) lastPinchDistance.current = null;
  }, []);
  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.pointerType !== "touch" || !activePointers.current.has(e.pointerId))
        return;
      activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (activePointers.current.size !== 2 || !zoom.provides) return;
      const [a, b] = [...activePointers.current.values()];
      if (!a || !b) return;
      const distance = pointerDistance(a, b);
      const previous = lastPinchDistance.current;
      if (previous !== null && previous > 0) {
        const delta = pinchRatioToZoomDelta(distance / previous);
        if (delta !== 0) zoom.provides.requestZoomBy(delta);
      }
      lastPinchDistance.current = distance;
    },
    [zoom.provides],
  );
  const onPointerEnd = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    activePointers.current.delete(e.pointerId);
    if (activePointers.current.size !== 2) lastPinchDistance.current = null;
  }, []);

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
            toolActive={activeTool !== null || redactMode || textEditMode}
            onWidgetsLoaded={handleWidgetsLoaded}
          />
          <RedactionLayer
            documentId={documentId}
            pageIndex={layout.pageIndex}
            active={redactMode}
            marks={marks[layout.pageIndex] ?? []}
            onAddMark={addMark}
            onRemoveMark={removeMark}
          />
          <SearchHighlightLayer
            documentId={documentId}
            pageIndex={layout.pageIndex}
            results={searchResults}
            currentIndex={searchCurrentIndex}
          />
          <TextEditLayer
            documentId={documentId}
            pageIndex={layout.pageIndex}
            active={textEditMode}
            textEdit={textEdit}
            onReplaced={handleTextReplaced}
          />
        </PagePointerProvider>
      </div>
    ),
    [
      documentId,
      activeTool,
      redactMode,
      textEditMode,
      marks,
      handleWidgetsLoaded,
      addMark,
      removeMark,
      searchResults,
      searchCurrentIndex,
      textEdit,
      handleTextReplaced,
    ],
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
          variant="outline"
          size="icon"
          aria-label="Select"
          aria-pressed={activeTool === null}
          onClick={() => applyActiveTool(null)}
          className={TOOL_BUTTON_CLASS(activeTool === null)}
        >
          <MousePointer2 aria-hidden="true" />
        </Button>
        {ANNOTATION_TOOLS.map((t) => (
          <Button
            key={t.id}
            type="button"
            variant="outline"
            size="icon"
            aria-label={t.label}
            aria-pressed={activeTool === t.id}
            onClick={() => applyActiveTool(t.id)}
            className={TOOL_BUTTON_CLASS(activeTool === t.id)}
          >
            <t.icon aria-hidden="true" />
          </Button>
        ))}

        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Redact"
          aria-pressed={redactMode}
          onClick={enterRedactMode}
          className={TOOL_BUTTON_CLASS(redactMode)}
        >
          <Eraser aria-hidden="true" />
        </Button>

        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Edit text"
          aria-pressed={textEditMode}
          onClick={enterTextEditMode}
          className={TOOL_BUTTON_CLASS(textEditMode)}
        >
          <TextCursorInput aria-hidden="true" />
        </Button>

        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Sign"
          onClick={() => setSignOpen(true)}
          className="rounded-lg"
        >
          <Signature aria-hidden="true" />
        </Button>

        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Organize pages"
          onClick={() => setOrganizerOpen(true)}
          className="rounded-lg"
        >
          <LayoutGrid aria-hidden="true" />
        </Button>

        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Find in document"
          aria-pressed={searchOpen}
          onClick={() => setSearchOpen((open) => !open)}
          className={TOOL_BUTTON_CLASS(searchOpen)}
        >
          <SearchIcon aria-hidden="true" />
        </Button>

        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Keyboard shortcuts"
          onClick={() => setShortcutsOpen(true)}
          className="rounded-lg"
        >
          <Keyboard aria-hidden="true" />
        </Button>

        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Print"
          onClick={handlePrint}
          disabled={printStatus !== null}
          className="rounded-lg"
        >
          <Printer aria-hidden="true" />
        </Button>

        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Close"
          onClick={handleClose}
          className="rounded-lg"
        >
          <X aria-hidden="true" />
        </Button>

        <label className="flex items-center gap-1 text-xs text-ink-muted">
          Color
          <input
            type="color"
            aria-label="Annotation color"
            value={displayColor}
            onChange={(e) => {
              const next = e.target.value;
              if (selectedAnnotation) {
                applyStyleChange(
                  isFreeTextSelected
                    ? { fontColor: next }
                    : { color: next, strokeColor: next },
                );
              }
              if (activeTool) {
                setToolColors((prev) => setToolColor(prev, activeTool, next));
              }
            }}
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
            value={displayStrokeWidth}
            onChange={(e) => {
              const next = Number(e.target.value);
              setStrokeWidth(next);
              if (selectedAnnotation && !isFreeTextSelected) {
                applyStyleChange({
                  strokeColor: displayColor,
                  strokeWidth: next,
                });
              }
            }}
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
            value={displayFontSize}
            onChange={(e) => {
              const next = Number(e.target.value);
              setFontSize(next);
              if (selectedAnnotation && isFreeTextSelected) {
                applyStyleChange({ fontSize: next });
              }
            }}
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
            className="rounded-lg"
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
            className="rounded-lg"
          >
            <ZoomIn aria-hidden="true" />
          </Button>
          {hasSelection && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => selection.provides?.copyToClipboard(documentId)}
            >
              Copy
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Undo"
            disabled={!history.provides?.canUndo()}
            onClick={handleUndo}
            className="rounded-lg"
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
            className="rounded-lg"
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
          <label className="flex items-center gap-1 text-xs text-ink-muted">
            <input
              type="checkbox"
              checked={sanitizeExport}
              onChange={(e) => setSanitizeExport(e.target.checked)}
            />
            Remove hidden data
          </label>
          <label className="flex items-center gap-1 text-xs text-ink-muted">
            <input
              type="checkbox"
              checked={keepDraft}
              onChange={(e) => setKeepDraft(e.target.checked)}
            />
            Keep a local draft
          </label>
          <Button type="button" onClick={handleExport} disabled={exporting}>
            {exporting ? "Exporting…" : "Export PDF"}
          </Button>
        </div>
      </div>

      <SearchBar
        documentId={documentId}
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onResultsChange={handleSearchResultsChange}
      />

      <KeyboardShortcutsPopover
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
      />

      {printStatus && (
        <p role="status" aria-live="polite" className="text-sm text-ink-muted">
          Preparing {printStatus.done}/{printStatus.total} pages…
        </p>
      )}
      {printError && <p className="text-sm text-danger">{printError}</p>}

      {redactMode && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface p-2">
          <label className="flex items-center gap-1 text-xs text-ink-muted">
            Find &amp; mark
            <input
              type="text"
              aria-label="Text to find and mark for redaction"
              value={findText}
              onChange={(e) => setFindText(e.target.value)}
              className="w-40 rounded border border-border bg-canvas px-1 py-0.5 text-ink"
            />
          </label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleFindAndMark}
            disabled={finding || findText.trim() === ""}
          >
            {finding ? "Searching…" : "Find & mark"}
          </Button>
          <span className="text-xs text-ink-muted">
            {markCount} area{markCount === 1 ? "" : "s"} marked
          </span>
          <Button
            type="button"
            size="sm"
            className="ml-auto"
            disabled={markCount === 0}
            onClick={() => setConfirmOpen(true)}
          >
            Apply redactions
          </Button>
        </div>
      )}

      {textEditMode && textEditNotice && (
        <p role="status" className="text-xs text-ink-muted">
          {textEditNotice}
        </p>
      )}

      <ApplyRedactionsDialog
        open={confirmOpen}
        markCount={markCount}
        flattenToImages={flattenRedactedToImages}
        onFlattenToImagesChange={setFlattenRedactedToImages}
        applying={applyingRedactions}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={applyRedactions}
      />

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

      <PageOrganizer
        open={organizerOpen}
        onClose={() => setOrganizerOpen(false)}
        documentId={documentId}
        pageCount={pageCount}
        fileName={fileName}
      />

      <div className="flex gap-3">
        <div className="hidden w-32 shrink-0 sm:block">
          <ThumbnailsPane
            documentId={documentId}
            style={{ height: 480 }}
            className={`rounded-md border border-border ${EDITOR_CANVAS_BG}`}
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
          className={`flex-1 overflow-auto rounded-md border border-border ${EDITOR_CANVAS_BG}`}
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
          // `touch-action: pan-x pan-y` (E6b) hands single-finger drag
          // straight to the browser's native scroll -- `onPointerDown`/
          // `onPointerMove` below only ever act once a SECOND touch pointer
          // joins (pinch), so one-finger scroll behaves exactly as it did
          // before this feature existed.
          style={{ height: 480, touchAction: "pan-x pan-y" }}
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onPointerLeave={onPointerEnd}
        >
          <GlobalPointerProvider documentId={documentId}>
            <Scroller documentId={documentId} renderPage={renderPage} />
          </GlobalPointerProvider>
        </Viewport>
      </div>
    </div>
  );
}

interface KeyboardShortcutsPopoverProps {
  open: boolean;
  onClose: () => void;
}

/** Lists every entry in `SHORTCUTS` (`src/lib/editor/shortcuts.ts`) — the
 * exact same table the keydown handler above dispatches from, so this popover
 * can never drift out of sync with what's actually wired up. Same native
 * `<dialog>` choice as `ApplyRedactionsDialog`/`SignatureDialog`. */
function KeyboardShortcutsPopover({
  open,
  onClose,
}: KeyboardShortcutsPopoverProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-label="Keyboard shortcuts"
      className="fixed inset-0 m-auto h-fit w-fit rounded-2xl border border-border bg-surface p-4 text-ink shadow-lg backdrop:bg-ink/40"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="flex max-w-sm flex-col gap-3">
        <p className="text-sm font-medium">Keyboard shortcuts</p>
        <ul className="flex flex-col gap-1 text-sm text-ink-muted">
          {SHORTCUTS.map((s) => (
            <li
              key={s.label}
              className="flex items-center justify-between gap-4"
            >
              <span>{s.label}</span>
              <kbd className="rounded border border-border bg-canvas px-1.5 py-0.5 font-mono text-xs">
                {s.keys}
              </kbd>
            </li>
          ))}
        </ul>
        <div className="flex justify-end">
          <Button type="button" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </dialog>
  );
}

interface ApplyRedactionsDialogProps {
  open: boolean;
  markCount: number;
  flattenToImages: boolean;
  onFlattenToImagesChange: (value: boolean) => void;
  applying: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/** Confirms the permanent, undo-proof "Apply redactions" action -- a native
 * `<dialog>`, same choice as `SignatureDialog` (no dialog primitive exists
 * yet under `src/components/ui/`). */
function ApplyRedactionsDialog({
  open,
  markCount,
  flattenToImages,
  onFlattenToImagesChange,
  applying,
  onCancel,
  onConfirm,
}: ApplyRedactionsDialogProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="fixed inset-0 m-auto h-fit w-fit rounded-2xl border border-border bg-surface p-4 text-ink shadow-lg backdrop:bg-ink/40"
      onCancel={(e) => {
        e.preventDefault();
        if (!applying) onCancel();
      }}
    >
      <div className="flex max-w-sm flex-col gap-3">
        <p className="text-sm font-medium">
          Apply {markCount} redaction{markCount === 1 ? "" : "s"}?
        </p>
        <p className="text-sm text-ink-muted">
          This permanently removes the marked content. It can&apos;t be undone.
        </p>
        <label className="flex items-start gap-2 text-sm text-ink-muted">
          <input
            type="checkbox"
            checked={flattenToImages}
            onChange={(e) => onFlattenToImagesChange(e.target.checked)}
          />
          Also flatten redacted pages to images (removes hidden images and
          graphics under the boxes; text on those pages is no longer selectable)
        </label>
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={applying}
          >
            Cancel
          </Button>
          <Button type="button" onClick={onConfirm} disabled={applying}>
            {applying ? "Applying…" : "Apply redactions"}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
