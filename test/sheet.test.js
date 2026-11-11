'use strict';
// CSV und Excel (.xlsx) ohne Zusatzbibliothek – für die Texttabelle (Punkt 5). Aufruf: npm test
const test = require('node:test');
const assert = require('node:assert');
const { writeCsv, readCsv, writeXlsx, readXlsx } = require('../src/core/sheet');

const rows = [['ID', 'de', 'en', 'Hinweis'], ['T0001', 'Störung "Pumpe"; 2', 'Pump 2 fault', 'Meldung'], ['T0002', 'Nachlauf {1} s\nzweite Zeile', '', 'Text'],
  ['T0003', 'Füllstand < 10 % & leer', 'Level < 10 % & empty', '']];

test('CSV: Semikolon, BOM, Anführungszeichen und Zeilenumbrüche; lesen erkennt auch Komma', () => {
  const csv = writeCsv(rows);
  assert.ok(csv.startsWith('﻿ID;de;en;Hinweis\r\n'));
  assert.deepStrictEqual(readCsv(csv), rows.map((r) => r.map(String)));
  assert.deepStrictEqual(readCsv('ID,de,en\nT0001,"a,b",c\n'), [['ID', 'de', 'en'], ['T0001', 'a,b', 'c']]);
});

test('Excel: schreiben und wieder lesen (Sonderzeichen, Umlaute, leere Zellen, Zeilenumbruch)', () => {
  const buf = writeXlsx(rows, [10, 40, 40, 16]);
  assert.strictEqual(buf.readUInt32LE(0), 0x04034b50, 'ZIP-Archiv');
  const back = readXlsx(buf);
  assert.deepStrictEqual(back, rows);
  assert.throws(() => readXlsx(Buffer.from('kein zip')), /Keine Excel-Datei/);
});
