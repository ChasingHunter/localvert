/**
 * Pure geometry for `CropEditor` (`./crop-editor.tsx`) — no DOM, no React,
 * nothing that needs a browser. Every function takes and returns plain
 * `Rect`/`Size` values so it's trivially unit-testable (`crop-geometry.test.ts`)
 * and so `CropEditor` can reuse the exact same math for pointer drags,
 * keyboard nudges, and the numeric x/y/w/h inputs without three subtly
 * different implementations drifting apart.
 *
 * A `Rect` here is unit-agnostic — it's display (on-screen) pixels while the
 * user is dragging, and source (natural image) pixels once `displayToSource`
 * converts it for submission. Every function that clamps takes the bounds to
 * clamp against explicitly, rather than assuming a fixed origin.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

/** `null` means "Free" — no ratio is enforced. */
export type AspectRatio = number | null;

/** Which corner of the rect a resize handle is anchored to. */
export type Handle = "nw" | "ne" | "sw" | "se";

/**
 * Clamps `rect` so it stays fully inside `[0,0,bounds.width,bounds.height]`,
 * with each dimension at least `minSize`. Width/height are constrained
 * first, then x/y — so a rect wider than `bounds` shrinks to fit rather than
 * clamping to a negative position.
 */
export function clampRect(rect: Rect, bounds: Size, minSize = 1): Rect {
  const width = Math.min(
    Math.max(rect.width, minSize),
    Math.max(bounds.width, minSize),
  );
  const height = Math.min(
    Math.max(rect.height, minSize),
    Math.max(bounds.height, minSize),
  );
  const x = Math.min(Math.max(rect.x, 0), bounds.width - width);
  const y = Math.min(Math.max(rect.y, 0), bounds.height - height);
  return { x, y, width, height };
}

/** Translates `rect` by `(dx, dy)`, clamped to stay inside `bounds`. Used by
 * both pointer-drag moves and arrow-key nudges. */
export function moveRect(
  rect: Rect,
  dx: number,
  dy: number,
  bounds: Size,
): Rect {
  return clampRect({ ...rect, x: rect.x + dx, y: rect.y + dy }, bounds);
}

/**
 * Resizes `rect` by dragging `handle` by `(dx, dy)`. The opposite corner
 * (the "anchor") never moves. When `aspect` is set, the dimension that moved
 * less becomes a function of the one that moved more, so the ratio holds
 * throughout the drag rather than only once it settles.
 */
export function resizeRect(
  rect: Rect,
  handle: Handle,
  dx: number,
  dy: number,
  bounds: Size,
  aspect: AspectRatio = null,
  minSize = 1,
): Rect {
  const anchorRight = handle === "nw" || handle === "sw";
  const anchorBottom = handle === "nw" || handle === "ne";

  const anchorX = anchorRight ? rect.x + rect.width : rect.x;
  const anchorY = anchorBottom ? rect.y + rect.height : rect.y;
  const draggedX = anchorRight ? rect.x + dx : rect.x + rect.width + dx;
  const draggedY = anchorBottom ? rect.y + dy : rect.y + rect.height + dy;

  let width = Math.abs(draggedX - anchorX);
  let height = Math.abs(draggedY - anchorY);

  if (aspect !== null && aspect > 0) {
    if (Math.abs(dx) >= Math.abs(dy)) {
      height = width / aspect;
    } else {
      width = height * aspect;
    }
  }

  width = Math.max(width, minSize);
  height = Math.max(height, minSize);

  const x = anchorRight ? anchorX - width : anchorX;
  const y = anchorBottom ? anchorY - height : anchorY;

  return clampRect({ x, y, width, height }, bounds, minSize);
}

/**
 * Refits `rect` to `aspect`, anchored on its own center, clamped to `bounds`.
 * `null` (Free) returns `rect` unchanged. Shrinks whichever dimension is
 * currently "too wide" for the ratio rather than growing past `bounds`.
 */
export function applyAspectRatio(
  rect: Rect,
  aspect: AspectRatio,
  bounds: Size,
): Rect {
  if (aspect === null || aspect <= 0) return rect;

  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;

  let { width, height } = rect;
  if (width / height > aspect) {
    width = height * aspect;
  } else {
    height = width / aspect;
  }

  return clampRect(
    { x: cx - width / 2, y: cy - height / 2, width, height },
    bounds,
  );
}

/** Scales every field of `rect` from `from`-space to `to`-space. */
function scaleRect(rect: Rect, from: Size, to: Size): Rect {
  const scaleX = from.width === 0 ? 1 : to.width / from.width;
  const scaleY = from.height === 0 ? 1 : to.height / from.height;
  return {
    x: rect.x * scaleX,
    y: rect.y * scaleY,
    width: rect.width * scaleX,
    height: rect.height * scaleY,
  };
}

/** Converts a rect in on-screen display pixels to source (natural image)
 * pixels — what the engine's `crop` option (`canvas/adapter.ts`'s
 * `runCrop`) actually consumes. */
export function displayToSource(
  rect: Rect,
  displaySize: Size,
  sourceSize: Size,
): Rect {
  return scaleRect(rect, displaySize, sourceSize);
}

/** The inverse of `displayToSource` — source pixels to on-screen pixels, for
 * rendering the overlay and for round-tripping a numeric-input edit (which
 * the user enters in source pixels) back into display space. */
export function sourceToDisplay(
  rect: Rect,
  sourceSize: Size,
  displaySize: Size,
): Rect {
  return scaleRect(rect, sourceSize, displaySize);
}

/** Rounds every field to a whole pixel — the engine's crop option is
 * `z.number().int()` on every field (`_shared-options.ts`'s `cropField`). */
export function roundRect(rect: Rect): Rect {
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

/** A reasonable starting crop: centered, inset 10% from every edge of
 * `size` — never the full image, so the handles are visible and draggable
 * the moment the editor opens. */
export function initialCrop(size: Size, inset = 0.1): Rect {
  const width = size.width * (1 - inset * 2);
  const height = size.height * (1 - inset * 2);
  return {
    x: (size.width - width) / 2,
    y: (size.height - height) / 2,
    width,
    height,
  };
}
