'use strict';
/**
 * Textdateien aus easySoft in jeder Kodierung lesen.
 *
 * easySoft speichert unterschiedlich: die Symboltabelle (CSV) als UTF-16 ohne BOM, die .itf als ASCII,
 * ST-Programme je nach Editor als UTF-8 oder Windows-1252 (Umlaute). Selbst erstellte Dateien kommen
 * meist als UTF-8.
 */

function decodeText(buf) {
  if (typeof buf === 'string') return buf.replace(/^﻿/, '');
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) return b.subarray(2).toString('utf16le');
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) return Buffer.from(b.subarray(2)).swap16().toString('utf16le');
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return b.subarray(3).toString('utf8');
  // UTF-16 ohne BOM: viele Nullbytes an jeder zweiten Stelle (bei lateinischem Text)
  const n = Math.min(b.length, 400) & ~1;
  if (n >= 4) {
    let evenZero = 0;
    let oddZero = 0;
    for (let i = 0; i < n; i += 2) {
      if (b[i] === 0) evenZero++;
      if (b[i + 1] === 0) oddZero++;
    }
    if (oddZero > n / 4 && evenZero === 0) return b.subarray(0, b.length & ~1).toString('utf16le');
    if (evenZero > n / 4 && oddZero === 0) return Buffer.from(b.subarray(0, b.length & ~1)).swap16().toString('utf16le');
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(b);
  } catch (e) {
    return new TextDecoder('windows-1252').decode(b); // ältere Windows-Dateien mit Umlauten
  }
}

module.exports = { decodeText };
