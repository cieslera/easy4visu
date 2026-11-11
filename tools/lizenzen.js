'use strict';
/**
 * Sammelt die Lizenztexte aller Bausteine, die mit easy4Visu ausgeliefert werden (nur „dependencies“, nicht die
 * Werkzeuge zum Bauen und Testen), in die Datei LIZENZEN-DRITTER.txt. Läuft vor jedem `npm run dist`.
 *
 *   node tools/lizenzen.js           schreibt die Datei
 *   node tools/lizenzen.js --check   prüft nur, ob die Datei aktuell ist (Exit-Code 1, wenn nicht)
 */
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'LIZENZEN-DRITTER.txt');
const LICENSE_FILES = /^(licen[cs]e|copying|notice)(\.(md|txt|markdown))?$/i;

/** Ordner aller ausgelieferten Pakete (ohne easy4visu selbst), sortiert nach Name */
function shippedPackages() {
  const out = execSync('npm ls --omit=dev --all --parseable', { cwd: ROOT, encoding: 'utf8' });
  const dirs = [...new Set(out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean))].filter((d) => path.resolve(d) !== path.resolve(ROOT));
  return dirs.map((dir) => {
    const pj = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    const files = fs.readdirSync(dir).filter((f) => LICENSE_FILES.test(f)).sort();
    let license = pj.license || (Array.isArray(pj.licenses) ? pj.licenses.map((l) => l.type).join(' OR ') : '');
    if (license && typeof license === 'object') license = license.type || '';
    return { name: pj.name, version: pj.version, license: String(license || 'unbekannt'), homepage: pj.homepage || (pj.repository && (pj.repository.url || pj.repository)) || '',
      texts: files.map((f) => fs.readFileSync(path.join(dir, f), 'utf8').replace(/\r\n/g, '\n').trim()) };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

function build() {
  const pkgs = shippedPackages();
  const electronVersion = require(path.join(ROOT, 'node_modules', 'electron', 'package.json')).version;
  const line = '='.repeat(78);
  const parts = [
    'easy4Visu – Lizenzen der mitgelieferten Bausteine',
    '',
    'easy4Visu selbst steht unter der MIT-Lizenz (Datei LICENSE).',
    'Die folgenden Bausteine anderer Autoren werden mit easy4Visu ausgeliefert. Wir danken allen Autoren.',
    '',
    `Electron ${electronVersion} (Programmgerüst, MIT-Lizenz) mit Chromium und Node.js: Die Lizenztexte liegen im`,
    'Installationsordner von easy4Visu in den Dateien LICENSE.electron.txt und LICENSES.chromium.html.',
    '',
    'Übersicht:',
    ...pkgs.map((p) => `  ${`${p.name} ${p.version}`.padEnd(46)} ${p.license}`),
    '',
  ];
  for (const p of pkgs) {
    parts.push(line, `${p.name} ${p.version} – ${p.license}`, ...(p.homepage ? [String(p.homepage).replace(/^git\+/, '')] : []), line, '');
    parts.push(p.texts.length ? p.texts.join('\n\n') : `(Keine eigene Lizenzdatei im Paket – Lizenz laut Paketangabe: ${p.license})`, '');
  }
  return { text: `${parts.join('\n').trimEnd()}\n`, pkgs };
}

if (require.main === module) {
  const { text, pkgs } = build();
  if (process.argv.includes('--check')) {
    const old = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n') : '';
    if (old !== text) { console.error('LIZENZEN-DRITTER.txt ist nicht aktuell – bitte „node tools/lizenzen.js“ ausführen.'); process.exit(1); }
    console.log('LIZENZEN-DRITTER.txt ist aktuell.');
  } else {
    fs.writeFileSync(OUT, text, 'utf8');
    const ohne = pkgs.filter((p) => !p.texts.length).map((p) => p.name);
    console.log(`LIZENZEN-DRITTER.txt: ${pkgs.length} Bausteine${ohne.length ? `, ohne eigene Lizenzdatei: ${ohne.join(', ')}` : ''}`);
  }
}

module.exports = { build, shippedPackages };
