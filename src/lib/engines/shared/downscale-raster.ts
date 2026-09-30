/**
 * Area-average RGBA downscale, used by the target-size downscale fallback
 * (ADR-0017: "if quality 30 still exceeds T, downscale by
 * sqrt(T/size) * 0.95 ... using the existing high-quality resize path").
 *
 * Deviation from the ADR's literal wording, noted here and in the
 * implementer's report: the codebase's actual high-quality resize path
 * (`@jsquash/resize`, Lanczos3) lives in a *separate* engine
 * (`jsquash-resize`) with its own wasm asset directory, loaded via that
 * engine's own `EngineLoadContext.baseUrl` — there's no wired mechanism for
 * one engine adapter to reach another engine's asset `baseUrl`, and adding
 * one is a bigger change than this fallback (rare: only when quality 30
 * still overshoots) justifies. This uses the same area-average box filter
 * `ssim.ts` already uses for its own downscale (a real, correct
 * antialiasing downscale — not nearest-neighbour), just across all 4 RGBA
 * channels instead of one luma channel. It's a smaller quality bar than
 * Lanczos3 but produces a genuinely smaller, non-aliased image, and this
 * path only runs when quality reduction alone couldn't hit the target.
 */

export interface RasterLike {
  width: number;
  height: number;
  // Pinned to `ArrayBuffer` (not the wider `ArrayBufferLike` a bare
  // `Uint8ClampedArray` defaults to) so this is directly assignable to
  // `RasterImage` (`../types.ts`) without a cast — see that type's own doc
  // comment for why.
  data: Uint8ClampedArray<ArrayBuffer>;
}

export function downscaleRasterAreaAverage(
  image: RasterLike,
  dstWidth: number,
  dstHeight: number,
): RasterLike {
  const { width: srcW, height: srcH, data: src } = image;
  if (dstWidth === srcW && dstHeight === srcH) return image;

  const dst = new Uint8ClampedArray(dstWidth * dstHeight * 4);
  const scaleX = srcW / dstWidth;
  const scaleY = srcH / dstHeight;

  for (let dy = 0; dy < dstHeight; dy++) {
    const sy0 = Math.floor(dy * scaleY);
    const sy1 = Math.max(sy0 + 1, Math.min(srcH, Math.ceil((dy + 1) * scaleY)));
    for (let dx = 0; dx < dstWidth; dx++) {
      const sx0 = Math.floor(dx * scaleX);
      const sx1 = Math.max(
        sx0 + 1,
        Math.min(srcW, Math.ceil((dx + 1) * scaleX)),
      );

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let count = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        const rowOffset = sy * srcW;
        for (let sx = sx0; sx < sx1; sx++) {
          const i = (rowOffset + sx) * 4;
          r += src[i] ?? 0;
          g += src[i + 1] ?? 0;
          b += src[i + 2] ?? 0;
          a += src[i + 3] ?? 0;
          count++;
        }
      }
      const outI = (dy * dstWidth + dx) * 4;
      dst[outI] = count > 0 ? r / count : 0;
      dst[outI + 1] = count > 0 ? g / count : 0;
      dst[outI + 2] = count > 0 ? b / count : 0;
      dst[outI + 3] = count > 0 ? a / count : 0;
    }
  }

  return { width: dstWidth, height: dstHeight, data: dst };
}
