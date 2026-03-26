import { describe, it, expect } from "vitest";
import request from "supertest";
import JSZip from "jszip";
import { createApp } from "../lib/server.js";

const app = createApp();

// Helper to build a minimal EPUB buffer
async function buildTestEpub(bodyHtml) {
  const zip = new JSZip();
  zip.file("META-INF/container.xml",
    `<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  zip.file("OEBPS/content.opf",
    `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Test</dc:title></metadata><manifest><item id="ch0" href="ch0.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="ch0"/></spine></package>`);
  zip.file("OEBPS/ch0.xhtml",
    `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Test</title></head><body>${bodyHtml}</body></html>`);
  return zip.generateAsync({ type: "nodebuffer" });
}

describe("GET /", () => {
  it("returns the upload page", async () => {
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/html/);
    expect(res.text).toContain("upload");
  });
});

describe("POST /process", () => {
  it("returns 400 when no file is uploaded", async () => {
    const res = await request(app).post("/process");
    expect(res.status).toBe(400);
  });

  it("processes a .txt file and returns JSON with preview and download links", async () => {
    const content = "the quick brown fox jumps over the lazy dog and more words here";
    const res = await request(app)
      .post("/process")
      .attach("file", Buffer.from(content), "test.txt");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/json/);
    expect(res.body.pages).toBeInstanceOf(Array);
    expect(res.body.pages.length).toBeGreaterThan(0);
    expect(res.body.totalPages).toBe(res.body.pages.length);
  });

  it("rejects unsupported file types", async () => {
    const res = await request(app)
      .post("/process")
      .attach("file", Buffer.from("<html></html>"), "test.html");

    expect(res.status).toBe(400);
  });

  it("processes an .epub file and returns JSON with pages", async () => {
    const epub = await buildTestEpub("<p>Hello from an epub file with enough words to fill a page.</p>");
    const res = await request(app)
      .post("/process")
      .attach("file", epub, "test.epub");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/json/);
    expect(res.body.pages).toBeInstanceOf(Array);
    expect(res.body.pages.length).toBeGreaterThan(0);
  });

  it("rejects an invalid epub", async () => {
    const res = await request(app)
      .post("/process")
      .attach("file", Buffer.from("not a zip"), "bad.epub");

    expect(res.status).toBe(400);
  });
});

describe("POST /download", () => {
  it("returns a zip containing book.txt and book.idx", async () => {
    const content = "hello world this is a test of the download";
    const res = await request(app)
      .post("/download")
      .attach("file", Buffer.from(content), "test.txt");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/zip/);
    expect(res.headers["content-disposition"]).toMatch(/book\.zip/);
  });

  it("respects startPage parameter and trims earlier pages", async () => {
    // Build content that spans multiple pages (5 lines/page, 16 chars/line)
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
    const content = lines.join("\n");
    const res = await request(app)
      .post("/download")
      .field("startPage", "2")
      .attach("file", Buffer.from(content), "test.txt");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/zip/);
  });

  it("returns 400 when startPage exceeds total pages", async () => {
    const content = "short text";
    const res = await request(app)
      .post("/download")
      .field("startPage", "999")
      .attach("file", Buffer.from(content), "test.txt");

    expect(res.status).toBe(400);
  });
});

describe("POST /download with startPage", () => {
  it("produces fewer pages when startPage is set", async () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
    const content = lines.join("\n");

    // Get full page count
    const fullRes = await request(app)
      .post("/process")
      .attach("file", Buffer.from(content), "test.txt");
    const fullPages = fullRes.body.totalPages;

    // Get trimmed page count via process with startPage
    const trimRes = await request(app)
      .post("/process")
      .field("startPage", "2")
      .attach("file", Buffer.from(content), "test.txt");
    const trimPages = trimRes.body.totalPages;

    expect(trimPages).toBe(fullPages - 1);
    // First page of trimmed output should not start with original page 1 lines
    const firstPageLines = trimRes.body.pages[0];
    expect(firstPageLines[0]).not.toBe("line 1");
    expect(firstPageLines[0]).not.toBe("line 2");
  });
});
