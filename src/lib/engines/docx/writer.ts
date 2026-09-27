/**
 * Pure, environment-neutral `.docx` writer for `pdf-to-word`
 * (docs/adr/0014-pdf-to-word.md). Takes a `LayoutDocument`
 * (`../shared/pdf-layout.ts`) and produces the minimal set of OOXML parts
 * Word (and LibreOffice/Google Docs) accept as a valid WordprocessingML
 * package — no library beyond `fflate`'s `zipSync`, already a dependency
 * (`epub/adapter.ts` uses the same package for the read side). No DOM, no
 * wasm — Node-testable directly, same as `shared/pdf-layout.ts`.
 *
 * Deliberately minimal: one `body` styled from four named styles
 * (Normal/Heading1-3), no theme, no numbering, no images (this slice ships
 * text-only — see docs/adr/0014-pdf-to-word.md). Word opens a package this
 * small without complaint; it's the same shape `python-docx`'s own default
 * template produces stripped to essentials.
 */
import { strToU8, zipSync } from "fflate";
import type {
  LayoutDocument,
  LayoutParagraph,
  LayoutRun,
} from "../shared/pdf-layout";

export interface DocxOptions {
  /** Insert a page break between each PDF page's content. */
  pageBreaks: boolean;
  /** docProps/core.xml `dc:title` — falls back to "Document" when empty. */
  title?: string;
}

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>
`;

const ROOT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>
`;

const DOCUMENT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>
`;

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style>
</w:styles>
`;

/** Letter, 1in margins all round — the same defaults Word itself opens a
 * blank US-locale document with. Not derived from the source PDF's own page
 * size: this is a reflowable Word document, not a facsimile. */
const SECT_PR_XML =
  '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>' +
  '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>' +
  "</w:sectPr>";

const PAGE_BREAK_XML = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';

/**
 * XML 1.0's own valid-character ranges (spec §2.2) — everything else
 * (bare C0 controls other than tab/CR/LF, lone surrogates, U+FFFE/U+FFFF)
 * is illegal in a well-formed XML 1.0 document and must be dropped before
 * this text can go anywhere near a `w:t`. Iterated by code point (`for...of`
 * over a string yields whole code points, not UTF-16 code units), so a
 * surrogate pair for an astral character survives intact.
 */
export function stripIllegalXmlChars(text: string): string {
  let out = "";
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (
      cp === 0x9 ||
      cp === 0xa ||
      cp === 0xd ||
      (cp >= 0x20 && cp <= 0xd7ff) ||
      (cp >= 0xe000 && cp <= 0xfffd) ||
      (cp >= 0x10000 && cp <= 0x10ffff)
    ) {
      out += ch;
    }
  }
  return out;
}

const XML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

export function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => XML_ESCAPES[c] ?? c);
}

/** Cleans text for a `w:t` node: strip illegal chars, then escape. Order
 * matters — escaping first would turn `&` into `&amp;` and the stripper
 * would then (correctly, but pointlessly) leave the semicolon alone;
 * stripping first means the escaper only ever sees text already safe to
 * appear in XML 1.0. */
function cleanText(text: string): string {
  return escapeXml(stripIllegalXmlChars(text));
}

/** docx run size (`w:sz`) is in half-points. Clamped to a sane range so a
 * garbled or wildly-scaled PDF (a malformed `/FontMatrix`, a page rendered
 * at some huge zoom) can't hand Word a value it rejects outright — the
 * clamp bounds match a plausible 4pt-72pt real-world font size range. */
function halfPointSize(sizePt: number): number {
  const clamped = Math.min(72, Math.max(4, sizePt || 11));
  return Math.round(clamped * 2);
}

function runXml(run: LayoutRun): string {
  const rPr: string[] = [];
  if (run.bold) rPr.push("<w:b/>");
  if (run.italic) rPr.push("<w:i/>");
  const sz = halfPointSize(run.sizePt);
  rPr.push(`<w:sz w:val="${sz}"/>`, `<w:szCs w:val="${sz}"/>`);
  const rPrXml = `<w:rPr>${rPr.join("")}</w:rPr>`;
  return `<w:r>${rPrXml}<w:t xml:space="preserve">${cleanText(run.text)}</w:t></w:r>`;
}

function paragraphXml(paragraph: LayoutParagraph): string {
  const pPr =
    paragraph.heading > 0
      ? `<w:pPr><w:pStyle w:val="Heading${paragraph.heading}"/></w:pPr>`
      : "";
  const runs = paragraph.runs.map(runXml).join("");
  return `<w:p>${pPr}${runs}</w:p>`;
}

function documentXml(doc: LayoutDocument, options: DocxOptions): string {
  const body: string[] = [];
  doc.pages.forEach((page, pageIndex) => {
    if (pageIndex > 0 && options.pageBreaks) body.push(PAGE_BREAK_XML);
    for (const paragraph of page.paragraphs) body.push(paragraphXml(paragraph));
  });
  // A body with no content at all (an empty or fully-blank source PDF) still
  // needs at least one `w:p` — Word tolerates an empty paragraph, not an
  // empty `w:body` before its mandatory `w:sectPr`.
  if (body.length === 0) body.push("<w:p/>");
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    `<w:body>${body.join("")}${SECT_PR_XML}</w:body>` +
    "</w:document>\n"
  );
}

function corePropsXml(options: DocxOptions): string {
  const title = cleanText(options.title?.trim() || "Document");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${title}</dc:title>
<dc:creator>Localvert</dc:creator>
</cp:coreProperties>
`;
}

/** Builds a complete `.docx` (a zip archive) from a reconstructed
 * `LayoutDocument`. Deterministic for the same input/options (no embedded
 * timestamps beyond fflate's own zip entry defaults). */
export function buildDocx(
  doc: LayoutDocument,
  options: DocxOptions,
): Uint8Array {
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(CONTENT_TYPES_XML),
    "_rels/.rels": strToU8(ROOT_RELS_XML),
    "word/document.xml": strToU8(documentXml(doc, options)),
    "word/styles.xml": strToU8(STYLES_XML),
    "word/_rels/document.xml.rels": strToU8(DOCUMENT_RELS_XML),
    "docProps/core.xml": strToU8(corePropsXml(options)),
  };
  return zipSync(files, { level: 6 });
}
