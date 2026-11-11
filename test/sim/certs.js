'use strict';
// Selbst signierte Testzertifikate (nur für die Tests, werden nicht gespeichert). Braucht openssl;
// fehlt es, liefert certs() null und die HTTPS/TLS-Tests werden übersprungen.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function makeCert(dir, name, bits) {
  const key = path.join(dir, `${name}.key`);
  const cert = path.join(dir, `${name}.crt`);
  execFileSync('openssl', ['req', '-x509', '-newkey', `rsa:${bits}`, '-sha256', '-nodes', '-keyout', key, '-out', cert,
    '-days', '2', '-subj', '/CN=easyE4'], { stdio: 'ignore', env: Object.assign({}, process.env, { MSYS_NO_PATHCONV: '1' }) });
  return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
}

let cached;
/** { modern: {key, cert} (RSA 2048), old: {key, cert} (RSA 1024, wie ältere easyE4) } oder null */
function certs() {
  if (cached !== undefined) return cached;
  let dir = null;
  try {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'easy4visu-'));
    cached = { modern: makeCert(dir, 'k2048', 2048), old: makeCert(dir, 'k1024', 1024) };
  } catch (e) {
    cached = null;
  } finally {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
  return cached;
}

function openssl(args, cwd) {
  execFileSync('openssl', args, { cwd, stdio: 'ignore', env: Object.assign({}, process.env, { MSYS_NO_PATHCONV: '1' }) });
}

let cachedCa;
/**
 * Eigene Test-CA wie beim Mosquitto auf dem Raspberry Pi: { caFile, ca, key, cert, otherCaFile, cleanup() }.
 * Das Server-Zertifikat ist von der CA unterschrieben und gilt für 127.0.0.1; otherCaFile ist eine fremde CA.
 * Die Dateien liegen in einem Temp-Ordner, bis cleanup() aufgerufen wird. Ohne openssl: null.
 */
function caChain() {
  if (cachedCa !== undefined) return cachedCa;
  let dir = null;
  try {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'easy4visu-ca-'));
    const subj = (cn) => ['-subj', `/CN=${cn}`];
    openssl(['req', '-x509', '-newkey', 'rsa:2048', '-sha256', '-nodes', '-keyout', 'ca.key', '-out', 'ca.crt', '-days', '2', ...subj('Test-CA')], dir);
    openssl(['req', '-newkey', 'rsa:2048', '-sha256', '-nodes', '-keyout', 'server.key', '-out', 'server.csr', ...subj('broker')], dir);
    fs.writeFileSync(path.join(dir, 'san.ext'), 'subjectAltName=IP:127.0.0.1\n');
    openssl(['x509', '-req', '-in', 'server.csr', '-CA', 'ca.crt', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'server.crt',
      '-days', '2', '-sha256', '-extfile', 'san.ext'], dir);
    openssl(['req', '-x509', '-newkey', 'rsa:2048', '-sha256', '-nodes', '-keyout', 'other.key', '-out', 'other.crt', '-days', '2', ...subj('Fremde-CA')], dir);
    const d = dir;
    cachedCa = {
      caFile: path.join(d, 'ca.crt'), otherCaFile: path.join(d, 'other.crt'),
      key: fs.readFileSync(path.join(d, 'server.key')), cert: fs.readFileSync(path.join(d, 'server.crt')),
      cleanup() { fs.rmSync(d, { recursive: true, force: true }); },
    };
  } catch (e) {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    cachedCa = null;
  }
  return cachedCa;
}

const SKIP_TEXT = 'openssl nicht gefunden – TLS-Tests übersprungen';

module.exports = { certs, caChain, SKIP_TEXT };
