import { describe, expect, it } from "vitest";
import {
  assertSizeCap,
  csvToJson,
  DataConversionError,
  jsonToCsv,
  jsonToYaml,
  MAX_DATA_INPUT_BYTES,
  objectsToSheetData,
  sheetDataToObjects,
  yamlToJson,
} from "./transforms";

describe("csvToJson", () => {
  it("parses a header row into an array of objects", () => {
    expect(csvToJson("name,age\nAda,36\nGrace,85")).toEqual([
      { name: "Ada", age: 36 },
      { name: "Grace", age: 85 },
    ]);
  });

  it("dynamicTyping detects numbers and booleans by default", () => {
    expect(csvToJson("n,ok\n42,true")).toEqual([{ n: 42, ok: true }]);
  });

  it("dynamicTyping: false keeps every value a string", () => {
    expect(csvToJson("n,ok\n42,true", { dynamicTyping: false })).toEqual([
      { n: "42", ok: "true" },
    ]);
  });

  it("delimiter: auto detects semicolon-separated input", () => {
    expect(csvToJson("name;age\nAda;36")).toEqual([{ name: "Ada", age: 36 }]);
  });

  it("an explicit delimiter overrides auto-detection", () => {
    expect(csvToJson("name\tage\nAda\t36", { delimiter: "\t" })).toEqual([
      { name: "Ada", age: 36 },
    ]);
  });
});

describe("jsonToCsv", () => {
  it("writes a header row from the union of every row's keys", () => {
    expect(jsonToCsv([{ a: 1, b: 2 }])).toBe("a,b\r\n1,2");
  });

  it("JSON-stringifies a nested value into its own cell", () => {
    const csv = jsonToCsv([{ id: 1, tags: ["x", "y"] }]);
    expect(csv).toBe('id,tags\r\n1,"[""x"",""y""]"');
  });

  it("throws a clear error for non-array JSON", () => {
    expect(() => jsonToCsv({ a: 1 })).toThrow(DataConversionError);
    expect(() => jsonToCsv({ a: 1 })).toThrow(/array of objects/);
  });

  it("throws a clear error for an array of non-objects", () => {
    expect(() => jsonToCsv([1, 2, 3])).toThrow(/Row 0 isn.t an object/);
  });

  it("respects an explicit delimiter", () => {
    expect(jsonToCsv([{ a: 1, b: 2 }], { delimiter: ";" })).toBe("a;b\r\n1;2");
  });
});

describe("csv <-> json round-trip", () => {
  it("survives csv -> json -> csv", () => {
    const csv = "name,age\r\nAda,36\r\nGrace,85";
    expect(jsonToCsv(csvToJson(csv))).toBe(csv);
  });
});

describe("json <-> yaml", () => {
  it("stringifies with 2-space indent", () => {
    expect(jsonToYaml({ a: { b: 1 } })).toBe("a:\n  b: 1\n");
  });

  it("preserves key order", () => {
    const yaml = jsonToYaml({ z: 1, a: 2, m: 3 });
    expect(yaml.indexOf("z:")).toBeLessThan(yaml.indexOf("a:"));
    expect(yaml.indexOf("a:")).toBeLessThan(yaml.indexOf("m:"));
  });

  it("parses yaml back to the equivalent value", () => {
    expect(yamlToJson("a:\n  b: 1\n")).toEqual({ a: { b: 1 } });
  });

  it("throws a DataConversionError for invalid yaml", () => {
    expect(() => yamlToJson("a: [unterminated")).toThrow(DataConversionError);
  });

  it("survives json -> yaml -> json", () => {
    const value = { name: "Ada", tags: ["x", "y"], nested: { n: 1 } };
    expect(yamlToJson(jsonToYaml(value))).toEqual(value);
  });
});

describe("objectsToSheetData", () => {
  it("builds a bold header row followed by data rows", () => {
    expect(objectsToSheetData([{ a: 1, b: "x" }])).toEqual([
      [
        { value: "a", fontWeight: "bold" },
        { value: "b", fontWeight: "bold" },
      ],
      [{ value: 1 }, { value: "x" }],
    ]);
  });

  it("unions keys across rows in first-seen order", () => {
    const sheet = objectsToSheetData([{ a: 1 }, { b: 2, a: 3 }]);
    expect(sheet[0]).toEqual([
      { value: "a", fontWeight: "bold" },
      { value: "b", fontWeight: "bold" },
    ]);
    // Row 1 has no "b" — backfilled with null, not omitted (keeps every
    // row's cells aligned with the shared header).
    expect(sheet[1]).toEqual([{ value: 1 }, { value: null }]);
  });

  it("JSON-stringifies nested values", () => {
    const sheet = objectsToSheetData([{ tags: ["x", "y"] }]);
    expect(sheet[1]).toEqual([{ value: '["x","y"]' }]);
  });

  it("throws for non-array JSON", () => {
    expect(() => objectsToSheetData({ a: 1 })).toThrow(DataConversionError);
  });
});

describe("sheetDataToObjects", () => {
  it("keys each row by the header row", () => {
    expect(
      sheetDataToObjects([
        ["name", "age"],
        ["Ada", 36],
      ]),
    ).toEqual([{ name: "Ada", age: 36 }]);
  });

  it("backfills a short row with null", () => {
    expect(sheetDataToObjects([["a", "b"], ["x"]])).toEqual([
      { a: "x", b: null },
    ]);
  });

  it("returns an empty array for an empty sheet", () => {
    expect(sheetDataToObjects([])).toEqual([]);
  });

  it("round-trips through objectsToSheetData's plain values", () => {
    const objects = [{ a: 1, b: "x" }];
    const rows = objectsToSheetData(objects).map((row) =>
      row.map((cell) => cell.value),
    );
    expect(sheetDataToObjects(rows)).toEqual(objects);
  });
});

describe("assertSizeCap", () => {
  it("allows input at or under the cap", () => {
    expect(() => assertSizeCap(MAX_DATA_INPUT_BYTES)).not.toThrow();
  });

  it("throws a clear error over the 100 MB cap", () => {
    expect(() => assertSizeCap(MAX_DATA_INPUT_BYTES + 1)).toThrow(
      /100 MB limit/,
    );
  });
});
