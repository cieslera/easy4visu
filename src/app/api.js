'use strict';
/**
 * Programm-Schnittstelle für die Oberfläche: alles, was das Fenster tun darf, läuft über diese Funktionen.
 * Kein Electron hier – so lässt sich alles ohne Fenster testen (test/app-api.test.js).
 * app/main.js reicht die Funktionen über IPC an das Fenster weiter.
 *
 * Passwörter und API-Schlüssel gehen nur in eine Richtung: die Oberfläche kann sie setzen, bekommt sie aber nie
 * zurück (nur „ist gespeichert“).
 */

const EventEmitter = require('node:events');
const { DeviceStore } = require('../core/devices');
const { ValueStore } = require('../core/values');
const { Runtime } = require('../core/runtime');
const { History } = require('../core/history');
const { Alarms } = require('../core/alarms');
const { Users, RANK } = require('../core/users');
const { AuditLog } = require('../core/audit');
const { WebServer } = require('../web/server');
const { TextStore, walkPages, walkBars, walkAlarms } = require('../core/texts');
const PROGRAM_LANGS = ['de', 'en']; // Programmtexte; andere Sprachen zeigen das Programm auf Englisch

// Mindest-Rolle je Funktion (gilt erst, wenn es einen Einrichter gibt – vorher ist alles offen)
const GUARDS = {
  operator: ['writeValue', 'ackAlarm', 'setOnline', 'recordsState', 'trendCsvInfo', 'trendCsv', 'alarmCsv'],
  setup: ['saveDevice', 'removeDevice', 'testConnection', 'previewImport', 'applyImport', 'addVariable', 'updateVariable',
    'removeVariable', 'removeVariables', 'assignVariables', 'savePages', 'saveBars', 'saveTheme', 'saveThemePreset',
    'deleteThemePreset', 'logoFromFile', 'exportTheme', 'importTheme', 'addImage', 'symbolsList', 'symbolsAdd', 'symbolUpdate', 'symbolRemove', 'setRecord', 'saveAlarmDefs', 'saveAlarmAck',
    'usersList', 'userAdd', 'userUpdate', 'userRemove', 'setAuthSettings', 'auditQuery', 'auditCsv', 'exitOperate', 'setStartOptions',
    'textRows', 'setText', 'addLang', 'removeLang', 'setBaseLang', 'importTexts', 'exportTexts', 'clearTextCopies',
    'getWebState', 'setWebOptions', 'getBackupState', 'setBackupOptions', 'saveBackup', 'backupPreview', 'restoreBackup', 'newProject', 'setRetention'],
};
const { createDriver } = require('../protocols');
const { importFiles, applyToDevice } = require('../import');
const { firmwareWarning } = require('../import/check');
const { manualVariable } = require('../import/merge');
const { autoPage, suggestKind, resolvePage } = require('../core/pages');
const { cleanScale, cleanDecimals, scaleOf, toValue, toRaw } = require('../core/scale');
const { PageStore, storeImage, imageFile } = require('../core/project');
const BACKUP = require('../core/backup');
const RECORDS = require('../core/records');
const SYMBOLS = require('../core/symbols');
const THEME = require('../shared/theme');
const fs = require('node:fs');
const path = require('node:path');
const { t, getLanguage, setLanguage } = require('../i18n');

const SECRET_FIELDS = ['password', 'apikey'];
const APP_VERSION = require('../../package.json').version;

/**
 * MQTT: ist der Broker erreichbar? (unabhängig davon, ob die easyE4 sendet)
 * true / false / null = noch unklar; bei anderen Protokollen undefined
 */
function brokerOf(protocol, state, detail) {
  if (protocol !== 'mqtt') return undefined;
  if (state === 'online') return true;
  if (state === 'offline') return detail === 'nodata' || detail === 'connected=false';
  if (state === 'auth') return false;
  if (state === 'unknown' && detail === 'broker') return true; // Broker verbunden, easyE4 noch unklar
  return null;
}

/** Skalierung und Nachkommastellen aus einer Eingabe an die Variable v übernehmen (fehlt = unverändert, leer = weg) */
function setScale(v, input) {
  if (!input) return;
  if ('userScale' in input) {
    const raw = input.userScale;
    const empty = !raw || ['raw0', 'val0', 'raw1', 'val1'].every((k) => raw[k] === undefined || raw[k] === null || String(raw[k]).trim() === '');
    if (empty) delete v.userScale;
    else {
      const s = cleanScale(raw);
      if (!s) throw new Error(t('core.errors.badScale'));
      v.userScale = s;
    }
  }
  if ('userDecimals' in input) {
    const d = cleanDecimals(input.userDecimals);
    if (d === undefined) delete v.userDecimals;
    else v.userDecimals = d;
  }
}

class AppApi extends EventEmitter {
  /**
   * @param opts { dir, protect, unprotect } – siehe DeviceStore; history: false = ohne Aufzeichnung (Tests)
   */
  constructor(opts) {
    super();
    this.devices = new DeviceStore(opts).load();
    // nach „Neues Projekt“: Trends, Meldungsverlauf und Bedienprotokoll des alten Projekts beiseitelegen (vor dem Öffnen)
    this._newProjectMoved = this._moveOldRecords();
    this.textTable = new TextStore({ dir: this.devices.dir });
    this.pages = new PageStore({ dir: this.devices.dir, texts: this.textTable }).load();
    this.values = new ValueStore();
    this.runtime = new Runtime(this.devices, this.values);
    this.states = new Map(); // deviceId -> { state, text }
    this.runtime.on('state', (id, state, text, detail) => {
      this.states.set(id, { state, text, detail });
      const d = this.devices.get(id);
      this.emit('deviceState', { id, state, text, broker: brokerOf(d && d.protocol, state, detail) });
    });
    this.runtime.on('deviceError', (id, err) => this.emit('deviceError', { id, text: err.message }));
    // Zeitpunkt der letzten erfolgreichen Abfrage je Gerät, gesammelt höchstens einmal je Sekunde weitergeben
    this.lastRead = new Map();
    this.seenTimer = null;
    this.runtime.on('polled', (id, ts) => {
      this.lastRead.set(id, ts);
      if (!this.seenTimer) this.seenTimer = setTimeout(() => { this.seenTimer = null; this.emit('seen', Object.fromEntries(this.lastRead)); }, 1000);
    });
    // Wertänderungen gesammelt weitergeben (höchstens alle 200 ms), damit das Fenster nicht überflutet wird
    this.pendingValues = new Map();
    this.flushTimer = null;
    // Benutzer, Anmeldung, Bedienprotokoll
    this.users = new Users({ dir: this.devices.dir });
    this.audit = new AuditLog({ dir: this.devices.dir });
    this.session = null;        // angemeldeter Benutzer { id, name, role }
    // Texttabelle: alle Texte des Projekts (Seiten, Leisten, Meldungen, Anzeige-Namen benutzter Variablen)
    this.textTable.sources = [
      (cb) => walkPages(this.pages.pages, cb),
      (cb) => walkBars(this.pages.bars, cb),
      (cb) => walkAlarms(this.alarms.defs, cb),
      (cb) => { for (const v of this._usedVars()) cb(v, 'label', `v:${v.dev}|${v.name}`, 'var'); },
    ];
    this.emergency = !!opts.emergency; // Start mit --notfall als Windows-Administrator (prüft app/main.js)
    this._raw = {}; // ungeprüfte Fassungen (z. B. „beim Start verbinden“, bevor jemand angemeldet ist)
    for (const [level, names] of Object.entries(GUARDS)) {
      for (const name of names) {
        const fn = this[name];
        if (typeof fn !== 'function') continue;
        this._raw[name] = fn;
        this[name] = (...args) => { this._need(level); return fn.apply(this, args); };
      }
    }
    // Aufzeichnung für Trends: Variablen mit Häkchen „aufzeichnen“ (userRecord), solange verbunden
    this.history = opts.history === false ? null : new History({ dir: this.devices.dir, retentionDays: opts.retentionDays });
    this.fixedRetention = !!opts.retentionDays;
    this.recorded = new Map(); // deviceId -> Set der aufgezeichneten Variablen (Schlüssel wie in den Werten)
    this.historyTimer = null;
    this._updateRecorded();
    if (this._newProjectMoved) this._log({ kind: 'user', what: t('backup.log.newProjectStart', { folder: this._newProjectMoved }) });
    this.devices.on('change', () => this._updateRecorded());
    // Meldungen: kommt / geht aus den Werten, Änderungen gesammelt an die Oberfläche
    // Quittier-Impuls direkt an die Steuerung (im Bedienprotokoll steht dafür „quittiert“)
    this.alarms = new Alarms({ dir: this.devices.dir, write: (dev, name, value) => this.runtime.write(dev, name, value),
      labelOf: (dev, name) => { const d = this.devices.get(dev); const v = d && d.variables.find((x) => (x.id !== undefined && x.id !== null ? String(x.id) : x.name) === name); return v ? v.userLabel || v.label : ''; } });
    this.alarmTimer = null;
    // Demo-Modus (app/main.js startet dafür mit einer Kopie des Projekts): Simulatoren statt echter Geräte
    this.demo = !!opts.demo;
    this.demoKind = this.demo ? opts.demoKind || 'copy' : null; // 'copy' (eigenes Projekt) | 'talwerk'
    if (this.demo) {
      this.runtime.demo = {
        alarmVars: (dev) => new Set(this.alarms.defs.filter((x) => x.dev === dev).map((x) => x.name)),
        // was auf einer Seite bedient wird (Sollwert, Schieberegler, Betriebsart, Schalter, Taster), steht in der Demo fest
        controlVars: (dev) => new Set(this.pages.pages.flatMap((p) => p.items || [])
          .filter((e) => e.dev === dev && ['setpoint', 'slider', 'choice', 'switch', 'button'].includes(e.kind)).map((e) => e.name)),
        // Bereich von Balken, Zeiger, Sollwert, Schieberegler (für Werte ohne bekannte Einheit)
        ranges: (dev) => new Map(this.pages.pages.flatMap((p) => p.items || [])
          .filter((e) => e.dev === dev && e.name && e.min !== undefined && e.max !== undefined && e.min !== '' && e.max !== '')
          .map((e) => [e.name, { min: Number(e.min), max: Number(e.max) }])),
        pulses: (dev) => new Set(this._demoButtons(dev).filter((e) => e.mode !== 'tip' && e.mode !== 'toggle').map((e) => e.name)),
        links: (dev) => this._demoLinks(dev),
        enums: (dev) => this._demoEnums(dev),
        sums: (dev) => this._demoSums(dev),
      };
    }
    this.values.on('change', (id, name, entry) => {
      if (this.runtime.active && this.alarms.onValue(id, name, entry)) this._alarmsChanged();
    });
    this.values.on('change', (id, name, entry) => {
      const rec = this.recorded.get(id);
      if (this.history && this.runtime.active && rec && rec.has(name)) this.history.onValue(id, name, entry, rec.protocol);
    });
    this.values.on('change', (id, name, entry) => {
      if (!this.pendingValues.has(id)) this.pendingValues.set(id, {});
      this.pendingValues.get(id)[name] = entry;
      if (!this.flushTimer) this.flushTimer = setTimeout(() => this._flushValues(), 200);
    });
    this._applyRetention(); // Aufbewahrung aus aufzeichnung.json
    // Texttabelle abgleichen (braucht Seiten und Meldungen); ältere pages.json: Texte durch Nummern ersetzen
    this.textTable.sync();
    this.pages.persist();
    // Webserver für Handy/Tablet (nur mit webRoot = Ordner mit der Oberfläche); gestartet wird er mit applyWeb()
    this.web = opts.webRoot ? new WebServer({ api: this, root: opts.webRoot, host: opts.webHost }) : null;
    this.webError = null;
    // tägliche automatische Sicherung (nur im Programm, nicht in den Tests): eine Minute nach dem Start, dann stündlich prüfen
    this.backupTimer = null;
    if (opts.autoBackup) {
      const check = () => {
        try { this.runAutoBackup(); } catch (err) { this.emit('deviceError', { id: null, text: err.message }); }
        this.backupTimer = setTimeout(check, 3600 * 1000);
        this.backupTimer.unref();
      };
      this.backupTimer = setTimeout(check, 60 * 1000);
      this.backupTimer.unref();
    }
  }

