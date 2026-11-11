#!/usr/bin/env node
'use strict';
/**
 * Prüfprogramm für den Variablen-Import: zeigt, welche Variablenliste aus den easySoft-Dateien entsteht.
 * Kurzhilfe: node tools/import.js --help
 */

const { parseArgs } = require('node:util');
const { importFiles } = require('../src/import');
const { t } = require('../src/i18n');

const HELP = `
Variablen-Import prüfen – zeigt die Liste, die aus den easySoft-Dateien entsteht

  node tools/import.js [--itf datei.itf] [--kommentare kommentare.xls] [--symbole tabelle.csv] [--st programm.st] [--net 1]

  --itf        Variablenliste für Galileo aus easySoft (Adressen für Modbus)
  --kommentare Operanden-Kommentare aus easySoft (.xls) – Namen bei FUP/KOP
  --symbole    Symboltabelle (CSV-Export „Symbolische Namen“), mehrmals möglich
  --st         ST-Programm (Text), mehrmals möglich
  --net 1      NET-ID dieses Geräts (Operanden wie 1NW3 gelten dann als eigene)
  --alle       auch Variablen ohne Namen aus Programm oder Tabelle zeigen (z. B. M993…M1008)

Mindestens eine Datei angeben.
`;

function main(argv) {
  const { values: o } = parseArgs({
    args: argv,
    options: {
      help: { type: 'boolean', short: 'h' }, itf: { type: 'string' }, symbole: { type: 'string', multiple: true }, kommentare: { type: 'string', multiple: true },
      st: { type: 'string', multiple: true }, net: { type: 'string' }, alle: { type: 'boolean' },
    },
  });
  if (o.help || (!o.itf && !o.symbole && !o.st && !o.kommentare)) {
    console.log(HELP);
    return o.help ? 0 : 2;
  }
  const r = importFiles({ itf: o.itf, symbols: o.symbole, st: o.st, comments: o.kommentare, netId: o.net ? parseInt(o.net, 10) : null });
  const shown = o.alle ? r.variables : r.variables.filter((v) => v.sources.length > 1 || !v.sources.includes('itf'));
  const rows = shown.map((v) => {
    const addr = v.modbus ? (v.modbus.register !== undefined
      ? `R${v.modbus.register}${v.modbus.bit !== undefined ? `.${v.modbus.bit}` : ''}` : `${v.modbus.area === 'coil' ? 'Coil' : 'DI'} ${v.modbus.address}`) : '–';
    // „lesen“/„schreiben“ am Anfang der Bemerkung steckt schon im Vorschlag
    const note = v.comment ? v.comment.replace(/^\s*(schreiben\/lesen|schreiben|lesen|nur intern|intern)\b\s*/i, '') : '';
    const extra = [v.hint, note].filter(Boolean).join('  ');
    return [v.label, v.name, `${v.operand}${v.operand === 'CLOCK' ? '.' : ''}${v.index}`, addr,
      v.role ? t(`import.role.${v.role}`) : '', v.writable ? 'ja' : '', extra];
  });
  const head = ['Anzeige', 'Name (easySoft)', 'Operand', 'Adresse', 'Vorschlag', 'schreibbar', 'Hinweis'];
  const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cols) => `  ${cols.map((c, i) => (i < cols.length - 1 ? c.padEnd(w[i]) : c)).join('  ')}`;
  console.log(`\n${r.variables.length} Variablen${shown.length < r.variables.length ? ` (gezeigt: ${shown.length}, alle mit --alle)` : ''}\n`);
  console.log(line(head));
  rows.forEach((row) => console.log(line(row)));
  if (r.warnings.length) {
    console.log('\nHinweise:');
    r.warnings.forEach((x) => console.log(`  - ${x}`));
  }
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    console.log(`Fehler: ${err.message}`);
    process.exitCode = 1;
  }
}

module.exports = { main };
