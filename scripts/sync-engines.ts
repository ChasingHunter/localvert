/**
 * `pnpm sync-engines` — copies each engine's assets out of the npm package
 * that owns them and into place for the build: `public/engines/<id>@<
 * version>/` for a "static" engine, `.engines-r2/xl/<id>@<version>/` (a
 * staging area, uploaded later by `scripts/upload-r2.ts`) for an "r2" one.
 * Then rewrites that engine's `engine.json` `assets` field to the real
 * `{path, bytes}` list, so `pnpm gen` (chained after this script by the
 * `sync-engines` npm script) can build an accurate `manifest.ts`.
 *
 * Placement is enforced mechanically (ADR-0003,
 * docs/adr/0003-workers-static-assets-over-pages.md): a "static" file over
 * `STATIC_LIMIT_BYTES` fails the build rather than silently shipping past
 * Cloudflare's 25 MiB static-asset limit.
 *
 * Reads only `src/lib/engines/<id>/engine.json` — never `adapter.ts` — so,
 * like `scripts/gen-registry.ts`, this script never imports or executes our
 * own code. Unlike `gen-registry.ts` it does *not* validate the full
 * engine.json contract (id-matches-dirname, semver, asset shape, ...); that
 * is `gen-registry.ts`'s job, and `pnpm sync-engines` always runs `pnpm gen`
 * right after, so a malformed engine.json still fails the same command. This
 * script only reads the handful of fields it actually needs.
 *
 * Runs as plain `node scripts/sync-engines.ts` (Node's built-in TypeScript
 * type stripping — no build step for this script itself). Kept fully
 * self-contained — no relative imports of sibling scripts, mirroring
 * `gen-registry.ts`'s module doc comment — because "bundler" module
 * resolution requires `allowImportingTsExtensions` to import another `.ts`
 * file by its literal extension, which this repo does not enable, and Node's
 * own type stripping has no path-alias or extension-rewriting of its own to
 * fall back on. Keep it to erasable syntax only: no enums, no namespaces, no
 * parameter properties.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Every regular file under `dir`, recursively, as POSIX-style paths relative
 * to `dir` (e.g. `"nested/Foo.bcmap"`) — used by `copyEngineFiles`'s
 * directory-entry support below. Directory entries sort no differently from
 * single-file ones (the caller sorts the flattened result), so this doesn't
 * bother sorting its own output.
 */
function listFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      for (const rel of listFilesRecursive(join(dir, entry.name))) {
        out.push(`${entry.name}/${rel}`);
      }
    } else if (entry.isFile()) {
      out.push(entry.name);
    }
  }
  return out;
}

/**
 * ADR-0003: engines ≤20 MiB ship as static assets; anything larger goes to
 * R2. 20 MiB (not the 25 MiB hard limit) leaves headroom. Overridable so
 * tests can exercise the rule with small fixture files instead of a real
 * 20 MiB one.
 */
export const STATIC_LIMIT_BYTES = 20 * 1024 * 1024;

export interface SourceFile {
  from: string;
  to: string;
}

/** The handful of `engine.json` fields this script reads. Not the full contract — see the module doc comment. */
export interface EngineSource {
  id: string;
  version: string;
  location: "native" | "static" | "r2" | "bundled";
  package?: string;
  files?: readonly SourceFile[];
}

export interface SyncedFile {
  /** The `to` path, relative to the engine's asset directory. */
  path: string;
  bytes: number;
}

export interface SyncedEngine {
  id: string;
  version: string;
  location: "static" | "r2";
  files: readonly SyncedFile[];
}

export interface SyncResult {
  engines: readonly SyncedEngine[];
  /** `engine.json` paths whose "assets" field was rewritten because it had changed. */
  rewrittenEngineJson: readonly string[];
  /** `public/engines/<id>@<oldVersion>` directories removed as stale. */
  removedStaleDirs: readonly string[];
  warnings: readonly string[];
}

