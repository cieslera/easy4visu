// mit Electron starten: Aufnahmen (PNG) für das Handbuch zuschneiden, verkleinern, als JPEG nach docs/handbuch/bilder
//   electron tools/handbuch/bilder-vorbereiten.js <Ordner mit den PNG> [<weitere Quelle>]
const { app, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2).filter((a) => !a.startsWith('-') && fs.existsSync(a) && fs.statSync(a).isDirectory());
const IN = args[0];
const OUT = path.join(__dirname, '..', '..', 'docs', 'handbuch', 'bilder');
// [Quelle, Ziel, Zuschnitt in Anteilen {x, y, w, h} | null, Breite]
const DRAWER = { x: 0.645, y: 0, w: 0.355, h: 1 };
const jobs = [
  ['01-erste-schritte.png', 'erste-schritte.jpg', { x: 0.145, y: 0.08, w: 0.855, h: 0.8 }, 1500],
  ['02-neues-geraet.png', 'neues-geraet.jpg', DRAWER, 700],
  ['03-geraete.png', 'geraete.jpg', { x: 0, y: 0, w: 1, h: 0.42 }, 1500],
  ['04-geraet-modbus.png', 'geraet-modbus.jpg', DRAWER, 700],
  ['05-geraet-webserver.png', 'geraet-webserver.jpg', DRAWER, 700],
  ['06-geraet-mqtt.png', 'geraet-mqtt.jpg', DRAWER, 700],
  ['07-variablen.png', 'variablen.jpg', null, 1500],
  ['08-variablen-einlesen.png', 'variablen-einlesen.jpg', { x: 0.15, y: 0, w: 0.68, h: 1 }, 1100],
  ['09-variable-bearbeiten.png', 'variable-bearbeiten.jpg', { x: 0.645, y: 0, w: 0.355, h: 0.62 }, 700],
  ['10-editor.png', 'editor.jpg', null, 1600],
  ['11-editor-element.png', 'editor-element.jpg', null, 1600],
  ['12-editor-symbole.png', 'editor-symbole.jpg', { x: 0.13, y: 0.06, w: 0.62, h: 0.94 }, 1300],
  ['13-editor-leisten.png', 'editor-leisten.jpg', null, 1600],
  ['14-meldungen.png', 'meldungen.jpg', { x: 0.13, y: 0, w: 0.87, h: 0.82 }, 1500],
  ['15-sprachen.png', 'sprachen.jpg', { x: 0.13, y: 0, w: 0.87, h: 0.82 }, 1500],
  ['16-aufzeichnungen.png', 'aufzeichnungen.jpg', { x: 0.13, y: 0, w: 0.62, h: 1 }, 1100],
  ['17-projekt.png', 'projekt.jpg', { x: 0.13, y: 0, w: 0.75, h: 0.55 }, 1300],
  ['18-einstellungen.png', 'einstellungen.jpg', { x: 0.17, y: 0, w: 0.7, h: 1 }, 1300],
  ['19-design.png', 'design.jpg', null, 1600],
  ['20-bedienseite-uebersicht.png', 'bedienseite-uebersicht.jpg', null, 1600],
  ['21-bedienseite-druckluft.png', 'bedienseite-druckluft.jpg', null, 1600],
  ['22-bedienseite-meldungen.png', 'bedienseite-meldungen.jpg', null, 1600],
  ['24-benutzer.png', 'benutzer.jpg', { x: 0, y: 0, w: 1, h: 0.5 }, 1500],
  ['25-bedienprotokoll.png', 'bedienprotokoll.jpg', { x: 0, y: 0, w: 1, h: 0.42 }, 1500],
  ['26-handy-tablet.png', 'handy-tablet.jpg', { x: 0, y: 0, w: 0.62, h: 0.56 }, 1100],
  ['sprachmenue.png', 'sprachwahl.jpg', null, 700],
  ['handy-dunkel.png', 'handy.jpg', null, 520],
];
app.whenReady().then(() => {
  fs.mkdirSync(OUT, { recursive: true });
  for (const [src, dst, crop, w] of jobs) {
    const file = [IN, ...args.slice(1)].map((d) => path.join(d, src)).find((f) => fs.existsSync(f));
    if (!file) { console.log('FEHLT', src); continue; }
    let img = nativeImage.createFromPath(file);
    const s = img.getSize();
    if (crop) img = img.crop({ x: Math.round(crop.x * s.width), y: Math.round(crop.y * s.height), width: Math.round(crop.w * s.width), height: Math.round(crop.h * s.height) });
    if (img.getSize().width > w) img = img.resize({ width: w, quality: 'best' });
    fs.writeFileSync(path.join(OUT, dst), img.toJPEG(82));
    const n = img.getSize();
    console.log(dst, n.width, n.height);
  }
  app.quit();
});
