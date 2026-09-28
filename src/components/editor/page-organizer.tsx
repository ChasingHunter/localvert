"use client";

import { useDocumentManagerCapability } from "@embedpdf/plugin-document-manager/react";
import { useExport } from "@embedpdf/plugin-export/react";
import { ThumbImg } from "@embedpdf/plugin-thumbnail/react";
import {
  FileInput,
  Plus,
  Redo2,
  RotateCcw,
  RotateCw,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  normalizeRotation,
  type PlanRotation,
} from "@/lib/editor/page-organizer-plan";
import { countPdfPages, runPdfLibOp } from "@/lib/editor/run-pdf-lib-op";

/**
 * E3 — the "Organize pages" tool. PDFium (via `@embedpdf/plugin-document-
 * manager`) only forwards delete/import/merge/extract for page structure —
 * no move/rotate-in-place/insert-blank (see the brief this slice was built
 * from). So this edits a PLAN, never the live document, and only turns it
 * into real bytes once, on Apply: `pdf-lib`'s `organize` op
 * (`src/lib/engines/pdf-lib/adapter.ts`) rebuilds a whole new document from
 * the plan in a worker, and this component reopens the result in place of
 * the document it started from. Cancel just discards the plan — the open
 * document is never touched before Apply.
 *
 * A native `<dialog>`, same pattern as `SignatureDialog` (no dialog
 * primitive exists under `src/components/ui/` yet).
 */

/** One tile in the grid. `source: 0` is always the document this organizer
 * was opened on; `source: 1..N` is the (1-based) index into `insertedDocs`
 * below; `source: "blank"` is an invented blank page. Mirrors
 * `OrganizePlanEntry` (`page-organizer-plan.ts`) plus a stable `id` React
 * needs for drag/keyboard reorder and a `label` for the placeholder tiles
 * the brief calls for (inserted-PDF pages and blanks never get a real
 * thumbnail — only the main document's own pages do, via `ThumbImg`). */
interface Tile {
  id: string;
  source: number | "blank";
  page?: number;
  rotate: PlanRotation;
  label?: string;
}

interface InsertedDoc {
  name: string;
  bytes: ArrayBuffer;
  pageCount: number;
}

let nextTileId = 0;
/** A plain incrementing counter, not `crypto.randomUUID()` — this id only
 * ever needs to be unique within one organizer session (a React key + a
 * drag/keyboard target), never persisted or compared across sessions. */
function newTileId(): string {
  nextTileId += 1;
  return `tile-${nextTileId}`;
}

function initialTiles(pageCount: number): Tile[] {
  return Array.from({ length: pageCount }, (_, page) => ({
    id: newTileId(),
    source: 0,
    page,
    rotate: 0 as PlanRotation,
  }));
}

export interface PageOrganizerProps {
  open: boolean;
  onClose: () => void;
  documentId: string;
  pageCount: number;
  fileName: string;
}

