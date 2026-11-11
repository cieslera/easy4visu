'use strict';
/**
 * Kleiner Leser für Excel-Dateien im alten Format (.xls, BIFF8), wie easySoft sie für die Operanden-Kommentare
 * exportiert. Liest nur Zellinhalte (Text und Zahlen) – keine Formeln, Formate oder Makros. Ohne fremde Pakete.
 *
 *   readXls(buffer) -> [{ name: 'Tabelle1', rows: [['Operand', 'Kommentar'], ['M1', 'Fern ein'], …] }]
 *
 * Aufbau: Die .xls ist ein „Compound File“ (Ordner mit Datenströmen); der Strom „Workbook“ enthält Datensätze
 * (Typ, Länge, Daten). Texte stehen meist in einer gemeinsamen Liste (SST), die Zellen verweisen darauf.
 */

const ENDOFCHAIN = 0xfffffffe;
const FREESECT = 0xffffffff;

function fail(msg) {
  return new Error(`Keine lesbare Excel-Datei (.xls): ${msg}`);
}

// ---------------------------------------------------------------- Compound File (OLE2)
function readCompound(buf) {
  if (buf.length < 512 || buf.readUInt32LE(0) !== 0xe011cfd0 || buf.readUInt32LE(4) !== 0xe11ab1a1) throw fail('Kennung fehlt');
  const secSize = 1 << buf.readUInt16LE(0x1e);
  const miniSize = 1 << buf.readUInt16LE(0x20);
  const nFat = buf.readUInt32LE(0x2c);
  const firstDir = buf.readUInt32LE(0x30);
  const miniCutoff = buf.readUInt32LE(0x38);
  const firstMiniFat = buf.readUInt32LE(0x3c);
  const firstDifat = buf.readUInt32LE(0x44);
  const sector = (n) => {
    const off = (n + 1) * secSize;
    if (off + secSize > buf.length + secSize) throw fail('Sektor außerhalb der Datei');
    return buf.subarray(off, off + secSize);
  };
  // Liste der FAT-Sektoren (erste 109 im Kopf, weitere in DIFAT-Sektoren)
  const fatSectors = [];
  for (let i = 0; i < 109 && fatSectors.length < nFat; i++) {
    const s = buf.readUInt32LE(0x4c + i * 4);
    if (s !== FREESECT) fatSectors.push(s);
  }
  let difat = firstDifat;
  let guard = 0;
  while (fatSectors.length < nFat && difat !== ENDOFCHAIN && difat !== FREESECT && guard++ < 10000) {
    const d = sector(difat);
    for (let i = 0; i < secSize / 4 - 1 && fatSectors.length < nFat; i++) {
      const s = d.readUInt32LE(i * 4);
      if (s !== FREESECT) fatSectors.push(s);
    }
    difat = d.readUInt32LE(secSize - 4);
  }
  const fat = [];
  for (const s of fatSectors) {
    const d = sector(s);
    for (let i = 0; i < secSize / 4; i++) fat.push(d.readUInt32LE(i * 4));
  }
  const chain = (start, table) => {
    const out = [];
    let s = start;
    while (s !== ENDOFCHAIN && s !== FREESECT && s < table.length && out.length <= table.length) {
      out.push(s);
      s = table[s];
    }
    return out;
  };
  const readChain = (start) => Buffer.concat(chain(start, fat).map(sector));

  // Verzeichnis
  const dirData = readChain(firstDir);
  const entries = [];
  for (let off = 0; off + 128 <= dirData.length; off += 128) {
    const nameLen = dirData.readUInt16LE(off + 0x40);
    const name = dirData.subarray(off, off + Math.max(0, nameLen - 2)).toString('utf16le');
    entries.push({ name, type: dirData[off + 0x42], start: dirData.readUInt32LE(off + 0x74), size: dirData.readUInt32LE(off + 0x78) });
  }
  const root = entries.find((e) => e.type === 5);
  let miniStream = null;
  let miniFat = null;
  const stream = (name) => {
    const e = entries.find((x) => x.type === 2 && x.name.toLowerCase() === name.toLowerCase());
    if (!e) return null;
    if (e.size >= miniCutoff) return readChain(e.start).subarray(0, e.size);
    // kleiner Strom: liegt im „Mini-Stream“ des Wurzeleintrags
    if (!miniStream) {
      miniStream = readChain(root.start);
      const mf = readChain(firstMiniFat);
      miniFat = [];
      for (let i = 0; i + 4 <= mf.length; i += 4) miniFat.push(mf.readUInt32LE(i));
    }
    const parts = chain(e.start, miniFat).map((s) => miniStream.subarray(s * miniSize, (s + 1) * miniSize));
    return Buffer.concat(parts).subarray(0, e.size);
  };
  return { stream };
}

// ---------------------------------------------------------------- BIFF8
/** Datensätze lesen; CONTINUE-Sätze (0x003C) werden an den vorigen angehängt, ihre Grenzen gemerkt (für Texte) */
function records(wb) {
  const out = [];
  let off = 0;
  while (off + 4 <= wb.length) {
    const type = wb.readUInt16LE(off);
    const len = wb.readUInt16LE(off + 2);
    const data = wb.subarray(off + 4, off + 4 + len);
    off += 4 + len;
    if (type === 0x003c && out.length) {
      const prev = out[out.length - 1];
      prev.breaks.push(prev.data.length);
      prev.data = Buffer.concat([prev.data, data]);
    } else {
      out.push({ type, data, breaks: [] });
    }
  }
  return out;
}

