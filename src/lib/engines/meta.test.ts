import { describe, expect, it } from "vitest";
import { engineBaseUrl } from "./meta";

describe("engineBaseUrl", () => {
  it("is empty for a native engine", () => {
    expect(
      engineBaseUrl({ id: "canvas", version: "1.0.0", location: "native" }),
    ).toBe("");
  });

  it("points at public/engines/<id>@<version>/ for a static engine", () => {
    expect(
      engineBaseUrl({ id: "jsquash", version: "1.2.3", location: "static" }),
    ).toBe("/engines/jsquash@1.2.3/");
  });

  it("points at the R2-backed /engines/xl/<id>@<version>/ prefix for an r2 engine", () => {
    expect(
      engineBaseUrl({ id: "ffmpeg", version: "0.12.6", location: "r2" }),
    ).toBe("/engines/xl/ffmpeg@0.12.6/");
  });
});
