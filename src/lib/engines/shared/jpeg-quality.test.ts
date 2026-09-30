import { describe, expect, it } from "vitest";
import { estimateJpegQuality, parseQuantTables } from "./jpeg-quality";

const STANDARD_LUMINANCE_TABLE = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16,
  24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109,
  103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101,
  72, 92, 95, 98, 112, 100, 103, 99,
];

/** Builds the exact table IJG's own quality-to-table scaling produces for a
 * given quality, inverse of the formula `estimateJpegQuality` un-does. */
function tableForQuality(quality: number): number[] {
  const scale = quality <= 50 ? 5000 / quality : 200 - 2 * quality;
  return STANDARD_LUMINANCE_TABLE.map((v) =>
    Math.min(255, Math.max(1, Math.round((v * scale) / 100))),
  );
}

/** Assembles a minimal-but-valid-enough JPEG byte stream: SOI, one DQT
 * segment (8-bit precision, table id 0) holding `table`, then SOS (with a
 * zero-length fake payload — the parser stops there regardless). */
function buildJpegWithDqt(table: number[]): Uint8Array {
  const dqtLength = 2 + 1 + 64; // length field + Pq/Tq byte + 64 entries
  const bytes: number[] = [
    0xff,
    0xd8, // SOI
    0xff,
    0xdb, // DQT
    (dqtLength >> 8) & 0xff,
    dqtLength & 0xff,
    0x00, // Pq=0 (8-bit), Tq=0 (luminance)
    ...table,
    0xff,
    0xda, // SOS - parser stops here
  ];
  return new Uint8Array(bytes);
}

describe("parseQuantTables", () => {
  it("returns [] for non-JPEG bytes", () => {
    expect(parseQuantTables(new Uint8Array([1, 2, 3]))).toEqual([]);
  });

  it("finds the DQT table", () => {
    const table = tableForQuality(80);
    const tables = parseQuantTables(buildJpegWithDqt(table));
    expect(tables).toHaveLength(1);
    expect(tables[0]?.id).toBe(0);
    expect(tables[0]?.values).toEqual(table);
  });
});

describe("estimateJpegQuality", () => {
  it("returns undefined when there's no DQT table", () => {
    expect(
      estimateJpegQuality(new Uint8Array([0xff, 0xd8, 0xff, 0xda])),
    ).toBeUndefined();
  });

  it.each([30, 50, 65, 75, 85, 95])(
    "round-trips a table built for quality %d within a small tolerance",
    (quality) => {
      const bytes = buildJpegWithDqt(tableForQuality(quality));
      const estimated = estimateJpegQuality(bytes);
      expect(estimated).toBeDefined();
      // Rounding in both the table-build step and the estimator itself means
      // this isn't always exact — within 2 is the standard tolerance cited
      // for this heuristic (it's an estimate, not an exact inverse).
      expect(Math.abs((estimated ?? 0) - quality)).toBeLessThanOrEqual(2);
    },
  );

  it("clamps to [1, 100]", () => {
    const allOnes = new Array(64).fill(1);
    const estimated = estimateJpegQuality(buildJpegWithDqt(allOnes));
    expect(estimated).toBeLessThanOrEqual(100);
    expect(estimated).toBeGreaterThanOrEqual(1);
  });
});
