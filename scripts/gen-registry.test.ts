import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertNoDuplicateIds,
  type EngineMetaLike,
  genEngineIds,
  genEngineLoaders,
  genEngineManifest,
  generate,
  genToolsIndex,
  genToolsLoaders,
  parseEngineMeta,
  scanEngines,
  scanTools,
} from "./gen-registry";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

/** A fresh temp directory, cleaned up in `afterEach`. */
function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "gen-registry-test-"));
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

/** Writes a minimal npm package under `<rootDir>/node_modules/<pkg>/` with the given files' contents. */
function writePackage(
  rootDir: string,
  pkg: string,
  version: string,
  files: Record<string, string>,
): void {
  writeFile(
    rootDir,
    `node_modules/${pkg}/package.json`,
    JSON.stringify({ name: pkg, version }),
  );
  for (const [path, content] of Object.entries(files)) {
    writeFile(rootDir, `node_modules/${pkg}/${path}`, content);
  }
}

/**
 * Default `location` is "static", so `package`/`files` are included by
 * default too — otherwise every existing call site unrelated to those two
 * fields would fail validation for the wrong reason. A caller that wants a
 * "native" engine.json (no `package`/`files` allowed, hand-written
 * `version`) overrides both to `undefined` (dropped by `JSON.stringify`) and
 * sets `version`.
 */
function engineJson(overrides: Partial<Record<string, unknown>> = {}): string {
  return JSON.stringify({
    id: "foo",
    license: "MIT",
    location: "static",
    package: "@acme/foo",
    files: [{ from: "foo.wasm", to: "foo.wasm" }],
    needsIsolation: false,
    heavy: false,
    ...overrides,
  });
}

/**
 * A fixture with two tools (in different categories) and three engines, one
 * per `location` — the shape most of the tests below scan. Each static/r2
 * engine gets a matching `node_modules` package so version/asset resolution
 * has something real to read.
 */
function makeFullFixture(): string {
  const dir = makeTempDir();

  writeFile(dir, "src/tools/image/a-to-b.ts", "export default {};\n");
  writeFile(dir, "src/tools/image/a-to-b.test.ts", "// skipped\n");
  writeFile(dir, "src/tools/image/index.ts", "// skipped\n");
  writeFile(dir, "src/tools/pdf/merge-pdf.ts", "export default {};\n");

  writeFile(
    dir,
    "src/lib/engines/bar/engine.json",
    engineJson({
      id: "bar",
      version: "1.0.0",
      location: "native",
      package: undefined,
      files: undefined,
    }),
  );
  writeFile(dir, "src/lib/engines/bar/adapter.ts", "export default {};\n");

  writePackage(dir, "@acme/baz", "2.1.0", {
    "codec/baz.wasm": "x".repeat(2000),
    "codec/baz.data": "x".repeat(500),
  });
  writeFile(
    dir,
    "src/lib/engines/baz/engine.json",
    engineJson({
      id: "baz",
      license: "Apache-2.0",
      location: "r2",
      package: "@acme/baz",
      files: [
        { from: "codec/baz.wasm", to: "baz.wasm" },
        { from: "codec/baz.data", to: "baz.data" },
      ],
      needsIsolation: true,
      heavy: true,
    }),
  );
  writeFile(dir, "src/lib/engines/baz/adapter.ts", "export default {};\n");

  writePackage(dir, "@acme/foo", "1.2.3", {
    "foo.wasm": "x".repeat(1024),
  });
  writeFile(
    dir,
    "src/lib/engines/foo/engine.json",
    engineJson({ id: "foo", location: "static" }),
  );
  writeFile(dir, "src/lib/engines/foo/adapter.ts", "export default {};\n");

  return dir;
}

function get(files: Map<string, string>, path: string): string {
  return files.get(path) ?? "";
}

// ---------------------------------------------------------------------------
// scanTools / genToolsIndex
// ---------------------------------------------------------------------------

describe("scanTools", () => {
  it("returns an empty list when src/tools doesn't exist", () => {
    expect(scanTools(makeTempDir())).toEqual([]);
  });

  it("skips *.test.ts and index.ts", () => {
    const dir = makeFullFixture();
    const slugs = scanTools(dir).map((t) => t.slug);
    expect(slugs).not.toContain("a-to-b.test");
    expect(slugs).not.toContain("index");
  });

  it("sorts by category then filename", () => {
    const dir = makeFullFixture();
    const tools = scanTools(dir);
    expect(tools.map((t) => `${t.category}/${t.slug}`)).toEqual([
      "image/a-to-b",
      "pdf/merge-pdf",
    ]);
  });
});

