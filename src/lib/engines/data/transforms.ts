/**
 * Pure conversion cores for the `data` engine (csv/json/yaml/xlsx). No
 * browser or worker API here — everything in this file is plain data in,
 * plain data out, which is what makes it testable in Node (`transforms.
 * test.ts`) without a browser-mode Vitest run. `adapter.ts` is the thin
 * worker-side wrapper that reads bytes off `EngineTask`, calls into these
 * functions (and, for xlsx, the `read-excel-file`/`write-excel-file`
 * libraries this module hands sheet data to/from), and turns the result back
 * into an `EngineResult`.
 */

import Papa from "papaparse";
import YAML from "yaml";

/** Rejects any input over this size before it's parsed — see `assertSizeCap`. */
export const MAX_DATA_INPUT_BYTES = 100 * 1024 * 1024;

export class DataConversionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataConversionError";
  }
}

/** Throws if `byteLength` is over the 100 MB cap this engine enforces on every op. */
export function assertSizeCap(byteLength: number): void {
  if (byteLength > MAX_DATA_INPUT_BYTES) {
    throw new DataConversionError(
      `input is ${(byteLength / (1024 * 1024)).toFixed(1)} MB, over the 100 MB limit for data conversions`,
    );
  }
}

export type Delimiter = "auto" | "," | ";" | "\t";

export interface CsvToJsonOptions {
  delimiter?: Delimiter;
  /** Detect numbers and booleans. Default on — see `_shared-options.ts` convention. */
  dynamicTyping?: boolean;
}

/** A JSON value flat enough to become one XLSX/CSV row: string keys, scalar or nested values. */
export type JsonRecord = Record<string, unknown>;

/**
 * CSV text -> array of objects keyed by the header row (papaparse `header:
 * true`). `delimiter: "auto"` (the default) lets papaparse sniff comma vs
 * semicolon vs tab itself; an explicit value forces it, for a file whose
 * separator papaparse's own heuristic gets wrong.
 */
export function csvToJson(
  csv: string,
  options: CsvToJsonOptions = {},
): JsonRecord[] {
  const { delimiter = "auto", dynamicTyping = true } = options;
  const result = Papa.parse<JsonRecord>(csv, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping,
    delimiter: delimiter === "auto" ? "" : delimiter,
  });
  const fatal = result.errors.find((e) => e.type !== "FieldMismatch");
  if (fatal) {
    throw new DataConversionError(`csv parse failed: ${fatal.message}`);
  }
  return result.data;
}

export interface JsonToCsvOptions {
  delimiter?: Exclude<Delimiter, "auto">;
}

/**
 * Array of flat objects -> CSV text (papaparse `unparse`, header row from the
 * union of every row's own keys). A JSON value that isn't an array of
 * objects has no rows to write, so it's a clear, thrown error rather than a
 * best-effort guess — same reasoning as `objectsToSheetData` below. A
 * nested value (object/array) in any cell is JSON-stringified into that
 * cell rather than dropped or flattened, so no data silently disappears; the
 * round-trip back through `csvToJson` sees it as a plain string.
 */
export function jsonToCsv(
  json: unknown,
  options: JsonToCsvOptions = {},
): string {
  const rows = asArrayOfFlatObjects(json);
  return Papa.unparse(rows, {
    delimiter: options.delimiter ?? ",",
  });
}

/** Validates `json` is an array of plain objects and stringifies any nested cell value. */
function asArrayOfFlatObjects(json: unknown): JsonRecord[] {
  if (!Array.isArray(json)) {
    throw new DataConversionError(
      "JSON to CSV/XLSX needs an array of objects — this JSON is not an array",
    );
  }
  return json.map((row, i) => {
    if (typeof row !== "object" || row === null || Array.isArray(row)) {
      throw new DataConversionError(
        `JSON to CSV/XLSX needs an array of objects — row ${i} is not an object`,
      );
    }
    const flat: JsonRecord = {};
    for (const [key, value] of Object.entries(row as JsonRecord)) {
      flat[key] =
        value !== null && typeof value === "object"
          ? JSON.stringify(value)
          : value;
    }
    return flat;
  });
}

/** JSON value -> YAML text, indent 2, key order preserved (object insertion order). */
export function jsonToYaml(json: unknown): string {
  return YAML.stringify(json, { indent: 2 });
}

/** YAML text -> parsed JSON value. */
export function yamlToJson(yaml: string): unknown {
  try {
    return YAML.parse(yaml);
  } catch (e) {
    throw new DataConversionError(
      `yaml parse failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

/** One XLSX cell, the shape `write-excel-file`'s raw `SheetData` grid accepts. */
export interface XlsxCell {
  value: string | number | boolean | Date | null;
  fontWeight?: "bold";
}

/**
 * Array of flat objects -> a raw `SheetData` grid (`XlsxCell[][]`): a bold
 * header row (union of every row's keys, in first-seen order) followed by
 * one data row per object, nested values JSON-stringified same as
 * `jsonToCsv`. Pure — `adapter.ts` hands the result straight to
 * `write-excel-file`'s `SheetData` overload, no per-column type schema
 * needed since every cell already carries a plain JS value.
 */
export function objectsToSheetData(json: unknown): XlsxCell[][] {
  const rows = asArrayOfFlatObjects(json);
  const headers: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!headers.includes(key)) headers.push(key);
    }
  }
  const headerRow: XlsxCell[] = headers.map((h) => ({
    value: h,
    fontWeight: "bold",
  }));
  const dataRows: XlsxCell[][] = rows.map((row) =>
    headers.map((h) => ({ value: toCellValue(row[h]) })),
  );
  return [headerRow, ...dataRows];
}

function toCellValue(value: unknown): XlsxCell["value"] {
  if (value === undefined) return null;
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value instanceof Date
  ) {
    return value;
  }
  return JSON.stringify(value);
}

/**
 * A sheet's raw rows (as `read-excel-file`'s `readSheet` returns them, header
 * row first) -> array of objects keyed by that header row. The inverse of
 * `objectsToSheetData` (minus styling, which only ever applies on write).
 */
export function sheetDataToObjects(
  rows: readonly (readonly unknown[])[],
): JsonRecord[] {
  if (rows.length === 0) return [];
  const [header, ...body] = rows;
  const headers = (header ?? []).map((h) => String(h ?? ""));
  return body.map((row) => {
    const obj: JsonRecord = {};
    headers.forEach((h, i) => {
      obj[h] = row[i] ?? null;
    });
    return obj;
  });
}
