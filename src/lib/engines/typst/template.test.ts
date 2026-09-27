import { describe, expect, it } from "vitest";
import { buildMainTyp, CMARKER_LIB_PATH, INPUT_PATH } from "./template";

describe("buildMainTyp", () => {
  it("maps the a4 option to typst's a4 paper preset", () => {
    const typ = buildMainTyp({ pageSize: "a4", fontSize: "11" });
    expect(typ).toContain('paper: "a4"');
  });

  it("maps the letter option to typst's us-letter paper preset", () => {
    const typ = buildMainTyp({ pageSize: "letter", fontSize: "11" });
    expect(typ).toContain('paper: "us-letter"');
  });

  it("interpolates the font size for both body and unset raw text", () => {
    const typ = buildMainTyp({ pageSize: "a4", fontSize: "12" });
    expect(typ).toContain("size: 12pt");
  });

  it("imports cmarker by its vendored in-memory path, not the @preview package spec", () => {
    const typ = buildMainTyp({ pageSize: "a4", fontSize: "11" });
    expect(typ).toContain(`import "${CMARKER_LIB_PATH}"`);
    expect(typ).not.toContain("@preview/cmarker");
  });

  it("reads the job's own markdown from the in-memory input path", () => {
    const typ = buildMainTyp({ pageSize: "a4", fontSize: "11" });
    expect(typ).toContain(`read("${INPUT_PATH}")`);
  });

  it("overrides cmarker's img handler so a markdown image renders as alt text, never a file lookup", () => {
    const typ = buildMainTyp({ pageSize: "a4", fontSize: "11" });
    expect(typ).toContain("img:");
    expect(typ).not.toContain("image(attrs");
  });
});
