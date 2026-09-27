import { describe, expect, it } from "vitest";
import type { EngineTask } from "../types";
import adapter from "./adapter";

function baseTask(overrides: Partial<EngineTask> = {}): EngineTask {
  return {
    op: "transcode",
    input: { kind: "bytes", bytes: new ArrayBuffer(0) },
    inputFormat: "json",
    outputFormat: "xlsx",
    options: {},
    signal: new AbortController().signal,
    ...overrides,
  };
}

function encode(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer;
}

describe("data adapter", () => {
  it("carries the metadata defineEngine validated", () => {
    expect(adapter.id).toBe("data");
    expect(adapter.marker).toBe("localvert-engine:data");
    expect(adapter.location).toBe("bundled");
  });

  describe("supports", () => {
    it("accepts every wired transcode pair", () => {
      expect(adapter.supports("transcode", "json", "yaml")).toBe(true);
      expect(adapter.supports("transcode", "yaml", "json")).toBe(true);
      expect(adapter.supports("transcode", "json", "xlsx")).toBe(true);
      expect(adapter.supports("transcode", "xlsx", "json")).toBe(true);
    });

    it("rejects a non-transcode op", () => {
      expect(adapter.supports("decode", "json", "yaml")).toBe(false);
    });

    it("rejects an unwired pair", () => {
      expect(adapter.supports("transcode", "yaml", "xlsx")).toBe(false);
    });
  });

  describe("run", () => {
    it("round-trips a JSON array of objects through xlsx and back", async () => {
      const instance = await adapter.load({
        baseUrl: "",
        capabilities: {} as never,
      });
      const objects = [
        { name: "Ada", age: 36 },
        { name: "Grace", age: 85 },
      ];

      const written = await instance.run(
        baseTask({
          input: { kind: "bytes", bytes: encode(JSON.stringify(objects)) },
          inputFormat: "json",
          outputFormat: "xlsx",
        }),
      );
      if (written.kind !== "bytes") throw new Error("expected bytes result");
      expect(written.mime).toBe(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      // A real xlsx is a ZIP container — see FORMATS.xlsx's magic comment.
      const zipMagic = new Uint8Array(written.bytes).subarray(0, 4);
      expect(Array.from(zipMagic)).toEqual([0x50, 0x4b, 0x03, 0x04]);

      const read = await instance.run(
        baseTask({
          input: { kind: "bytes", bytes: written.bytes },
          inputFormat: "xlsx",
          outputFormat: "json",
          options: { sheet: 1 },
        }),
      );
      if (read.kind !== "bytes") throw new Error("expected bytes result");
      const roundTripped = JSON.parse(new TextDecoder().decode(read.bytes));
      expect(roundTripped).toEqual(objects);
    });

    it("throws a DataConversionError-derived EngineError for non-array JSON to xlsx", async () => {
      const instance = await adapter.load({
        baseUrl: "",
        capabilities: {} as never,
      });

      await expect(
        instance.run(
          baseTask({
            input: { kind: "bytes", bytes: encode(JSON.stringify({ a: 1 })) },
            inputFormat: "json",
            outputFormat: "xlsx",
          }),
        ),
      ).rejects.toThrow(/array of objects/);
    });
  });
});
