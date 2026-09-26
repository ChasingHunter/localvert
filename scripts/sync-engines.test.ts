import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  resolvePackageDir,
  STATIC_LIMIT_BYTES,
  scanEngineSources,
  syncEngines,
} from "./sync-engines";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "sync-engines-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function writeFile(rootDir: string, relPath: string, content: string): void {
  const fullPath = join(rootDir, ...relPath.split("/"));
  mkdirSync(join(fullPath, ".."), { recursive: true });
  writeFileSync(fullPath, content);
}

function readFile(rootDir: string, relPath: string): string {
  return readFileSync(join(rootDir, ...relPath.split("/")), "utf8");
}

/** Writes a minimal npm package under `<rootDir>/node_modules/<pkg>/` with the given files' contents. */
function writePackage(
  rootDir: string,
  pkg: string,
  version: string,
  files: Record<string, string>,
  extraPackageJson: Record<string, unknown> = {},
): void {
  writeFile(
    rootDir,
    `node_modules/${pkg}/package.json`,
    JSON.stringify({ name: pkg, version, ...extraPackageJson }),
  );
  for (const [path, content] of Object.entries(files)) {
    writeFile(rootDir, `node_modules/${pkg}/${path}`, content);
  }
}

/**
 * Writes a minimal `src/lib/engines/<id>/engine.json` (+ a stub
 * `adapter.ts`, though this script never reads it). No `version`/`assets` —
 * this script (like the real engine.json contract for a "static"/"r2"
 * engine) derives the version from the installed `package` and never reads
 * or writes asset sizes.
 */
function writeEngine(
  rootDir: string,
  id: string,
  overrides: Partial<Record<string, unknown>> = {},
): void {
  writeFile(
    rootDir,
    `src/lib/engines/${id}/engine.json`,
    `${JSON.stringify(
      {
        id,
        license: "MIT",
        location: "static",
        needsIsolation: false,
        heavy: false,
        ...overrides,
      },
      null,
      2,
    )}\n`,
  );
  writeFile(
    rootDir,
    `src/lib/engines/${id}/adapter.ts`,
    "export default {};\n",
  );
}

// ---------------------------------------------------------------------------
// syncEngines
// ---------------------------------------------------------------------------

