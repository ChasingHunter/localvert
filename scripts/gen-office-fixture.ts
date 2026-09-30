/**
 * One-off generator for `e2e/fixtures/sample.docx` — a minimal, hand-built
 * WordprocessingML document (no Word/LibreOffice involved in producing it),
 * committed alongside this script rather than run at test time. Re-run with
 * `node scripts/gen-office-fixture.ts` if the fixture ever needs to change.
 *
 * `fflate` (already a dependency — see `package.json`) does the ZIP
 * packaging; the three parts below are the smallest set OOXML's own spec
 * requires for a valid .docx: the content-types manifest, the package
 * relationship pointing at the main document part, and the document part
 * itself, one paragraph, no styles/theme/settings parts at all. LibreOffice
 * (and every other OOXML consumer) tolerates the missing optional parts.
 *
 * Runs as plain `node scripts/gen-office-fixture.ts` (Node's built-in
 * TypeScript type stripping — no build step), same convention as
 * `scripts/sync-engines.ts`/`scripts/gen-registry.ts`.
 */
import { writeFileSync } from "node:fs";
import { zipSync } from "fflate";

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>
`;

const PACKAGE_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>
`;

/** The one paragraph `e2e/office.spec.ts` looks for in the converted PDF's
 * extracted text. */
const DOCUMENT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
<w:p><w:r><w:t>Hello Localvert</w:t></w:r></w:p>
</w:body>
</w:document>
`;

function toBytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

const docx = zipSync(
  {
    "[Content_Types].xml": toBytes(CONTENT_TYPES),
    "_rels/.rels": toBytes(PACKAGE_RELS),
    "word/document.xml": toBytes(DOCUMENT_XML),
  },
  // Deterministic output (a fixed, valid DOS zip timestamp — fflate rejects
  // anything before 1980) so a re-run produces a byte-identical fixture when
  // the content above hasn't changed.
  { level: 9, mtime: new Date("2024-01-01T00:00:00Z") },
);

// Same deterministic options for the pptx below.
const ZIP_OPTS = { level: 9, mtime: new Date("2024-01-01T00:00:00Z") } as const;

const PPTX_CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>
`;

const REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const DOC_REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

const PPTX_PACKAGE_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${REL_NS}">
<Relationship Id="rId1" Type="${DOC_REL}/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>
`;

const NS_DECL =
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';

const PRESENTATION_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation ${NS_DECL}>
<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
<p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst>
<p:sldSz cx="9144000" cy="6858000"/>
<p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>
`;

const PRESENTATION_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${REL_NS}">
<Relationship Id="rId1" Type="${DOC_REL}/slideMaster" Target="slideMasters/slideMaster1.xml"/>
<Relationship Id="rId2" Type="${DOC_REL}/slide" Target="slides/slide1.xml"/>
</Relationships>
`;

const EMPTY_TREE =
  '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>';

const SLIDE_MASTER_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster ${NS_DECL}>
<p:cSld><p:spTree>${EMPTY_TREE}</p:spTree></p:cSld>
<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>
</p:sldMaster>
`;

const SLIDE_MASTER_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${REL_NS}">
<Relationship Id="rId1" Type="${DOC_REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>
`;

const SLIDE_LAYOUT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout ${NS_DECL} type="blank">
<p:cSld name="Blank"><p:spTree>${EMPTY_TREE}</p:spTree></p:cSld>
</p:sldLayout>
`;

const SLIDE_LAYOUT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${REL_NS}">
<Relationship Id="rId1" Type="${DOC_REL}/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>
`;

const SLIDE_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld ${NS_DECL}>
<p:cSld><p:spTree>${EMPTY_TREE}
<p:sp>
<p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="914400" y="914400"/><a:ext cx="7315200" cy="1143000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="4000"/><a:t>Hello Localvert</a:t></a:r></a:p></p:txBody>
</p:sp>
</p:spTree></p:cSld>
</p:sld>
`;

const SLIDE_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${REL_NS}">
<Relationship Id="rId1" Type="${DOC_REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>
`;

const pptx = zipSync(
  {
    "[Content_Types].xml": toBytes(PPTX_CONTENT_TYPES),
    "_rels/.rels": toBytes(PPTX_PACKAGE_RELS),
    "ppt/presentation.xml": toBytes(PRESENTATION_XML),
    "ppt/_rels/presentation.xml.rels": toBytes(PRESENTATION_RELS),
    "ppt/slideMasters/slideMaster1.xml": toBytes(SLIDE_MASTER_XML),
    "ppt/slideMasters/_rels/slideMaster1.xml.rels": toBytes(SLIDE_MASTER_RELS),
    "ppt/slideLayouts/slideLayout1.xml": toBytes(SLIDE_LAYOUT_XML),
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels": toBytes(SLIDE_LAYOUT_RELS),
    "ppt/slides/slide1.xml": toBytes(SLIDE_XML),
    "ppt/slides/_rels/slide1.xml.rels": toBytes(SLIDE_RELS),
  },
  ZIP_OPTS,
);

for (const [path, bytes] of [
  ["e2e/fixtures/sample.docx", docx],
  ["e2e/fixtures/sample.pptx", pptx],
] as const) {
  writeFileSync(path, bytes);
  // biome-ignore lint/suspicious/noConsole: this is the script's own completion summary.
  console.log(`wrote ${path} (${bytes.length} bytes)`);
}
