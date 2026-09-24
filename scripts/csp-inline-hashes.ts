import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Post-build step: injects a per-page, hash-strict script CSP into every
 * exported HTML page.
 *
 * Next's static export inlines a small hydration/RSC-payload `<script>` on
 * every page. A header CSP can't forbid inline scripts without breaking the
 * app, so `public/_headers` stays tolerant (`'unsafe-inline'`). This script
 * closes that gap per page instead: it hashes each page's own inline
 * scripts and injects a `<meta>` CSP that allows only those hashes. Run as
 * part of `pnpm build` (see package.json) — `next build` alone does not
 * apply it. See docs/adr/0006-two-layer-csp.md.
 */

const OUT_DIR = "out";
const META_MARKER = "data-localvert-csp";

/**
 * Returns the text content of every inline `<script>` in `html` — i.e. every
 * `<script>` tag with no `src` attribute, regardless of `type` (a JSON-LD
 * block is harmless to hash too, and excluding it would just be one more
 * thing to get wrong).
 *
 * Regex-based HTML handling only because this walks our own build output,
 * not arbitrary hostile HTML: the shape is entirely Next's. The pattern
 * captures the opening tag's attributes (to check for `src`) and the
 * content up to the literal `</script>` terminator, `s`-flagged so `.`
 * spans newlines for multiline scripts. Next escapes any `</script>`
 * appearing inside a string literal it inlines (as `<\/script>`), so the
 * literal terminator this regex looks for only ever appears where a real
 * script tag ends.
 */
export function extractInlineScripts(html: string): string[] {
  const scriptTagRe = /<script(?<attrs>[^>]*)>(?<content>.*?)<\/script>/gis;
  const scripts: string[] = [];
  for (const match of html.matchAll(scriptTagRe)) {
    const attrs = match.groups?.attrs ?? "";
    const content = match.groups?.content ?? "";
    if (/\bsrc\s*=/i.test(attrs)) continue; // external script, nothing to hash
    if (content.length === 0) continue; // nothing to hash or to block
    scripts.push(content);
  }
  return scripts;
}

/** `'sha256-<base64>'` of the exact UTF-8 bytes of `content` — CSP's own hash-source format. */
export function hashScript(content: string): string {
  const digest = createHash("sha256").update(content, "utf8").digest("base64");
  return `sha256-${digest}`;
}

/**
 * Inserts a script-src CSP `<meta>` as the first child of `<head>`, right
 * after the opening tag. Meta CSP only governs content that follows it in
 * the document, so anything else would leave earlier scripts unguarded.
 *
 * Idempotent: an existing injected meta (marked with the `data-localvert-csp`
 * attribute) is stripped before the new one is inserted, so re-running this
 * script — or building twice — replaces rather than stacks it. Throws if
 * there is no `<head>` to inject into.
 */
export function injectMetaCsp(html: string, hashes: string[]): string {
  const uniqueHashes = [...new Set(hashes)].sort();
  const sources = [
    "'self'",
    "'wasm-unsafe-eval'",
    ...uniqueHashes.map((hash) => `'${hash}'`),
  ];
  const meta = `<meta ${META_MARKER} http-equiv="Content-Security-Policy" content="script-src ${sources.join(" ")}">`;

  const withoutExistingMeta = html.replace(
    new RegExp(`\\s*<meta[^>]*${META_MARKER}[^>]*>`, "i"),
    "",
  );

  const headOpenMatch = /<head(?:\s[^>]*)?>/i.exec(withoutExistingMeta);
  if (!headOpenMatch) {
    throw new Error("injectMetaCsp: no <head> tag found");
  }
  const insertAt = headOpenMatch.index + headOpenMatch[0].length;
  return (
    withoutExistingMeta.slice(0, insertAt) +
    meta +
    withoutExistingMeta.slice(insertAt)
  );
}

async function walkHtmlFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkHtmlFiles(full)));
    } else if (entry.isFile() && entry.name.endsWith(".html")) {
      files.push(full);
    }
  }
  return files;
}

async function main() {
  if (!existsSync(OUT_DIR)) {
    console.error(
      `csp-inline-hashes: "${OUT_DIR}/" does not exist — run \`next build\` first.`,
    );
    process.exit(1);
  }

  const files = await walkHtmlFiles(OUT_DIR);
  let totalHashes = 0;

  for (const file of files) {
    const html = await readFile(file, "utf8");
    const hashes = extractInlineScripts(html).map(hashScript);
    totalHashes += hashes.length;
    await writeFile(file, injectMetaCsp(html, hashes));
  }

  process.stdout.write(
    `csp-inline-hashes: injected per-page CSP into ${files.length} page(s), ${totalHashes} inline-script hash(es) total.\n`,
  );
}

if (import.meta.main) {
  await main();
}
