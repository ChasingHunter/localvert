import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

/**
 * The invariants from docs/ARCHITECTURE.md, asserted wherever they are
 * mechanically checkable.
 *
 * These are deliberately about *configuration*, not behaviour. Each one is a
 * single line someone could delete during a refactor without any test failing
 * and without the app visibly breaking — which is exactly the failure mode
 * worth a test. The app would keep working locally and quietly stop being the
 * product.
 *
 * Coverage grows as each invariant becomes checkable:
 *   - invariant 1 (no network I/O) → the header CSP in public/_headers
 *     (below), plus a Playwright request interceptor during a real
 *     conversion (0.9)
 *   - invariant 3 (no engine in core) → scripts/check-sizes.ts (Phase 0.7)
 *   - invariant 5 (300 KB budget)    → scripts/check-sizes.ts (Phase 0.7)
 */
describe("architecture invariants", () => {
  it("builds as a static export (invariant 4)", () => {
    expect(nextConfig.output).toBe("export");
  });

  it("does not optimize images on a nonexistent server", () => {
    // A static export has no image optimizer. Leaving this unset makes
    // `next build` fail late and confusingly rather than never.
    expect(nextConfig.images?.unoptimized).toBe(true);
  });

  it("keeps typechecking as its own gate, not part of the build", () => {
    // `pnpm verify` and CI run `tsc --noEmit` before the build. If this ever
    // flips to false, the build silently doubles the slowest step for no
    // extra signal.
    expect(nextConfig.typescript?.ignoreBuildErrors).toBe(true);
  });
});

describe("security headers (public/_headers)", () => {
  // The `/*` block applies to every response. It's delimited by the next
  // path block in the file, so slice out just that block rather than
  // matching the whole file — the cache-control blocks below it are allowed
  // to (and do) omit these headers.
  const headersPath = fileURLToPath(
    new URL("../../public/_headers", import.meta.url),
  );
  const headersFile = readFileSync(headersPath, "utf8");
  const rootBlock = headersFile.slice(
    headersFile.indexOf("\n/*"),
    headersFile.indexOf("\n/_next/static/*"),
  );

  function headerValue(name: string): string {
    const line = rootBlock
      .split("\n")
      .find((l) => l.trim().startsWith(`${name}:`));
    if (!line) {
      throw new Error(`"${name}" header missing from the /* block`);
    }
    return line.slice(line.indexOf(":") + 1).trim();
  }

  it("never widens connect-src beyond 'self' and blob: (invariant 1)", () => {
    const csp = headerValue("Content-Security-Policy");
    const connectSrc = csp
      .split(";")
      .map((directive) => directive.trim())
      .find((directive) => directive.startsWith("connect-src"));
    expect(connectSrc).toBe("connect-src 'self' blob:");
  });

  it("locks down the directives that guard against exfiltration and framing", () => {
    const csp = headerValue("Content-Security-Policy");
    for (const directive of [
      "default-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
      "form-action 'none'",
    ]) {
      expect(csp).toContain(directive);
    }
  });

  it("sets cross-origin isolation headers, matching next.config.ts's dev headers", () => {
    expect(headerValue("Cross-Origin-Opener-Policy")).toBe("same-origin");
    expect(headerValue("Cross-Origin-Embedder-Policy")).toBe("require-corp");
  });
});
