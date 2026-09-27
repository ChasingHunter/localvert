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
import { findStagedFiles, readBucketName, wranglerBinPath } from "./upload-r2";

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

main();
