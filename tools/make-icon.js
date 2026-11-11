'use strict';
/**
 * Programmsymbol aus build/icon.svg erzeugen: build/icon.ico (16 … 256 Pixel, für Installer und Programm)
 * und app/icon.png (256 Pixel, Fenstersymbol beim Start aus dem Quellcode).
 * Aufruf: npx electron tools/make-icon.js
 * Kleine Größen bekommen etwas dickere Striche, damit das Zeichen in der Taskleiste lesbar bleibt.
 */

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const ROOT = path.join(__dirname, '..');
const SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256];

app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.disableHardwareAcceleration();

/** SVG für eine Größe: ab 32 Pixel abwärts dickere Striche */
function svgFor(size) {
  const svg = fs.readFileSync(path.join(ROOT, 'build', 'icon.svg'), 'utf8');
  const w = size <= 16 ? 12 : size <= 24 ? 11 : size <= 32 ? 10 : 9;
  return svg.replace('stroke-width="9"', `stroke-width="${w}"`).replace('width="96" height="96"', `width="${size}" height="${size}"`);
}

/** ICO-Datei mit PNG-Bildern (Windows Vista und neuer) */
function ico(pngs) {
  const head = Buffer.alloc(6 + 16 * pngs.length);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(pngs.length, 4);
  let offset = head.length;
  pngs.forEach(({ size, png }, i) => {
    const o = 6 + 16 * i;
    head.writeUInt8(size >= 256 ? 0 : size, o);
    head.writeUInt8(size >= 256 ? 0 : size, o + 1);
    head.writeUInt16LE(1, o + 4);
    head.writeUInt16LE(32, o + 6);
    head.writeUInt32LE(png.length, o + 8);
    head.writeUInt32LE(offset, o + 12);
    offset += png.length;
  });
  return Buffer.concat([head, ...pngs.map((p) => p.png)]);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 300, height: 300, show: false, transparent: true, frame: false, webPreferences: { offscreen: true } });
  const pngs = [];
  for (const size of SIZES) {
    const html = `<html><body style="margin:0;background:transparent">${svgFor(size)}</body></html>`;
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    await new Promise((r) => setTimeout(r, 150));
    const img = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
    pngs.push({ size, png: img.resize({ width: size, height: size }).toPNG() });
  }
  fs.writeFileSync(path.join(ROOT, 'build', 'icon.ico'), ico(pngs));
  fs.writeFileSync(path.join(ROOT, 'app', 'icon.png'), pngs[pngs.length - 1].png);
  console.log(`build/icon.ico (${SIZES.join(', ')} px) und app/icon.png geschrieben`);
  app.quit();
});
