"use client";

import {
  type ChangeEvent,
  type KeyboardEvent,
  type PointerEvent,
  type SyntheticEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  type AspectRatio,
  applyAspectRatio,
  clampRect,
  displayToSource,
  type Handle,
  initialCrop,
  moveRect,
  type Rect,
  resizeRect,
  roundRect,
  type Size,
  sourceToDisplay,
} from "./crop-geometry";

const ASPECT_PRESETS: { label: string; value: AspectRatio }[] = [
  { label: "Free", value: null },
  { label: "1:1", value: 1 },
  { label: "4:3", value: 4 / 3 },
  { label: "16:9", value: 16 / 9 },
  { label: "3:2", value: 3 / 2 },
];

const HANDLES: { id: Handle; label: string }[] = [
  { id: "nw", label: "top-left" },
  { id: "ne", label: "top-right" },
  { id: "sw", label: "bottom-left" },
  { id: "se", label: "bottom-right" },
];

interface CropEditorProps {
  file: File;
  onSubmit: (crop: Rect) => void;
  onCancel: () => void;
  submitLabel?: string;
}

/** In-progress pointer drag — captured at pointerdown, read on every move. */
interface DragState {
  kind: "move" | Handle;
  startX: number;
  startY: number;
  /** The crop rect (display pixels) at the moment the drag started. */
  startRect: Rect;
}

/**
 * The interactive crop region for a single dropped image. Owns nothing
 * about jobs or the job engine — it only ever hands `onSubmit` a crop
 * rectangle in SOURCE pixel coordinates (the image's own `naturalWidth`/
 * `naturalHeight`, clamped and rounded to ints, matching `cropField` in
 * `src/tools/_shared-options.ts` and the `canvas` engine's `runCrop`).
 *
 * The `<img>` decodes `file` off the main thread (invariant 2) — this
 * component only ever reads the decoded bitmap's *dimensions*
 * (`naturalWidth`/`naturalHeight`), never its pixels.
 *
 * The single source of truth is `cropSource` (natural-pixel space), so a
 * window resize that changes the displayed image size never has to rescale
 * stored state — only the on-screen overlay (`cropDisplay`, derived via
 * `sourceToDisplay`) needs to know about `displaySize`.
 */
