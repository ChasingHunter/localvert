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
 *   - invariant 1 (no network I/O) → the CSP in public/_headers (Phase 0.6),
 *     plus a Playwright request interceptor during a real conversion (0.9)
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
