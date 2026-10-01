import { describe, expect, it } from "vitest";
import { base64ToBytes, bytesToBase64 } from "./base64";

describe("base64", () => {
  it("round-trips every byte value", () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(Array.from(base64ToBytes(bytesToBase64(bytes)))).toEqual(
      Array.from(bytes),
    );
  });

  it("round-trips a buffer larger than one chunk", () => {
    const bytes = new Uint8Array(100_000).map((_, i) => (i * 31) & 255);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });

  it("matches the standard encoding", () => {
    expect(bytesToBase64(new TextEncoder().encode("Man"))).toBe("TWFu");
  });
});
