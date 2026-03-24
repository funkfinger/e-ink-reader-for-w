import { describe, it, expect } from "vitest";
import { wordWrap, paginate, buildIndex } from "../lib/paginate.js";

const CHARS_PER_LINE = 18;
const LINES_PER_PAGE = 6;

describe("wordWrap", () => {
  it("returns empty array for empty string", () => {
    expect(wordWrap("", CHARS_PER_LINE)).toEqual([]);
  });

  it("keeps short lines intact", () => {
    expect(wordWrap("hello", CHARS_PER_LINE)).toEqual(["hello"]);
  });

  it("wraps at word boundaries", () => {
    const input = "the quick brown fox jumps over";
    const lines = wordWrap(input, CHARS_PER_LINE);
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(CHARS_PER_LINE);
    }
    expect(lines).toEqual(["the quick brown", "fox jumps over"]);
  });

  it("breaks long words that exceed line width", () => {
    const input = "abcdefghijklmnopqrstuvwxyz";
    const lines = wordWrap(input, CHARS_PER_LINE);
    expect(lines[0].length).toBeLessThanOrEqual(CHARS_PER_LINE);
    expect(lines.join("")).toBe(input);
  });

  it("preserves existing newlines", () => {
    const input = "line one\nline two";
    const lines = wordWrap(input, CHARS_PER_LINE);
    expect(lines).toEqual(["line one", "line two"]);
  });

  it("handles multiple spaces between words", () => {
    const input = "hello   world";
    const lines = wordWrap(input, CHARS_PER_LINE);
    expect(lines).toEqual(["hello   world"]);
  });

  it("does not leave trailing whitespace on wrapped lines", () => {
    // When a line wraps after a word followed by a space,
    // the trailing space should be trimmed from the wrapped line
    const input = "aaa bbb ccc ddd eee fff ggg";
    const lines = wordWrap(input, 12);
    for (const line of lines) {
      expect(line).toBe(line.trimEnd());
    }
  });
});

describe("paginate", () => {
  it("returns empty array for empty lines", () => {
    expect(paginate([], LINES_PER_PAGE)).toEqual([]);
  });

  it("puts lines into pages of correct size", () => {
    const lines = Array.from({ length: 14 }, (_, i) => `line ${i + 1}`);
    const pages = paginate(lines, LINES_PER_PAGE);
    expect(pages.length).toBe(3);
    expect(pages[0].length).toBe(6);
    expect(pages[1].length).toBe(6);
    expect(pages[2].length).toBe(2);
  });

  it("single page for few lines", () => {
    const lines = ["one", "two", "three"];
    const pages = paginate(lines, LINES_PER_PAGE);
    expect(pages.length).toBe(1);
    expect(pages[0]).toEqual(["one", "two", "three"]);
  });
});

describe("buildIndex", () => {
  it("returns buffer with one offset (0) for single page", () => {
    const pages = [["hello", "world"]];
    const { text, index } = buildIndex(pages);
    expect(text).toBe("hello\nworld\n");
    // Index: single uint32 LE = 0
    expect(index.length).toBe(4);
    expect(index.readUInt32LE(0)).toBe(0);
  });

  it("calculates correct byte offsets for multiple pages", () => {
    const pages = [["aaa", "bbb"], ["ccc", "ddd"]];
    const { text, index } = buildIndex(pages);
    // Page 1: "aaa\nbbb\n" = 8 bytes
    expect(index.readUInt32LE(0)).toBe(0);
    expect(index.readUInt32LE(4)).toBe(8);
    expect(text).toBe("aaa\nbbb\nccc\nddd\n");
  });

  it("handles empty input", () => {
    const { text, index } = buildIndex([]);
    expect(text).toBe("");
    expect(index.length).toBe(0);
  });
});
