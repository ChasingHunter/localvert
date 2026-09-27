import {
  decodePDFRawStream,
  degrees,
  PDFArray,
  PDFDocument,
  PDFRawStream,
} from "@cantoo/pdf-lib";
import { describe, expect, it } from "vitest";
import type { EngineInput, EngineTask } from "../types";
import adapter, { parseReplacePageImages } from "./adapter";

function baseTask(overrides: Partial<EngineTask> = {}): EngineTask {
  return {
    op: "watermark",
    input: { kind: "bytes", bytes: new ArrayBuffer(0) },
    inputFormat: "pdf",
    outputFormat: "pdf",
    options: {},
    signal: new AbortController().signal,
    ...overrides,
  };
}

/** Builds a PDF with one page per `[width, height]` in `sizes` -- mirrors
 * `adapter.browser.test.ts`'s own `buildPdf`, duplicated here rather than
 * imported since this file is deliberately Node-only (no `OffscreenCanvas`)
 * and the browser file pulls in image-decoding helpers this one doesn't
 * need. */
async function buildPdf(sizes: [number, number][]): Promise<ArrayBuffer> {
  const doc = await PDFDocument.create();
  for (const [width, height] of sizes) {
    doc.addPage([width, height]);
  }
  const bytes = await doc.save();
  return bytes.slice().buffer;
}

function bytesInput(bytes: ArrayBuffer): EngineInput {
  return { kind: "bytes", bytes };
}

/**
 * The decoded content-stream bytes of one page, as a latin1 string -- good
 * enough to search for the hex-encoded `Tj` run `drawText` produces without
 * needing a real PDF content-stream parser. `Contents()` comes back as a
 * `PDFRawStream` (a single stream) or a `PDFArray` of them once the
 * document has been through a save/reload round trip (which every test
 * below does, same as `adapter.browser.test.ts`'s helpers) --
 * `decodePDFRawStream` is the same generic Filter-aware decoder the
 * adapter's own `compressImageStream` already uses, applied here to a
 * content stream instead of an image one.
 */
function pageContentText(doc: PDFDocument, pageIndex: number): string {
  const page = doc.getPage(pageIndex);
  const contents = page.node.Contents();
  const streams: PDFRawStream[] = [];
  if (contents instanceof PDFArray) {
    for (let i = 0; i < contents.size(); i++) {
      streams.push(contents.lookup(i, PDFRawStream));
    }
  } else if (contents instanceof PDFRawStream) {
    streams.push(contents);
  }
  return streams
    .map((s) => Buffer.from(decodePDFRawStream(s).decode()).toString("latin1"))
    .join("\n");
}

/** The hex-encoded `Tj` run Helvetica/WinAnsi produces for a plain-ASCII
 * string -- WinAnsi maps every printable ASCII character to its own
 * character code, so this is just each character's own code point in
 * uppercase hex, exactly like `StandardFontEmbedder.encodeText` (see that
 * class's own doc comment for the uppercase-hex convention). */
