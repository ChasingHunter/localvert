"use client";

import { useDocumentState, useRegistry } from "@embedpdf/core/react";
import { MatchFlag, type PdfEngine, type SearchResult } from "@embedpdf/models";
import { useScroll } from "@embedpdf/plugin-scroll/react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { rectToCssBox } from "./form-layer";

/**
 * Slice E6a — search. Runs `engine.searchAllPages` (the same bare `PdfEngine`
 * call redaction's "Find & mark" already uses — see `pdf-editor-app.tsx`'s
 * `handleFindAndMark` — confirmed forwarded by `pdfium.worker.ts`'s generic
 * `EngineRunner`, unlike `searchInPage` which is NOT forwarded) against the
 * whole document, debounced while the user types. Every hit renders as a
 * translucent box on its page (`SearchHighlightLayer`, rendered by
 * `pdf-editor-app.tsx`'s `renderPage` alongside the other per-page layers);
 * the current hit gets an orange box and its page is scrolled into view via
 * `@embedpdf/plugin-scroll`'s `ScrollScope.scrollToPage` (`pageNumber` is
 * 1-based; `SearchResult.pageIndex` is 0-based, so the two conversions in
 * this file — `+ 1` here, `- 1` in `SearchHighlightLayer` — are deliberate,
 * not a bug).
 */

const DEBOUNCE_MS = 250;

interface SearchBarProps {
  documentId: string;
  open: boolean;
  onClose: () => void;
  /** Reports every current hit up to `Editor`, keyed by page index, so
   * `renderPage` can hand each page's own subset to
   * `SearchHighlightLayer` without every page re-running the search itself. */
  onResultsChange: (results: SearchResult[], currentIndex: number) => void;
}

/** Runs one `searchAllPages` call and returns its `results`, or `[]` for an
 * empty/whitespace-only keyword (matching `pdf-editor-app.tsx`'s existing
 * `handleFindAndMark` guard) or if the call is superseded by a newer one.
 * Exported so `pdf-editor-app.tsx`'s "Find & mark" could be pointed at this
 * same helper in a later slice instead of duplicating the call — out of
 * scope for this one, which only wires up the new search bar. */
export async function runSearchAllPages(
  engine: PdfEngine,
  doc: Parameters<PdfEngine["searchAllPages"]>[0],
  keyword: string,
  options: { matchCase: boolean; wholeWord: boolean },
): Promise<SearchResult[]> {
  if (keyword.trim() === "") return [];
  const flags: MatchFlag[] = [];
  if (options.matchCase) flags.push(MatchFlag.MatchCase);
  if (options.wholeWord) flags.push(MatchFlag.MatchWholeWord);
  const { results } = await engine
    .searchAllPages(doc, keyword, flags.length > 0 ? { flags } : undefined)
    .toPromise();
  return results;
}