/** `bytes` as MiB, one decimal place — matches how ADR-0003's limits are stated. */
function mib(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

/**
 * Reads `src/lib/engines/<id>/engine.json` down to the fields this script
 * needs. Throws with a `[sync-engines]`-prefixed message on anything this
 * script itself depends on being well-formed; anything else is left for
 * `gen-registry.ts`'s fuller validation.
 */
function readEngineSource(dir: string, id: string): EngineSource {
  const fail = (message: string): never => {
    throw new Error(`[sync-engines] engine "${id}": ${message}`);
  };

  const raw = readFileSync(join(dir, "engine.json"), "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null) {
    fail("engine.json must be a JSON object");
  }
  const j = parsed as Record<string, unknown>;

  if (typeof j.version !== "string" || j.version === "") {
    fail(`"version" must be a non-empty string`);
  }
  if (
    j.location !== "native" &&
    j.location !== "static" &&
    j.location !== "r2" &&
    j.location !== "bundled"
  ) {
    fail(`"location" must be one of native, static, r2, bundled`);
  }
  const location = j.location as "native" | "static" | "r2" | "bundled";

  // Neither ships assets of its own — nothing for this script to copy.
  if (location === "native" || location === "bundled") {
    return { id, version: j.version as string, location };
  }

  if (typeof j.package !== "string" || j.package === "") {
    fail(`"package" must be a non-empty string`);
  }
  if (!Array.isArray(j.files) || j.files.length === 0) {
    fail(`"files" must be a non-empty array`);
  }
  const files = (j.files as unknown[]).map((f, i) => {
    const file = f as Record<string, unknown>;
    if (typeof file.from !== "string" || typeof file.to !== "string") {
      fail(`"files[${i}]" must have string "from" and "to"`);
    }
    return { from: file.from as string, to: file.to as string };
  });

  return {
    id,
    version: j.version as string,
    location,
    package: j.package as string,
    files,
  };
}

/** Every `src/lib/engines/<id>/` directory that has an `engine.json`. */
export function scanEngineSources(rootDir: string): EngineSource[] {
  const enginesDir = join(rootDir, "src", "lib", "engines");
  if (!existsSync(enginesDir)) return [];

  const ids = readdirSync(enginesDir, { withFileTypes: true })
    .filter(
      (d) =>
        d.isDirectory() && existsSync(join(enginesDir, d.name, "engine.json")),
    )
    .map((d) => d.name)
    .sort();

  return ids.map((id) => readEngineSource(join(enginesDir, id), id));
}

/**
 * Resolves the on-disk directory of an installed npm package. Tries
 * `require.resolve` first (works even for a package whose `exports` map
 * happens to expose `./package.json`); a package whose `exports` blocks that
 * subpath makes `require.resolve` throw even though the package is
 * installed, so this falls back to the conventional `node_modules/<pkg>`
 * layout. `paths: [rootDir]` — rather than resolving relative to this
 * script's own location — is what makes this testable against a fixture
 * `rootDir` with its own `node_modules`.
 */
export function resolvePackageDir(pkg: string, rootDir: string): string {
  const require = createRequire(import.meta.url);
  try {
    return dirname(
      require.resolve(`${pkg}/package.json`, { paths: [rootDir] }),
    );
  } catch {
    const fallback = join(rootDir, "node_modules", ...pkg.split("/"));
    if (existsSync(join(fallback, "package.json"))) return fallback;
    throw new Error(
      `[sync-engines] cannot resolve package "${pkg}" from ${rootDir} — is it installed?`,
    );
  }
}

function readInstalledVersion(packageDir: string): string {
  const pkgJsonPath = join(packageDir, "package.json");
  const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf8")) as {
    version?: unknown;
  };
  if (typeof pkgJson.version !== "string") {
    fail(`"${pkgJsonPath}" has no "version" field`);
  }
  return pkgJson.version as string;
}

function fail(message: string): never {
  throw new Error(`[sync-engines] ${message}`);
}

/** Where one engine's synced files land, by location. */
function destRoot(rootDir: string, source: EngineSource): string {
  const dirName = `${source.id}@${source.version}`;
  return source.location === "static"
    ? join(rootDir, "public", "engines", dirName)
    : join(rootDir, ".engines-r2", "xl", dirName);
}

/** Copies one file, enforcing the ADR-0003 placement rule for a "static"
 * engine. `to` is the path (relative to the engine's asset directory) it
 * lands under — a plain filename for a single-file entry, or a directory
 * entry's own `to` prefix plus a file's path within it. */
