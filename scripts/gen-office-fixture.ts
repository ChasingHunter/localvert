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

const zipped = zipSync(
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

const outPath = "e2e/fixtures/sample.docx";
writeFileSync(outPath, zipped);
// biome-ignore lint/suspicious/noConsole: this is the script's own completion summary.
console.log(`wrote ${outPath} (${zipped.length} bytes)`);