/** Texte der gemeinsamen Liste (SST); Texte dürfen über CONTINUE-Grenzen gehen (dann neues Optionsbyte) */
function readSst(rec) {
  const d = rec.data;
  const breaks = rec.breaks;
  const n = d.readUInt32LE(4);
  const strings = [];
  let p = 8;
  const nextBreak = (pos) => breaks.find((b) => b > pos);
  for (let i = 0; i < n && p < d.length; i++) {
    const cch = d.readUInt16LE(p);
    let flags = d[p + 2];
    p += 3;
    let runs = 0;
    let ext = 0;
    if (flags & 0x08) { runs = d.readUInt16LE(p); p += 2; }
    if (flags & 0x04) { ext = d.readUInt32LE(p); p += 4; }
    let s = '';
    let left = cch;
    while (left > 0) {
      const wide = flags & 0x01;
      const nb = nextBreak(p - 1);
      const avail = nb !== undefined && nb >= p ? (nb - p) / (wide ? 2 : 1) : left;
      const take = Math.min(left, Math.floor(avail));
      s += wide ? d.subarray(p, p + take * 2).toString('utf16le') : d.subarray(p, p + take).toString('latin1');
      p += take * (wide ? 2 : 1);
      left -= take;
      if (left > 0) { flags = (flags & ~0x01) | (d[p] & 0x01); p += 1; } // neues Optionsbyte nach der Grenze
    }
    p += runs * 4 + ext;
    strings.push(s);
  }
  return strings;
}

function rkValue(rk) {
  let v;
  if (rk & 0x02) v = rk >> 2; // ganze Zahl
  else {
    const b = Buffer.alloc(8);
    b.writeUInt32LE(rk & 0xfffffffc, 4);
    v = b.readDoubleLE(0);
  }
  return rk & 0x01 ? v / 100 : v;
}

function readXls(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const cf = readCompound(buf);
  const wb = cf.stream('Workbook') || cf.stream('Book');
  if (!wb) throw fail('Arbeitsmappe fehlt');
  const recs = records(wb);
  let sst = [];
  const sheetNames = [];
  const sheets = [];
  let current = null;
  let depth = 0;
  for (const r of recs) {
    const d = r.data;
    switch (r.type) {
      case 0x0809: // BOF
        depth++;
        if (depth === 2 || (depth === 1 && d.readUInt16LE(2) === 0x0010)) {
          current = { name: sheetNames[sheets.length] || `Tabelle${sheets.length + 1}`, cells: new Map() };
          sheets.push(current);
        }
        break;
      case 0x000a: depth = Math.max(0, depth - 1); if (depth <= 1) current = depth === 1 ? null : current; break;
      case 0x0085: { // BOUNDSHEET
        const cch = d[6];
        const wide = d[7] & 0x01;
        sheetNames.push(wide ? d.subarray(8, 8 + cch * 2).toString('utf16le') : d.subarray(8, 8 + cch).toString('latin1'));
        break;
      }
      case 0x00fc: sst = readSst(r); break;
      default:
        if (!current) break;
        if (r.type === 0x00fd) current.cells.set(`${d.readUInt16LE(0)}:${d.readUInt16LE(2)}`, sst[d.readUInt32LE(6)]);
        else if (r.type === 0x0204) { // LABEL
          const cch = d.readUInt16LE(6);
          const wide = d[8] & 0x01;
          current.cells.set(`${d.readUInt16LE(0)}:${d.readUInt16LE(2)}`,
            wide ? d.subarray(9, 9 + cch * 2).toString('utf16le') : d.subarray(9, 9 + cch).toString('latin1'));
        } else if (r.type === 0x0203) current.cells.set(`${d.readUInt16LE(0)}:${d.readUInt16LE(2)}`, d.readDoubleLE(6));
        else if (r.type === 0x027e) current.cells.set(`${d.readUInt16LE(0)}:${d.readUInt16LE(2)}`, rkValue(d.readInt32LE(6)));
        else if (r.type === 0x00bd) { // MULRK
          const row = d.readUInt16LE(0);
          const first = d.readUInt16LE(2);
          const n = (d.length - 6) / 6;
          for (let i = 0; i < n; i++) current.cells.set(`${row}:${first + i}`, rkValue(d.readInt32LE(4 + i * 6 + 2)));
        }
    }
  }
  return sheets.map((s) => {
    let maxR = -1;
    let maxC = -1;
    for (const k of s.cells.keys()) {
      const [r, c] = k.split(':').map(Number);
      maxR = Math.max(maxR, r);
      maxC = Math.max(maxC, c);
    }
    const rows = [];
    for (let r = 0; r <= maxR; r++) {
      const row = [];
      for (let c = 0; c <= maxC; c++) {
        const v = s.cells.get(`${r}:${c}`);
        row.push(v === undefined ? '' : v);
      }
      rows.push(row);
    }
    return { name: s.name, rows };
  });
}

module.exports = { readXls };
