"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Combobox } from "@/components/combobox";
import { CATEGORY_META } from "@/lib/registry/categories";
import { FORMATS } from "@/lib/registry/formats";
import { buildSearchIndex, searchTools } from "@/lib/search/tool-search";
import { CATALOG } from "@/tools/catalog";

/**
 * The search dialog itself. Loaded only when search is first opened
 * (`header-search.tsx` dynamic-imports it), so the catalog, the format
 * aliases and the combobox never ride on a page's first load. A native
 * modal `<dialog>` gives the focus trap, the inert page behind it and Esc
 * for free; the combobox inside follows the same APG pattern as the From/To
 * pickers. Choosing a result (Enter or click) navigates client-side.
 */
export default function HeaderSearchPanel({
  onClose,
}: {
  onClose: () => void;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState("");
  const [count, setCount] = useState(0);

  const index = useMemo(() => buildSearchIndex(CATALOG, FORMATS), []);
  const results = useMemo(() => searchTools(index, query), [index, query]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const hasQuery = query.trim() !== "";
  const liveMessage = hasQuery
    ? `${count} result${count === 1 ? "" : "s"}`
    : "";

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the backdrop click is a pointer convenience; Esc already closes a modal dialog.
    <dialog
      ref={dialogRef}
      aria-label="Search tools"
      onClose={onClose}
      onClick={(e) => {
        // A click on the backdrop lands on the dialog element itself.
        if (e.target === dialogRef.current) dialogRef.current?.close();
      }}
      className="fixed inset-x-0 top-[12vh] bottom-auto m-auto w-[min(32rem,calc(100vw-2rem))] overflow-visible rounded-xl border border-border bg-surface p-4 text-ink shadow-lg backdrop:bg-ink/40"
    >
      <Combobox
        id="site-search"
        label="Search tools"
        hideLabel
        placeholder="Search tools, formats or actions"
        query={query}
        onQueryChange={setQuery}
        value={null}
        onChange={(slug) => {
          dialogRef.current?.close();
          router.push(`/tools/${slug}`);
        }}
        emptyText={`No tools match "${query.trim()}". Try a format like PDF or JPG.`}
        onResultsCountChange={setCount}
        groups={[
          {
            id: "tools",
            label: "Tools",
            options: results.map((entry) => ({
              id: entry.slug,
              label: entry.title,
              hint: CATEGORY_META[entry.category].label,
            })),
          },
        ]}
      />
      <div role="status" aria-live="polite" className="sr-only">
        {liveMessage}
      </div>
    </dialog>
  );
}
