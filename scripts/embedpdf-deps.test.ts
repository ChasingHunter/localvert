import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * ADR-0009 guard: the PDF editor (E1b Unit 2, `@embedpdf/core` + plugin-*)
 * must never pull in `@embedpdf/plugin-form` (ships with no license field,
 * so it's unusable regardless of what it does — forms are filled with
 * pdf-lib/PDFium's own form API instead) or `@embedpdf/snippet`/
 * `@embedpdf/react-pdf-viewer` (the batteries-included "snippet" viewer,
 * which depends on `@embedpdf/snippet` and therefore transitively on
 * `plugin-form`, plus a redaction/signature/preact stack this editor
 * doesn't use — the real viewer is composed from `@embedpdf/core`'s React
 * bindings and each plugin's own `/react` subpath instead, see
 * `src/components/editor/pdf-editor-app.tsx`).
 *
 * A plain string scan of `package.json`, not a `pnpm why` shell-out — this
 * runs in `pnpm test`, which has no guarantee of a populated `node_modules`
 * or network access, so it only asserts what this repo controls directly:
 * its own declared dependencies.
 */
const BANNED_PACKAGES = [
  "@embedpdf/plugin-form",
  "@embedpdf/snippet",
  "@embedpdf/react-pdf-viewer",
] as const;

describe("embedpdf banned packages", () => {
  it("package.json never declares a banned @embedpdf package", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const declared = new Set([
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
    ]);
    for (const banned of BANNED_PACKAGES) {
      expect(declared.has(banned), `${banned} must not be a dependency`).toBe(
        false,
      );
    }
  });

  it("pnpm-lock.yaml never resolves a banned @embedpdf package", () => {
    const lockfile = readFileSync("pnpm-lock.yaml", "utf8");
    for (const banned of BANNED_PACKAGES) {
      expect(
        lockfile.includes(banned),
        `${banned} must not appear in pnpm-lock.yaml`,
      ).toBe(false);
    }
  });
});
