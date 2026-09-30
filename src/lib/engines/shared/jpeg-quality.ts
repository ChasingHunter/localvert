/**
 * Estimates a JPEG's own encode quality (IJG 1-100 scale) by reading its
 * luminance quantization table (DQT marker) and comparing it against the
 * standard Annex K table those quality levels are derived from. Used by the
 * image "best quality" search (ADR-0017) to cap the search range at
 * `min(95, source quality)` — re-encoding a quality-60 JPEG up to quality 95
 * can't recover detail it never had, so searching that high just wastes
 * encodes.
 *
 * This is the same scale-factor-and-invert heuristic long used by tools like
 * `jpeginfo`/ImageMagick's `identify -verbose` (not exact — mozjpeg's own
 * quantization tables can differ slightly by chroma subsampling and quality
 * level — but accurate enough to bound a search range).
 */

/** IJG/libjpeg's standard luminance quantization table (ITU-T T.81 Annex K,
 * Table K.1), in the same zigzag storage order JPEG's own DQT segments use —
 * so comparing a source table to this one element-for-element (no
 * un-zigzagging needed) is valid. This is the table `quality = 50`
 * (`scale = 100`) scales from. */
const STANDARD_LUMINANCE_TABLE: readonly number[] = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16,
  24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109,
  103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101,
  72, 92, 95, 98, 112, 100, 103, 99,
];

const DQT_MARKER = 0xdb;
const SOS_MARKER = 0xda;
/** Markers with no payload (no length field follows). */
const STANDALONE_MARKERS = new Set([0xd8, 0xd9, 0x01, ...range(0xd0, 0xd7)]);

function range(start: number, end: number): number[] {
  const out: number[] = [];
  for (let i = start; i <= end; i++) out.push(i);
  return out;
}

/** One quantization table read from a DQT segment. */
interface QuantTable {
  /** The `Tq` field: 0 for luminance, 1+ for chrominance, by convention. */
  id: number;
  values: number[];
}

/**
 * Parses every DQT segment in a JPEG byte stream, returning each table
 * found, in file order. Stops at the first SOS (start of scan) marker, or on
 * running out of bytes — either way, returning whatever tables were found so
 * far rather than throwing, since this is a best-effort estimate, not a full
 * JPEG parser.
 */
export function parseQuantTables(bytes: Uint8Array): QuantTable[] {
  const tables: QuantTable[] = [];
  let i = 0;

  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    // Not a JPEG (or too short to be one) — no tables to find.
    return tables;
  }
  i = 2;

  while (i + 1 < bytes.length) {
    if (bytes[i] !== 0xff) {
      // Lost sync (shouldn't happen in a well-formed file) — bail out with
      // whatever was already found.
      break;
    }
    const marker = bytes[i + 1] ?? 0;
    i += 2;

    if (marker === SOS_MARKER) break;
    if (STANDALONE_MARKERS.has(marker)) continue;
    if (i + 1 >= bytes.length) break;

    const length = ((bytes[i] ?? 0) << 8) | (bytes[i + 1] ?? 0);
    const segmentStart = i + 2;
    const segmentEnd = i + length; // `length` includes its own 2 length bytes
    if (length < 2 || segmentEnd > bytes.length) break;

    if (marker === DQT_MARKER) {
      let p = segmentStart;
      while (p < segmentEnd) {
        const pqTq = bytes[p] ?? 0;
        const precision = pqTq >> 4; // 0 = 8-bit entries, 1 = 16-bit
        const id = pqTq & 0x0f;
        p += 1;
        const values: number[] = [];
        for (let k = 0; k < 64; k++) {
          if (precision === 0) {
            values.push(bytes[p] ?? 0);
            p += 1;
          } else {
            values.push(((bytes[p] ?? 0) << 8) | (bytes[p + 1] ?? 0));
            p += 2;
          }
        }
        tables.push({ id, values });
      }
    }

    i = segmentEnd;
  }

  return tables;
}

/**
 * Estimates the IJG quality (1-100) a JPEG was encoded at, from its
 * luminance (`Tq = 0`, or the first table found if none is explicitly id 0)
 * quantization table. Returns `undefined` if no DQT table could be found
 * (not a JPEG, or a malformed/truncated one).
 *
 * Method: average the per-entry ratio of the source table to the standard
 * table to get an implied "scale percent" `S`, then invert IJG's own
 * `scale-from-quality` formula:
 * - `quality <= 50`: `S = 5000 / quality`
 * - `quality > 50`: `S = 200 - 2*quality`
 *
 * Inverted:
 * - `S >= 100`: `quality = 5000 / S`
 * - `S < 100`: `quality = (200 - S) / 2`
 */
export function estimateJpegQuality(bytes: Uint8Array): number | undefined {
  const tables = parseQuantTables(bytes);
  if (tables.length === 0) return undefined;

  const luminance = tables.find((t) => t.id === 0) ?? tables[0];
  if (!luminance) return undefined;

  let ratioSum = 0;
  let count = 0;
  for (let i = 0; i < 64; i++) {
    const std = STANDARD_LUMINANCE_TABLE[i] ?? 1;
    const value = luminance.values[i];
    if (value === undefined || value <= 0) continue;
    ratioSum += (value / std) * 100;
    count++;
  }
  if (count === 0) return undefined;

  const scale = ratioSum / count;
  const quality = scale >= 100 ? 5000 / scale : (200 - scale) / 2;

  return Math.round(Math.min(100, Math.max(1, quality)));
}
