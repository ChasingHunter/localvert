import { describe, expect, it } from "vitest";
import { neverLarger } from "./never-larger";

describe("neverLarger", () => {
  it("returns the candidate when it's smaller than the original", () => {
    const original = new ArrayBuffer(1000);
    const candidate = new ArrayBuffer(500);
    const result = neverLarger(original, candidate);
    expect(result.bytes).toBe(candidate);
    expect(result.note).toBeUndefined();
  });

  it("falls back to the original when the candidate is bigger", () => {
    const original = new ArrayBuffer(500);
    const candidate = new ArrayBuffer(1000);
    const result = neverLarger(original, candidate);
    expect(result.bytes).toBe(original);
    expect(result.note).toBeTruthy();
  });

  it("falls back to the original when the candidate is exactly the same size", () => {
    const original = new ArrayBuffer(500);
    const candidate = new ArrayBuffer(500);
    const result = neverLarger(original, candidate);
    expect(result.bytes).toBe(original);
    expect(result.note).toBeTruthy();
  });

  it("uses a custom message when given one", () => {
    const result = neverLarger(
      new ArrayBuffer(10),
      new ArrayBuffer(20),
      "custom fallback message",
    );
    expect(result.note).toBe("custom fallback message");
  });
});
