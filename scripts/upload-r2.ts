/**
 * `pnpm upload-r2` — uploads every file `sync-engines` staged under
 * `.engines-r2/xl/` to the `localvert-engines` R2 bucket, at the same key an
 * xl-engine fetch will ask the Worker for (`infra/worker/index.ts`):
 * `xl/<id>@<version>/<file>`.
 *
 * Every staged key is content-addressed by version (ADR-0003,
 * docs/adr/0003-workers-static-assets-over-pages.md — the asset path
 * includes the engine's version, so a URL never changes shape under an
 * existing version), so an object that already exists in the bucket is, by
 * construction, already the right bytes — this script skips it rather than
 * re-uploading. Existence is checked with `wrangler r2 object get --pipe
 * --remote`, discarding the body: R2 has no bare HEAD/"exists" subcommand
 * (`wrangler r2 object --help` lists only get/put/delete), and `get` is the
 * cheapest of those three that still confirms the object is actually
 * fetchable — `delete` would destroy it, and there's no "list one key"
 * command cheaper than a real `get`. This does mean a `get` re-downloads an
 * already-uploaded engine's bytes to confirm it's there, which is wasted
 * transfer, but every key here changes only for a version bump, so a
 * production CI run makes this call at most a handful of times per release,
 * not per commit.
 *
 * Runs as plain `node scripts/upload-r2.ts` (Node's built-in TypeScript type
 * stripping — no build step for this script itself). Kept fully
 * self-contained, no relative imports of sibling scripts — see
 * `sync-engines.ts`'s module doc comment for why. Keep it to erasable syntax
 * only: no enums, no namespaces, no parameter properties.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";

const CONTENT_TYPES: Record<string, string> = {
  ".wasm": "application/wasm",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
};
const DEFAULT_CONTENT_TYPE = "application/octet-stream";

export function contentTypeFor(path: string): string {
  return CONTENT_TYPES[extname(path).toLowerCase()] ?? DEFAULT_CONTENT_TYPE;
}

/**
 * Strips `//` line comments and `/* *‍/` block comments outside string
 * literals — enough to parse our own hand-maintained `infra/wrangler.jsonc`,
 * not a general JSONC parser for arbitrary untrusted input.
 */
export function stripJsonComments(text: string): string {
  let out = "";
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];

    if (inLineComment) {
      if (c === "\n") {
        inLineComment = false;
        out += c;
      }
      continue;
    }
    if (inBlockComment) {
      if (c === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inString) {
      out += c;
      if (c === "\\") {
        out += next;
        i++;
      } else if (c === '"') {
        inString = false;
      }
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
    } else if (c === "/" && next === "/") {
      inLineComment = true;
      i++;
    } else if (c === "/" && next === "*") {
      inBlockComment = true;
      i++;
    } else {
      out += c;
    }
  }
  return out;
}

/** Reads `r2_buckets[0].bucket_name` out of `infra/wrangler.jsonc` — the single source of truth for the bucket name. */
export function readBucketName(wranglerJsoncPath: string): string {
  const raw = readFileSync(wranglerJsoncPath, "utf8");
  const parsed = JSON.parse(stripJsonComments(raw)) as {
    r2_buckets?: { bucket_name?: unknown }[];
  };
  const bucket = parsed.r2_buckets?.[0]?.bucket_name;
  if (typeof bucket !== "string" || bucket === "") {
    throw new Error(
      `[upload-r2] no r2_buckets[0].bucket_name found in ${wranglerJsoncPath}`,
    );
  }
  return bucket;
}

export interface StagedUpload {
  /** "xl/<id>@<version>/<file>" — also the R2 object key. */
  key: string;
  filePath: string;
  contentType: string;
}

/** Every file staged under `<rootDir>/.engines-r2/xl/`, keyed by its path relative to `.engines-r2/`. */
export function findStagedFiles(rootDir: string): StagedUpload[] {
  const stageRoot = join(rootDir, ".engines-r2");
  const xlRoot = join(stageRoot, "xl");
  if (!existsSync(xlRoot)) return [];

  const files: StagedUpload[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const key = relative(stageRoot, full).split(sep).join("/");
      files.push({ key, filePath: full, contentType: contentTypeFor(full) });
    }
  };
  walk(xlRoot);

  return files.sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Resolves the on-disk directory of an installed npm package, falling back
 * to the conventional `node_modules/<pkg>` layout for a package whose
 * `exports` map blocks the `package.json` subpath. Mirrors
 * `sync-engines.ts`'s `resolvePackageDir` — duplicated rather than imported,
 * see this script's module doc comment.
 */
