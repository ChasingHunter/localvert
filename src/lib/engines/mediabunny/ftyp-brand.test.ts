import { describe, expect, it } from "vitest";
import { patchFtypMajorBrand } from "./output";

/** A minimal `ftyp` box header: size, "ftyp", major brand, minor version. */
function ftypHeader(brand: string): Uint8Array {
  const bytes = new Uint8Array(16);
  bytes.set([0, 0, 0, 16], 0);
  bytes.set(new TextEncoder().encode("ftyp"), 4);
  bytes.set(new TextEncoder().encode(brand), 8);
  return bytes;
}

const text = (bytes: Uint8Array, from: number, to: number) =>
  new TextDecoder().decode(bytes.subarray(from, to));

describe("patchFtypMajorBrand", () => {
  it("replaces the major brand of a whole buffer at position 0", () => {
    const bytes = ftypHeader("isom");
    patchFtypMajorBrand(bytes, 0, "M4A ");
    expect(text(bytes, 8, 12)).toBe("M4A ");
    expect(text(bytes, 4, 8)).toBe("ftyp");
  });

  it("patches a streamed chunk that starts before the brand", () => {
    const whole = ftypHeader("isom");
    const chunk = whole.slice(2); // written at absolute offset 2
    patchFtypMajorBrand(chunk, 2, "M4A ");
    expect(text(chunk, 6, 10)).toBe("M4A ");
  });

  it("leaves chunks that don't cover the brand untouched", () => {
    const later = new Uint8Array([1, 2, 3, 4]);
    patchFtypMajorBrand(later, 100, "M4A ");
    expect([...later]).toEqual([1, 2, 3, 4]);

    const partial = ftypHeader("isom").slice(0, 10); // brand cut off
    patchFtypMajorBrand(partial, 0, "M4A ");
    expect(text(partial, 8, 10)).toBe("is");
  });

  it("leaves non-ftyp data untouched", () => {
    const bytes = ftypHeader("isom");
    bytes.set(new TextEncoder().encode("moov"), 4);
    patchFtypMajorBrand(bytes, 0, "M4A ");
    expect(text(bytes, 8, 12)).toBe("isom");
  });

  it("rejects a brand that isn't exactly 4 characters", () => {
    expect(() => patchFtypMajorBrand(ftypHeader("isom"), 0, "M4A")).toThrow();
  });
});
