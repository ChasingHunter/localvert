import { describe, expect, it } from "vitest";
import {
  type ComboboxContext,
  type ComboboxOption,
  comboboxReducer,
  initialComboboxState,
} from "./combobox-logic";

const labels: Record<string, string> = {
  a: "Alpha",
  b: "Bravo",
  c: "Charlie",
  d: "Delta",
};

function ctx(options: readonly ComboboxOption[]): ComboboxContext {
  return { options, labelOf: (id) => labels[id] ?? id };
}

const abcd: ComboboxOption[] = [
  { id: "a" },
  { id: "b" },
  { id: "c" },
  { id: "d" },
];

describe("comboboxReducer", () => {
  describe("input", () => {
    it("opens, sets the query, and activates the first match", () => {
      const state = initialComboboxState();
      const next = comboboxReducer(
        state,
        { type: "input", query: "a" },
        ctx(abcd),
      );
      expect(next).toEqual({
        open: true,
        query: "a",
        activeId: "a",
        selectedId: null,
      });
    });

    it("resets active to the first match against an already-open state", () => {
      const state = { open: true, query: "", activeId: "c", selectedId: null };
      const next = comboboxReducer(
        state,
        { type: "input", query: "b" },
        ctx([{ id: "b" }, { id: "d" }]),
      );
      expect(next.activeId).toBe("b");
      expect(next.open).toBe(true);
    });

    it("activates null when nothing matches", () => {
      const state = initialComboboxState();
      const next = comboboxReducer(
        state,
        { type: "input", query: "zz" },
        ctx([]),
      );
      expect(next.activeId).toBeNull();
      expect(next.open).toBe(true);
    });
  });

  describe("arrowDown", () => {
    it("opens a closed list and activates the first enabled option", () => {
      const state = initialComboboxState();
      const next = comboboxReducer(state, { type: "arrowDown" }, ctx(abcd));
      expect(next.open).toBe(true);
      expect(next.activeId).toBe("a");
    });

    it("opens a closed list and activates the selection when it's visible", () => {
      const state = initialComboboxState("c");
      const next = comboboxReducer(state, { type: "arrowDown" }, ctx(abcd));
      expect(next.activeId).toBe("c");
    });

    it("falls back to first when the selection isn't in the visible list", () => {
      const state = initialComboboxState("z");
      const next = comboboxReducer(state, { type: "arrowDown" }, ctx(abcd));
      expect(next.activeId).toBe("a");
    });

    it("falls back to first when the selection is disabled", () => {
      const state = initialComboboxState("b");
      const next = comboboxReducer(
        state,
        { type: "arrowDown" },
        ctx([{ id: "a" }, { id: "b", disabled: true }]),
      );
      expect(next.activeId).toBe("a");
    });

    it("moves to the next option while open", () => {
      const state = { open: true, query: "", activeId: "a", selectedId: null };
      const next = comboboxReducer(state, { type: "arrowDown" }, ctx(abcd));
      expect(next.activeId).toBe("b");
    });

    it("skips disabled options going down", () => {
      const options: ComboboxOption[] = [
        { id: "a" },
        { id: "b", disabled: true },
        { id: "c" },
      ];
      const state = { open: true, query: "", activeId: "a", selectedId: null };
      const next = comboboxReducer(state, { type: "arrowDown" }, ctx(options));
      expect(next.activeId).toBe("c");
    });

    it("does not wrap past the last option", () => {
      const state = { open: true, query: "", activeId: "d", selectedId: null };
      const next = comboboxReducer(state, { type: "arrowDown" }, ctx(abcd));
      expect(next.activeId).toBe("d");
    });

    it("stays null when every option is disabled", () => {
      const options: ComboboxOption[] = [
        { id: "a", disabled: true },
        { id: "b", disabled: true },
      ];
      const state = { open: true, query: "", activeId: null, selectedId: null };
      const next = comboboxReducer(state, { type: "arrowDown" }, ctx(options));
      expect(next.activeId).toBeNull();
    });

    it("activates the sole option in a single-option list", () => {
      const state = initialComboboxState();
      const next = comboboxReducer(
        state,
        { type: "arrowDown" },
        ctx([{ id: "a" }]),
      );
      expect(next.activeId).toBe("a");
    });

    it("stays null on an empty list", () => {
      const state = initialComboboxState();
      const next = comboboxReducer(state, { type: "arrowDown" }, ctx([]));
      expect(next.activeId).toBeNull();
      expect(next.open).toBe(true);
    });
  });

  describe("arrowUp", () => {
    it("opens a closed list and activates the last enabled option", () => {
      const state = initialComboboxState();
      const next = comboboxReducer(state, { type: "arrowUp" }, ctx(abcd));
      expect(next.open).toBe(true);
      expect(next.activeId).toBe("d");
    });

    it("moves to the previous option while open", () => {
      const state = { open: true, query: "", activeId: "c", selectedId: null };
      const next = comboboxReducer(state, { type: "arrowUp" }, ctx(abcd));
      expect(next.activeId).toBe("b");
    });

    it("skips disabled options going up", () => {
      const options: ComboboxOption[] = [
        { id: "a" },
        { id: "b", disabled: true },
        { id: "c" },
      ];
      const state = { open: true, query: "", activeId: "c", selectedId: null };
      const next = comboboxReducer(state, { type: "arrowUp" }, ctx(options));
      expect(next.activeId).toBe("a");
    });

    it("does not wrap past the first option", () => {
      const state = { open: true, query: "", activeId: "a", selectedId: null };
      const next = comboboxReducer(state, { type: "arrowUp" }, ctx(abcd));
      expect(next.activeId).toBe("a");
    });

    it("stays null when every option is disabled", () => {
      const options: ComboboxOption[] = [
        { id: "a", disabled: true },
        { id: "b", disabled: true },
      ];
      const state = { open: true, query: "", activeId: null, selectedId: null };
      const next = comboboxReducer(state, { type: "arrowUp" }, ctx(options));
      expect(next.activeId).toBeNull();
    });
  });

  describe("home / end", () => {
    it("are no-ops while closed", () => {
      const state = initialComboboxState();
      expect(comboboxReducer(state, { type: "home" }, ctx(abcd))).toBe(state);
      expect(comboboxReducer(state, { type: "end" }, ctx(abcd))).toBe(state);
    });

    it("jump to the first / last enabled option while open", () => {
      const state = { open: true, query: "", activeId: "b", selectedId: null };
      expect(comboboxReducer(state, { type: "home" }, ctx(abcd)).activeId).toBe(
        "a",
      );
      expect(comboboxReducer(state, { type: "end" }, ctx(abcd)).activeId).toBe(
        "d",
      );
    });

    it("skip disabled edges", () => {
      const options: ComboboxOption[] = [
        { id: "a", disabled: true },
        { id: "b" },
        { id: "c" },
        { id: "d", disabled: true },
      ];
      const state = { open: true, query: "", activeId: "b", selectedId: null };
      expect(
        comboboxReducer(state, { type: "home" }, ctx(options)).activeId,
      ).toBe("b");
      expect(
        comboboxReducer(state, { type: "end" }, ctx(options)).activeId,
      ).toBe("c");
    });
  });

  describe("enter", () => {
    it("is a no-op while closed", () => {
      const state = initialComboboxState();
      expect(comboboxReducer(state, { type: "enter" }, ctx(abcd))).toBe(state);
    });

    it("commits the active option: selects it, closes, and fills the query", () => {
      const state = {
        open: true,
        query: "al",
        activeId: "a",
        selectedId: null,
      };
      const next = comboboxReducer(state, { type: "enter" }, ctx(abcd));
      expect(next).toEqual({
        open: false,
        query: "Alpha",
        activeId: "a",
        selectedId: "a",
      });
    });

    it("just closes when nothing is active", () => {
      const state = {
        open: true,
        query: "zz",
        activeId: null,
        selectedId: null,
      };
      const next = comboboxReducer(state, { type: "enter" }, ctx([]));
      expect(next).toEqual({
        open: false,
        query: "zz",
        activeId: null,
        selectedId: null,
      });
    });
  });

  describe("escape", () => {
    it("closes an open list without touching the query", () => {
      const state = {
        open: true,
        query: "abc",
        activeId: "a",
        selectedId: null,
      };
      const next = comboboxReducer(state, { type: "escape" }, ctx(abcd));
      expect(next.open).toBe(false);
      expect(next.query).toBe("abc");
    });

    it("clears the query on a second press once already closed", () => {
      const state = {
        open: false,
        query: "abc",
        activeId: "a",
        selectedId: null,
      };
      const next = comboboxReducer(state, { type: "escape" }, ctx(abcd));
      expect(next.query).toBe("");
    });

    it("is a no-op when closed with an empty query", () => {
      const state = initialComboboxState();
      expect(comboboxReducer(state, { type: "escape" }, ctx(abcd))).toBe(state);
    });
  });

  describe("tab", () => {
    it("is a no-op while closed (never traps, but nothing to commit)", () => {
      const state = initialComboboxState();
      expect(comboboxReducer(state, { type: "tab" }, ctx(abcd))).toBe(state);
    });

    it("commits the active option like enter", () => {
      const state = { open: true, query: "b", activeId: "b", selectedId: null };
      const next = comboboxReducer(state, { type: "tab" }, ctx(abcd));
      expect(next).toEqual({
        open: false,
        query: "Bravo",
        activeId: "b",
        selectedId: "b",
      });
    });

    it("closes without committing when nothing is active, never trapping focus", () => {
      const options: ComboboxOption[] = [
        { id: "a", disabled: true },
        { id: "b", disabled: true },
      ];
      const state = { open: true, query: "", activeId: null, selectedId: null };
      const next = comboboxReducer(state, { type: "tab" }, ctx(options));
      expect(next.open).toBe(false);
      expect(next.selectedId).toBeNull();
    });
  });

  describe("blur", () => {
    it("closes without committing", () => {
      const state = {
        open: true,
        query: "al",
        activeId: "a",
        selectedId: null,
      };
      const next = comboboxReducer(state, { type: "blur" }, ctx(abcd));
      expect(next.open).toBe(false);
      expect(next.selectedId).toBeNull();
      expect(next.query).toBe("al");
    });

    it("is a no-op while already closed", () => {
      const state = initialComboboxState();
      expect(comboboxReducer(state, { type: "blur" }, ctx(abcd))).toBe(state);
    });
  });

  describe("optionClick", () => {
    it("commits the clicked option regardless of which was active", () => {
      const state = { open: true, query: "", activeId: "a", selectedId: null };
      const next = comboboxReducer(
        state,
        { type: "optionClick", id: "c" },
        ctx(abcd),
      );
      expect(next).toEqual({
        open: false,
        query: "Charlie",
        activeId: "c",
        selectedId: "c",
      });
    });
  });

  describe("optionsChanged", () => {
    it("keeps the active id when it's still present and enabled", () => {
      const state = { open: true, query: "", activeId: "b", selectedId: null };
      const next = comboboxReducer(
        state,
        { type: "optionsChanged", options: [{ id: "b" }, { id: "c" }] },
        ctx(abcd),
      );
      expect(next.activeId).toBe("b");
    });

    it("falls back to the first option when the active id disappears", () => {
      const state = { open: true, query: "", activeId: "b", selectedId: null };
      const next = comboboxReducer(
        state,
        { type: "optionsChanged", options: [{ id: "c" }, { id: "d" }] },
        ctx(abcd),
      );
      expect(next.activeId).toBe("c");
    });

    it("falls back to the first option when the active id becomes disabled", () => {
      const state = { open: true, query: "", activeId: "b", selectedId: null };
      const next = comboboxReducer(
        state,
        {
          type: "optionsChanged",
          options: [{ id: "b", disabled: true }, { id: "c" }],
        },
        ctx(abcd),
      );
      expect(next.activeId).toBe("c");
    });

    it("goes null when the new list is empty", () => {
      const state = { open: true, query: "", activeId: "b", selectedId: null };
      const next = comboboxReducer(
        state,
        { type: "optionsChanged", options: [] },
        ctx(abcd),
      );
      expect(next.activeId).toBeNull();
    });

    it("is a no-op on active id when there was none and the list is still empty", () => {
      const state = { open: true, query: "", activeId: null, selectedId: null };
      const next = comboboxReducer(
        state,
        { type: "optionsChanged", options: [] },
        ctx(abcd),
      );
      expect(next.activeId).toBeNull();
    });
  });

  describe("initialComboboxState", () => {
    it("defaults to closed, empty, nothing active or selected", () => {
      expect(initialComboboxState()).toEqual({
        open: false,
        query: "",
        activeId: null,
        selectedId: null,
      });
    });

    it("accepts a pre-selected id", () => {
      expect(initialComboboxState("a").selectedId).toBe("a");
    });
  });
});
