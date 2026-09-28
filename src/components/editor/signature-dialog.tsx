"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  applyWhiteThreshold,
  computeInkBounds,
} from "@/lib/editor/signature-image";
import {
  forgetSignature,
  loadSignature,
  saveSignature,
} from "@/lib/editor/signature-store";

/**
 * The "Sign" toolbar button's modal (ADR-0009). Draw, type or upload a
 * signature, then place it through the same path as the existing image
 * stamp tool: a trimmed transparent PNG handed to
 * `annotation.provides.setActiveTool("stamp", { data, mimeType })` in
 * `pdf-editor-app.tsx` (its `placeStamp` — this component never touches the
 * annotation plugin itself, it only ever produces a PNG `ArrayBuffer`).
 *
 * A native `<dialog>` — no dialog primitive exists yet under
 * `src/components/ui/`, and `showModal()` gives focus-trapping and Escape-
 * to-close for free.
 */

type Tab = "draw" | "type" | "upload";

/** Working canvas size for the draw/type tabs, in device-independent px.
 * Wide enough for a full name, short enough to keep the trimmed PNG small. */
const CANVAS_WIDTH = 600;
const CANVAS_HEIGHT = 200;
/** Padding (px, in canvas space) kept around the trimmed ink/text/image. */
const TRIM_PADDING = 10;
/** "Remove white background" threshold — see `applyWhiteThreshold`'s doc. */
const WHITE_THRESHOLD = 245;

const INK_COLORS: Record<"black" | "blue", string> = {
  black: "#111111",
  blue: "#1d4ed8",
};

/** Maps a pointer event to a point in the canvas's own coordinate space
 * (which can differ from its CSS size). Module-scoped, not a component
 * closure, so it's never itself a `useCallback` dependency. */
function canvasPoint(
  canvas: HTMLCanvasElement,
  e: React.PointerEvent<HTMLCanvasElement>,
) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((e.clientX - rect.left) / rect.width) * canvas.width,
    y: ((e.clientY - rect.top) / rect.height) * canvas.height,
  };
}

export interface SignatureDialogProps {
  open: boolean;
  onClose: () => void;
  /** A trimmed, transparent signature PNG, ready for the stamp tool. */
  onPlace: (data: ArrayBuffer, mimeType: string) => void;
}

