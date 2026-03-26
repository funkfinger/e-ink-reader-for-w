import JSZip from "jszip";
import * as cheerio from "cheerio";

/**
 * Extract plain text from an EPUB file buffer.
 * Reads container.xml → OPF → spine → XHTML chapters in order.
 * @param {Buffer} epubBuffer
 * @returns {Promise<string>} extracted text
 */
export async function extractTextFromEpub(epubBuffer) {
  const zip = await JSZip.loadAsync(epubBuffer);

  // 1. Read container.xml to find OPF path
  const containerFile = zip.file("META-INF/container.xml");
  if (!containerFile) {
    throw new Error("Invalid EPUB: missing META-INF/container.xml");
  }
  const containerXml = await containerFile.async("text");
  const container$ = cheerio.load(containerXml, { xmlMode: true });
  const opfPath = container$("rootfile").attr("full-path");
  if (!opfPath) {
    throw new Error("Invalid EPUB: no rootfile in container.xml");
  }

  // 2. Read OPF to get manifest and spine
  const opfFile = zip.file(opfPath);
  if (!opfFile) {
    throw new Error("Invalid EPUB: OPF file not found at " + opfPath);
  }
  const opfXml = await opfFile.async("text");
  const opf$ = cheerio.load(opfXml, { xmlMode: true });

  // Build manifest map: id → href
  const manifest = {};
  opf$("manifest item").each((_, el) => {
    const id = opf$(el).attr("id");
    const href = opf$(el).attr("href");
    if (id && href) manifest[id] = href;
  });

  // Get spine order (list of idrefs)
  const spineIds = [];
  opf$("spine itemref").each((_, el) => {
    const idref = opf$(el).attr("idref");
    if (idref) spineIds.push(idref);
  });

  if (spineIds.length === 0) {
    throw new Error("Invalid EPUB: empty spine");
  }

  // 3. Resolve OPF base directory for relative hrefs
  const opfDir = opfPath.includes("/")
    ? opfPath.substring(0, opfPath.lastIndexOf("/") + 1)
    : "";

  // 4. Extract text from each chapter in spine order
  const parts = [];
  for (const id of spineIds) {
    const href = manifest[id];
    if (!href) continue;

    const filePath = opfDir + href;
    const file = zip.file(filePath);
    if (!file) continue;

    const xhtml = await file.async("text");
    const text = xhtmlToText(xhtml);
    if (text.trim().length > 0) {
      parts.push(text.trim());
    }
  }

  return parts.join("\n\n");
}

/**
 * Convert XHTML to plain text.
 * - <p> → \n\n
 * - <h1>-<h6> → \n\n
 * - <br> → \n
 * - <img alt="..."> → [alt text]
 * - <li> → \n
 * - Everything else: strip tags, keep text
 * @param {string} xhtml
 * @returns {string}
 */
function xhtmlToText(xhtml) {
  const $ = cheerio.load(xhtml, { xmlMode: true });

  // Replace <br> with newline markers before text extraction
  $("br").replaceWith("\n");

  // Replace <img> with alt text or nothing
  $("img").each((_, el) => {
    const alt = $(el).attr("alt");
    if (alt) {
      $(el).replaceWith(`[${alt}]`);
    } else {
      $(el).remove();
    }
  });

  // Process body content
  const body = $("body");
  if (body.length === 0) return "";

  const blocks = [];

  function processNode(node) {
    if (node.type === "text") {
      return node.data;
    }

    if (node.type !== "tag") return "";

    const tag = node.name.toLowerCase();
    const children = node.children || [];
    const inner = children.map(processNode).join("");

    // Block-level elements that get double newlines
    if (
      tag === "p" ||
      tag === "div" ||
      tag === "blockquote" ||
      /^h[1-6]$/.test(tag)
    ) {
      return "\n\n" + inner;
    }

    // List items get single newlines
    if (tag === "li") {
      return "\n" + inner;
    }

    // Skip head, style, script
    if (tag === "head" || tag === "style" || tag === "script") {
      return "";
    }

    return inner;
  }

  const result = body
    .contents()
    .toArray()
    .map(processNode)
    .join("");

  // Clean up: collapse excessive newlines, trim
  return result
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
