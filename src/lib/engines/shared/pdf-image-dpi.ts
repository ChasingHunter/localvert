/**
 * Effective-DPI math for `compress-pdf` (docs/adr/0017-smart-compression.md,
 * "PDF"): "image pixels ÷ the size it's drawn at". Pure and
 * environment-neutral (no pdf-lib document types, no DOM) so the CTM
 * tracking and DPI/downscale arithmetic are unit-tested directly in Node —
 * `pdf-lib/adapter.ts` is the only caller, supplying the page-specific bits
 * (which XObject name maps to which object, decoding the content stream)
 * this module has no business knowing about.
 *
 * `ContentOp`'s shape matches `@cantoo/pdf-lib`'s own exported
 * `ContentStreamOperation` closely enough that a real one can be passed
 * straight through — `pdf-lib/adapter.ts` does exactly that, and this
 * file's own tests build content streams through the real `parseContentStream`
 * too, so the CTM tracking here is checked against the library's real
 * tokenizer, not just hand-rolled fixtures.
 */

export type Matrix = readonly [number, number, number, number, number, number];

export const IDENTITY_MATRIX: Matrix = [1, 0, 0, 1, 0, 0];

/**
 * Same convention (and the same operator order at each `cm`) as
 * `@cantoo/pdf-lib`'s own internal `extractPageContents.js`: `newCtm =
 * multiply(ctm, cmMatrix)` — the just-parsed `cm` operand matrix
 * post-multiplies the running CTM. Kept in lock-step with that (unexported)
 * implementation on purpose, so this module's own CTM ends up numerically
 * identical to what the library's own text/image extraction already
 * computes internally.
 */
export function multiplyMatrix(m1: Matrix, m2: Matrix): Matrix {
  const [a, b, c, d, e, f] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [
    a * a2 + c * b2,
    b * a2 + d * b2,
    a * c2 + c * d2,
    b * c2 + d * d2,
    a * e2 + c * f2 + e,
    b * e2 + d * f2 + f,
  ];
}

/** A PDF image XObject is always painted into the unit square `[0,1]x[0,1]`,
 * so the CTM's two basis vectors (`[a,b]` and `[c,d]`) are exactly the
 * drawn width/height, in PDF points, at the moment of `Do` — a shear or
 * rotation makes this an approximation (the drawn shape is a parallelogram,
 * not a rectangle), which is the "pragmatic" part of this scan; a
 * shear/rotation on an embedded photo is rare enough in practice that this
 * is an acceptable simplification, not a correctness bug for the common
 * case ADR-0017 targets. */
export function drawnSizeFromCtm(ctm: Matrix): {
  widthPt: number;
  heightPt: number;
} {
  return {
    widthPt: Math.hypot(ctm[0], ctm[1]),
    heightPt: Math.hypot(ctm[2], ctm[3]),
  };
}

/** Structural subset of `@cantoo/pdf-lib`'s `ContentStreamOperation` — just
 * enough for the `q`/`Q`/`cm`/`Do` operators this scan cares about. Every
 * other operator (text-showing, path-painting, color…) is ignored outright. */
export interface ContentOp {
  name: string;
  args: readonly unknown[];
}

function isNameOperand(
  value: unknown,
): value is { type: "name"; value: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "name" &&
    typeof (value as { value?: unknown }).value === "string"
  );
}

function matrixFromArgs(args: readonly unknown[]): Matrix | undefined {
  if (args.length < 6) return undefined;
  const nums = args.slice(-6).map((v) => (typeof v === "number" ? v : NaN));
  if (nums.some(Number.isNaN)) return undefined;
  return nums as unknown as Matrix;
}

/**
 * Walks one page's already-tokenized content stream (`q`/`Q` push/pop the
 * CTM, `cm` concatenates onto it, `Do` records a placement), tracking the
 * CTM from `initialCtm` (identity for a page, whose initial CTM in practice
 * is always identity at the top of its content stream, the same starting
 * point `@cantoo/pdf-lib`'s own `extractPageContents` uses). Doesn't recurse
 * into Form XObjects itself: a `Do` naming one is not in `nameToKey`, but
 * every `Do` is reported to `onDo` with the CTM at that moment, so the
 * caller can scan the form's own content stream from that CTM composed with
 * the form's `/Matrix` (ADR-0017 addendum, 2026-10-07).
 *
 * `nameToKey` maps a page's `/XObject` resource name (as it appears after
 * `/` in a `Do` operand) to whatever key the caller wants placements grouped
 * under — `pdf-lib/adapter.ts` uses the image's own indirect-object ref
 * string, so placements of the same shared image across multiple pages (or
 * multiple `Do`s on one page) all land under the one key that object's
 * `compressImageStream` pass will actually rewrite.
 */
