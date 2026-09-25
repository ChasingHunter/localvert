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

async function pageRotations(bytes: ArrayBuffer): Promise<number[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((p) => p.getRotation().angle);
}

/** Builds a real jpg/png image directly with OffscreenCanvas + convertToBlob
 * — same approach as `canvas/adapter.browser.test.ts`'s `sourceImage` — so
 * `images-to-pdf` embeds real, sniffable image bytes rather than a fixture
 * file. */
async function imageBytes(
  width: number,
  height: number,
  type: "image/jpeg" | "image/png",
): Promise<ArrayBuffer> {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context in test setup");
  ctx.fillStyle = "#3366ff";
  ctx.fillRect(0, 0, width, height);
  const blob = await canvas.convertToBlob({ type });
  return blob.arrayBuffer();
}

describe("pdf-lib adapter", () => {
  it("carries the metadata defineEngine validated", () => {
    expect(adapter.id).toBe("pdf-lib");
    expect(adapter.marker).toBe("localvert-engine:pdf-lib");
    expect(adapter.location).toBe("bundled");
  });

  describe("supports", () => {
    it("accepts merge, split, rotate, extract, protect and unlock, pdf to pdf", () => {
      expect(adapter.supports("merge", "pdf", "pdf")).toBe(true);
      expect(adapter.supports("split", "pdf", "pdf")).toBe(true);
      expect(adapter.supports("rotate", "pdf", "pdf")).toBe(true);
      expect(adapter.supports("extract", "pdf", "pdf")).toBe(true);
      expect(adapter.supports("protect", "pdf", "pdf")).toBe(true);
      expect(adapter.supports("unlock", "pdf", "pdf")).toBe(true);
    });

    it("accepts merge from jpg/png, for images-to-pdf", () => {
      expect(adapter.supports("merge", "jpg", "pdf")).toBe(true);
      expect(adapter.supports("merge", "png", "pdf")).toBe(true);
    });

    it("rejects an image format for any op other than merge", () => {
      expect(adapter.supports("rotate", "jpg", "pdf")).toBe(false);
      expect(adapter.supports("split", "png", "pdf")).toBe(false);
    });

    it("rejects a non-pdf, non-image format on the input side", () => {
      expect(adapter.supports("merge", "webp", "pdf")).toBe(false);
    });

    it("rejects a non-pdf format on the output side", () => {
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

  describe("run: rotate", () => {
    it("rotates only the selected pages by the given angle", async () => {
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
          op: "rotate",
          input: bytesInput(doc),
          options: { pages: "2", angle: "90" },
        }),
      );
      if (result.kind !== "bytes") throw new Error("expected bytes result");
      expect(await pageRotations(result.bytes)).toEqual([0, 90, 0]);
    });

    it('rotates every page when "pages" is blank', async () => {
      const instance = await adapter.load({
        baseUrl: "",
        capabilities: {} as never,
      });
      const doc = await buildPdf([
        [100, 100],
        [150, 150],
      ]);

      const result = await instance.run(
        baseTask({
          op: "rotate",
          input: bytesInput(doc),
          options: { pages: "", angle: "180" },
        }),
      );
      if (result.kind !== "bytes") throw new Error("expected bytes result");
      expect(await pageRotations(result.bytes)).toEqual([180, 180]);
    });

    it("adds to a page's existing rotation rather than replacing it", async () => {
      const instance = await adapter.load({
        baseUrl: "",
        capabilities: {} as never,
      });
      const doc = await buildPdf([[100, 100]]);

      const once = await instance.run(
        baseTask({
          op: "rotate",
          input: bytesInput(doc),
          options: { pages: "", angle: "90" },
        }),
      );
      if (once.kind !== "bytes") throw new Error("expected bytes result");

      const twice = await instance.run(
        baseTask({
          op: "rotate",
          input: bytesInput(once.bytes),
          options: { pages: "", angle: "180" },
        }),
      );
      if (twice.kind !== "bytes") throw new Error("expected bytes result");
      expect(await pageRotations(twice.bytes)).toEqual([270]);
    });

    it("accepts a numeric angle too, not only the select's string form", async () => {
      const instance = await adapter.load({
        baseUrl: "",
        capabilities: {} as never,
      });
      const doc = await buildPdf([[100, 100]]);

      const result = await instance.run(
        baseTask({
          op: "rotate",
          input: bytesInput(doc),
          options: { pages: "", angle: 270 },
        }),
      );
      if (result.kind !== "bytes") throw new Error("expected bytes result");
      expect(await pageRotations(result.bytes)).toEqual([270]);
    });
  });

  describe("run: extract", () => {
    it('mode "keep" outputs only the given pages, in the given order', async () => {
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
          op: "extract",
          input: bytesInput(doc),
          options: { mode: "keep", pages: "3, 1" },
        }),
      );
      if (result.kind !== "bytes") throw new Error("expected bytes result");
      expect(await pageSizes(result.bytes)).toEqual([
        [200, 200],
        [100, 100],
      ]);
    });

    it('mode "remove" keeps every other page, in its original order', async () => {
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
          op: "extract",
          input: bytesInput(doc),
          options: { mode: "remove", pages: "2" },
        }),
      );
      if (result.kind !== "bytes") throw new Error("expected bytes result");
      expect(await pageSizes(result.bytes)).toEqual([
        [100, 100],
        [200, 200],
      ]);
    });

    it('throws EngineError("internal") when "remove" would delete every page', async () => {
      const instance = await adapter.load({
        baseUrl: "",
        capabilities: {} as never,
      });
      const doc = await buildPdf([
        [100, 100],
        [150, 150],
      ]);

      await expect(
        instance.run(
          baseTask({
            op: "extract",
            input: bytesInput(doc),
            options: { mode: "remove", pages: "1-2" },
          }),
        ),
      ).rejects.toSatisfy(
        (e: unknown) => isEngineError(e) && e.code === "internal",
      );
    });
  });

  describe("run: merge (images -> pdf)", () => {
    it('pageSize "fit" sizes each page to its own image, 1px = 1pt', async () => {
      const instance = await adapter.load({
        baseUrl: "",
        capabilities: {} as never,
      });
      const jpg = await imageBytes(100, 50, "image/jpeg");
      const png = await imageBytes(60, 80, "image/png");

      const result = await instance.run(
        baseTask({
          op: "merge",
          inputFormat: "jpg",
          input: bytesInput(jpg),
          inputs: [bytesInput(jpg), bytesInput(png)],
          options: { pageSize: "fit" },
        }),
      );
      if (result.kind !== "bytes") throw new Error("expected bytes result");
      expect(await pageSizes(result.bytes)).toEqual([
        [100, 50],
        [60, 80],
      ]);
    });

    it('pageSize "a4" fixes every page to A4, oriented from the image', async () => {
      const instance = await adapter.load({
        baseUrl: "",
        capabilities: {} as never,
      });
      // Wider than tall -> auto-orientation picks landscape.
      const wide = await imageBytes(200, 100, "image/jpeg");
      // Taller than wide -> portrait.
      const tall = await imageBytes(100, 200, "image/png");

      const result = await instance.run(
        baseTask({
          op: "merge",
          inputFormat: "jpg",
          input: bytesInput(wide),
          inputs: [bytesInput(wide), bytesInput(tall)],
          options: { pageSize: "a4", orientation: "auto", margin: 0 },
        }),
      );
      if (result.kind !== "bytes") throw new Error("expected bytes result");
      const sizes = await pageSizes(result.bytes);
      const landscapePage = sizes[0];
      const portraitPage = sizes[1];
      if (!landscapePage || !portraitPage) throw new Error("expected 2 pages");
      expect(landscapePage[0]).toBeGreaterThan(landscapePage[1]);
      expect(portraitPage[1]).toBeGreaterThan(portraitPage[0]);
    });

    it("forces every page to a fixed orientation when asked", async () => {
      const instance = await adapter.load({
        baseUrl: "",
        capabilities: {} as never,
      });
      const wide = await imageBytes(200, 100, "image/jpeg");

      const result = await instance.run(
        baseTask({
          op: "merge",
          inputFormat: "jpg",
          input: bytesInput(wide),
          inputs: [bytesInput(wide)],
          options: { pageSize: "letter", orientation: "portrait", margin: 0 },
        }),
      );
      if (result.kind !== "bytes") throw new Error("expected bytes result");
      const [page] = await pageSizes(result.bytes);
      if (!page) throw new Error("expected 1 page");
      expect(page[1]).toBeGreaterThan(page[0]);
    });

    it("throws EngineError('unsupported') for a non-jpg/png input", async () => {
      const instance = await adapter.load({
        baseUrl: "",
        capabilities: {} as never,
      });
      const garbage = new Uint8Array([1, 2, 3, 4, 5]).buffer;

      await expect(
        instance.run(
          baseTask({
            op: "merge",
            inputFormat: "jpg",
            input: bytesInput(garbage),
            inputs: [bytesInput(garbage)],
            options: { pageSize: "fit" },
          }),
        ),
      ).rejects.toSatisfy(
        (e: unknown) => isEngineError(e) && e.code === "unsupported",
      );
    });
  });

  describe("run: protect", () => {
    it("encrypts the pdf so it can only be reopened with the password", async () => {
      const instance = await adapter.load({
        baseUrl: "",
        capabilities: {} as never,
      });
      const doc = await buildPdf([[100, 100]]);

      const result = await instance.run(
        baseTask({
          op: "protect",
          input: bytesInput(doc),
          options: { password: "secret" },
        }),
      );
      if (result.kind !== "bytes") throw new Error("expected bytes result");

      await expect(PDFDocument.load(result.bytes)).rejects.toThrow();
      const opened = await PDFDocument.load(result.bytes, {
        password: "secret",
      });
      expect(opened.getPageCount()).toBe(1);
    });

    it("throws EngineError('internal') for an empty password", async () => {
      const instance = await adapter.load({
        baseUrl: "",
        capabilities: {} as never,
      });
      const doc = await buildPdf([[100, 100]]);

      await expect(
        instance.run(
          baseTask({
            op: "protect",
            input: bytesInput(doc),
            options: { password: "" },
          }),
        ),
      ).rejects.toSatisfy(
        (e: unknown) => isEngineError(e) && e.code === "internal",
      );
    });

    it("honors allowPrinting/allowCopying without throwing", async () => {
      const instance = await adapter.load({
        baseUrl: "",
        capabilities: {} as never,
      });
      const doc = await buildPdf([[100, 100]]);

      const result = await instance.run(
        baseTask({
          op: "protect",
          input: bytesInput(doc),
          options: {
            password: "secret",
            allowPrinting: false,
            allowCopying: true,
          },
        }),
      );
      if (result.kind !== "bytes") throw new Error("expected bytes result");
      const opened = await PDFDocument.load(result.bytes, {
        password: "secret",
      });
      expect(opened.getPageCount()).toBe(1);
    });
  });

  describe("run: unlock", () => {
    it("removes encryption, returning a plain pdf", async () => {
      const instance = await adapter.load({
        baseUrl: "",
        capabilities: {} as never,
      });
      const encrypted = await buildEncryptedPdf();

      const result = await instance.run(
        baseTask({
          op: "unlock",
          input: bytesInput(encrypted),
          options: { password: "secret" },
        }),
      );
      if (result.kind !== "bytes") throw new Error("expected bytes result");

      // No password needed this time — the output is no longer encrypted.
      const reopened = await PDFDocument.load(result.bytes);
      expect(reopened.isEncrypted).toBe(false);
      expect(reopened.getPageCount()).toBe(1);
    });

    it('throws EngineError("decode-failed", "Wrong password") for a wrong password', async () => {
      const instance = await adapter.load({
        baseUrl: "",
        capabilities: {} as never,
      });
      const encrypted = await buildEncryptedPdf();

      await expect(
        instance.run(
          baseTask({
            op: "unlock",
            input: bytesInput(encrypted),
            options: { password: "nope" },
          }),
        ),
      ).rejects.toSatisfy(
        (e: unknown) =>
          isEngineError(e) &&
          e.code === "decode-failed" &&
          e.message === "Wrong password",
      );
    });

    it("round-trips through protect then unlock", async () => {
      const instance = await adapter.load({
        baseUrl: "",
        capabilities: {} as never,
      });
      const doc = await buildPdf([
        [100, 100],
        [150, 150],
      ]);

      const protectedResult = await instance.run(
        baseTask({
          op: "protect",
          input: bytesInput(doc),
          options: { password: "roundtrip" },
        }),
      );
      if (protectedResult.kind !== "bytes") {
        throw new Error("expected bytes result");
      }

      const unlocked = await instance.run(
        baseTask({
          op: "unlock",
          input: bytesInput(protectedResult.bytes),
          options: { password: "roundtrip" },
        }),
      );
      if (unlocked.kind !== "bytes") throw new Error("expected bytes result");
      expect(await pageSizes(unlocked.bytes)).toEqual([
        [100, 100],
        [150, 150],
      ]);
    });
  });
});
