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
 * (Normal/Heading1-3), no theme, no numbering. Images are inline pictures in
 * their own paragraphs (docs/adr/0014-pdf-to-word.md, "Images"). Word opens a
 * package this small without complaint; it's the same shape `python-docx`'s
 * own default template produces stripped to essentials.
 */
import { strToU8, type Zippable, zipSync } from "fflate";
import { base64ToBytes } from "../shared/base64";
import {
  imageExtentEmu,
  type LayoutDocument,
  type LayoutImage,
  type LayoutParagraph,
  type LayoutRun,
  orderPageBlocks,
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
<Default Extension="png" ContentType="image/png"/>
<Default Extension="jpeg" ContentType="image/jpeg"/>
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

const IMAGE_REL_TYPE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";

function documentRelsXml(media: readonly MediaPart[]): string {
  const imageRels = media
    .map(
      (m) =>
        `<Relationship Id="${m.rId}" Type="${IMAGE_REL_TYPE}" Target="media/${m.name}"/>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
${imageRels}
</Relationships>
`;
}

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

/** Content area of the Letter page above, in EMU (914400 per inch). */
const CONTENT_WIDTH_EMU = 6.5 * 914400;
const CONTENT_HEIGHT_EMU = 9 * 914400;

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

interface MediaPart {
  rId: string;
  name: string;
  bytes: Uint8Array;
}

/** Collects the media parts as images are written, so the same picture
 * repeated on several pages (a logo) is stored once and referenced each time. */
class MediaCollector {
  readonly parts: MediaPart[] = [];
  private readonly byData = new Map<string, MediaPart>();

  add(image: LayoutImage): MediaPart {
    const key = `${image.mime}:${image.data}`;
    let part = this.byData.get(key);
    if (!part) {
      const n = this.parts.length + 1;
      part = {
        // rId1 is the styles part.
        rId: `rId${n + 1}`,
        name: `image${n}.${image.mime === "image/jpeg" ? "jpeg" : "png"}`,
        bytes: base64ToBytes(image.data),
      };
      this.byData.set(key, part);
      this.parts.push(part);
    }
    return part;
  }
}

function imageParagraphXml(
  image: LayoutImage,
  part: MediaPart,
  docPrId: number,
): string {
  const { cx, cy } = imageExtentEmu(
    image,
    CONTENT_WIDTH_EMU,
    CONTENT_HEIGHT_EMU,
  );
  return (
    "<w:p><w:r><w:drawing>" +
    '<wp:inline distT="0" distB="0" distL="0" distR="0">' +
    `<wp:extent cx="${cx}" cy="${cy}"/>` +
    `<wp:docPr id="${docPrId}" name="Picture ${docPrId}"/>` +
    '<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
    '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    `<pic:pic><pic:nvPicPr><pic:cNvPr id="${docPrId}" name="${part.name}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${part.rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    "</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>"
  );
}

function documentXml(
  doc: LayoutDocument,
  options: DocxOptions,
  media: MediaCollector,
): string {
  const body: string[] = [];
  let docPrId = 0;
  doc.pages.forEach((page, pageIndex) => {
    if (pageIndex > 0 && options.pageBreaks) body.push(PAGE_BREAK_XML);
    for (const block of orderPageBlocks(page.paragraphs, page.images)) {
      if (block.kind === "paragraph") {
        body.push(paragraphXml(block.paragraph));
      } else {
        body.push(
          imageParagraphXml(block.image, media.add(block.image), ++docPrId),
        );
      }
    }
  });
  // A body with no content at all (an empty or fully-blank source PDF) still
  // needs at least one `w:p` — Word tolerates an empty paragraph, not an
  // empty `w:body` before its mandatory `w:sectPr`.
  if (body.length === 0) body.push("<w:p/>");
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
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
  const media = new MediaCollector();
  const documentXmlText = documentXml(doc, options, media);
  const files: Zippable = {
    "[Content_Types].xml": strToU8(CONTENT_TYPES_XML),
    "_rels/.rels": strToU8(ROOT_RELS_XML),
    "word/document.xml": strToU8(documentXmlText),
    "word/styles.xml": strToU8(STYLES_XML),
    "word/_rels/document.xml.rels": strToU8(documentRelsXml(media.parts)),
    "docProps/core.xml": strToU8(corePropsXml(options)),
  };
  // JPEG/PNG bytes are already compressed: store them as-is.
  for (const part of media.parts) {
    files[`word/media/${part.name}`] = [part.bytes, { level: 0 }];
  }
  return zipSync(files, { level: 6 });
}