  _flushValues() {
    this.flushTimer = null;
    const batch = {};
    for (const [id, vals] of this.pendingValues) batch[id] = this._scaled(id, vals);
    this.pendingValues.clear();
    this.emit('values', batch);
  }

  /** Skalierung einer Variablen (oder null); Schlüssel wie in den Werten */
  _scaleFor(id, name) {
    const d = this.devices.get(id);
    const v = d && d.variables.find((x) => (x.id !== undefined && x.id !== null ? String(x.id) : x.name) === name);
    return scaleOf(v);
  }

  /** Werte { name: entry } eines Geräts für Anzeige: skalierte Variablen umgerechnet (Rohwert bleibt gespeichert) */
  _scaled(id, vals) {
    const d = this.devices.get(id);
    if (!d || !d.variables.some((v) => v.userScale)) return vals;
    const out = {};
    for (const [name, entry] of Object.entries(vals || {})) {
      const s = this._scaleFor(id, name);
      out[name] = s && entry && typeof entry.value === 'number' ? Object.assign({}, entry, { value: toValue(s, entry.value) }) : entry;
    }
    return out;
  }

  /**
   * Verbinden / Trennen. Beim Programmstart ist nichts verbunden – erst auf Wunsch (Sicherheit beim Projektieren:
   * Bedienseiten schreiben sonst sofort in die echte Steuerung).
   */
  async setOnline(on) {
    if (on && !this.runtime.active) {
      await this.runtime.start();
      this._startHistory();
      if (this.demo) this._demoPrefill();
    }
    if (!on && this.runtime.active) {
      this._stopHistory();
      await this.runtime.stop();
      this.states.clear();
      for (const d of this.devices.list()) {
        this.values.removeDevice(d.id);
        this.emit('deviceState', { id: d.id, state: 'idle', text: t('device.state.idle') });
      }
    }
    this.emit('online', this.runtime.active);
    return this.runtime.active;
  }

  isOnline() { return this.runtime.active; }

  /**
   * Demo: Trends gleich mit der letzten Stunde füllen (Ralf 09.11.2026), damit Kurven nicht leer beginnen.
   * Der Simulator berechnet jeden Wert aus der Uhrzeit – so entsteht genau der Verlauf, den er gezeigt hätte.
   * Nur einmal je Programmstart; minutes/stepMs für Tests.
   */
  _demoPrefill(minutes = 60, stepMs = 10000) {
    if (!this.history || this._prefilled) return 0;
    this._prefilled = true;
    const { keyOf } = require('../protocols/driver');
    const now = Date.now();
    let n = 0;
    for (const [id, set] of this.recorded) {
      const run = this.runtime.running && this.runtime.running.get(id);
      const drv = run && run.driver;
      const d = this.devices.get(id);
      if (!drv || typeof drv.valueOf !== 'function' || !d) continue;
      for (const v of d.variables) {
        const name = keyOf(v);
        if (!set.has(name)) continue;
        for (let t = now - minutes * 60000; t < now - stepMs; t += stepMs) {
          const x = drv.valueOf(v, t);
          if (typeof x === 'number' && Number.isFinite(x)) { this.history._push(id, name, t, x); n++; }
        }
      }
    }
    try { this.history.flush(); } catch (err) { this.emit('deviceError', { id: null, text: err.message }); }
    return n;
  }

  /** läuft easy4Visu im Demo-Modus (simulierte Geräte, Kopie des Projekts)? */
  /** false | 'copy' (Kopie des eigenen Projekts) | 'talwerk' (mitgeliefertes Demo Talwerk) */
  isDemo() { return this.demo ? this.demoKind : false; }

  async start() { return this.setOnline(true); }

  async stop() {
    clearTimeout(this.backupTimer);
    clearTimeout(this.flushTimer);
    clearTimeout(this.seenTimer);
    clearTimeout(this.alarmTimer);
    if (this.web) await this.web.stop();
    this._stopHistory();
    await this.runtime.stop();
    if (this.history) this.history.close();
    this.alarms.close();
    this.audit.close();
  }

  // ---------------------------------------------------------------- Sprachen und Texttabelle (Punkt 5)

  /** Variablen, deren Anzeige-Name auf Seiten oder in Meldungen erscheint (für die Texttabelle) */
  _usedVars() {
    const want = new Set();
    walkPages(this.pages.pages, () => {});
    for (const p of this.pages.pages) for (const e of p.items) {
      if (e.dev && e.name) want.add(`${e.dev}|${e.name}`);
      for (const s of [...(e.series || []), ...(e.map || []), e.fb || {}]) if (s.dev && s.name) want.add(`${s.dev}|${s.name}`);
    }
    for (const d of this.alarms.defs) if (!d.text) want.add(`${d.dev}|${d.name}`);
    const out = [];
    for (const k of want) {
      const i = k.indexOf('|');
      const dev = this.devices.get(k.slice(0, i));
      const v = dev && dev.variables.find((x) => (x.id !== undefined && x.id !== null ? String(x.id) : x.name) === k.slice(i + 1));
      if (v) out.push({ dev: dev.id, name: k.slice(i + 1), label: v.userLabel || v.label || v.name });
    }
    return out;
  }

  /** aktuelle Sprache: des angemeldeten Benutzers, sonst die zuletzt ohne Anmeldung gewählte, sonst die Grundsprache */
  get lang() {
    const u = this.session && this.users.get(this.session.id);
    const l = (u && u.lang) || this.textTable.guestLang || this.textTable.base;
    return this.textTable.langs.includes(l) ? l : this.textTable.base;
  }

  /** Sprache umschalten (Sprachauswahl auf der Bedienseite) – merkt sie sich je Benutzer */
  setLanguage(lang) {
    if (!this.textTable.langs.includes(lang)) throw new Error(t('texts.errors.noLang', { lang }));
    if (this.session) this.users.setLang(this.session.id, lang); else this.textTable.setGuestLang(lang);
    setLanguage(PROGRAM_LANGS.includes(lang) ? lang : 'en');
    this.emit('lang', this.langState());
    return this.langState();
  }

  langState() { return { lang: this.lang, base: this.textTable.base, langs: this.textTable.langs, program: PROGRAM_LANGS.includes(this.lang) ? this.lang : 'en' }; }

  /** Anzeige-Name einer Variablen in einer Sprache (fehlt die Übersetzung: wie bisher) */
  _varLabel(dev, name, lang) {
    const id = this.textTable.idAt(`v:${dev}|${name}`, 'label');
    return id ? this.textTable.get(id, lang) : null;
  }

  /** Geräte mit übersetzten Anzeige-Namen (für Bedienseiten in einer anderen Sprache als der Grundsprache) */
  _devicesIn(lang) {
    const list = this.devices.list();
    if (!lang || lang === this.textTable.base) return list;
    return list.map((d) => Object.assign({}, d, { variables: d.variables.map((v) => {
      const key = v.id !== undefined && v.id !== null ? String(v.id) : v.name;
      const l = this._varLabel(d.id, key, lang);
      return l ? Object.assign({}, v, { userLabel: l }) : v;
    }) }));
  }

  _locAlarms(rows) {
    const lang = this.lang;
    if (lang === this.textTable.base) return rows;
    return rows.map((r) => {
      const id = this.textTable.idAt(`a:${r.aid}`, 'text');
      const text = id ? this.textTable.get(id, lang) : this._varLabel(r.dev, r.name, lang);
      return text ? Object.assign({}, r, { text }) : r;
    });
  }

