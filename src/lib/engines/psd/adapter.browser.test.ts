import { describe, expect, it } from "vitest";
import { isEngineError } from "../errors";
import type { EngineTask } from "../types";
import adapter from "./adapter";

function baseTask(overrides: Partial<EngineTask> = {}): EngineTask {
  return {
    op: "decode",
    input: { kind: "bytes", bytes: new ArrayBuffer(0) },
    inputFormat: "psd",
    outputFormat: "raster",
    options: {},
    signal: new AbortController().signal,
    ...overrides,
  };
}

/**
 * Hand-builds the smallest valid 8-bit RGB PSD the Adobe file spec allows: a
 * 2x2 image, no layers, RLE (PackBits)-compressed image data. Four distinct
 * corner colors make the decoded pixels easy to assert on exactly.
 *
 *   (0,0) red   (1,0) green
 *   (0,1) blue  (1,1) white
 *
 * Section order and sizes follow the file spec directly (see
 * https://www.adobe.com/devnet-apps/photoshop/fileformatashtml/): File
 * Header (fixed 26 bytes) -> Color Mode Data (4-byte length, empty) ->
 * Image Resources (4-byte length, empty) -> Layer and Mask Information ->
 * Image Data.
 *
 * Two things `@webtoon/psd`'s own parser needs that aren't obvious from the
 * spec's prose, found by tracing its (minified) `dist/index.js` against a
 * `RangeError: Offset is outside the bounds of the DataView` this fixture
 * used to throw:
 *
 * 1. "No layers" is not a bare 4-byte zero-length Layer and Mask
 *    Information section. The parser unconditionally reads a nested Layer
 *    Info length (4 bytes), a layer count (2 bytes), alignment padding, and
 *    a Global Layer Mask Info length (4 bytes) — 12 bytes of real content —
 *    regardless of how many layers there are. Declaring a shorter section
 *    (as a truly empty one would) runs the cursor past its own DataView.
 * 2. Raw (uncompressed) multi-channel image data hits what looks like a
 *    genuine bug in this library's raw-channel reader: it extracts each
 *    channel's plane with `Cursor.extract()`, which never advances the
 *    cursor, so every channel after the first re-reads the same bytes as
 *    the red channel instead of its own. RLE compression's reader does
 *    advance correctly (it uses `Cursor.take()`), so this fixture is
 *    RLE-compressed instead of raw, even at the cost of a PackBits encode
 *    step — the raw path is left untested here as a result, but decode/
 *    encode never touch it either (this engine only decodes, and only ever
 *    through this same library call).
 */
function buildMinimalPsd(
  opts: { depth?: number; colorMode?: number } = {},
): ArrayBuffer {
  const width = 2;
  const height = 2;
  const channels = 3;
  const depth = opts.depth ?? 8;
  const colorMode = opts.colorMode ?? 3; // RGB

  // Row-major, matching the corner layout in the doc comment above: row 0 is
  // [red, green], row 1 is [blue, white].
  const rRows = [
    [255, 0],
    [0, 255],
  ];
  const gRows = [
    [0, 255],
    [0, 255],
  ];
  const bRows = [
    [0, 0],
    [255, 255],
  ];

  /** PackBits-encodes one 2-byte row as a single literal run: control byte
   * `1` means "copy the next 2 bytes literally". */
  function packBitsRow(row: readonly number[]): number[] {
    return [row.length - 1, ...row];
  }

  const rBlocks = rRows.map(packBitsRow);
  const gBlocks = gRows.map(packBitsRow);
  const bBlocks = bRows.map(packBitsRow);
  const scanlineLengths = [...rBlocks, ...gBlocks, ...bBlocks].map(
    (b) => b.length,
  );
  const imageDataBytes = [
    ...rBlocks.flat(),
    ...gBlocks.flat(),
    ...bBlocks.flat(),
  ];

  const headerSize = 26;
  const emptySectionSize = 4; // just the 4-byte length prefix, no payload
  // Layer and Mask Information, with no layers: a 4-byte outer length
  // (declaring the 12 bytes below), then Layer Info length (4, unread value
  // — only its presence is skipped past) + layer count (2, must be 0) +
  // 2-byte alignment padding + Global Layer Mask Info length (4, must be 0
  // so nothing further is skipped) — see the doc comment above.
  const layerAndMaskContentSize = 12;
  const layerAndMaskSectionSize = 4 + layerAndMaskContentSize;
  const imageDataSize =
    2 + // compression flag
    scanlineLengths.length * 2 + // one u16 per scanline
    imageDataBytes.length;

  const buffer = new ArrayBuffer(
    headerSize + emptySectionSize * 2 + layerAndMaskSectionSize + imageDataSize,
  );
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let offset = 0;

  bytes.set([0x38, 0x42, 0x50, 0x53], offset); // "8BPS"
  offset += 4;
  view.setUint16(offset, 1, false); // version 1 (PSD, not PSB)
  offset += 2;
  offset += 6; // reserved, must be zero — ArrayBuffer already zero-fills
  view.setUint16(offset, channels, false);
  offset += 2;
  view.setUint32(offset, height, false);
  offset += 4;
  view.setUint32(offset, width, false);
  offset += 4;
  view.setUint16(offset, depth, false);
  offset += 2;
  view.setUint16(offset, colorMode, false);
  offset += 2;

  view.setUint32(offset, 0, false); // Color Mode Data: empty
  offset += 4;
  view.setUint32(offset, 0, false); // Image Resources: empty
  offset += 4;

  view.setUint32(offset, layerAndMaskContentSize, false);
  offset += 4;
  view.setUint32(offset, 0, false); // Layer Info length — value unread
  offset += 4;
  view.setUint16(offset, 0, false); // layer count: 0
  offset += 2;
  offset += 2; // alignment padding
  view.setUint32(offset, 0, false); // Global Layer Mask Info length: 0
  offset += 4;

  view.setUint16(offset, 1, false); // compression: 1 = RLE (PackBits)
  offset += 2;
  for (const length of scanlineLengths) {
    view.setUint16(offset, length, false);
    offset += 2;
  }
  bytes.set(imageDataBytes, offset);
  offset += imageDataBytes.length;

  return buffer;
}

