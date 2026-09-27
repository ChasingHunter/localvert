/**
 * Seeds `wrangler dev --local`'s R2 simulation (a local miniflare/sqlite
 * store under `.wrangler/`, no network) from whatever `sync-engines` staged
 * in `.engines-r2/xl/` — so an e2e run against a local `wrangler dev` can
 * exercise `infra/worker/index.ts`'s `/engines/xl/*` route the same way
 * production (R2, uploaded by `scripts/upload-r2.ts`) does. Run before
 * `wrangler dev` starts — see `playwright.config.ts`'s `webServer.command`.
 *
 * Reuses `upload-r2.ts`'s staged-file listing, bucket-name resolution and
 * wrangler-binary resolution rather than duplicating them a third time (only
 * `sync-engines.ts`/`upload-r2.ts` themselves keep to the "no relative
 * imports of sibling scripts" rule, for their own production build-path
 * reasons — this script only ever runs for local/e2e dev, off that path).
 *
 * `wrangler r2 object put ... --local` always succeeds whether or not the
 * key already exists (there's no local-store network cost to re-write it),
 * so this always re-puts every staged file rather than checking existence
 * first — simpler, and still fast: it's a local file copy, not a network
 * upload. That makes reruns idempotent and cheap, exactly what a dev loop
 * needs.
 */
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  findStagedFiles,
  readBucketName,
  wranglerBinPath,
} from "./upload-r2.ts";

export function seedLocalR2(
  rootDir: string,
  exec: (
    command: string,
    args: readonly string[],
    options?: Record<string, unknown>,
  ) => Buffer | string = execFileSync,
  wranglerBin: string = wranglerBinPath(rootDir),
): readonly string[] {
  const staged = findStagedFiles(rootDir);
  if (staged.length === 0) {
    return [];
  }

  const bucket = readBucketName(join(rootDir, "infra", "wrangler.jsonc"));

  const seeded: string[] = [];
  for (const file of staged) {
    exec(
      process.execPath,
      [
        wranglerBin,
        "r2",
        "object",
        "put",
        `${bucket}/${file.key}`,
        "--file",
        file.filePath,
        "--content-type",
        file.contentType,
        "--local",
        // Without this, wrangler can't find `infra/wrangler.jsonc` from the
        // repo-root cwd this script runs from (auto-discovery only searches
        // upward from cwd, never into subdirectories) and silently falls
        // back to a `--local` persist directory under the repo root instead
        // of `infra/.wrangler/` — a *different* store than the one
        // `wrangler dev --config infra/wrangler.jsonc` reads from, so every
        // seeded object 404s once the server starts. Same `--config`
        // `playwright.config.ts`'s `webServer.command` passes to `wrangler
        // dev`, so both processes agree on one persist path.
        "--config",
        join(rootDir, "infra", "wrangler.jsonc"),
      ],
      { stdio: "inherit" },
    );
    seeded.push(file.key);
  }
  return seeded;
}

function main(): void {
  const rootDir = process.cwd();
  const seeded = seedLocalR2(rootDir);
  if (seeded.length === 0) {
    // biome-ignore lint/suspicious/noConsole: this is the script's own completion summary.
    console.log(
      "seed-r2-local: nothing staged in .engines-r2/ — nothing to do.",
    );
    return;
  }
  for (const key of seeded) {
    // biome-ignore lint/suspicious/noConsole: this is the script's own completion summary.
    console.log(`seed-r2-local: seeded ${key} into local R2.`);
  }
}

// Same guard as upload-r2.ts's `main()` call — without it, importing this
// module (e.g. from seed-r2-local.test.ts) would run the real `main()`
// against the real repo root on every test run, exactly the bug this
// comment is here to prevent a regression of.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