  textRows() { this.textTable.sync(); return { base: this.textTable.base, langs: this.textTable.langs, rows: this.textTable.rows() }; }

  setText(id, lang, text) {
    const r = this.textTable.setText(id, lang, text);
    if (lang === this.textTable.base) this._afterBaseText();
    return r;
  }

  /** Text der Grundsprache in der Tabelle geändert: Seiten und Meldungen übernehmen ihn */
  _afterBaseText() {
    this.pages.reload();
    for (const d of this.alarms.defs) { const id = this.textTable.idAt(`a:${d.id}`, 'text'); if (id) d.text = this.textTable.get(id, this.textTable.base); }
    this.alarms._write();
  }

  addLang(code) { return this.textTable.addLang(String(code || '').trim()); }

  /** Übersetzungen leeren, die nur eine Kopie der Grundsprache sind */
  clearTextCopies() { return this.textTable.clearCopies(); }
  removeLang(code) { return this.textTable.removeLang(code); }

  setBaseLang(code) {
    this.textTable.setBase(code);
    this._afterBaseText();
    return this.langState();
  }

  /** Tabelle aus CSV/Excel übernehmen (Datei liest app/main.js bzw. später der Webserver) */
  importTexts(table) {
    const r = this.textTable.importRows(table);
    this._afterBaseText();
    return r;
  }

  /** Tabelle zum Ausgeben (Kopfzeile ID, Hinweis, Sprachen) */
  exportTexts() {
    const names = require(`../i18n/${getLanguage()}.json`).texts.kinds;
    return this.textTable.exportRows(names);
  }

  // ---------------------------------------------------------------- Start-Optionen (Kiosk-Betrieb)

  get _startFile() { return path.join(this.devices.dir, 'start.json'); }

  /** { connectOnStart: beim Start verbinden, startOperate: gleich Bedienmodus im Vollbild } */
  getStartOptions() {
    let o = {};
    try { o = JSON.parse(fs.readFileSync(this._startFile, 'utf8')); } catch (e) { o = {}; }
    return { connectOnStart: !!o.connectOnStart, startOperate: !!o.startOperate };
  }

