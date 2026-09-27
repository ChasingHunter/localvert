/**
 * Pure logic for turning an EPUB (a zip of XHTML chapters, OCF-packaged) into
 * one concatenated HTML document, so LibreOffice's HTML importer — which has
 * no EPUB import of its own (see docs/adr/0012-libreoffice-office-to-pdf.md's
 * EPUB addendum) — can render it. `epub-to-pdf`'s pipeline runs this ahead of
 * the `libreoffice` engine's own `html -> pdf` step.
 *
 * No new dependency: `fflate` (already a dependency, used by the streaming
 * ZIP sink) unzips the container; this module is regex-over-known-tags, not
 * a general XML parser, deliberately — EPUB's `container.xml` and OPF
 * package document are both small, fixed-shape files, and a real
 * namespace-aware parser is more machinery than the brief calls for. This is
 * a best-effort reader, not a spec-complete EPUB implementation: no NCX/nav
 * fallback (spine order only, per the brief), no encryption, no
 * fixed-layout metadata.
 */

export interface OpfManifestItem {
  href: string;
  mediaType: string;
}

export interface OpfDocument {
  /** id -> {href, mediaType}, exactly as `<item>` declares them, href still
   * relative to the OPF file's own directory (not yet resolved). */
  manifest: ReadonlyMap<string, OpfManifestItem>;
  /** `<itemref idref>` values, in spine (reading) order. */
  spine: readonly string[];
}

const CONTAINER_ROOTFILE_RE = /<rootfile\b[^>]*\bfull-path\s*=\s*"([^"]+)"/i;

/**
 * EPUB's own `META-INF/container.xml` names the OPF (package document) this
 * zip's actual content lives under — every real EPUB has exactly one
 * `<rootfile>` for the default rendition, so only the first match is read.
 * Returns `null` if the file has no recognizable `<rootfile full-path="...">`.
 */
export function parseContainerRootfile(xml: string): string | null {
  return xml.match(CONTAINER_ROOTFILE_RE)?.[1] ?? null;
}

const MANIFEST_ITEM_RE = /<item\b[^>]*\/?>/gi;
const SPINE_ITEMREF_RE = /<itemref\b[^>]*\/?>/gi;

function attr(tag: string, name: string): string | null {
  const re = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i");
  return tag.match(re)?.[1] ?? null;
}

/**
 * Parses just enough of an OPF package document — the `<manifest>`'s
 * `<item id href media-type>` entries and the `<spine>`'s `<itemref idref>`
 * order — to rebuild reading order. One regex pass per tag kind rather than
 * a full XML/namespace-aware parse: OPF's manifest/spine shape is flat,
 * self-closing, attribute-only tags, which this matches directly.
 */
export function parseOpf(xml: string): OpfDocument {
  const manifest = new Map<string, OpfManifestItem>();
  for (const tag of xml.match(MANIFEST_ITEM_RE) ?? []) {
    const id = attr(tag, "id");
    const href = attr(tag, "href");
    if (id === null || href === null) continue;
    manifest.set(id, { href, mediaType: attr(tag, "media-type") ?? "" });
  }

  const spine: string[] = [];
  for (const tag of xml.match(SPINE_ITEMREF_RE) ?? []) {
    const idref = attr(tag, "idref");
    if (idref !== null) spine.push(idref);
  }

  return { manifest, spine };
}

function dirOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash + 1);
}

/**
 * Resolves `href` (as it appears in an OPF manifest or an XHTML chapter's
 * own `src`/`href` attribute) against `basePath` — the file that declared
 * it, not the zip root; every relative reference in EPUB/OPF/XHTML is
 * relative to the referencing file's own directory. A `.`/`..` segment
 * stack, not full RFC 3986 resolution — real EPUBs don't need more.
 * Absolute (`http(s)://`, `data:`) references pass through unchanged.
 */
export function resolvePath(basePath: string, href: string): string {
  if (/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(href) || href.startsWith("data:")) {
    return href;
  }
  const parts = (dirOf(basePath) + href).split("/");
  const stack: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  return stack.join("/");
}

const BODY_RE = /<body\b[^>]*>([\s\S]*)<\/body>/i;

/** A chapter's `<body>...</body>` inner content, or the whole document if no
 * `<body>` tag is found (a malformed/fragment chapter — pass it through
 * rather than dropping it). */
