/**
 * Builds `/main.typ` — the whole document, generated fresh per job (no user
 * input reaches this file directly; the markdown itself is a separate
 * in-memory file, `/input.md`, read via `read()` inside the template so it's
 * never string-interpolated into Typst source).
 *
 * cmarker (vendored, MIT — see docs/THIRD_PARTY_LICENSES.md) is imported by
 * its absolute in-memory path rather than the `@preview/cmarker:0.1.8`
 * package syntax: cmarker's own `lib.typ` only ever resolves its plugin via a
 * *relative* import (`plugin("./plugin.wasm")`, confirmed by reading the
 * vendored source), so a plain file-path import satisfies it fully — no
 * Typst package registry needs to be configured at all. That sidesteps
 * `withPackageRegistry`/`FetchPackageRegistry` (packages.typst.org) entirely,
 * per this slice's brief: the compiler never asks "what does @preview/x
 * resolve to", so there is nothing for a registry to answer.
 *
 * Images: cmarker's default `img` handler calls Typst's own `image()` on the
 * markdown's `src` path, which our in-memory access model can't serve (any
 * image referenced by the dropped markdown is out of scope for this slice —
 * see the brief). The `html: (img: ...)` override below replaces that
 * handler with one that renders the image's alt text only, so a markdown
 * image never aborts the compile with a file-not-found error.
 */

export type PageSize = "a4" | "letter";
/** String, not number: this is the raw value a `z.enum` options field
 * carries end to end (see `markdown-to-pdf.ts`'s doc comment on why a
 * `control: "select"` option is always a string enum, never a number). */
export type FontSize = "10" | "11" | "12";

export interface MarkdownToPdfOptions {
  pageSize: PageSize;
  fontSize: FontSize;
}

/** Typst's own paper-preset name for each option value — "letter" in our UI
 * options is Typst's "us-letter" preset. */
const PAPER: Record<PageSize, string> = {
  a4: "a4",
  letter: "us-letter",
};

export const CMARKER_LIB_PATH = "/packages/preview/cmarker/0.1.8/lib.typ";
export const INPUT_PATH = "/input.md";
export const MAIN_PATH = "/main.typ";

export function buildMainTyp(options: MarkdownToPdfOptions): string {
  const paper = PAPER[options.pageSize];
  return `#set page(paper: "${paper}", margin: 2.5cm)
#set text(font: "Libertinus Serif", size: ${options.fontSize}pt)
#show raw: set text(font: "DejaVu Sans Mono")
#import "${CMARKER_LIB_PATH}": render
#render(
  read("${INPUT_PATH}"),
  html: (
    img: ("void", (attrs) => attrs.at("alt", default: "")),
  ),
)
`;
}