  setStartOptions(o) {
    const next = Object.assign(this.getStartOptions(), {});
    for (const k of ['connectOnStart', 'startOperate']) if (o && k in o) next[k] = !!o[k];
    fs.mkdirSync(this.devices.dir, { recursive: true });
    fs.writeFileSync(this._startFile, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    this._log({ kind: 'user', what: t('users.log.start', { connect: t(next.connectOnStart ? 'users.log.yes' : 'users.log.no'), operate: t(next.startOperate ? 'users.log.yes' : 'users.log.no') }) });
    return next;
  }

  /** beim Programmstart verbinden (ohne Rechteprüfung – es ist noch niemand angemeldet) */
  autoConnect() { return this._raw.setOnline ? this._raw.setOnline.call(this, true) : this.setOnline(true); }

  // ---------------------------------------------------------------- Benutzer und Anmeldung

  /** aktuelle Rolle: ohne Einrichter alles offen, sonst angemeldeter Benutzer oder Rolle „ohne Anmeldung“ */
  role() {
    if (!this.users.active()) return 'setup';
    return this.session ? this.session.role : this.users.settings.guestRole;
  }

  _need(level) {
    if (RANK[this.role()] < RANK[level]) throw Object.assign(new Error(t('users.errors.denied')), { code: 'denied' });
  }

  _who() { return this.session ? this.session.name : null; }

  _log(e) {
    try { this.audit.add(Object.assign({ user: this._who() }, e)); } catch (err) { this.emit('deviceError', { id: null, text: err.message }); return; }
    this.emit('audit'); // offenes Bedienprotokoll am PC frisch laden
  }

  /** Stand der Anmeldung für die Oberfläche (Namen der Benutzer für die Auswahl, ohne Prüfwerte) */
  authState() {
    return { active: this.users.active(), role: this.role(), user: this.session, emergency: this.emergency,
      guestRole: this.users.settings.guestRole, logoutMin: this.users.settings.logoutMin,
      users: this.users.list().map((u) => ({ id: u.id, name: u.name, role: u.role, hasPassword: u.hasPassword, hasPin: u.hasPin })) };
  }

  _authChanged() { this.emit('auth', this.authState()); }

  /** Anmelden mit Passwort oder PIN; Fehlversuche und Sperre kommen ins Protokoll */
  login(id, secret) {
    const u = this.users.get(id);
    const r = this.users.verify(id, secret);
    if (r.ok) {
      const before = this.lang;
      this.session = r.user;
      if (this.lang !== before) { setLanguage(PROGRAM_LANGS.includes(this.lang) ? this.lang : 'en'); this.emit('lang', this.langState()); }
      this._log({ kind: 'login', user: r.user.name, what: t(`users.roles.${r.user.role}`) });
      this._authChanged();
      return { ok: true, user: r.user };
    }
    if (u && !r.locked) this._log({ kind: 'loginFail', user: u.name, what: t('users.log.left', { n: r.left }) });
    if (u && r.justLocked) this._log({ kind: 'locked', user: u.name, what: t('users.log.locked', { s: r.wait }) });
    return { ok: false, locked: !!r.locked, wait: r.wait || 0, left: r.left };
  }

  /** abmelden; reason 'timeout' = nach Zeit ohne Bedienung */
  logout(reason) {
    if (this.session) this._log({ kind: reason === 'timeout' ? 'autoLogout' : 'logout' });
    const before = this.lang;
    this.session = null;
    if (this.lang !== before) { setLanguage(PROGRAM_LANGS.includes(this.lang) ? this.lang : 'en'); this.emit('lang', this.langState()); }
    this._authChanged();
    return true;
  }

  usersList() { return this.users.list(); }

  userAdd(input) {
    const first = !this.users.active();
    const u = this.users.add(input);
    this._log({ kind: 'user', what: t('users.log.added', { name: u.name, role: t(`users.roles.${u.role}`) }) });
    // erster Einrichter: gleich angemeldet, sonst wäre man ab jetzt ausgesperrt
    if (first && u.role === 'setup') { this.session = { id: u.id, name: u.name, role: u.role }; this._log({ kind: 'login', what: t('users.roles.setup') }); }
    this._authChanged();
    return u;
  }

  userUpdate(id, input) {
    const u = this.users.update(id, input || {});
    const parts = [t(`users.roles.${u.role}`)];
    if (input && input.password) parts.push(t('users.log.newPassword'));
    if (input && input.pin) parts.push(t('users.log.newPin'));
    this._log({ kind: 'user', what: t('users.log.changed', { name: u.name, what: parts.join(', ') }) });
    if (this.session && this.session.id === id) this.session = { id: u.id, name: u.name, role: u.role };
    this._authChanged();
    return u;
  }

  userRemove(id) {
    const u = this.users.get(id);
    const ok = this.users.remove(id);
    if (ok && u) this._log({ kind: 'user', what: t('users.log.removed', { name: u.name }) });
    if (this.session && this.session.id === id) this.session = null;
    this._authChanged();
    return ok;
  }

  setAuthSettings(s) {
    const r = this.users.setSettings(s || {});
    this._log({ kind: 'user', what: t('users.log.settings', { role: t(`users.roles.${r.guestRole}`), min: r.logoutMin }) });
    this._authChanged();
    return r;
  }

  /** easy4Visu dauerhaft beenden (nur Einrichter; prüft app/main.js) – steht im Protokoll */
  logQuit() { this._log({ kind: 'quit' }); }

  /** Bedienmodus verlassen (nur Einrichter) – steht im Protokoll */
  exitOperate() {
    if (this.users.active()) this._log({ kind: 'exitOperate' });
    return true;
  }

  /** Notfall-Zugang: nur wenn easy4Visu mit --notfall als Windows-Administrator gestartet wurde */
  emergencyReset(id, password) {
    if (!this.emergency) throw Object.assign(new Error(t('users.errors.denied')), { code: 'denied' });
    const u = this.users.get(id);
    this.users.resetPassword(id, password);
    this._log({ kind: 'emergency', user: t('users.log.admin'), what: t('users.log.reset', { name: u ? u.name : id }) });
    return true;
  }

  auditQuery(filter) { return this.audit.query(filter); }

  // ---------------------------------------------------------------- Handy/Tablet im Browser (Punkt 6)

  /**
   * Sicht eines Browsers (Handy/Tablet): eigene Anmeldung und Sprache, sonst derselbe Kern. Die Anmeldung am PC
   * bleibt davon unberührt. Erreichbar sind nur die Funktionen, die src/web/server.js freigibt.
   */
  clientView(info) {
    const base = this;
    const c = Object.create(this);
    c.session = null;
    c.client = Object.assign({ ip: '' }, info);
    // ohne Anmeldung darf ein Browser nichts – anders als am PC gibt es dort keine Rolle „ohne Anmeldung“
    c.role = () => (c.session ? c.session.role : null);
    c._need = (level) => {
      if (!c.session || RANK[c.session.role] < RANK[level]) throw Object.assign(new Error(t('users.errors.denied')), { code: 'denied' });
    };
    for (const [level, names] of Object.entries(GUARDS)) {
      for (const name of names) if (base._raw[name]) c[name] = (...args) => { c._need(level); return base._raw[name].apply(c, args); };
    }
    // im Bedienprotokoll steht dazu „Browser“; Meldungen und Anmeldung des PCs bleiben, wie sie sind
    c._log = (e) => AppApi.prototype._log.call(c, Object.assign({}, e, { what: [e.what, t('web.via', { ip: c.client.ip })].filter(Boolean).join(' · ') }));
    c._alarmsChanged = () => base._alarmsChanged();
    c._authChanged = () => {};
    c.authState = () => ({ active: base.users.active(), role: c.role(), user: c.session, web: true, logoutMin: base.users.settings.logoutMin,
      startPage: base.getWebOptions().startPage || null, startPageTablet: base.getWebOptions().startPageTablet || null });
    c.login = (name, secret) => {
      const want = String(name || '').trim().toLowerCase();
      const u = base.users.list().find((x) => x.name.trim().toLowerCase() === want);
      if (!u || !want) return { ok: false, locked: false, wait: 0, left: null };
      const r = base.users.verify(u.id, secret);
      if (r.ok) {
        c.session = r.user;
        c._log({ kind: 'login', user: r.user.name, what: t(`users.roles.${r.user.role}`) });
        return { ok: true, user: r.user };
      }
      if (!r.locked) c._log({ kind: 'loginFail', user: u.name, what: t('users.log.left', { n: r.left }) });
      if (r.justLocked) c._log({ kind: 'locked', user: u.name, what: t('users.log.locked', { s: r.wait }) });
      return { ok: false, locked: !!r.locked, wait: r.wait || 0, left: r.left };
    };
    c.logout = (reason) => {
      if (c.session) c._log({ kind: reason === 'timeout' ? 'autoLogout' : 'logout' });
      c.session = null;
      return true;
    };
    c.setLanguage = (lang) => {
      if (!base.textTable.langs.includes(lang)) throw new Error(t('texts.errors.noLang', { lang }));
      c._need('viewer');
      base.users.setLang(c.session.id, lang);
      return c.langState();
    };
    // Seiten mit „nicht im Browser zeigen“ gibt es hier nicht
    const listPages = c.listPages;
    const viewPage = c.viewPage;
    c.listPages = (lang) => listPages.call(c, lang).filter((p) => !p.noWeb);
    c.viewPage = (page) => {
      const p = typeof page === 'string' ? base.pages.get(page) : null;
      if (!p || p.noWeb) throw new Error(t('core.errors.noPage'));
      return viewPage.call(c, page);
    };
    // nach Änderungen an den Benutzern (am PC): Name und Rolle nachziehen; false = Benutzer gibt es nicht mehr
    c.refreshUser = () => {
      if (!c.session) return false;
      const u = base.users.get(c.session.id);
      if (!u || !base.users.active()) { c.session = null; return false; }
      c.session = { id: u.id, name: u.name, role: u.role };
      return true;
    };
    return c;
  }

  get _webFile() { return path.join(this.devices.dir, 'web.json'); }

  /**
   * { enabled: im Netzwerk bereitstellen, port, startPage: Startseite am Handy, startPageTablet: Startseite am Tablet
   *   (und PC-Browser); leer = wie am PC. Handy oder Tablet erkennt der Browser an der Bildschirmgröße. }
   */
  getWebOptions() {
    let o = {};
    try { o = JSON.parse(fs.readFileSync(this._webFile, 'utf8')); } catch (e) { o = {}; }
    const port = Number(o.port);
    return { enabled: !!o.enabled, port: Number.isInteger(port) && port >= 1 && port <= 65535 ? port : 8080, startPage: typeof o.startPage === 'string' ? o.startPage : '',
      startPageTablet: typeof o.startPageTablet === 'string' ? o.startPageTablet : '' };
  }

  /** Einstellung ändern; startet bzw. stoppt den Webserver (falls vorhanden) */
  async setWebOptions(o) {
    const next = this.getWebOptions();
    if (o && 'port' in o) {
      const p = Number(o.port);
      if (!Number.isInteger(p) || p < 1 || p > 65535) throw new Error(t('web.errors.badPort'));
      next.port = p;
    }
    if (o && 'startPage' in o) next.startPage = String(o.startPage || '');
    if (o && 'startPageTablet' in o) next.startPageTablet = String(o.startPageTablet || '');
    if (o && 'enabled' in o) {
      if (o.enabled && !this.users.active()) throw new Error(t('web.errors.noSetup'));
      next.enabled = !!o.enabled;
    }
    fs.mkdirSync(this.devices.dir, { recursive: true });
    fs.writeFileSync(this._webFile, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    this._log({ kind: 'user', what: t('web.log.settings', { on: t(next.enabled ? 'users.log.yes' : 'users.log.no'), port: next.port }) });
    await this.applyWeb();
    return this._webState();
  }

  /** Webserver passend zur Einstellung starten/stoppen (nur mit Einrichter, damit niemand ohne Passwort hineinkommt) */
  async applyWeb() {
    if (!this.web) return;
    const o = this.getWebOptions();
    const want = o.enabled && this.users.active();
    try {
      if (!want) await this.web.stop();
      else if (!this.web.running || this.web.port !== o.port) { await this.web.stop(); await this.web.start(o.port); }
      this.webError = null;
    } catch (err) {
      this.webError = err.code === 'EADDRINUSE' ? t('web.errors.portUsed', { port: o.port }) : err.message;
    }
    this._webChanged();
  }

  _webChanged() { this.emit('web', this._webState()); }

  /** Stand für die Einstellungen am PC: Adressen, QR-Code, angemeldete Browser */
  getWebState() { return this._webState(); }

  /** ohne Rechteprüfung – für die Meldung an das Programmfenster */
  _webState() {
    const o = this.getWebOptions();
    const running = !!(this.web && this.web.running);
    const urls = running ? this.web.urls() : [];
    return Object.assign(o, { available: !!this.web, running, canEnable: this.users.active(), error: this.webError || null, urls,
      qr: urls.length ? require('../web/qr').svg(urls[0], 168) : null, clients: running ? this.web.clients() : [] });
  }

  auditCsv(filter) {
    const U = require(`../i18n/${getLanguage()}.json`).users;
    const L = { head: U.csv.head, kinds: U.kinds };
    return this.audit.csv(filter, L);
  }

  // ---------------------------------------------------------------- Meldungen

  _alarmsChanged() {
    if (this.alarmTimer) return;
    this.alarmTimer = setTimeout(() => { this.alarmTimer = null; this.emit('alarms', this.alarmsActive()); }, 200);
  }

  getAlarmDefs() { return this.alarms.getDefs(); }

  /** Meldungen festlegen; ist verbunden, gleich mit den aktuellen Werten prüfen */
  async saveAlarmDefs(list) {
    const defs = this.alarms.saveDefs(list);
    this.textTable.sync();
    if (this.runtime.active) {
      let changed = false;
      for (const d of defs) { if (this.alarms.onValue(d.dev, d.name, this.values.get(d.dev, d.name))) changed = true; }
      if (changed) this._alarmsChanged();
    }
    return defs;
  }

  getAlarmAck() { return this.alarms.getAckVars(); }

  /** Quittier-Merker je Gerät: { Gerät: Variable } */
  saveAlarmAck(map) { return this.alarms.saveAckVars(map); }

  alarmsActive() { return this._locAlarms(this.alarms.active()); }

  alarmsHistory(limit) { return this._locAlarms(this.alarms.history(limit)); }

  /** quittieren: id eines Eintrags oder 'all' */
  async ackAlarm(id) {
    const open = this.alarms.active().filter((x) => x.canAck && (id === 'all' || x.id === Number(id)));
    const n = await this.alarms.acknowledge(id);
    for (const x of open.slice(0, n)) {
      const d = this.devices.get(x.dev);
      this._log({ kind: 'ack', dev: x.dev, device: d ? d.name : '', name: x.name, what: x.text });
    }
    if (n) this._alarmsChanged();
    return n;
  }

  // ---------------------------------------------------------------- Aufzeichnung (Trends)

  /** welche Variablen aufgezeichnet werden; neu angehakte bekommen gleich ihren aktuellen Wert */
  _updateRecorded() {
    const next = new Map();
    for (const d of this.devices.list()) {
      const set = new Set(d.variables.filter((v) => v.userRecord).map((v) => (v.id !== undefined && v.id !== null ? String(v.id) : v.name)));
      set.protocol = d.protocol;
      if (set.size) next.set(d.id, set);
    }
    if (this.history) {
      for (const [id, old] of this.recorded) for (const name of old) if (!(next.get(id) || new Set()).has(name)) this.history.forget(id, name);
      if (this.runtime.active) {
        for (const [id, set] of next) for (const name of set) {
          if ((this.recorded.get(id) || new Set()).has(name)) continue;
          const entry = this.values.get(id, name);
          if (entry) this.history.onValue(id, name, entry, set.protocol);
        }
      }
    }
    this.recorded = next;
  }

  _startHistory() {
    if (!this.history || this.historyTimer) return;
    try { this.history.prune(); } catch (e) { /* Aufräumen darf das Verbinden nicht verhindern */ }
    this.pruned = Date.now();
    this.historyTimer = setInterval(() => {
      try {
        this.history.tick();
        if (Date.now() - this.pruned > 6 * 3600 * 1000) { this.pruned = Date.now(); this.history.prune(); this.alarms.prune(); this.audit.prune(); }
      } catch (err) { this.emit('deviceError', { id: null, text: err.message }); }
    }, 1000);
    if (this.historyTimer.unref) this.historyTimer.unref(); // hält das Programm nicht am Leben
  }

  _stopHistory() {
    if (!this.historyTimer) return;
    clearInterval(this.historyTimer);
    this.historyTimer = null;
    try { this.history.pause(); } catch (e) { /* beim Trennen egal */ }
  }

  /** Häkchen „aufzeichnen“ einer Variablen setzen oder entfernen */
  async setRecord(deviceId, name, on) {
    return this.updateVariable(deviceId, name, { userRecord: !!on });
  }

  /**
   * Trend-Daten: series [{ dev, name }], Zeitraum from/to (ms), points = Punkte je Kurve (etwa Breite in Pixeln).
   * Ergebnis siehe History.query.
   */
  async historyQuery(series, from, to, points) {
    if (!this.history) return (series || []).map((x) => ({ dev: x.dev, name: x.name, points: [] }));
    const res = this.history.query((series || []).slice(0, 8), Number(from), Number(to), Number(points));
    // aufgezeichnet ist der Rohwert – für skalierte Variablen umrechnen (gilt so auch für alte Aufzeichnungen)
    return res.map((r) => {
      const s = this._scaleFor(r.dev, r.name);
      if (!s) return r;
      const f = (x) => (x === null ? null : toValue(s, x));
      return Object.assign({}, r, { points: r.points.map((p) => (p.length === 3 ? [p[0], ...[f(p[1]), f(p[2])].sort((a, b) => (a === null || b === null ? 0 : a - b))] : [p[0], f(p[1])])) });
    });
  }

  /** Texte für die Oberfläche */
  texts(lang) {
    const l = PROGRAM_LANGS.includes(lang) ? lang : lang ? 'en' : getLanguage();
    const merge = (a, b) => { const o = Object.assign({}, a); for (const [k, v] of Object.entries(b || {})) o[k] = v && typeof v === 'object' && !Array.isArray(v) ? merge(a && a[k], v) : v; return o; };
    // fehlende Texte einer Sprache: Deutsch
    const dict = l === 'de' ? require('../i18n/de.json') : merge(require('../i18n/de.json'), require(`../i18n/${l}.json`));
    return { lang: l, dict };
  }

  _publicDevice(d) {
    const s = this.devices.getSecrets(d.id);
    const st = !this.runtime.active ? { state: 'idle', text: null } : this.states.get(d.id) || { state: d.enabled ? 'unknown' : 'disabled', text: null };
    return Object.assign({}, d, {
      variables: undefined,
      variableCount: d.variables.length,
      secrets: Object.fromEntries(SECRET_FIELDS.map((f) => [f, !!s[f]])), // nur: gespeichert ja/nein
      state: d.enabled ? st.state : 'disabled',
      stateText: d.enabled ? (st.text || t(`device.state.${st.state}`)) : t('ui.devices.disabled'),
      broker: d.enabled && this.runtime.active ? brokerOf(d.protocol, st.state, st.detail) : null,
      lastRead: this.lastRead.get(d.id) || null,
    });
  }

  listDevices() {
    return this.devices.list().map((d) => this._publicDevice(d));
  }

  getDevice(id) {
    const d = this.devices.get(id);
    if (!d) throw new Error(t('core.errors.noDevice', { id }));
    return Object.assign(this._publicDevice(d), { variables: d.variables });
  }

  /**
   * Gerät anlegen (ohne id) oder ändern. secrets: { password, apikey } – leer/fehlend = gespeichertes behalten,
   * clearSecrets: ['password'] = löschen.
   */
  async saveDevice(device, secrets, clearSecrets) {
    const input = {
      name: device.name, protocol: device.protocol, settings: device.settings || {},
      interval: device.interval, enabled: device.enabled !== false,
    };
    let d;
    if (device.id && this.devices.get(device.id)) d = this.devices.update(device.id, input);
    else d = this.devices.add(Object.assign(input, { variables: [] }));
    const old = this.devices.getSecrets(d.id);
    const merged = Object.assign({}, old);
    for (const f of SECRET_FIELDS) {
      if (secrets && secrets[f]) merged[f] = secrets[f];
      if (clearSecrets && clearSecrets.includes(f)) delete merged[f];
    }
    this.devices.setSecrets(d.id, merged);
    this.devices.save();
    this.states.delete(d.id);
    await this.runtime.reload(d.id);
    return this._publicDevice(this.devices.get(d.id));
  }

  async removeDevice(id) {
    this.devices.remove(id);
    this.devices.save();
    this.values.removeDevice(id);
    this.states.delete(id);
    await this.runtime.reload(id);
    return true;
  }

  /** „Verbindung testen“ mit den Angaben aus dem Dialog (noch nicht gespeichert); fehlende Passwörter vom Gerät */
  async testConnection(device, secrets) {
    const stored = device.id ? this.devices.getSecrets(device.id) : {};
    const sec = Object.assign({}, stored);
    for (const f of SECRET_FIELDS) if (secrets && secrets[f]) sec[f] = secrets[f];
    let drv;
    try {
      drv = createDriver(Object.assign({}, device.settings, { protocol: device.protocol }), sec);
    } catch (err) {
      return { ok: false, text: err.message };
    }
    try {
      return await drv.test();
    } finally {
      await drv.close();
    }
  }

  /** Dateien einlesen und die Liste zeigen, ohne etwas zu ändern. files: { itf, symbols: [], st: [] } */
  previewImport(files, netId, deviceId) {
    const r = importFiles({ itf: files.itf || null, symbols: files.symbols || [], st: files.st || [],
      comments: files.comments || [], netId: Number.isInteger(netId) ? netId : null });
    // Modbus: passt die .itf zur eingestellten Firmware? (z. B. versehentlich die Datei eines anderen Geräts)
    const d = deviceId ? this.devices.get(deviceId) : null;
    if (d && d.protocol === 'modbus' && files.itf) {
      const w = firmwareWarning(r.variables, d.settings.firmware);
      if (w) r.warnings.unshift(w);
    }
    // Hinweise zur Modbus-Freigabe nur bei Modbus-Geräten (MQTT und Webserver brauchen keine .itf-Adressen)
    if (d && d.protocol !== 'modbus') {
      const modbusOnly = new Set(r.variables.filter((v) => v.notInItf)
        .map((v) => t('import.warn.notInItf', { op: `${v.operand}${v.index}`, name: v.name })));
      r.warnings = r.warnings.filter((w) => !modbusOnly.has(w));
    }
    // Was fehlt? (ohne ST-Programm keine Vorschläge, ohne .itf bei Modbus keine exportierten Adressen)
    if (!(files.st || []).length) r.warnings.unshift(t('import.warn.noSt'));
    if (d && d.protocol === 'modbus' && !files.itf) r.warnings.unshift(t('import.warn.noItf'));
    return { variables: r.variables, foreign: r.foreign, info: r.info, warnings: r.warnings };
  }

  /** Vorher gezeigte Liste übernehmen (eigene Änderungen bleiben erhalten) */
  async applyImport(deviceId, variables) {
    const res = applyToDevice(this.devices, deviceId, { variables });
    this.devices.save();
    this.values.removeDevice(deviceId);
    await this.runtime.reload(deviceId);
    return res;
  }

  // ---------------------------------------------------------------- Variablen von Hand

  /** input: { operand: 'MW3', name, label } – Datentyp, Adresse, schreibbar ergänzt das Programm */
  async addVariable(deviceId, input) {
    const d = this.getDevice(deviceId);
    const v = manualVariable(input);
    if (d.variables.some((x) => x.name.toLowerCase() === v.name.toLowerCase())) {
      throw new Error(t('core.errors.variableTwice', { name: v.name }));
    }
    const sameOp = d.variables.find((x) => x.operand === v.operand && x.index === v.index && (x.net || null) === (v.net || null));
    if (sameOp) throw new Error(t('import.manual.operandTwice', { op: input.operand, name: sameOp.name }));
    if (input.userRole) v.userRole = input.userRole;
    if (input.userUnit) v.userUnit = input.userUnit;
    setScale(v, input);
    this.devices.setVariables(deviceId, d.variables.concat([v]));
    this.devices.save();
    await this.runtime.reload(deviceId);
    return v;
  }

  /**
   * eigene Angaben ändern: { userLabel, userRole, userUnit, userScale, userDecimals } (leer = Vorschlag aus dem Import;
   * userScale null = keine Umrechnung)
   */
  async updateVariable(deviceId, name, patch) {
    const d = this.getDevice(deviceId);
    const vars = d.variables.map((v) => {
      if (v.name !== name) return v;
      const n = Object.assign({}, v);
      if ('userRecord' in patch) {
        if (patch.userRecord) n.userRecord = true;
        else delete n.userRecord;
      }
      for (const k of ['userLabel', 'userRole', 'userUnit']) {
        if (!(k in patch)) continue;
        const val = patch[k] === null || patch[k] === undefined ? '' : String(patch[k]).trim();
        if (val) n[k] = val;
        else delete n[k];
      }
      setScale(n, patch);
      return n;
    });
    this.devices.setVariables(deviceId, vars);
    this.devices.save();
    return vars.find((v) => v.name === name);
  }

  /**
   * Schnell-Zuordnung: mehrere Variablen auf einmal festlegen.
   * changes: [{ name, userRole: 'display' | 'control' | 'internal', userLabel }] – leerer userLabel = automatisch
   */
  async assignVariables(deviceId, changes) {
    const d = this.getDevice(deviceId);
    const byName = new Map((changes || []).map((c) => [c.name, c]));
    const vars = d.variables.map((v) => {
      const c = byName.get(v.name);
      if (!c) return v;
      const n = Object.assign({}, v);
      for (const k of ['userRole', 'userLabel']) {
        if (!(k in c)) continue;
        const val = c[k] === null || c[k] === undefined ? '' : String(c[k]).trim();
        if (val && !(k === 'userLabel' && val === v.label)) n[k] = val;
        else delete n[k];
      }
      return n;
    });
    this.devices.setVariables(deviceId, vars);
    this.devices.save();
    return true;
  }

  async removeVariable(deviceId, name) {
    return this.removeVariables(deviceId, [name]);
  }

  /** mehrere Variablen auf einmal löschen (Mehrfachauswahl in der Liste); Ergebnis: Anzahl gelöscht */
  async removeVariables(deviceId, names) {
    const d = this.getDevice(deviceId);
    const drop = new Set(names || []);
    const keep = d.variables.filter((v) => !drop.has(v.name));
    this.devices.setVariables(deviceId, keep);
    this.devices.save();
    await this.runtime.reload(deviceId);
    return d.variables.length - keep.length;
  }

  // ---------------------------------------------------------------- Bedienseiten

  /** automatisch erzeugte Seite eines Geräts (bis der Editor kommt) */
  devicePage(deviceId) {
    return autoPage(this.devices.get(deviceId) || { id: deviceId, name: '', variables: [] });
  }

  // ---------------------------------------------------------------- Aufzeichnungen: Tabellen und Aufbewahrung

  get _recordsFile() { return path.join(this.devices.dir, 'aufzeichnung.json'); }

  _retention() {
    let o = {};
    try { o = JSON.parse(fs.readFileSync(this._recordsFile, 'utf8')).retention || {}; } catch (e) { o = {}; }
    return RECORDS.cleanRetention(o);
  }

  /** Fristen an Aufzeichnung, Meldungen und Bedienprotokoll weitergeben (opts.retentionDays der Tests geht vor) */
  _applyRetention() {
    const r = this._retention();
    if (this.history && !this.fixedRetention) this.history.retentionDays = r.trend;
    this.alarms.retentionDays = r.alarm;
    this.audit.retentionDays = r.audit;
  }

  /** aufgezeichnete Variablen [{ dev, device, name, label, unit, v }] in der aktuellen Sprache */
  _recordedVars() {
    const out = [];
    for (const d of this.devices.list()) for (const v of d.variables) {
      if (!v.userRecord) continue;
      const name = v.id !== undefined && v.id !== null ? String(v.id) : v.name;
      out.push({ dev: d.id, device: d.name, name, label: this._varLabel(d.id, name, this.lang) || v.userLabel || v.label || v.name, unit: v.userUnit || '', v });
    }
    return out;
  }

  /** Stand für die Seite „Aufzeichnungen“ */
  recordsState() {
    const st = this.history ? this.history.stats() : { bytes: 0, oldest: null };
    return { series: this._recordedVars().map(({ dev, device, name, label, unit, v }) => ({ dev, device, name, label, unit, bit: String(v.type).toUpperCase() === 'BIT' })),
      retention: this._retention(), choices: RECORDS.RETENTION_DAYS, steps: RECORDS.STEPS, maxRows: RECORDS.MAX_ROWS,
      stats: { trendBytes: st.bytes, trendOldest: st.oldest, alarmOldest: this.alarms.oldest(), auditOldest: this.audit.oldest() } };
  }

  /** Auftrag prüfen: { series: [{ dev, name }], from, to, step (ms aus STEPS oder 'auto') } -> Spalten und Zeilenzahl */
  _trendPlan(spec) {
    const s = spec || {};
    const from = Number(s.from);
    const to = Number(s.to);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) throw new Error(t('records.errors.badRange'));
    const all = this._recordedVars();
    const cols = [];
    for (const x of Array.isArray(s.series) ? s.series.slice(0, 200) : []) {
      const r = all.find((y) => y.dev === x.dev && y.name === String(x.name));
      if (r && !cols.includes(r)) cols.push(r);
    }
    if (!cols.length) throw new Error(t('records.errors.noSeries'));
    const counts = this.history ? cols.map((c) => this.history.count(c.dev, c.name, from, to)) : cols.map(() => 0);
    let step = Number(s.step);
    if (s.step === 'auto') {
      // „was ich sehe“ am Trend: jede Änderung, solange es nicht zu viele Zeilen werden, sonst das feinste passende Raster
      const fit = RECORDS.STEPS.find((st) => RECORDS.estimateRows(from, to, st, counts) <= 100000);
      step = fit === undefined ? RECORDS.STEPS[RECORDS.STEPS.length - 1] : fit;
    } else if (!RECORDS.STEPS.includes(step)) step = 60000;
    return { from, to, step, cols, rows: RECORDS.estimateRows(from, to, step, counts) };
  }

  /** wie viele Zeilen und Spalten die Tabelle bekäme (für den Hinweis vor dem Speichern) */
  trendCsvInfo(spec) {
    const p = this._trendPlan(spec);
    return { rows: p.rows, cols: p.cols.length, step: p.step, tooMany: p.rows > RECORDS.MAX_ROWS };
  }

  /** Trends als CSV-Text: { csv, rows } */
  trendCsv(spec) {
    const p = this._trendPlan(spec);
    if (p.rows > RECORDS.MAX_ROWS) throw new Error(t('records.errors.tooMany', { n: p.rows.toLocaleString('de-DE'), max: RECORDS.MAX_ROWS.toLocaleString('de-DE') }));
    const lang = getLanguage();
    const devs = new Set(p.cols.map((c) => c.dev));
    const cols = p.cols.map((c) => ({
      head: `${devs.size > 1 ? `${c.device}: ` : ''}${c.label}${c.unit ? ` [${c.unit}]` : ''}`,
      scale: scaleOf(c.v), decimals: scaleOf(c.v) ? c.v.userDecimals : undefined,
      samples: this.history ? this.history.raw(c.dev, c.name, p.from, p.to) : [],
    }));
    const rows = RECORDS.trendRows(cols, p.from, p.to, p.step, lang, t('records.csv.time'));
    return { csv: RECORDS.csvText(rows), rows: rows.length - 1, step: p.step };
  }

  /** Meldungsverlauf als CSV-Text: spec { from, to, level ('' | 'fault' | 'warn' | 'info') } -> { csv, rows } */
  alarmCsv(spec) {
    const s = spec || {};
    const from = Number(s.from);
    const to = Number(s.to);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) throw new Error(t('records.errors.badRange'));
    const list = this._locAlarms(this.alarms.range(from, to, s.level));
    const L = { head: ['text', 'level', 'device', 'come', 'gone', 'ack'].map((k) => t(`records.csv.alarm.${k}`)),
      level: { fault: t('ui.alarms.level.fault'), warn: t('ui.alarms.level.warn'), info: t('ui.alarms.level.info') },
      devName: (id) => { const d = this.devices.get(id); return d ? d.name : ''; } };
    return { csv: RECORDS.csvText(RECORDS.alarmRows(list, getLanguage(), L)), rows: list.length };
  }

