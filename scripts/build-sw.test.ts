import { describe, expect, it } from "vitest";
import { findMissingCspMarker, prettyUrlFor, sha256Hex } from "./build-sw";

describe("prettyUrlFor", () => {
  it("maps the root index to /", () => {
    expect(prettyUrlFor("index.html")).toBe("/");
  });

  it("maps a nested index to its directory", () => {
    expect(prettyUrlFor("tools/jpg-to-png/index.html")).toBe(
      "/tools/jpg-to-png",
    );
  });

  it("maps a flat page file to its clean path", () => {
    expect(prettyUrlFor("offline.html")).toBe("/offline");
  });

  it("normalizes a Windows-style relative path", () => {
    expect(prettyUrlFor("tools\\jpg-to-png\\index.html")).toBe(
      "/tools/jpg-to-png",
    );
  });
});

describe("sha256Hex", () => {
  it("is deterministic", () => {
    expect(sha256Hex("hello")).toBe(sha256Hex("hello"));
  });

  it("differs when the content differs", () => {
    expect(sha256Hex("a")).not.toBe(sha256Hex("b"));
  });

  it("changes when a CSP meta tag is injected into otherwise-identical HTML", () => {
    // This is the property the whole ordering trap is about: the revision
    // embedded in the precache manifest must be a hash of the page AFTER
    // csp-inline-hashes.ts has run, not before, because the two differ.
    const before = "<html><head><title>t</title></head></html>";
    const after = before.replace(
      "<head>",
      '<head><meta data-localvert-csp http-equiv="Content-Security-Policy" content="...">',
    );
    expect(sha256Hex(before)).not.toBe(sha256Hex(after));
  });
});

describe("findMissingCspMarker", () => {
  it("flags a page with no injected meta CSP", () => {
    const files = [
      {
        path: "index.html",
        html: "<head><meta data-localvert-csp>...</head>",
      },
      { path: "offline.html", html: "<head><title>t</title></head>" },
    ];
    expect(findMissingCspMarker(files)).toEqual(["offline.html"]);
  });

  it("passes when every page carries the marker", () => {
    const files = [
      { path: "index.html", html: "<meta data-localvert-csp>" },
      { path: "offline.html", html: "<meta data-localvert-csp>" },
    ];
    expect(findMissingCspMarker(files)).toEqual([]);
  });

  it("returns an empty list for no files", () => {
    expect(findMissingCspMarker([])).toEqual([]);
  });
});
