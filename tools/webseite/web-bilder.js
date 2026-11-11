// mit Electron: Bilder für die Webseite (aus den Präsentations-Aufnahmen) zuschneiden, verkleinern, als JPEG
const { app, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const IN = path.join(__dirname, 'praes', 'bilder');
const OUT = require('path').join(__dirname, '..', '..', 'webseite', 'img');
const jobs = [
  ['uebersicht-dunkel.png', 'uebersicht-dunkel.jpg', null, 1600],
  ['uebersicht-hell.png', 'uebersicht-hell.jpg', null, 1600],
      ['produktion-hell.png', 'produktion-hell.jpg', null, 1400],
  ['assistent.png', 'assistent.jpg', { x: 520, y: 200, width: 3700, height: 1480 }, 1400],
  ['geraet-bearbeiten.png', 'verbindung.jpg', { x: 3020, y: 0, width: 1295, height: 1380 }, 640],
  ['import.png', 'import.jpg', { x: 918, y: 54, width: 2490, height: 2268 }, 1100],
  ['editor.png', 'editor.jpg', null, 1600],
  ['symbole.png', 'symbole.jpg', { x: 497, y: 151, width: 2203, height: 1749 }, 1100],
  ['design.png', 'design.jpg', { x: 518, y: 160, width: 3797, height: 2211 }, 1400],
  ['aufzeichnungen.png', 'aufzeichnungen.jpg', { x: 518, y: 194, width: 2095, height: 1836 }, 1000],
    ['handy-dunkel.png', 'handy.jpg', null, 520],
  ['uebersicht-fr.png', 'uebersicht-fr.jpg', null, 1600],
  ['sprachmenue.png', 'sprachmenue.jpg', null, 720],
  ['sprachen.png', 'sprachen.jpg', { x: 518, y: 190, width: 3797, height: 1754 }, 1400],
  ['druckluft-hell.png', 'seite-druckluft-hell.jpg', null, 1100],
  ['druckluft-dunkel.png', 'seite-druckluft-dunkel.jpg', null, 1100],
  ['produktion-hell.png', 'seite-produktion-hell.jpg', null, 1100],
  ['produktion-dunkel.png', 'seite-produktion-dunkel.jpg', null, 1100],
  ['energie-hell.png', 'seite-energie-hell.jpg', null, 1100],
  ['energie-dunkel.png', 'seite-energie-dunkel.jpg', null, 1100],
  ['gebaeude-hell.png', 'seite-gebaeude-hell.jpg', null, 1100],
  ['gebaeude-dunkel.png', 'seite-gebaeude-dunkel.jpg', null, 1100],
];
app.whenReady().then(() => {
  fs.mkdirSync(OUT, { recursive: true });
  for (const [src, dst, crop, w] of jobs) {
    let img = nativeImage.createFromPath(path.join(IN, src));
    if (img.isEmpty()) { console.log('FEHLT', src); continue; }
    if (crop) img = img.crop(crop);
    if (img.getSize().width > w) img = img.resize({ width: w, quality: 'best' });
    fs.writeFileSync(path.join(OUT, dst), img.toJPEG(84));
    const s = img.getSize();
    console.log(dst, s.width, s.height, Math.round(fs.statSync(path.join(OUT, dst)).size / 1024) + ' KB');
  }
  app.quit();
});
