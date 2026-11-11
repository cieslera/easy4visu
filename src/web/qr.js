'use strict';
/**
 * QR-Code für die Adresse der Visu im Netzwerk (zum Abscannen mit der Handy-Kamera).
 * Eigene, kleine Umsetzung ohne Fremdbibliothek: Byte-Modus, Fehlerkorrektur M, Version 1–6 (bis 106 Zeichen).
 * Nach dem Verfahren der Norm ISO/IEC 18004 (Aufbau wie bei der bekannten Referenz von Project Nayuki).
 */

// je Version 1–6: Prüf-Bytes je Block und Anzahl Blöcke bei Fehlerkorrektur M
const ECC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16];
const BLOCKS = [0, 1, 1, 1, 2, 2, 4];
const MAX_VERSION = 6;

/** Rechnen im Galois-Feld GF(256) mit dem Polynom 0x11D */
function gfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function rsDivisor(degree) {
  const r = new Array(degree).fill(0);
  r[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < r.length; j++) {
      r[j] = gfMul(r[j], root);
      if (j + 1 < r.length) r[j] ^= r[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return r;
}

function rsRemainder(data, divisor) {
  const r = new Array(divisor.length).fill(0);
  for (const b of data) {
    const factor = b ^ r.shift();
    r.push(0);
    divisor.forEach((coef, i) => { r[i] ^= gfMul(coef, factor); });
  }
  return r;
}

/** Anzahl Datenbits-Plätze einer Version (ohne Such-, Takt- und Ausrichtmuster) */
function rawModules(ver) {
  let n = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const align = Math.floor(ver / 7) + 2;
    n -= (25 * align - 10) * align - 55;
  }
  return n;
}
const dataCodewords = (ver) => Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[ver] * BLOCKS[ver];

function alignPositions(ver) {
  if (ver === 1) return [];
  const size = ver * 4 + 17;
  return [6, size - 7]; // Version 2–6: genau zwei Positionen
}

/**
 * QR-Code als Matrix: { size, dark(x, y) }. Wirft einen Fehler, wenn der Text zu lang ist.
 */
function encode(text) {
  const bytes = [...Buffer.from(String(text), 'utf8')];
  let ver = 1;
  while (ver <= MAX_VERSION && 4 + 8 + bytes.length * 8 > dataCodewords(ver) * 8) ver++;
  if (ver > MAX_VERSION) throw new Error('QR: Text zu lang');
  const capacity = dataCodewords(ver) * 8;

  // Bitfolge: Modus „Byte“ (0100), Länge (8 Bit), Daten, Abschluss, auffüllen
  const bits = [];
  const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(4, 4);
  put(bytes.length, 8);
  for (const b of bytes) put(b, 8);
  put(0, Math.min(4, capacity - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) put(pad, 8);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));

  // Prüf-Bytes je Block, dann verschränken
  const nBlocks = BLOCKS[ver];
  const eccLen = ECC_PER_BLOCK[ver];
  const raw = Math.floor(rawModules(ver) / 8);
  const shortBlocks = nBlocks - (raw % nBlocks);
  const shortLen = Math.floor(raw / nBlocks);
  const divisor = rsDivisor(eccLen);
  const blocks = [];
  for (let i = 0, k = 0; i < nBlocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < shortBlocks ? 0 : 1));
    k += dat.length;
    const ecc = rsRemainder(dat, divisor);
    if (i < shortBlocks) dat.push(0);
    blocks.push(dat.concat(ecc));
  }
  const codewords = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((b, j) => { if (i !== shortLen - eccLen || j >= shortBlocks) codewords.push(b[i]); });
  }

  const size = ver * 4 + 17;
  const mod = Array.from({ length: size }, () => new Array(size).fill(false));
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const setFn = (x, y, dark) => { mod[y][x] = dark; fn[y][x] = true; };

  // Taktlinien, Suchmuster (drei Ecken), Ausrichtmuster
  for (let i = 0; i < size; i++) { setFn(6, i, i % 2 === 0); setFn(i, 6, i % 2 === 0); }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx; const y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) setFn(x, y, d !== 2 && d !== 4);
      }
    }
  }
  const al = alignPositions(ver);
  for (let i = 0; i < al.length; i++) {
    for (let j = 0; j < al.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setFn(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
  const drawFormat = (mask) => {
    const d = (0 << 3) | mask; // Fehlerkorrektur M = 0
    let rem = d;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const f = ((d << 10) | rem) ^ 0x5412;
    const bit = (i) => ((f >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) setFn(8, i, bit(i));
    setFn(8, 7, bit(6)); setFn(8, 8, bit(7)); setFn(7, 8, bit(8));
    for (let i = 9; i < 15; i++) setFn(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) setFn(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) setFn(8, size - 15 + i, bit(i));
    setFn(8, size - 8, true);
  };
  drawFormat(0); // Platz reservieren

  // Daten im Zickzack von rechts unten einsetzen
  let n = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let v = 0; v < size; v++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const y = ((right + 1) & 2) === 0 ? size - 1 - v : v;
        if (!fn[y][x] && n < codewords.length * 8) { mod[y][x] = ((codewords[n >>> 3] >>> (7 - (n & 7))) & 1) === 1; n++; }
      }
    }
  }

  const MASKS = [
    (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ];
  const applyMask = (m) => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && MASKS[m](x, y)) mod[y][x] = !mod[y][x];
  };
  // Maske mit den wenigsten „Strafpunkten“ (lange gleichfarbige Reihen, 2×2-Blöcke, Hell/Dunkel-Verhältnis)
  const penalty = () => {
    let p = 0;
    for (let a = 0; a < size; a++) {
      for (const line of [(i) => mod[a][i], (i) => mod[i][a]]) {
        let run = 1;
        for (let i = 1; i <= size; i++) {
          if (i < size && line(i) === line(i - 1)) { run++; continue; }
          if (run >= 5) p += run - 2;
          run = 1;
        }
      }
    }
    for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
      const c = mod[y][x];
      if (c === mod[y][x + 1] && c === mod[y + 1][x] && c === mod[y + 1][x + 1]) p += 3;
    }
    const dark = mod.reduce((s, r) => s + r.filter(Boolean).length, 0);
    p += Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
    return p;
  };
  let best = 0; let bestP = Infinity;
  for (let m = 0; m < 8; m++) {
    applyMask(m); drawFormat(m);
    const p = penalty();
    if (p < bestP) { best = m; bestP = p; }
    applyMask(m);
  }
  applyMask(best); drawFormat(best);
  return { size, version: ver, dark: (x, y) => mod[y][x] };
}

/** QR-Code als SVG (mit 4 Modulen Ruhezone, schwarz auf weiß – so lesen ihn alle Kameras) */
function svg(text, px) {
  const q = encode(text);
  const s = q.size + 8;
  let d = '';
  for (let y = 0; y < q.size; y++) for (let x = 0; x < q.size; x++) if (q.dark(x, y)) d += `M${x + 4} ${y + 4}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}" width="${px || 160}" height="${px || 160}" shape-rendering="crispEdges" role="img">`
    + `<rect width="${s}" height="${s}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

module.exports = { encode, svg };
