// Handbuch als PDF (A4, Seitenzahlen unten):  electron tools/handbuch/pdf.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const DOCS = path.join(__dirname, '..', '..', 'docs', 'handbuch');
app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false, width: 1000, height: 1400 });
  await w.loadFile(path.join(DOCS, 'handbuch.html'));
  await w.webContents.executeJavaScript('document.fonts.ready.then(() => Promise.all([...document.images].map((i) => i.complete ? 1 : new Promise((r) => { i.onload = i.onerror = r; }))))');
  const pdf = await w.webContents.printToPDF({
    pageSize: 'A4', printBackground: true, preferCSSPageSize: true, displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate: '<div style="width:100%;font:8px Segoe UI,sans-serif;color:#56616D;padding:0 17mm;display:flex;justify-content:space-between"><span>easy4Visu – Handbuch</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',
  });
  const out = path.join(DOCS, 'easy4Visu-Handbuch.pdf');
  fs.writeFileSync(out, pdf);
  console.log('geschrieben', out, Math.round(pdf.length / 1024), 'KB');
  app.quit();
});