  /** Aufbewahrung { trend, alarm, audit } in Tagen; ältere Einträge werden gleich gelöscht */
  setRetention(o) {
    const old = this._retention();
    const r = RECORDS.cleanRetention(Object.assign({}, old, o || {}), old);
    let file = {};
    try { file = JSON.parse(fs.readFileSync(this._recordsFile, 'utf8')); } catch (e) { file = {}; }
    fs.writeFileSync(this._recordsFile, `${JSON.stringify(Object.assign(file, { retention: r }), null, 2)}\n`, 'utf8');
    this._applyRetention();
    for (const k of Object.keys(r)) {
      if (r[k] === old[k]) continue;
      this._log({ kind: 'user', what: t('records.log.retention', { what: t(`records.kind.${k}`), old: t(`records.days.${old[k]}`), new: t(`records.days.${r[k]}`) }) });
    }
    try {
      if (this.history && r.trend < old.trend) this.history.prune();
      if (r.alarm < old.alarm) this.alarms.prune();
      if (r.audit < old.audit) this.audit.prune();
    } catch (err) { this.emit('deviceError', { id: null, text: err.message }); }
    return this.recordsState();
  }

  // ---------------------------------------------------------------- Projekt sichern und einspielen (Punkt 7)

  get _backupFile() { return path.join(this.devices.dir, 'sicherung.json'); }

