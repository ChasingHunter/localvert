"use client";

import { UploadIcon } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { FORMATS, type FormatId } from "@/lib/registry/formats";
import { cn } from "@/lib/utils";
import {
  type AcceptedFile,
  classifyFiles,
  type RejectedFile,
} from "./dropzone-logic";

interface DropzoneProps {
  accepts: readonly FormatId[];
  multiple?: boolean;
  disabled?: boolean;
  onFiles: (accepted: AcceptedFile[], rejected: RejectedFile[]) => void;
  /**
   * Overrides the visible instruction line. Defaults to the tool-page
   * copy — the home hero (`Converter`, ADR-0016) passes its own calmer
   * sentence ("Or drop a file here and we'll work out what it is.") without
   * changing anything else about this component.
   */
  promptText?: string;
  /**
   * Shows a "Choose files" pill next to the prompt (ADR-0016's home
   * wireframe). Purely decorative (`aria-hidden`) — the whole area is
   * already the one accessible control that opens the file browser (Enter
   * or Space per ADR-0015's keyboard contract), so this never introduces a
   * second, nested interactive element.
   */
  showChooseFilesBadge?: boolean;
  /**
   * Hides the fixed "Files stay on your device." line below the drop area.
   * The home hero (ADR-0016) already states this, in full, right below the
   * drop area ("Your files stay on this device. Nothing is uploaded."), so
   * repeating the shorter version immediately above it would just be the
   * same fact twice in one screenful. Every other caller keeps it — it's
   * the only privacy statement on a category or tool page.
   */
  hideFooterNote?: boolean;
}

/** Builds an `<input accept>` value from every accepted format's ext + mime. */
function acceptAttr(accepts: readonly FormatId[]): string {
  const parts = accepts.flatMap((id) => {
    const spec = FORMATS[id];
    return [...spec.ext.map((ext) => `.${ext}`), spec.mime];
  });
  return Array.from(new Set(parts)).join(",");
}

function acceptedFormatsLabel(accepts: readonly FormatId[]): string {
  return accepts.map((id) => FORMATS[id].label).join(", ");
}

/**
 * The file intake surface: drag-drop, click-to-browse, and paste, all
 * routed through the same `classifyFiles` — content decides accepted vs.
 * rejected, never the file's name. Sniffing a file's first 32 bytes on the
 * main thread is fine (invariant 2 only bars decode/encode/zip); everything
 * past classification belongs to the caller via `onFiles`.
 */
export function Dropzone({
  accepts,
  multiple = false,
  disabled = false,
  onFiles,
  promptText = "Drag files here, click to browse, or paste",
  showChooseFilesBadge = false,
  hideFooterNote = false,
}: DropzoneProps) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const describedById = useId();

  const handleFiles = useCallback(
    (fileList: FileList | readonly File[]) => {
      const files = Array.from(fileList);
      if (files.length === 0) return;
      const batch = multiple ? files : files.slice(0, 1);
      classifyFiles(batch, accepts).then(({ accepted, rejected }) =>
        onFiles(accepted, rejected),
      );
    },
    [accepts, multiple, onFiles],
  );

  useEffect(() => {
    if (disabled) return;
    function onPaste(e: ClipboardEvent) {
      const files = e.clipboardData?.files;
      if (files && files.length > 0) {
        handleFiles(files);
      }
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [disabled, handleFiles]);

  const openPicker = () => {
    if (!disabled) inputRef.current?.click();
  };

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        disabled={disabled}
        aria-describedby={describedById}
        onClick={openPicker}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (!disabled) handleFiles(e.dataTransfer.files);
        }}
        className={cn(
          "flex w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border bg-surface px-6 py-10 text-center outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed disabled:opacity-50",
          dragOver && "border-accent bg-canvas",
        )}
      >
        <UploadIcon className="size-6 text-ink-muted" aria-hidden="true" />
        <span className="flex flex-wrap items-center justify-center gap-2 text-sm text-ink">
          {promptText}
          {showChooseFilesBadge && (
            <span
              aria-hidden="true"
              className="inline-flex min-h-8 items-center rounded-full bg-accent px-3 py-1 text-xs font-medium text-canvas"
            >
              Choose files
            </span>
          )}
        </span>
        <span id={describedById} className="text-xs text-ink-muted">
          Accepted: {acceptedFormatsLabel(accepts)}
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        aria-label="Choose files"
        className="sr-only"
        accept={acceptAttr(accepts)}
        multiple={multiple}
        disabled={disabled}
        onChange={(e) => {
          if (e.target.files) handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
      {!hideFooterNote && (
        <p className="text-xs text-ink-muted">Files stay on your device.</p>
      )}
    </div>
  );
}