function copyOneFile(
  srcPath: string,
  dest: string,
  to: string,
  engineId: string,
  location: "static" | "r2",
  staticLimitBytes: number,
): SyncedFile {
  const destPath = join(dest, ...to.split("/"));
  mkdirSync(dirname(destPath), { recursive: true });
  copyFileSync(srcPath, destPath);
  const bytes = statSync(destPath).size;

  if (location === "static" && bytes > staticLimitBytes) {
    fail(
      `${engineId}/${to} is ${mib(bytes)} MiB; static assets are capped at 25 MiB by Cloudflare — set location to r2`,
    );
  }
  return { path: to, bytes };
}

/**
 * Copies one engine's files from its package directory to `destRoot`,
 * enforcing the ADR-0003 placement rule for a "static" engine. Returns the
 * copied files, sorted by `path`.
 *
 * A `from`/`to` pair where **both** end in `"/"` is a directory entry (e.g.
 * `{from: "cmaps/", to: "cmaps/"}`, for an engine like `pdfjs` whose cmaps/
 * standard-fonts assets are a whole directory tree, not a fixed file list) —
 * every file under `from`, recursively, is copied to the matching path under
 * `to`, and each one becomes its own `SyncedFile` entry (so `engine.json`'s
 * `assets` ends up listing every individual file, same as a hand-written
 * `files` entry would, never a directory as one opaque blob).
 */