export function CropEditor({
  file,
  onSubmit,
  onCancel,
  submitLabel = "Crop",
}: CropEditorProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [naturalSize, setNaturalSize] = useState<Size | null>(null);
  const [displaySize, setDisplaySize] = useState<Size | null>(null);
  const [cropSource, setCropSource] = useState<Rect | null>(null);
  const [aspect, setAspect] = useState<AspectRatio>(null);

  // A callback ref (not `useRef` + a effect keyed on some proxy for "the img
  // just mounted") because the <img> only exists in the DOM once `objectUrl`
  // is set — a plain ref effect with `[]` deps would run before that and
  // never see it. This re-runs exactly when the element itself appears,
  // changes, or disappears.
  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null);
  const dragRef = useRef<DragState | null>(null);

  const baseId = useId();

  // A fresh file resets every derived measurement — the previous image's
  // natural/display size and crop rect describe a bitmap this editor no
  // longer shows.
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setObjectUrl(url);
    setNaturalSize(null);
    setDisplaySize(null);
    setCropSource(null);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Tracks the <img>'s rendered box — a responsive width means this changes
  // on every window resize, not just once at load.
  useEffect(() => {
    if (!imgEl) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setDisplaySize({ width, height });
    });
    observer.observe(imgEl);
    return () => observer.disconnect();
  }, [imgEl]);

  function handleImageLoad(e: SyntheticEvent<HTMLImageElement>) {
    const img = e.currentTarget;
    const natural = { width: img.naturalWidth, height: img.naturalHeight };
    setNaturalSize(natural);
    setCropSource((prev) => prev ?? initialCrop(natural));
  }

  const cropDisplay =
    naturalSize && displaySize && cropSource
      ? sourceToDisplay(cropSource, naturalSize, displaySize)
      : null;

  function updateFromDisplay(next: Rect) {
    if (!naturalSize || !displaySize) return;
    setCropSource(displayToSource(next, displaySize, naturalSize));
  }

  function beginDrag(kind: DragState["kind"]) {
    return (e: PointerEvent) => {
      if (!cropDisplay) return;
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      dragRef.current = {
        kind,
        startX: e.clientX,
        startY: e.clientY,
        startRect: cropDisplay,
      };
    };
  }

  function onDragMove(e: PointerEvent) {
    const drag = dragRef.current;
    if (!drag || !displaySize) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    const next =
      drag.kind === "move"
        ? moveRect(drag.startRect, dx, dy, displaySize)
        : resizeRect(drag.startRect, drag.kind, dx, dy, displaySize, aspect);
    updateFromDisplay(next);
  }

  function endDrag(e: PointerEvent) {
    if (dragRef.current && e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    dragRef.current = null;
  }

  /** Arrow keys nudge by 1 source pixel, shift+arrow by 10 — same step on
   * every focusable part of the editor (the crop body and every handle). */
  function arrowDelta(e: KeyboardEvent): [number, number] | null {
    const step = e.shiftKey ? 10 : 1;
    switch (e.key) {
      case "ArrowLeft":
        return [-step, 0];
      case "ArrowRight":
        return [step, 0];
      case "ArrowUp":
        return [0, -step];
      case "ArrowDown":
        return [0, step];
      default:
        return null;
    }
  }

  function handleBodyKeyDown(e: KeyboardEvent) {
    const delta = arrowDelta(e);
    if (!delta || !cropSource || !naturalSize) return;
    e.preventDefault();
    setCropSource(moveRect(cropSource, delta[0], delta[1], naturalSize));
  }

  function handleHandleKeyDown(handle: Handle) {
    return (e: KeyboardEvent) => {
      const delta = arrowDelta(e);
      if (!delta || !cropSource || !naturalSize) return;
      e.preventDefault();
      setCropSource(
        resizeRect(cropSource, handle, delta[0], delta[1], naturalSize, aspect),
      );
    };
  }

  function selectAspect(value: AspectRatio) {
    setAspect(value);
    if (cropSource && naturalSize) {
      setCropSource(applyAspectRatio(cropSource, value, naturalSize));
    }
  }

  function handleNumberChange(field: keyof Rect) {
    return (e: ChangeEvent<HTMLInputElement>) => {
      if (!cropSource || !naturalSize) return;
      const raw = e.target.valueAsNumber;
      if (Number.isNaN(raw)) return;
      setCropSource(clampRect({ ...cropSource, [field]: raw }, naturalSize));
    };
  }

  function handleSubmit() {
    if (!cropSource || !naturalSize) return;
    onSubmit(roundRect(clampRect(cropSource, naturalSize)));
  }

  // The move region is a real <button> (not a <div role="group">) so it's
  // natively focusable/tabbable with no ARIA workaround, and it's a *sibling*
  // of the handle buttons below, not their parent — nesting a <button> inside
  // a <button> is invalid HTML and browsers hoist it out, breaking hit-testing.
  const cropBody = cropDisplay && (
    <div
      className="absolute"
      style={{
        left: cropDisplay.x,
        top: cropDisplay.y,
        width: cropDisplay.width,
        height: cropDisplay.height,
      }}
    >
      <button
        type="button"
        aria-label="Crop region — drag, or focus and use arrow keys to move it; shift+arrow moves 10 pixels"
        onPointerDown={beginDrag("move")}
        onPointerMove={onDragMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={handleBodyKeyDown}
        className="absolute inset-0 cursor-move touch-none border-2 border-accent bg-transparent p-0 outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
      />
      {HANDLES.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          aria-label={`Resize crop — ${label} handle`}
          onPointerDown={beginDrag(id)}
          onPointerMove={onDragMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={handleHandleKeyDown(id)}
          className={`absolute size-3 touch-none rounded-full border-2 border-accent bg-canvas p-0 outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 ${
            id === "nw"
              ? "top-0 left-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize"
              : id === "se"
                ? "right-0 bottom-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize"
                : id === "ne"
                  ? "top-0 right-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize"
                  : "bottom-0 left-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize"
          }`}
        />
      ))}
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="relative inline-block max-w-full select-none rounded-lg border border-border bg-surface p-2">
        {objectUrl && (
          // eslint/Next's no-img-element doesn't apply (this project lints
          // with Biome, not next/eslint) — a plain <img> is exactly right
          // here: the browser decodes `objectUrl` off the main thread
          // (invariant 2), and next/image can't optimize a blob: URL anyway.
          <img
            ref={setImgEl}
            src={objectUrl}
            alt={`Preview of ${file.name}`}
            onLoad={handleImageLoad}
            className="block max-h-[60vh] max-w-full rounded"
          />
        )}
        {cropDisplay && (
          <>
            {/* Dims everything outside the crop rect via a clip-path hole,
                so the kept region reads as "lit" without four separate
                overlay divs. */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 bg-black/40"
              style={{
                clipPath: `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 ${cropDisplay.y}px, ${cropDisplay.x}px ${cropDisplay.y}px, ${cropDisplay.x}px ${cropDisplay.y + cropDisplay.height}px, ${cropDisplay.x + cropDisplay.width}px ${cropDisplay.y + cropDisplay.height}px, ${cropDisplay.x + cropDisplay.width}px ${cropDisplay.y}px, 0 ${cropDisplay.y}px)`,
              }}
            />
            {cropBody}
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-ink-muted">Aspect</span>
        {ASPECT_PRESETS.map((preset) => (
          <Button
            key={preset.label}
            type="button"
            variant={aspect === preset.value ? "default" : "outline"}
            size="sm"
            aria-pressed={aspect === preset.value}
            onClick={() => selectAspect(preset.value)}
          >
            {preset.label}
          </Button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(
          [
            ["x", "X"],
            ["y", "Y"],
            ["width", "Width"],
            ["height", "Height"],
          ] as const
        ).map(([field, label]) => (
          <div key={field} className="flex flex-col gap-1.5">
            <Label htmlFor={`${baseId}-${field}`}>{label}</Label>
            <Input
              id={`${baseId}-${field}`}
              type="number"
              min={0}
              max={
                naturalSize?.[
                  field === "x" || field === "width" ? "width" : "height"
                ]
              }
              step={1}
              value={cropSource ? Math.round(cropSource[field]) : ""}
              onChange={handleNumberChange(field)}
              disabled={!cropSource}
            />
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <Button type="button" onClick={handleSubmit} disabled={!cropSource}>
          {submitLabel}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
