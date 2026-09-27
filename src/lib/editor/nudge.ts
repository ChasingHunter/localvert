/**
 * Arrow-key nudging of a selected annotation (owner-reported fix, 2026-09-27).
 * Kept pure and DOM-free, same reasoning as `shortcuts.ts`: the actual keydown
 * listener lives in `pdf-editor-app.tsx` (it needs the annotation capability),
 * this module only maps a key + modifier to a PDF-point delta so the math is
 * unit-testable without a browser or a mocked plugin.
 */

export interface NudgeDelta {
  x: number;
  y: number;
}

/** One arrow-key press without Shift. */
const NUDGE_STEP = 1;
/** One arrow-key press with Shift held. */
const NUDGE_STEP_SHIFT = 10;

/**
 * Maps an arrow key to a one-step delta in PDF points, or `null` for any
 * other key. The sign convention matches `@embedpdf/models`'s `Rect.origin`
 * as this codebase already uses it -- top-left origin, no y-flip (see
 * `form-layer.tsx`'s `rectToCssBox` doc comment) -- so `ArrowDown` increases
 * `y` the same way it moves an element down on screen.
 */
export function arrowKeyNudge(
  key: string,
  shiftKey: boolean,
): NudgeDelta | null {
  const step = shiftKey ? NUDGE_STEP_SHIFT : NUDGE_STEP;
  switch (key) {
    case "ArrowUp":
      return { x: 0, y: -step };
    case "ArrowDown":
      return { x: 0, y: step };
    case "ArrowLeft":
      return { x: -step, y: 0 };
    case "ArrowRight":
      return { x: step, y: 0 };
    default:
      return null;
  }
}
