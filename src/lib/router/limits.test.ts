import { describe, expect, it } from "vitest";
import { makeCaps } from "@/test/caps";
import { defaultPoolSize } from "./limits";

describe("defaultPoolSize", () => {
  it.each([
    [1, 1],
    [2, 1],
    [3, 1],
    [6, 4],
    [32, 4],
  ])(
    "hardwareConcurrency %i -> pool size %i",
    (hardwareConcurrency, expected) => {
      expect(defaultPoolSize(makeCaps({ hardwareConcurrency }))).toBe(expected);
    },
  );
});