describe("syncEngines", () => {
  it("is a no-op when there are no static/r2 engines", () => {
    const dir = makeTempDir();
    writeEngine(dir, "canvas", { location: "native" });
    writeEngine(dir, "resvg", { location: "bundled" });

    const result = syncEngines(dir);

    expect(result).toEqual({
      engines: [],
      removedStaleDirs: [],
      warnings: [],
    });
    expect(existsSync(join(dir, "public", "engines"))).toBe(false);
  });

  it("is a no-op on a repo with zero engines at all", () => {
    const dir = makeTempDir();
    expect(syncEngines(dir).engines).toEqual([]);
  });

  it("copies a static engine's files to public/engines/<id>@<installedVersion>/", () => {
    const dir = makeTempDir();
    writePackage(dir, "@acme/foo", "1.2.3", {
      "codec/foo.wasm": "0123456789", // 10 bytes
    });
    writeEngine(dir, "foo", {
      package: "@acme/foo",
      files: [{ from: "codec/foo.wasm", to: "foo.wasm" }],
    });

    const result = syncEngines(dir);

    expect(result.engines).toEqual([
      {
        id: "foo",
        version: "1.2.3",
        location: "static",
        files: [{ path: "foo.wasm", bytes: 10 }],
      },
    ]);
    expect(readFile(dir, "public/engines/foo@1.2.3/foo.wasm")).toBe(
      "0123456789",
    );
  });

  it("a bump of the installed package's version alone moves the destination path — no engine.json edit", () => {
    const dir = makeTempDir();
    writePackage(dir, "@acme/foo", "1.2.3", { "foo.wasm": "old" });
    writeEngine(dir, "foo", {
      package: "@acme/foo",
      files: [{ from: "foo.wasm", to: "foo.wasm" }],
    });
    syncEngines(dir);
    expect(existsSync(join(dir, "public", "engines", "foo@1.2.3"))).toBe(true);

    // Simulate a Dependabot bump: only node_modules changes.
    writePackage(dir, "@acme/foo", "1.3.0", { "foo.wasm": "new" });
    const result = syncEngines(dir);

    expect(result.engines[0]?.version).toBe("1.3.0");
    expect(readFile(dir, "public/engines/foo@1.3.0/foo.wasm")).toBe("new");
    // The stale old-version dir is cleaned up too (existing behavior).
    expect(existsSync(join(dir, "public", "engines", "foo@1.2.3"))).toBe(false);
  });

  it("a file entry's own \"package\" borrows from a different npm package than the engine's own", () => {
    const dir = makeTempDir();
    writePackage(dir, "@acme/foo", "1.2.3", {
      "codec/foo.wasm": "0123456789", // 10 bytes
    });
    writePackage(dir, "@acme/foo-data", "9.9.9", {
      "data/foo.dat": "hello", // 5 bytes
    });
    writeEngine(dir, "foo", {
      package: "@acme/foo",
      files: [
        { from: "codec/foo.wasm", to: "foo.wasm" },
        {
          from: "data/foo.dat",
          to: "foo.dat",
          package: "@acme/foo-data",
        },
      ],
    });

    const result = syncEngines(dir);

    expect(result.engines).toEqual([
      {
        id: "foo",
        version: "1.2.3",
        location: "static",
        files: [
          { path: "foo.dat", bytes: 5 },
          { path: "foo.wasm", bytes: 10 },
        ],
      },
    ]);
    expect(readFile(dir, "public/engines/foo@1.2.3/foo.wasm")).toBe(
      "0123456789",
    );
    expect(readFile(dir, "public/engines/foo@1.2.3/foo.dat")).toBe("hello");
    // The engine's own version comes from "@acme/foo" alone — "@acme/foo-data"
    // (9.9.9) never factors into it.
  });

  it("copies an r2 engine's files to .engines-r2/xl/<id>@<version>/", () => {
    const dir = makeTempDir();
    writePackage(dir, "@acme/bar", "0.9.0", {
      "core/bar.wasm": "x".repeat(50),
    });
    writeEngine(dir, "bar", {
      location: "r2",
      package: "@acme/bar",
      files: [{ from: "core/bar.wasm", to: "bar.wasm" }],
    });

    // A tiny limit forces the r2 file to register as "over the static
    // threshold" so the "all files under the limit" warning doesn't fire —
    // isolates this test to the copy behavior alone.
    const result = syncEngines(dir, 10);

    expect(existsSync(join(dir, "public", "engines"))).toBe(false);
    expect(readFile(dir, ".engines-r2/xl/bar@0.9.0/bar.wasm")).toBe(
      "x".repeat(50),
    );
    expect(result.engines).toEqual([
      {
        id: "bar",
        version: "0.9.0",
        location: "r2",
        files: [{ path: "bar.wasm", bytes: 50 }],
      },
    ]);
    expect(result.warnings).toEqual([]);
  });

  it('copies a directory entry ("from"/"to" both ending in "/") recursively, one asset per file', () => {
    const dir = makeTempDir();
    writePackage(dir, "@acme/cmaps-pkg", "1.0.0", {
      "cmaps/Foo.bcmap": "cmap-a", // 6 bytes
      "cmaps/nested/Bar.bcmap": "cmap-b", // 6 bytes
    });
    writeEngine(dir, "withcmaps", {
      package: "@acme/cmaps-pkg",
      files: [{ from: "cmaps/", to: "cmaps/" }],
    });

    const result = syncEngines(dir);

    expect(result.engines).toEqual([
      {
        id: "withcmaps",
        version: "1.0.0",
        location: "static",
        files: [
          { path: "cmaps/Foo.bcmap", bytes: 6 },
          { path: "cmaps/nested/Bar.bcmap", bytes: 6 },
        ],
      },
    ]);
    expect(
      readFile(dir, "public/engines/withcmaps@1.0.0/cmaps/Foo.bcmap"),
    ).toBe("cmap-a");
    expect(
      readFile(dir, "public/engines/withcmaps@1.0.0/cmaps/nested/Bar.bcmap"),
    ).toBe("cmap-b");
  });

  it('fails when a directory entry\'s "from"/"to" don\'t both end with "/"', () => {
    const dir = makeTempDir();
    writePackage(dir, "@acme/cmaps-pkg", "1.0.0", {
      "cmaps/Foo.bcmap": "x",
    });
    writeEngine(dir, "badcmaps", {
      package: "@acme/cmaps-pkg",
      files: [{ from: "cmaps/", to: "cmaps" }],
    });

    expect(() => syncEngines(dir)).toThrow(
      /directory entry's "from" and "to" must both end with "\/"/,
    );
  });

  it("fails a static file over the (injectable) size limit, naming the file and the fix", () => {
    const dir = makeTempDir();
    writePackage(dir, "@acme/foo", "1.0.0", { "foo.wasm": "0123456789" }); // 10 bytes
    writeEngine(dir, "foo", {
      package: "@acme/foo",
      files: [{ from: "foo.wasm", to: "foo.wasm" }],
    });

    expect(() => syncEngines(dir, 5)).toThrow(
      /foo\/foo\.wasm is .* MiB; static assets are capped at 25 MiB by Cloudflare — set location to r2/,
    );
  });

  it("does not fail a static file at or under the size limit", () => {
    const dir = makeTempDir();
    writePackage(dir, "@acme/foo", "1.0.0", { "foo.wasm": "0123456789" }); // 10 bytes
    writeEngine(dir, "foo", {
      package: "@acme/foo",
      files: [{ from: "foo.wasm", to: "foo.wasm" }],
    });

    expect(() => syncEngines(dir, 10)).not.toThrow();
  });

  it("warns (does not fail) when every file of an r2 engine is under the limit", () => {
    const dir = makeTempDir();
    writePackage(dir, "@acme/bar", "1.0.0", { "bar.wasm": "small" });
    writeEngine(dir, "bar", {
      location: "r2",
      package: "@acme/bar",
      files: [{ from: "bar.wasm", to: "bar.wasm" }],
    });

    const result = syncEngines(dir, STATIC_LIMIT_BYTES);

    expect(result.warnings).toEqual([
      'engine "bar" is r2 but every file is under 20.0 MiB — consider setting location to "static".',
    ]);
  });

  it("removes a stale public/engines/<id>@<oldVersion> dir for an engine we own", () => {
    const dir = makeTempDir();
    writeFile(dir, "public/engines/foo@0.9.0/foo.wasm", "old");
    writePackage(dir, "@acme/foo", "1.0.0", { "foo.wasm": "new-bytes" });
    writeEngine(dir, "foo", {
      package: "@acme/foo",
      files: [{ from: "foo.wasm", to: "foo.wasm" }],
    });

    const result = syncEngines(dir);

    expect(result.removedStaleDirs).toEqual(["foo@0.9.0"]);
    expect(existsSync(join(dir, "public", "engines", "foo@0.9.0"))).toBe(false);
    expect(existsSync(join(dir, "public", "engines", "foo@1.0.0"))).toBe(true);
  });

  it("leaves an unrelated public/engines directory alone", () => {
    const dir = makeTempDir();
    writeFile(dir, "public/engines/other@1.0.0/other.wasm", "untouched");
    writeEngine(dir, "canvas", { location: "native" });

    const result = syncEngines(dir);

    expect(result.removedStaleDirs).toEqual([]);
    expect(existsSync(join(dir, "public", "engines", "other@1.0.0"))).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// scanEngineSources
// ---------------------------------------------------------------------------

describe("scanEngineSources", () => {
  it("returns an empty list when src/lib/engines doesn't exist", () => {
    expect(scanEngineSources(makeTempDir())).toEqual([]);
  });

  it("reads id/location/package/files, sorted by id — no version field", () => {
    const dir = makeTempDir();
    writeEngine(dir, "zeta", { location: "native" });
    writeEngine(dir, "alpha", {
      package: "@acme/alpha",
      files: [{ from: "a.wasm", to: "a.wasm" }],
    });

    const sources = scanEngineSources(dir);
    expect(sources.map((s) => s.id)).toEqual(["alpha", "zeta"]);
    expect(sources.every((s) => !("version" in s))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resolvePackageDir
// ---------------------------------------------------------------------------

describe("resolvePackageDir", () => {
  it("resolves an installed package's directory", () => {
    const dir = makeTempDir();
    writePackage(dir, "@acme/foo", "1.0.0", { "foo.wasm": "x" });

    expect(resolvePackageDir("@acme/foo", dir)).toBe(
      join(dir, "node_modules", "@acme", "foo"),
    );
  });

  it('falls back to the conventional node_modules layout when "exports" blocks package.json', () => {
    const dir = makeTempDir();
    // An "exports" map with no "./package.json" subpath makes
    // require.resolve("pkg/package.json") throw even though the package is
    // installed — this is the case the fallback exists for.
    writePackage(
      dir,
      "@acme/blocked",
      "1.0.0",
      { "index.js": "module.exports = {};\n" },
      { exports: { ".": "./index.js" } },
    );

    expect(resolvePackageDir("@acme/blocked", dir)).toBe(
      join(dir, "node_modules", "@acme", "blocked"),
    );
  });

  it("throws when the package isn't installed at all", () => {
    const dir = makeTempDir();
    expect(() => resolvePackageDir("@acme/missing", dir)).toThrow(
      /cannot resolve package "@acme\/missing"/,
    );
  });
});