describe("genToolsIndex", () => {
  it("emits an empty, still-valid TOOLS array for zero tools", () => {
    const out = genToolsIndex([]);
    expect(out).toContain(
      "export const TOOLS: readonly ToolDefinition[] = [];",
    );
    expect(out).toContain(
      "// GENERATED by scripts/gen-registry.ts — do not edit. Run `pnpm gen`.",
    );
  });

  it("emits a sorted, camelCased default import per tool", () => {
    const dir = makeFullFixture();
    const out = genToolsIndex(scanTools(dir));
    expect(out).toContain('import aToB from "@/tools/image/a-to-b";');
    expect(out).toContain('import mergePdf from "@/tools/pdf/merge-pdf";');
    expect(out).toContain(
      "export const TOOLS: readonly ToolDefinition[] = [aToB, mergePdf];",
    );
    expect(out).toContain(
      "export const TOOLS_BY_SLUG: ReadonlyMap<string, ToolDefinition> = new Map(",
    );
  });
});

describe("genToolsLoaders", () => {
  it("is an empty, still-valid loader map for zero tools", () => {
    const out = genToolsLoaders([]);
    expect(out).toContain("export const TOOL_LOADERS = {} satisfies Record<");
  });

  it("imports each tool by its own category/slug relative path", () => {
    const dir = makeFullFixture();
    const out = genToolsLoaders(scanTools(dir));
    expect(out).toContain('"a-to-b": () => import("./image/a-to-b"),');
    expect(out).toContain('"merge-pdf": () => import("./pdf/merge-pdf"),');
  });
});

// ---------------------------------------------------------------------------
// parseEngineMeta / scanEngines validation
// ---------------------------------------------------------------------------

