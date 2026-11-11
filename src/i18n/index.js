'use strict';
/**
 * Übersetzungen. Alle Texte der Oberfläche und alle Fehlermeldungen kommen aus src/i18n/<sprache>.json.
 * Platzhalter wie in den Node-RED-Paketen: "__name__" wird durch args.name ersetzt.
 *
 *   const { t } = require('./i18n');
 *   t('modbus.errors.badPort')                 -> "Ungültiger Port"
 *   t('modbus.errors.network', { host, msg })   -> "easyE4 192.168.1.5:502 nicht erreichbar (ETIMEDOUT)"
 *
 * Fehlt ein Text in der gewählten Sprache, wird Deutsch genommen, sonst der Schlüssel selbst.
 */

const path = require('node:path');
const fs = require('node:fs');

const FALLBACK = 'de';
const cache = new Map();
let current = FALLBACK;

function load(lang) {
  if (!cache.has(lang)) {
    const file = path.join(__dirname, `${lang}.json`);
    cache.set(lang, fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {});
  }
  return cache.get(lang);
}

function lookup(dict, key) {
  let v = dict;
  for (const part of key.split('.')) {
    if (v === null || typeof v !== 'object' || !(part in v)) return undefined;
    v = v[part];
  }
  return typeof v === 'string' ? v : undefined;
}

function t(key, args, lang) {
  let s = lookup(load(lang || current), key);
  if (s === undefined) s = lookup(load(FALLBACK), key);
  if (s === undefined) return key;
  return s.replace(/__([A-Za-z0-9_]+?)__/g, (m, name) => (args && args[name] !== undefined ? String(args[name]) : m));
}

/** Gibt es einen Text zu diesem Schlüssel? */
function has(key, lang) {
  return lookup(load(lang || current), key) !== undefined || lookup(load(FALLBACK), key) !== undefined;
}

function setLanguage(lang) { current = lang || FALLBACK; }
function getLanguage() { return current; }

module.exports = { t, has, setLanguage, getLanguage };
