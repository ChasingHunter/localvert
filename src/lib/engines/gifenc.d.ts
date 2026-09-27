/**
 * Minimal ambient typings for `gifenc` (MIT, see node_modules/gifenc/README.md
 * for the full API this is drawn from) — the package ships no `.d.ts` and its
 * `package.json` has no `types` field. Only the surface `src/lib/engines/
 * mediabunny/gif.ts` actually calls is declared here; anything else on the
 * package's real export list is untyped (`any`) if ever imported.
 */
declare module "gifenc" {
  /** RGB, or RGBA when `quantize`'s `format` option is `"rgba4444"`. */
  export type GifencColor =
    | readonly [number, number, number]
    | readonly [number, number, number, number];

  export interface QuantizeOptions {
    format?: "rgb565" | "rgb444" | "rgba4444";
    oneBitAlpha?: boolean | number;
    clearAlpha?: boolean;
    clearAlphaThreshold?: number;
    clearAlphaColor?: number;
  }

  /** Reduces `rgba` (flat RGBA bytes) to at most `maxColors` colors. */
  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    options?: QuantizeOptions,
  ): GifencColor[];

  /** Maps each pixel of `rgba` to its nearest index in `palette`. */
  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: readonly GifencColor[],
    format?: "rgb565" | "rgb444" | "rgba4444",
  ): Uint8Array;

  export interface WriteFrameOptions {
    palette?: readonly GifencColor[] | null;
    first?: boolean;
    transparent?: boolean;
    transparentIndex?: number;
    delay?: number;
    repeat?: number;
    colorDepth?: number;
    dispose?: number;
  }

  export interface GifencEncoder {
    reset(): void;
    finish(): void;
    bytes(): Uint8Array;
    bytesView(): Uint8Array;
    readonly buffer: ArrayBufferLike;
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      options?: WriteFrameOptions,
    ): void;
  }

  export interface GIFEncoderOptions {
    initialCapacity?: number;
    auto?: boolean;
  }

  export function GIFEncoder(options?: GIFEncoderOptions): GifencEncoder;
}