export function SignatureDialog({
  open,
  onClose,
  onPlace,
}: SignatureDialogProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [tab, setTab] = useState<Tab>("draw");
  const [remember, setRemember] = useState(false);
  const [savedBlob, setSavedBlob] = useState<Blob | null>(null);

  // Draw tab.
  const drawCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [inkColor, setInkColor] = useState<"black" | "blue">("black");
  const strokePointsRef = useRef<{ x: number; y: number }[]>([]);
  const [drawIsEmpty, setDrawIsEmpty] = useState(true);

  // Type tab.
  const [typedText, setTypedText] = useState("");
  const [typeFont, setTypeFont] = useState<"cursive" | "serif-italic">(
    "cursive",
  );
  const typeCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Upload tab.
  const uploadCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [removeWhite, setRemoveWhite] = useState(true);
  const [uploadedBitmap, setUploadedBitmap] = useState<ImageBitmap | null>(
    null,
  );

  // Open/close the native dialog to track `open`, and reset per-open state.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      loadSignature().then(setSavedBlob);
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  // Redraw the type-tab canvas whenever its text/font changes.
  useEffect(() => {
    const canvas = typeCanvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!typedText.trim()) return;
    ctx.fillStyle = "#111111";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font =
      typeFont === "cursive"
        ? `56px cursive`
        : `italic 52px "Times New Roman", serif`;
    ctx.fillText(typedText, canvas.width / 2, canvas.height / 2);
  }, [typedText, typeFont]);

  // Redraw the upload-tab canvas whenever the image or the white-removal
  // toggle changes.
  useEffect(() => {
    const canvas = uploadCanvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !uploadedBitmap) return;
    canvas.width = uploadedBitmap.width;
    canvas.height = uploadedBitmap.height;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(uploadedBitmap, 0, 0);
    if (removeWhite) {
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      applyWhiteThreshold(imageData.data, WHITE_THRESHOLD);
      ctx.putImageData(imageData, 0, 0);
    }
  }, [uploadedBitmap, removeWhite]);

  const clearDraw = useCallback(() => {
    const canvas = drawCanvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setDrawIsEmpty(true);
  }, []);

  const onDrawPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = drawCanvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;
      canvas.setPointerCapture(e.pointerId);
      const point = canvasPoint(canvas, e);
      strokePointsRef.current = [point];
      ctx.beginPath();
      ctx.moveTo(point.x, point.y);
    },
    [],
  );

  const onDrawPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (strokePointsRef.current.length === 0) return;
      const canvas = drawCanvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;
      const point = canvasPoint(canvas, e);
      const points = strokePointsRef.current;
      const prev = points[points.length - 1];
      if (!prev) return;
      // Pressure isn't read (mouse and touch draw the same width). Smooths
      // the raw polyline with the standard "quadratic through midpoints"
      // freehand-canvas technique: curve from the path's current position
      // through the previous point, ending at the midpoint of prev/current
      // — far less jagged than point-to-point line segments, and each
      // segment's end becomes the next segment's implicit start.
      const mid = { x: (prev.x + point.x) / 2, y: (prev.y + point.y) / 2 };
      ctx.strokeStyle = INK_COLORS[inkColor];
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.quadraticCurveTo(prev.x, prev.y, mid.x, mid.y);
      ctx.stroke();
      points.push(point);
      setDrawIsEmpty(false);
    },
    [inkColor],
  );

  const onDrawPointerUp = useCallback(() => {
    strokePointsRef.current = [];
  }, []);

  const handleUploadFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      const bitmap = await createImageBitmap(file);
      setUploadedBitmap(bitmap);
    },
    [],
  );

  /** Crops `source` to its ink/text/opaque-pixel bounds (padded) and
   * resolves a transparent PNG blob — the shared export step for all three
   * tabs. */
  const exportTrimmedPng = useCallback(
    async (source: HTMLCanvasElement): Promise<Blob | null> => {
      const ctx = source.getContext("2d");
      if (!ctx) return null;
      const { data } = ctx.getImageData(0, 0, source.width, source.height);
      const bounds = computeInkBounds(
        data,
        source.width,
        source.height,
        TRIM_PADDING,
      );
      if (!bounds) return null;
      const out = new OffscreenCanvas(bounds.width, bounds.height);
      const outCtx = out.getContext("2d");
      if (!outCtx) return null;
      outCtx.drawImage(
        source,
        bounds.x,
        bounds.y,
        bounds.width,
        bounds.height,
        0,
        0,
        bounds.width,
        bounds.height,
      );
      return out.convertToBlob({ type: "image/png" });
    },
    [],
  );

  const placeBlob = useCallback(
    async (blob: Blob) => {
      const data = await blob.arrayBuffer();
      onPlace(data, "image/png");
    },
    [onPlace],
  );

  const handlePlace = useCallback(async () => {
    const source =
      tab === "draw"
        ? drawCanvasRef.current
        : tab === "type"
          ? typeCanvasRef.current
          : uploadCanvasRef.current;
    if (!source) return;
    const blob = await exportTrimmedPng(source);
    if (!blob) return;
    if (remember) await saveSignature(blob);
    await placeBlob(blob);
  }, [tab, exportTrimmedPng, remember, placeBlob]);

  const handleUseSaved = useCallback(async () => {
    if (!savedBlob) return;
    await placeBlob(savedBlob);
  }, [savedBlob, placeBlob]);

  const handleForget = useCallback(async () => {
    await forgetSignature();
    setSavedBlob(null);
  }, []);

  const canPlace =
    tab === "draw"
      ? !drawIsEmpty
      : tab === "type"
        ? typedText.trim().length > 0
        : uploadedBitmap !== null;

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className="fixed inset-0 m-auto h-fit w-full max-w-xl rounded-2xl border border-border bg-surface p-0 text-ink shadow-lg backdrop:bg-ink/40"
    >
      <div className="flex flex-col gap-4 p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Sign document</h2>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Close"
            onClick={onClose}
          >
            Close
          </Button>
        </div>

        {savedBlob && (
          <div className="flex items-center gap-2 rounded-md border border-border bg-canvas p-2 text-xs text-ink-muted">
            <span>A signature is saved on this device.</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleUseSaved}
            >
              Use saved
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleForget}
            >
              Forget
            </Button>
          </div>
        )}

        <div
          role="tablist"
          aria-label="Signature method"
          className="flex gap-1"
        >
          {(["draw", "type", "upload"] as const).map((t) => (
            <Button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              variant={tab === t ? "default" : "outline"}
              size="sm"
              onClick={() => setTab(t)}
            >
              {t === "draw" ? "Draw" : t === "type" ? "Type" : "Upload"}
            </Button>
          ))}
        </div>

        {tab === "draw" && (
          <div className="flex flex-col gap-2">
            <canvas
              ref={drawCanvasRef}
              width={CANVAS_WIDTH}
              height={CANVAS_HEIGHT}
              aria-label="Draw your signature"
              className="touch-none rounded-md border border-border bg-white"
              onPointerDown={onDrawPointerDown}
              onPointerMove={onDrawPointerMove}
              onPointerUp={onDrawPointerUp}
              onPointerLeave={onDrawPointerUp}
            />
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1 text-xs text-ink-muted">
                Ink
                <select
                  aria-label="Ink color"
                  value={inkColor}
                  onChange={(e) =>
                    setInkColor(e.target.value as "black" | "blue")
                  }
                  className="rounded border border-border bg-canvas px-1 py-0.5 text-ink"
                >
                  <option value="black">Black</option>
                  <option value="blue">Blue</option>
                </select>
              </label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={clearDraw}
              >
                Clear
              </Button>
            </div>
          </div>
        )}

        {tab === "type" && (
          <div className="flex flex-col gap-2">
            <input
              type="text"
              aria-label="Type your signature"
              placeholder="Your name"
              value={typedText}
              onChange={(e) => setTypedText(e.target.value)}
              className="rounded-md border border-border bg-canvas px-2 py-1 text-ink"
            />
            <label className="flex items-center gap-1 text-xs text-ink-muted">
              Style
              <select
                aria-label="Signature style"
                value={typeFont}
                onChange={(e) =>
                  setTypeFont(e.target.value as "cursive" | "serif-italic")
                }
                className="rounded border border-border bg-canvas px-1 py-0.5 text-ink"
              >
                <option value="cursive">Cursive</option>
                <option value="serif-italic">Italic serif</option>
              </select>
            </label>
            <canvas
              ref={typeCanvasRef}
              width={CANVAS_WIDTH}
              height={CANVAS_HEIGHT}
              className="rounded-md border border-border bg-white"
            />
          </div>
        )}

        {tab === "upload" && (
          <div className="flex flex-col gap-2">
            <input
              type="file"
              accept="image/png,image/jpeg"
              aria-label="Upload a signature image"
              onChange={handleUploadFile}
            />
            <label className="flex items-center gap-2 text-xs text-ink-muted">
              <input
                type="checkbox"
                checked={removeWhite}
                onChange={(e) => setRemoveWhite(e.target.checked)}
              />
              Remove white background
            </label>
            <canvas
              ref={uploadCanvasRef}
              className="max-h-50 w-auto rounded-md border border-border bg-[repeating-conic-gradient(#e5e5e5_0%_25%,transparent_0%_50%)] bg-size-[16px_16px] object-contain"
            />
          </div>
        )}

        <label className="flex items-center gap-2 text-xs text-ink-muted">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          Remember this signature on this device
        </label>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" disabled={!canPlace} onClick={handlePlace}>
            Place
          </Button>
        </div>
      </div>
    </dialog>
  );
}