function asciiHex(text: string): string {
  return Array.from(text)
    .map((ch) => ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0"))
    .join("");
}

/** Only `parseReplacePageImages`'s option validation is unit-tested here --
 * the op's actual pdf-lib behavior (page replacement) needs a real PDF and is
 * exercised by the editor's e2e suite (`e2e/pdf-editor-redact.spec.ts`), same
 * split as the rest of this adapter's ops. */
describe("parseReplacePageImages", () => {
  const bytes = new ArrayBuffer(4);

  it("accepts a valid images array", () => {
    const result = parseReplacePageImages({
      images: [{ pageIndex: 0, bytes, width: 100, height: 200 }],
    });
    expect(result).toEqual([{ pageIndex: 0, bytes, width: 100, height: 200 }]);
  });

  it("rejects a missing images field", () => {
    expect(() => parseReplacePageImages({})).toThrow(/non-empty/);
  });

  it("rejects an empty images array", () => {
    expect(() => parseReplacePageImages({ images: [] })).toThrow(/non-empty/);
  });

  it("rejects a non-array images field", () => {
    expect(() => parseReplacePageImages({ images: "nope" })).toThrow(
      /non-empty/,
    );
  });

  it("rejects a negative pageIndex", () => {
    expect(() =>
      parseReplacePageImages({
        images: [{ pageIndex: -1, bytes, width: 1, height: 1 }],
      }),
    ).toThrow(/pageIndex/);
  });

  it("rejects a non-integer pageIndex", () => {
    expect(() =>
      parseReplacePageImages({
        images: [{ pageIndex: 1.5, bytes, width: 1, height: 1 }],
      }),
    ).toThrow(/pageIndex/);
  });

  it("rejects bytes that aren't an ArrayBuffer", () => {
    expect(() =>
      parseReplacePageImages({
        images: [{ pageIndex: 0, bytes: "abc", width: 1, height: 1 }],
      }),
    ).toThrow(/ArrayBuffer/);
  });

  it("rejects an empty ArrayBuffer", () => {
    expect(() =>
      parseReplacePageImages({
        images: [
          { pageIndex: 0, bytes: new ArrayBuffer(0), width: 1, height: 1 },
        ],
      }),
    ).toThrow(/ArrayBuffer/);
  });

  it("rejects a non-positive width or height", () => {
    expect(() =>
      parseReplacePageImages({
        images: [{ pageIndex: 0, bytes, width: 0, height: 1 }],
      }),
    ).toThrow(/width/);
    expect(() =>
      parseReplacePageImages({
        images: [{ pageIndex: 0, bytes, width: 1, height: -5 }],
      }),
    ).toThrow(/height/);
  });

  it("rejects a non-object entry", () => {
    expect(() => parseReplacePageImages({ images: [null] })).toThrow(
      /not an object/,
    );
  });
});

/**
 * `watermark` and `addPageNumbers` are pure pdf-lib text ops -- no
 * `OffscreenCanvas`, unlike `compress`/`merge (images -> pdf)` -- so, unlike
 * the rest of this adapter's ops (covered in `adapter.browser.test.ts`),
 * these two run fine under plain Node and are unit-tested here instead.
 */
describe("run: watermark", () => {
  it("stamps the given text onto every selected page", async () => {
    const instance = await adapter.load({
      baseUrl: "",
      capabilities: {} as never,
    });
    const input = await buildPdf([
      [400, 600],
      [400, 600],
    ]);

    const result = await instance.run(
      baseTask({
        op: "watermark",
        input: bytesInput(input),
        options: {
          text: "CONFIDENTIAL",
          fontSize: 40,
          opacity: 0.3,
          angle: "diagonal",
          color: "gray",
          position: "center",
          pages: "",
        },
      }),
    );
    if (result.kind !== "bytes") throw new Error("expected bytes result");
    expect(result.mime).toBe("application/pdf");

    const doc = await PDFDocument.load(result.bytes);
    expect(doc.getPageCount()).toBe(2);
    for (let i = 0; i < 2; i++) {
      expect(pageContentText(doc, i)).toContain(asciiHex("CONFIDENTIAL"));
    }
  });

  it("respects a page range", async () => {
    const instance = await adapter.load({
      baseUrl: "",
      capabilities: {} as never,
    });
    const input = await buildPdf([
      [200, 200],
      [200, 200],
      [200, 200],
    ]);

    const result = await instance.run(
      baseTask({
        op: "watermark",
        input: bytesInput(input),
        options: {
          text: "DRAFT",
          fontSize: 20,
          opacity: 0.3,
          angle: "horizontal",
          color: "black",
          position: "bottom",
          pages: "2",
        },
      }),
    );
    if (result.kind !== "bytes") throw new Error("expected bytes result");

    const doc = await PDFDocument.load(result.bytes);
    expect(doc.getPageCount()).toBe(3);
    expect(pageContentText(doc, 0)).not.toContain(asciiHex("DRAFT"));
    expect(pageContentText(doc, 1)).toContain(asciiHex("DRAFT"));
    expect(pageContentText(doc, 2)).not.toContain(asciiHex("DRAFT"));
  });

  it("handles a rotated page without throwing, and keeps the rotation", async () => {
    const instance = await adapter.load({
      baseUrl: "",
      capabilities: {} as never,
    });
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 500]);
    page.setRotation(degrees(90));
    const input = (await doc.save()).slice().buffer;

    const result = await instance.run(
      baseTask({
        op: "watermark",
        input: bytesInput(input),
        options: {
          text: "ROTATED",
          fontSize: 24,
          opacity: 0.3,
          angle: "diagonal",
          color: "red",
          position: "center",
          pages: "",
        },
      }),
    );
    if (result.kind !== "bytes") throw new Error("expected bytes result");

    const outDoc = await PDFDocument.load(result.bytes);
    expect(outDoc.getPage(0).getRotation().angle).toBe(90);
    expect(pageContentText(outDoc, 0)).toContain(asciiHex("ROTATED"));
  });

  it("rejects blank text", async () => {
    const instance = await adapter.load({
      baseUrl: "",
      capabilities: {} as never,
    });
    const input = await buildPdf([[100, 100]]);

    await expect(
      instance.run(
        baseTask({
          op: "watermark",
          input: bytesInput(input),
          options: {
            text: "   ",
            fontSize: 40,
            opacity: 0.3,
            angle: "diagonal",
            color: "gray",
            position: "center",
            pages: "",
          },
        }),
      ),
    ).rejects.toThrow(/text/);
  });

  it("rejects text with characters Helvetica/WinAnsi can't encode", async () => {
    const instance = await adapter.load({
      baseUrl: "",
      capabilities: {} as never,
    });
    const input = await buildPdf([[100, 100]]);

    await expect(
      instance.run(
        baseTask({
          op: "watermark",
          input: bytesInput(input),
          options: {
            text: "机密文件",
            fontSize: 40,
            opacity: 0.3,
            angle: "diagonal",
            color: "gray",
            position: "center",
            pages: "",
          },
        }),
      ),
    ).rejects.toThrow(/can't render/);
  });
});

