import { describe, expect, it } from "vitest";
import {
  extractInlineScripts,
  hashScript,
  injectMetaCsp,
} from "./csp-inline-hashes";

describe("extractInlineScripts", () => {
  it("extracts inline script content, in document order", () => {
    const html = `
      <head>
        <script>alert(1)</script>
        <script type="application/json">{"a":1}</script>
      </head>
    `;
    expect(extractInlineScripts(html)).toEqual(["alert(1)", '{"a":1}']);
  });

  it("skips scripts with a src attribute", () => {
    const html = '<head><script src="/chunk.js" async></script></head>';
    expect(extractInlineScripts(html)).toEqual([]);
  });

  it("handles multiline script content", () => {
    const html =
      "<head><script>\n  const x = 1;\n  const y = 2;\n</script></head>";
    expect(extractInlineScripts(html)).toEqual([
      "\n  const x = 1;\n  const y = 2;\n",
    ]);
  });

  it("returns an empty array when there are no scripts at all", () => {
    expect(extractInlineScripts("<head><title>t</title></head>")).toEqual([]);
  });
});

describe("hashScript", () => {
  it("matches the known CSP test vector for alert(1)", () => {
    expect(hashScript("alert(1)")).toBe(
      "sha256-bhHHL3z2vDgxUt0W3dWQOrprscmda2Y5pLsLg4GF+pI=",
    );
  });
});

describe("injectMetaCsp", () => {
  it("inserts a meta CSP as the first child of head, before other head content", () => {
    const html = "<html><head><title>t</title></head><body></body></html>";
    const injected = injectMetaCsp(html, ["sha256-AAA="]);

    const headIndex = injected.indexOf("<head>");
    const metaIndex = injected.indexOf(`<meta data-localvert-csp`);
    const titleIndex = injected.indexOf("<title>");

    expect(metaIndex).toBeGreaterThan(headIndex);
    expect(metaIndex).toBeLessThan(titleIndex);
    expect(injected).toContain('http-equiv="Content-Security-Policy"');
    expect(injected).toContain(
      "script-src 'self' 'wasm-unsafe-eval' 'sha256-AAA='",
    );
  });

  it("is idempotent: re-injecting replaces rather than duplicates the meta", () => {
    const html = "<html><head><title>t</title></head><body></body></html>";
    const once = injectMetaCsp(html, ["sha256-AAA="]);
    const twice = injectMetaCsp(once, ["sha256-BBB="]);

    const occurrences = twice.split("data-localvert-csp").length - 1;
    expect(occurrences).toBe(1);
    expect(twice).toContain("'sha256-BBB='");
    expect(twice).not.toContain("'sha256-AAA='");
  });

  it("deduplicates and sorts hashes so output is stable across runs", () => {
    const html = "<html><head></head><body></body></html>";
    const injected = injectMetaCsp(html, [
      "sha256-BBB=",
      "sha256-AAA=",
      "sha256-BBB=",
    ]);
    expect(injected).toContain(
      "script-src 'self' 'wasm-unsafe-eval' 'sha256-AAA=' 'sha256-BBB='",
    );
  });

  it("throws when there is no <head> tag", () => {
    expect(() => injectMetaCsp("<html><body></body></html>", [])).toThrow();
  });
});
