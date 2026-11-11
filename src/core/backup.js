'use strict';
/**
 * Projekt sichern und einspielen (Punkt 7, Entscheidung 45).
 *
 * Eine Sicherung ist eine Datei *.easy4visu: JSON, mit gzip gepackt. Inhalt:
 *   { easy4visu: 'projekt', format, created, app, auto,
 *     files: { 'devices.json': {...}, 'pages.json', 'meldungen.json', 'texte.json', 'theme.json', 'symbole.json', 'benutzer.json'? },
 *     web: { startPage, startPageTablet },            Startseiten im Browser (Ein/Aus und Port bleiben am PC)
 *     images: { '<name>': '<base64>' },                 Ordner „bilder“
 *     secrets?: { salt, iv, tag, data },                Gerätepasswörter, mit eigenem Kennwort verschlüsselt (scrypt + AES-GCM)
 *     pcSecrets?: '<…>' }                               nur automatische Sicherungen: secrets.json, wie sie auf diesem PC liegt
 *                                                       (Windows-Verschlüsselung – woanders nicht lesbar)
 * Nicht enthalten: Trends, Meldungsverlauf, Bedienprotokoll, Start-Optionen und Netzwerk-Einstellung dieses PCs.
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

const FORMAT = 1;
const FILES = ['devices.json', 'pages.json', 'meldungen.json', 'texte.json', 'theme.json', 'symbole.json'];
const USERS = 'benutzer.json';
const AUTO_DIR = 'Sicherungen';
const AUTO_KEEP = 7;

class BackupError extends Error {
  constructor(code, extra) { super(code); this.code = code; Object.assign(this, extra); }
}

const readJson = (file) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null);

function writeAtomic(file, text) {
  // nur anlegen, wenn er fehlt: mkdir auf ein Laufwerk selbst (z. B. USB-Stick „D:\“) meldet unter Windows EPERM
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

/** Text mit Kennwort verschlüsseln: scrypt-Schlüssel, AES-256-GCM (merkt falsches Kennwort und Veränderung) */
function encrypt(text, password) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(String(password), salt, 32);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return { salt: salt.toString('base64'), iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') };
}

function decrypt(box, password) {
  try {
    const key = crypto.scryptSync(String(password), Buffer.from(box.salt, 'base64'), 32);
    const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(box.iv, 'base64'));
    d.setAuthTag(Buffer.from(box.tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(box.data, 'base64')), d.final()]).toString('utf8');
  } catch (e) {
    throw new BackupError('badPassword');
  }
}

/**
 * Sicherung zusammenstellen.
 * @param opts { dir, app (Programmversion), users: Benutzer mitsichern, secrets: { id: {password, apikey} } (Klartext),
 *               password: Kennwort für die Gerätepasswörter (leer = ohne), auto: automatische Sicherung (mit pcSecrets) }
 */
function collect(opts) {
  const { dir } = opts;
  const out = { easy4visu: 'projekt', format: FORMAT, created: new Date().toISOString(), app: opts.app || '', auto: !!opts.auto, files: {}, images: {} };
  for (const f of FILES) {
    const data = readJson(path.join(dir, f));
    if (data) out.files[f] = data;
  }
  if (opts.users) {
    const u = readJson(path.join(dir, USERS));
    if (u) out.files[USERS] = u;
  }
  const web = readJson(path.join(dir, 'web.json')) || {};
  out.web = { startPage: String(web.startPage || ''), startPageTablet: String(web.startPageTablet || '') };
  const imgDir = path.join(dir, 'bilder');
  if (fs.existsSync(imgDir)) {
    for (const name of fs.readdirSync(imgDir)) {
      if (/^[a-z0-9]{1,40}\.[a-z]{2,4}$/i.test(name)) out.images[name] = fs.readFileSync(path.join(imgDir, name)).toString('base64');
    }
  }
  const secrets = Object.fromEntries(Object.entries(opts.secrets || {}).filter(([, s]) => s && Object.keys(s).length));
  if (opts.password && Object.keys(secrets).length) out.secrets = encrypt(JSON.stringify(secrets), opts.password);
  if (opts.auto && fs.existsSync(path.join(dir, 'secrets.json'))) out.pcSecrets = fs.readFileSync(path.join(dir, 'secrets.json'), 'utf8');
  return out;
}

const pack = (obj) => zlib.gzipSync(Buffer.from(JSON.stringify(obj), 'utf8'));

function write(file, obj) {
  writeAtomic(file, pack(obj));
  return file;
}