function resolvePackageDir(pkg: string, rootDir: string): string {
  const require = createRequire(import.meta.url);
  try {
    return dirname(
      require.resolve(`${pkg}/package.json`, { paths: [rootDir] }),
    );
  } catch {
    const fallback = join(rootDir, "node_modules", ...pkg.split("/"));
    if (existsSync(join(fallback, "package.json"))) return fallback;
    throw new Error(
      `[upload-r2] cannot resolve package "${pkg}" from ${rootDir} — is it installed?`,
    );
  }
}

/** The absolute path to wrangler's own CLI entry point, for `execFileSync(process.execPath, [wranglerBin, ...])`. */
export function wranglerBinPath(rootDir: string): string {
  const pkgDir = resolvePackageDir("wrangler", rootDir);
  const pkgJson = JSON.parse(
    readFileSync(join(pkgDir, "package.json"), "utf8"),
  ) as { bin?: string | Record<string, string> };
  const bin =
    typeof pkgJson.bin === "string" ? pkgJson.bin : pkgJson.bin?.wrangler;
  if (typeof bin !== "string") {
    throw new Error(
      `[upload-r2] "wrangler"'s package.json has no usable "bin" entry`,
    );
  }
  return join(pkgDir, bin);
}

/**
 * The subset of `child_process.execFileSync`'s signature this script calls
 * through — narrowed so a test can inject a fake without a real wrangler
 * binary. Matches `execFileSync`'s real behavior: throws on a non-zero exit.
 */
export type ExecFileSyncLike = (
  command: string,
  args: readonly string[],
  options?: Record<string, unknown>,
) => Buffer | string;

function objectExists(
  exec: ExecFileSyncLike,
  wranglerBin: string,
  bucket: string,
  key: string,
): boolean {
  try {
    exec(
      process.execPath,
      [
        wranglerBin,
        "r2",
        "object",
        "get",
        `${bucket}/${key}`,
        "--pipe",
        "--remote",
      ],
      { stdio: ["ignore", "ignore", "ignore"] },
    );
    return true;
  } catch {
    return false;
  }
}

function putObject(
  exec: ExecFileSyncLike,
  wranglerBin: string,
  bucket: string,
  upload: StagedUpload,
): void {
  exec(
    process.execPath,
    [
      wranglerBin,
      "r2",
      "object",
      "put",
      `${bucket}/${upload.key}`,
      "--file",
      upload.filePath,
      "--content-type",
      upload.contentType,
      "--remote",
    ],
    { stdio: "inherit" },
  );
}

export interface UploadResult {
  uploaded: readonly string[];
  skipped: readonly string[];
}

/**
 * Uploads every staged file not already present in the bucket. Requires
 * `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` in `env` only when there is
 * actually something staged — a repo with no r2 engines (or no version bump
 * since the last upload) must be able to run this in CI with no credentials
 * at all.
 */
export function uploadStaged(
  rootDir: string,
  env: Readonly<Record<string, string | undefined>>,
  exec: ExecFileSyncLike,
  wranglerBin: string,
): UploadResult {
  const staged = findStagedFiles(rootDir);
  if (staged.length === 0) {
    return { uploaded: [], skipped: [] };
  }

  if (!env.CLOUDFLARE_API_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID) {
    throw new Error(
      "[upload-r2] CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID must be set — there is staged work in .engines-r2/ to upload.",
    );
  }

  const bucket = readBucketName(join(rootDir, "infra", "wrangler.jsonc"));

  const uploaded: string[] = [];
  const skipped: string[] = [];
  for (const file of staged) {
    if (objectExists(exec, wranglerBin, bucket, file.key)) {
      skipped.push(file.key);
      continue;
    }
    putObject(exec, wranglerBin, bucket, file);
    uploaded.push(file.key);
  }
  return { uploaded, skipped };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function main(): void {
  const rootDir = process.cwd();

  let result: UploadResult;
  try {
    const wranglerBin = wranglerBinPath(rootDir);
    result = uploadStaged(
      rootDir,
      process.env,
      execFileSync as ExecFileSyncLike,
      wranglerBin,
    );
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }

  if (result.uploaded.length === 0 && result.skipped.length === 0) {
    // biome-ignore lint/suspicious/noConsole: this is the script's own completion summary.
    console.log("upload-r2: nothing staged in .engines-r2/ — nothing to do.");
    return;
  }
  for (const key of result.skipped) {
    // biome-ignore lint/suspicious/noConsole: this is the script's own completion summary.
    console.log(`upload-r2: ${key} already exists — skipped.`);
  }
  for (const key of result.uploaded) {
    // biome-ignore lint/suspicious/noConsole: this is the script's own completion summary.
    console.log(`upload-r2: uploaded ${key}.`);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
