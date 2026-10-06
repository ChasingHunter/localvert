import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Optional, local-only: Lighthouse scores for the main pages, mobile and
 * desktop. Not part of `pnpm verify` or CI (scores wobble run to run on a
 * shared machine). Needs Chrome (set CHROME_PATH if it isn't found) and a
 * server already running the built site, the way e2e serves it:
 *
 *   pnpm build
 *   pnpm exec wrangler dev --config infra/wrangler.jsonc --port 8788 --local
 *   pnpm lighthouse [--base http://localhost:8788] [--out <dir>] [/path ...]
 *
 * Full JSON reports land in --out (default: the OS temp dir).
 *
 * Runs as plain `node scripts/lighthouse.ts` (type stripping; erasable syntax
 * only). Fetches `lighthouse` on demand with `pnpm dlx`, so it adds no
 * dependency to the repo.
 */

const DEFAULT_PAGES = [
  "/",
  "/image",
  "/pdf",
  "/compress",
  "/tools/compress-jpg",
  "/tools/word-to-pdf",
  "/tools/pdf-editor",
  "/vs",
  "/privacy",
  "/storage",
  "/open",
];
const CATEGORIES = ["performance", "accessibility", "best-practices", "seo"];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

const base = arg("--base") ?? "http://localhost:8788";
const out = arg("--out") ?? join(tmpdir(), "localvert-lighthouse");
const flagValues = new Set([arg("--base"), arg("--out")]);
const pages = process.argv
  .slice(2)
  .filter((a) => a.startsWith("/") && !flagValues.has(a));
mkdirSync(out, { recursive: true });

// biome-ignore lint/suspicious/noConsole: stdout is the report.
console.log(`page${" ".repeat(26)}preset   perf  a11y  bp  seo`);
for (const path of pages.length > 0 ? pages : DEFAULT_PAGES) {
  for (const preset of ["mobile", "desktop"]) {
    const file = join(out, `${preset}${path.replaceAll("/", "_") || "_"}.json`);
    const args = [
      "dlx",
      "lighthouse@latest",
      `${base}${path}`,
      "--quiet",
      "--output=json",
      `--output-path=${file}`,
      `--only-categories=${CATEGORIES.join(",")}`,
      '--chrome-flags="--headless=new"',
    ];
    if (preset === "desktop") args.push("--preset=desktop");
    const run = spawnSync("pnpm", args, { stdio: "inherit", shell: true });
    if (run.status !== 0) {
      // biome-ignore lint/suspicious/noConsole: stdout is the report.
      console.log(`${path.padEnd(30)}${preset.padEnd(9)}failed`);
      continue;
    }
    const cats = JSON.parse(readFileSync(file, "utf8")).categories;
    const score = (id: string) =>
      String(Math.round((cats[id]?.score ?? 0) * 100)).padStart(4);
    // biome-ignore lint/suspicious/noConsole: stdout is the report.
    console.log(
      `${path.padEnd(30)}${preset.padEnd(9)}${CATEGORIES.map(score).join("  ")}`,
    );
  }
}
// biome-ignore lint/suspicious/noConsole: stdout is the report.
console.log(`Reports in ${out}`);
