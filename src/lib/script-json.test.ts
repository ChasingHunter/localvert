import { describe, expect, it } from "vitest";
import { jsonForScript } from "./script-json";

// Built with fromCharCode so no formatter can turn them into raw characters.
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);

describe("jsonForScript", () => {
  it("escapes characters the HTML parser or old engines act on", () => {
    const value = { a: `</script><!--${LS}${PS}` };
    const out = jsonForScript(value);
    for (const c of ["<", ">", LS, PS]) expect(out.includes(c)).toBe(false);
    expect(JSON.parse(out)).toEqual(value);
  });

  it("leaves ordinary values as plain JSON", () => {
    expect(jsonForScript("localvert-theme")).toBe('"localvert-theme"');
  });
});
