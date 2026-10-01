import { describe, expect, it } from "vitest";
import { FORMATS } from "@/lib/registry/formats";
import { CATALOG } from "@/tools/catalog";
import { fileHandlerAccept, shareTargetAccept } from "./file-handler-accept";

describe("fileHandlerAccept", () => {
  const accept = fileHandlerAccept();

  it("covers every input format some catalog tool accepts", () => {
    const inputs = new Set(CATALOG.flatMap((tool) => tool.accepts));
    expect(inputs.size).toBeGreaterThan(0);
    for (const format of inputs) {
      const spec = FORMATS[format];
      const exts = accept[spec.mime];
      expect(exts, `${format} (${spec.mime})`).toBeDefined();
      for (const ext of spec.ext) expect(exts).toContain(`.${ext}`);
    }
  });

  it("uses well-formed mime keys and dotted, lowercase, unique extensions", () => {
    for (const [mime, exts] of Object.entries(accept)) {
      expect(mime).toMatch(/^[a-z]+\/[a-z0-9.+-]+$/);
      expect(exts.length).toBeGreaterThan(0);
      for (const ext of exts) expect(ext).toMatch(/^\.[a-z0-9]+$/);
      expect(new Set(exts).size).toBe(exts.length);
    }
  });

  it("lists nothing that no tool accepts", () => {
    const inputMimes = new Set(
      CATALOG.flatMap((tool) => tool.accepts).map((f) => FORMATS[f].mime),
    );
    expect(Object.keys(accept).sort()).toEqual([...inputMimes].sort());
  });
});

describe("shareTargetAccept", () => {
  it("is every mime type followed by every extension", () => {
    const accept = fileHandlerAccept();
    const flat = shareTargetAccept();
    for (const mime of Object.keys(accept)) expect(flat).toContain(mime);
    for (const ext of Object.values(accept).flat()) expect(flat).toContain(ext);
  });
});
