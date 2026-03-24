/**
 * Replace common Unicode characters with ASCII equivalents,
 * then strip any remaining non-ASCII characters.
 * Preserves newlines, tabs, and printable ASCII.
 * @param {string} input
 * @returns {string} sanitized ASCII text
 */
export function sanitizeText(input) {
  return input
    .replace(/[\u2018\u2019\u201A]/g, "'")     // curly single quotes
    .replace(/[\u201C\u201D\u201E]/g, '"')      // curly double quotes
    .replace(/\u2014/g, "--")                    // em dash
    .replace(/\u2013/g, "-")                     // en dash
    .replace(/\u2026/g, "...")                   // ellipsis
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, ""); // strip non-ASCII
}

/**
 * Word-wrap text to a fixed character width.
 * Preserves existing newlines. Breaks long words if necessary.
 * @param {string} input
 * @param {number} maxWidth - characters per line
 * @returns {string[]} wrapped lines
 */
export function wordWrap(input, maxWidth) {
  if (!input) return [];

  const paragraphs = input.split("\n");
  const result = [];

  for (const paragraph of paragraphs) {
    if (paragraph === "") {
      result.push("");
      continue;
    }

    const words = paragraph.split(/( +)/); // keep spaces as tokens
    let currentLine = "";

    for (const token of words) {
      if (token === "") continue;

      // If adding this token would exceed width
      if (currentLine.length + token.length > maxWidth) {
        // Flush current line if non-empty
        if (currentLine.length > 0) {
          result.push(currentLine.trimEnd());
          currentLine = "";
        }

        // Handle tokens longer than maxWidth (break them)
        let remaining = token.trimStart(); // trim leading spaces on new line
        while (remaining.length > maxWidth) {
          result.push(remaining.slice(0, maxWidth));
          remaining = remaining.slice(maxWidth);
        }
        if (remaining.length > 0) {
          currentLine = remaining;
        }
      } else {
        currentLine += token;
      }
    }

    if (currentLine.length > 0) {
      result.push(currentLine);
    }
  }

  return result;
}

/**
 * Split an array of lines into pages.
 * @param {string[]} lines
 * @param {number} linesPerPage
 * @returns {string[][]} array of pages, each an array of lines
 */
export function paginate(lines, linesPerPage) {
  if (lines.length === 0) return [];

  const pages = [];
  for (let i = 0; i < lines.length; i += linesPerPage) {
    pages.push(lines.slice(i, i + linesPerPage));
  }
  return pages;
}

/**
 * Build the output text and binary index from pages.
 * @param {string[][]} pages
 * @returns {{ text: string, index: Buffer }}
 *   text: all lines joined with \n
 *   index: Buffer of uint32 LE byte offsets, one per page start
 */
export function buildIndex(pages) {
  if (pages.length === 0) return { text: "", index: Buffer.alloc(0) };

  const index = Buffer.alloc(pages.length * 4);
  let text = "";
  let byteOffset = 0;

  for (let i = 0; i < pages.length; i++) {
    index.writeUInt32LE(byteOffset, i * 4);
    const pageText = pages[i].map((line) => line + "\n").join("");
    text += pageText;
    byteOffset += Buffer.byteLength(pageText, "utf8");
  }

  return { text, index };
}