describe("run: addPageNumbers", () => {
  it("labels every page with its own number by default", async () => {
    const instance = await adapter.load({
      baseUrl: "",
      capabilities: {} as never,
    });
    const input = await buildPdf([
      [200, 300],
      [200, 300],
      [200, 300],
    ]);

    const result = await instance.run(
      baseTask({
        op: "addPageNumbers",
        input: bytesInput(input),
        options: {
          position: "bottom-center",
          format: "1",
          startAt: 1,
          fontSize: 11,
          margin: 24,
          pages: "",
        },
      }),
    );
    if (result.kind !== "bytes") throw new Error("expected bytes result");

    const doc = await PDFDocument.load(result.bytes);
    expect(doc.getPageCount()).toBe(3);
    expect(pageContentText(doc, 0)).toContain(asciiHex("1"));
    expect(pageContentText(doc, 1)).toContain(asciiHex("2"));
    expect(pageContentText(doc, 2)).toContain(asciiHex("3"));
  });

  it("counts every page for numbering even when only some are labeled", async () => {
    const instance = await adapter.load({
      baseUrl: "",
      capabilities: {} as never,
    });
    const input = await buildPdf([
      [200, 300],
      [200, 300],
      [200, 300],
    ]);

    const result = await instance.run(
      baseTask({
        op: "addPageNumbers",
        input: bytesInput(input),
        options: {
          position: "bottom-center",
          format: "Page 1 of N",
          startAt: 1,
          fontSize: 11,
          margin: 24,
          pages: "2",
        },
      }),
    );
    if (result.kind !== "bytes") throw new Error("expected bytes result");

    const doc = await PDFDocument.load(result.bytes);
    // Only page 2 (index 1) gets a label; it should read "Page 2 of 3", not
    // "Page 1 of 2" -- numbering counts every page, not just labeled ones.
    expect(pageContentText(doc, 0)).not.toContain(asciiHex("Page"));
    expect(pageContentText(doc, 1)).toContain(asciiHex("Page 2 of 3"));
    expect(pageContentText(doc, 2)).not.toContain(asciiHex("Page"));
  });

  it("honors startAt", async () => {
    const instance = await adapter.load({
      baseUrl: "",
      capabilities: {} as never,
    });
    const input = await buildPdf([
      [200, 300],
      [200, 300],
    ]);

    const result = await instance.run(
      baseTask({
        op: "addPageNumbers",
        input: bytesInput(input),
        options: {
          position: "bottom-center",
          format: "1",
          startAt: 5,
          fontSize: 11,
          margin: 24,
          pages: "",
        },
      }),
    );
    if (result.kind !== "bytes") throw new Error("expected bytes result");

    const doc = await PDFDocument.load(result.bytes);
    expect(pageContentText(doc, 0)).toContain(asciiHex("5"));
    expect(pageContentText(doc, 1)).toContain(asciiHex("6"));
  });

  it("handles a rotated page without throwing, and keeps the rotation", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 500]);
    page.setRotation(degrees(270));
    const input = (await doc.save()).slice().buffer;

    const instance = await adapter.load({
      baseUrl: "",
      capabilities: {} as never,
    });
    const result = await instance.run(
      baseTask({
        op: "addPageNumbers",
        input: bytesInput(input),
        options: {
          position: "bottom-right",
          format: "1",
          startAt: 1,
          fontSize: 11,
          margin: 24,
          pages: "",
        },
      }),
    );
    if (result.kind !== "bytes") throw new Error("expected bytes result");

    const outDoc = await PDFDocument.load(result.bytes);
    expect(outDoc.getPage(0).getRotation().angle).toBe(270);
    expect(pageContentText(outDoc, 0)).toContain(asciiHex("1"));
  });
});