describe("parseEngineMeta", () => {
  it('parses a valid static engine.json — no version, derived from "package"', () => {
    const meta = parseEngineMeta("foo", engineJson());
    expect(meta).toEqual({
      id: "foo",
      license: "MIT",
      location: "static",
      needsIsolation: false,
      heavy: false,
      package: "@acme/foo",
      files: [{ from: "foo.wasm", to: "foo.wasm" }],
    });
  });

  it("parses a native engine.json with a hand-written version, no package/files", () => {
    const meta = parseEngineMeta(
      "foo",
      engineJson({
        location: "native",
        version: "1.0.0",
        package: undefined,
        files: undefined,
      }),
    );
    expect(meta).toEqual({
      id: "foo",
      version: "1.0.0",
      license: "MIT",
      location: "native",
      needsIsolation: false,
      heavy: false,
    });
  });

  it("rejects an id that doesn't match the directory name", () => {
    expect(() => parseEngineMeta("foo", engineJson({ id: "wrong" }))).toThrow(
      /"id".*must match its directory name/,
    );
  });

  it("rejects an unknown location", () => {
    expect(() =>
      parseEngineMeta("foo", engineJson({ location: "cdn" })),
    ).toThrow(/"location".*must be one of/);
  });

  it("rejects a non-boolean needsIsolation", () => {
    expect(() =>
      parseEngineMeta("foo", engineJson({ needsIsolation: "yes" })),
    ).toThrow(/"needsIsolation" must be a boolean/);
  });

  it('rejects "assets" in engine.json — sizes are computed, never hand-written', () => {
    expect(() => parseEngineMeta("foo", engineJson({ assets: [] }))).toThrow(
      /"assets" is not allowed in engine\.json/,
    );
  });

  it.each(["static", "r2"] as const)(
    'requires "package" when location is "%s"',
    (location) => {
      expect(() =>
        parseEngineMeta("foo", engineJson({ location, package: undefined })),
      ).toThrow(/"package" is required when location is/);
    },
  );

  it.each(["static", "r2"] as const)(
    'requires "files" when location is "%s"',
    (location) => {
      expect(() =>
        parseEngineMeta("foo", engineJson({ location, files: undefined })),
      ).toThrow(/"files" is required when location is/);
    },
  );

  it('rejects an empty "files" array', () => {
    expect(() => parseEngineMeta("foo", engineJson({ files: [] }))).toThrow(
      /"files" is required.*non-empty array/,
    );
  });

  it('rejects a "files" entry missing "to"', () => {
    expect(() =>
      parseEngineMeta("foo", engineJson({ files: [{ from: "x.wasm" }] })),
    ).toThrow(/"files\[0\]\.to" must be a non-empty string/);
  });

  it('parses a "files" entry with its own "package" override', () => {
    const meta = parseEngineMeta(
      "foo",
      engineJson({
        files: [
          { from: "foo.wasm", to: "foo.wasm" },
          { from: "data.bin", to: "data.bin", package: "@acme/foo-data" },
        ],
      }),
    );
    expect(meta.files).toEqual([
      { from: "foo.wasm", to: "foo.wasm" },
      { from: "data.bin", to: "data.bin", package: "@acme/foo-data" },
    ]);
  });

  it('rejects a "files" entry whose "package" is not a string', () => {
    expect(() =>
      parseEngineMeta(
        "foo",
        engineJson({ files: [{ from: "x.wasm", to: "x.wasm", package: 5 }] }),
      ),
    ).toThrow(/"files\[0\]\.package" must be a string/);
  });

  it('forbids "package" when location is "native"', () => {
    expect(() =>
      parseEngineMeta(
        "foo",
        engineJson({ location: "native", version: "1.0.0", files: undefined }),
      ),
    ).toThrow(/"package" is not allowed when location is "native"/);
  });

  it('forbids "files" when location is "native"', () => {
    expect(() =>
      parseEngineMeta(
        "foo",
        engineJson({
          location: "native",
          version: "1.0.0",
          package: undefined,
        }),
      ),
    ).toThrow(/"files" is not allowed when location is "native"/);
  });

  it('rejects "version" when location is "static" — it is derived from "package"', () => {
    expect(() =>
      parseEngineMeta("foo", engineJson({ version: "1.0.0" })),
    ).toThrow(/"version" is not allowed when location is "static"/);
  });

  it('rejects "versionFrom" when location is "static"', () => {
    expect(() =>
      parseEngineMeta("foo", engineJson({ versionFrom: "@acme/other" })),
    ).toThrow(/"versionFrom" is not allowed when location is "static"/);
  });

  it("rejects a native engine.json with no version", () => {
    expect(() =>
      parseEngineMeta(
        "foo",
        engineJson({
          location: "native",
          package: undefined,
          files: undefined,
        }),
      ),
    ).toThrow(/"version".*must be semver/);
  });

  it("rejects a non-semver version on a native engine", () => {
    expect(() =>
      parseEngineMeta(
        "foo",
        engineJson({
          location: "native",
          version: "v1",
          package: undefined,
          files: undefined,
        }),
      ),
    ).toThrow(/"version".*must be semver/);
  });

  it('forbids "versionFrom" when location is "native"', () => {
    expect(() =>
      parseEngineMeta(
        "foo",
        engineJson({
          location: "native",
          version: "1.0.0",
          versionFrom: "@acme/other",
          package: undefined,
          files: undefined,
        }),
      ),
    ).toThrow(/"versionFrom" is not allowed when location is "native"/);
  });

  it("parses a bundled engine.json with a hand-written version (our own code)", () => {
    const meta = parseEngineMeta(
      "foo",
      engineJson({
        location: "bundled",
        version: "1.0.0",
        package: undefined,
        files: undefined,
      }),
    );
    expect(meta).toEqual({
      id: "foo",
      version: "1.0.0",
      license: "MIT",
      location: "bundled",
      needsIsolation: false,
      heavy: false,
    });
  });

  it('parses a bundled engine.json with "versionFrom" (tracks an npm package\'s version)', () => {
    const meta = parseEngineMeta(
      "foo",
      engineJson({
        location: "bundled",
        versionFrom: "heic-to",
        package: undefined,
        files: undefined,
      }),
    );
    expect(meta).toEqual({
      id: "foo",
      versionFrom: "heic-to",
      license: "MIT",
      location: "bundled",
      needsIsolation: false,
      heavy: false,
    });
  });

  it('rejects a "bundled" engine.json with neither "version" nor "versionFrom"', () => {
    expect(() =>
      parseEngineMeta(
        "foo",
        engineJson({
          location: "bundled",
          package: undefined,
          files: undefined,
        }),
      ),
    ).toThrow(/needs exactly one of "version".*or "versionFrom"/);
  });

  it('rejects a "bundled" engine.json with both "version" and "versionFrom"', () => {
    expect(() =>
      parseEngineMeta(
        "foo",
        engineJson({
          location: "bundled",
          version: "1.0.0",
          versionFrom: "heic-to",
          package: undefined,
          files: undefined,
        }),
      ),
    ).toThrow(/needs exactly one of "version".*or "versionFrom"/);
  });

  it('forbids "package" when location is "bundled"', () => {
    expect(() =>
      parseEngineMeta(
        "foo",
        engineJson({ location: "bundled", version: "1.0.0", files: undefined }),
      ),
    ).toThrow(/"package" is not allowed when location is "bundled"/);
  });

  it('forbids "files" when location is "bundled"', () => {
    expect(() =>
      parseEngineMeta(
        "foo",
        engineJson({
          location: "bundled",
          version: "1.0.0",
          package: undefined,
        }),
      ),
    ).toThrow(/"files" is not allowed when location is "bundled"/);
  });
});