export function scanImagePlacements(
  operations: readonly ContentOp[],
  nameToKey: ReadonlyMap<string, string>,
  onDo?: (name: string, ctm: Matrix) => void,
  initialCtm: Matrix = IDENTITY_MATRIX,
): Map<string, { widthPt: number; heightPt: number }[]> {
  const placements = new Map<string, { widthPt: number; heightPt: number }[]>();
  const stack: Matrix[] = [];
  let ctm: Matrix = initialCtm;

  for (const op of operations) {
    switch (op.name) {
      case "q":
        stack.push(ctm);
        break;
      case "Q":
        ctm = stack.pop() ?? initialCtm;
        break;
      case "cm": {
        const m = matrixFromArgs(op.args);
        if (m) ctm = multiplyMatrix(ctm, m);
        break;
      }
      case "Do": {
        const nameArg = op.args[0];
        const name = isNameOperand(nameArg) ? nameArg.value : undefined;
        const key = name ? nameToKey.get(name) : undefined;
        if (name) onDo?.(name, ctm);
        if (key) {
          const list = placements.get(key) ?? [];
          list.push(drawnSizeFromCtm(ctm));
          placements.set(key, list);
        }
        break;
      }
      default:
        break;
    }
  }

  return placements;
}

/** The largest placement wins (ADR-0017: preserve enough resolution for the
 * biggest on-page use of a shared image) — a smaller placement elsewhere
 * needs less detail, but this never discards detail the largest one needs. */
export function largestPlacement(
  placements: readonly { widthPt: number; heightPt: number }[],
): { widthPt: number; heightPt: number } | undefined {
  let best: { widthPt: number; heightPt: number } | undefined;
  for (const p of placements) {
    if (!best || p.widthPt * p.heightPt > best.widthPt * best.heightPt) {
      best = p;
    }
  }
  return best;
}

/** `pixels ÷ (drawn size in inches)` — `drawnPt <= 0` (a degenerate/zero
 * placement) reads as "infinitely dense", which downstream always clamps to
 * "downsample all the way to `targetDpi`" rather than dividing by zero. */
function effectiveDpi(pixels: number, drawnPt: number): number {
  if (drawnPt <= 0) return Number.POSITIVE_INFINITY;
  return pixels / (drawnPt / 72);
}

export interface TargetDimensions {
  width: number;
  height: number;
}

/**
 * The output pixel dimensions for one image at `targetDpi`, given its
 * intrinsic pixel size and the PDF-point size it's drawn at (or the page
 * size, as the caller's upper-bound fallback when no placement was found —
 * see `scanImagePlacements`'s doc comment). Each axis is scaled
 * independently and never *up* — `chooseDownsampleScale`'s `min(1, …)` — so
 * an image already at or under `targetDpi` is left alone. Independent
 * per-axis scaling is safe here specifically because the page's own drawing
 * instructions (the `cm`/`Do` that place the image) are never touched — only
 * the raster's own pixel data changes, so its displayed size on the page is
 * identical regardless of internal aspect ratio.
 */
export function targetDimensionsForImage(args: {
  pixelWidth: number;
  pixelHeight: number;
  drawnWidthPt: number;
  drawnHeightPt: number;
  targetDpi: number;
}): TargetDimensions {
  const { pixelWidth, pixelHeight, drawnWidthPt, drawnHeightPt, targetDpi } =
    args;

  const widthScale = Math.min(
    1,
    targetDpi / effectiveDpi(pixelWidth, drawnWidthPt),
  );
  const heightScale = Math.min(
    1,
    targetDpi / effectiveDpi(pixelHeight, drawnHeightPt),
  );

  return {
    width: Math.max(1, Math.round(pixelWidth * widthScale)),
    height: Math.max(1, Math.round(pixelHeight * heightScale)),
  };
}
