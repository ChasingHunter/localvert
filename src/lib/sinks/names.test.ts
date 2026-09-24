import { describe, expect, it } from "vitest";
import { sanitizeEntryName, uniqueName } from "./names";

describe("sanitizeEntryName", () => {
  it("strips directory components joined with /", () => {
    expect(sanitizeEntryName("../../etc/passwd")).toBe("passwd");
  });

  it("strips directory components joined with \\", () => {
    expect(sanitizeEntryName("a\\b.png")).toBe("b.png");
  });

  it("replaces characters reserved on Windows with _", () => {
    expect(sanitizeEntryName("con:?.png")).toBe("con__.png");
  });

  it("removes control characters", () => {
    expect(sanitizeEntryName("a\u0000b\u001fc.png")).toBe("abc.png");
  });

  it("turns a dots-only name into file", () => {
    expect(sanitizeEntryName("..")).toBe("file");
    expect(sanitizeEntryName(".")).toBe("file");
  });

  it("turns an empty name into file", () => {
    expect(sanitizeEntryName("")).toBe("file");
  });

  it("turns a name that sanitizes to nothing into file", () => {
    expect(sanitizeEntryName("../")).toBe("file");
  });

  it("caps length at 200 characters while preserving the extension", () => {
    const name = `${"a".repeat(300)}.png`;
    const result = sanitizeEntryName(name);
    expect(result.length).toBe(200);
    expect(result.endsWith(".png")).toBe(true);
  });

  it("leaves a short, clean name untouched", () => {
    expect(sanitizeEntryName("photo.png")).toBe("photo.png");
  });
});

describe("uniqueName", () => {
  it("returns the name unchanged the first time it's seen", () => {
    const taken = new Set<string>();
    expect(uniqueName(taken, "photo.png")).toBe("photo.png");
  });

  it("numbers repeated names sequentially before the extension", () => {
    const taken = new Set<string>();
    expect(uniqueName(taken, "photo.png")).toBe("photo.png");
    expect(uniqueName(taken, "photo.png")).toBe("photo (2).png");
    expect(uniqueName(taken, "photo.png")).toBe("photo (3).png");
  });

  it("treats collisions case-insensitively", () => {
    const taken = new Set<string>();
    expect(uniqueName(taken, "Photo.png")).toBe("Photo.png");
    expect(uniqueName(taken, "photo.PNG")).toBe("photo (2).PNG");
  });

  it("adds the chosen name to taken", () => {
    const taken = new Set<string>();
    uniqueName(taken, "photo.png");
    expect(taken.has("photo.png")).toBe(true);
  });
});