export function PageOrganizer({
  open,
  onClose,
  documentId,
  pageCount,
  fileName,
}: PageOrganizerProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const documentManager = useDocumentManagerCapability();
  const { provides: exportProvides } = useExport(documentId);

  const [tiles, setTiles] = useState<Tile[]>(() => initialTiles(pageCount));
  const [insertedDocs, setInsertedDocs] = useState<InsertedDoc[]>([]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const lastClickedRef = useRef<string | null>(null);

  const pastRef = useRef<Tile[][]>([]);
  const futureRef = useRef<Tile[][]>([]);

  const [insertBusy, setInsertBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Reset to a fresh plan every time the organizer is opened on a
  // (possibly new, post-Apply) document — never carry a stale plan from a
  // previous open across an Apply that reopened the document under a new
  // `documentId`.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      setTiles(initialTiles(pageCount));
      setInsertedDocs([]);
      setSelected(new Set());
      pastRef.current = [];
      futureRef.current = [];
      setError(null);
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open, pageCount]);

  const commit = useCallback((next: Tile[] | ((prev: Tile[]) => Tile[])) => {
    setTiles((prev) => {
      const resolved = typeof next === "function" ? next(prev) : next;
      pastRef.current = [...pastRef.current, prev];
      futureRef.current = [];
      return resolved;
    });
  }, []);

  const undo = useCallback(() => {
    setTiles((current) => {
      const previous = pastRef.current.pop();
      if (!previous) return current;
      futureRef.current = [...futureRef.current, current];
      return previous;
    });
  }, []);

  const redo = useCallback(() => {
    setTiles((current) => {
      const next = futureRef.current.pop();
      if (!next) return current;
      pastRef.current = [...pastRef.current, current];
      return next;
    });
  }, []);

  // Local undo/redo, scoped to this dialog only — never the document's own
  // history plugin (that's the toolbar's Undo/Redo, for annotations).
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z" && e.shiftKey) {
        e.preventDefault();
        redo();
      } else if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undo();
      } else if (
        e.altKey &&
        (e.key === "ArrowLeft" || e.key === "ArrowRight")
      ) {
        e.preventDefault();
        const anchor = lastClickedRef.current;
        if (!anchor) return;
        const delta = e.key === "ArrowLeft" ? -1 : 1;
        commit((prev) => {
          const index = prev.findIndex((t) => t.id === anchor);
          const target = index + delta;
          if (index < 0 || target < 0 || target >= prev.length) return prev;
          const next = prev.slice();
          const [moved] = next.splice(index, 1);
          if (!moved) return prev;
          next.splice(target, 0, moved);
          return next;
        });
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, undo, redo, commit]);

  const handleTileClick = useCallback(
    (e: React.MouseEvent, id: string) => {
      setSelected((prev) => {
        if (e.shiftKey && lastClickedRef.current) {
          const ids = tiles.map((t) => t.id);
          const from = ids.indexOf(lastClickedRef.current);
          const to = ids.indexOf(id);
          if (from >= 0 && to >= 0) {
            const [lo, hi] = from < to ? [from, to] : [to, from];
            return new Set(ids.slice(lo, hi + 1));
          }
        }
        if (e.ctrlKey || e.metaKey) {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        }
        return new Set([id]);
      });
      lastClickedRef.current = id;
    },
    [tiles],
  );

  const rotateTile = useCallback(
    (id: string, delta: 90 | -90) => {
      commit((prev) =>
        prev.map((t) =>
          t.id === id
            ? {
                ...t,
                rotate: normalizeRotation(t.rotate, delta) as PlanRotation,
              }
            : t,
        ),
      );
    },
    [commit],
  );

  const rotateSelection = useCallback(
    (delta: 90 | -90) => {
      if (selected.size === 0) return;
      commit((prev) =>
        prev.map((t) =>
          selected.has(t.id)
            ? {
                ...t,
                rotate: normalizeRotation(t.rotate, delta) as PlanRotation,
              }
            : t,
        ),
      );
    },
    [commit, selected],
  );

  const deleteTile = useCallback(
    (id: string) => {
      commit((prev) => prev.filter((t) => t.id !== id));
      setSelected((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    },
    [commit],
  );

  const deleteSelection = useCallback(() => {
    if (selected.size === 0) return;
    commit((prev) => prev.filter((t) => !selected.has(t.id)));
    setSelected(new Set());
  }, [commit, selected]);

  const insertBlankAfter = useCallback(
    (id: string) => {
      commit((prev) => {
        const index = prev.findIndex((t) => t.id === id);
        if (index < 0) return prev;
        const next = prev.slice();
        next.splice(index + 1, 0, {
          id: newTileId(),
          source: "blank",
          rotate: 0,
        });
        return next;
      });
    },
    [commit],
  );

  const handleInsertPdf = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      setInsertBusy(true);
      setError(null);
      try {
        const bytes = await file.arrayBuffer();
        const count = await countPdfPages(bytes);
        const sourceIndex = insertedDocs.length + 1;
        setInsertedDocs((prev) => [
          ...prev,
          { name: file.name, bytes, pageCount: count },
        ]);
        commit((prev) => [
          ...prev,
          ...Array.from({ length: count }, (_, page) => ({
            id: newTileId(),
            source: sourceIndex,
            page,
            rotate: 0 as PlanRotation,
            label: file.name,
          })),
        ]);
      } catch {
        setError(`Couldn't read "${file.name}" as a PDF`);
      } finally {
        setInsertBusy(false);
      }
    },
    [commit, insertedDocs.length],
  );

  // Pointer-based drag reorder (never native HTML5 drag — see the
  // `draggable={false}` gotcha already documented on the rendered page
  // `<img>` in `pdf-editor-app.tsx`; this grid has no such image, but the
  // same pointer-events-only approach is used here for consistency and
  // because it plays nicely with the click/shift-click selection above,
  // which a native drag gesture would otherwise swallow).
  const draggingRef = useRef<string | null>(null);
  const onTilePointerDown = useCallback((id: string) => {
    draggingRef.current = id;
  }, []);
  const onTilePointerUp = useCallback(
    (e: React.PointerEvent, targetId: string) => {
      const draggedId = draggingRef.current;
      draggingRef.current = null;
      if (!draggedId || draggedId === targetId) return;
      const dropElement = document
        .elementFromPoint(e.clientX, e.clientY)
        ?.closest("[data-tile-id]");
      const dropId = dropElement?.getAttribute("data-tile-id") ?? targetId;
      commit((prev) => {
        const from = prev.findIndex((t) => t.id === draggedId);
        const to = prev.findIndex((t) => t.id === dropId);
        if (from < 0 || to < 0 || from === to) return prev;
        const next = prev.slice();
        const [moved] = next.splice(from, 1);
        if (!moved) return prev;
        next.splice(to, 0, moved);
        return next;
      });
    },
    [commit],
  );

  const handleApply = useCallback(async () => {
    if (!exportProvides || !documentManager.provides) return;
    setApplying(true);
    setError(null);
    try {
      const mainBytes = await exportProvides.saveAsCopy().toPromise();
      const plan = tiles.map((t) =>
        t.source === "blank"
          ? { source: "blank" as const, rotate: t.rotate }
          : { source: t.source, page: t.page, rotate: t.rotate },
      );
      const inputs = [mainBytes, ...insertedDocs.map((d) => d.bytes)];
      const organized = await runPdfLibOp("organize", inputs, { plan });

      await documentManager.provides.closeDocument(documentId).toPromise();
      const { task } = await documentManager.provides
        .openDocumentBuffer({ buffer: organized, name: fileName })
        .toPromise();
      await task.toPromise();
      onClose();
    } catch {
      setError("Couldn't apply the page plan. Nothing has been changed.");
    } finally {
      setApplying(false);
    }
  }, [
    exportProvides,
    documentManager.provides,
    tiles,
    insertedDocs,
    documentId,
    fileName,
    onClose,
  ]);

  const busy = insertBusy || applying;
  // Refs, not state — but every commit/undo/redo already calls `setTiles`,
  // so these lengths are current by the time this render reads them.
  const canUndo = pastRef.current.length > 0;
  const canRedo = futureRef.current.length > 0;

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      aria-labelledby="page-organizer-title"
      className="fixed inset-0 m-auto h-[90vh] w-[95vw] max-w-4xl rounded-2xl border border-border bg-surface p-0 text-ink shadow-lg backdrop:bg-ink/40"
    >
      <div className="flex h-full flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <h2 id="page-organizer-title" className="text-sm font-semibold">
            Organize pages
          </h2>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Close"
            onClick={onClose}
          >
            <X aria-hidden="true" />
          </Button>
        </div>

        <div
          role="toolbar"
          aria-label="Page organizer actions"
          className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-canvas p-2"
        >
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => fileInputRef.current?.click()}
          >
            <FileInput aria-hidden="true" /> Insert PDF…
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={handleInsertPdf}
          />
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            disabled={!canUndo || busy}
            aria-label="Undo"
            onClick={undo}
          >
            <Undo2 aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            disabled={!canRedo || busy}
            aria-label="Redo"
            onClick={redo}
          >
            <Redo2 aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            disabled={selected.size === 0 || busy}
            aria-label="Rotate selection left"
            onClick={() => rotateSelection(-90)}
          >
            <RotateCcw aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            disabled={selected.size === 0 || busy}
            aria-label="Rotate selection right"
            onClick={() => rotateSelection(90)}
          >
            <RotateCw aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={selected.size === 0 || busy}
            onClick={deleteSelection}
          >
            <Trash2 aria-hidden="true" /> Delete selected
          </Button>
          {insertBusy && (
            <span className="text-xs text-ink-muted">Reading PDF…</span>
          )}
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}

        <div
          role="listbox"
          aria-label="Pages"
          aria-multiselectable="true"
          className="grid flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-3 overflow-auto rounded-md border border-border bg-[color-mix(in_oklab,var(--color-canvas),black_5%)] p-3"
        >
          {tiles.map((tile, index) => (
            <div
              key={tile.id}
              data-tile-id={tile.id}
              role="option"
              tabIndex={0}
              aria-selected={selected.has(tile.id)}
              aria-label={
                tile.source === "blank"
                  ? "Blank page"
                  : tile.source === 0
                    ? `Page ${(tile.page ?? 0) + 1}`
                    : `${tile.label ?? "Inserted PDF"}, page ${(tile.page ?? 0) + 1}`
              }
              className={`flex flex-col items-center gap-1 rounded-md border p-1 ${
                selected.has(tile.id)
                  ? "border-primary bg-primary/10"
                  : "border-border"
              }`}
              onClick={(e) => handleTileClick(e, tile.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleTileClick(e as unknown as React.MouseEvent, tile.id);
                }
              }}
              onPointerDown={() => onTilePointerDown(tile.id)}
              onPointerUp={(e) => onTilePointerUp(e, tile.id)}
            >
              <div
                className="flex aspect-[3/4] w-full items-center justify-center overflow-hidden rounded bg-white"
                style={{
                  transform: `rotate(${tile.rotate}deg)`,
                }}
              >
                {tile.source === 0 ? (
                  <ThumbImg
                    documentId={documentId}
                    meta={{
                      pageIndex: tile.page ?? 0,
                      width: 90,
                      height: 120,
                      wrapperHeight: 120,
                      top: 0,
                      labelHeight: 0,
                    }}
                    style={{ width: 90, height: 120 }}
                  />
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-1 p-1 text-center text-[10px] text-ink-muted">
                    <span className="line-clamp-2 break-all">
                      {tile.source === "blank"
                        ? "Blank"
                        : (tile.label ?? "Inserted PDF")}
                    </span>
                    {tile.source !== "blank" && (
                      <span>page {(tile.page ?? 0) + 1}</span>
                    )}
                  </div>
                )}
              </div>
              <span className="text-xs text-ink-muted">
                {tile.source === "blank" ? "—" : (tile.page ?? 0) + 1}
              </span>
              <div className="grid grid-cols-2 gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Rotate page ${index + 1} left`}
                  disabled={busy}
                  onClick={(e) => {
                    e.stopPropagation();
                    rotateTile(tile.id, -90);
                  }}
                >
                  <RotateCcw aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Rotate page ${index + 1} right`}
                  disabled={busy}
                  onClick={(e) => {
                    e.stopPropagation();
                    rotateTile(tile.id, 90);
                  }}
                >
                  <RotateCw aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Insert blank page after page ${index + 1}`}
                  disabled={busy}
                  onClick={(e) => {
                    e.stopPropagation();
                    insertBlankAfter(tile.id);
                  }}
                >
                  <Plus aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Delete page ${index + 1}`}
                  disabled={busy}
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteTile(tile.id);
                  }}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </div>
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={applying}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleApply}
            disabled={applying || insertBusy || tiles.length === 0}
          >
            {applying ? "Applying…" : "Apply"}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