  /** Fehler aus src/core/backup.js als verständlicher Text */
  _backupError(err) {
    if (err && ['notBackup', 'newer', 'badPassword'].includes(err.code)) return new Error(t(`backup.errors.${err.code}`, { app: err.app || '?' }));
    return err;
  }

  /** { auto: täglich sichern, folder: Ordner der Sicherungen, list: [{ name, time, size, kind }] } */
  getBackupState() {
    let o = {};
    try { o = JSON.parse(fs.readFileSync(this._backupFile, 'utf8')); } catch (e) { o = {}; }
    return { auto: o.auto !== false, folder: BACKUP.autoDir(this.devices.dir),
      list: BACKUP.listAuto(this.devices.dir).map(({ name, time, size, kind }) => ({ name, time, size, kind })) };
  }

  setBackupOptions(o) {
    const auto = !(o && o.auto === false);
    fs.mkdirSync(this.devices.dir, { recursive: true });
    fs.writeFileSync(this._backupFile, `${JSON.stringify({ auto }, null, 2)}\n`, 'utf8');
    this._log({ kind: 'user', what: t('backup.log.auto', { on: t(auto ? 'users.log.yes' : 'users.log.no') }) });
    return this.getBackupState();
  }

  _collect(o) {
    const secrets = {};
    for (const d of this.devices.list()) secrets[d.id] = this.devices.getSecrets(d.id);
    return BACKUP.collect({ dir: this.devices.dir, app: APP_VERSION, users: o.users !== false, secrets, password: o.password, auto: !!o.auto });
  }

  /** Sicherung in eine Datei (Dialog in app/main.js). o: { users (Standard ja), password: Kennwort für die Gerätepasswörter } */
  saveBackup(file, o) {
    o = o || {};
    if (o.password && String(o.password).length < 4) throw new Error(t('backup.errors.shortPassword'));
    const obj = this._collect({ users: o.users, password: o.password });
    BACKUP.write(file, obj);
    this._log({ kind: 'user', what: t('backup.log.saved', { file: path.basename(file) }) });
    return BACKUP.summary(obj);
  }

  /** Datei: Pfad aus dem Dialog oder Name einer Sicherung im Ordner „Sicherungen“ */
  _backupPath(file) {
    const name = String(file || '');
    if (/^[\w.-]+\.easy4visu$/i.test(name)) {
      const p = path.join(BACKUP.autoDir(this.devices.dir), name);
      if (fs.existsSync(p)) return p;
    }
    return name;
  }

  /** Vorschau vor dem Einspielen: was steckt in der Datei? */
  backupPreview(file) {
    try {
      return BACKUP.summary(BACKUP.read(this._backupPath(file)));
    } catch (err) {
      throw this._backupError(err);
    }
  }

