import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { extractTextFromEpub } from "../lib/epub.js";

// Helper to build a minimal valid EPUB as a Buffer
async function buildEpub(chapters, opts = {}) {
  const zip = new JSZip();

  // container.xml — points to content.opf
  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`
  );

  // Build manifest and spine from chapters
  const manifestItems = chapters
    .map((_, i) => `<item id="ch${i}" href="ch${i}.xhtml" media-type="application/xhtml+xml"/>`)
    .join("\n    ");
  const spineItems = chapters
    .map((_, i) => `<itemref idref="ch${i}"/>`)
    .join("\n    ");

  zip.file(
    "OEBPS/content.opf",
    `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Test Book</dc:title>
  </metadata>
  <manifest>
    ${manifestItems}
  </manifest>
  <spine>
    ${spineItems}
  </spine>
</package>`
  );

  // Add chapter XHTML files
  chapters.forEach((html, i) => {
    zip.file(
      `OEBPS/ch${i}.xhtml`,
      `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Chapter ${i + 1}</title></head>
<body>${html}</body>
</html>`
    );
  });

  return zip.generateAsync({ type: "nodebuffer" });
}

describe("extractTextFromEpub", () => {
  it("extracts plain text from a single chapter", async () => {
    const epub = await buildEpub(["<p>Hello world.</p>"]);
    const text = await extractTextFromEpub(epub);
    expect(text).toContain("Hello world.");
  });

  it("extracts text from multiple chapters in spine order", async () => {
    const epub = await buildEpub([
      "<p>Chapter one content.</p>",
      "<p>Chapter two content.</p>",
    ]);
    const text = await extractTextFromEpub(epub);
    const onePos = text.indexOf("Chapter one");
    const twoPos = text.indexOf("Chapter two");
    expect(onePos).toBeGreaterThanOrEqual(0);
    expect(twoPos).toBeGreaterThan(onePos);
  });

  it("converts paragraphs to double newlines", async () => {
    const epub = await buildEpub([
      "<p>First paragraph.</p><p>Second paragraph.</p>",
    ]);
    const text = await extractTextFromEpub(epub);
    expect(text).toContain("First paragraph.\n\nSecond paragraph.");
  });

  it("converts <br> to single newline", async () => {
    const epub = await buildEpub(["<p>Line one.<br/>Line two.</p>"]);
    const text = await extractTextFromEpub(epub);
    expect(text).toContain("Line one.\nLine two.");
  });

  it("converts headings with double newlines", async () => {
    const epub = await buildEpub([
      "<h1>Title</h1><p>Content here.</p>",
    ]);
    const text = await extractTextFromEpub(epub);
    expect(text).toContain("Title\n\nContent here.");
  });

  it("replaces images with alt text", async () => {
    const epub = await buildEpub([
      '<p>Before.<img alt="A cool map"/>After.</p>',
    ]);
    const text = await extractTextFromEpub(epub);
    expect(text).toContain("[A cool map]");
  });

  it("strips images without alt text silently", async () => {
    const epub = await buildEpub(['<p>Before.<img src="pic.jpg"/>After.</p>']);
    const text = await extractTextFromEpub(epub);
    expect(text).toContain("Before.After.");
    expect(text).not.toContain("[");
  });

  it("strips all HTML tags", async () => {
    const epub = await buildEpub([
      "<p>Some <em>emphasized</em> and <strong>bold</strong> text.</p>",
    ]);
    const text = await extractTextFromEpub(epub);
    expect(text).toContain("Some emphasized and bold text.");
    expect(text).not.toContain("<em>");
    expect(text).not.toContain("<strong>");
  });

  it("rejects a zip that has no container.xml", async () => {
    const zip = new JSZip();
    zip.file("random.txt", "not an epub");
    const buf = await zip.generateAsync({ type: "nodebuffer" });
    await expect(extractTextFromEpub(buf)).rejects.toThrow(/container\.xml/i);
  });

  it("rejects a zip with container.xml but no OPF", async () => {
    const zip = new JSZip();
    zip.file(
      "META-INF/container.xml",
      `<?xml version="1.0"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
  <rootfiles>
    <rootfile full-path="missing.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`
    );
    const buf = await zip.generateAsync({ type: "nodebuffer" });
    await expect(extractTextFromEpub(buf)).rejects.toThrow(/opf/i);
  });

  it("handles list items", async () => {
    const epub = await buildEpub([
      "<ul><li>Item one</li><li>Item two</li></ul>",
    ]);
    const text = await extractTextFromEpub(epub);
    expect(text).toContain("Item one");
    expect(text).toContain("Item two");
  });
});
