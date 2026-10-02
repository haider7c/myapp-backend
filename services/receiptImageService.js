// backend/services/receiptImageService.js
//
// Renders the WhatsApp bill/receipt HTML (templates/whatsappReceiptTemplate.js)
// to a PNG using `puppeteer` (an existing dependency of this backend,
// separate from whatsapp-web.js's own bundled Chromium). A single headless
// browser is launched lazily on first use and kept warm across requests --
// launching a fresh Chromium per send would be slow (multi-second cold
// start) for something the owner may do in bulk (selecting several
// customers and sending to all of them at once). Each render still gets
// its own page/tab, so concurrent sends don't interfere with each other.
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");
const { buildReceiptHtml } = require("../templates/whatsappReceiptTemplate");

const tempDir = path.join(__dirname, "../temp");
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

let browserPromise = null;

function launchBrowser() {
  return puppeteer.launch({
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  });
}

// Get-or-relaunch: if the kept-warm browser has crashed/been killed since
// last use, transparently start a new one rather than failing every send
// until the server is restarted.
async function getBrowser() {
  if (!browserPromise) {
    browserPromise = launchBrowser();
  }
  let browser;
  try {
    browser = await browserPromise;
  } catch (err) {
    browserPromise = launchBrowser();
    browser = await browserPromise;
  }
  if (!browser.isConnected()) {
    browserPromise = launchBrowser();
    browser = await browserPromise;
  }
  return browser;
}

// Renders one bill/receipt image and returns its path on disk, ready to be
// handed to whatsappService.sendDocument (which auto-detects the .png
// mimetype and sends it as an inline photo, not a generic file attachment).
async function renderReceiptImage({ brand, kind, data }) {
  const html = buildReceiptHtml({ brand, kind, data });
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1024, height: 800 });
    await page.setContent(html, { waitUntil: "networkidle0" });
    const fileName = `${kind}_${brand}_${Date.now()}_${Math.round(Math.random() * 1e4)}.png`;
    const filePath = path.join(tempDir, fileName);
    await page.screenshot({ path: filePath, fullPage: true });
    return { filePath, fileName };
  } finally {
    await page.close();
  }
}

module.exports = { renderReceiptImage };
