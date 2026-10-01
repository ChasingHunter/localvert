import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ENGINE_CACHE } from "./cache-names";

describe("ENGINE_CACHE", () => {
  it("is the cache name src/sw.ts writes to", () => {
    const sw = readFileSync("src/sw.ts", "utf8");
    expect(sw).toContain(`cacheName: "${ENGINE_CACHE}"`);
  });
});
