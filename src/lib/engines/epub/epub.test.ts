import { describe, expect, it } from "vitest";
import {
  epubFilesToHtml,
  extractBody,
  inlineImages,
  parseContainerRootfile,
  parseOpf,
  resolvePath,
} from "./epub";

describe("parseContainerRootfile", () => {
  it("extracts the OPF path from a real container.xml shape", () => {
    const xml =
      '<?xml version="1.0"?><container><rootfiles>' +
      '<rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>' +
      "</rootfiles></container>";
    expect(parseContainerRootfile(xml)).toBe("OEBPS/content.opf");
  });

  it("returns null when there is no rootfile", () => {
    expect(parseContainerRootfile("<container></container>")).toBeNull();
  });
});

describe("parseOpf", () => {
  const opf = `<?xml version="1.0"?>
<package>
  <manifest>
    <item id="ch1" href="text/chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="text/chapter2.xhtml" media-type="application/xhtml+xml"/>
    <item id="cover" href="images/cover.jpg" media-type="image/jpeg"/>
  </manifest>
  <spine>
    <itemref idref="ch1"/>
    <itemref idref="ch2"/>
  </spine>
</package>`;

  it("collects manifest items keyed by id", () => {
    const { manifest } = parseOpf(opf);
    expect(manifest.get("ch1")).toEqual({
      href: "text/chapter1.xhtml",
      mediaType: "application/xhtml+xml",
    });
    expect(manifest.get("cover")).toEqual({
      href: "images/cover.jpg",
      mediaType: "image/jpeg",
    });
  });

  it("reads the spine in declared (reading) order", () => {
    const { spine } = parseOpf(opf);
    expect(spine).toEqual(["ch1", "ch2"]);
  });

  it("returns empty manifest/spine for a document with neither", () => {
    const { manifest, spine } = parseOpf("<package></package>");
    expect(manifest.size).toBe(0);
    expect(spine).toEqual([]);
  });
});

describe("resolvePath", () => {
  it("resolves a chapter-relative href against the OPF's directory", () => {
    expect(resolvePath("OEBPS/content.opf", "text/chapter1.xhtml")).toBe(
      "OEBPS/text/chapter1.xhtml",
    );
  });

  it("resolves an image path relative to its own chapter file", () => {
    expect(
      resolvePath("OEBPS/text/chapter1.xhtml", "../images/cover.jpg"),
    ).toBe("OEBPS/images/cover.jpg");
  });

  it("leaves an absolute http(s) or data URI unchanged", () => {
    expect(resolvePath("OEBPS/content.opf", "https://example.test/x.png")).toBe(
      "https://example.test/x.png",
    );
    expect(resolvePath("OEBPS/content.opf", "data:image/png;base64,AAA")).toBe(
      "data:image/png;base64,AAA",
    );
  });

  it("handles a root-level OPF with no directory", () => {
    expect(resolvePath("content.opf", "chapter1.xhtml")).toBe("chapter1.xhtml");
  });
});

describe("extractBody", () => {
  it("extracts the body's inner content", () => {
    const xhtml =
      "<html><head><title>t</title></head><body><p>hello</p></body></html>";
    expect(extractBody(xhtml)).toBe("<p>hello</p>");
  });

  it("passes a bodyless fragment through unchanged", () => {
    expect(extractBody("<p>hello</p>")).toBe("<p>hello</p>");
  });
});

describe("inlineImages", () => {
  const files = new Map<string, Uint8Array>([
    ["OEBPS/images/cover.jpg", new Uint8Array([1, 2, 3])],
  ]);

  it("rewrites an <img src> to a data: URI when the file exists", () => {
    const html = inlineImages(
      '<img src="../images/cover.jpg" alt="cover">',
      "OEBPS/text/chapter1.xhtml",
      files,
    );
    expect(html).toContain("data:image/jpeg;base64,");
    expect(html).not.toContain("../images/cover.jpg");
  });

  it("drops a missing image reference with an inline note", () => {
    const html = inlineImages(
      '<img src="../images/missing.png" alt="x">',
      "OEBPS/text/chapter1.xhtml",
      files,
    );
    expect(html).toContain("<!-- localvert: missing epub image");
    expect(html).not.toContain("<img");
  });

  it("leaves an already-inline data: URI untouched", () => {
    const html = inlineImages(
      '<img src="data:image/png;base64,AAA">',
      "OEBPS/text/chapter1.xhtml",
      files,
    );
    expect(html).toContain('src="data:image/png;base64,AAA"');
  });

  it("rewrites an SVG <image xlink:href> the same way", () => {
    const html = inlineImages(
      '<svg><image xlink:href="../images/cover.jpg"/></svg>',
      "OEBPS/text/chapter1.xhtml",
      files,
    );
    expect(html).toContain("data:image/jpeg;base64,");
  });
});

describe("epubFilesToHtml", () => {
  function fixtureFiles(): Map<string, Uint8Array> {
    const enc = new TextEncoder();
    return new Map<string, Uint8Array>([
      [
        "META-INF/container.xml",
        enc.encode(
          '<?xml version="1.0"?><container><rootfiles>' +
            '<rootfile full-path="OEBPS/content.opf"/>' +
            "</rootfiles></container>",
        ),
      ],
      [
        "OEBPS/content.opf",
        enc.encode(
          "<package><manifest>" +
            '<item id="ch1" href="text/chapter1.xhtml" media-type="application/xhtml+xml"/>' +
            '<item id="ch2" href="text/chapter2.xhtml" media-type="application/xhtml+xml"/>' +
            "</manifest><spine>" +
            '<itemref idref="ch2"/><itemref idref="ch1"/>' +
            "</spine></package>",
        ),
      ],
      [
        "OEBPS/text/chapter1.xhtml",
        enc.encode("<html><body><p>Chapter One</p></body></html>"),
      ],
      [
        "OEBPS/text/chapter2.xhtml",
        enc.encode("<html><body><p>Chapter Two</p></body></html>"),
      ],
    ]);
  }

  it("concatenates chapters in spine order, not manifest order", () => {
    const { html } = epubFilesToHtml(fixtureFiles());
    const posTwo = html.indexOf("Chapter Two");
    const posOne = html.indexOf("Chapter One");
    expect(posTwo).toBeGreaterThan(-1);
    expect(posOne).toBeGreaterThan(posTwo);
  });

  it("wraps the result as one HTML document", () => {
    const { html } = epubFilesToHtml(fixtureFiles());
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<body>");
  });

  it("throws when container.xml is missing", () => {
    expect(() => epubFilesToHtml(new Map())).toThrow(/container\.xml/);
  });

  it("collects a warning for a spine idref with no manifest entry, without throwing", () => {
    const files = fixtureFiles();
    const opfWithBadSpine = new TextEncoder().encode(
      "<package><manifest>" +
        '<item id="ch1" href="text/chapter1.xhtml" media-type="application/xhtml+xml"/>' +
        "</manifest><spine>" +
        '<itemref idref="ch1"/><itemref idref="ghost"/>' +
        "</spine></package>",
    );
    files.set("OEBPS/content.opf", opfWithBadSpine);
    const { html, warnings } = epubFilesToHtml(files);
    expect(html).toContain("Chapter One");
    expect(warnings).toEqual([
      'spine references unknown manifest item "ghost"',
    ]);
  });
});
