import { describe, expect, it } from "vitest";
import {
  applyPresetOptions,
  clearPendingOptions,
  hasPendingFiles,
  peekPendingOptions,
  setPendingFiles,
  setPendingOptions,
  takePendingFiles,
} from "./handoff";

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

  it("pending options can be peeked repeatedly, replaced, and cleared", () => {
    setPendingOptions("extract-audio", { format: "wav" });
    expect(peekPendingOptions("extract-audio")).toEqual({ format: "wav" });
    expect(peekPendingOptions("extract-audio")).toEqual({ format: "wav" });
    setPendingOptions("extract-audio", undefined);
    expect(peekPendingOptions("extract-audio")).toBeUndefined();
    setPendingOptions("extract-audio", { format: "m4a" });
    clearPendingOptions("extract-audio");
    expect(peekPendingOptions("extract-audio")).toBeUndefined();
  });

  it("applyPresetOptions lays known keys over the defaults, typed like the default", () => {
    const defaults = { format: "mp3", bitrate: "192", level: 1, loud: false };
    expect(applyPresetOptions(defaults, undefined)).toEqual(defaults);
    expect(
      applyPresetOptions(defaults, {
        format: "wav",
        level: "3",
        loud: "true",
        unknown: "x",
      }),
    ).toEqual({ format: "wav", bitrate: "192", level: 3, loud: true });
  });

  it("reports false for a slug that was never staged", () => {
    expect(hasPendingFiles("never-staged-slug")).toBe(false);
  });
});
