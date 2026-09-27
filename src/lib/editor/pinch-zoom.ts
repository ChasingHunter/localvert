/**
 * Pure helpers for pinch-to-zoom (E6b). The touch pointer-event handling
 * that calls these lives in `pdf-editor-app.tsx` (two active pointers →
 * distance ratio → `zoom.provides.requestZoomBy`, per
 * `@embedpdf/plugin-zoom`'s `ZoomScope.requestZoomBy(delta, center?)` — see
 * that plugin's `dist/lib/types.d.ts`). Kept pure and separate so the ratio
 * math is unit-testable without a real touchscreen or pointer events.
 */

export interface Point2D {
  x: number;
  y: number;
}

/** Euclidean distance between two pointer positions — the pinch "span". */
export function pointerDistance(a: Point2D, b: Point2D): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Converts a pinch span ratio (current distance / distance at the previous
 * event) into a `requestZoomBy` delta, clamped to `maxStep` per event so a
 * single noisy pointer-move can't jump the zoom level wildly. A ratio > 1
 * (fingers spreading) yields a positive delta (zoom in); a ratio < 1
 * (pinching in) yields a negative delta. Non-finite or non-positive ratios
 * (a degenerate same-point span, e.g.) yield 0 — no zoom change. */
export function pinchRatioToZoomDelta(ratio: number, maxStep = 0.5): number {
  if (!Number.isFinite(ratio) || ratio <= 0) return 0;
  const raw = ratio - 1;
  return Math.max(-maxStep, Math.min(maxStep, raw));
}
