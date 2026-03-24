import express from "express";
import multer from "multer";
import archiver from "archiver";
import path from "path";
import { sanitizeText, wordWrap, paginate, buildIndex } from "./paginate.js";

const CHARS_PER_LINE = 16;
const LINES_PER_PAGE = 5;

const upload = multer({ storage: multer.memoryStorage() });

export function createApp() {
  const app = express();

  app.get("/", (req, res) => {
    res.type("html").send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>E-Ink Reader — Book Processor</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; max-width: 640px; margin: 2rem auto; padding: 0 1rem; color: #222; }
    h1 { margin-bottom: 1rem; }
    form { margin-bottom: 2rem; }
    input[type="file"] { margin-bottom: 0.5rem; display: block; }
    button { padding: 0.5rem 1rem; cursor: pointer; }
    #preview { white-space: pre-wrap; font-family: monospace; font-size: 14px; background: #f5f5f5; padding: 1rem; border-radius: 4px; margin-top: 1rem; }
    .page { border-bottom: 1px dashed #ccc; padding-bottom: 0.5rem; margin-bottom: 0.5rem; }
    .page-num { color: #888; font-size: 12px; }
    #download-form { display: none; margin-top: 1rem; }
    .info { color: #666; margin-bottom: 1rem; }
  </style>
</head>
<body>
  <h1>E-Ink Reader</h1>
  <p class="info">Upload a .txt file to preview and download formatted book files for the device.</p>

  <form id="upload-form" enctype="multipart/form-data">
    <input type="file" name="file" accept=".txt" required>
    <button type="submit">Process</button>
  </form>

  <form id="download-form" method="POST" action="/download" enctype="multipart/form-data">
    <input type="file" name="file" accept=".txt" id="download-file" style="display:none">
    <button type="submit">Download book.zip</button>
  </form>

  <div id="preview"></div>

  <script>
    const uploadForm = document.getElementById('upload-form');
    const downloadForm = document.getElementById('download-form');
    const downloadFile = document.getElementById('download-file');
    const preview = document.getElementById('preview');

    uploadForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(uploadForm);
      const res = await fetch('/process', { method: 'POST', body: formData });
      if (!res.ok) {
        preview.textContent = 'Error: ' + (await res.text());
        downloadForm.style.display = 'none';
        return;
      }
      const data = await res.json();
      preview.innerHTML = '';
      data.pages.forEach((page, i) => {
        const div = document.createElement('div');
        div.className = 'page';
        div.innerHTML = '<span class="page-num">Page ' + (i + 1) + ' of ' + data.totalPages + '</span>\\n' + page.map(l => escapeHtml(l)).join('\\n');
        preview.appendChild(div);
      });

      // Copy the file input for download
      downloadFile.files = uploadForm.querySelector('input[type="file"]').files;
      downloadForm.style.display = 'block';
    });

    function escapeHtml(s) {
      return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }
  </script>
</body>
</html>`);
  });

  app.post("/process", upload.single("file"), (req, res) => {
    if (!req.file) {
      return res.status(400).send("No file uploaded");
    }

    if (!req.file.originalname.endsWith(".txt")) {
      return res.status(400).send("Only .txt files are supported");
    }

    const content = sanitizeText(req.file.buffer.toString("utf8"));
    const lines = wordWrap(content, CHARS_PER_LINE);
    const pages = paginate(lines, LINES_PER_PAGE);

    res.json({
      pages,
      totalPages: pages.length,
    });
  });

  app.post("/download", upload.single("file"), (req, res) => {
    if (!req.file) {
      return res.status(400).send("No file uploaded");
    }

    if (!req.file.originalname.endsWith(".txt")) {
      return res.status(400).send("Only .txt files are supported");
    }

    const content = sanitizeText(req.file.buffer.toString("utf8"));
    const lines = wordWrap(content, CHARS_PER_LINE);
    const pages = paginate(lines, LINES_PER_PAGE);
    const { text, index } = buildIndex(pages);

    res.set("Content-Type", "application/zip");
    res.set("Content-Disposition", 'attachment; filename="book.zip"');

    const archive = archiver("zip");
    archive.pipe(res);
    archive.append(text, { name: "book.txt" });
    archive.append(index, { name: "book.idx" });
    archive.finalize();
  });

  return app;
}