export function extractBody(xhtml: string): string {
  return xhtml.match(BODY_RE)?.[1] ?? xhtml;
}

const IMG_SRC_RE = /(<img\b[^>]*\bsrc\s*=\s*")([^"]*)(")/gi;
const IMAGE_HREF_RE = /(<image\b[^>]*(?:xlink:href|href)\s*=\s*")([^"]*)(")/gi;

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
};

function extOf(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? "" : path.slice(dot + 1).toLowerCase();
}

/** Base64-encodes `bytes` — `btoa`/binary-string round trip, since neither
 * a worker nor Node's test environment can assume `Buffer` is the fast
 * path here (this file has to run in both). Fine for the image sizes a
 * real EPUB embeds; not written for multi-hundred-MB inputs. */
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i] as number);
  }
  return btoa(binary);
}

/**
 * Rewrites every `<img src>`/`<image xlink:href>` in one chapter's body to
 * an inline `data:` URI resolved against the zip's own files — LibreOffice's
 * HTML import fetches nothing (`connect-src 'self'`, invariant 1), so a
 * relative path would just render broken. A reference this zip doesn't
 * actually contain has its tag dropped and a trailing HTML comment left in
 * its place, never silently pointing at a dead relative path.
 */
export function inlineImages(
  bodyHtml: string,
  chapterPath: string,
  files: ReadonlyMap<string, Uint8Array>,
): string {
  const replace = (html: string, re: RegExp): string =>
    html.replace(re, (whole, pre: string, src: string, post: string) => {
      if (src === "" || src.startsWith("data:")) return whole;
      const resolved = resolvePath(chapterPath, src);
      const bytes = files.get(resolved);
      if (!bytes) {
        return `<!-- localvert: missing epub image "${resolved}" -->`;
      }
      const mime =
        IMAGE_MIME_BY_EXT[extOf(resolved)] ?? "application/octet-stream";
      return `${pre}data:${mime};base64,${toBase64(bytes)}${post}`;
    });

  return replace(replace(bodyHtml, IMG_SRC_RE), IMAGE_HREF_RE);
}

export interface EpubToHtmlResult {
  html: string;
  /** Spine/manifest references the zip didn't actually contain — surfaced
   * for the caller to log, never thrown: a partial document beats failing
   * the whole conversion over one bad chapter reference. */
  warnings: readonly string[];
}

/**
 * The whole EPUB -> HTML transform: unzip (caller's job — see
 * `adapter.ts`), find the OPF via `container.xml`, walk the spine in order,
 * inline each chapter's images, and concatenate into one HTML document with
 * a page break between chapters (LibreOffice's HTML import respects
 * `page-break-before` in a `<div>`'s inline style).
 */
export function epubFilesToHtml(
  files: ReadonlyMap<string, Uint8Array>,
): EpubToHtmlResult {
  const warnings: string[] = [];
  const decoder = new TextDecoder();

  const containerBytes = files.get("META-INF/container.xml");
  if (!containerBytes) {
    throw new Error("epub: missing META-INF/container.xml");
  }
  const opfPath = parseContainerRootfile(decoder.decode(containerBytes));
  if (!opfPath) {
    throw new Error("epub: container.xml has no <rootfile full-path>");
  }
  const opfBytes = files.get(opfPath);
  if (!opfBytes) {
    throw new Error(`epub: OPF package document "${opfPath}" not found in zip`);
  }
  const opf = parseOpf(decoder.decode(opfBytes));

  const chapters: string[] = [];
  for (const idref of opf.spine) {
    const item = opf.manifest.get(idref);
    if (!item) {
      warnings.push(`spine references unknown manifest item "${idref}"`);
      continue;
    }
    const chapterPath = resolvePath(opfPath, item.href);
    const chapterBytes = files.get(chapterPath);
    if (!chapterBytes) {
      warnings.push(`spine chapter "${chapterPath}" not found in zip`);
      continue;
    }
    const body = inlineImages(
      extractBody(decoder.decode(chapterBytes)),
      chapterPath,
      files,
    );
    chapters.push(body);
  }

  const html =
    '<!doctype html><html><head><meta charset="utf-8"></head><body>' +
    chapters.join('<div style="page-break-before:always"></div>') +
    "</body></html>";

  return { html, warnings };
}
