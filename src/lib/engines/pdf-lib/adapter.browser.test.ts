import { PDFDocument } from "@cantoo/pdf-lib";
import { describe, expect, it } from "vitest";
import { isEngineError } from "../errors";
import type { EngineInput, EngineTask } from "../types";
import adapter from "./adapter";

function baseTask(overrides: Partial<EngineTask> = {}): EngineTask {
  return {
    op: "merge",
    input: { kind: "bytes", bytes: new ArrayBuffer(0) },
    inputFormat: "pdf",
    outputFormat: "pdf",
    options: {},
    signal: new AbortController().signal,
    ...overrides,
  };
}

/** Builds a PDF with one page per `[width, height]` in `sizes` — distinct
 * sizes make page order/count easy to assert on exactly without needing
 * text extraction (which pdf-lib itself doesn't support reading back). */
async function buildPdf(sizes: [number, number][]): Promise<ArrayBuffer> {
  const doc = await PDFDocument.create();
  for (const [width, height] of sizes) {
    doc.addPage([width, height]);
  }
  const bytes = await doc.save();
  return bytes.slice().buffer;
}

async function buildEncryptedPdf(): Promise<ArrayBuffer> {
  const doc = await PDFDocument.create();
  doc.addPage([100, 100]);
  doc.encrypt({ userPassword: "secret" });
  const bytes = await doc.save();
  return bytes.slice().buffer;
}

function bytesInput(bytes: ArrayBuffer): EngineInput {
  return { kind: "bytes", bytes };
}

function blobInput(bytes: ArrayBuffer, name: string): EngineInput {
  return {
    kind: "blob",
    blob: new File([bytes], name, { type: "application/pdf" }),
  };
}

async function pageSizes(bytes: ArrayBuffer): Promise<[number, number][]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((p) => {
    const { width, height } = p.getSize();
    return [width, height];
  });
}

