import { describe, expect, it } from "vitest";
import { moveDown, moveUp, removeAt, reorder } from "./file-order-list-logic";

describe("moveUp", () => {
  it("swaps an item with its predecessor", () => {
    expect(moveUp(["a", "b", "c"], 1)).toEqual(["b", "a", "c"]);
  });

  it("is a no-op at index 0", () => {
    const items = ["a", "b", "c"];
    expect(moveUp(items, 0)).toBe(items);
  });

  it("is a no-op for an out-of-bounds index", () => {
    const items = ["a", "b"];
    expect(moveUp(items, 5)).toBe(items);
    expect(moveUp(items, -1)).toBe(items);
  });
});

describe("moveDown", () => {
  it("swaps an item with its successor", () => {
    expect(moveDown(["a", "b", "c"], 0)).toEqual(["b", "a", "c"]);
  });

  it("is a no-op at the last index", () => {
    const items = ["a", "b", "c"];
    expect(moveDown(items, 2)).toBe(items);
  });

  it("is a no-op for an out-of-bounds index", () => {
    const items = ["a", "b"];
    expect(moveDown(items, 5)).toBe(items);
  });
});

describe("removeAt", () => {
  it("removes the item at index", () => {
    expect(removeAt(["a", "b", "c"], 1)).toEqual(["a", "c"]);
  });

  it("is a no-op for an out-of-bounds index", () => {
    const items = ["a", "b"];
    expect(removeAt(items, 5)).toBe(items);
    expect(removeAt(items, -1)).toBe(items);
  });

  it("does not mutate the input", () => {
    const items = ["a", "b", "c"];
    removeAt(items, 0);
    expect(items).toEqual(["a", "b", "c"]);
  });
});

describe("reorder", () => {
  it("moves an item forward, shifting the rest back", () => {
    expect(reorder(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
  });

  it("moves an item backward, shifting the rest forward", () => {
    expect(reorder(["a", "b", "c", "d"], 3, 1)).toEqual(["a", "d", "b", "c"]);
  });

  it("is a no-op when from equals to", () => {
    const items = ["a", "b", "c"];
    expect(reorder(items, 1, 1)).toBe(items);
  });

  it("is a no-op for an out-of-bounds index", () => {
    const items = ["a", "b", "c"];
    expect(reorder(items, 0, 9)).toBe(items);
    expect(reorder(items, -1, 1)).toBe(items);
  });

  it("does not mutate the input", () => {
    const items = ["a", "b", "c"];
    reorder(items, 0, 2);
    expect(items).toEqual(["a", "b", "c"]);
  });
});
