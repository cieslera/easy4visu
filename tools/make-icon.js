'use strict';
/**
 * Programmsymbol aus build/icon.svg erzeugen: build/icon.ico (16 … 256 Pixel, für Installer und Programm),
 * app/icon.png (256 Pixel, Fenstersymbol beim Start aus dem Quellcode) und die Symbole der Web-App in app/web/
 * (Home-Bildschirm von iPhone/iPad: randlos grün und ohne Durchsichtiges – das Handy rundet die Ecken selbst ab).
 * Aufruf: npm run icon            (alles)
 *         npm run icon -- web     (nur die Web-App-Symbole)
 * Kleine Größen bekommen etwas dickere Striche, damit das Zeichen in der Taskleiste lesbar bleibt.
 * Gezeichnet wird auf einer Zeichenfläche (canvas) im unsichtbaren Fenster – das Abfotografieren des Fensters
 * (capturePage) blieb mit neueren Electron-Versionen hängen.
 */

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const ROOT = path.join(__dirname, '..');
const SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256];
const WEB_ICONS = [[180, 'apple-touch-icon.png'], [192, 'icon-192.png'], [512, 'icon-512.png']];
const ONLY_WEB = process.argv.includes('web');

app.disableHardwareAcceleration();

const source = () => fs.readFileSync(path.join(ROOT, 'build', 'icon.svg'), 'utf8');

/** SVG für eine Größe: ab 32 Pixel abwärts dickere Striche */
function svgFor(size) {
  const w = size <= 16 ? 12 : size <= 24 ? 11 : size <= 32 ? 10 : 9;
  return source().replace('stroke-width="9"', `stroke-width="${w}"`).replace('width="96" height="96"', `width="${size}" height="${size}"`);
}

/** Web-App: Fläche bis an den Rand, Zeichen im selben Verhältnis zur Fläche wie im Programmsymbol */
function webSvgFor(size) {
  const inner = source().replace(/^[\s\S]*?<rect[^>]*\/>/, '').replace(/<\/svg>\s*$/, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 96 96">`
    + `<rect width="96" height="96" fill="#1FA97A"/><g transform="translate(48 48) scale(${96 / 92}) translate(-48 -48)">${inner}</g></svg>`;
}

/** SVG im Fenster auf eine Zeichenfläche malen und als PNG zurückgeben */
async function render(win, svg, size) {
  const url = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  const data = await win.webContents.executeJavaScript(`new Promise((ok, fail) => {
    const img = new Image();
    img.onload = () => { const c = document.createElement('canvas'); c.width = c.height = ${size};
      c.getContext('2d').drawImage(img, 0, 0, ${size}, ${size}); ok(c.toDataURL('image/png')); };
    img.onerror = () => fail(new Error('SVG nicht lesbar'));
    img.src = ${JSON.stringify(url)};
  })`);
  return Buffer.from(data.split(',')[1], 'base64');
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
  const win = new BrowserWindow({ width: 100, height: 100, show: false });
  await win.loadURL('data:text/html;charset=utf-8,<html><body></body></html>');
  if (!ONLY_WEB) {
    const pngs = [];
    for (const size of SIZES) pngs.push({ size, png: await render(win, svgFor(size), size) });
    fs.writeFileSync(path.join(ROOT, 'build', 'icon.ico'), ico(pngs));
    fs.writeFileSync(path.join(ROOT, 'app', 'icon.png'), pngs[pngs.length - 1].png);
    console.log(`build/icon.ico (${SIZES.join(', ')} px) und app/icon.png geschrieben`);
  }
  fs.mkdirSync(path.join(ROOT, 'app', 'web'), { recursive: true });
  for (const [size, name] of WEB_ICONS) fs.writeFileSync(path.join(ROOT, 'app', 'web', name), await render(win, webSvgFor(size), size));
  console.log(`app/web/: ${WEB_ICONS.map(([, n]) => n).join(', ')} geschrieben`);
  app.quit();
}).catch((err) => { console.error(err); app.exit(1); });
