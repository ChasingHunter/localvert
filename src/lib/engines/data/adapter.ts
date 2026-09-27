import type { Operation, StepFormat } from "@/lib/registry";
import { defineEngine } from "../define-engine";
import { EngineError, toEngineError } from "../errors";
import { ENGINE_MANIFEST } from "../manifest";
import type {
  EngineAdapter,
  EngineInput,
  EngineInstance,
  EngineLoadContext,
  EngineResult,
  EngineTask,
} from "../types";
import meta from "./engine.json";
import {
  assertSizeCap,
  csvToJson,
  type Delimiter,
  jsonToCsv,
  jsonToYaml,
  objectsToSheetData,
  sheetDataToObjects,
  yamlToJson,
} from "./transforms";

/** See the doc comment on the same cast in `../psd/adapter.ts`. */
const metadata = {
  ...(meta as Pick<
    EngineAdapter,
    "id" | "license" | "location" | "needsIsolation" | "heavy"
  >),
  // engine.json tracks the papaparse package's version (`versionFrom`) as
  // this engine's own — the closest single source of truth `gen-registry.ts`
  // supports (`versionFrom` is exactly one string; see docs/ENGINES.md for
  // why a four-library bundled engine can't declare one per library). The
  // other three libraries' versions are pinned in package.json and recorded
  // by hand in docs/ENGINES.md and docs/THIRD_PARTY_LICENSES.md instead.
  version: ENGINE_MANIFEST.data.version,
} satisfies Pick<
  EngineAdapter,
  "id" | "version" | "license" | "location" | "needsIsolation" | "heavy"
>;

/** The `transcode` pairs this engine actually wires a tool to (ADR/brief note below). */
const TRANSCODE_PAIRS: readonly [StepFormat, StepFormat][] = [
  ["json", "yaml"],
  ["yaml", "json"],
  ["json", "xlsx"],
  ["xlsx", "json"],
  ["csv", "json"],
  ["json", "csv"],
  ["csv", "xlsx"],
  ["xlsx", "csv"],
];

function supports(
  op: Operation,
  input: StepFormat,
  output: StepFormat,
): boolean {
  if (op !== "transcode") return false;
  return TRANSCODE_PAIRS.some(([i, o]) => i === input && o === output);
}

/**
 * Every library this engine wraps (papaparse, yaml, read-excel-file,
 * write-excel-file) is pure JS with no wasm of its own — "bundled" (ADR
 * shape shared with mediabunny/pdf-lib/psd/utif), nothing for `load` to
 * fetch or initialise ahead of time.
 */
async function load(_ctx: EngineLoadContext): Promise<EngineInstance> {
  return { run, dispose };
}

async function inputToText(input: EngineInput): Promise<string> {
  switch (input.kind) {
    case "blob": {
      assertSizeCap(input.blob.size);
      return input.blob.text();
    }
    case "bytes":
      assertSizeCap(input.bytes.byteLength);
      return new TextDecoder().decode(input.bytes);
    case "opfs":
      throw new EngineError(
        "unsupported",
        "data engine does not read OPFS inputs",
        { engine: metadata.id },
      );
    case "raster":
      throw new EngineError(
        "internal",
        "data engine expected a blob/bytes input, got a raster",
        { engine: metadata.id },
      );
  }
}

async function inputToArrayBuffer(input: EngineInput): Promise<ArrayBuffer> {
  switch (input.kind) {
    case "blob":
      assertSizeCap(input.blob.size);
      return input.blob.arrayBuffer();
    case "bytes":
      assertSizeCap(input.bytes.byteLength);
      return input.bytes;
    case "opfs":
      throw new EngineError(
        "unsupported",
        "data engine does not read OPFS inputs",
        { engine: metadata.id },
      );
    case "raster":
      throw new EngineError(
        "internal",
        "data engine expected a blob/bytes input, got a raster",
        { engine: metadata.id },
      );
  }
}

function textResult(text: string, mime: string): EngineResult {
  return { kind: "bytes", bytes: new TextEncoder().encode(text).buffer, mime };
}

/**
 * Dispatches by input/output format pair. Mirrors every other adapter's
 * `run`: each stage normalizes its own thrown errors, and this boundary
 * catches anything that escapes anyway so a raw library exception still
 * comes out as an `EngineError`.
 */