/** Datei lesen und prüfen; wirft BackupError 'notBackup' | 'newer' */
function read(file) {
  let obj;
  try {
    obj = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8'));
  } catch (e) {
    throw new BackupError('notBackup');
  }
  if (!obj || obj.easy4visu !== 'projekt' || typeof obj.files !== 'object' || !obj.files) throw new BackupError('notBackup');
  if (!(Number(obj.format) >= 1)) throw new BackupError('notBackup');
  if (Number(obj.format) > FORMAT) throw new BackupError('newer', { app: obj.app });
  return obj;
}

/** Überblick für die Vorschau vor dem Einspielen */
function summary(obj) {
  const f = obj.files;
  const devices = (f['devices.json'] && f['devices.json'].devices) || [];
  const pages = (f['pages.json'] && f['pages.json'].pages) || [];
  const alarms = (f['meldungen.json'] && f['meldungen.json'].alarms) || [];
  const users = f[USERS] && Array.isArray(f[USERS].users) ? f[USERS].users : null;
  return {
    created: obj.created, app: obj.app, auto: !!obj.auto,
    devices: devices.map((d) => ({ name: d.name, protocol: d.protocol, variables: Array.isArray(d.variables) ? d.variables.length : 0 })),
    pages: pages.length, alarms: alarms.length, images: Object.keys(obj.images || {}).length,
    users: users ? users.length : null, theme: !!f['theme.json'], texts: !!f['texte.json'],
    secrets: !!obj.secrets, pcSecrets: !!obj.pcSecrets,
  };
}

/**
 * Dateien in den Datenordner schreiben (Geräte, Seiten, Meldungen, Texte, Design, Bilder, Startseiten;
 * Benutzer nur mit opts.users). Gerätepasswörter erledigt der Aufrufer (siehe secretsOf).
 */
function restoreFiles(dir, obj, opts) {
  // fehlt eine Datei in der Sicherung, galt dort der Standard – dann auch hier
  for (const f of FILES) {
    const target = path.join(dir, f);
    if (obj.files[f]) writeAtomic(target, `${JSON.stringify(obj.files[f], null, 2)}\n`);
    else if (fs.existsSync(target)) fs.unlinkSync(target);
  }
  if (opts.users && obj.files[USERS]) writeAtomic(path.join(dir, USERS), `${JSON.stringify(obj.files[USERS], null, 2)}\n`);
  for (const [name, b64] of Object.entries(obj.images || {})) {
    if (!/^[a-z0-9]{1,40}\.[a-z]{2,4}$/i.test(name)) continue;
    const target = path.join(dir, 'bilder', name);
    if (!fs.existsSync(target)) writeAtomic(target, Buffer.from(String(b64), 'base64'));
  }
  if (obj.web) {
    const webFile = path.join(dir, 'web.json');
    const web = readJson(webFile) || {};
    web.startPage = String(obj.web.startPage || '');
    web.startPageTablet = String(obj.web.startPageTablet || '');
    writeAtomic(webFile, `${JSON.stringify(web, null, 2)}\n`);
  }
}

/** Gerätepasswörter aus der Sicherung: mit Kennwort entschlüsselt ({ id: {…} }), sonst null */
function secretsOf(obj, password) {
  if (!obj.secrets || !password) return null;
  return JSON.parse(decrypt(obj.secrets, password));
}

// ---------------------------------------------------------------- automatische Sicherungen

const autoDir = (dir) => path.join(dir, AUTO_DIR);

/** vorhandene Sicherungen im Ordner „Sicherungen“, neueste zuerst: [{ name, file, time, size, kind: 'auto' | 'before' }] */
function listAuto(dir) {
  const d = autoDir(dir);
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).filter((n) => /\.easy4visu$/i.test(n)).map((name) => {
    const st = fs.statSync(path.join(d, name));
    // Zeitpunkt aus dem Namen (auto-2026-11-03_14-05-00), sonst Änderungsdatum der Datei
    const m = /(\d{4})-(\d\d)-(\d\d)_(\d\d)-(\d\d)-(\d\d)/.exec(name);
    const time = m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() : st.mtimeMs;
    return { name, file: path.join(d, name), time, size: st.size, kind: name.startsWith('vor-') ? 'before' : 'auto' };
  }).sort((a, b) => b.time - a.time);
}

const stamp = (date) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}_${p(date.getHours())}-${p(date.getMinutes())}-${p(date.getSeconds())}`;
};

/** ältere Sicherungen einer Art löschen, die neuesten AUTO_KEEP bleiben */
function prune(dir, kind) {
  for (const x of listAuto(dir).filter((e) => e.kind === kind).slice(AUTO_KEEP)) {
    try { fs.unlinkSync(x.file); } catch (e) { /* in Benutzung – beim nächsten Mal */ }
  }
}

module.exports = { FORMAT, AUTO_DIR, AUTO_KEEP, BackupError, collect, write, read, summary, restoreFiles, secretsOf, listAuto, prune, stamp, autoDir, encrypt, decrypt };
