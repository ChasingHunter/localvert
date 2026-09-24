import { describe, expect, it } from "vitest";
import { SNIFF_BYTES } from "@/lib/registry";
import { classifyFiles } from "./dropzone-logic";

/** Builds a fake File whose head bytes satisfy the given magic pattern. */
function fileWithBytes(name: string, bytes: readonly number[]): File {
  const head = new Uint8Array(SNIFF_BYTES);
  head.set(bytes, 0);
  return new File([head], name);
}

const PNG_BYTES = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPG_BYTES = [0xff, 0xd8, 0xff];
const PDF_BYTES = Array.from("%PDF-", (c) => c.charCodeAt(0));

describe("classifyFiles", () => {
  it("accepts a file whose content and extension agree", async () => {
    const file = fileWithBytes("photo.png", PNG_BYTES);
    const { accepted, rejected } = await classifyFiles([file], ["png", "jpg"]);
    expect(rejected).toEqual([]);
    expect(accepted).toEqual([
      { file, format: "png", extensionMismatch: false },
    ]);
  });

  it("flags an extension mismatch when the name disagrees with the bytes", async () => {
    const file = fileWithBytes("photo.png", JPG_BYTES);
    const { accepted, rejected } = await classifyFiles([file], ["png", "jpg"]);
    expect(rejected).toEqual([]);
    expect(accepted).toEqual([
      { file, format: "jpg", extensionMismatch: true },
    ]);
  });

  it("rejects a recognized format that isn't in the accepts list", async () => {
    const file = fileWithBytes("doc.pdf", PDF_BYTES);
    const { accepted, rejected } = await classifyFiles([file], ["png", "jpg"]);
    expect(accepted).toEqual([]);
    expect(rejected).toEqual([
      { file, reason: "not-accepted", detected: "pdf" },
    ]);
  });

  it("rejects a file whose bytes match no known format", async () => {
    const file = fileWithBytes("mystery.bin", [0x00, 0x01, 0x02, 0x03]);
    const { accepted, rejected } = await classifyFiles([file], ["png", "jpg"]);
    expect(accepted).toEqual([]);
    expect(rejected).toEqual([
      { file, reason: "unknown-format", detected: null },
    ]);
  });

  it("classifies a batch independently, preserving input order", async () => {
    const good = fileWithBytes("a.png", PNG_BYTES);
    const mismatched = fileWithBytes("a.jpg", PNG_BYTES);
    const unknown = fileWithBytes("a.bin", [0xde, 0xad, 0xbe, 0xef]);
    const { accepted, rejected } = await classifyFiles(
      [good, mismatched, unknown],
      ["png"],
    );
    expect(accepted.map((a) => a.file)).toEqual([good, mismatched]);
    expect(accepted[1]?.extensionMismatch).toBe(true);
    expect(rejected.map((r) => r.file)).toEqual([unknown]);
  });

  it("uses an injected sniff function instead of the real one", async () => {
    const file = new File([], "anything");
    const { accepted } = await classifyFiles(
      [file],
      ["webp"],
      async () => "webp",
    );
    expect(accepted).toEqual([
      { file, format: "webp", extensionMismatch: true },
    ]);
  });
});