export function SearchBar({
  documentId,
  open,
  onClose,
  onResultsChange,
}: SearchBarProps) {
  const { registry } = useRegistry();
  const engine = registry?.getEngine() ?? null;
  const documentState = useDocumentState(documentId);
  const doc = documentState?.document ?? null;
  const scroll = useScroll(documentId);

  const [keyword, setKeyword] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const scrollToHit = useCallback(
    (hit: SearchResult | undefined) => {
      if (!hit) return;
      scroll.provides?.scrollToPage({ pageNumber: hit.pageIndex + 1 });
    },
    [scroll.provides],
  );

  // Debounced search: re-runs `searchAllPages` `DEBOUNCE_MS` after the last
  // keystroke (or option toggle). `requestIdRef` discards a stale response
  // that resolves after a newer request already started — the same
  // last-write-wins guard `form-layer.tsx`'s widget-loading effect uses.
  useEffect(() => {
    if (!open || !engine || !doc) {
      setResults([]);
      setCurrentIndex(0);
      return;
    }
    if (keyword.trim() === "") {
      setResults([]);
      setCurrentIndex(0);
      return;
    }
    const requestId = ++requestIdRef.current;
    setSearching(true);
    const timer = setTimeout(() => {
      runSearchAllPages(engine, doc, keyword, { matchCase, wholeWord })
        .then((newResults) => {
          if (requestIdRef.current !== requestId) return;
          setResults(newResults);
          setCurrentIndex(0);
          setSearching(false);
          scrollToHit(newResults[0]);
        })
        .catch(() => {
          if (requestIdRef.current !== requestId) return;
          setResults([]);
          setCurrentIndex(0);
          setSearching(false);
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [open, engine, doc, keyword, matchCase, wholeWord, scrollToHit]);

  useEffect(() => {
    onResultsChange(results, currentIndex);
  }, [results, currentIndex, onResultsChange]);

  const goTo = useCallback(
    (delta: number) => {
      if (results.length === 0) return;
      const next = (currentIndex + delta + results.length) % results.length;
      setCurrentIndex(next);
      scrollToHit(results[next]);
    },
    [results, currentIndex, scrollToHit],
  );

  const handleClose = useCallback(() => {
    setKeyword("");
    setResults([]);
    setCurrentIndex(0);
    onClose();
  }, [onClose]);

  if (!open) return null;

  return (
    <search
      aria-label="Find in document"
      className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface p-2"
    >
      <Search aria-hidden="true" className="size-4 text-ink-muted" />
      <input
        ref={inputRef}
        type="text"
        aria-label="Search text"
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            goTo(e.shiftKey ? -1 : 1);
          } else if (e.key === "Escape") {
            e.preventDefault();
            handleClose();
          }
        }}
        className="w-48 rounded border border-border bg-canvas px-1 py-0.5 text-ink"
      />
      <span aria-live="polite" className="min-w-16 text-xs text-ink-muted">
        {searching
          ? "Searching…"
          : results.length > 0
            ? `${currentIndex + 1} of ${results.length}`
            : keyword.trim() !== ""
              ? "0 of 0"
              : ""}
      </span>
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label="Previous match"
        disabled={results.length === 0}
        onClick={() => goTo(-1)}
      >
        <ChevronUp aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label="Next match"
        disabled={results.length === 0}
        onClick={() => goTo(1)}
      >
        <ChevronDown aria-hidden="true" />
      </Button>
      <label className="flex items-center gap-1 text-xs text-ink-muted">
        <input
          type="checkbox"
          checked={matchCase}
          onChange={(e) => setMatchCase(e.target.checked)}
        />
        Match case
      </label>
      <label className="flex items-center gap-1 text-xs text-ink-muted">
        <input
          type="checkbox"
          checked={wholeWord}
          onChange={(e) => setWholeWord(e.target.checked)}
        />
        Whole word
      </label>
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label="Close search"
        className="ml-auto"
        onClick={handleClose}
      >
        <X aria-hidden="true" />
      </Button>
    </search>
  );
}

interface SearchHighlightLayerProps {
  documentId: string;
  pageIndex: number;
  results: SearchResult[];
  currentIndex: number;
}

/** Renders every hit on `pageIndex` as a translucent box (orange for the
 * current hit, yellow otherwise) — the same absolutely-positioned overlay
 * pattern as `RedactionLayer`'s marks, using the same `rectToCssBox`
 * (`form-layer.tsx`) to go from a PDF-point `Rect` to a CSS box at the
 * page's current render scale. Purely visual: no pointer handling. */
export function SearchHighlightLayer({
  documentId,
  pageIndex,
  results,
  currentIndex,
}: SearchHighlightLayerProps) {
  const documentState = useDocumentState(documentId);
  const scale = documentState?.scale ?? 1;

  const pageHits = useMemo(
    () =>
      results
        .map((result, index) => ({ result, index }))
        .filter(({ result }) => result.pageIndex === pageIndex),
    [results, pageIndex],
  );

  if (pageHits.length === 0) return null;

  return (
    <div
      data-search-highlight-layer
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
    >
      {pageHits.flatMap(({ result, index }) =>
        result.rects.map((rect, rectIndex) => {
          const box = rectToCssBox(rect, scale);
          const isCurrent = index === currentIndex;
          return (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: hits are recomputed wholesale on every search, never reordered in place — the pair (search-result index, rect index) is a stable enough identity for this render-only overlay.
              key={`${index}-${rectIndex}`}
              data-search-hit
              data-current={isCurrent || undefined}
              style={{
                position: "absolute",
                left: box.left,
                top: box.top,
                width: box.width,
                height: box.height,
                background: isCurrent
                  ? "rgba(249, 115, 22, 0.45)"
                  : "rgba(250, 204, 21, 0.35)",
              }}
            />
          );
        }),
      )}
    </div>
  );
}