  /**
   * Sicherung einspielen: vorher automatisch den jetzigen Stand sichern („vor-einspielen-…“), dann Geräte, Seiten,
   * Meldungen, Texte, Design, Bilder (und mit o.users die Benutzer) ersetzen. Gerätepasswörter: aus der Datei (mit
   * o.password), sonst behalten gleiche Geräte ihre gespeicherten. Trennt die Verbindung; app/main.js startet danach neu.
   */
  async restoreBackup(file, o) {
    o = o || {};
    const src = this._backupPath(file);
    let obj;
    let fileSecrets = null;
    try {
      obj = BACKUP.read(src);
      if (obj.secrets && o.password) fileSecrets = BACKUP.secretsOf(obj, o.password);
    } catch (err) {
      throw this._backupError(err);
    }
    const users = o.users !== false && !!obj.files['benutzer.json'];
    await this.setOnline(false);
    // Sicherheitsnetz: jetziger Stand
    const before = path.join(BACKUP.autoDir(this.devices.dir), `vor-einspielen-${BACKUP.stamp(new Date())}.easy4visu`);
    BACKUP.write(before, this._collect({ users: true, auto: true }));
    BACKUP.prune(this.devices.dir, 'before');
    const old = new Map(this.devices.secrets);
    BACKUP.restoreFiles(this.devices.dir, obj, { users });
    this.devices.load();
    // Passwörter: gleiche Geräte behalten ihre, dann die der Sicherung (automatische: Windows-verschlüsselt, nur hier lesbar)
    const ids = new Set(this.devices.list().map((d) => d.id));
    this.devices.secrets.clear();
    for (const [id, sec] of old) if (ids.has(id)) this.devices.secrets.set(id, sec);
    if (obj.pcSecrets) {
      try {
        const data = JSON.parse(obj.pcSecrets);
        const entries = data.protected ? JSON.parse(this.devices.unprotect(data.secrets)) : data.secrets || {};
        for (const [id, sec] of Object.entries(entries)) if (ids.has(id)) this.devices.setSecrets(id, sec);
      } catch (e) { /* auf einem anderen PC erstellt: nicht lesbar */ }
    }
    for (const [id, sec] of Object.entries(fileSecrets || {})) if (ids.has(id)) this.devices.setSecrets(id, sec);
    this.devices.save();
    this.devices.emit('change');
    // alles neu einlesen
    this.textTable.load();
    this.pages.load();
    this.alarms.load();
    this.textTable.sync();
    this.pages.persist();
    if (users) this.users.load();
    this._updateRecorded();
    this._log({ kind: 'user', what: t('backup.log.restored', { file: path.basename(src), before: path.basename(before) }) });
    // andere Benutzer: neu anmelden
    if (users) { this.session = null; this._authChanged(); }
    this.emit('restored');
    return { ok: true, before: path.basename(before), users, secrets: !!fileSecrets, secretsSkipped: !!obj.secrets && !fileSecrets };
  }

  get _newProjectMarker() { return path.join(this.devices.dir, 'neues-projekt.json'); }

  /**
   * Neues, leeres Projekt (Ralf 06.11.2026): vorher automatisch sichern („vor-neuem-projekt-…“), dann Geräte, Variablen,
   * Seiten, Bilder, Meldungstexte, Texte und eigene Symbole löschen. Programm-Einstellungen bleiben; mit o.keepUsers
   * (Standard ja) die Benutzer – ohne: wie eine Neuinstallation, keine Anmeldung –, mit o.keepDesign (Standard ja) Design
   * und Leisten-Vorlage. Trends, Meldungsverlauf und Bedienprotokoll werden
   * beim Neustart in den Ordner „Sicherungen“ verschoben (sind jetzt noch geöffnet). app/main.js startet danach neu.
   */
  async newProject(o) {
    o = o || {};
    const keepDesign = o.keepDesign !== false;
    const keepUsers = o.keepUsers !== false;
    await this.setOnline(false);
    const stamp = BACKUP.stamp(new Date());
    const before = path.join(BACKUP.autoDir(this.devices.dir), `vor-neuem-projekt-${stamp}.easy4visu`);
    BACKUP.write(before, this._collect({ users: true, auto: true }));
    BACKUP.prune(this.devices.dir, 'before');
    const bars = keepDesign ? this.pages.getBars() : null;
    const dir = this.devices.dir;
    const drop = ['devices.json', 'pages.json', 'meldungen.json', 'texte.json', 'symbole.json', 'secrets.json'];
    if (!keepDesign) drop.push('theme.json');
    if (!keepUsers) drop.push('benutzer.json');
    for (const f of drop) fs.rmSync(path.join(dir, f), { force: true });
    fs.rmSync(path.join(dir, 'bilder'), { recursive: true, force: true });
    // Startseiten für Handy/Tablet zeigten auf alte Seiten
    const webFile = path.join(dir, 'web.json');
    try {
      const web = JSON.parse(fs.readFileSync(webFile, 'utf8'));
      web.startPage = '';
      web.startPageTablet = '';
      fs.writeFileSync(webFile, `${JSON.stringify(web, null, 2)}
`, 'utf8');
    } catch (e) { /* keine Einstellungen */ }
    fs.writeFileSync(this._newProjectMarker, `${JSON.stringify({ stamp }, null, 2)}
`, 'utf8');
    // alles neu einlesen
    this.devices.load();
    this.devices.emit('change');
    this.textTable.load();
    this.pages.load();
    if (bars) this.pages.saveBars(bars);
    this.alarms.load();
    this.textTable.sync();
    this._updateRecorded();
    this._log({ kind: 'user', what: t('backup.log.newProject', { before: path.basename(before) }) });
    if (!keepUsers) { this.users.load(); this.session = null; this._authChanged(); }
    this.emit('restored');
    return { ok: true, before: path.basename(before), keepDesign, keepUsers };
  }

  /** beim Start nach „Neues Projekt“: alte Aufzeichnungen nach Sicherungen/vor-neuem-projekt-…-aufzeichnungen; Name oder null */
  _moveOldRecords() {
    let m;
    try { m = JSON.parse(fs.readFileSync(this._newProjectMarker, 'utf8')); } catch (e) { return null; }
    const name = `vor-neuem-projekt-${String(m.stamp || BACKUP.stamp(new Date())).replace(/[^w-]/g, '')}-aufzeichnungen`;
    const target = path.join(BACKUP.autoDir(this.devices.dir), name);
    let moved = false;
    for (const base of ['verlauf.sqlite', 'meldungen.sqlite', 'protokoll.sqlite']) {
      for (const f of [base, `${base}-wal`, `${base}-shm`, `${base}-journal`]) {
        const src = path.join(this.devices.dir, f);
        if (!fs.existsSync(src)) continue;
        fs.mkdirSync(target, { recursive: true });
        fs.renameSync(src, path.join(target, f));
        moved = true;
      }
    }
    fs.rmSync(this._newProjectMarker, { force: true });
    return moved ? name : null;
  }

  /** tägliche Sicherung, falls eingeschaltet und die letzte älter als 23 Stunden ist; behält die letzten 7 */
  runAutoBackup(now) {
    if (!this.getBackupState().auto || !fs.existsSync(this.devices.file)) return null;
    const time = now || Date.now();
    const last = BACKUP.listAuto(this.devices.dir).find((x) => x.kind === 'auto');
    if (last && time - last.time < 23 * 3600 * 1000) return null;
    const file = path.join(BACKUP.autoDir(this.devices.dir), `auto-${BACKUP.stamp(new Date(time))}.easy4visu`);
    BACKUP.write(file, this._collect({ users: true, auto: true }));
    BACKUP.prune(this.devices.dir, 'auto');
    return path.basename(file);
  }

  // ---------------------------------------------------------------- Farbthema der Bedienseiten (Teil 4)

  get _themeFile() { return path.join(this.devices.dir, 'theme.json'); }

  /** theme.json: { version, theme (aktuelles Design), presets (eigene Vorlagen) } */
  _readThemeFile() {
    try {
      return JSON.parse(fs.readFileSync(this._themeFile, 'utf8')) || {};
    } catch (e) {
      return {};
    }
  }

