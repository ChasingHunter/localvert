import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { isEngineError } from "../errors";
import type { LayoutDocument } from "../shared/pdf-layout";
import type { EngineInput, EngineTask } from "../types";
import adapter from "./adapter";

/** No DOM/wasm involved (unlike `pdfjs`'s own adapter) — `TextDecoder`/
 * `fflate` both run fine under plain Node, so this is a regular (non
 * `.browser.`) test, same as `epub/adapter`'s own test would be. */

function baseTask(overrides: Partial<EngineTask> = {}): EngineTask {
  return {
    op: "transcode",
    input: { kind: "bytes", bytes: new ArrayBuffer(0) },
    inputFormat: "json",
    outputFormat: "docx",
    options: {},
    signal: new AbortController().signal,
    ...overrides,
  };
}

function layoutInput(doc: LayoutDocument): EngineInput {
  const json = JSON.stringify(doc);
  return { kind: "bytes", bytes: new TextEncoder().encode(json).buffer };
}

function onePage(): LayoutDocument["pages"][number] {
  return {
    paragraphs: [
      {
        runs: [
          { text: "Hello, world.", bold: false, italic: false, sizePt: 11 },
        ],
        heading: 0,
      },
    ],
  };
}

const SAMPLE_LAYOUT: LayoutDocument = { pages: [onePage()] };

describe("docx adapter", () => {
  it("carries the metadata defineEngine validated", () => {
    expect(adapter.id).toBe("docx");
    expect(adapter.marker).toBe("localvert-engine:docx");
    expect(adapter.location).toBe("bundled");
    expect(adapter.needsIsolation).toBe(false);
    expect(adapter.heavy).toBe(false);
  });

  describe("supports", () => {
    it("accepts transcode from json to docx", () => {
      expect(adapter.supports("transcode", "json", "docx")).toBe(true);
    });

    it("rejects a non-transcode op", () => {
      expect(adapter.supports("extractText", "json", "docx")).toBe(false);
    });

    it("rejects a non-json input", () => {
      expect(adapter.supports("transcode", "txt", "docx")).toBe(false);
    });

    it("rejects a non-docx output", () => {
      expect(adapter.supports("transcode", "json", "html")).toBe(false);
    });
  });

  describe("run", () => {
    it("writes a real docx (zip) from layout JSON", async () => {
      const instance = await adapter.load({
        baseUrl: "",
        capabilities: {} as never,
      });
      const result = await instance.run(
        baseTask({ input: layoutInput(SAMPLE_LAYOUT) }),
      );
      if (result.kind !== "bytes") throw new Error("expected bytes result");
      expect(result.mime).toBe(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      );
      const bytes = new Uint8Array(result.bytes);
      expect(bytes[0]).toBe(0x50);
      expect(bytes[1]).toBe(0x4b);

      const files = unzipSync(bytes);
      expect(Object.keys(files)).toContain("word/document.xml");
    });

    it("defaults pageBreaks to true when the option is unset", async () => {
      const instance = await adapter.load({
        baseUrl: "",
        capabilities: {} as never,
      });
      const twoPages: LayoutDocument = {
        pages: [onePage(), onePage()],
      };
      const result = await instance.run(
        baseTask({ input: layoutInput(twoPages), options: {} }),
      );
      if (result.kind !== "bytes") throw new Error("expected bytes result");
      const files = unzipSync(new Uint8Array(result.bytes));
      const documentXml = new TextDecoder().decode(files["word/document.xml"]);
      expect(documentXml).toContain('w:type="page"');
    });

    it("honours pageBreaks: false", async () => {
      const instance = await adapter.load({
        baseUrl: "",
        capabilities: {} as never,
      });
      const twoPages: LayoutDocument = {
        pages: [onePage(), onePage()],
      };
      const result = await instance.run(
        baseTask({
          input: layoutInput(twoPages),
          options: { pageBreaks: false },
        }),
      );
      if (result.kind !== "bytes") throw new Error("expected bytes result");
      const files = unzipSync(new Uint8Array(result.bytes));
      const documentXml = new TextDecoder().decode(files["word/document.xml"]);
      expect(documentXml).not.toContain('w:type="page"');
    });

    it("throws EngineError('decode-failed') for invalid layout JSON", async () => {
      const instance = await adapter.load({
        baseUrl: "",
        capabilities: {} as never,
      });
      await expect(
        instance.run(
          baseTask({
            input: {
              kind: "bytes",
              bytes: new TextEncoder().encode("not json").buffer,
            },
          }),
        ),
      ).rejects.toSatisfy(
        (e: unknown) => isEngineError(e) && e.code === "decode-failed",
      );
    });

    it("throws EngineError('unsupported') for a non-transcode op", async () => {
      const instance = await adapter.load({
        baseUrl: "",
        capabilities: {} as never,
      });
      await expect(
        instance.run(
          baseTask({ op: "extractText", input: layoutInput(SAMPLE_LAYOUT) }),
        ),
      ).rejects.toSatisfy(
        (e: unknown) => isEngineError(e) && e.code === "unsupported",
      );
    });

    it("throws EngineError('aborted') when the signal is already aborted", async () => {
      const instance = await adapter.load({
        baseUrl: "",
        capabilities: {} as never,
      });
      const controller = new AbortController();
      controller.abort();
      await expect(
        instance.run(
          baseTask({
            input: layoutInput(SAMPLE_LAYOUT),
            signal: controller.signal,
          }),
        ),
      ).rejects.toSatisfy(
        (e: unknown) => isEngineError(e) && e.code === "aborted",
      );
    });
  });
});
