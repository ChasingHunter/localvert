import { copyFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Post-build step: next to every nested RSC segment file, writes the flat
 * name the client actually asks for.
 *
 * `next build` (Turbopack, `output: "export"`) lays segment payloads out as
 * `privacy/__next.privacy/__PAGE__.txt`, but the client's router prefetches
 * `privacy/__next.privacy.__PAGE__.txt` (the path joined with dots). A static
 * host serves exactly the files it has, so without this every viewport link
 * prefetch 404s: a red console error on each page, and no prefetched data
 * for the navigation that follows. The copies are a few hundred small files.
 *
 * Runs as plain `node scripts/flatten-rsc.ts` (type stripping; erasable
 * syntax only, no imports of our own modules).
 */

const OUT_DIR = "out";

/**
 * Pure: the flat sibling name for a file inside a `__next.*` directory, given
 * the directory names from the first `__next.*` one down and the file name.
 * `["__next.tools", "$d$slug"]` + `__PAGE__.txt` gives
 * `__next.tools.$d$slug.__PAGE__.txt`.
 */
export function flatName(dirs: readonly string[], file: string): string {
  return [...dirs, file].join(".");
}

/** Copies every nested segment file under `root` to its flat sibling name. */
export function flattenSegments(root: string): number {
  let copied = 0;

  function copyTree(dir: string, parent: string, dirs: string[]): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        copyTree(full, parent, [...dirs, entry.name]);
      } else if (entry.isFile()) {
        copyFileSync(full, join(parent, flatName(dirs, entry.name)));
        copied += 1;
      }
    }
  }

  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const full = join(dir, entry.name);
      if (entry.name.startsWith("__next.")) {
        copyTree(full, dir, [entry.name]);
      } else if (entry.name !== "_next" && entry.name !== "engines") {
        walk(full);
      }
    }
  }

  walk(root);
  return copied;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  // biome-ignore lint/suspicious/noConsole: stdout is the report.
  console.log(
    `flatten-rsc: wrote ${flattenSegments(OUT_DIR)} flat segment file(s).`,
  );
}