function copyEngineFiles(
  packageDir: string,
  dest: string,
  source: EngineSource & { location: "static" | "r2" },
  staticLimitBytes: number,
): SyncedFile[] {
  const files: SyncedFile[] = [];
  for (const { from, to } of source.files ?? []) {
    if (from.endsWith("/") !== to.endsWith("/")) {
      fail(
        `${source.id}: a directory entry's "from" and "to" must both end with "/" (got from="${from}", to="${to}")`,
      );
    }

    if (from.endsWith("/")) {
      const srcDir = join(packageDir, ...from.split("/"));
      for (const rel of listFilesRecursive(srcDir)) {
        files.push(
          copyOneFile(
            join(srcDir, ...rel.split("/")),
            dest,
            `${to}${rel}`,
            source.id,
            source.location,
            staticLimitBytes,
          ),
        );
      }
      continue;
    }

    const srcPath = join(packageDir, ...from.split("/"));
    files.push(
      copyOneFile(
        srcPath,
        dest,
        to,
        source.id,
        source.location,
        staticLimitBytes,
      ),
    );
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Rewrites `src/lib/engines/<id>/engine.json`'s `assets` field to `files`,
 * preserving every other field and its position (re-stringifying a parsed
 * object keeps existing keys in place; only `assets`'s value changes).
 * Writes only if the content actually changed, and returns whether it did —
 * an unconditional rewrite would touch mtimes and diff noisily on every run
 * even when nothing moved.
 */
function rewriteAssets(
  rootDir: string,
  id: string,
  files: readonly SyncedFile[],
): boolean {
  const enginePath = join(rootDir, "src", "lib", "engines", id, "engine.json");
  const raw = readFileSync(enginePath, "utf8");
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  parsed.assets = files.map((f) => ({ path: f.path, bytes: f.bytes }));
  const next = `${JSON.stringify(parsed, null, 2)}\n`;
  if (next === raw) return false;
  writeFileSync(enginePath, next);
  return true;
}

/**
 * Removes `public/engines/<id>@<oldVersion>` directories for every "static"
 * engine we own whose current version has moved on — otherwise a version
 * bump leaves the old build artifact behind forever, since nothing else ever
 * deletes it.
 */
function cleanStaleStaticDirs(
  rootDir: string,
  staticSources: readonly EngineSource[],
): string[] {
  const publicEnginesDir = join(rootDir, "public", "engines");
  if (!existsSync(publicEnginesDir)) return [];

  const keep = new Set(staticSources.map((s) => `${s.id}@${s.version}`));
  const ownedIds = new Set(staticSources.map((s) => s.id));
  const removed: string[] = [];

  for (const entry of readdirSync(publicEnginesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const atIndex = entry.name.lastIndexOf("@");
    if (atIndex === -1) continue;
    const ownerId = entry.name.slice(0, atIndex);
    if (!ownedIds.has(ownerId) || keep.has(entry.name)) continue;
    rmSync(join(publicEnginesDir, entry.name), {
      recursive: true,
      force: true,
    });
    removed.push(entry.name);
  }
  return removed;
}

/**
 * Syncs every "static"/"r2" engine's assets into place. Pure aside from the
 * filesystem effects the doc comment above describes — no network I/O, no
 * child process. `staticLimitBytes` defaults to `STATIC_LIMIT_BYTES`;
 * overridable so tests can exercise the placement rule without a real
 * 20 MiB fixture file.
 */
export function syncEngines(
  rootDir: string,
  staticLimitBytes: number = STATIC_LIMIT_BYTES,
): SyncResult {
  const sources = scanEngineSources(rootDir).filter(
    (s): s is EngineSource & { location: "static" | "r2" } =>
      s.location === "static" || s.location === "r2",
  );

  const engines: SyncedEngine[] = [];
  const rewrittenEngineJson: string[] = [];
  const warnings: string[] = [];

  for (const source of sources) {
    // `package` is guaranteed by `readEngineSource` for a static/r2 engine.
    const packageDir = resolvePackageDir(source.package as string, rootDir);
    const installedVersion = readInstalledVersion(packageDir);
    if (installedVersion !== source.version) {
      fail(
        `engine "${source.id}": engine.json version "${source.version}" does not match installed "${source.package}" version "${installedVersion}" — bump engine.json's "version" to match.`,
      );
    }

    const dest = destRoot(rootDir, source);
    const files = copyEngineFiles(packageDir, dest, source, staticLimitBytes);

    if (
      source.location === "r2" &&
      files.every((f) => f.bytes < staticLimitBytes)
    ) {
      warnings.push(
        `engine "${source.id}" is r2 but every file is under ${mib(staticLimitBytes)} MiB — consider setting location to "static".`,
      );
    }

    engines.push({
      id: source.id,
      version: source.version,
      location: source.location,
      files,
    });
    if (rewriteAssets(rootDir, source.id, files)) {
      rewrittenEngineJson.push(
        join("src", "lib", "engines", source.id, "engine.json"),
      );
    }
  }

  const removedStaleDirs = cleanStaleStaticDirs(
    rootDir,
    sources.filter((s) => s.location === "static"),
  );

  return { engines, rewrittenEngineJson, removedStaleDirs, warnings };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function main(): void {
  const rootDir = process.cwd();

  let result: SyncResult;
  try {
    result = syncEngines(rootDir);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }

  if (result.engines.length === 0) {
    // biome-ignore lint/suspicious/noConsole: this is the script's own completion summary.
    console.log("sync-engines: no static/r2 engines to sync — nothing to do.");
    return;
  }

  const idCol = Math.max(6, ...result.engines.map((e) => e.id.length));
  // biome-ignore lint/suspicious/noConsole: this is the report table, stdout is the product here.
  console.log(
    `${"Engine".padEnd(idCol)}  ${"Version".padEnd(10)}  Location  Files  Bytes`,
  );
  for (const engine of result.engines) {
    const totalBytes = engine.files.reduce((sum, f) => sum + f.bytes, 0);
    // biome-ignore lint/suspicious/noConsole: this is the report table, stdout is the product here.
    console.log(
      `${engine.id.padEnd(idCol)}  ${engine.version.padEnd(10)}  ${engine.location.padEnd(8)}  ${String(engine.files.length).padStart(5)}  ${String(totalBytes).padStart(9)}`,
    );
  }

  for (const path of result.rewrittenEngineJson) {
    // biome-ignore lint/suspicious/noConsole: this is the script's own completion summary.
    console.log(`sync-engines: updated ${path}'s "assets".`);
  }
  for (const dir of result.removedStaleDirs) {
    // biome-ignore lint/suspicious/noConsole: this is the script's own completion summary.
    console.log(`sync-engines: removed stale public/engines/${dir}.`);
  }
  for (const warning of result.warnings) {
    console.warn(`sync-engines: warning: ${warning}`);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
