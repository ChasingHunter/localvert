import { describe, expect, it } from "vitest";
import { formatRelativeTime, isValidDraftRecord } from "./draft-store";

describe("isValidDraftRecord", () => {
  it("accepts a well-formed record", () => {
    expect(
      isValidDraftRecord({
        name: "document.pdf",
        bytes: new ArrayBuffer(4),
        savedAt: Date.now(),
      }),
    ).toBe(true);
  });

  it("rejects null and non-objects", () => {
    expect(isValidDraftRecord(null)).toBe(false);
    expect(isValidDraftRecord(undefined)).toBe(false);
    expect(isValidDraftRecord("draft")).toBe(false);
    expect(isValidDraftRecord(42)).toBe(false);
  });

  it("rejects a record missing or mistyping a field", () => {
    expect(
      isValidDraftRecord({ bytes: new ArrayBuffer(4), savedAt: Date.now() }),
    ).toBe(false);
    expect(
      isValidDraftRecord({ name: "", bytes: new ArrayBuffer(4), savedAt: 1 }),
    ).toBe(false);
    expect(
      isValidDraftRecord({ name: "a.pdf", bytes: [1, 2, 3], savedAt: 1 }),
    ).toBe(false);
    expect(
      isValidDraftRecord({
        name: "a.pdf",
        bytes: new ArrayBuffer(4),
        savedAt: "now",
      }),
    ).toBe(false);
    expect(
      isValidDraftRecord({
        name: "a.pdf",
        bytes: new ArrayBuffer(4),
        savedAt: Number.NaN,
      }),
    ).toBe(false);
  });
});

describe("formatRelativeTime", () => {
  const now = 1_000_000;

  it("reports very recent saves as 'just now'", () => {
    expect(formatRelativeTime(now - 2_000, now)).toBe("just now");
  });

  it("reports seconds", () => {
    expect(formatRelativeTime(now - 30_000, now)).toBe("30s ago");
  });

  it("reports minutes", () => {
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe("5m ago");
  });

  it("reports hours", () => {
    expect(formatRelativeTime(now - 3 * 60 * 60_000, now)).toBe("3h ago");
  });

  it("reports days", () => {
    expect(formatRelativeTime(now - 2 * 24 * 60 * 60_000, now)).toBe("2d ago");
  });
});
