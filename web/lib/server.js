import express from "express";
import multer from "multer";
import archiver from "archiver";
import path from "path";
import { execSync } from "child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { sanitizeText, wordWrap, paginate, buildIndex } from "./paginate.js";
import { extractTextFromEpub } from "./epub.js";

const MKLITTLEFS = process.env.MKLITTLEFS || "/Users/jayw/.platformio/packages/tool-mklittlefs/mklittlefs";
// LittleFS partition: 0x180000 = 1572864 bytes, block size 4096
const PARTITION_SIZE = 1572864;
const BLOCK_SIZE = 4096;
const PAGE_SIZE = 256;

const CHARS_PER_LINE = 16;
const LINES_PER_PAGE = 5;

const upload = multer({ storage: multer.memoryStorage() });

const ACCEPTED_EXTENSIONS = [".txt", ".epub"];

/**
 * Extract plain text from an uploaded file (txt or epub).
 * @param {object} file - multer file object
 * @returns {Promise<string>} sanitized plain text
 */
async function extractText(file) {
  const ext = path.extname(file.originalname).toLowerCase();

  if (!ACCEPTED_EXTENSIONS.includes(ext)) {
    throw new Error("Unsupported file type. Upload .txt or .epub");
  }

  let raw;
  if (ext === ".epub") {
    raw = await extractTextFromEpub(file.buffer);
  } else {
    raw = file.buffer.toString("utf8");
  }

  return sanitizeText(raw);
}

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
    .start-page { margin-bottom: 0.5rem; }
    .start-page label { font-size: 14px; }
    .start-page input { width: 60px; padding: 2px 4px; }
    .start-page button { font-size: 12px; margin-left: 0.5rem; }
    .page.skipped { opacity: 0.3; }
    #serial-controls { display: none; margin-top: 1rem; padding: 1rem; background: #e8f5e9; border-radius: 4px; }
    #serial-controls button { margin-right: 0.5rem; }
    #serial-status { margin-top: 0.5rem; font-size: 14px; color: #333; }
    #serial-status.error { color: #c00; }
    #serial-status.success { color: #080; }
  </style>
