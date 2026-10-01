import { describe, expect, it } from "vitest";
import { describeOpening, routeForFormats } from "./open-routing";

describe("routeForFormats", () => {
  it("goes straight to the tool when exactly one tool takes the format", () => {
    expect(routeForFormats(["aac"])).toEqual({
      kind: "tool",
      slug: "aac-to-mp3",
    });
    expect(routeForFormats(["wma", "wma"])).toEqual({
      kind: "tool",
      slug: "wma-to-mp3",
    });
  });

  it("goes to the tool when it takes every format in a mixed set", () => {
    expect(routeForFormats(["m4a", "ogg"])).toEqual({
      kind: "tool",
      slug: "compress-audio",
    });
  });

  it("goes home when many tools take the format", () => {
    expect(routeForFormats(["jpg"])).toEqual({ kind: "home" });
    expect(routeForFormats(["pdf"])).toEqual({ kind: "home" });
  });

  it("goes home when no single tool takes the whole set", () => {
    expect(routeForFormats(["aac", "wma"])).toEqual({ kind: "home" });
    expect(routeForFormats(["pdf", "docx"])).toEqual({ kind: "home" });
  });

  it("goes home for an empty set", () => {
    expect(routeForFormats([])).toEqual({ kind: "home" });
  });
});

describe("describeOpening", () => {
  it("pluralises", () => {
    expect(describeOpening(1)).toBe("Opening 1 file…");
    expect(describeOpening(2)).toBe("Opening 2 files…");
  });
});
