import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import type { LayoutDocument } from "../shared/pdf-layout";
import { buildDocx, escapeXml, stripIllegalXmlChars } from "./writer";

function unzipDocx(bytes: Uint8Array) {
  return unzipSync(bytes);
}

describe("buildDocx", () => {
  it("produces a valid zip with the required OOXML parts", () => {
    const doc: LayoutDocument = {
      pages: [
        {
          paragraphs: [
            {
              runs: [{ text: "Hello", bold: false, italic: false, sizePt: 11 }],
              heading: 0,
            },
          ],
        },
      ],
    };
    const bytes = buildDocx(doc, { pageBreaks: true });
    // A .docx is a zip — the first four bytes are the local file header
    // signature, same check `docx`'s own `magic` entry in formats.ts uses.
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);

    const files = unzipDocx(bytes);
    expect(Object.keys(files).sort()).toEqual(
      [
        "[Content_Types].xml",
        "_rels/.rels",
        "docProps/core.xml",
        "word/_rels/document.xml.rels",
        "word/document.xml",
        "word/styles.xml",
      ].sort(),
    );
  });

  it("round-trips paragraph text through document.xml", () => {
    const doc: LayoutDocument = {
      pages: [
        {
          paragraphs: [
            {
              runs: [
                {
                  text: "The quick brown fox",
                  bold: false,
                  italic: false,
                  sizePt: 11,
                },
              ],
              heading: 0,
            },
          ],
        },
      ],
    };
    const files = unzipDocx(buildDocx(doc, { pageBreaks: false }));
    const documentXml = strFromU8(files["word/document.xml"] as Uint8Array);
    expect(documentXml).toContain("The quick brown fox");
  });

  it("escapes XML-special characters in run text and the title", () => {
    const doc: LayoutDocument = {
      pages: [
        {
          paragraphs: [
            {
              runs: [
                {
                  text: `Tom & Jerry <says> "hi" 'there'`,
                  bold: false,
                  italic: false,
                  sizePt: 11,
                },
              ],
              heading: 0,
            },
          ],
        },
      ],
    };
    const files = unzipDocx(
      buildDocx(doc, { pageBreaks: false, title: "A & B" }),
    );
    const documentXml = strFromU8(files["word/document.xml"] as Uint8Array);
    expect(documentXml).toContain(
      "Tom &amp; Jerry &lt;says&gt; &quot;hi&quot; &apos;there&apos;",
    );
    expect(documentXml).not.toMatch(/[^&]&[^a-z#]/); // no bare, un-escaped "&"
    const coreXml = strFromU8(files["docProps/core.xml"] as Uint8Array);
    expect(coreXml).toContain("<dc:title>A &amp; B</dc:title>");
  });

  it("marks headings with the matching pStyle and runs body text as Normal (no pStyle)", () => {
    const doc: LayoutDocument = {
      pages: [
        {
          paragraphs: [
            {
              runs: [{ text: "Title", bold: true, italic: false, sizePt: 24 }],
              heading: 1,
            },
            {
              runs: [
                { text: "Subtitle", bold: true, italic: false, sizePt: 16 },
              ],
              heading: 2,
            },
            {
              runs: [
                { text: "Section", bold: true, italic: false, sizePt: 13 },
              ],
              heading: 3,
            },
            {
              runs: [
                { text: "Body text.", bold: false, italic: false, sizePt: 11 },
              ],
              heading: 0,
            },
          ],
        },
      ],
    };
    const files = unzipDocx(buildDocx(doc, { pageBreaks: false }));
    const xml = strFromU8(files["word/document.xml"] as Uint8Array);
    expect(xml).toContain('<w:pStyle w:val="Heading1"/>');
    expect(xml).toContain('<w:pStyle w:val="Heading2"/>');
    expect(xml).toContain('<w:pStyle w:val="Heading3"/>');
    // Body paragraph's own <w:p> has no pPr/pStyle at all — assert there's no
    // stray "Heading0" or similar rather than a fragile substring check.
    expect(xml).not.toContain("Heading0");
    const stylesXml = strFromU8(files["word/styles.xml"] as Uint8Array);
    expect(stylesXml).toContain('w:styleId="Normal"');
    expect(stylesXml).toContain('w:styleId="Heading1"');
    expect(stylesXml).toContain('w:styleId="Heading2"');
    expect(stylesXml).toContain('w:styleId="Heading3"');
  });

  it("marks runs bold/italic via rPr", () => {
    const doc: LayoutDocument = {
      pages: [
        {
          paragraphs: [
            {
              runs: [{ text: "strong", bold: true, italic: true, sizePt: 11 }],
              heading: 0,
            },
          ],
        },
      ],
    };
    const xml = strFromU8(
      unzipDocx(buildDocx(doc, { pageBreaks: false }))[
        "word/document.xml"
      ] as Uint8Array,
    );
    expect(xml).toContain("<w:b/>");
    expect(xml).toContain("<w:i/>");
  });

  it("inserts a page break between pages only when pageBreaks is true", () => {
    const doc: LayoutDocument = {
      pages: [
        {
          paragraphs: [
            {
              runs: [
                { text: "Page 1", bold: false, italic: false, sizePt: 11 },
              ],
              heading: 0,
            },
          ],
        },
        {
          paragraphs: [
            {
              runs: [
                { text: "Page 2", bold: false, italic: false, sizePt: 11 },
              ],
              heading: 0,
            },
          ],
        },
      ],
    };
    const withBreaks = strFromU8(
      unzipDocx(buildDocx(doc, { pageBreaks: true }))[
        "word/document.xml"
      ] as Uint8Array,
    );
    expect(withBreaks).toContain('<w:br w:type="page"/>');

    const withoutBreaks = strFromU8(
      unzipDocx(buildDocx(doc, { pageBreaks: false }))[
        "word/document.xml"
      ] as Uint8Array,
    );
    expect(withoutBreaks).not.toContain('<w:br w:type="page"/>');
  });

  it("never emits a page break before the first page", () => {
    const doc: LayoutDocument = {
      pages: [
        {
          paragraphs: [
            {
              runs: [
                { text: "Only page", bold: false, italic: false, sizePt: 11 },
              ],
              heading: 0,
            },
          ],
        },
      ],
    };
    const xml = strFromU8(
      unzipDocx(buildDocx(doc, { pageBreaks: true }))[
        "word/document.xml"
      ] as Uint8Array,
    );
    expect(xml).not.toContain('w:type="page"');
  });

  it("produces a valid (non-empty body) document for an entirely empty layout", () => {
    const doc: LayoutDocument = { pages: [] };
    const xml = strFromU8(
      unzipDocx(buildDocx(doc, { pageBreaks: true }))[
        "word/document.xml"
      ] as Uint8Array,
    );
    expect(xml).toContain("<w:body>");
    expect(xml).toMatch(/<w:p\/>|<w:p>/);
  });
});

describe("stripIllegalXmlChars", () => {
  it("keeps tab/newline/carriage-return and ordinary text", () => {
    expect(stripIllegalXmlChars("a\tb\nc\rd")).toBe("a\tb\nc\rd");
  });

  it("drops C0 control characters other than tab/LF/CR", () => {
    expect(stripIllegalXmlChars("a\u0000b\u0001c\u000bd")).toBe("abcd");
  });

  it("keeps astral characters (surrogate pairs) intact", () => {
    const emoji = "😀";
    expect(stripIllegalXmlChars(`x${emoji}y`)).toBe(`x${emoji}y`);
  });
});

describe("escapeXml", () => {
  it("escapes all five XML special characters", () => {
    expect(escapeXml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&apos;");
  });
});
