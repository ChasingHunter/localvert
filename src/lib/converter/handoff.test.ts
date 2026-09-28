import { describe, expect, it } from "vitest";
import { hasPendingFiles, setPendingFiles, takePendingFiles } from "./handoff";

function fakeFile(name: string): File {
  return new File(["x"], name);
}

describe("handoff", () => {
  it("returns null when nothing is staged for a slug", () => {
    expect(takePendingFiles("jpg-to-png-unused")).toBeNull();
  });

  it("takePendingFiles is one-shot: a second take returns null", () => {
    const files = [fakeFile("a.jpg")];
    setPendingFiles("jpg-to-png", files);

    expect(takePendingFiles("jpg-to-png")).toEqual(files);
    expect(takePendingFiles("jpg-to-png")).toBeNull();
  });

  it("keeps files scoped to their own slug", () => {
    setPendingFiles("pdf-to-word", [fakeFile("a.pdf")]);
    setPendingFiles("jpg-to-png", [fakeFile("b.jpg")]);

    expect(takePendingFiles("pdf-to-word")?.map((f) => f.name)).toEqual([
      "a.pdf",
    ]);
    expect(takePendingFiles("jpg-to-png")?.map((f) => f.name)).toEqual([
      "b.jpg",
    ]);
  });

  it("a later setPendingFiles for the same slug replaces, not appends", () => {
    setPendingFiles("gif-to-png", [fakeFile("first.gif")]);
    setPendingFiles("gif-to-png", [fakeFile("second.gif")]);

    expect(takePendingFiles("gif-to-png")?.map((f) => f.name)).toEqual([
      "second.gif",
    ]);
  });

  it("hasPendingFiles peeks without consuming", () => {
    setPendingFiles("heic-to-jpg", [fakeFile("a.heic")]);

    expect(hasPendingFiles("heic-to-jpg")).toBe(true);
    expect(hasPendingFiles("heic-to-jpg")).toBe(true);
    expect(takePendingFiles("heic-to-jpg")).not.toBeNull();
    expect(hasPendingFiles("heic-to-jpg")).toBe(false);
  });

  it("reports false for a slug that was never staged", () => {
    expect(hasPendingFiles("never-staged-slug")).toBe(false);
  });
});
