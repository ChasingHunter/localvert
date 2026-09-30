import { describe, expect, it } from "vitest";
import { formatBytes } from "./format-bytes";

describe("formatBytes", () => {
  it("formats bytes under 1024 as B", () => {
    expect(formatBytes(500)).toBe("500 B");
  });
  it("formats KB with one decimal under 10", () => {
    expect(formatBytes(1536)).toBe("1.5 KB");
  });
  it("formats KB with no decimal at 10 or above", () => {
    expect(formatBytes(15 * 1024)).toBe("15 KB");
  });
  it("formats MB", () => {
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});