</head>
<body>
  <h1>E-Ink Reader</h1>
  <p class="info">Upload a .txt or .epub file to preview and download formatted book files for the device.</p>

  <form id="upload-form" enctype="multipart/form-data">
    <input type="file" name="file" accept=".txt,.epub" required>
    <button type="submit">Process</button>
  </form>

  <div id="start-page-controls" class="start-page" style="display:none">
    <label>Start book at page: <input type="number" id="start-page" min="1" value="1"></label>
    <button id="apply-start">Apply</button>
  </div>

  <form id="download-form" method="POST" action="/download" enctype="multipart/form-data">
    <input type="file" name="file" accept=".txt,.epub" id="download-file" style="display:none">
    <input type="hidden" name="startPage" id="download-start-page" value="1">
    <button type="submit">Download book.zip</button>
  </form>

  <div id="serial-controls">
    <button id="serial-upload">Upload to device via USB</button>
    <div id="serial-status"></div>
  </div>

  <div id="preview"></div>

  <script>
    const uploadForm = document.getElementById('upload-form');
    const downloadForm = document.getElementById('download-form');
    const downloadFile = document.getElementById('download-file');
    const downloadStartPage = document.getElementById('download-start-page');
    const startPageControls = document.getElementById('start-page-controls');
    const startPageInput = document.getElementById('start-page');
    const applyStartBtn = document.getElementById('apply-start');
    const preview = document.getElementById('preview');

    let allPages = [];

    uploadForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(uploadForm);
      const res = await fetch('/process', { method: 'POST', body: formData });
      if (!res.ok) {
        preview.textContent = 'Error: ' + (await res.text());
        downloadForm.style.display = 'none';
        startPageControls.style.display = 'none';
        return;
      }
      const data = await res.json();
      allPages = data.pages;
      startPageInput.value = 1;
      startPageInput.max = allPages.length;
      startPageControls.style.display = 'block';
      renderPreview(1);

      downloadFile.files = uploadForm.querySelector('input[type="file"]').files;
      downloadForm.style.display = 'block';
      serialControls.style.display = 'block';
      setSerialStatus('');
    });

    applyStartBtn.addEventListener('click', () => {
      const sp = parseInt(startPageInput.value, 10) || 1;
      renderPreview(sp);
    });

    function renderPreview(startPage) {
      downloadStartPage.value = startPage;
      preview.innerHTML = '';
      allPages.forEach((page, i) => {
        const pageNum = i + 1;
        const skipped = pageNum < startPage;
        const div = document.createElement('div');
        div.className = 'page' + (skipped ? ' skipped' : '');
        const label = skipped ? 'Page ' + pageNum + ' (skipped)' : 'Page ' + (pageNum - startPage + 1) + ' of ' + (allPages.length - startPage + 1);
        div.innerHTML = '<span class="page-num">' + label + '</span>\\n' + page.map(l => escapeHtml(l)).join('\\n');
        preview.appendChild(div);
      });
    }

    function escapeHtml(s) {
      return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    // --- Flash Upload via esptool-js ---
    const serialControls = document.getElementById('serial-controls');
    const serialUploadBtn = document.getElementById('serial-upload');
    const serialStatus = document.getElementById('serial-status');

    function setSerialStatus(msg, cls) {
      serialStatus.textContent = msg;
      serialStatus.className = cls || '';
    }

    serialUploadBtn.addEventListener('click', async () => {
      if (!('serial' in navigator)) {
        setSerialStatus('Web Serial not supported in this browser. Use Chrome or Edge.', 'error');
        return;
      }

      try {
        // Step 1: Build LittleFS image on server
        setSerialStatus('Building filesystem image...');
        const formData = new FormData();
        const fileInput = uploadForm.querySelector('input[type="file"]');
        formData.append('file', fileInput.files[0]);
        formData.append('startPage', downloadStartPage.value);

        const imgRes = await fetch('/download/image', { method: 'POST', body: formData });
        if (!imgRes.ok) throw new Error('Failed to build image: ' + (await imgRes.text()));
        const imageData = new Uint8Array(await imgRes.arrayBuffer());
        console.log('[flash] Image size:', imageData.byteLength, 'bytes');

        // Step 2: Load esptool-js
        setSerialStatus('Select serial port...');
        const { ESPLoader, Transport } = await import('https://unpkg.com/esptool-js@0.5.7/bundle.js');

        const port = await navigator.serial.requestPort();
        const transport = new Transport(port, true);

        const terminal = {
          clean() {},
          writeLine(data) { console.log('[esptool]', data); },
          write(data) { console.log('[esptool]', data); }
        };

        // Step 3: Connect to bootloader
        setSerialStatus('Connecting to device bootloader...');
        const loader = new ESPLoader({ transport, baudrate: 921600, terminal });
        const chip = await loader.main();
        console.log('[flash] Connected to:', chip);
        setSerialStatus('Connected to ' + chip + '. Flashing...');

        // Step 4: Flash LittleFS image to partition offset
        // esptool-js expects binary string, not Uint8Array
        let binaryString = '';
        for (let i = 0; i < imageData.length; i++) {
          binaryString += String.fromCharCode(imageData[i]);
        }
        await loader.writeFlash({
          fileArray: [{ data: binaryString, address: 0x670000 }],
          flashMode: 'keep',
          flashFreq: 'keep',
          flashSize: 'keep',
          eraseAll: false,
          compress: true,
          reportProgress: (fileIndex, written, total) => {
            const pct = Math.round((written / total) * 100);
            setSerialStatus('Flashing... ' + pct + '%');
          },
        });

        // Step 5: Reset device
        setSerialStatus('Resetting device...');
        await loader.after('hard_reset');
        await transport.disconnect();

        setSerialStatus('Upload complete! Device is loading the book.', 'success');

      } catch (err) {
        console.error('[flash] Error:', err);
        setSerialStatus('Error: ' + err.message, 'error');
      }
    });
  </script>
</body>
</html>`);
  });

  app.post("/process", upload.single("file"), async (req, res) => {
    if (!req.file) {
      return res.status(400).send("No file uploaded");
    }

    try {
      const content = await extractText(req.file);
      const lines = wordWrap(content, CHARS_PER_LINE);
      const allPages = paginate(lines, LINES_PER_PAGE);

      const startPage = parseInt(req.body?.startPage || "1", 10);
      const pages = allPages.slice(Math.max(0, startPage - 1));

      res.json({
        pages,
        totalPages: pages.length,
      });
    } catch (err) {
      return res.status(400).send(err.message);
    }
  });

  app.post("/download", upload.single("file"), async (req, res) => {
    if (!req.file) {
      return res.status(400).send("No file uploaded");
    }

    try {
      const content = await extractText(req.file);
      const lines = wordWrap(content, CHARS_PER_LINE);
      const allPages = paginate(lines, LINES_PER_PAGE);

      const startPage = parseInt(req.body?.startPage || "1", 10);
      if (startPage > allPages.length) {
        return res.status(400).send("startPage exceeds total pages");
      }
      const pages = allPages.slice(Math.max(0, startPage - 1));
      const { text, index } = buildIndex(pages);

      res.set("Content-Type", "application/zip");
      res.set("Content-Disposition", 'attachment; filename="book.zip"');

      const archive = archiver("zip");
      archive.pipe(res);
      archive.append(text, { name: "book.txt" });
      archive.append(index, { name: "book.idx" });
      archive.finalize();
    } catch (err) {
      return res.status(400).send(err.message);
    }
  });

  app.post("/download/raw", upload.single("file"), async (req, res) => {
    if (!req.file) {
      return res.status(400).send("No file uploaded");
    }

    try {
      const content = await extractText(req.file);
      const lines = wordWrap(content, CHARS_PER_LINE);
      const allPages = paginate(lines, LINES_PER_PAGE);

      const startPage = parseInt(req.body?.startPage || "1", 10);
      if (startPage > allPages.length) {
        return res.status(400).send("startPage exceeds total pages");
      }
      const pages = allPages.slice(Math.max(0, startPage - 1));
      const { text, index } = buildIndex(pages);

      res.json({
        bookTxt: text,
        bookIdx: Array.from(index),
      });
    } catch (err) {
      return res.status(400).send(err.message);
    }
  });

  app.post("/download/image", upload.single("file"), async (req, res) => {
    if (!req.file) {
      return res.status(400).send("No file uploaded");
    }

    let content;
    try {
      content = await extractText(req.file);
    } catch (err) {
      return res.status(400).send(err.message);
    }

    const lines = wordWrap(content, CHARS_PER_LINE);
    const allPages = paginate(lines, LINES_PER_PAGE);

    const startPage = parseInt(req.body?.startPage || "1", 10);
    if (startPage > allPages.length) {
      return res.status(400).send("startPage exceeds total pages");
    }
    const pages = allPages.slice(Math.max(0, startPage - 1));
    const { text, index } = buildIndex(pages);

    // Build LittleFS image using mklittlefs
    const tmpDir = mkdtempSync(path.join(tmpdir(), "eink-"));
    const dataDir = path.join(tmpDir, "data");
    const imgPath = path.join(tmpDir, "littlefs.bin");

    try {
      execSync(`mkdir -p "${dataDir}"`);
      writeFileSync(path.join(dataDir, "book.txt"), text);
      writeFileSync(path.join(dataDir, "book.idx"), index);

      execSync(
        `"${MKLITTLEFS}" -c "${dataDir}" -s ${PARTITION_SIZE} -b ${BLOCK_SIZE} -p ${PAGE_SIZE} "${imgPath}"`,
        { stdio: "pipe" }
      );

      const image = readFileSync(imgPath);
      res.set("Content-Type", "application/octet-stream");
      res.set("Content-Disposition", 'attachment; filename="littlefs.bin"');
      res.send(image);
    } catch (err) {
      res.status(500).send("Failed to build LittleFS image: " + err.message);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  return app;
}