describe("psd adapter", () => {
  it("carries the metadata defineEngine validated", () => {
    expect(adapter.id).toBe("psd");
    expect(adapter.marker).toBe("localvert-engine:psd");
    expect(adapter.location).toBe("bundled");
  });

  describe("supports", () => {
    it("accepts decode from psd to raster", () => {
      expect(adapter.supports("decode", "psd", "raster")).toBe(true);
    });

    it("rejects a non-decode op", () => {
      expect(adapter.supports("encode", "psd", "raster")).toBe(false);
    });

    it("rejects a non-psd input", () => {
      expect(adapter.supports("decode", "png", "raster")).toBe(false);
    });

    it("rejects a non-raster output", () => {
      expect(adapter.supports("decode", "psd", "psd")).toBe(false);
    });
  });

  describe("run", () => {
    it("decodes a hand-built 2x2 RGB PSD to its exact pixels", async () => {
      const instance = await adapter.load({
        baseUrl: "",
        capabilities: {} as never,
      });
      const bytes = buildMinimalPsd();

      const result = await instance.run(
        baseTask({ input: { kind: "bytes", bytes } }),
      );
      if (result.kind !== "raster") throw new Error("expected raster result");

      expect(result.image.width).toBe(2);
      expect(result.image.height).toBe(2);
      const px = (x: number, y: number) => {
        const i = (y * result.image.width + x) * 4;
        return Array.from(result.image.data.subarray(i, i + 4));
      };
      expect(px(0, 0)).toEqual([255, 0, 0, 255]); // red
      expect(px(1, 0)).toEqual([0, 255, 0, 255]); // green
      expect(px(0, 1)).toEqual([0, 0, 255, 255]); // blue
      expect(px(1, 1)).toEqual([255, 255, 255, 255]); // white
    });

    it("throws EngineError('decode-failed') for an unsupported bit depth", async () => {
      const instance = await adapter.load({
        baseUrl: "",
        capabilities: {} as never,
      });
      const bytes = buildMinimalPsd({ depth: 16 });

      await expect(
        instance.run(baseTask({ input: { kind: "bytes", bytes } })),
      ).rejects.toSatisfy(
        (e: unknown) => isEngineError(e) && e.code === "decode-failed",
      );
    });

    it("throws EngineError('decode-failed') on garbage bytes", async () => {
      const instance = await adapter.load({
        baseUrl: "",
        capabilities: {} as never,
      });
      const garbage = new Uint8Array([1, 2, 3, 4, 5]).buffer;

      await expect(
        instance.run(baseTask({ input: { kind: "bytes", bytes: garbage } })),
      ).rejects.toSatisfy(
        (e: unknown) => isEngineError(e) && e.code === "decode-failed",
      );
    });

    it("throws EngineError('aborted') when the signal is already aborted", async () => {
      const instance = await adapter.load({
        baseUrl: "",
        capabilities: {} as never,
      });
      const controller = new AbortController();
      controller.abort();
      const bytes = buildMinimalPsd();

      await expect(
        instance.run(
          baseTask({
            input: { kind: "bytes", bytes },
            signal: controller.signal,
          }),
        ),
      ).rejects.toSatisfy(
        (e: unknown) => isEngineError(e) && e.code === "aborted",
      );
    });
  });
});
