import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../lib/server.js";

const app = createApp();

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

  it("rejects non-.txt files", async () => {
    const res = await request(app)
      .post("/process")
      .attach("file", Buffer.from("<html></html>"), "test.html");

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
});