async function run(task: EngineTask): Promise<EngineResult> {
  try {
    const { inputFormat, outputFormat } = task;
    if (inputFormat === "json" && outputFormat === "yaml") {
      return await runJsonToYaml(task);
    }
    if (inputFormat === "yaml" && outputFormat === "json") {
      return await runYamlToJson(task);
    }
    if (inputFormat === "json" && outputFormat === "xlsx") {
      return await runJsonToXlsx(task);
    }
    if (inputFormat === "xlsx" && outputFormat === "json") {
      return await runXlsxToJson(task);
    }
    if (inputFormat === "csv" && outputFormat === "json") {
      return await runCsvToJson(task);
    }
    if (inputFormat === "json" && outputFormat === "csv") {
      return await runJsonToCsv(task);
    }
    if (inputFormat === "csv" && outputFormat === "xlsx") {
      return await runCsvToXlsx(task);
    }
    if (inputFormat === "xlsx" && outputFormat === "csv") {
      return await runXlsxToCsv(task);
    }
    throw new EngineError(
      "unsupported",
      `data engine cannot run "${task.op}" (${inputFormat} -> ${outputFormat})`,
      { engine: metadata.id },
    );
  } catch (e) {
    throw toEngineError(e, metadata.id);
  }
}

async function runJsonToYaml(task: EngineTask): Promise<EngineResult> {
  const { input, signal, onProgress } = task;
  signal.throwIfAborted();
  const text = await inputToText(input);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new EngineError("decode-failed", "failed to parse JSON", {
      engine: metadata.id,
      cause: e,
    });
  }
  onProgress?.(0.5);
  const yaml = jsonToYaml(parsed);
  onProgress?.(1);
  return textResult(yaml, "application/yaml");
}

async function runYamlToJson(task: EngineTask): Promise<EngineResult> {
  const { input, signal, onProgress } = task;
  signal.throwIfAborted();
  const text = await inputToText(input);
  onProgress?.(0.5);
  const parsed = yamlToJson(text);
  const json = JSON.stringify(parsed, null, 2);
  onProgress?.(1);
  return textResult(json, "application/json");
}

/**
 * Array of flat objects -> a real xlsx `Blob`, one sheet named "Sheet1".
 * Shared by `runJsonToXlsx` and `runCsvToXlsx` — both just differ in how
 * they get to a `JsonRecord[]` in the first place.
 *
 * Dynamic import, never at module top level — see invariant 3 (no engine in
 * the core bundle) and every other adapter's own dynamic `import()`.
 * `write-excel-file/browser` is the entry point that never touches
 * `document` (see the on-disk source of `writeXlsxFileBrowser.js`: only its
 * `toFile()` helper does, via `downloadBlob`, which this never calls), so
 * it's safe to run inside a worker with no DOM.
 */
async function writeXlsxBlob(
  sheetData: ReturnType<typeof objectsToSheetData>,
): Promise<ArrayBuffer> {
  const excel = await import("write-excel-file/browser");
  const writeXlsxFile: (
    data: import("write-excel-file/browser").SheetData,
    options: { sheet: string },
  ) => { toBlob(): Promise<Blob> } = excel.default;
  const blob = await writeXlsxFile(
    sheetData as import("write-excel-file/browser").SheetData,
    { sheet: "Sheet1" },
  ).toBlob();
  return blob.arrayBuffer();
}

/**
 * A real xlsx `ArrayBuffer` -> one sheet's raw rows (header row first).
 * Shared by `runXlsxToJson` and `runXlsxToCsv`.
 *
 * Dynamic import — see `writeXlsxBlob`'s doc comment. The `/web-worker`
 * entry (vs. `/browser`) is what actually matters here:
 * `readXlsxFileWebWorker.js` spawns its own nested `Worker` (via the
 * `worker-f` package) instead of the browser entry's main-thread-only path,
 * so it works from inside the engine's own worker.
 */
async function readXlsxRows(
  buffer: ArrayBuffer,
  sheet: number,
): Promise<readonly (readonly unknown[])[]> {
  const { readSheet } = await import("read-excel-file/web-worker");
  try {
    return (await readSheet(
      buffer,
      sheet,
    )) as unknown as (readonly unknown[])[];
  } catch (e) {
    throw new EngineError("decode-failed", "failed to read xlsx", {
      engine: metadata.id,
      cause: e,
    });
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new EngineError("decode-failed", "failed to parse JSON", {
      engine: metadata.id,
      cause: e,
    });
  }
}