describe("pdf-lib adapter", () => {
  it("carries the metadata defineEngine validated", () => {
    expect(adapter.id).toBe("pdf-lib");
    expect(adapter.marker).toBe("localvert-engine:pdf-lib");
    expect(adapter.location).toBe("bundled");
  });

  describe("supports", () => {
    it("accepts merge and split, pdf to pdf", () => {
      expect(adapter.supports("merge", "pdf", "pdf")).toBe(true);
      expect(adapter.supports("split", "pdf", "pdf")).toBe(true);
    });

    it("rejects a non-pdf format on either side", () => {
      expect(adapter.supports("merge", "png", "pdf")).toBe(false);
      expect(adapter.supports("split", "pdf", "png")).toBe(false);
    });

    it("rejects an unrelated op", () => {
      expect(adapter.supports("decode", "pdf", "pdf")).toBe(false);
    });
  });

  describe("run: merge", () => {
    it("copies every input's pages, in the user's own order", async () => {
      const instance = await adapter.load({
        baseUrl: "",
        capabilities: {} as never,
      });
      const a = await buildPdf([
        [100, 100],
        [100, 100],
      ]);
      const b = await buildPdf([[300, 300]]);

      const result = await instance.run(
        baseTask({
          input: bytesInput(a),
          inputs: [bytesInput(a), bytesInput(b)],
        }),
      );
      if (result.kind !== "bytes") throw new Error("expected bytes result");
      expect(result.mime).toBe("application/pdf");

      const sizes = await pageSizes(result.bytes);
      expect(sizes).toEqual([
        [100, 100],
        [100, 100],
        [300, 300],
      ]);
    });

    it("respects reversed input order", async () => {
      const instance = await adapter.load({
        baseUrl: "",
        capabilities: {} as never,
      });
      const a = await buildPdf([[100, 100]]);
      const b = await buildPdf([[300, 300]]);

      const result = await instance.run(
        baseTask({
          input: bytesInput(b),
          inputs: [bytesInput(b), bytesInput(a)],
        }),
      );
      if (result.kind !== "bytes") throw new Error("expected bytes result");

      const sizes = await pageSizes(result.bytes);
      expect(sizes).toEqual([
        [300, 300],
        [100, 100],
      ]);
    });

    it("throws EngineError('unsupported') for a password-protected PDF", async () => {
      const instance = await adapter.load({
        baseUrl: "",
        capabilities: {} as never,
      });
      const encrypted = await buildEncryptedPdf();
      const plain = await buildPdf([[100, 100]]);

      await expect(
        instance.run(
          baseTask({
            input: bytesInput(encrypted),
            inputs: [bytesInput(encrypted), bytesInput(plain)],
          }),
        ),
      ).rejects.toSatisfy(
        (e: unknown) => isEngineError(e) && e.code === "unsupported",
      );
    });

    it("throws EngineError('decode-failed') on garbage bytes", async () => {
      const instance = await adapter.load({
        baseUrl: "",
        capabilities: {} as never,
      });
      const garbage = new Uint8Array([1, 2, 3, 4, 5]).buffer;

      await expect(
        instance.run(
          baseTask({
            input: bytesInput(garbage),
            inputs: [bytesInput(garbage)],
          }),
        ),
      ).rejects.toSatisfy(
        (e: unknown) => isEngineError(e) && e.code === "decode-failed",
      );
    });

    it("throws EngineError('aborted') when the signal is already aborted", async () => {
      const instance = await adapter.load({
        baseUrl: "",
        capabilities: {} as never,
      });
      const a = await buildPdf([[100, 100]]);
      const controller = new AbortController();
      controller.abort();

      await expect(
        instance.run(
          baseTask({
            input: bytesInput(a),
            inputs: [bytesInput(a)],
            signal: controller.signal,
          }),
        ),
      ).rejects.toSatisfy(
        (e: unknown) => isEngineError(e) && e.code === "aborted",
      );
    });
  });

  describe("run: split", () => {
    it('mode "each" produces one file per page, named from the input filename', async () => {
      const instance = await adapter.load({
        baseUrl: "",
        capabilities: {} as never,
      });
      const doc = await buildPdf([
        [100, 100],
        [150, 150],
        [200, 200],
      ]);

      const result = await instance.run(
        baseTask({
          op: "split",
          input: blobInput(doc, "doc.pdf"),
          options: { mode: "each" },
        }),
      );
      if (result.kind !== "files") throw new Error("expected files result");

      expect(result.files.map((f) => f.name)).toEqual([
        "doc-page-1.pdf",
        "doc-page-2.pdf",
        "doc-page-3.pdf",
      ]);
      for (const [i, expected] of [
        [100, 100],
        [150, 150],
        [200, 200],
      ].entries()) {
        const file = result.files[i];
        if (!file) throw new Error(`expected file ${i}`);
        const sizes = await pageSizes(file.bytes);
        expect(sizes).toEqual([expected]);
        expect(file.mime).toBe("application/pdf");
      }
    });

    it('mode "ranges" produces one file per semicolon-separated range', async () => {
      const instance = await adapter.load({
        baseUrl: "",
        capabilities: {} as never,
      });
      const doc = await buildPdf([
        [100, 100],
        [150, 150],
        [200, 200],
      ]);

      const result = await instance.run(
        baseTask({
          op: "split",
          input: blobInput(doc, "doc.pdf"),
          options: { mode: "ranges", ranges: "1-2; 3" },
        }),
      );
      if (result.kind !== "files") throw new Error("expected files result");

      expect(result.files.map((f) => f.name)).toEqual([
        "doc-part-1.pdf",
        "doc-part-2.pdf",
      ]);
      const part1 = result.files[0];
      const part2 = result.files[1];
      if (!part1 || !part2) throw new Error("expected two parts");
      expect(await pageSizes(part1.bytes)).toEqual([
        [100, 100],
        [150, 150],
      ]);
      expect(await pageSizes(part2.bytes)).toEqual([[200, 200]]);
    });

    it("falls back to a generic base name for a non-blob input", async () => {
      const instance = await adapter.load({
        baseUrl: "",
        capabilities: {} as never,
      });
      const doc = await buildPdf([[100, 100]]);

      const result = await instance.run(
        baseTask({
          op: "split",
          input: bytesInput(doc),
          options: { mode: "each" },
        }),
      );
      if (result.kind !== "files") throw new Error("expected files result");
      expect(result.files.map((f) => f.name)).toEqual(["document-page-1.pdf"]);
    });

    it("throws EngineError('unsupported') for a password-protected PDF", async () => {
      const instance = await adapter.load({
        baseUrl: "",
        capabilities: {} as never,
      });
      const encrypted = await buildEncryptedPdf();

      await expect(
        instance.run(
          baseTask({
            op: "split",
            input: bytesInput(encrypted),
            options: { mode: "each" },
          }),
        ),
      ).rejects.toSatisfy(
        (e: unknown) => isEngineError(e) && e.code === "unsupported",
      );
    });
  });
});
