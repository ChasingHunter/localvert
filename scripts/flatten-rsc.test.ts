import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { flatName, flattenSegments } from "./flatten-rsc";

describe("flatName", () => {
  it("joins the segment directories and file with dots", () => {
    expect(flatName(["__next.privacy"], "__PAGE__.txt")).toBe(
      "__next.privacy.__PAGE__.txt",
    );
    expect(flatName(["__next.tools", "$d$slug"], "__PAGE__.txt")).toBe(
      "__next.tools.$d$slug.__PAGE__.txt",
    );
  });
});

describe("flattenSegments", () => {
  it("copies nested segment files beside their directory and leaves the rest", () => {
    const root = mkdtempSync(join(tmpdir(), "flatten-rsc-"));
    const nested = join(root, "tools", "x", "__next.tools", "$d$slug");
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, "__PAGE__.txt"), "payload");
    writeFileSync(join(root, "tools", "x", "__next._tree.txt"), "tree");

    expect(flattenSegments(root)).toBe(1);
    expect(
      readFileSync(
        join(root, "tools", "x", "__next.tools.$d$slug.__PAGE__.txt"),
        "utf8",
      ),
    ).toBe("payload");
  });
});