/** `options.sheet` (1-based), defaulting to 1 for anything else — same rule `xlsx-to-json`/`xlsx-to-csv` both use. */
function sheetOption(options: EngineTask["options"]): number {
  return typeof options.sheet === "number" && options.sheet > 0
    ? options.sheet
    : 1;
}

/**
 * `options.delimiter` -> the real delimiter character `csvToJson` expects.
 * The tool-facing option value is a word (`"comma"`/`"semicolon"`/`"tab"`),
 * not the literal character — see `csvInputOptions`' doc comment in
 * `src/tools/_shared-options.ts` for why. Anything else, including the
 * default `"auto"`, passes straight through for papaparse to sniff itself.
 */
function delimiterOption(options: EngineTask["options"]): Delimiter {
  switch (options.delimiter) {
    case "comma":
      return ",";
    case "semicolon":
      return ";";
    case "tab":
      return "\t";
    default:
      return "auto";
  }
}

/** `options.dynamicTyping` ("Detect numbers and booleans"), defaulting to on. */
function dynamicTypingOption(options: EngineTask["options"]): boolean {
  return options.dynamicTyping !== false;
}

async function runJsonToXlsx(task: EngineTask): Promise<EngineResult> {
  const { input, signal, onProgress } = task;
  signal.throwIfAborted();
  const parsed = parseJson(await inputToText(input));
  const sheetData = objectsToSheetData(parsed);
  onProgress?.(0.4);
  const bytes = await writeXlsxBlob(sheetData);
  onProgress?.(1);
  return {
    kind: "bytes",
    bytes,
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
}

async function runXlsxToJson(task: EngineTask): Promise<EngineResult> {
  const { input, options, signal, onProgress } = task;
  signal.throwIfAborted();
  const buffer = await inputToArrayBuffer(input);
  onProgress?.(0.2);
  const rows = await readXlsxRows(buffer, sheetOption(options));
  onProgress?.(0.7);
  const objects = sheetDataToObjects(rows);
  const json = JSON.stringify(objects, null, 2);
  onProgress?.(1);
  return textResult(json, "application/json");
}

async function runCsvToJson(task: EngineTask): Promise<EngineResult> {
  const { input, options, signal, onProgress } = task;
  signal.throwIfAborted();
  const text = await inputToText(input);
  const objects = csvToJson(text, {
    delimiter: delimiterOption(options),
    dynamicTyping: dynamicTypingOption(options),
  });
  onProgress?.(0.7);
  const json = JSON.stringify(objects, null, 2);
  onProgress?.(1);
  return textResult(json, "application/json");
}

async function runJsonToCsv(task: EngineTask): Promise<EngineResult> {
  const { input, signal, onProgress } = task;
  signal.throwIfAborted();
  const parsed = parseJson(await inputToText(input));
  onProgress?.(0.5);
  const csv = jsonToCsv(parsed);
  onProgress?.(1);
  return textResult(csv, "text/csv");
}

async function runCsvToXlsx(task: EngineTask): Promise<EngineResult> {
  const { input, options, signal, onProgress } = task;
  signal.throwIfAborted();
  const text = await inputToText(input);
  const objects = csvToJson(text, {
    delimiter: delimiterOption(options),
    dynamicTyping: dynamicTypingOption(options),
  });
  const sheetData = objectsToSheetData(objects);
  onProgress?.(0.5);
  const bytes = await writeXlsxBlob(sheetData);
  onProgress?.(1);
  return {
    kind: "bytes",
    bytes,
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
}

async function runXlsxToCsv(task: EngineTask): Promise<EngineResult> {
  const { input, options, signal, onProgress } = task;
  signal.throwIfAborted();
  const buffer = await inputToArrayBuffer(input);
  onProgress?.(0.2);
  const rows = await readXlsxRows(buffer, sheetOption(options));
  onProgress?.(0.7);
  const objects = sheetDataToObjects(rows);
  const csv = jsonToCsv(objects);
  onProgress?.(1);
  return textResult(csv, "text/csv");
}

function dispose(): void {
  // No engine-owned resources (no wasm heap, no worker of our own — see
  // `load`'s doc comment) to release.
}

export default defineEngine({
  ...metadata,
  // Checked by check-sizes.ts against built chunks — must be a string
  // literal (see EngineMarker's doc comment in ../types.ts), never computed.
  marker: "localvert-engine:data",
  supports,
  load,
});
