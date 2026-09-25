/**
 * Target-size math for a raster resize, shared by every engine that can run
 * the `resize` op (ADR-0007) — `canvas` and `jsquash-resize` today. Kept
 * environment-neutral (no DOM, no wasm) so it can be unit-tested directly in
 * Node, and imported unchanged by both adapters: same `width`/`height`/`fit`/
 * `allowUpscale` options must produce the same output dimensions everywhere,
 * or a tool would behave differently depending on which engine the router
 * happened to pick.
 */

export interface ResizeOptions {
  width?: number;
  height?: number;
  fit: "contain" | "cover" | "fill";
  allowUpscale: boolean;
}

/** Reads a pipeline step's raw `options` down to `ResizeOptions`, defaulting
 * `fit` to "contain" and `allowUpscale` to `false` same as the option form's
 * own defaults. */
export function parseResizeOptions(
  options: Readonly<Record<string, unknown>>,
): ResizeOptions {
  return {
    width: typeof options.width === "number" ? options.width : undefined,
    height: typeof options.height === "number" ? options.height : undefined,
    fit:
      options.fit === "cover" || options.fit === "fill"
        ? options.fit
        : "contain",
    allowUpscale: options.allowUpscale === true,
  };
}

/**
 * `fit: "fill"` stretches to the exact target on both axes independently.
 * `"contain"`/`"cover"` preserve aspect ratio around a single scale factor —
 * the smaller (contain) or larger (cover) of the two axis scales, so the
 * result fits entirely within the box or entirely covers it, respectively.
 * `allowUpscale: false` (the default) clamps that scale to at most 1, so the
 * image never grows past its source size. Missing one of `width`/`height`
 * degenerates to scaling by the one axis given, same math either way.
 */
export function computeResizeDims(
  srcWidth: number,
  srcHeight: number,
  opts: ResizeOptions,
): { width: number; height: number } {
  const { width, height, fit, allowUpscale } = opts;

  if (width === undefined && height === undefined) {
    return { width: srcWidth, height: srcHeight };
  }

  if (fit === "fill" && width !== undefined && height !== undefined) {
    const w = allowUpscale ? width : Math.min(width, srcWidth);
    const h = allowUpscale ? height : Math.min(height, srcHeight);
    return {
      width: Math.max(1, Math.round(w)),
      height: Math.max(1, Math.round(h)),
    };
  }

  const scaleW = width !== undefined ? width / srcWidth : undefined;
  const scaleH = height !== undefined ? height / srcHeight : undefined;

  let scale: number;
  if (scaleW !== undefined && scaleH !== undefined) {
    scale =
      fit === "cover" ? Math.max(scaleW, scaleH) : Math.min(scaleW, scaleH);
  } else if (scaleW !== undefined) {
    scale = scaleW;
  } else if (scaleH !== undefined) {
    scale = scaleH;
  } else {
    // Unreachable: the both-undefined case returned above.
    scale = 1;
  }

  if (!allowUpscale) scale = Math.min(scale, 1);

  return {
    width: Math.max(1, Math.round(srcWidth * scale)),
    height: Math.max(1, Math.round(srcHeight * scale)),
  };
}
