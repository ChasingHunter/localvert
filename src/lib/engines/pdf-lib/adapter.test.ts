import { describe, expect, it } from "vitest";
import { parseReplacePageImages } from "./adapter";

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
