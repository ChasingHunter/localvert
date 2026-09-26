import { PDFDocument } from "@cantoo/pdf-lib";
import { describe, expect, it } from "vitest";
import { ENGINE_MANIFEST } from "@/lib/engines/manifest";
import { isEngineError } from "../errors";
import type { EngineInput, EngineTask } from "../types";
import adapter from "./adapter";

// `load()` spins up a real nested tesseract.js worker, compiles ~3 MB of
// wasm (the LSTM core) and loads the ~3 MB English language model, all
// before the first `recognize()` even starts — comfortably past vitest's 5s
// default. Same reasoning as `pdfjs/adapter.browser.test.ts`'s TIMEOUT.
const TIMEOUT = 60_000;

/** The real, `pnpm sync-engines`-populated asset path — proves the adapter
 * loads its worker/core/language files from our own versioned origin, never
 * a CDN. See `pdfjs/adapter.browser.test.ts`'s `baseUrl`. */
function baseUrl(): string {
  return ENGINE_MANIFEST.tesseract.baseUrl;
}

function baseTask(overrides: Partial<EngineTask> = {}): EngineTask {
  return {
    op: "ocr",
    input: { kind: "bytes", bytes: new ArrayBuffer(0) },
    inputFormat: "png",
    outputFormat: "txt",
    options: {},
    signal: new AbortController().signal,
    ...overrides,
  };
}

function bytesInput(bytes: ArrayBuffer): EngineInput {
  return { kind: "bytes", bytes };
}

/**
 * A large, high-contrast line of text rendered with OffscreenCanvas, encoded
 * to PNG — no fixture file, no network, bit-identical across machines. Big
 * bold sans-serif on a plain white background is about as easy a target as
 * real-world OCR gets, which is the point: this test proves the pipeline
 * wires up correctly end to end, not that tesseract's model is accurate.
 */
async function renderTextPng(text: string): Promise<ArrayBuffer> {
  const width = 640;
  const height = 120;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context in test setup");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#000000";
  ctx.font = "bold 48px sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 20, height / 2);

  const blob = await canvas.convertToBlob({ type: "image/png" });
  return blob.arrayBuffer();
}

describe("tesseract adapter", () => {
  it("carries the metadata defineEngine validated", () => {
    expect(adapter.id).toBe("tesseract");
    expect(adapter.marker).toBe("localvert-engine:tesseract");
    expect(adapter.location).toBe("static");
    expect(adapter.needsIsolation).toBe(false);
    expect(adapter.heavy).toBe(true);
  });

  describe("supports", () => {
    it("accepts ocr from an image format to txt or pdf", () => {
      expect(adapter.supports("ocr", "png", "txt")).toBe(true);
      expect(adapter.supports("ocr", "jpg", "pdf")).toBe(true);
      expect(adapter.supports("ocr", "webp", "txt")).toBe(true);
      expect(adapter.supports("ocr", "bmp", "pdf")).toBe(true);
    });

    it("rejects a non-ocr op", () => {
      expect(adapter.supports("decode", "png", "txt")).toBe(false);
    });

    it("rejects a non-image input", () => {
      expect(adapter.supports("ocr", "pdf", "txt")).toBe(false);
    });

    it("rejects an output that isn't txt or pdf", () => {
      expect(adapter.supports("ocr", "png", "png")).toBe(false);
    });
  });

  describe("run", () => {
    it(
      "recognizes large, high-contrast text as plain text",
      async () => {
        const instance = await adapter.load({
          baseUrl: baseUrl(),
          capabilities: {} as never,
        });
        const png = await renderTextPng("LOCALVERT 2026");

        const result = await instance.run(
          baseTask({ input: bytesInput(png), outputFormat: "txt" }),
        );
        if (result.kind !== "bytes") throw new Error("expected bytes result");
        expect(result.mime).toBe("text/plain");

        const text = new TextDecoder().decode(result.bytes).toLowerCase();
        // Allow minor OCR noise (stray punctuation/whitespace) — the
        // engine's job is proven by the substring matching, not exactness.
        expect(text).toContain("localvert");
        expect(text).toContain("2026");
      },
      TIMEOUT,
    );

    it(
      "produces a searchable PDF a real PDF library can open",
      async () => {
        const instance = await adapter.load({
          baseUrl: baseUrl(),
          capabilities: {} as never,
        });
        const png = await renderTextPng("LOCALVERT 2026");

        const result = await instance.run(
          baseTask({ input: bytesInput(png), outputFormat: "pdf" }),
        );
        if (result.kind !== "bytes") throw new Error("expected bytes result");
        expect(result.mime).toBe("application/pdf");

        const header = new TextDecoder().decode(result.bytes.slice(0, 5));
        expect(header).toBe("%PDF-");

        const doc = await PDFDocument.load(result.bytes);
        expect(doc.getPageCount()).toBe(1);
      },
      TIMEOUT,
    );

    it(
      "rejects an unsupported op",
      async () => {
        const instance = await adapter.load({
          baseUrl: baseUrl(),
          capabilities: {} as never,
        });
        const png = await renderTextPng("x");

        await expect(
          instance.run(
            baseTask({
              op: "decode",
              input: bytesInput(png),
            }),
          ),
        ).rejects.toSatisfy(
          (e: unknown) => isEngineError(e) && e.code === "unsupported",
        );
      },
      TIMEOUT,
    );

    it(
      "honours an already-aborted signal",
      async () => {
        const instance = await adapter.load({
          baseUrl: baseUrl(),
          capabilities: {} as never,
        });
        const png = await renderTextPng("x");
        const controller = new AbortController();
        controller.abort();

        await expect(
          instance.run(
            baseTask({ input: bytesInput(png), signal: controller.signal }),
          ),
        ).rejects.toSatisfy(
          (e: unknown) => isEngineError(e) && e.code === "aborted",
        );
      },
      TIMEOUT,
    );

    it(
      "never requests anything off this origin — no CDN, everything from ctx.baseUrl",
      async () => {
        // A resource-timing check, not a full network intercept — same
        // adapter-level cross-check as `pdfjs/adapter.browser.test.ts`'s
        // equivalent, applied here to the nested tesseract worker's own
        // fetches (worker script, wasm core, language data).
        performance.clearResourceTimings();
        const instance = await adapter.load({
          baseUrl: baseUrl(),
          capabilities: {} as never,
        });
        const png = await renderTextPng("LOCALVERT 2026");
        await instance.run(baseTask({ input: bytesInput(png) }));

        const foreign = performance
          .getEntriesByType("resource")
          .map((entry) => entry.name)
          .filter((url) => new URL(url).origin !== location.origin);
        expect(foreign).toEqual([]);
      },
      TIMEOUT,
    );
  });
});