  _writeThemeFile(data) {
    fs.mkdirSync(this.devices.dir, { recursive: true });
    const tmp = `${this._themeFile}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(Object.assign({ version: 1 }, data), null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, this._themeFile);
  }

  getTheme() {
    const data = this._readThemeFile();
    return THEME.clean(data.theme || THEME.DEFAULT);
  }

  saveTheme(theme) {
    const t = THEME.clean(theme);
    this._writeThemeFile({ theme: t, presets: this.getThemePresets() });
    return t;
  }

  /** eigene Vorlagen: [{ id, name, …Thema }] (Farben, Ecken, Schrift, Größe, Logo) */
  getThemePresets() {
    const list = this._readThemeFile().presets;
    return (Array.isArray(list) ? list : []).slice(0, 50)
      .filter((p) => p && typeof p.name === 'string' && p.name.trim())
      .map((p) => Object.assign({ id: /^[a-z0-9]{1,20}$/.test(String(p.id)) ? p.id : Math.random().toString(36).slice(2, 10), name: p.name.trim().slice(0, 40) }, THEME.clean(p)));
  }

  /** aktuelles Design unter einem Namen als Vorlage speichern; gleicher Name = ersetzen */
  saveThemePreset(name) {
    const n = String(name || '').trim().slice(0, 40);
    if (!n) throw new Error(t('ui.design.presetNoName'));
    const list = this.getThemePresets();
    const old = list.find((p) => p.name.toLowerCase() === n.toLowerCase());
    const entry = Object.assign({ id: old ? old.id : Date.now().toString(36), name: n }, this.getTheme());
    const next = old ? list.map((p) => (p === old ? entry : p)) : list.concat([entry]);
    this._writeThemeFile({ theme: this.getTheme(), presets: next });
    return next;
  }

  deleteThemePreset(id) {
    const next = this.getThemePresets().filter((p) => p.id !== id);
    this._writeThemeFile({ theme: this.getTheme(), presets: next });
    return next;
  }

  /** Logo-Datei (PNG, JPG, SVG bis 1 MB) als data:-Text – nur vom Datei-Dialog in app/main.js aufgerufen */
  logoFromFile(file) {
    const types = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml' };
    const type = types[path.extname(file).toLowerCase()];
    if (!type) throw new Error(t('ui.design.logoType'));
    const buf = fs.readFileSync(file);
    if (buf.length > 1024 * 1024) throw new Error(t('ui.design.logoSize'));
    return `data:${type};base64,${buf.toString('base64')}`;
  }

  /** Thema als Datei weitergeben / übernehmen (Datei-Dialoge in app/main.js) */
  exportTheme(file) {
    fs.writeFileSync(file, `${JSON.stringify({ easy4visu: 'theme', version: 1, theme: this.getTheme() }, null, 2)}
`, 'utf8');
    return true;
  }

  importTheme(file) {
    let data;
    try {
      data = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      throw new Error(t('ui.design.importBad'));
    }
    if (!data || data.easy4visu !== 'theme' || !data.theme) throw new Error(t('ui.design.importBad'));
    return this.saveTheme(data.theme);
  }

  // ---------------------------------------------------------------- eigene Seiten (Editor)

  /** Seiten; mit lang = 'current' in der aktuellen Sprache (Bedienseiten), sonst Grundsprache (Editor) */
  listPages(lang) {
    if (lang !== 'current') return this.pages.list();
    return this.textTable.localize(walkPages, this.pages.pages, this.lang);
  }

  /** Leisten-Vorlage (oben, unten, links, rechts) für alle Bedienseiten */
  getBars(lang) {
    if (lang !== 'current') return this.pages.getBars();
    return this.textTable.localize(walkBars, this.pages.bars, this.lang);
  }
  saveBars(bars) { return this.pages.saveBars(bars); }

  /** ganze Seitenliste speichern (der Editor schickt nach jeder Änderung alles) */
  savePages(pages) { return this.pages.save(pages); }

  /** Seite zum Anzeigen: page = id oder Seite (im Editor auch noch nicht gespeichert) */
  /** im Editor (Seite als Objekt): Grundsprache; Bedienseite (id): aktuelle Sprache */
  viewPage(page) {
    const p = typeof page === 'string' ? this.pages.get(page) : page;
    if (!p) throw new Error(t('core.errors.noPage'));
    if (typeof page !== 'string' || this.lang === this.textTable.base) return resolvePage(p, this.devices.list());
    const [loc] = this.textTable.localize(walkPages, [p], this.lang);
    return resolvePage(loc, this._devicesIn(this.lang));
  }

  /** Bild für Bild-Element oder Seitenhintergrund übernehmen – nur vom Datei-Dialog in app/main.js aufgerufen */
  addImage(file) {
    try {
      return storeImage(this.devices.dir, file);
    } catch (e) {
      if (e.code === 'type' || e.code === 'size') throw new Error(t(`ui.editor.image.${e.code}`));
      throw e;
    }
  }

  // ---- „Meine Symbole“ (Bildersammlung des Projekts, nur Einrichter)
  symbolsList() { return SYMBOLS.list(this.devices.dir); }

  /**
   * Bilder in die Sammlung übernehmen – nur vom Datei-/Ordner-Dialog in app/main.js aufgerufen.
   * entries: [{ file, group }]; Ergebnis { added, known, failed, symbols, text } (text = Meldung für den Anwender)
   */
  symbolsAdd(entries) {
    const r = SYMBOLS.add(this.devices.dir, entries || []);
    const parts = [r.added === 1 ? t('ui.mySymbols.added1') : t('ui.mySymbols.added', { n: r.added })];
    if (r.known) parts.push(t('ui.mySymbols.known', { n: r.known }));
    if (r.failed.length) parts.push(t('ui.mySymbols.failed', { n: r.failed.length, files: r.failed.slice(0, 3).map((x) => require('node:path').basename(x.file)).join(', ') }));
    return Object.assign(r, { text: parts.join(' · ') });
  }

  symbolUpdate(img, o) { return SYMBOLS.update(this.devices.dir, String(img || ''), o || {}); }

  symbolRemove(img) { return SYMBOLS.remove(this.devices.dir, String(img || '')); }

  /** gespeichertes Bild { file, type } für die Anzeige (Adresse e4img://bild/<Name>) */
  imageFile(name) { return imageFile(this.devices.dir, name); }

  /** neues Element für eine Variable, die auf die Seite gezogen wird */
  suggestElement(deviceId, name) {
    const d = this.getDevice(deviceId);
    const v = d.variables.find((x) => (x.id !== undefined && x.id !== null ? String(x.id) : x.name) === name);
    if (!v) throw new Error(t('core.errors.noVariable', { name }));
    return { kind: suggestKind(v), dev: deviceId, name };
  }

  /** aktuelle Werte eines Geräts { name: { value, ts, quality, error } } */
  deviceValues(id) {
    return this._scaled(id, this.values.snapshot(id));
  }

  /** Wert schreiben (Bedienung) */
  /** opts: { noMerge: true } = nicht mit einem wartenden Befehl für dieselbe Variable zusammenfassen (Tipptaster) */
  /** Demo-Modus: Taster eines Geräts auf allen Seiten */
  _demoButtons(dev) {
    return this.pages.pages.flatMap((p) => p.items || []).filter((e) => e.kind === 'button' && e.dev === dev && e.name);
  }

  /**
   * Demo-Modus: was das easyE4-Programm sonst mit den Rückmeldungen der Taster macht (Leuchttaster leuchten lassen).
   * „Anlage_Ein“ setzt seine Rückmeldung, der Partner „Anlage_Aus“ löscht sie; ein Taster ohne Partner schaltet sie um;
   * tastend/rastend: Rückmeldung folgt dem Taster; Rückmeldung in Störungsfarbe (Quittieren): löscht sie.
   */
  _demoLinks(dev) {
    const PAIRS = /^(.*?)[_ ]?(ein|aus|an|auf|zu|on|off|start|stop|oeffnen|öffnen|schliessen|schließen)$/i;
    const stem = (n) => { const m = PAIRS.exec(n); return m ? m[1].toLowerCase() : null; };
    const buttons = this._demoButtons(dev);
    const links = new Map();
    // derselbe Taster auf mehreren Seiten: jede Regel nur einmal (sonst schaltet „umschalten“ zweimal)
    const add = (name, l) => {
      if (!links.has(name)) links.set(name, []);
      const list = links.get(name);
      if (!list.some((x) => x.name === l.name && x.op === l.op)) list.push(l);
    };
    for (const e of buttons) {
      if (!e.fb || e.fb.dev !== dev || !e.fb.name || e.fb.name === e.name) continue;
      const fb = e.fb.name;
      if (e.fbColor === 'alarm') { add(e.name, { name: fb, op: 'clear' }); continue; }
      if (e.mode === 'tip' || e.mode === 'toggle') { add(e.name, { name: fb, op: 'follow' }); continue; }
      const st = stem(e.name);
      const partners = st ? buttons.filter((b) => b.name !== e.name && stem(b.name) === st) : [];
      add(e.name, { name: fb, op: partners.length ? 'on' : 'toggle' });
      for (const b of partners) add(b.name, { name: fb, op: 'off' });
    }
    return links;
  }

  /**
   * Demo-Modus: erlaubte Werte je Variable aus Auswahl-Knöpfen (Betriebsart 0/1/2) und Zustandsanzeigen mit Wertetabelle
   * (Torzustand 0 … 3; Zeilen in Störungsfarbe bleiben weg – Störungen kommen über die Meldungen)
   */
  /**
   * Demo: Sammelmeldungen (Bit-Variable, deren Name oder Beschriftung „Sammel“ enthält, z. B. „Sammelstoerung“) folgen
   * den Meldungen desselben Geräts (Störungen und Warnungen, keine Hinweise) – sonst stünde der Merker immer auf 0.
   */
  _demoSums(dev) {
    const d = this.devices.get(dev);
    const out = new Map();
    if (!d) return out;
    const names = this.alarms.defs.filter((a) => a.dev === dev && a.level !== 'info').map((a) => a.name);
    if (!names.length) return out;
    for (const v of d.variables) {
      if (v.type !== 'BIT' || !/sammel/i.test(`${v.name} ${v.label || ''} ${v.userLabel || ''}`)) continue;
      const key = v.id !== undefined && v.id !== null ? String(v.id) : v.name;
      if (!names.includes(key)) out.set(key, names);
    }
    return out;
  }

  _demoEnums(dev) {
    const out = new Map();
    const add = (name, x) => {
      const n = Number(x);
      if (!Number.isFinite(n)) return;
      if (!out.has(name)) out.set(name, []);
      if (!out.get(name).includes(n)) out.get(name).push(n);
    };
    for (const e of this.pages.pages.flatMap((p) => p.items || [])) {
      if (e.dev !== dev || !e.name) continue;
      if (e.kind === 'choice') for (const o of e.opts || []) add(e.name, o.v);
      if (e.kind === 'status') {
        for (const m of e.map || []) if ((!m.name || (m.dev === dev && m.name === e.name)) && m.color !== 'alarm') add(e.name, m.from);
      }
    }
    for (const l of out.values()) l.sort((x, y) => x - y);
    return out;
  }

  async writeValue(id, name, value, opts) {
    const old = this.values.get(id, name);
    // skalierte Variable: eingegeben wird in der Einheit (2,5 bar), an die easyE4 geht der Rohwert (500)
    const sc = this._scaleFor(id, name);
    await this.runtime.write(id, name, sc ? toRaw(sc, value) : value, opts);
    // Bedienprotokoll: wer, was, alter und neuer Wert
    const d = this.devices.get(id);
    const v = d && d.variables.find((x) => (x.id !== undefined && x.id !== null ? String(x.id) : x.name) === name);
    this._log({ kind: 'write', dev: id, device: d ? d.name : '', name: v ? v.name : name, what: v ? v.userLabel || v.label : '',
      old: old && old.quality === 'good' ? (sc ? toValue(sc, old.value) : old.value) : null, new: value });
    return true;
  }
}

module.exports = { AppApi };
