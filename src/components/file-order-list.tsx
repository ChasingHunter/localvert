"use client";

import {
  ChevronDownIcon,
  ChevronUpIcon,
  GripVerticalIcon,
  Trash2Icon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AcceptedFile } from "./dropzone-logic";
import { moveDown, moveUp, removeAt, reorder } from "./file-order-list-logic";

interface FileOrderListProps {
  files: readonly AcceptedFile[];
  onChange: (files: AcceptedFile[]) => void;
}

/** `1536` -> "1.5 KB". Same precision as `job-card.tsx`'s own copy of this —
 * small enough, and different enough in context, not to share. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

/**
 * The ordered file list a `"many-to-one"` tool submits from (ADR-0008, e.g.
 * merge-pdf) — order is part of the result, so every row gets a drag handle
 * and an always-visible keyboard alternative (Up/Down buttons), plus remove.
 *
 * Dragging is pointer events, not native HTML5 drag-and-drop: one code path
 * for mouse and touch, no ghost-image/`dragover` browser chrome to fight.
 * The handle starts a drag (`onPointerDown`); each row reports when the
 * pointer enters it (`onPointerEnter`) while a drag is live, and the list is
 * reordered live via `reorder` (`file-order-list-logic.ts`) — the same
 * "swap as you pass" feel native DnD gives for free. `pointerup`/
 * `pointercancel` are watched on `window` (not just the handle) since the
 * pointer is very likely over a different row, not the handle, by the time
 * it releases.
 */
export function FileOrderList({ files, onChange }: FileOrderListProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  useEffect(() => {
    if (dragIndex === null) return;
    const stop = () => setDragIndex(null);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, [dragIndex]);

  return (
    <ul className="flex flex-col gap-2">
      {files.map((f, index) => (
        <li
          // biome-ignore lint/suspicious/noArrayIndexKey: name+size alone can collide (two copies of the same file); index disambiguates, and this list's own order is exactly what reordering changes.
          key={`${f.file.name}-${f.file.size}-${index}`}
          onPointerEnter={() => {
            if (dragIndex === null || dragIndex === index) return;
            onChange(reorder(files, dragIndex, index));
            setDragIndex(index);
          }}
          className={cn(
            "flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2",
            dragIndex === index && "border-accent",
          )}
        >
          <button
            type="button"
            aria-label={`Drag to reorder ${f.file.name}`}
            className="cursor-grab touch-none text-ink-muted"
            onPointerDown={() => setDragIndex(index)}
          >
            <GripVerticalIcon aria-hidden="true" className="size-4" />
          </button>

          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-medium text-ink">
              {f.file.name}
            </span>
            <span className="text-xs text-ink-muted">
              {formatBytes(f.file.size)}
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Move ${f.file.name} up`}
              disabled={index === 0}
              onClick={() => onChange(moveUp(files, index))}
            >
              <ChevronUpIcon aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Move ${f.file.name} down`}
              disabled={index === files.length - 1}
              onClick={() => onChange(moveDown(files, index))}
            >
              <ChevronDownIcon aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remove ${f.file.name}`}
              onClick={() => onChange(removeAt(files, index))}
            >
              <Trash2Icon aria-hidden="true" />
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
