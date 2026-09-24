"use client";

import { UploadIcon } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { FORMATS, type FormatId } from "@/lib/registry";
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
        <span className="text-sm text-ink">
          Drag files here, click to browse, or paste
        </span>
        <span id={describedById} className="text-xs text-ink-muted">
          Accepted: {acceptedFormatsLabel(accepts)}
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        accept={acceptAttr(accepts)}
        multiple={multiple}
        disabled={disabled}
        onChange={(e) => {
          if (e.target.files) handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <p className="text-xs text-ink-muted">Files stay on your device.</p>
    </div>
  );
}
