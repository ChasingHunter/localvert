import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import type { EngineInput, EngineTask } from "../types";
import epub from "./adapter";

function baseTask(overrides: Partial<EngineTask> = {}): EngineTask {
  return {
    op: "transcode",
    input: { kind: "bytes", bytes: new ArrayBuffer(0) },
    inputFormat: "epub",
    outputFormat: "html",
    options: {},
    signal: new AbortController().signal,
    ...overrides,
  };
}

function bytesInput(bytes: ArrayBuffer): EngineInput {
  return { kind: "bytes", bytes };
}

/** Zips a minimal but real epub (one chapter, no images) -- exactly the
 * shape `epub.ts`'s own fixtures build by hand, run here through the real
 * `fflate.zipSync` the adapter's `unzipSync` has to read back. */
function buildEpubZip(): ArrayBuffer {
  const enc = new TextEncoder();
  const zipped = zipSync({
    "META-INF/container.xml": enc.encode(
      '<?xml version="1.0"?><container><rootfiles>' +
        '<rootfile full-path="OEBPS/content.opf"/>' +
        "</rootfiles></container>",
    ),
    "OEBPS/content.opf": enc.encode(
      "<package><manifest>" +
        '<item id="ch1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>' +
        "</manifest><spine>" +
        '<itemref idref="ch1"/>' +
        "</spine></package>",
    ),
    "OEBPS/chapter1.xhtml": enc.encode(
      "<html><body><p>Hello EPUB</p></body></html>",
    ),
  });
  return zipped.buffer as ArrayBuffer;
}

describe("epub adapter", () => {
  it("supports transcoding epub to html only", () => {
    expect(epub.supports("transcode", "epub", "html")).toBe(true);
    expect(epub.supports("transcode", "epub", "pdf")).toBe(false);
    expect(epub.supports("transcode", "docx", "html")).toBe(false);
    expect(epub.supports("decode", "epub", "html")).toBe(false);
  });

  it("declares itself as a light, bundled, MIT-licensed engine", () => {
    expect(epub.heavy).toBe(false);
    expect(epub.location).toBe("bundled");
    expect(epub.license).toBe("MIT");
    expect(epub.marker).toBe("localvert-engine:epub");
  });

  it("unzips a real epub and returns concatenated HTML", async () => {
    const instance = await epub.load({ baseUrl: "/engines/epub--1.0.0/" });
    const task = baseTask({ input: bytesInput(buildEpubZip()) });
    const result = await instance.run(task);
    expect(result.kind).toBe("bytes");
    if (result.kind !== "bytes") throw new Error("expected bytes result");
    expect(result.mime).toBe("text/html");
    const html = new TextDecoder().decode(result.bytes);
    expect(html).toContain("Hello EPUB");
  });

  it("rejects a non-zip input as decode-failed", async () => {
    const instance = await epub.load({ baseUrl: "/engines/epub--1.0.0/" });
    const task = baseTask({
      input: bytesInput(
        new TextEncoder().encode("not a zip").buffer as ArrayBuffer,
      ),
    });
    await expect(instance.run(task)).rejects.toMatchObject({
      code: "decode-failed",
    });
  });
});