describe("scanEngines", () => {
  it("returns an empty list when src/lib/engines doesn't exist", () => {
    expect(scanEngines(makeTempDir())).toEqual([]);
  });

  it("ignores a subdirectory with neither engine.json nor adapter.ts", () => {
    const dir = makeTempDir();
    writeFile(dir, "src/lib/engines/scratch/notes.txt", "wip\n");
    expect(scanEngines(dir)).toEqual([]);
  });

  it("errors when a directory has engine.json but no adapter.ts", () => {
    const dir = makeTempDir();
    writeFile(dir, "src/lib/engines/foo/engine.json", engineJson());
    expect(() => scanEngines(dir)).toThrow(
      /engine "foo" has engine\.json but no adapter\.ts/,
    );
  });

  it("errors when a directory has adapter.ts but no engine.json", () => {
    const dir = makeTempDir();
    writeFile(dir, "src/lib/engines/foo/adapter.ts", "export default {};\n");
    expect(() => scanEngines(dir)).toThrow(
      /engine "foo" has adapter\.ts but no engine\.json/,
    );
  });

  it("returns metadata for every valid engine directory, sorted", () => {
    const dir = makeFullFixture();
    expect(scanEngines(dir).map((m) => m.id)).toEqual(["bar", "baz", "foo"]);
  });

  it("derives a static engine's version from the installed package, not engine.json", () => {
    const dir = makeFullFixture();
    const foo = scanEngines(dir).find((m) => m.id === "foo");
    expect(foo?.version).toBe("1.2.3");
  });

  it("derives an r2 engine's version from the installed package", () => {
    const dir = makeFullFixture();
    const baz = scanEngines(dir).find((m) => m.id === "baz");
    expect(baz?.version).toBe("2.1.0");
  });

  it("computes a static engine's asset sizes by statting the source package, no copy needed", () => {
    const dir = makeFullFixture();
    const foo = scanEngines(dir).find((m) => m.id === "foo");
    expect(foo?.assets).toEqual([{ path: "foo.wasm", bytes: 1024 }]);
  });

  it('computes bytes for a directory entry ("from"/"to" both ending in "/"), one asset per file', () => {
    const dir = makeTempDir();
    writePackage(dir, "@acme/cmaps-pkg", "1.0.0", {
      "cmaps/Foo.bcmap": "cmap-a", // 6 bytes
      "cmaps/nested/Bar.bcmap": "cmap-b", // 6 bytes
    });
    writeFile(
      dir,
      "src/lib/engines/withcmaps/engine.json",
      engineJson({
        id: "withcmaps",
        package: "@acme/cmaps-pkg",
        files: [{ from: "cmaps/", to: "cmaps/" }],
      }),
    );
    writeFile(
      dir,
      "src/lib/engines/withcmaps/adapter.ts",
      "export default {};\n",
    );

    const [meta] = scanEngines(dir);
    if (!meta) throw new Error("expected exactly one engine");
    expect(meta.version).toBe("1.0.0");
    expect(meta.assets).toEqual([
      { path: "cmaps/Foo.bcmap", bytes: 6 },
      { path: "cmaps/nested/Bar.bcmap", bytes: 6 },
    ]);
  });

  it("a file entry's own \"package\" borrows bytes from a different npm package than the engine's own", () => {
    const dir = makeTempDir();
    writePackage(dir, "@acme/foo", "1.2.3", { "codec/foo.wasm": "0123456789" });
    writePackage(dir, "@acme/foo-data", "9.9.9", { "data/foo.dat": "hello" });
    writeFile(
      dir,
      "src/lib/engines/foo/engine.json",
      engineJson({
        id: "foo",
        package: "@acme/foo",
        files: [
          { from: "codec/foo.wasm", to: "foo.wasm" },
          { from: "data/foo.dat", to: "foo.dat", package: "@acme/foo-data" },
        ],
      }),
    );
    writeFile(dir, "src/lib/engines/foo/adapter.ts", "export default {};\n");

    const [meta] = scanEngines(dir);
    if (!meta) throw new Error("expected exactly one engine");
    // Version comes from the engine's own "package" alone — "@acme/foo-data"
    // (9.9.9) never factors in.
    expect(meta.version).toBe("1.2.3");
    expect(meta.assets).toEqual([
      { path: "foo.dat", bytes: 5 },
      { path: "foo.wasm", bytes: 10 },
    ]);
  });

  it("derives a bundled engine's version from \"versionFrom\"'s installed package", () => {
    const dir = makeTempDir();
    writePackage(dir, "heic-to", "1.5.2", { "index.js": "x" });
    writeFile(
      dir,
      "src/lib/engines/heic/engine.json",
      engineJson({
        id: "heic",
        location: "bundled",
        versionFrom: "heic-to",
        package: undefined,
        files: undefined,
      }),
    );
    writeFile(dir, "src/lib/engines/heic/adapter.ts", "export default {};\n");

    const [meta] = scanEngines(dir);
    if (!meta) throw new Error("expected exactly one engine");
    expect(meta.version).toBe("1.5.2");
    expect(meta.assets).toEqual([]);
  });

  it("keeps a bundled engine's hand-written version when there's no versionFrom", () => {
    const dir = makeTempDir();
    writeFile(
      dir,
      "src/lib/engines/exif/engine.json",
      engineJson({
        id: "exif",
        location: "bundled",
        version: "1.0.0",
        package: undefined,
        files: undefined,
      }),
    );
    writeFile(dir, "src/lib/engines/exif/adapter.ts", "export default {};\n");

    const [meta] = scanEngines(dir);
    if (!meta) throw new Error("expected exactly one engine");
    expect(meta.version).toBe("1.0.0");
  });

  it("fails with a clear message when the declared package isn't installed", () => {
    const dir = makeTempDir();
    writeFile(
      dir,
      "src/lib/engines/foo/engine.json",
      engineJson({ id: "foo", package: "@acme/missing" }),
    );
    writeFile(dir, "src/lib/engines/foo/adapter.ts", "export default {};\n");

    expect(() => scanEngines(dir)).toThrow(
      /cannot resolve package "@acme\/missing"/,
    );
  });
});

describe("assertNoDuplicateIds", () => {
  function meta(id: string): EngineMetaLike {
    return {
      id,
      version: "1.0.0",
      license: "MIT",
      location: "native",
      needsIsolation: false,
      heavy: false,
      assets: [],
    };
  }

  it("does not throw for unique ids", () => {
    expect(() =>
      assertNoDuplicateIds([meta("foo"), meta("bar")]),
    ).not.toThrow();
  });

  it("throws when two engines share an id", () => {
    expect(() => assertNoDuplicateIds([meta("foo"), meta("foo")])).toThrow(
      /duplicate engine id "foo"/,
    );
  });
});

// ---------------------------------------------------------------------------
// genEngineIds / genEngineManifest / genEngineLoaders
// ---------------------------------------------------------------------------

describe("genEngineIds", () => {
  it("is 'never' for zero engines", () => {
    expect(genEngineIds([])).toContain("export type EngineId = never;");
  });

  it("unions ids alphabetically", () => {
    const dir = makeFullFixture();
    const out = genEngineIds(scanEngines(dir));
    expect(out).toContain('export type EngineId = "bar" | "baz" | "foo";');
  });
});

describe("genEngineManifest", () => {
  it("is an empty, still-valid manifest for zero engines", () => {
    const out = genEngineManifest([]);
    expect(out).toContain(
      "export const ENGINE_MANIFEST = {} as const satisfies Record<",
    );
  });

  it('never contains the substring "adapter" — main-thread-safe, no adapter import', () => {
    const dir = makeFullFixture();
    const out = genEngineManifest(scanEngines(dir));
    expect(out).not.toContain("adapter");
  });

  it("omits package/files — the main thread doesn't need them", () => {
    const dir = makeFullFixture();
    const out = genEngineManifest(scanEngines(dir));
    expect(out).not.toContain("package");
    expect(out).not.toContain("files");
  });

  it("computes baseUrl per location, using the derived version", () => {
    const dir = makeFullFixture();
    const out = genEngineManifest(scanEngines(dir));
    expect(out).toContain('baseUrl: "",'); // bar: native
    expect(out).toContain('baseUrl: "/engines/foo@1.2.3/",'); // foo: static
    expect(out).toContain('baseUrl: "/engines/xl/baz@2.1.0/",'); // baz: r2
  });

  it("sums each engine's asset bytes into totalBytes", () => {
    const dir = makeFullFixture();
    const out = genEngineManifest(scanEngines(dir));
    expect(out).toContain("totalBytes: 2500,"); // baz: 2000 + 500
    expect(out).toContain("totalBytes: 1024,"); // foo: single asset
    expect(out).toContain("totalBytes: 0,"); // bar: no assets
  });

  it("computes an empty baseUrl for a bundled engine, same as native", () => {
    const out = genEngineManifest([
      {
        id: "qux",
        version: "1.0.0",
        license: "MIT",
        location: "bundled",
        needsIsolation: false,
        heavy: false,
        assets: [],
      },
    ]);
    expect(out).toContain('baseUrl: "",');
  });

  it("quotes a hyphenated engine id as an object key — a bare `jsquash-jpeg:` would parse as subtraction, not a property name", () => {
    const out = genEngineManifest([
      {
        id: "jsquash-jpeg",
        version: "1.0.0",
        license: "MIT",
        location: "native",
        needsIsolation: false,
        heavy: false,
        assets: [],
      },
    ]);
    expect(out).toContain('"jsquash-jpeg": {');
    expect(out).not.toMatch(/[^"]jsquash-jpeg:\s*\{/);
  });
});

describe("genEngineLoaders", () => {
  it("is an empty, still-valid loader map for zero engines", () => {
    const out = genEngineLoaders([]);
    expect(out).toContain("export const ENGINE_LOADERS = {} satisfies Record<");
  });

  it("imports each engine's adapter by its own relative path", () => {
    const dir = makeFullFixture();
    const out = genEngineLoaders(scanEngines(dir));
    expect(out).toContain('bar: () => import("./bar/adapter"),');
    expect(out).toContain('baz: () => import("./baz/adapter"),');
    expect(out).toContain('foo: () => import("./foo/adapter"),');
  });

  it("quotes a hyphenated engine id as an object key", () => {
    const out = genEngineLoaders([
      {
        id: "jsquash-jpeg",
        version: "1.0.0",
        license: "MIT",
        location: "native",
        needsIsolation: false,
        heavy: false,
        assets: [],
      },
    ]);
    expect(out).toContain(
      '"jsquash-jpeg": () => import("./jsquash-jpeg/adapter"),',
    );
  });
});

// ---------------------------------------------------------------------------
// generate — full pipeline
// ---------------------------------------------------------------------------

describe("generate", () => {
  it("produces the five expected files for an empty repo", () => {
    const files = generate(makeTempDir());
    expect([...files.keys()].sort()).toEqual([
      "src/lib/engines/ids.ts",
      "src/lib/engines/loaders.ts",
      "src/lib/engines/manifest.ts",
      "src/tools/index.ts",
      "src/tools/loaders.ts",
    ]);
    expect(get(files, "src/tools/index.ts")).toContain(
      "export const TOOLS: readonly ToolDefinition[] = [];",
    );
    expect(get(files, "src/lib/engines/ids.ts")).toContain(
      "export type EngineId = never;",
    );
  });

  it("is deterministic: two runs against the same rootDir produce identical output", () => {
    const dir = makeFullFixture();
    const first = [...generate(dir).entries()];
    const second = [...generate(dir).entries()];
    expect(second).toEqual(first);
  });

  it("propagates an engine validation error", () => {
    const dir = makeTempDir();
    writeFile(
      dir,
      "src/lib/engines/foo/engine.json",
      engineJson({ id: "nope" }),
    );
    writeFile(dir, "src/lib/engines/foo/adapter.ts", "export default {};\n");
    expect(() => generate(dir)).toThrow(/must match its directory name/);
  });
});
