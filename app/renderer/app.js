'use strict';
/**
 * Oberfläche von easy4Visu (Stufe 3, Teil 1): Geräte anlegen, Verbindung testen, Variablen einlesen, Live-Werte.
 * Spricht nur über window.e4 (app/preload.js) mit dem Programm. Alle Texte kommen aus der Sprachdatei.
 */
(function () {
  let dict = {};
  const state = {
    view: 'devices',          // 'devices' | 'detail' | 'editor' | 'pages'
    devices: [],
    detail: null,             // Gerät mit Variablen
    values: {},               // deviceId -> { name: entry }
    filterNamed: false,
    selected: new Set(),      // markierte Variablen (Namen) in der Liste
    online: false,            // verbunden? Beim Start nie – erst nach Klick auf „Verbinden“
  };
  // im Browser (Handy/Tablet, app/renderer/web.js): nur Anmeldeseite und Bedienseiten, kein Editor, keine Verwaltung
  const WEB = !!(window.e4 && window.e4.web);

  // ------------------------------------------------------------------ Hilfen
  function T(key, args) {
    let v = key.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), dict);
    if (typeof v !== 'string') return key;
    return v.replace(/__([A-Za-z0-9_]+?)__/g, (m, n) => (args && args[n] !== undefined ? String(args[n]) : m));
  }

  /** DOM-Element bauen: h('div', { class: 'x', on: { click: fn }, attrs: {...} }, kinder…) */
  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    const p = props || {};
    if (p.class) el.className = p.class;
    if (p.text !== undefined) el.textContent = p.text;
    if (p.html) el.innerHTML = p.html; // nur für feste SVG-Symbole aus diesem Skript
    if (p.attrs) for (const [k, v] of Object.entries(p.attrs)) if (v !== undefined && v !== null && v !== false) el.setAttribute(k, v === true ? '' : v);
    if (p.on) for (const [k, fn] of Object.entries(p.on)) el.addEventListener(k, fn);
    if (p.value !== undefined) el.value = p.value;
    if (p.checked !== undefined) el.checked = p.checked;
    for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return el;
  }

  const ICONS = {
    globe: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M3 12 H21 M12 3 c3 3 3 15 0 18 M12 3 c-3 3 -3 15 0 18"></path></svg>',
    user: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"></circle><path d="M4 21 c1-4 4-6 8-6 s7 2 8 6"></path></svg>',
    log: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2"></rect><path d="M9 8 H15 M9 12 H15 M9 16 H13"></path></svg>',
    bell: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 16 V11 a6 6 0 0 1 12 0 V16 L19.5 18 H4.5 Z"></path><path d="M10 21 H14"></path></svg>',
    devices: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"></rect><path d="M8 20 H16 M12 16 V20"></path></svg>',
    pages: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5"></rect><rect x="14" y="3" width="7" height="7" rx="1.5"></rect><rect x="3" y="14" width="7" height="7" rx="1.5"></rect><rect x="14" y="14" width="7" height="7" rx="1.5"></rect></svg>',
    editor: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20 L8 19 L19 8 L16 5 L5 16 Z"></path><path d="M14 7 L17 10"></path></svg>',
    close: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6 L18 18 M18 6 L6 18"></path></svg>',
    plus: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5 V19 M5 12 H19"></path></svg>',
    ok: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12 L10 17 L19 7"></path></svg>',
    warn: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 L22 20 H2 Z"></path><path d="M12 10 V14"></path><path d="M12 17.5 V17.6"></path></svg>',
    err: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M8.5 8.5 L15.5 15.5 M15.5 8.5 L8.5 15.5"></path></svg>',
    back: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6 L9 12 L15 18"></path></svg>',
    moon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"></path></svg>',
    gear: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"></circle><path d="M12 2 V5 M12 19 V22 M2 12 H5 M19 12 H22 M4.9 4.9 L7 7 M17 17 L19.1 19.1 M4.9 19.1 L7 17 M17 7 L19.1 4.9"></path></svg>',
    list: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 6 H20 M9 12 H20 M9 18 H20"></path><path d="M4 6 V6.1 M4 12 V12.1 M4 18 V18.1" stroke-width="3"></path></svg>',
    box: '<svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"></rect><path d="M8 20 H16 M12 16 V20"></path></svg>',
    chart: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4 V20 H20"></path><path d="M7 15 L11 10 L14 13 L19 7"></path></svg>',
    phone: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="2" width="12" height="20" rx="2"></rect><path d="M11 18 H13"></path></svg>',
    archive: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="5" rx="1"></rect><path d="M5 9 V20 H19 V9 M10 13 H14"></path></svg>',
    download: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4 V15 M7 10 L12 15 L17 10 M5 20 H19"></path></svg>',
  };
  const icon = (name) => h('span', { html: ICONS[name], attrs: { 'aria-hidden': 'true' }, class: 'ic' });

  function toast(text) {
    const box = document.getElementById('toast');
    box.replaceChildren(h('div', { class: 'msg', text }));
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => box.replaceChildren(), 4000);
  }

  const protocolName = (p) => T(`ui.editDevice.protocols.${p}`);
  /** IP-Adresse und Port; ohne eigenen Port der übliche (Modbus 502, Webserver 80/443, MQTT 1883/8883) */
  const address = (d) => {
    const s = d.settings || {};
    if (!s.host) return '–';
    const port = s.port || (d.protocol === 'modbus' ? 502 : d.protocol === 'json' ? (s.https ? 443 : 80) : d.protocol === 'mqtt' ? (s.tls ? 8883 : 1883) : '');
    return port ? `${s.host}:${port}` : s.host;
  };

  // ------------------------------------------------------------------ Hell / Dunkel
  const THEME_KEY = 'easy4visu.theme';
  function readTheme() { try { return localStorage.getItem(THEME_KEY) || 'auto'; } catch (e) { return 'auto'; } }
  function applyTheme() {
    const pref = readTheme();
    const dark = pref === 'dark' || (pref === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }
  function setTheme(v) {
    try { localStorage.setItem(THEME_KEY, v); } catch (e) { /* ohne Speicher: gilt nur bis zum Neustart */ }
    applyTheme();
    render();
  }
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

  // ------------------------------------------------------------------ Zusatzfunktionen (ab Werk aus)
  // autoPages: automatisch erstellte Bedienseite, quickAssign: Schnell-Zuordnung – beides nur auf Wunsch
  const OPTIONS_KEY = 'easy4visu.options';
  function readOptions() {
    const base = { autoPages: false, quickAssign: false, commissioning: false };
    try { return Object.assign(base, JSON.parse(localStorage.getItem(OPTIONS_KEY) || '{}')); }
    catch (e) { return base; }
  }
  let options = readOptions();
  function setOption(key, on) {
    options = Object.assign({}, options, { [key]: on });
    try { localStorage.setItem(OPTIONS_KEY, JSON.stringify(options)); } catch (e) { /* gilt nur bis zum Neustart */ }
    if (state.view === 'pages') { showPages(); return; }
    if (state.view === 'editor') { renderCanvas(); return; }
    render();
  }
  async function openOptions(opts) {
    if (needSetupView(() => openOptions(opts))) return;
    const O = (k) => T(`ui.options.${k}`);
    let kiosk = null;
    try { kiosk = await window.e4.kioskGet(); } catch (e) { kiosk = null; }
    const kioskItem = (key, checked, onChange, extraHint) => h('div', { class: 'optitem' },
      checkField(O(key), checked, async (on) => { try { await onChange(on); } catch (err) { toast(err.message); openOptions(); } }, key),
      h('div', { class: 'muted small', text: extraHint || O(`${key}Hint`) }));
    const item = (key) => h('div', { class: 'optitem' },
      checkField(O(key), options[key], (on) => setOption(key, on), key),
      h('div', { class: 'muted small', text: O(`${key}Hint`) }));
    const panel = h('div', { class: 'panel', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': O('title') } },
      h('div', { class: 'head' }, h('h2', { text: O('title') }),
        h('button', { class: 'iconbtn', attrs: { 'aria-label': T('ui.common.close') }, on: { click: closeModal } }, icon('close'))),
      h('h3', { text: O('extras') }),
      item('commissioning'), item('autoPages'), item('quickAssign'),
      kiosk ? h('h3', { text: O('kioskTitle') }) : null,
      kiosk ? kioskItem('autostart', kiosk.autostart, async (on) => {
        await window.e4.setAutostart(on);
        // eingeschaltet, aber noch nicht für den Betrieb an der Anlage eingerichtet: Hinweis mit „Ja, alles einschalten“
        if (on && !(kiosk.connectOnStart && kiosk.startOperate)) openOptions({ kioskHint: true });
      }, kiosk.win ? null : O('autostartOnlyWin')) : null,
      kiosk && opts && opts.kioskHint && kiosk.autostart && !(kiosk.connectOnStart && kiosk.startOperate) ? h('div', { class: 'result info kioskall', attrs: { 'data-test': 'kiosk-all' } },
        h('div', { class: 'grow', text: O('kioskAll') }),
        h('button', { class: 'btn small primary', attrs: { 'data-test': 'kiosk-all-on' }, on: { click: async () => {
          try { await window.e4.setStartOptions({ connectOnStart: true, startOperate: true }); } catch (err) { toast(err.message); }
          openOptions();
        } } }, O('kioskAllBtn'))) : null,
      kiosk ? kioskItem('connectOnStart', kiosk.connectOnStart, (on) => window.e4.setStartOptions({ connectOnStart: on })) : null,
      kiosk ? kioskItem('startOperate', kiosk.startOperate, (on) => window.e4.setStartOptions({ startOperate: on })) : null,
      kiosk ? h('div', { class: 'optitem' }, h('button', { class: 'btn danger', attrs: { 'data-test': 'quit-app' }, on: { click: () => quitApp() } }, O('quit')),
        h('div', { class: 'muted small', text: O('quitHint') })) : null,
      // Demo-Modus: Neustart mit simulierten Geräten und einer Kopie des Projekts (nur am PC, nur Techniker)
      WEB ? null : h('h3', { text: T('ui.demo.title') }),
      WEB || state.demo ? null : h('div', { class: 'optitem' }, h('div', { class: 'muted small', text: T('ui.demo.musterHint') }),
        h('button', { class: 'btn primary', attrs: { 'data-test': 'demo-muster' }, on: { click: () => startTalwerkDemo() } }, T('ui.demo.muster'))),
      WEB ? null : h('div', { class: 'optitem' }, h('div', { class: 'muted small', text: T(state.demo ? (state.demo === 'talwerk' ? 'ui.demo.hintOnMuster' : 'ui.demo.hintOn') : 'ui.demo.hint') }),
        h('button', { class: `btn${state.demo ? ' primary' : ''}`, attrs: { 'data-test': 'demo-toggle' }, on: { click: async () => {
          if (!window.confirm(T(state.demo ? 'ui.demo.confirmOff' : 'ui.demo.confirmOn'))) return;
          try { await window.e4.setDemo(!state.demo); } catch (err) { toast(err.message); }
        } } }, T(state.demo ? 'ui.demo.stop' : 'ui.demo.start'))),
      WEB ? null : h('h3', { text: O('licTitle') }),
      WEB ? null : h('div', { class: 'optitem' }, h('div', { class: 'muted small', text: O('licHint') }),
        h('button', { class: 'btn', attrs: { 'data-test': 'open-licenses' }, on: { click: () => showLicenses() } }, O('licBtn'))),
      h('h3', { text: O('designTitle') }),
      h('div', { class: 'optitem' }, h('div', { class: 'muted small', text: O('designHint') }),
        h('button', { class: 'btn', attrs: { 'data-test': 'open-design' }, on: { click: () => showDesign() } }, O('designBtn'))),
      h('div', { class: 'foot' }, h('div', { class: 'spacer' }),
        h('button', { class: 'btn primary', attrs: { 'data-test': 'close-options' }, on: { click: closeModal } }, T('ui.common.close'))));
    const overlay = h('div', { class: 'overlay center', on: { mousedown: (e) => { if (e.target === overlay) closeModal(); } } }, panel);
    setModal(overlay);
  }

  // Verwaltung → „Projekt“ und „Handy & Tablet“ (früher im Einstellungsfenster, umgezogen 03.11.2026).
  // Der Inhalt wird beim Öffnen einmal gebaut und bleibt beim Neuzeichnen erhalten (halb ausgefüllte Felder gehen nicht verloren).
  async function showProject() {
    if (needSetupView(() => showProject())) return;
    closeModal();
    await flushEditorSave();
    let st;
    try { st = await window.e4.getBackupState(); } catch (err) { toast(err.message); return; }
    state.projectBox = projectOptions(st);
    state.view = 'project';
    render();
  }
  const projectView = () => h('div', { class: 'recview' },
    h('div', { class: 'pagehead' }, h('div', { class: 'grow' }, h('h1', { text: T('ui.nav.project') }), h('div', { class: 'muted', text: T('ui.backup.intro') }))),
    h('section', { class: 'card recbox' }, state.projectBox));
  async function showWeb() {
    if (needSetupView(() => showWeb())) return;
    closeModal();
    await flushEditorSave();
    let st;
    let pages = [];
    try { st = await window.e4.getWebState(); pages = await window.e4.listPages('current'); } catch (err) { toast(err.message); return; }
    state.webBox = st.available ? webOptions(st, pages) : h('div', { class: 'muted', text: T('ui.optWeb.notAvailable') });
    state.view = 'web';
    render();
  }
  const webView = () => h('div', { class: 'recview' },
    h('div', { class: 'pagehead' }, h('div', { class: 'grow' }, h('h1', { text: T('ui.nav.web') }), h('div', { class: 'muted', text: T('ui.optWeb.intro') }))),
    h('section', { class: 'card recbox' }, state.webBox));

  /** „Im Netzwerk bereitstellen“ (Bedienseiten auf Handy/Tablet im Browser); zeichnet sich bei Änderungen neu */
  function webOptions(first, pages) {
    const W = (k, a) => T(`ui.optWeb.${k}`, a);
    const box = h('div', { attrs: { 'data-test': 'web-options' } });
    const set = async (o) => { try { draw(await window.e4.setWebOptions(o)); } catch (err) { toast(err.message); draw(await window.e4.getWebState()); } };
    const draw = (s) => {
      const port = h('input', { class: 'input', value: String(s.port), attrs: { type: 'number', min: '1', max: '65535', inputmode: 'numeric', 'data-test': 'web-port', 'aria-label': W('port') } });
      const en = h('input', { attrs: { type: 'checkbox', 'data-field': 'web-enabled', disabled: !s.canEnable && !s.enabled }, checked: s.enabled, on: { change: (e) => set({ enabled: e.target.checked }) } });
      const urls = s.urls || [];
      const startChoices = [['', W('startPageSame')], ...pages.map((p) => [p.id, p.noWeb ? `${p.name} – ${W('notInWeb')}` : p.name, p.noWeb])];
      box.replaceChildren(...[
        h('div', { class: 'optitem' }, h('label', { class: 'check' }, en, W('enable')),
          h('div', { class: 'muted small', text: s.canEnable ? W('enableHint') : W('noSetup') })),
        s.error ? h('div', { class: 'result err', attrs: { 'data-test': 'web-error' } }, icon('err'), h('div', { text: s.error })) : null,
        s.running ? h('div', { class: 'optitem webopt' },
          urls.length ? h('div', {}, h('div', { class: 'small', text: W('open') }),
            h('div', { class: 'weburl', text: urls[0], attrs: { 'data-test': 'web-url' } }),
            ...urls.slice(1).map((u) => h('div', { class: 'mono small muted', text: u })),
            h('div', { class: 'muted small', text: W('scan') }))
            : h('div', { class: 'result warn' }, icon('warn'), h('div', { text: W('noAddress') })),
          s.qr ? h('div', { class: 'qr', html: s.qr, attrs: { 'data-test': 'web-qr' } }) : null) : null,
        s.enabled ? h('div', { class: 'result warn' }, icon('warn'), h('div', { text: W('warn') })) : null,
        s.enabled ? h('div', { class: 'muted small', text: `${W('firewall')} ${W('sleep')}` }) : null,
        h('div', { class: 'optitem' }, h('div', { class: 'label', text: W('port') }),
          h('div', { class: 'webport' }, port, h('button', { class: 'btn small', attrs: { 'data-test': 'web-port-save' },
            on: { click: () => set({ port: Number(port.value) }) } }, W('portSave'))),
          h('div', { class: 'muted small', text: W('portHint') })),
        h('div', { class: 'optitem' }, h('div', { class: 'row2' },
          selectField(W('startPage'), s.startPage || '', startChoices, (v) => set({ startPage: v }), 'web-start'),
          selectField(W('startPageTablet'), s.startPageTablet || '', startChoices, (v) => set({ startPageTablet: v }), 'web-start-tablet')),
          h('div', { class: 'muted small', text: W('startPageHint') })),
        s.running ? h('div', { class: 'optitem', attrs: { 'data-test': 'web-clients' } }, h('div', { class: 'label', text: W('clients') }),
          s.clients.length ? h('ul', { class: 'webclients' }, ...s.clients.map((c) => h('li', { class: 'small',
            text: `${c.name} · ${roleName(c.role)} · ${c.ip}${c.connected ? '' : ` (${W('closed')})`}` })))
            : h('div', { class: 'muted small', text: W('noClients') })) : null].filter(Boolean));
    };
    draw(first);
    webDraw = (s) => { if (box.isConnected) draw(s); };
    return box;
  }
  let webDraw = null;

  /** „Projekt“ – sichern, einspielen (mit Vorschau), tägliche Sicherung (Entscheidung 45, nur Einrichter) */
  function projectOptions(first) {
    const B = (k, a) => T(`ui.backup.${k}`, a);
    const box = h('div', { attrs: { 'data-test': 'project-options' } });
    let mode = null;      // null | 'save' | 'new' | { file, name, preview }
    let keepDesign = true;
    let keepUsers = true;
    let st = first;
    const save = { users: true, secrets: false, pw: '', pw2: '' };
    const when = (ms) => new Date(ms).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
    const fail = (err) => toast(err.message);
    const reload = async () => { try { st = await window.e4.getBackupState(); } catch (e) { /* bleibt */ } draw(); };
    const pw = (key, label) => textField(label, () => save[key], (v) => { save[key] = v; }, { type: 'password', key: `backup-${key}` });
    async function doSave() {
      if (save.secrets && save.pw.length < 4) return toast(B('passwordShort'));
      if (save.secrets && save.pw !== save.pw2) return toast(B('passwordDiff'));
      try {
        const r = await window.e4.backupSave({ users: save.users, password: save.secrets ? save.pw : '' });
        if (!r) return;
        toast(B('saved', { file: r.file }));
        mode = null;
        Object.assign(save, { pw: '', pw2: '' });
        draw();
      } catch (err) { fail(err); }
    }
    async function pick(name) {
      try {
        const r = name ? { file: name, name, preview: await window.e4.backupPreview(name) } : await window.e4.backupPick();
        if (!r) return;
        mode = Object.assign(r, { users: r.preview.users !== null, pw: '' });
        draw();
      } catch (err) { fail(err); }
    }
    async function doRestore(btn) {
      btn.disabled = true;
      btn.textContent = B('restoring');
      try {
        await window.e4.backupRestore(mode.file, { users: mode.users, password: mode.pw });
        box.replaceChildren(h('div', { class: 'result ok', attrs: { 'data-test': 'backup-restored' } }, icon('ok'), h('div', { text: B('restored') })));
      } catch (err) { fail(err); btn.disabled = false; btn.textContent = B('restoreGo'); }
    }
    // Neues, leeres Projekt (Ralf 06.11.2026): vorher automatisch gesichert, danach Neustart
    async function doNew(btn) {
      btn.disabled = true;
      btn.textContent = B('newBusy');
      try {
        await window.e4.newProject({ keepDesign, keepUsers });
        try { localStorage.removeItem('easy4visu.firstStepsHidden'); } catch (e) { /* egal */ }
        rememberView('devices'); // nach der Anmeldung geht es wie bei einer Neuinstallation bei „Geräte“ los
        box.replaceChildren(h('div', { class: 'result ok', attrs: { 'data-test': 'project-new-done' } }, icon('ok'), h('div', { text: B('newDone') })));
      } catch (err) { fail(err); btn.disabled = false; btn.textContent = B('newGo'); }
    }
    function newForm() {
      return h('div', { class: 'optitem backupbox', attrs: { 'data-test': 'project-new-form' } },
        h('div', { class: 'label', text: B('newTitle') }),
        h('div', { class: 'small', text: B('newIntro') }),
        checkField(B('newUsers'), keepUsers, (on) => { keepUsers = on; }, 'project-new-users'),
        h('div', { class: 'muted small', text: B('newUsersHint') }),
        checkField(B('newKeep'), keepDesign, (on) => { keepDesign = on; }, 'project-new-keep'),
        h('div', { class: 'muted small', text: B('newKeepHint') }),
        h('div', { class: 'result warn' }, icon('warn'), h('div', { text: B('newWarn') })),
        h('div', { class: 'inline' },
          h('button', { class: 'btn danger', attrs: { 'data-test': 'project-new-go' }, on: { click: (e) => doNew(e.currentTarget) } }, B('newGo')),
          h('button', { class: 'btn', on: { click: () => { mode = null; draw(); } } }, T('ui.common.cancel'))));
    }
    function preview() {
      const p = mode.preview;
      const line = (label, text) => h('div', { class: 'small' }, h('span', { class: 'muted', text: `${label}: ` }), text);
      return h('div', { class: 'optitem backupbox', attrs: { 'data-test': 'backup-preview' } },
        h('div', { class: 'label', text: B('previewTitle') }),
        h('div', { class: 'small', text: p.auto ? B('madeAuto', { date: when(Date.parse(p.created)) }) : B('made', { date: when(Date.parse(p.created)), app: p.app || '?' }) }),
        line(B('devices'), p.devices.length ? p.devices.map((d) => `${d.name} (${d.variables})`).join(', ') : B('none')),
        line(B('pages'), String(p.pages)), line(B('images'), String(p.images)),
        line(B('users'), p.users === null ? B('none') : String(p.users)),
        p.users !== null ? h('div', {}, checkField(B('takeUsers'), mode.users, (on) => { mode.users = on; }, 'backup-take-users'),
          h('div', { class: 'muted small', text: B('takeUsersHint') })) : null,
        p.secrets ? h('div', {}, h('div', { class: 'muted small', text: B('secretsIn') }),
          textField(B('password'), () => mode.pw, (v) => { mode.pw = v; }, { type: 'password', key: 'backup-restore-pw' }))
          : h('div', { class: 'muted small', text: B(p.pcSecrets ? 'pcSecrets' : 'noSecrets') }),
        h('div', { class: 'result warn' }, icon('warn'), h('div', { text: B('warn') })),
        h('div', { class: 'inline' },
          h('button', { class: 'btn danger', attrs: { 'data-test': 'backup-restore-go' }, on: { click: (e) => doRestore(e.currentTarget) } }, B('restoreGo')),
          h('button', { class: 'btn', on: { click: () => { mode = null; draw(); } } }, T('ui.common.cancel'))));
    }
    function saveForm() {
      return h('div', { class: 'optitem backupbox', attrs: { 'data-test': 'backup-save-form' } },
        checkField(B('saveUsers'), save.users, (on) => { save.users = on; }, 'backup-users'),
        h('div', { class: 'muted small', text: B('saveUsersHint') }),
        checkField(B('saveSecrets'), save.secrets, (on) => { save.secrets = on; draw(); }, 'backup-secrets'),
        h('div', { class: 'muted small', text: B('saveSecretsHint') }),
        save.secrets ? h('div', { class: 'row2' }, pw('pw', B('password')), pw('pw2', B('password2'))) : null,
        h('div', { class: 'inline' },
          h('button', { class: 'btn primary', attrs: { 'data-test': 'backup-save-go' }, on: { click: doSave } }, B('saveGo')),
          h('button', { class: 'btn', on: { click: () => { mode = null; draw(); } } }, T('ui.common.cancel'))));
    }
    function draw() {
      box.replaceChildren(...[
        h('div', { class: 'inline' },
          h('button', { class: 'btn', attrs: { 'data-test': 'backup-save' }, on: { click: () => { mode = 'save'; draw(); } } }, B('save')),
          h('button', { class: 'btn', attrs: { 'data-test': 'backup-pick' }, on: { click: () => pick() } }, B('restore')),
          h('button', { class: 'btn', attrs: { 'data-test': 'project-new' }, on: { click: () => { mode = 'new'; keepDesign = true; keepUsers = true; draw(); } } }, B('newProject'))),
        mode === 'save' ? saveForm() : mode === 'new' ? newForm() : mode ? preview() : null,
        h('div', { class: 'optitem' }, checkField(B('auto'), st.auto, async (on) => {
          try { st = await window.e4.setBackupOptions({ auto: on }); } catch (err) { fail(err); } draw();
        }, 'backup-auto'), h('div', { class: 'muted small', text: B('autoHint') })),
        h('div', { class: 'optitem', attrs: { 'data-test': 'backup-list' } }, h('div', { class: 'label', text: B('list') }),
          st.list.length ? h('ul', { class: 'backuplist' }, ...st.list.map((x) => h('li', { class: 'small' },
            h('span', { text: `${when(x.time)} · ${B(x.kind !== 'before' ? 'kindAuto' : x.name.startsWith('vor-neuem-projekt') ? 'kindBeforeNew' : 'kindBefore')}` }),
            h('button', { class: 'btn small', attrs: { 'data-test': `backup-use-${x.name}` }, on: { click: () => pick(x.name) } }, B('use')))))
            : h('div', { class: 'muted small', text: B('listNone') }),
          h('button', { class: 'btn small', attrs: { 'data-test': 'backup-folder' }, on: { click: () => window.e4.backupFolder().then(reload, fail) } }, B('folder'))),
      ].filter(Boolean));
    }
    draw();
    return box;
  }
  if (!WEB && window.e4.onWeb) window.e4.onWeb((s) => { if (webDraw) webDraw(s); });
  // neuer Eintrag im Bedienprotokoll (auch vom Handy): offene Liste nachladen, höchstens einmal pro Sekunde
  let auditTimer = null;
  if (!WEB && window.e4.onAudit) window.e4.onAudit(() => {
    if (state.view !== 'audit' || auditTimer) return;
    auditTimer = setTimeout(async () => {
      auditTimer = null;
      if (state.view !== 'audit') return;
      try { state.auditRows = await window.e4.auditQuery(Object.assign({ limit: 1000 }, auditFilter())); } catch (err) { return; }
      if (state.view === 'audit') render();
    }, 1000);
  });

  // ------------------------------------------------------------------ Verbinden / Trennen
  /**
   * Ampel aus mehreren Teilen: grün = alle, gelb = ein Teil, rot = keiner, grau = noch unklar.
   * ok(x) -> true / false / null (unklar)
   */
  function lampOf(list, ok) {
    const r = list.map(ok);
    const yes = r.filter((x) => x === true).length;
    const no = r.filter((x) => x === false).length;
    if (yes === r.length) return 'ok';
    if (no === 0) return 'wait';
    return yes === 0 && no === r.length ? 'bad' : 'part';
  }
  /** oben rechts: „nicht verbunden“, nach dem Verbinden zwei Lämpchen ohne Text – MQTT (Broker) und easyE4 */
  function onlineControl() {
    const O = (k, a) => T(`ui.online.${k}`, a);
    const devs = state.devices.filter((d) => d.enabled !== false);
    // ohne (eingeschaltetes) Gerät gibt es nichts zu verbinden: graue Anzeige, kein Knopf (Ralf 08.11.2026)
    if (!devs.length) {
      return h('div', { class: 'onlinebox st-off' }, h('span', { class: 'onlinepill st-none', attrs: { 'data-test': 'online-none', title: O(state.devices.length ? 'noneActive' : 'easye4.none') } },
        h('span', { class: 'dot' }), O(state.devices.length ? 'noneActiveShort' : 'noneShort')));
    }
    const lamps = [];
    if (state.online) {
      const mq = devs.filter((d) => d.protocol === 'mqtt');
      if (mq.length) {
        const st = lampOf(mq, (d) => (d.broker === undefined ? null : d.broker));
        lamps.push(h('span', { class: `onlinepill st-${st}`, attrs: { 'data-test': 'online-mqtt', title: O(`mqtt.${st}`) } }, h('span', { class: 'dot' }), 'MQTT'));
      }
      // ohne Gerät grau statt grün – es ist ja nichts verbunden (Ralf 08.11.2026)
      const st = devs.length ? lampOf(devs, (d) => (d.state === 'online' ? true : d.state === 'offline' || d.state === 'auth' ? false : null)) : 'none';
      const reach = devs.filter((d) => d.state === 'online').length;
      lamps.push(h('span', { class: `onlinepill st-${st}`, attrs: { 'data-test': 'online-easye4', title: O(`easye4.${st}`, { n: reach, m: devs.length }) } },
        h('span', { class: 'dot' }), 'easyE4'));
    }
    return h('div', { class: `onlinebox${state.online ? ' on' : ' st-off'}` },
      state.online ? lamps : h('span', { class: 'onlinestate', attrs: { 'data-test': 'online-state' } }, h('span', { class: 'dot' }), O('off')),
      // im Browser: verbinden/trennen nur am PC
      WEB ? null : h('button', { class: `btn small${state.online ? '' : ' primary'}`, attrs: { 'data-test': 'online', title: O(state.online ? 'disconnectHint' : 'connectHint') },
        on: { click: () => setOnline(!state.online) } }, O(state.online ? 'disconnect' : 'connect')));
  }
  // „Verbunden – Bedienseiten wirken jetzt auf die Steuerung“ erst, wenn alles grün ist
  let announce = false;
  const allGreen = () => state.devices.filter((d) => d.enabled !== false)
    .every((d) => d.state === 'online' && (d.protocol !== 'mqtt' || d.broker === true));
  function announceIfReady() {
    if (!announce || !state.online || !state.devices.some((d) => d.enabled !== false) || !allGreen()) return;
    announce = false;
    toast(T('ui.online.connected'));
  }
  async function setOnline(on) {
    if (setOnline.busy) return; // Doppelklick: erst den laufenden Wechsel abwarten
    setOnline.busy = true;
    try {
      announce = on;
      await window.e4.setOnline(on);
      state.online = on;
      if (!on) toast(T('ui.online.disconnected'));
      else announceIfReady();
    } finally {
      setOnline.busy = false;
    }
  }
  /** Rückmeldung vom Programm (auch nach Klick in einem anderen Fenster) */
  async function onOnline(on) {
    state.online = on;
    if (!on) state.values = {};
    if (state.view === 'pages') return showPages();
    if (state.view === 'detail' && state.detail) return showDetail(state.detail.id);
    await refreshDevices();
    render();
  }

  // ------------------------------------------------------------------ Rahmen
  let lastView = null;
  // Menüleiste links ein-/ausklappen (wird gemerkt)
  let navCollapsed = (() => { try { return localStorage.getItem('easy4visu.navCollapsed') === '1'; } catch (e) { return false; } })();
  function toggleNav() {
    navCollapsed = !navCollapsed;
    try { localStorage.setItem('easy4visu.navCollapsed', navCollapsed ? '1' : '0'); } catch (e) { /* gilt bis zum Neustart */ }
    render();
  }
  /** Wortmarke „easy“ + grüne Kachel mit drei Strichen und „4“ (wie das Programmsymbol, Ralf 08.11.2026) + „Visu“ */
  const STRIPES = '<svg viewBox="0 0 10 16" width="8" height="13" aria-hidden="true"><path d="M1.5 2.5 H8.5 M1.5 8 H7.5 M1.5 13.5 H8.5" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>';
  const wordmark = () => h('span', { class: 'wordmark', attrs: { role: 'img', 'aria-label': T('ui.app.title') } },
    h('span', { text: 'easy', attrs: { 'aria-hidden': 'true' } }),
    h('span', { class: 'four', attrs: { 'aria-hidden': 'true' } }, h('span', { class: 'stripes', html: STRIPES }), '4'),
    h('span', { text: 'Visu', attrs: { 'aria-hidden': 'true' } }));

  function render() {
    const root = document.getElementById('app');
    if (state.view === 'weblogin') { root.replaceChildren(webLoginView()); return; }
    const pref = readTheme();
    const themeSeg = h('div', { class: 'seg', attrs: { role: 'group', 'aria-label': T('ui.app.themeToggle') } },
      ...[['light', 'themeLight'], ['dark', 'themeDark'], ['auto', 'themeAuto']].map(([v, k]) =>
        h('button', { class: pref === v ? 'on' : '', text: T(`ui.app.${k}`), attrs: { 'aria-pressed': String(pref === v) }, on: { click: () => setTheme(v) } })));
    themeSeg.style.width = '330px';
    const topbar = h('header', { class: 'topbar' },
      h('div', { class: 'brand' },
        wordmark()),
      h('div', { class: 'spacer' }),
      authChip(),
      onlineControl(),
      themeSeg,
      WEB ? null : h('button', { class: 'iconbtn helpbtn', text: '?', attrs: { 'data-test': 'help', title: T('ui.app.help'), 'aria-label': T('ui.app.help') },
        on: { click: () => window.e4.openHelp().catch((err) => toast(err.message)) } }),
      state.view === 'pages' && canFullscreen() ? h('button', { class: 'btn small', attrs: { 'data-test': 'fullscreen', title: T('ui.operate.fullscreenKey') },
        on: { click: () => toggleFullscreen() } }, T(state.fullscreen ? 'ui.operate.fullscreenOff' : 'ui.operate.fullscreen')) : null,
      state.view === 'pages' && !WEB ? h('button', { class: 'btn small primary', attrs: { 'data-test': 'exit-operate', title: T('ui.operate.exitKey') },
        on: { click: () => exitOperate() } }, T('ui.operate.exit')) : null);
    const navLabel = (key) => h('span', { class: 'navlabel', text: T(key) });
    // Arbeitsschritte mit Nummer (Reihenfolge, in der man ein Projekt baut), darunter abgesetzt die Verwaltung
    const step = (n) => h('span', { class: 'navnum', text: String(n), attrs: { 'aria-hidden': 'true' } });
    const nav = h('nav', { class: 'sidenav', attrs: { 'aria-label': 'Hauptnavigation' } },
      h('button', { class: 'navtoggle', attrs: { 'data-test': 'nav-toggle', 'aria-label': T(navCollapsed ? 'ui.nav.expand' : 'ui.nav.collapse'), title: T(navCollapsed ? 'ui.nav.expand' : 'ui.nav.collapse') },
        on: { click: () => toggleNav() } }, navCollapsed ? '»' : '«'),
      h('button', { class: `navitem ${state.view === 'devices' ? 'active' : ''}`, attrs: { 'data-test': 'nav-devices', hidden: !isSetup() }, on: { click: () => showDevices() } },
        step(1), icon('devices'), navLabel('ui.nav.devices')),
      h('button', { class: `navitem ${state.view === 'detail' ? 'active' : ''}`, attrs: { 'data-test': 'nav-variables', hidden: !isSetup() }, on: { click: () => showDetail() } },
        step(2), icon('list'), navLabel('ui.nav.variables')),
      h('button', { class: `navitem ${state.view === 'editor' ? 'active' : ''}`, attrs: { 'data-test': 'nav-editor', hidden: !isSetup() }, on: { click: () => showEditor() } },
        step(3), icon('editor'), navLabel('ui.nav.editor')),
      h('button', { class: `navitem ${state.view === 'pages' ? 'active' : ''}`, attrs: { 'data-test': 'nav-pages' }, on: { click: () => showPages() } },
        isSetup() ? step(4) : null, icon('pages'), navLabel('ui.nav.pages')),
      h('button', { class: `navitem ${state.view === 'alarms' ? 'active' : ''}`, attrs: { 'data-test': 'nav-alarms', hidden: !isSetup() }, on: { click: () => showAlarms() } },
        step(5), icon('bell'), navLabel('ui.nav.alarms'), alarmBadge()),
      h('div', { class: 'navsec', text: T('ui.nav.admin'), attrs: { hidden: !isSetup() } }),
      // Verwaltung: einrichten → im Betrieb nachsehen → sichern (Ralf 03.11.2026)
      h('button', { class: `navitem ${state.view === 'users' ? 'active' : ''}`, attrs: { 'data-test': 'nav-users', hidden: !isSetup() }, on: { click: () => showUsers() } }, icon('user'), navLabel('ui.nav.users')),
      h('button', { class: `navitem ${state.view === 'texts' ? 'active' : ''}`, attrs: { 'data-test': 'nav-texts', hidden: !isSetup() }, on: { click: () => showTexts() } }, icon('globe'), navLabel('ui.nav.texts')),
      h('button', { class: `navitem ${state.view === 'web' ? 'active' : ''}`, attrs: { 'data-test': 'nav-web', hidden: WEB || !isSetup() }, on: { click: () => showWeb() } }, icon('phone'), navLabel('ui.nav.web')),
      h('button', { class: `navitem ${state.view === 'records' ? 'active' : ''}`, attrs: { 'data-test': 'nav-records', hidden: WEB || !isSetup() }, on: { click: () => showRecords() } }, icon('chart'), navLabel('ui.nav.records')),
      authOn() ? h('button', { class: `navitem ${state.view === 'audit' ? 'active' : ''}`, attrs: { 'data-test': 'nav-audit', hidden: !isSetup() }, on: { click: () => showAudit() } }, icon('log'), navLabel('ui.nav.audit')) : null,
      h('button', { class: `navitem ${state.view === 'project' ? 'active' : ''}`, attrs: { 'data-test': 'nav-project', hidden: WEB || !isSetup() }, on: { click: () => showProject() } }, icon('archive'), navLabel('ui.nav.project')),
      h('button', { class: 'navitem', attrs: { 'data-test': 'nav-options', hidden: !isSetup() }, on: { click: () => openOptions() } }, icon('gear'), navLabel('ui.nav.options')));
    // Bildlauf merken, wenn dieselbe Ansicht neu gezeichnet wird
    const keep = {};
    if (state.view === lastView) {
      document.querySelectorAll('[data-keep-scroll]').forEach((n) => { keep[n.dataset.keepScroll] = n.scrollTop; });
      const m = document.getElementById('main');
      if (m) keep.main = m.scrollTop;
    }
    lastView = state.view;
    if (SETUP_VIEWS[state.view]) rememberView(state.view);
    const view = state.view === 'detail' ? detailView() : state.view === 'pages' ? pagesView() : state.view === 'editor' ? editorView()
      : state.view === 'design' ? designView() : state.view === 'alarms' ? alarmsView() : state.view === 'users' ? usersView()
        : state.view === 'audit' ? auditView() : state.view === 'texts' ? textsView() : state.view === 'records' ? recordsView() : state.view === 'project' ? projectView() : state.view === 'web' ? webView() : state.view === 'emergency' ? h('div', {}, h('div', { class: 'pagehead' }, h('h1', { text: AU('emergencyTitle') })),
          emergencyBox(((state.auth && state.auth.users) || [])))
          : devicesView();
    const main = h('main', { class: `content${state.view === 'editor' ? ' editing' : ''}`, attrs: { id: 'main' } }, view);
    // eigenes Farbthema: Bedienseiten ganz, im Editor nur die Seite
    if (state.view === 'pages') themeNode(main);
    const canvas = main.querySelector('#edcanvas');
    if (canvas) { themeNode(canvas); setTimeout(fitNewItems, 30); }
    for (const b of nav.querySelectorAll('.navitem')) b.title = b.textContent; // eingeklappt: Name als Hinweis
    const barsMode = state.view === 'pages' && state.page && state.barsMode;
    // im Browser: Verbindung zum PC weg → Seite grau und gesperrt, roter Streifen unten
    const lost = WEB && state.webLost ? h('div', { class: 'weblost', attrs: { role: 'alert', 'data-test': 'web-lost' } }, icon('err'), h('span', { text: T('ui.web.lost') })) : null;
    root.replaceChildren(h('div', { class: `shell${state.view === 'pages' ? ' operate' : ''}${barsMode ? ' barsmode' : ''}${navCollapsed ? ' navmini' : ''}${WEB ? ' webshell' : ''}${lost ? ' lost' : ''}` },
      topbar, WEB ? null : nav, main, lost));
    for (const [k, top] of Object.entries(keep)) {
      const n = k === 'main' ? main : document.querySelector(`[data-keep-scroll="${k}"]`);
      if (!n) continue;
      // die Seite wird erst danach eingepasst (Zoom) – vorher ist sie evtl. zu kurz und der Bildlauf springt nach oben
      n.scrollTop = top;
      queueMicrotask(() => { n.scrollTop = top; });
      requestAnimationFrame(() => { if (Math.abs(n.scrollTop - top) > 1) n.scrollTop = top; });
    }
  }

  // ------------------------------------------------------------------ Geräteliste
  function stateChip(d) {
    return h('span', { class: `chip ${d.state}`, attrs: { 'data-state-of': d.id } }, h('span', { class: 'dot' }), d.stateText);
  }

  /**
   * „Erste Schritte“: nur solange ein Projekt noch nicht fertig eingerichtet ist (Gerät, Variablen, eine Seite mit Inhalt);
   * „Ausblenden“ blendet sie für dieses Projekt aus („Neues Projekt“ zeigt sie wieder). Schritt 4 „Benutzer anlegen“
   * ist freiwillig und hält die Schritte nicht offen (Ralf 07.11.2026).
   */
  function firstStepsHidden() { try { return localStorage.getItem('easy4visu.firstStepsHidden') === '1'; } catch (e) { return false; } }
  function firstSteps() {
    const F2 = (k, a) => T(`ui.first.${k}`, a);
    const withVars = state.devices.find((d) => d.variableCount);
    const done = [state.devices.length > 0, !!withVars, !!state.hasPage, authOn()];
    if (done.slice(0, 3).every(Boolean) || firstStepsHidden()) return null;
    const steps = [
      { k: 'device', go: () => openDeviceEditor(null) },
      { k: 'vars', go: () => showDetail((state.devices[0] || {}).id) },
      { k: 'page', go: () => showEditor() },
      { k: 'users', go: () => showUsers(), optional: true },
    ];
    const next = done.indexOf(false);
    const hide = () => { try { localStorage.setItem('easy4visu.firstStepsHidden', '1'); } catch (e) { /* nur bis zum Neustart */ } render(); };
    return h('section', { class: 'card firststeps', attrs: { 'data-test': 'first-steps' } },
      h('div', { class: 'firsthead' }, h('h2', { text: F2('title') }),
        h('button', { class: 'btn small', attrs: { 'data-test': 'first-hide' }, on: { click: hide } }, F2('hide'))),
      h('div', { class: 'stepsrow' }, ...steps.map((st, i) => h('button', {
        class: `firststep${done[i] ? ' done' : ''}${i === next ? ' next' : ''}`,
        attrs: { 'data-test': `first-${st.k}`, disabled: !st.optional && !done[i] && i !== next && !(i === 1 && state.devices.length) },
        on: { click: st.go } },
      h('span', { class: 'stepmark', text: done[i] ? '✓' : String(i + 1), attrs: { 'aria-hidden': 'true' } }),
      h('span', {}, h('span', { class: 'steptitle', text: F2(st.k) }), h('span', { class: 'stephint', text: F2(`${st.k}Hint`) }))))));
  }

  function devicesView() {
    const head = h('div', { class: 'pagehead' },
      h('div', { class: 'grow' }, h('h1', { text: T('ui.devices.title') }), h('div', { class: 'muted', text: T('ui.devices.intro') })),
      h('button', { class: 'btn primary', attrs: { 'data-test': 'add-device' }, on: { click: () => openDeviceEditor(null) } }, icon('plus'), T('ui.devices.add')));
    if (!state.devices.length) {
      return h('div', {}, head, firstSteps(), h('div', { class: 'card empty' }, icon('box'),
        h('h2', { text: T('ui.devices.empty') }), h('div', { class: 'muted', text: T('ui.devices.emptyHint') }),
        h('button', { class: 'btn primary', on: { click: () => openDeviceEditor(null) } }, icon('plus'), T('ui.devices.add'))),
        WEB || state.demo ? null : h('div', { class: 'card demotry', attrs: { 'data-test': 'demo-try' } },
          h('div', { class: 'grow' }, h('h2', { text: T('ui.demo.muster') }), h('div', { class: 'muted', text: T('ui.demo.musterHint') })),
          h('button', { class: 'btn', attrs: { 'data-test': 'demo-try-start' }, on: { click: () => startTalwerkDemo() } }, T('ui.demo.musterStart'))));
    }
    const cards = state.devices.map((d) => h('article', { class: 'card devcard', attrs: { 'data-device': d.id } },
      h('div', { class: 'row' }, h('div', { class: 'title', text: d.name }), stateChip(d)),
      h('div', { class: 'meta' },
        h('span', { text: protocolName(d.protocol) }),
        h('span', { class: 'mono', text: address(d) }),
        h('span', { text: d.variableCount ? T('ui.devices.variables', { n: d.variableCount }) : T('ui.devices.noVariables') })),
      h('div', { class: 'actions' },
        h('button', { class: 'btn', on: { click: () => openDeviceEditor(d) } }, T('ui.common.edit')),
        h('button', { class: 'btn primary', attrs: { 'data-test': 'open-device' }, on: { click: () => showDetail(d.id) } }, T('ui.devices.open')))));
    return h('div', {}, head, firstSteps(), h('div', { class: 'grid-cards' }, cards));
  }

  /** Reiter zur Geräteauswahl (nur bei mehr als einem Gerät) */
  function deviceTabs(currentId, pick) {
    if (state.devices.length < 2) return null;
    return h('div', { class: 'seg tabs', attrs: { role: 'tablist', 'aria-label': T('ui.nav.devices') } },
      ...state.devices.map((d) => h('button', { class: d.id === currentId ? 'on' : '', text: d.name,
        attrs: { role: 'tab', 'aria-selected': String(d.id === currentId), 'data-tab-of': d.id }, on: { click: () => pick(d.id) } })));
  }

  async function refreshDevices() {
    state.devices = await window.e4.listDevices();
  }
  async function showDevices() {
    if (needSetupView(() => showDevices())) return;
    await flushEditorSave();
    state.view = 'devices';
    state.detail = null;
    await refreshDevices();
    try { state.hasPage = (await window.e4.listPages()).some((p) => (p.items || []).length); } catch (e) { state.hasPage = false; }
    render();
  }

  // ------------------------------------------------------------------ Gerät: Variablen und Werte
  // ohne id: zuletzt gezeigtes Gerät bzw. das erste
  async function showDetail(id) {
    if (needSetupView(() => showDetail(id))) return;
    await flushEditorSave();
    await refreshDevices();
    const known = (x) => x && state.devices.some((d) => d.id === x);
    id = known(id) ? id : known(state.lastDeviceId) ? state.lastDeviceId : (state.devices[0] && state.devices[0].id);
    state.view = 'detail';
    if (!id) { state.detail = null; render(); return; }
    if (!state.detail || state.detail.id !== id) state.selected = new Set();
    state.lastDeviceId = id;
    state.detail = await window.e4.getDevice(id);
    state.values[id] = await window.e4.deviceValues(id);
    render();
  }

  function formatValue(v, entry) {
    if (entry && entry.quality === 'bad') return { text: entry.error || T('ui.detail.bad'), cls: 'bad' };
    if (!entry || entry.value === null || entry.value === undefined) return { text: T('ui.detail.noValue'), cls: 'stale' };
    const val = entry.value;
    let text;
    let cls = '';
    if (typeof val === 'object') {
      const p = (n) => String(n).padStart(2, '0');
      text = val.year !== undefined ? `${p(val.day)}.${p(val.month)}.${val.year} ${p(val.hour)}:${p(val.minute)}:${p(val.second)}` : JSON.stringify(val);
    } else if (v.type === 'BIT') {
      text = val ? 'EIN' : 'AUS';
      cls = val ? 'state-on' : 'state-off';
    } else if (typeof val === 'number') {
      // ohne Tausenderpunkt: „1320“ statt „1.320“ (bei Steuerungswerten leicht mit einem Komma zu verwechseln)
      // eingestellte Nachkommastellen der Variablen gelten auch hier
      const d = v.userDecimals;
      text = val.toLocaleString('de-DE', d === undefined ? { maximumFractionDigits: 3, useGrouping: false } : { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: false });
    } else text = String(val);
    if (entry.quality === 'stale') cls += ' stale';
    return { text, cls };
  }

  function valueCell(v) {
    const d = state.detail;
    const key = v.id || v.name;
    const entry = (state.values[d.id] || {})[key];
    const f = formatValue(v, entry);
    return h('td', { class: `value ${f.cls}`, text: f.text, attrs: { 'data-value-of': key, title: entry && entry.error ? entry.error : null } });
  }

  // Bemerkung ohne „lesen“/„schreiben“ am Anfang – das steckt schon im Vorschlag
  function noteOf(v) {
    const c = v.comment ? v.comment.replace(/^\s*(schreiben\/lesen|schreiben|lesen|nur intern|intern)\b\s*/i, '') : '';
    return [v.hint, c].filter(Boolean).join('  ');
  }

  function addressText(v) {
    const m = v.modbus;
    if (!m) return '–';
    if (m.register !== undefined) return `R${m.register}${m.bit !== undefined ? `.${m.bit}` : ''}`;
    return `${m.area === 'coil' ? 'Coil' : 'DI'} ${m.address}`;
  }

  function detailView() {
    const d = state.detail;
    if (!d) {
      return h('div', {}, h('div', { class: 'pagehead' }, h('div', { class: 'grow' }, h('h1', { text: T('ui.nav.variables') }))),
        h('div', { class: 'card empty' }, h('h2', { text: T('ui.detail.noDevice') }),
          h('button', { class: 'btn primary', on: { click: () => showDevices() } }, T('ui.detail.toDevices'))));
    }
    const tabs = deviceTabs(d.id, (id) => showDetail(id));
    const vars = state.filterNamed ? d.variables.filter(hasRealName) : d.variables;
    const head = h('div', { class: 'pagehead' },
      h('div', { class: 'grow' },
        h('h1', { text: tabs ? T('ui.nav.variables') : `${T('ui.nav.variables')} – ${d.name}` }),
        h('div', { class: 'muted small' }, `${protocolName(d.protocol)} · `, h('span', { class: 'mono', text: address(d) }), ' · ',
          d.variables.length ? T('ui.devices.variables', { n: d.variables.length }) : T('ui.devices.noVariables'))),
      stateChip(d),
      h('button', { class: 'btn', attrs: { 'data-test': 'add-var' }, on: { click: () => openVarEditor(null) } }, icon('plus'), T('ui.detail.addVar')),
      options.quickAssign && d.variables.length ? h('button', { class: 'btn', attrs: { 'data-test': 'assign' }, on: { click: () => openAssign(d) } }, T('ui.assign.button')) : null,
      h('button', { class: 'btn primary', attrs: { 'data-test': 'import' }, on: { click: () => startImport() } }, T('ui.detail.importBtn')));
    if (!d.variables.length) {
      return h('div', {}, tabs, head, h('div', { class: 'card empty' }, h('h2', { text: T('ui.detail.empty') }),
        h('div', { class: 'muted', text: T('ui.detail.importHint') }),
        h('div', { class: 'inline' },
          h('button', { class: 'btn primary', on: { click: () => startImport() } }, T('ui.detail.importBtn')),
          h('button', { class: 'btn', on: { click: () => openVarEditor(null) } }, icon('plus'), T('ui.detail.addVar')))));
    }
    const filter = h('div', { class: 'seg' },
      h('button', { class: state.filterNamed ? '' : 'on', text: T('ui.detail.filterAll'), on: { click: () => { state.filterNamed = false; render(); } } }),
      h('button', { class: state.filterNamed ? 'on' : '', text: T('ui.detail.filterNamed'), on: { click: () => { state.filterNamed = true; render(); } } }));
    filter.style.width = '240px';
    // Suche: blendet nur Zeilen aus (Liste wird nicht neu gebaut, Eingabe behält den Fokus)
    const query = () => (state.varSearch || '').trim().toLowerCase();
    const matches = (v) => !query() || [v.userLabel, v.label, v.name, `${v.operand}${v.index}`, noteOf(v)]
      .some((x) => x && String(x).toLowerCase().includes(query()));
    const shownVars = () => vars.filter(matches);
    const noHit = h('div', { class: 'muted small', attrs: { 'data-test': 'var-nohit', hidden: !!shownVars().length }, text: T('ui.detail.noHit') });
    const search = h('input', { class: 'input narrow', value: state.varSearch || '',
      attrs: { type: 'search', placeholder: T('ui.detail.search'), 'aria-label': T('ui.detail.search'), 'data-test': 'var-list-search' },
      on: { input: (ev) => {
        state.varSearch = ev.target.value;
        for (const tr of document.querySelectorAll('[data-var-row]')) tr.hidden = !matches(vars.find((v) => v.name === tr.dataset.varRow));
        noHit.hidden = !!shownVars().length;
        syncSelection();
      } } });
    search.style.width = '300px';
    // Auswahl: nur noch vorhandene Namen behalten
    const names = new Set(d.variables.map((v) => v.name));
    for (const n of [...state.selected]) if (!names.has(n)) state.selected.delete(n);
    const selInfo = h('span', { class: 'small muted', attrs: { 'data-test': 'sel-info' } });
    const delBtn = h('button', { class: 'btn small danger', attrs: { 'data-test': 'delete-selected' }, on: { click: () => deleteSelected() } }, T('ui.detail.deleteSelected'));
    const clearBtn = h('button', { class: 'btn small link', on: { click: () => { state.selected.clear(); syncSelection(); } } }, T('ui.detail.selectNone'));
    const allBox = h('input', { attrs: { type: 'checkbox', 'data-test': 'select-all', 'aria-label': T('ui.detail.selectAll') },
      on: { change: (e) => { for (const v of shownVars()) { if (e.target.checked) state.selected.add(v.name); else state.selected.delete(v.name); } syncSelection(); } } });
    // Häkchen, Zähler und Knopf nachführen, ohne die Liste neu aufzubauen (Bildlauf bleibt stehen)
    function syncSelection() {
      const n = state.selected.size;
      selInfo.textContent = n ? T('ui.detail.selected', { n }) : T('ui.detail.selectHint');
      delBtn.disabled = !n;
      clearBtn.hidden = !n;
      const visible = shownVars();
      const shown = visible.filter((v) => state.selected.has(v.name)).length;
      allBox.checked = shown > 0 && shown === visible.length;
      allBox.indeterminate = shown > 0 && shown < visible.length;
      for (const cb of document.querySelectorAll('[data-select-of]')) cb.checked = state.selected.has(cb.dataset.selectOf);
    }
    const toolbar = h('div', { class: 'inline listbar' }, search, filter, h('span', { class: 'spacer' }), selInfo, clearBtn, delBtn);
    // Klick auf die Zeile (oder Enter) öffnet das Fenster der Variablen; Häkchen in der Zeile nicht
    const rows = vars.map((v) => h('tr', { class: 'clickrow', attrs: { tabindex: '0', title: T('ui.detail.rowHint'), 'data-var-row': v.name, hidden: !matches(v) },
      on: { click: (e) => { if (!e.target.closest('input')) openVarEditor(v); }, keydown: (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) openVarEditor(v); } } },
      h('td', { class: 'pick' }, h('input', { attrs: { type: 'checkbox', 'data-select-of': v.name, 'aria-label': v.userLabel || v.label },
        checked: state.selected.has(v.name),
        on: { change: (e) => { if (e.target.checked) state.selected.add(v.name); else state.selected.delete(v.name); syncSelection(); } } })),
      h('td', {}, h('div', {}, v.userLabel || v.label, v.sources && v.sources.includes('manual') ? h('span', { class: 'badge', text: T('ui.detail.manual') }) : null),
        noteOf(v) ? h('div', { class: 'muted small', text: noteOf(v) }) : null),
      h('td', { class: 'mono small', text: v.name }),
      h('td', { class: 'mono small', text: `${v.operand}${v.operand === 'CLOCK' ? '.' : ''}${v.index}`, attrs: { title: `${T('ui.varDlg.address')}: ${addressText(v)}` } }),
      valueCell(v),
      h('td', { class: 'pick' }, h('input', { attrs: { type: 'checkbox', 'data-record-of': v.name, title: T('ui.detail.recordHint'), 'aria-label': `${T('ui.detail.colRecord')}: ${v.userLabel || v.label}` },
        checked: !!v.userRecord,
        on: { change: async (e) => {
          const on = e.target.checked;
          try { await window.e4.setRecord(d.id, v.name, on); if (on) v.userRecord = true; else delete v.userRecord; } catch (err) { e.target.checked = !on; toast(err.message); }
        } } }))));
    // feste Spaltenbreiten: alle Geräte sehen gleich aus, egal wie lang die Namen sind
    const cols = h('colgroup', {}, ...['pick', 'label', 'name', 'op', 'value', 'rec'].map((k) => h('col', { class: `c-${k}` })));
    const table = h('div', { class: 'tablewrap' }, h('table', { class: 'list vartable' }, cols,
      h('thead', {}, h('tr', {}, h('th', { class: 'pick' }, allBox), ...['colLabel', 'colName', 'colOperand', 'colValue', 'colRecord'].map((k) => h('th', { text: T(`ui.detail.${k}`) })))),
      h('tbody', {}, rows)));
    const view = h('div', {}, tabs, head, toolbar, table, noHit);
    queueMicrotask(syncSelection);
    return view;
  }

  async function deleteSelected() {
    const names = [...state.selected];
    if (!names.length) return;
    const d = state.detail;
    const text = names.length === 1
      ? T('ui.varDlg.deleteConfirm', { name: (d.variables.find((v) => v.name === names[0]) || {}).label || names[0] })
      : T('ui.detail.deleteSelectedConfirm', { n: names.length });
    if (!window.confirm(text)) return;
    await window.e4.removeVariables(d.id, names);
    state.selected.clear();
    await refreshDevices();
    await showDetail(d.id);
    toast(T('ui.detail.deleted', { n: names.length }));
  }

  // Live-Werte: nur die betroffenen Zellen ändern (Eingaben in offenen Dialogen bleiben unberührt)
  /** Seite, die gerade Werte zeigt (Bedienseite oder Editor) */
  const shownPage = () => (state.view === 'pages' ? state.page : state.view === 'editor' && ed ? ed.view : null);

  /**
   * Sichtbarkeit (wie in Galileo): Elemente mit Bedingung nur zeigen, wenn sie stimmt; ein ausgeblendeter Rahmen nimmt
   * seinen Inhalt mit. Ohne Wert (nicht verbunden) gilt die Bedingung als nicht erfüllt. Nur auf der Bedienseite –
   * im Editor bleibt alles sichtbar (halb durchsichtig markiert).
   */
  function visOk(vis) {
    if (!vis || vis.missing) return true;
    const x = (state.values[vis.dev] || {})[vis.name];
    if (!x || x.quality !== 'good') return false;
    const n = x.value === true ? 1 : x.value === false ? 0 : Number(x.value);
    if (!Number.isFinite(n)) return false;
    if (vis.op === 'off') return n === 0;
    if (vis.op === 'range') return n >= (vis.from || 0) && (vis.to === undefined || n <= vis.to);
    return n !== 0;
  }
  function applyVisibility(root) {
    const page = state.view === 'pages' ? state.page : null;
    if (!page || page.auto || !(page.items || []).some((e) => e.vis)) return;
    const hidden = new Set();
    for (const e of page.items) {
      if (!e.vis || visOk(e.vis)) continue;
      hidden.add(e.id);
      if (isFrame(e)) for (const x of page.items) if (inFrame(e, x)) hidden.add(x.id);
    }
    (root || document).querySelectorAll('.freepage > .fitem[data-item]').forEach((n) => n.classList.toggle('vishide', hidden.has(n.dataset.item)));
  }

  function onValues(batch) {
    for (const [id, entries] of Object.entries(batch)) {
      state.values[id] = Object.assign(state.values[id] || {}, entries);
      updateAssignValues(id, entries);
      const page = shownPage();
      if (page && page.devices.includes(id)) { for (const key of Object.keys(entries)) updateElement(id, key); applyVisibility(); }
      if (!state.detail || state.detail.id !== id) continue;
      for (const [key, entry] of Object.entries(entries)) {
        const cell = document.querySelector(`[data-value-of="${CSS.escape(key)}"]`);
        const v = state.detail.variables.find((x) => (x.id || x.name) === key);
        if (!cell || !v) continue;
        const f = formatValue(v, entry);
        cell.textContent = f.text;
        cell.className = `value ${f.cls}`;
        cell.title = entry.error || '';
      }
    }
  }
  function onDeviceState(s) {
    for (const list of [state.devices, state.detail ? [state.detail] : []]) {
      const d = list.find((x) => x.id === s.id);
      if (d) { d.state = s.state; d.stateText = s.text; d.broker = s.broker; }
    }
    const box = document.querySelector('.onlinebox');
    if (box) box.replaceWith(onlineControl());
    document.querySelectorAll('[data-test="bar-conn"]').forEach((n) => n.replaceWith(connBadge()));
    announceIfReady();
    document.querySelectorAll(`[data-state-of="${CSS.escape(s.id)}"]`).forEach((chip) => {
      chip.className = `chip ${s.state}`;
      chip.replaceChildren(h('span', { class: 'dot' }), s.text);
    });
    // Bedienseite: bei Ausfall grau und gesperrt, danach wieder bedienbar
    const page = shownPage();
    if (page && page.devices.includes(s.id)) {
      if (state.view === 'pages') render();
      else renderCanvas();
    }
  }

  // ------------------------------------------------------------------ Dialog: Variable von Hand / bearbeiten
  let varDraft = null;

  function openVarEditor(v) {
    varDraft = v
      ? { edit: true, name: v.name, operand: `${v.net ? v.net : ''}${v.operand}${v.operand === 'CLOCK' && v.index !== null && v.index !== undefined ? '.' : ''}${v.index === null || v.index === undefined ? '' : v.index}`,
        label: v.userLabel || '', autoLabel: v.label, role: v.userRole || '', autoRole: v.role, unit: v.userUnit || '',
        type: v.type, writable: v.writable, address: addressText(v), error: null, scale: scaleDraft(v.userScale), decimals: v.userDecimals === undefined ? '' : String(v.userDecimals) }
      : { edit: false, name: '', operand: '', label: '', role: '', unit: '', error: null, scale: scaleDraft(null), decimals: '' };
    renderVarEditor();
  }

  const scaleDraft = (s) => Object.fromEntries(['raw0', 'val0', 'raw1', 'val1'].map((k) => [k, s && s[k] !== undefined ? String(s[k]).replace('.', ',') : '']));
  /** Umrechnung Rohwert -> Einheit: zwei Punkte und Nachkommastellen (nicht bei Bits und der Uhr) */
  function scaleFields(D, V) {
    if (D.type === 'BIT' || /^CLOCK/.test(D.operand)) return null;
    const S = D.scale;
    const cell = (k, label) => textField(label, () => S[k], (v) => { S[k] = v; }, { key: `scale-${k}`, inputmode: 'decimal' });
    const unit = D.unit ? ` (${D.unit})` : '';
    return h('div', { class: 'field', attrs: { 'data-test': 'var-scale' } }, h('div', { class: 'label', text: V('scaleTitle') }),
      h('div', { class: 'row4' }, cell('raw0', V('raw')), cell('val0', `${V('is')}${unit}`), cell('raw1', V('raw')), cell('val1', `${V('is')}${unit}`)),
      h('div', { class: 'row4' }, textField(V('decimals'), () => D.decimals, (v) => { D.decimals = v; }, { key: 'decimals', inputmode: 'numeric', placeholder: V('decimalsHint') })),
      h('div', { class: 'hint', text: V('scaleHint') }));
  }

  function renderVarEditor() {
    const V = (k, a) => T(`ui.varDlg.${k}`, a);
    const D = varDraft;
    const roleOptions = [['', D.edit && D.autoRole ? V('roleAuto', { role: T(`ui.detail.roles.${D.autoRole}`) }) : V('roleNone')],
      ...['display', 'control', 'internal'].map((r) => [r, T(`ui.detail.roles.${r}`)])];
    const panel = h('div', { class: 'panel', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': D.edit ? V('titleEdit') : V('titleNew') } },
      h('div', { class: 'head' }, h('h2', { text: D.edit ? V('titleEdit') : V('titleNew') }),
        h('button', { class: 'iconbtn', attrs: { 'aria-label': T('ui.common.close') }, on: { click: closeModal } }, icon('close'))),
      h('div', { class: 'form' },
        D.edit
          ? h('div', { class: 'field' }, h('div', { class: 'label', text: V('operand') }),
            h('div', { class: 'mono', text: `${D.operand} · ${D.name}` }),
            h('div', { class: 'hint', text: `${V('info', { type: D.type || '–', writable: D.writable ? V('writable') : V('readonly') })} · ${V('address')}: ${D.address}` }))
          : h('div', { class: 'row2' },
            textField(V('operand'), () => D.operand, (v) => { D.operand = v.trim(); }, { mono: true, key: 'operand', placeholder: 'MW3' }),
            textField(V('name'), () => D.name, (v) => { D.name = v.trim(); }, { mono: true, key: 'varname', hint: V('nameHint') })),
        !D.edit ? h('div', { class: 'hint', text: V('operandHint') }) : null,
        textField(V('label'), () => D.label, (v) => { D.label = v; }, { key: 'label', placeholder: D.autoLabel || '', hint: V('labelHint') }),
        h('div', { class: 'row2' },
          selectField(V('role'), D.role, roleOptions, (v) => { D.role = v; }, 'role'),
          textField(V('unit'), () => D.unit, (v) => { D.unit = v; }, { key: 'unit', hint: V('unitHint') })),
        scaleFields(D, V),
        D.error ? h('div', { class: 'result err' }, icon('err'), h('div', { text: D.error })) : null),
      h('div', { class: 'foot' },
        h('div', { class: 'spacer' }),
        D.edit && D.type === 'BIT' ? h('button', { class: 'btn', attrs: { title: A('asAlarmHint'), 'data-test': 'as-alarm' }, on: { click: () => asAlarm(D) } }, icon('bell'), A('asAlarm')) : null,
        D.edit ? h('button', { class: 'btn danger', on: { click: deleteVar } }, T('ui.common.delete')) : null,
        h('button', { class: 'btn', on: { click: closeModal } }, T('ui.common.cancel')),
        h('button', { class: 'btn primary', attrs: { 'data-test': 'save-var' }, on: { click: saveVar } }, T('ui.common.save'))));
    const overlay = h('div', { class: 'overlay', on: { mousedown: (e) => { if (e.target === overlay) closeModal(); } } }, panel);
    setModal(overlay);
    const first = panel.querySelector('input');
    if (first) first.focus();
  }

  async function saveVar() {
    const D = varDraft;
    const id = state.detail.id;
    try {
      const sc = { userScale: D.scale, userDecimals: D.decimals };
      if (D.edit) await window.e4.updateVariable(id, D.name, Object.assign({ userLabel: D.label, userRole: D.role, userUnit: D.unit }, sc));
      else await window.e4.addVariable(id, Object.assign({ operand: D.operand, name: D.name, label: D.label, userRole: D.role, userUnit: D.unit }, sc));
    } catch (err) {
      D.error = err.message;
      renderVarEditor();
      return;
    }
    varDraft = null;
    closeModal();
    await refreshDevices();
    await showDetail(id);
    toast(T('ui.common.saved'));
  }

  async function deleteVar() {
    if (!window.confirm(T('ui.varDlg.deleteConfirm', { name: varDraft.name }))) return;
    const id = state.detail.id;
    await window.e4.removeVariable(id, varDraft.name);
    varDraft = null;
    closeModal();
    await refreshDevices();
    await showDetail(id);
  }

  // ------------------------------------------------------------------ Schnell-Zuordnung (vor allem für FUP/KOP ohne Vorschläge)
  const ALWAYS_SHOWN = new Set(['I', 'Q', 'IA', 'QA', 'ID', 'CLOCK']);
  let assign = null; // { deviceId, rows: [{ v, use, label, marked }] }

  // eigener Name statt nur Operand (wie hasRealName in src/core/pages.js)
  function hasRealName(v) {
    if (v.userLabel) return true;
    if (String(v.operand).toUpperCase() === 'CLOCK') return false;
    const op = `${v.net ? v.net : ''}${v.operand}${v.index}`.toUpperCase();
    return (v.sources || []).includes('comments') || String(v.name).toUpperCase() !== op ||
      !String(v.label || '').toUpperCase().endsWith(`${v.operand}${v.index}`.toUpperCase()); // automatisch: „Merkerwort MW3“
  }

  function openAssign(d) {
    const cand = d.variables.filter((v) => !ALWAYS_SHOWN.has(String(v.operand).toUpperCase()));
    if (!cand.length) { toast(T('ui.assign.none')); return; }
    assign = {
      deviceId: d.id,
      rows: cand.map((v) => {
        const r = v.userRole || v.role;
        // Voreinstellung: Vorschlag übernehmen; ohne Vorschlag: mit Namen „Anzeige“, sonst „nicht zeigen“
        const use = r === 'control' ? 'control' : r === 'internal' ? 'hide' : r === 'display' ? 'display' : hasRealName(v) ? 'display' : 'hide';
        return { v, use, startUse: use, label: v.userLabel || v.label, marked: false };
      }),
    };
    renderAssign();
  }

  function assignValueText(row) {
    const entry = (state.values[assign.deviceId] || {})[row.v.id || row.v.name];
    const f = formatValue(row.v, entry);
    // Fehler hier nur als „–“ (voller Text beim Darüberfahren), damit die Tabelle schmal bleibt
    const bad = /\bbad\b/.test(f.cls);
    return { text: bad ? '–' : f.text, title: bad ? f.text : '', changing: !!(entry && entry.changes > 0) };
  }

  function renderAssign() {
    const A = (k, a) => T(`ui.assign.${k}`, a);
    const useSeg = (row) => h('div', { class: 'seg small', attrs: { role: 'group', 'aria-label': `${A('colUse')}: ${row.label}` } },
      ...['display', 'control', 'hide'].map((u) => h('button', { class: row.use === u ? 'on' : '', text: A(u),
        attrs: { 'aria-pressed': String(row.use === u), 'data-test': `use-${row.v.name}-${u}` },
        on: { click: () => { row.use = u; renderAssign(); } } })));
    const rows = assign.rows.map((row) => {
      const val = assignValueText(row);
      return h('tr', { attrs: { 'data-assign-of': row.v.id || row.v.name } },
        h('td', {}, h('input', { attrs: { type: 'checkbox', 'aria-label': row.label }, checked: row.marked,
          on: { change: (e) => { row.marked = e.target.checked; } } })),
        h('td', {}, h('input', { class: 'input', value: row.label, attrs: { 'aria-label': A('colName') },
          on: { input: (e) => { row.label = e.target.value; } } })),
        h('td', { class: 'mono small', text: `${row.v.net ? row.v.net : ''}${row.v.operand}${row.v.index}` }),
        h('td', { class: 'value mono small', text: val.text, attrs: { title: val.title || null } }),
        h('td', {}, val.changing ? h('span', { class: 'badge changing', text: A('changing') }) : null),
        h('td', {}, useSeg(row)));
    });
    const bulk = (u) => () => { for (const r of assign.rows) if (r.marked) r.use = u; renderAssign(); };
    const markAll = (on) => () => { for (const r of assign.rows) r.marked = on; renderAssign(); };
    const panel = h('div', { class: 'panel', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': A('title') } },
      h('div', { class: 'head' }, h('h2', { text: A('title') }),
        h('button', { class: 'iconbtn', attrs: { 'aria-label': T('ui.common.close') }, on: { click: closeAssign } }, icon('close'))),
      h('div', { class: 'muted', text: A('intro') }),
      h('div', { class: 'result warn' }, icon('warn'), h('div', { text: A('changingHint') })),
      h('div', { class: 'inline' },
        h('span', { class: 'small', text: A('marked') }),
        h('button', { class: 'btn small', on: { click: bulk('display') } }, A('display')),
        h('button', { class: 'btn small', on: { click: bulk('control') } }, A('control')),
        h('button', { class: 'btn small', on: { click: bulk('hide') } }, A('hide')),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn small link', on: { click: markAll(true) } }, A('markAll')),
        h('button', { class: 'btn small link', on: { click: markAll(false) } }, A('markNone'))),
      h('div', { class: 'tablewrap' }, h('table', { class: 'list' },
        h('thead', {}, h('tr', {}, h('th', { text: '' }), ...['colName', 'colOperand', 'colValue'].map((k) => h('th', { text: A(k) })),
          h('th', { text: '' }), h('th', { text: A('colUse') }))),
        h('tbody', {}, rows))),
      h('div', { class: 'foot' }, h('div', { class: 'spacer' }),
        h('button', { class: 'btn', on: { click: closeAssign } }, T('ui.common.cancel')),
        h('button', { class: 'btn primary', attrs: { 'data-test': 'save-assign' }, on: { click: saveAssign } }, T('ui.common.save'))));
    const overlay = h('div', { class: 'overlay center', on: { mousedown: (e) => { if (e.target === overlay) closeAssign(); } } }, panel);
    const scroll = document.querySelector('#modal .tablewrap');
    const top = scroll ? scroll.scrollTop : 0;
    setModal(overlay);
    const again = document.querySelector('#modal .tablewrap');
    if (again) again.scrollTop = top;
  }

  function closeAssign() {
    assign = null;
    closeModal();
  }

  async function saveAssign() {
    const map = { display: 'display', control: 'control', hide: 'internal' };
    const changes = assign.rows
      .filter((r) => r.use !== r.startUse || r.label !== (r.v.userLabel || r.v.label) || !(r.v.userRole || r.v.role))
      .map((r) => ({ name: r.v.name, userRole: map[r.use], userLabel: r.label }));
    const id = assign.deviceId;
    await window.e4.assignVariables(id, changes);
    closeAssign();
    await refreshDevices();
    await showDetail(id);
    toast(T('ui.assign.saved', { n: changes.length }));
  }

  // Live-Werte und „ändert sich“ im offenen Zuordnungs-Dialog nachführen (Eingaben bleiben unberührt)
  function updateAssignValues(id, entries) {
    if (!assign || assign.deviceId !== id) return;
    for (const key of Object.keys(entries)) {
      const tr = document.querySelector(`[data-assign-of="${CSS.escape(key)}"]`);
      const row = assign.rows.find((r) => (r.v.id || r.v.name) === key);
      if (!tr || !row) continue;
      const val = assignValueText(row);
      tr.children[3].textContent = val.text;
      tr.children[3].title = val.title;
      tr.children[4].replaceChildren(...(val.changing ? [h('span', { class: 'badge changing', text: T('ui.assign.changing') })] : []));
    }
  }

  // ------------------------------------------------------------------ Bedienseiten (eigene Seiten aus dem Editor; automatische nur als Zusatzfunktion)
  // Jedes Element trägt sein Gerät (dev) – auf einer Seite dürfen Variablen mehrerer easyE4 stehen.
  const writes = {};      // „Gerät|Name“ -> { status: 'sending' | 'waiting' | 'done' | 'failed' | 'unconfirmed', text, target, t0 }
  const debounce = {};    // „Gerät|Name“ -> { timer, value } (Plus/Minus: erst nach kurzer Pause senden)
  const wkey = (e) => `${e.dev}|${e.name}`;
  const devOnline = (id) => { const d = state.devices.find((x) => x.id === id); return !!d && d.state === 'online'; };
  const pageOffline = (page) => !!page && page.devices.length > 0 && page.devices.every((id) => !devOnline(id));
  // eigene Seiten: Elemente frei auf der Seite (items, Rahmen sind keine Elemente mit Werten); automatische Seiten: Karten
  const flatElements = (page) => (!page ? [] : page.items ? page.items.filter((e) => e.kind !== 'frame') : page.cards.flatMap((c) => c.elements));
  const pageHasContent = (page) => !!page && (page.items ? page.items.length : page.cards.length) > 0;
  /** unterste Kante aller Elemente in Bildpunkten */
  const itemsBottom = (items) => (items || []).reduce((m, e) => Math.max(m, e.y + e.h), 0);
  const keyOfVar = (v) => (v.id !== undefined && v.id !== null ? String(v.id) : v.name);
  const opText = (v) => `${v.net ? v.net : ''}${v.operand}${v.operand === 'CLOCK' ? '.' : ''}${v.index === null || v.index === undefined ? '' : v.index}`;

  /** automatisch erzeugte Seite wie eine eigene behandeln: Gerät und id an jedem Element */
  function autoAsPage(p) {
    return Object.assign({}, p, { id: `auto:${p.deviceId}`, name: p.title, devices: [p.deviceId],
      cards: p.cards.map((c) => Object.assign({}, c, { elements: c.elements.map((e, i) =>
        Object.assign({ id: `${c.id}-${i}`, dev: p.deviceId, deps: [{ dev: p.deviceId, name: e.name }], writable: true }, e)) })) });
  }

  // ---------------------------------------------------------------- Wertelisten, Symbole, Text mit Werten
  const SYM = window.E4_SYMBOLS;
  const COLOR_ROLES = ['on', 'off', 'warn', 'alarm', 'accent', 'neutral'];
  const symbol = (name, size) => h('span', { class: 'sym', html: SYM.svg(name, size) });

  /** passende Zeile der Werteliste (genauer Wert oder Bereich), sonst „sonst“ */
  function matchMap(e, v) {
    const n = Number(v);
    if (v !== null && v !== undefined && typeof v !== 'object' && Number.isFinite(n)) {
      for (const r of e.map || []) {
        const hit = r.to === undefined || r.to === null ? n === r.from : n >= Math.min(r.from, r.to) && n <= Math.max(r.from, r.to);
        if (hit) return r;
      }
    }
    return e.other || null;
  }

  /** Zustandsliste: die oberste Zeile, deren Variable (eigene, sonst die des Elements) zum Wert passt */
  function stateRow(e) {
    for (const r of e.map || []) {
      if (r.missing) continue;
      if (matchMap({ map: [r] }, valueOf(r.name ? r : e)) === r) return r;
    }
    return null;
  }

  /**
   * Uhr der easyE4 für das Element „Uhr“: ganze Uhr (Variable CLOCK) oder aus ihren Teilen CLOCK.0 … CLOCK.5
   * (Sekunde, Minute, Stunde, Tag, Monat, Jahr – so stehen sie in der .itf). Ergebnis { second … year } oder null.
   */
  function clockOf(e, v) {
    if (v && typeof v === 'object' && v.minute !== undefined) return v;
    const vals = state.values[e.dev] || {};
    const full = e.clockFull && vals[e.clockFull];
    if (full && full.quality === 'good' && full.value && typeof full.value === 'object') return full.value;
    if (!e.clockParts) return null;
    const F = ['second', 'minute', 'hour', 'day', 'month', 'year'];
    const c = {};
    for (const [i, key] of Object.entries(e.clockParts)) {
      const x = vals[key];
      if (x && x.quality === 'good' && Number.isFinite(Number(x.value))) c[F[i]] = Number(x.value);
    }
    if (c.year !== undefined && c.year < 100) c.year += 2000;
    return Object.keys(c).length ? c : null;
  }
  /** Anzeige: fehlt = hh:mm, 'hms' = hh:mm:ss, 'dt' = Datum und hh:mm, 'd' = Datum; fehlende Teile = null */
  function clockShow(c, fmt) {
    const p = (n) => String(n).padStart(2, '0');
    const has = (...k) => k.every((x) => c[x] !== undefined);
    const hm = has('hour', 'minute') ? `${p(c.hour)}:${p(c.minute)}` : null;
    const date = has('day', 'month', 'year') ? `${p(c.day)}.${p(c.month)}.${c.year}` : null;
    if (fmt === 'd') return date;
    if (fmt === 'hms') return hm && has('second') ? `${hm}:${p(c.second)}` : null;
    if (fmt === 'dt') return date && hm ? `${date} ${hm}` : null;
    return hm;
  }
  /** Abweichung zur PC-Uhr in Minuten (nur mit vollständiger Uhr), sonst null */
  function clockDrift(c) {
    if (!['second', 'minute', 'hour', 'day', 'month', 'year'].every((k) => c[k] !== undefined)) return null;
    return Math.round((new Date(c.year, c.month - 1, c.day, c.hour, c.minute, c.second).getTime() - Date.now()) / 60000);
  }
  function clockText(c, format) {
    const p = (n) => String(n).padStart(2, '0');
    const date = `${p(c.day)}.${p(c.month)}.${c.year}`;
    const time = `${p(c.hour)}:${p(c.minute)}:${p(c.second)}`;
    return format === 'date' ? date : format === 'time' ? time : `${date} ${time}`;
  }

  /** Wert eines Platzhalters im Text: Nachkommastellen, Einheit, Datum/Uhrzeit */
  function placeholderText(x) {
    if (x.missing) return '?';
    const entry = (state.values[x.dev] || {})[x.name];
    const v = entry ? entry.value : null;
    if (v === null || v === undefined || (entry && entry.quality === 'bad')) return '–';
    let s;
    if (typeof v === 'object') s = clockText(v, x.format);
    else if (typeof v === 'number' && x.decimals !== undefined) s = v.toLocaleString('de-DE', { minimumFractionDigits: x.decimals, maximumFractionDigits: x.decimals, useGrouping: false });
    else s = typeof v === 'boolean' ? (v ? '1' : '0') : fmt(v);
    return x.unit ? `${s} ${x.unit}` : s;
  }

  // Tipptaster: gedrückt = 1, losgelassen = 0 – auch beim Herausrutschen, Abbrechen und wenn das Fenster den Fokus verliert
  let tipActive = null; // { e }
  function tipHandlers(btn, e) {
    const down = (ev) => {
      if (btn.disabled || tipActive) return;
      ev.preventDefault();
      tipActive = { e };
      btn.classList.add('down');
      buzz();
      sendValue(e, 1, { noMerge: true });
    };
    btn.addEventListener('pointerdown', down);
    for (const evName of ['pointerup', 'pointercancel', 'pointerleave', 'blur']) btn.addEventListener(evName, tipRelease);
    btn.addEventListener('keydown', (ev) => { if ((ev.key === ' ' || ev.key === 'Enter') && !ev.repeat) down(ev); });
    btn.addEventListener('keyup', (ev) => { if (ev.key === ' ' || ev.key === 'Enter') tipRelease(); });
  }
  /** kurzes Vibrieren beim Drücken (Handy/Tablet, wo es das Gerät kann) */
  const buzz = () => { try { if (navigator.vibrate) navigator.vibrate(25); } catch (err) { /* nicht unterstützt */ } };
  function tipRelease() {
    if (!tipActive) return;
    const { e } = tipActive;
    tipActive = null;
    document.querySelectorAll('.btn.tip.down').forEach((n) => n.classList.remove('down'));
    sendValue(e, 0, { noMerge: true });
  }
  window.addEventListener('pointerup', tipRelease);
  window.addEventListener('blur', tipRelease);
  document.addEventListener('visibilitychange', () => { if (document.hidden) tipRelease(); });

  async function loadValues(ids) {
    for (const id of ids) state.values[id] = await window.e4.deviceValues(id);
  }

  // zuletzt benutzter Programmteil (für „Bedienmodus verlassen“), bleibt auch über einen Neustart erhalten
  const SETUP_VIEWS = { devices: () => showDevices(), detail: () => showDetail(), alarms: () => showAlarms(), editor: () => showEditor(),
    users: () => showUsers(), audit: () => showAudit(), design: () => showDesign(), texts: () => showTexts(), records: () => showRecords(),
    project: () => showProject(), web: () => showWeb() };
  let lastSetupView = null;
  try { lastSetupView = localStorage.getItem('easy4visu.lastView'); } catch (e) { lastSetupView = null; }
  if (!SETUP_VIEWS[lastSetupView]) lastSetupView = null;
  function rememberView(v) {
    lastSetupView = v;
    try { localStorage.setItem('easy4visu.lastView', v); } catch (e) { /* gilt nur bis zum Neustart */ }
  }

  /** easy4Visu dauerhaft beenden: nur Einrichter, mit Rückfrage */
  function quitApp() {
    if (authOn() && !isSetup()) { openLogin({ reason: AU('reasonQuitApp'), need: 'setup', then: () => quitApp() }); return; }
    if (!window.confirm(AU('quitConfirm'))) return;
    window.e4.quitApp().catch((err) => toast(err.message));
  }

  /**
   * Wohin kommt man von jeder Seite über eigene Tasten? { Seiten-id: Set der Ziel-ids | 'all' } – Leisten mit
   * Seiten-Tasten erreichen alle Seiten, sonst zählen Funktionstasten „Seite“ (in den Leisten und auf der Seite)
   */
  function pageNavGraph(pages, bars) {
    const g = {};
    for (const p of pages) {
      const b = barsOf(p, bars);
      const barItems = BAR_POS.flatMap((pos) => (b[pos] ? b[pos].items : []));
      if (barItems.some((x) => x.type === 'pagekeys')) { g[p.id] = 'all'; continue; }
      g[p.id] = new Set([...barItems.filter((x) => x.type === 'fkey'), ...(p.items || []).filter((e) => e.kind === 'fkey')]
        .filter((x) => x.action === 'page' && x.page).map((x) => x.page));
    }
    return g;
  }
  /** erreicht man von dieser Seite über eigene Tasten (auch über Umwege) alle Seiten der Liste? */
  function reachesAll(id) {
    const g = state.pageNav || {};
    const seen = new Set([id]);
    const todo = [id];
    while (todo.length) {
      const t = g[todo.pop()];
      if (t === 'all') return true;
      for (const n of t || []) if (!seen.has(n)) { seen.add(n); todo.push(n); }
    }
    return (state.pageList || []).every((x) => seen.has(x.key));
  }

  /** key: id einer eigenen Seite oder „auto:<Gerät>“; ohne: zuletzt gezeigte bzw. erste */
  async function showPages(key, isBack) {
    await flushEditorSave();
    state.bars = await window.e4.getBars('current');
    const before = state.view === 'pages' && state.page ? state.page.id : null;
    if (state.view !== 'pages' && SETUP_VIEWS[state.view]) rememberView(state.view);
    await refreshDevices();
    const raw = await window.e4.listPages('current');
    const list = raw.map((p) => ({ key: p.id, name: p.name, start: !!p.start }));
    state.pageNav = pageNavGraph(raw, state.bars);
    if (options.autoPages) for (const d of state.devices) list.push({ key: `auto:${d.id}`, name: T('ui.page.autoName', { name: d.name }), auto: d.id });
    // Handy (kürzere Bildschirmseite unter 600 Punkten, egal ob hoch oder quer) oder Tablet: eigene Startseite
    const phone = Math.min(window.screen.width, window.screen.height) < 600;
    const webStart = WEB && state.auth && (phone ? state.auth.startPage : state.auth.startPageTablet);
    const pick = list.find((x) => x.key === key) || list.find((x) => state.page && x.key === state.page.id)
      || (webStart && list.find((x) => x.key === webStart)) || list.find((x) => x.start) || list[0];
    state.view = 'pages';
    state.pageList = list;
    state.page = null;
    if (pick) state.page = pick.auto ? autoAsPage(await window.e4.devicePage(pick.auto)) : await window.e4.viewPage(pick.key);
    if (state.page) await loadValues(state.page.devices);
    // für die Taste „Zurück“: zuletzt gezeigte Seiten merken
    if (!state.pageBack) state.pageBack = [];
    if (!isBack && before && state.page && state.page.id !== before) state.pageBack = state.pageBack.concat(before).slice(-20);
    render();
  }

  /** Bedienmodus verlassen: zurück dorthin, woher man kam (Editor, Geräte …); Vollbild endet */
  async function exitOperate() {
    if (authOn() && !isSetup()) { openLogin({ reason: AU('reasonExit'), need: 'setup', then: () => exitOperate() }); return; }
    try { await window.e4.exitOperate(); } catch (err) { toast(err.message); return; }
    if (state.fullscreen) await toggleFullscreen();
    return backToSetup();
  }
  function backToSetup() {
    const from = lastSetupView || 'devices';
    if (from === 'editor') return showEditor(state.page && !state.page.auto ? state.page.id : undefined);
    return SETUP_VIEWS[from]();
  }
  const canFullscreen = () => !WEB || !!document.fullscreenEnabled;
  async function toggleFullscreen() {
    state.fullscreen = await window.e4.toggleFullscreen();
    render();
  }

  function pagesView() {
    const P = (k, a) => T(`ui.page.${k}`, a);
    const page = state.page;
    const logo = logoNode();
    // auf der Bedienseite kein eigenes Logo mehr: dafür gibt es das Element „Bild“ (später auch in den Leisten)
    const head = page ? null
      : h('div', { class: 'pagehead' }, logo, h('div', { class: 'grow' }, h('h1', { text: P('title') }), h('div', { class: 'muted', text: P('introEditor') })));
    state.shown = flatElements(page);
    if (!page && WEB) return h('div', { class: 'card empty', attrs: { 'data-test': 'no-pages' } }, h('div', { class: 'muted', text: T('ui.web.noPages') }));
    if (!page) {
      if (authOn() && !isSetup()) {
        return h('div', {}, head, h('div', { class: 'card empty', attrs: { 'data-test': 'no-pages' } }, h('h2', { text: P('noPages') }),
          h('div', { class: 'muted', text: P('noPagesGuest') }),
          h('button', { class: 'btn primary', attrs: { 'data-test': 'no-pages-login' },
            on: { click: () => openLogin({ reason: AU('reasonSetup'), need: 'setup', then: () => { if (isSetup()) showDevices(); } }) } }, AU('login'))));
      }
      return h('div', {}, head, h('div', { class: 'card empty', attrs: { 'data-test': 'no-pages' } }, h('h2', { text: P('noPages') }),
        h('div', { class: 'muted', text: P('noPagesHint') }),
        h('button', { class: 'btn primary', attrs: { 'data-test': 'to-editor' }, on: { click: () => showEditor() } }, P('toEditor'))));
    }
    // Seitenreiter = Notnavigation. Entfällt auf einer Seite ohne Leisten nur, wenn man über die eigenen Tasten
    // (auch über Umwege) alle Seiten erreicht – sonst säße man fest (Ralf 06.11.2026: Handy-Seiten verweisen nur
    // aufeinander → am PC Reiter). Auf dem Handy im Browser reicht eine eigene Seitentaste: die großen PC-Seiten
    // passen dort ohnehin nicht, und Reiter für alle Seiten wären auf dem schmalen Bildschirm nur im Weg.
    const phone = WEB && Math.min(window.screen.width, window.screen.height) < 600;
    const ownNav = !page.auto && page.noBars
      && (phone ? flatElements(page).some((e) => e.kind === 'fkey' && e.action === 'page') : reachesAll(page.id));
    const tabs = state.pageList.length > 1 && !ownNav ? h('div', { class: 'seg tabs', attrs: { role: 'tablist', 'aria-label': P('title') } },
      ...state.pageList.map((x) => h('button', { class: x.key === page.id ? 'on' : '', text: x.name,
        attrs: { role: 'tab', 'aria-selected': String(x.key === page.id), 'data-page-tab': x.key }, on: { click: () => showPages(x.key) } }))) : null;
    const area = workArea(page, state.bars);
    const km = page.auto ? { map: {}, pageKeys: {} } : buildKeymap(page, area);
    state.keymap = km.map;
    state.pageKeys = km.pageKeys;
    // mit Leisten ersetzen diese die obere Programmleiste und die Seitenreiter (CSS .barsmode)
    state.barsMode = BAR_POS.some((pos) => area.bars[pos]);
    const devs = page.devices.map((id) => state.devices.find((d) => d.id === id)).filter(Boolean);
    const bar = h('div', { class: 'pagebar' },
      // nicht verbunden: steht schon oben rechts (rot) – hier nur der Zustand je Gerät, wenn verbunden
      h('h2', { text: page.name }), ...(state.online ? devs.map((d) => stateChip(d)) : []), h('div', { class: 'spacer' }),
      page.auto
        ? h('button', { class: 'btn small', on: { click: () => showDetail(page.deviceId) } }, P('toVariables'))
        : h('button', { class: 'btn small', attrs: { 'data-test': 'edit-page' }, on: { click: () => showEditor(page.id) } }, P('edit')));
    const offline = pageOffline(page);
    const body = pageHasContent(page) ? pageGrid(page, offline)
      : h('div', { class: 'card empty' }, h('div', { class: 'muted', text: P(page.auto ? 'noElements' : 'emptyPage') }));
    return h('div', { class: 'pagesview' }, head, tabs, state.view === 'pages' ? null : bar,
      state.online && offline && pageHasContent(page) ? h('div', { class: 'result err', attrs: { 'data-test': 'page-offline' } }, icon('err'),
        h('div', { text: P('offline') })) : null,
      page.unassignedCount ? h('div', { class: 'result warn', attrs: { 'data-test': 'unassigned-hint' } }, icon('warn'),
        h('div', { text: P('unassignedHint', { n: page.unassignedCount }) })) : null,
      body);
  }

  /** Elemente einer Seite: automatische Seiten fließen frei in Karten, eigene liegen frei an ihrem Platz */
  function pageGrid(page, offline) {
    if (page.auto) {
      return h('div', { class: `pagegrid${offline ? ' offline' : ''}` }, page.cards.map((c) => h('section', { class: 'card vcard', attrs: { 'aria-label': c.title } },
        h('h2', { text: c.title }), h('div', { class: 'elements' }, c.elements.map((e) => renderElement(e))))));
    }
    const area = workArea(page, state.bars);
    const grid = watchGrid(h('div', { class: `pagegrid freegrid freepage${page.scroll ? '' : ' fitall'}${offline ? ' offline' : ''}`, attrs: { 'data-w': area.w, 'data-h': area.h } },
      page.items.map((e) => itemNode(e, renderElement(e)))));
    applyVisibility(grid);
    if (page.scroll) grid.style.minHeight = `${Math.max(area.h, itemsBottom(page.items))}px`;
    pageBg(grid, page);
    return h('div', { class: `screenbox${page.scroll ? ' scroll' : ''}` }, screenNode(grid, page, area, { pageKeys: state.pageKeys || {} }));
  }
  /** gespeichertes Bild (Datenordner/bilder) – das Hauptprogramm liefert es unter dieser Adresse aus */
  const imgUrl = (name) => (WEB ? `/bild/${encodeURIComponent(name)}` : `e4img://bild/${encodeURIComponent(name)}`);
  /** Hintergrund der Seite (Farbe oder Bild) auf die Seitenfläche legen; ohne Angabe gilt das Thema */
  function pageBg(node, page) {
    const bg = page.bg;
    if (!bg) return node;
    node.classList.add('hasbg');
    if (bg.color) node.style.backgroundColor = bg.color;
    if (bg.img) {
      Object.assign(node.style, { backgroundImage: `url("${imgUrl(bg.img)}")`, backgroundPosition: 'center',
        backgroundSize: bg.fit === 'tile' ? 'auto' : bg.fit, backgroundRepeat: bg.fit === 'tile' ? 'repeat' : 'no-repeat' });
    }
    return node;
  }
  /** Rahmen: Kasten mit Überschrift hinter den Elementen (look: Linie, eingefärbt oder nur Überschrift) */
  const frameNode = (e) => h('section', { class: `${e.look === 'title' ? '' : 'card vcard '}frame look-${e.look || 'line'}`, attrs: { 'aria-label': e.title || null, 'data-eid': e.id } },
    e.title ? h('h2', { class: 'frametitle', text: e.title }) : null);
  /** ein Element an seinem Platz auf der Seite; inner = Inhalt (auf der Bedienseite renderElement) */
  function itemNode(e, inner) {
    const node = h('div', { class: `fitem${e.kind === 'frame' ? ' isframe' : ''}`, attrs: { 'data-item': e.id } },
      e.kind === 'frame' ? frameNode(e) : inner);
    Object.assign(node.style, { left: `${e.x}px`, top: `${e.y}px`, width: `${e.w}px`, height: `${e.h}px` });
    // Schrift: der Inhalt wird gezoomt, darum Breite/Höhe innen entsprechend kleiner rechnen
    const box = node.firstChild;
    if (box && e.font && e.font !== 100) {
      const z = e.font / 100;
      Object.assign(box.style, { zoom: String(z), width: `${e.w / z}px`, height: `${e.h / z}px` });
    }
    return node;
  }

  // ---------------------------------------------------------------- Leisten (Vorlage für alle Seiten) und Funktionstasten
  // Dicke der Leisten in Bildpunkten der Seite – sie werden mit der Seite vergrößert/verkleinert
  const BAR_PX = { top: 56, bottom: 72, left: 184, right: 184 };
  const BAR_POS = ['top', 'bottom', 'left', 'right'];
  const BAR_TYPES = ['logo', 'title', 'clock', 'conn', 'alarms', 'login', 'lang', 'text', 'spacer', 'pagekeys', 'fkey'];
  const L = (k, a) => T(`ui.bars.${k}`, a);

  /** sichtbare Leisten einer Seite { top: Leiste | null, … } – nur eigene Seiten, nicht bei „Leisten ausblenden“ */
  function barsOf(page, bars) {
    const out = {};
    for (const pos of BAR_POS) { const b = bars && bars[pos]; out[pos] = page && !page.auto && !page.noBars && b && b.on ? b : null; }
    return out;
  }
  /** Fläche für die Karten: Bildschirm ohne die Leisten (Breite in px, Reihen, Höhe dieser Reihen) */
  function workArea(page, bars) {
    const b = barsOf(page, bars);
    const bw = (b.left ? BAR_PX.left : 0) + (b.right ? BAR_PX.right : 0);
    const bh = (b.top ? BAR_PX.top : 0) + (b.bottom ? BAR_PX.bottom : 0);
    return { bars: b, bw, bh, w: (page.width || 1920) - bw, h: pageH(page) - bh };
  }
  const pageNames = () => (state.view === 'editor' && ed ? ed.pages.map((p) => ({ key: p.id, name: p.name })) : (state.pageList || []));

  /**
   * Tasten F1–F12: zuerst die fest eingestellten (Funktionstasten in Leisten und auf der Seite), dann bekommen die
   * Seiten-Tasten der Reihe nach die freien F1–F10. Ergebnis { map: { F1: Funktion }, pageKeys: { Seiten-id: 'F1' } }
   */
  function buildKeymap(page, area) {
    const map = {};
    const fks = [];
    for (const pos of BAR_POS) if (area.bars[pos]) for (const it of area.bars[pos].items) if (it.type === 'fkey') fks.push(it);
    for (const e of flatElements(page)) if (e.kind === 'fkey') fks.push(e);
    for (const f of fks) if (f.key && !map[f.key]) map[f.key] = f;
    const pageKeys = {};
    if (BAR_POS.some((pos) => area.bars[pos] && area.bars[pos].items.some((x) => x.type === 'pagekeys'))) {
      let n = 1;
      for (const p of pageNames()) {
        while (n <= 10 && map[`F${n}`]) n++;
        if (n > 10) break;
        const k = `F${n++}`;
        map[k] = { action: 'page', page: p.key };
        pageKeys[p.key] = k;
      }
    }
    return { map, pageKeys };
  }

  function fkeyLabel(f) {
    if (f.label) return f.label;
    if (f.action === 'page') { const p = pageNames().find((x) => x.key === f.page); return p ? p.name : L('action.page'); }
    if (f.action === 'connect') return T(`ui.online.${state.online ? 'disconnect' : 'connect'}`);
    if (f.action === 'login') return L(state.auth && state.auth.user ? 'action.logoutNow' : 'action.loginNow');
    if (f.action === 'lang') return projectLangs().length > 2 ? `${langName(curLang())} ▾` : langName(nextLangCode());
    return L(`action.${f.action}`);
  }

  /** Funktionstaste ausführen (nur auf der Bedienseite) */
  async function runFkey(f, anchor) {
    if (state.view !== 'pages' || !f || (WEB && WEB_HIDDEN.includes(f.action))) return;
    if (f.confirm && !window.confirm(L('confirm', { name: fkeyLabel(f) }))) return;
    if (f.action === 'page') { if (f.page) await showPages(f.page); }
    else if (f.action === 'back') { if (state.pageBack && state.pageBack.length) await showPages(state.pageBack.pop(), true); }
    else if (f.action === 'connect') await setOnline(!state.online);
    else if (f.action === 'fullscreen') await toggleFullscreen();
    else if (f.action === 'theme') setTheme(appMode() === 'dark' ? 'light' : 'dark');
    else if (f.action === 'exit') await exitOperate();
    else if (f.action === 'login') { if (state.auth && state.auth.user) await window.e4.logout(); else openLogin({}); }
    else if (f.action === 'quit') quitApp();
    else if (f.action === 'lang') langMenu(anchor || document.querySelector('.fkey[data-fkey="lang"]'));
    else if (f.action === 'write') {
      if (!state.online) { toast(L('notOnline')); return; }
      try {
        await window.e4.writeValue(f.dev, f.name, f.value === undefined ? 1 : f.value);
        if (options.commissioning) toast(L('written'));
      } catch (err) { toast(err.message); }
    }
  }

  // im Browser gibt es kein Verbinden/Trennen, Bedienmodus verlassen und Beenden (nur am PC)
  const WEB_HIDDEN = ['connect', 'exit', 'quit'];
  // „Verlassen“ und „easy4Visu beenden“ sieht nur der Techniker (Ralf 05.11.2026); per Tastatur (Esc/F12) fragt easy4Visu nach der Anmeldung
  const TECH_ONLY = ['exit', 'quit'];
  function fkeyNode(f, key, opts) {
    if (WEB && (WEB_HIDDEN.includes(f.action) || (f.action === 'fullscreen' && !canFullscreen()))) return null;
    if (!opts.editing && TECH_ONLY.includes(f.action) && !isSetup()) return null;
    // Taste zu einer Seite, die nicht im Browser gezeigt wird
    if (WEB && f.action === 'page' && f.page && !(state.pageList || []).some((p) => p.key === f.page)) return null;
    return h('button', { class: `fkey act-${f.action}${opts.vertical ? ' wide' : ''}${opts.active ? ' on' : ''}`,
      attrs: { type: 'button', 'data-fkey': f.action, 'data-test': opts.test || null, tabindex: opts.editing ? '-1' : null, 'aria-current': opts.active ? 'page' : null },
      on: { click: (ev) => { if (opts.editing) return; ev.stopPropagation(); runFkey(f, ev.currentTarget); } } },
      key ? h('span', { class: 'fk', text: key }) : null,
      // Sprache: Flagge der Sprache, die die Taste zeigt (ab drei Sprachen die aktuelle)
      h('span', { class: 'fl' }, f.action === 'lang' && projectLangs().length > 1 ? flagSvg(projectLangs().length > 2 ? curLang() : nextLangCode()) : null, fkeyLabel(f)));
  }

  const pcClockText = () => new Date().toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  setInterval(() => document.querySelectorAll('.vclock').forEach((n) => { n.textContent = pcClockText(); }), 5000);

  function connBadge() {
    const devs = state.devices.filter((d) => d.enabled !== false);
    const st = !state.online ? 'off' : devs.length ? lampOf(devs, (d) => (d.state === 'online' ? true : d.state === 'offline' || d.state === 'auth' ? false : null)) : 'ok';
    return h('span', { class: `vconn st-${st}`, attrs: { 'data-test': 'bar-conn' } }, h('span', { class: 'dot' }), L(`conn.${st}`));
  }

  function barItem(it, page, opts) {
    const ph = (text) => (opts.edit || opts.preview ? h('span', { class: 'vph', text }) : null);
    if (it.type === 'logo') {
      // eigenes Logo fürs dunkle Design (freiwillig): beide Bilder, CSS zeigt das passende – auch bei „Automatisch“
      if (!it.img) return ph(L('type.logo'));
      const img = (src, cls) => h('img', { class: `vlogo${cls}`, attrs: { src: imgUrl(src), alt: L('type.logo'), draggable: 'false' } });
      return it.imgDark ? h('span', { class: 'vlogos' }, img(it.img, ' for-light'), img(it.imgDark, ' for-dark')) : img(it.img, '');
    }
    if (it.type === 'title') return h('span', { class: 'vtitle', text: page.name || '' });
    if (it.type === 'clock') return h('span', { class: 'vclock mono', text: pcClockText() });
    if (it.type === 'conn') return connBadge();
    if (it.type === 'text') return it.text ? h('span', { class: 'vtext', text: it.text }) : ph(L('type.text'));
    if (it.type === 'spacer') return h('span', { class: 'vspacer' });
    if (it.type === 'pagekeys') {
      return h('span', { class: 'vkeys' }, ...pageNames().map((p) => fkeyNode({ action: 'page', page: p.key, label: p.name }, opts.pageKeys[p.key],
        Object.assign({}, opts, { active: p.key === page.id, test: `pagekey-${p.key}` }))));
    }
    if (it.type === 'fkey') return fkeyNode(it, it.key, Object.assign({}, opts, { test: `barkey-${it.id}` }));
    if (it.type === 'alarms') return alarmLine(opts);
    if (it.type === 'login') return authOn() || opts.edit || opts.preview ? loginBadge(opts) : null;
    if (it.type === 'lang') return langKey(opts);
    return null;
  }

  /** eine Leiste; opts: { preview (Editor, nur ansehen), edit (Reiter „Leisten“), pageKeys } */
  function renderBar(pos, bar, page, opts) {
    const vertical = pos === 'left' || pos === 'right';
    const o = Object.assign({ vertical, editing: !!(opts.edit || opts.preview) }, opts);
    const node = h('div', { class: `vbar vbar-${pos}${opts.edit ? ' editbar' : ''}`,
      attrs: { 'data-bar': pos, inert: opts.preview ? true : null, role: 'toolbar', 'aria-label': L(`pos.${pos}`) } });
    node.style[vertical ? 'width' : 'height'] = `${BAR_PX[pos]}px`;
    for (const it of bar.items) {
      const n = barItem(it, page, o);
      if (!opts.edit) { if (n) node.append(n); continue; }
      const sel = ed.sel.type === 'baritem' && ed.sel.id === it.id;
      node.append(h('div', { class: `baritem t-${it.type}${sel ? ' sel' : ''}`, attrs: { 'data-bar-item': it.id, title: L(`type.${it.type}`) },
        on: { click: (ev) => { ev.stopPropagation(); select({ type: 'baritem', pos, id: it.id }); } } }, n || h('span', { class: 'vph', text: L(`type.${it.type}`) })));
    }
    if (opts.edit) {
      if (!bar.items.length) node.append(h('span', { class: 'vph', text: L('empty') }));
      node.classList.toggle('sel', ed.sel.type === 'bars' && ed.sel.pos === pos);
      node.addEventListener('click', () => select({ type: 'bars', pos }));
    }
    return node;
  }

  /** Bildschirm: Leisten rund um die Kartenfläche (grid); im Editor liegt die untere Leiste im Raster (opts.bottomInGrid) */
  function screenNode(grid, page, area, opts) {
    const b = area.bars;
    const bar = (pos) => (b[pos] ? renderBar(pos, b[pos], page, opts) : null);
    grid.dataset.bw = String(area.bw);
    grid.dataset.bh = String(area.bh);
    if (opts.bottomInGrid && b.bottom) {
      const bottom = bar('bottom');
      bottom.classList.add('ingrid');
      Object.assign(bottom.style, { top: `${area.h}px`, left: `${-(b.left ? BAR_PX.left : 0)}px`, right: `${-(b.right ? BAR_PX.right : 0)}px` });
      grid.append(bottom);
    }
    // schmale Seite (Handy): obere/untere Leiste bleibt so breit wie die Seite und bricht in eine zweite Zeile um
    const narrow = area.w < 700;
    const row = (pos) => { const n = bar(pos); if (n && narrow) { n.classList.add('wrap'); n.style.width = `${area.w + area.bw}px`; n.style.minHeight = n.style.height; n.style.height = ''; } return n; };
    return h('div', { class: `screen${narrow ? ' narrow' : ''}` }, row('top'), h('div', { class: 'vmid' }, bar('left'), grid, bar('right')), opts.bottomInGrid ? null : row('bottom'));
  }

  const entryOf = (e) => (state.values[e.dev] || {})[e.name];
  const valueOf = (e) => { const x = entryOf(e); return x ? x.value : null; };
  const fmt = (n) => (typeof n === 'number' ? n.toLocaleString('de-DE', { maximumFractionDigits: 3, useGrouping: false }) : '–');
  // Skalen: Einheit am oberen Ende („100 %“)
  const withUnit = (n, unit) => `${fmt(n)}${unit ? ` ${unit}` : ''}`;
  // mit festen Nachkommastellen der Variablen (z. B. 2,50 bar), sonst wie fmt
  const fmtD = (n, d) => (typeof n === 'number' && d !== undefined ? n.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: false }) : fmt(n));

  // Rückmeldungen („wird gesendet“, „übernommen“, „meldet weiterhin …“) nur mit „Hinweise für die Inbetriebnahme“;
  // ein fehlgeschlagener Schreibbefehl wird immer gemeldet: als Hinweis unten (toast) und mit „!“ am Element –
  // der Text am Element nur mit Inbetriebnahme-Hinweisen (auf kleinen Seiten ist dort kein Platz)
  function feedback(e) {
    const w = writes[wkey(e)];
    if (!w || !options.commissioning) return null;
    const P = (k) => T(`ui.page.${k}`);
    const busy = w.status === 'sending' || w.status === 'waiting';
    const cls = w.status === 'done' ? 'ok' : busy ? 'muted' : w.status === 'unconfirmed' ? 'warn' : 'err';
    const text = busy ? P('sending') : w.status === 'done' ? `✓ ${P('done')}` : w.text || P('failed');
    return h('div', { class: `feedback ${cls}`, text });
  }

  function renderElement(e) {
    const P = (k, a) => T(`ui.page.${k}`, a);
    const editing = state.view === 'editor';
    if (e.kind === 'fkey') {
      return h('div', { class: 'element el-fkey', attrs: { 'data-eid': e.id } }, fkeyNode(e, e.key, { editing, test: `fkey-${e.id}` }));
    }
    if (e.kind === 'image') {
      // Bild füllt seinen Platz; Wechselbild: das Bild zum aktuellen Wert, sonst das Grundbild; ohne Bild im Editor ein Hinweis
      const row = e.name && e.map && !e.missing ? stateRow(e) : null;
      const img = (row && row.img) || e.img;
      return h('div', { class: `element el-image fit-${e.fit || 'contain'}${row && row.blink ? ' blink' : ''}`, attrs: { 'data-eid': e.id, 'data-el-of': e.name || null } },
        img ? h('img', { attrs: { src: imgUrl(img), alt: e.alt || '', draggable: 'false' } })
          : editing ? h('div', { class: 'imgempty muted small' }, h('span', { class: 'kglyph', text: GLYPHS.image }), T('ui.editor.image.placeholder')) : null);
    }
    if (e.kind === 'text') {
      const text = String(e.text || '').replace(/\{(\d+)\}/g, (m, n) => {
        const x = (e.vars || []).find((y) => y.n === Number(n));
        return x ? placeholderText(x) : m;
      });
      return h('div', { class: 'element el-text', attrs: { 'data-eid': e.id, inert: editing } },
        h('div', { class: `eltext size-${e.size || 'normal'} align-${e.align || 'left'}`, text }));
    }
    if (e.kind === 'device') return deviceElement(e, editing);
    if (e.kind === 'trend') return trendElement(e, editing);
    if (e.kind === 'alarms') return alarmsElement(e, editing);
    if (e.kind === 'lang') return langElement(e, editing);
    if (e.missing) {
      return h('div', { class: 'element el-missing', attrs: { 'data-eid': e.id, 'data-el-of': e.name, inert: editing } },
        h('div', { class: 'elrow' }, h('span', { class: 'kglyph', text: GLYPHS[e.kind] || '?' }),
          h('span', { class: 'ellabel', text: e.label || T(`ui.kinds.${e.kind}`) }),
          // nur im Editor ein Hinweis – auf der Bedienseite steht wie bei fehlendem Wert ein Strich
          editing ? h('span', { class: 'badge', text: P(e.name ? 'missing' : 'noVar') }) : h('span', { class: 'elvalue muted', text: '–' })));
    }
    const entry = entryOf(e);
    const w = writes[wkey(e)];
    // gerade geschrieben: Schalter/Sollwert zeigen schon den neuen Wert, bis die easyE4 ihn bestätigt (oder nicht)
    const pending = !!w && (w.status === 'sending' || w.status === 'waiting') && ['switch', 'setpoint', 'slider', 'choice'].includes(e.kind);
    const v = pending ? w.target : entry ? entry.value : null;
    const bad = entry && entry.quality === 'bad';
    const stale = !entry || entry.quality !== 'good';
    const locked = !devOnline(e.dev);
    let inner;
    if (e.kind === 'lamp' || e.kind === 'status') {
      // Werteliste: Text, Farbe, Symbol je Wert; ohne Eintrag: EIN/AUS bzw. die Zahl
      const on = !!v;
      const base = e.kind === 'lamp' ? { text: on ? P('on') : P('off'), color: on ? 'on' : 'off' }
        : { text: v === null || v === undefined ? '–' : typeof v === 'boolean' ? (v ? '1' : '0') : fmt(v), color: 'neutral' };
      const hit = stateRow(e) || e.other || null;
      const look = Object.assign(base, hit || {});
      const show = e.show || 'both';
      const icon = look.icon || e.icon;
      let mark = null;
      if (show !== 'text') {
        mark = icon ? h('span', { class: `elsym c-${look.color}${look.color === 'off' ? '' : ' lit'}`, html: SYM.svg(icon, 28), attrs: { 'aria-hidden': 'true' } })
          : e.kind === 'lamp' ? h('span', { class: `lamp c-${look.color} ${look.color === 'off' ? 'dark' : 'lit'}`, attrs: { 'aria-hidden': 'true' } }) : null;
      }
      inner = h('div', { class: `elrow${hit && hit.blink ? ' blink' : ''}` }, mark,
        h('span', { class: 'ellabel', text: e.label }),
        show !== 'symbol' || !mark ? h('span', { class: `elvalue c-${look.color}`, text: bad ? '–' : look.text }) : null);
    } else if (e.kind === 'number' || e.kind === 'clock') {
      let text = fmtD(v, e.decimals);
      let warn = null;
      if (e.kind === 'clock') {
        const c = clockOf(e, v);
        text = (c && clockShow(c, e.clockFmt)) || '–';
        const drift = e.clockWarn && c ? clockDrift(c) : null;
        if (drift !== null && Math.abs(drift) >= 1) warn = P('clockDrift', { n: Math.abs(drift) });
      }
      const row = e.kind === 'number' ? matchMap(e, v) : null;
      if (row && row.text) text = row.text;
      inner = h('div', { class: 'elnumber' },
        h('div', { class: 'ellabel', text: e.label }),
        h('div', { class: `bignum${row && row.color ? ` c-${row.color}` : ''}` }, row && row.icon ? h('span', { class: 'elsym', html: SYM.svg(row.icon, 26) }) : null,
          h('span', { class: 'mono', text: bad ? '–' : text }), e.unit && e.kind !== 'clock' && !(row && row.text) ? h('span', { class: 'unit', text: e.unit }) : null,
          warn ? h('span', { class: 'clockwarn', text: '⚠', attrs: { title: warn, 'aria-label': warn, 'data-test': 'clock-warn' } }) : null));
    } else if (e.kind === 'switch') {
      const on = !!v;
      const onText = e.onText || P('on');
      const offText = e.offText || P('off');
      if (e.style === 'buttons') {
        // zwei Textknöpfe nebeneinander, der aktive ist hervorgehoben
        inner = h('div', { class: 'elrow' },
          h('span', { class: 'ellabel', text: e.label }),
          h('div', { class: `seg switchseg${pending ? ' pending' : ''}`, attrs: { role: 'group', 'aria-label': e.label || e.ariaLabel } },
            ...[[0, offText], [1, onText]].map(([val, text]) => h('button', { class: (on ? 1 : 0) === val ? 'on' : '', text,
              attrs: { 'aria-pressed': String((on ? 1 : 0) === val), disabled: locked || bad, 'data-test': `switch-${e.name}-${val}` },
              on: { click: () => { if ((on ? 1 : 0) !== val) sendValue(e, val); } } }))));
      } else {
        inner = h('div', { class: 'elrow' },
          h('span', { class: 'ellabel', text: e.label }),
          h('button', { class: `switch ${on ? 'on' : ''}${pending ? ' pending' : ''}`, attrs: { role: 'switch', 'aria-checked': String(on), 'aria-label': e.label || e.ariaLabel, disabled: locked || bad, 'data-test': `switch-${e.name}` },
            on: { click: () => sendValue(e, on ? 0 : 1) } }, h('span', { class: 'knob' })),
          h('span', { class: `elvalue ${on ? 'state-on' : 'state-off'}`, text: on ? onText : offText }));
      }
    } else if (e.kind === 'button') {
      // Rückmeldung im Taster: nur bei einem Fehler rot mit „!“ (Grund steht unten); kein Kreisel/Haken mehr (Ralf 04.11.2026);
      // Leuchttaster: leuchtet, solange die Rückmelde-Variable 1 ist
      // rastend: jeder Druck schaltet um; ohne Rückmelde-Variable leuchtet er mit der eigenen Variablen
      const tip = e.mode === 'tip';
      const toggle = e.mode === 'toggle';
      const w = writes[wkey(e)];
      const st = w && w.status === 'failed' ? 'err' : '';
      const fbv = e.fb && !e.fb.missing ? ((state.values[e.fb.dev] || {})[e.fb.name] || {}).value : toggle ? v : null;
      const lit = fbv === true || Number(fbv) === 1;
      const own = v === true || Number(v) === 1;
      const btn = h('button', { class: `btn press${tip ? ' tip' : ''}${st ? ` st-${st}` : ''}${lit ? ` lit lit-${e.fbColor || 'on'} txt-${litText(e)}` : ''}`,
        attrs: { disabled: locked || bad, 'data-test': `button-${e.name}`, 'data-sent': w && w.status === 'done' ? 'true' : null, 'data-lit': e.fb || toggle ? String(lit) : null,
          'aria-pressed': toggle ? String(!!own) : null },
        on: tip ? {} : { click: () => { buzz(); sendValue(e, toggle ? (own ? 0 : 1) : 1); } } }, h('span', { class: 'presslabel', text: e.label }),
        st ? h('span', { class: 'pressst', attrs: { 'aria-hidden': 'true' }, text: '!' }) : null);
      if (tip) tipHandlers(btn, e);
      inner = h('div', { class: 'elrow' }, btn);
    } else if (e.kind === 'setpoint') {
      inner = setpointElement(e, v, locked || bad);
    } else if (e.kind === 'bar') {
      inner = barElement(e, v, bad);
    } else if (e.kind === 'gauge') {
      inner = gaugeElement(e, v, bad);
    } else if (e.kind === 'slider') {
      inner = sliderElement(e, v, locked || bad, pending);
    } else if (e.kind === 'kpi') {
      inner = kpiElement(e, v, bad);
    } else if (e.kind === 'choice') {
      inner = choiceElement(e, v, locked || bad, pending);
    }
    return h('div', { class: `element el-${e.kind}${stale && !bad ? ' stale' : ''}${locked ? ' locked' : ''}`, attrs: { 'data-eid': e.id, 'data-el-of': e.name, inert: editing, title: bad ? entry.error : null } },
      inner, bad && options.commissioning ? h('div', { class: 'feedback err', text: entry.error }) : feedback(e));
  }

  function setpointElement(e, v, locked) {
    const P = (k, a) => T(`ui.page.${k}`, a);
    const k = wkey(e);
    const deb = debounce[k];
    const shown = deb ? deb.value : v;
    const input = h('input', { class: 'input mono spin', value: shown === null || shown === undefined ? '' : fmtD(shown, e.decimals),
      attrs: { inputmode: 'decimal', 'aria-label': e.label || e.ariaLabel, disabled: locked, 'data-test': `setpoint-${e.name}` },
      on: {
        input: (ev) => { ev.target.dataset.dirty = '1'; updateApply(ev.target); },
        keydown: (ev) => { if (ev.key === 'Enter') applyTyped(e, ev.target); if (ev.key === 'Escape') { delete ev.target.dataset.dirty; updateElement(e.dev, e.name, true); } },
      } });
    const step = (dir) => {
      const cur = debounce[k] ? debounce[k].value : Number(valueOf(e)) || 0;
      const next = Math.min(e.max, Math.max(e.min, cur + dir * (e.step || 1)));
      clearTimeout(debounce[k] && debounce[k].timer);
      // Anzeige springt sofort, gesendet wird erst nach kurzer Pause – und nur der letzte Wert
      debounce[k] = { value: next, timer: setTimeout(() => { delete debounce[k]; sendValue(e, next); }, 800) };
      updateElement(e.dev, e.name, true);
    };
    // „Übernehmen“ hat immer seinen Platz (nur unsichtbar), damit das Element beim Tippen nicht springt
    const applyBtn = h('button', { class: 'btn small primary apply', text: P('apply'), attrs: { tabindex: '-1', 'aria-hidden': 'true' },
      on: { click: () => applyTyped(e, input) } });
    function updateApply(el) {
      const on = !!el.dataset.dirty;
      applyBtn.classList.toggle('show', on);
      applyBtn.tabIndex = on ? 0 : -1;
      applyBtn.setAttribute('aria-hidden', on ? 'false' : 'true');
    }
    return h('div', { class: 'elsetpoint' },
      h('div', { class: 'ellabel', text: e.label }),
      h('div', { class: 'spinrow' },
        h('button', { class: 'iconbtn big', text: '−', attrs: { 'aria-label': P('decrease'), disabled: locked, 'data-test': `minus-${e.name}` }, on: { click: () => step(-1) } }),
        h('div', { class: 'spinbox' }, input, e.unit ? h('span', { class: 'unit', text: e.unit }) : null),
        h('button', { class: 'iconbtn big', text: '+', attrs: { 'aria-label': P('increase'), disabled: locked, 'data-test': `plus-${e.name}` }, on: { click: () => step(1) } })),
      h('div', { class: 'inline' }, h('span', { class: 'hint', text: P('range', { min: fmt(e.min), max: fmt(e.max) }) }), applyBtn));
  }

  // ---------------------------------------------------------------- Balken, Zeigerinstrument, Schieberegler
  const shareOf = (e, n) => (e.max === e.min ? 0 : Math.max(0, Math.min(1, (n - e.min) / (e.max - e.min))));
  const numOk = (v, bad) => !bad && v !== null && v !== undefined && typeof v !== 'object' && Number.isFinite(Number(v));

  /**
   * Skalenteilung mit „runden“ Schritten (1, 2, 2,5, 5 × 10^k): Hauptstriche mit Zahl, dazwischen Hilfsstriche.
   * Gibt Anteile 0…1 zurück: major [{ f, n }], minor [f]
   */
  function scaleTicks(min, max, want) {
    const lo = Math.min(min, max);
    const hi = Math.max(min, max);
    if (!(hi > lo)) return { major: [{ f: 0, n: min }], minor: [] };
    // bevorzugt ein Schritt, der Anfang und Ende genau trifft (3–8 Teile, möglichst nah an want), sonst der nächste runde
    const raw = (hi - lo) / want;
    const p0 = 10 ** Math.floor(Math.log10(raw));
    let best = null;
    for (const p of [p0 / 10, p0, p0 * 10]) {
      for (const m of [1, 2, 2.5, 5]) {
        const parts = (hi - lo) / (m * p);
        const exact = Math.abs(parts - Math.round(parts)) < 1e-6 && Math.abs(lo / (m * p) - Math.round(lo / (m * p))) < 1e-6;
        if (parts < 3 - 1e-9 || parts > 8 + 1e-9) continue;
        const score = (exact ? 0 : 10) + Math.abs(parts - want);
        if (!best || score < best.score) best = { m, p, score };
      }
    }
    const m = best ? best.m : 1;
    const step = m * (best ? best.p : p0);
    const sub = step / (m === 2 ? 4 : 5);
    const eps = step * 1e-6;
    const frac = (n) => (n - min) / (max - min);
    const round = (n) => Math.round(n / sub) * sub;
    const major = [];
    const minor = [];
    for (let n = Math.ceil((lo - eps) / sub) * sub; n <= hi + eps; n += sub) {
      const x = Number(round(n).toPrecision(12));
      const isMajor = Math.abs(x / step - Math.round(x / step)) < 1e-6;
      if (isMajor) major.push({ f: frac(x), n: x });
      else minor.push(frac(x));
    }
    return { major, minor };
  }

  /** Skala am Balken: Striche und Zahlen mit Einheit, absolut nach Anteil platziert */
  function barTicks(e, vertical) {
    const { major, minor } = scaleTicks(e.min, e.max, vertical ? 4 : 5);
    const pos = (el, f) => {
      if (vertical) el.style.bottom = `${(f * 100).toFixed(2)}%`;
      else el.style.left = `${(f * 100).toFixed(2)}%`;
      return el;
    };
    const items = [];
    for (const f of minor) items.push(pos(h('span', { class: 'btick' }), f));
    for (const m of major) {
      items.push(pos(h('span', { class: 'btick major' }), m.f));
      const edge = m.f < 0.02 ? ' first' : m.f > 0.98 ? ' last' : '';
      items.push(pos(h('span', { class: `blabel${edge}`, text: withUnit(m.n, e.unit) }), m.f));
    }
    const box = h('div', { class: `barticks ${vertical ? 'v' : 'h'}`, attrs: { 'aria-hidden': 'true', 'data-test': 'bar-ticks' } }, ...items);
    // senkrecht: Platz für die längste Zahl (die Zahlen sind absolut platziert und geben selbst keine Breite vor)
    if (vertical) box.style.width = `calc(${Math.max(...major.map((m) => withUnit(m.n, e.unit).length))}ch + 14px)`;
    return box;
  }

  /**
   * Wert neben Balken/Schieberegler immer gleich breit (so breit wie die längste Zahl der Skala), damit der Balken
   * nicht länger wird, wenn der Wert z. B. von 10 auf 9 geht (Ralf 08.11.2026)
   */
  function steadyWidth(span, e) {
    const n = Math.max(...[e.min, e.max].map((x) => fmtD(Number(x), e.decimals).length), 1);
    span.style.minWidth = `${n}ch`;
    span.style.display = 'inline-block';
    span.style.textAlign = 'right';
    return span;
  }

  /** Balkenanzeige: Anteil zwischen min und max; Farbe aus der Werteliste (sonst Akzent).
   *  bw = Breite ('m' mittel, 'l' breit, fehlt = schmal), valpos = Wert 'top' | 'bottom' | 'side' | 'none'
   *  (fehlt: waagerecht oben, senkrecht seitlich), ticks 'off' = nur Anfang und Ende statt Skalenstrichen */
  function barElement(e, v, bad) {
    const has = numOk(v, bad);
    const n = has ? Number(v) : e.min;
    const row = has ? matchMap(e, n) : null;
    const text = has ? (row && row.text) || fmtD(n, e.decimals) : '–';
    const vert = e.orient === 'v';
    const fill = h('div', { class: `barfill c-${row && row.color ? row.color : 'accent'}` });
    const p = `${(shareOf(e, n) * 100).toFixed(1)}%`;
    if (vert) fill.style.height = p;
    else fill.style.width = p;
    const pos = ['top', 'bottom', 'side', 'none'].includes(e.valpos) ? e.valpos : vert ? 'side' : 'top';
    const num = h('span', { class: 'mono', text });
    if (pos === 'side' && !(row && row.text)) steadyWidth(num, e);
    const value = pos === 'none' ? null : h('div', { class: `bignum barval ${pos}${row && row.color ? ` c-${row.color}` : ''}` }, num,
      e.unit && !(row && row.text) ? h('span', { class: 'unit', text: e.unit }) : null);
    const track = h('div', { class: `bartrack ${vert ? 'v' : 'h'} bw-${e.bw === 'm' || e.bw === 'l' ? e.bw : 's'}`,
      attrs: { role: 'meter', 'aria-label': e.label || e.ariaLabel, 'aria-valuemin': e.min, 'aria-valuemax': e.max, 'aria-valuenow': n } }, fill);
    const ticks = e.ticks !== 'off';
    const plain = vert
      ? h('div', { class: 'barscale v' }, h('span', { text: withUnit(e.max, e.unit) }), h('span', { text: fmt(e.min) }))
      : h('div', { class: 'barscale' }, h('span', { text: fmt(e.min) }), h('span', { text: withUnit(e.max, e.unit) }));
    const scale = ticks ? barTicks(e, vert) : plain;
    const label = h('span', { class: 'ellabel', text: e.label });
    if (vert) {
      const col = h('div', { class: 'barcol' }, pos === 'top' ? value : null, h('div', { class: 'barrow' }, scale, track, pos === 'side' ? value : null),
        pos === 'bottom' ? value : null);
      return h('div', { class: `elbar v${ticks ? ' ticked' : ''}` }, h('div', { class: 'ellabel', text: e.label }), col);
    }
    if (pos === 'top') return h('div', { class: `elbar h${ticks ? ' ticked' : ''}` }, h('div', { class: 'barhead' }, label, value), track, scale);
    if (pos === 'side') {
      return h('div', { class: `elbar h${ticks ? ' ticked' : ''}` }, h('div', { class: 'barhead' }, label),
        h('div', { class: 'barside' }, h('div', { class: 'barmain' }, track, scale), value));
    }
    return h('div', { class: `elbar h${ticks ? ' ticked' : ''}` }, h('div', { class: 'barhead' }, label), track, scale, value);
  }

  const SVGNS = 'http://www.w3.org/2000/svg';
  function svgEl(tag, attrs) {
    const el = document.createElementNS(SVGNS, tag);
    for (const [k, val] of Object.entries(attrs || {})) if (val !== null && val !== undefined) el.setAttribute(k, String(val));
    return el;
  }

  /** Zeigerinstrument: Dreiviertelkreis (270°), farbige Bereiche aus der Werteliste (Zeilen „von … bis“) */
  function gaugeElement(e, v, bad) {
    const out = e.ticks === 'out'; // Striche und Zahlen außen am Bogen, sonst beide innen (Ralf 08.11.2026)
    const cx = 100;
    const cy = 96;
    const r = out ? 48 : 74; // außen: Zahlen auf Radius 75; innen: Bogen fast bis zum Rand, Zahlen innerhalb der Striche
    const start = 135;
    const sweep = 270;
    const pt = (deg, rad) => [cx + rad * Math.cos((deg * Math.PI) / 180), cy + rad * Math.sin((deg * Math.PI) / 180)];
    const arc = (f0, f1) => {
      const d0 = start + sweep * f0;
      const d1 = start + sweep * f1;
      const [x0, y0] = pt(d0, r);
      const [x1, y1] = pt(d1, r);
      return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${d1 - d0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
    };
    const svg = svgEl('svg', { viewBox: '14 10 172 166', class: 'gaugesvg', 'aria-hidden': 'true' }); // eng um Bogen, Striche und Zahlen
    // Tiefe „leicht“: Grundlinie und Farbband liegen in einer Gruppe mit grauem Innenschatten (eingelassen)
    const defs = svgEl('defs');
    const fl = svgEl('filter', { id: 'e4gin', x: '-10%', y: '-10%', width: '120%', height: '120%' });
    fl.append(svgEl('feOffset', { in: 'SourceAlpha', dx: 0, dy: 2.5 }), svgEl('feGaussianBlur', { stdDeviation: 1.8, result: 'o' }),
      svgEl('feComposite', { operator: 'out', in: 'SourceAlpha', in2: 'o', result: 'inv' }), svgEl('feFlood', { class: 'ginflood' }),
      svgEl('feComposite', { operator: 'in', in2: 'inv' }), svgEl('feComposite', { operator: 'over', in2: 'SourceGraphic' }));
    defs.append(fl);
    svg.append(defs);
    const band = svgEl('g', { class: 'gband' });
    svg.append(band);
    band.append(svgEl('path', { d: arc(0, 1), class: 'gtrack' }));
    // ohne Farbbereiche: Tiefe „leicht“ zeigt das ganze Band in der Akzentfarbe (sonst nur graue Grundlinie)
    if (!(e.map || []).some((row) => row.color && row.to !== undefined && row.to !== null)) band.append(svgEl('path', { d: arc(0, 1), class: 'gzone c-accent gplain' }));
    for (const row of e.map || []) {
      if (!row.color || row.to === undefined || row.to === null) continue;
      const f0 = shareOf(e, Math.min(row.from, row.to));
      const f1 = shareOf(e, Math.max(row.from, row.to));
      // Tiefe „leicht“: der Bereich, in dem der Zeiger steht, leuchtet (Klasse on), die anderen treten zurück
      const nowIn = numOk(v, bad) && Number(v) >= Math.min(row.from, row.to) && Number(v) <= Math.max(row.from, row.to);
      if (f1 > f0) band.append(svgEl('path', { d: arc(f0, f1), class: `gzone c-${row.color}${nowIn ? ' on' : ''}` }));
    }
    // Skala: Hauptstriche mit Zahl, dazwischen Hilfsstriche – innen oder außen am Bogen
    const { major, minor } = scaleTicks(e.min, e.max, 5);
    const tick = (frac, len, cls) => {
      const d = start + sweep * frac;
      const [x0, y0] = pt(d, out ? r + 10 : r - 10);
      const [x1, y1] = pt(d, out ? r + 10 + len : r - 10 - len);
      svg.append(svgEl('line', { x1: x0.toFixed(2), y1: y0.toFixed(2), x2: x1.toFixed(2), y2: y1.toFixed(2), class: cls }));
    };
    for (const f of minor) tick(f, 5, 'gtick');
    for (const m of major) tick(m.f, 10, 'gtick major');
    const has = numOk(v, bad);
    const n = Number(v);
    const row = has ? matchMap(e, n) : null;
    if (has) {
      const [nx, ny] = pt(start + sweep * shareOf(e, n), r - 8);
      svg.append(svgEl('line', { x1: cx, y1: cy, x2: nx.toFixed(2), y2: ny.toFixed(2), class: `gneedle c-${row && row.color ? row.color : 'neutral'}` }));
      // Tiefe „leicht“: spitzer Zeiger mit Schatten (bei „flach“ ausgeblendet, dann gilt die Linie)
      // spitzer Zeiger: Spitze im Farbband (endet vor dessen Außenkante), am Kreis 3 breit
      const a = ((start + sweep * shareOf(e, n)) * Math.PI) / 180;
      const tip = r + 5; // fast bis zur Außenkante des Farbbands (halbe Breite 6)
      const px = -Math.sin(a) * 1.6;
      const py = Math.cos(a) * 1.6;
      const pts = [[cx + Math.cos(a) * tip, cy + Math.sin(a) * tip], [cx + px, cy + py], [cx - px, cy - py]].map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
      svg.append(svgEl('polygon', { points: pts, class: `gneedle2 c-${row && row.color ? row.color : 'neutral'}` }));
    }
    const hubColor = has && row && row.color ? row.color : 'neutral';
    svg.append(svgEl('circle', { cx, cy, r: 6, class: `ghub c-${hubColor}` })); // Tiefe „leicht“: Ring in der Farbe des Bereichs
    svg.append(svgEl('circle', { cx: cx - 2.4, cy: cy - 2.4, r: 2.2, class: 'ghl' })); // Glanzpunkt (nur Tiefe „leicht“)
    // Zahlen mit Einheit hinter den Strichen: außen bzw. innen
    for (const m of major) {
      const d = start + sweep * m.f;
      const [x, y] = pt(d, out ? r + 27 : r - 29);
      const c = Math.cos((d * Math.PI) / 180);
      const far = out ? 'end' : 'start';
      const near = out ? 'start' : 'end';
      const el = svgEl('text', { x: x.toFixed(2), y: y.toFixed(2), 'text-anchor': c < -0.3 ? far : c > 0.3 ? near : 'middle', 'dominant-baseline': 'middle', class: 'gscale' });
      // Einheit als eigener Teil: bei Tiefe „leicht“ ausgeblendet (die Einheit steht unter dem Wert)
      el.append(document.createTextNode(fmt(m.n)));
      if (e.unit) { const u = svgEl('tspan', { class: 'gsu' }); u.textContent = ` ${e.unit}`; el.append(u); }
      svg.append(el);
    }
    const text = has ? (row && row.text) || fmtD(n, e.decimals) : '–';
    // Tiefe „leicht“: Wert und Einheit im Bild selbst, genau zwischen den unteren Enden des Bogens – so stoßen sie nie
    // an die Zahlen der Skala, egal wie groß das Instrument ist (Ralf 08.11.2026); bei „flach“ wie bisher darunter
    const sv = svgEl('g', { class: `gsvgval${row && row.color ? ` c-${row.color}` : ''}` });
    const tv = svgEl('text', { x: cx, y: out ? 140 : 150, 'text-anchor': 'middle', 'dominant-baseline': 'middle', class: 'gsvnum' });
    tv.textContent = text;
    sv.append(tv);
    if (e.unit && !(row && row.text)) {
      const tu = svgEl('text', { x: cx, y: out ? 157 : 168, 'text-anchor': 'middle', 'dominant-baseline': 'middle', class: 'gsvunit' });
      tu.textContent = e.unit;
      sv.append(tu);
    }
    svg.append(sv);
    return h('div', { class: `elgauge${out ? ' tout' : ''}` }, h('div', { class: 'ellabel', text: e.label }),
      h('div', { class: 'gaugebox', attrs: { role: 'meter', 'aria-label': e.label || e.ariaLabel, 'aria-valuemin': e.min, 'aria-valuemax': e.max, 'aria-valuenow': has ? n : e.min } }, svg,
        h('div', { class: `gaugeval${row && row.color ? ` c-${row.color}` : ''}` }, h('span', { class: 'mono', text }),
          e.unit && !(row && row.text) ? h('span', { class: 'unit', text: e.unit }) : null)));
  }

  /** KPI-Kachel: Beschriftung klein darüber, großer Wert mit Einheit, darunter Variable · Operand · Gerät */
  function kpiElement(e, v, bad) {
    const has = numOk(v, bad);
    const row = has ? matchMap(e, Number(v)) : null;
    const text = has ? (row && row.text) || fmtD(Number(v), e.decimals) : '–';
    return h('div', { class: 'elkpi' }, h('div', { class: 'kpilabel', text: e.label }),
      h('div', { class: `bignum kpinum${row && row.color ? ` c-${row.color}` : ''}` }, row && row.icon ? h('span', { class: 'elsym', html: SYM.svg(row.icon, 30) }) : null,
        h('span', { class: 'mono', text }), e.unit && !(row && row.text) ? h('span', { class: 'unit', text: e.unit }) : null),
      e.noAddr ? null : h('div', { class: 'kpiaddr mono', text: [e.varName, e.operand, e.deviceName].filter(Boolean).join(' · ') }));
  }

  /** Betriebsart: je Knopf ein Wert (Standard Aus 0 / Hand 1 / Automatik 2), der aktuelle ist hervorgehoben */
  function choiceElement(e, v, locked, pending) {
    const P = (k, a) => T(`ui.page.${k}`, a);
    const cur = numOk(v, false) ? Number(v) : null;
    const opts = e.opts || [];
    const seg = h('div', { class: `seg choiceseg${pending ? ' pending' : ''}`, attrs: { role: 'group', 'aria-label': e.label || e.ariaLabel } },
      ...opts.map((o) => h('button', { class: cur === o.v ? 'on' : '', text: o.t || fmt(o.v),
        attrs: { 'aria-pressed': String(cur === o.v), disabled: locked, 'data-test': `choice-${e.name}-${o.v}` },
        on: { click: () => { if (cur !== o.v) sendValue(e, o.v); } } })));
    seg.style.gridTemplateColumns = `repeat(${Math.max(1, opts.length)}, minmax(0, 1fr))`;
    return h('div', { class: 'elchoice' }, h('div', { class: 'ellabel', text: e.label }), seg,
      cur !== null && !opts.some((o) => o.v === cur) ? h('div', { class: 'hint', text: P('choiceOther', { v: fmt(cur) }) }) : null);
  }

  // ---------------------------------------------------------------- Gerätekarte
  const PROTO_SHORT = { modbus: 'MODBUS', json: 'WEBSERVER', mqtt: 'MQTT' }; // „JSON“ nirgends zeigen: es ist immer der Webserver
  /** Zeitpunkt der letzten erfolgreichen Abfrage je Gerät (wird auf der Gerätekarte nicht angezeigt – „verbunden“ reicht) */
  function onSeen(m) {
    state.seen = Object.assign(state.seen || {}, m);
  }

  /** Gerätekarte: Protokoll, Adresse, Firmware, online/offline, letzter Wert, optional Lebenszeichen-Zähler */
  function deviceElement(e, editing) {
    const P = (k, a) => T(`ui.page.${k}`, a);
    const d = state.devices.find((x) => x.id === e.dev);
    if (!d) {
      return h('div', { class: 'element el-device el-missing', attrs: { 'data-eid': e.id, inert: editing } },
        h('div', { class: 'elrow' }, h('span', { class: 'kglyph', text: GLYPHS.device }), h('span', { class: 'ellabel', text: e.label || T('ui.kinds.device') }),
          editing ? h('span', { class: 'badge', text: P('devChoose') }) : h('span', { class: 'elvalue muted', text: '–' })));
    }
    const online = d.state === 'online';
    const look = online ? 'on' : ['idle', 'disabled', 'unknown'].includes(d.state) ? 'off' : 'alarm';
    // nur IP-Adresse und Port (bei MQTT die des Brokers) – kein Topic, keine Firmware (Ralf 06.11.2026)
    const info = address(d);
    const hb = e.name ? entryOf(e) : null;
    return h('div', { class: `element el-device st-${look}`, attrs: { 'data-eid': e.id, 'data-dev-card': d.id, inert: editing } },
      h('div', { class: 'devrow' },
        h('span', { class: `devproto p-${d.protocol}`, text: PROTO_SHORT[d.protocol] || d.protocol }),
        // zwei Zeilen: Name und Verbindungsstatus auf gleicher Höhe, darunter Adresse und (falls gewählt) Lebenszeichen
        h('span', { class: 'devmain' },
          h('span', { class: 'devline' }, h('span', { class: 'devname', text: e.label || d.name }),
            h('span', { class: `devonline c-${look}` }, h('span', { class: `dot${online ? ' pulse' : ''}`, attrs: { 'aria-hidden': 'true' } }), d.stateText || '')),
          h('span', { class: 'devline' }, h('span', { class: 'devinfo mono', text: info }),
            e.name ? h('span', { class: 'devlife mono', attrs: { title: P('heartbeat', { v: e.heartbeat || e.name }), 'data-test': 'dev-life' },
              text: `♥ ${hb && hb.quality === 'good' ? fmt(hb.value) : '–'}` }) : null))));
  }

  // ---------------------------------------------------------------- Sprachen und Texte (Version 1, Punkt 5)
  const LG = (k, a) => T(`ui.langs.${k}`, a);
  const LANG_NAMES = { de: 'Deutsch', en: 'English', fr: 'Français', it: 'Italiano', es: 'Español', pt: 'Português', nl: 'Nederlands', pl: 'Polski',
    cs: 'Čeština', sk: 'Slovenčina', hu: 'Magyar', ro: 'Română', hr: 'Hrvatski', sl: 'Slovenščina', da: 'Dansk', sv: 'Svenska', no: 'Norsk',
    fi: 'Suomi', tr: 'Türkçe', ru: 'Русский', uk: 'Українська', el: 'Ελληνικά', zh: '中文', ja: '日本語' };
  const langName = (c) => LANG_NAMES[String(c).slice(0, 2)] || c;
  const curLang = () => (state.langState && state.langState.lang) || 'de';
  const projectLangs = () => (state.langState && state.langState.langs) || ['de'];
  const nextLangCode = () => { const l = projectLangs(); return l[(l.indexOf(curLang()) + 1) % l.length]; };

  /**
   * Kleine Flagge je Sprache (vereinfacht, ohne Wappen) als SVG 30 × 20 – Emoji-Flaggen zeigt Windows nicht an.
   * Sprachen ohne Flagge: Kürzel in einem Kästchen.
   */
  const FLAG_H = { de: ['#000', '#DD0000', '#FFCE00'], nl: ['#AE1C28', '#fff', '#21468B'], ru: ['#fff', '#0039A6', '#D52B1E'], hu: ['#CE2939', '#fff', '#477050'],
    pl: ['#fff', '#DC143C'], sl: ['#fff', '#005DA4', '#ED1C24'], sk: ['#fff', '#0B4EA2', '#EE1C25'], hr: ['#FF0000', '#fff', '#171796'], uk: ['#0057B7', '#FFD700'],
    es: ['#AA151B', '#F1BF00', '#F1BF00', '#AA151B'] };
  const FLAG_V = { fr: ['#002395', '#fff', '#ED2939'], it: ['#009246', '#fff', '#CE2B37'], ro: ['#002B7F', '#FCD116', '#CE1126'], pt: ['#006600', '#006600', '#FF0000', '#FF0000', '#FF0000'] };
  const FLAG_X = { da: ['#C8102E', '#fff'], sv: ['#006AA7', '#FECC00'], fi: ['#fff', '#002F6C'], no: ['#BA0C2F', '#fff', '#00205B'] };
  function flagSvg(code) {
    const c = String(code).slice(0, 2);
    let b = '';
    if (FLAG_H[c]) { const l = FLAG_H[c]; b = l.map((col, i) => `<rect x="0" y="${(20 / l.length) * i}" width="30" height="${20 / l.length + 0.2}" fill="${col}"/>`).join(''); }
    else if (FLAG_V[c]) { const l = FLAG_V[c]; b = l.map((col, i) => `<rect x="${(30 / l.length) * i}" y="0" width="${30 / l.length + 0.2}" height="20" fill="${col}"/>`).join(''); }
    else if (FLAG_X[c]) {
      const [bg, cr, inner] = FLAG_X[c];
      b = `<rect width="30" height="20" fill="${bg}"/><rect x="9" y="0" width="5" height="20" fill="${cr}"/><rect x="0" y="7.5" width="30" height="5" fill="${cr}"/>`
        + (inner ? `<rect x="10.3" y="0" width="2.4" height="20" fill="${inner}"/><rect x="0" y="8.8" width="30" height="2.4" fill="${inner}"/>` : '');
    } else if (c === 'en') {
      b = '<rect width="30" height="20" fill="#012169"/><path d="M0 0 L30 20 M30 0 L0 20" stroke="#fff" stroke-width="4"/><path d="M0 0 L30 20 M30 0 L0 20" stroke="#C8102E" stroke-width="1.4"/>'
        + '<path d="M15 0 V20 M0 10 H30" stroke="#fff" stroke-width="6"/><path d="M15 0 V20 M0 10 H30" stroke="#C8102E" stroke-width="3.4"/>';
    } else if (c === 'cs') b = '<rect width="30" height="10" fill="#fff"/><rect y="10" width="30" height="10" fill="#D7141A"/><path d="M0 0 L15 10 L0 20 Z" fill="#11457E"/>';
    else if (c === 'tr') b = '<rect width="30" height="20" fill="#E30A17"/><circle cx="12" cy="10" r="5" fill="#fff"/><circle cx="13.3" cy="10" r="4" fill="#E30A17"/><circle cx="18.2" cy="10" r="1.6" fill="#fff"/>';
    else if (c === 'ja') b = '<rect width="30" height="20" fill="#fff"/><circle cx="15" cy="10" r="6" fill="#BC002D"/>';
    else if (c === 'zh') b = '<rect width="30" height="20" fill="#DE2910"/><path d="M6 3 L7.2 6.6 L11 6.6 L7.9 8.8 L9.1 12.4 L6 10.2 L2.9 12.4 L4.1 8.8 L1 6.6 L4.8 6.6 Z" fill="#FFDE00"/>';
    else if (c === 'el') b = '<rect width="30" height="20" fill="#0D5EAF"/>' + [1, 3, 5, 7].map((i) => `<rect y="${i * 2.22}" width="30" height="2.22" fill="#fff"/>`).join('')
      + '<rect width="11.1" height="11.1" fill="#0D5EAF"/><rect x="4.4" width="2.2" height="11.1" fill="#fff"/><rect y="4.4" width="11.1" height="2.2" fill="#fff"/>';
    if (!b) return h('span', { class: 'flag none', text: c.toUpperCase(), attrs: { 'aria-hidden': 'true' } });
    return h('span', { class: 'flag', attrs: { 'aria-hidden': 'true' }, html: `<svg viewBox="0 0 30 20" width="21" height="14" preserveAspectRatio="none">${b}</svg>` });
  }

  /**
   * Sprache wählen (Ralf 08.11.2026): bei zwei Sprachen wird umgeschaltet, ab drei öffnet sich eine Liste mit Flaggen
   * direkt an der Taste (ohne Taste, z. B. per F-Taste: in der Mitte).
   */
  function closeLangMenu() { const m = document.getElementById('langmenu'); if (m) m.remove(); }
  function langMenu(anchor) {
    const langs = projectLangs();
    if (langs.length < 3) { nextLang(); return; }
    if (document.getElementById('langmenu')) { closeLangMenu(); return; }
    const menu = h('div', { class: 'langmenu', attrs: { id: 'langmenu', role: 'menu', 'data-test': 'lang-menu' } },
      ...langs.map((c) => h('button', { class: `langopt${c === curLang() ? ' on' : ''}`,
        attrs: { type: 'button', role: 'menuitemradio', lang: c, 'aria-checked': String(c === curLang()), 'data-test': `lang-pick-${c}` },
        on: { click: (ev) => { ev.stopPropagation(); closeLangMenu(); if (c !== curLang()) pickLang(c); } } },
      flagSvg(c), h('span', { text: langName(c) }), c === curLang() ? h('span', { class: 'langcheck', text: '✓' }) : null)));
    document.body.append(menu);
    const r = anchor && anchor.isConnected ? anchor.getBoundingClientRect() : null;
    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    let x; let y;
    if (r) {
      x = Math.min(Math.max(8, r.left), window.innerWidth - mw - 8);
      y = r.top - mh - 6 >= 8 ? r.top - mh - 6 : Math.min(r.bottom + 6, window.innerHeight - mh - 8); // lieber über der Taste (Leiste unten)
    } else { x = (window.innerWidth - mw) / 2; y = (window.innerHeight - mh) / 2; }
    menu.style.left = `${Math.round(x)}px`;
    menu.style.top = `${Math.round(Math.max(8, y))}px`;
    const cur = menu.querySelector('.langopt.on') || menu.querySelector('.langopt');
    if (cur) cur.focus({ preventScroll: true });
    const cleanup = () => { document.removeEventListener('pointerdown', off, true); document.removeEventListener('keydown', off, true); };
    const off = (ev) => {
      if (!menu.isConnected) { cleanup(); return; }
      if (ev.type === 'keydown' ? ev.key === 'Escape' : !menu.contains(ev.target)) {
        closeLangMenu(); cleanup();
        if (ev.type === 'pointerdown' && anchor && anchor.contains(ev.target)) { ev.stopPropagation(); ev.preventDefault(); } // Klick auf die Taste schließt nur
      }
    };
    setTimeout(() => { document.addEventListener('pointerdown', off, true); document.addEventListener('keydown', off, true); }, 0);
  }

  async function onLang(s) {
    const prog = state.langState && state.langState.program;
    state.langState = s;
    if (s.program !== prog) {
      dict = (await window.e4.texts(s.program)).dict;
      document.documentElement.lang = s.program;
      document.title = T('ui.app.title');
    }
    try { state.alarms = await window.e4.alarmsActive(); } catch (e) { /* bleibt */ }
    if (state.view === 'pages') showPages(state.page ? state.page.id : undefined); else render();
  }
  async function pickLang(code) {
    try { await window.e4.setLanguage(code); } catch (err) { toast(err.message); }
  }
  function nextLang() { if (projectLangs().length > 1) pickLang(nextLangCode()); }

  /** Element „Sprachauswahl“: je Sprache ein Knopf */
  function langElement(e, editing) {
    const langs = projectLangs();
    const seg = h('div', { class: 'seg choiceseg langseg', attrs: { role: 'group', 'aria-label': e.label || T('ui.kinds.lang') } },
      ...langs.map((c) => h('button', { class: c === curLang() ? 'on' : '', attrs: { lang: c, 'aria-pressed': String(c === curLang()), disabled: editing, 'data-test': `lang-${c}` },
        on: { click: () => { if (c !== curLang()) pickLang(c); } } }, flagSvg(c), h('span', { class: 'lname', text: langName(c) }), h('span', { class: 'lcode', text: c.toUpperCase() }))));
    seg.style.gridTemplateColumns = `repeat(${langs.length}, minmax(0, 1fr))`;
    return h('div', { class: 'element el-lang elchoice', attrs: { 'data-eid': e.id } }, e.label ? h('div', { class: 'ellabel', text: e.label }) : null, seg);
  }
  /** Leisten-Baustein „Sprache“: springt zur nächsten Sprache */
  function langKey(opts) {
    const editing = !!(opts && (opts.edit || opts.preview));
    return h('button', { class: 'btn small vlang', attrs: { disabled: editing || projectLangs().length < 2, 'data-test': 'bar-lang', title: LG('add') },
      on: { click: (ev) => langMenu(ev.currentTarget) } }, flagSvg(curLang()), h('b', { text: curLang().toUpperCase() }),
      projectLangs().length > 2 ? ' ▾' : projectLangs().length > 1 ? ` ▸ ${nextLangCode().toUpperCase()}` : '');
  }

  // ---- Menüpunkt „Sprachen“ (Texte und Übersetzungen, nur Einrichter)
  async function showTexts() {
    if (needSetupView(() => showTexts())) return;
    closeModal();
    await flushEditorSave();
    try { state.textTable = await window.e4.textRows(); } catch (err) { toast(err.message); return; }
    state.view = 'texts';
    render();
  }
  function textsView() {
    const tt = state.textTable || { base: 'de', langs: ['de'], rows: [] };
    const kinds = dict.texts && dict.texts.kinds ? dict.texts.kinds : {};
    const q = (state.textSearch || '').toLowerCase();
    const isMissing = (r) => tt.langs.some((l) => !r.texts[l]);
    const missingCount = tt.rows.filter(isMissing).length;
    const rows = tt.rows.filter((r) => (!state.textMissing || isMissing(r)) && (!q || `${r.id} ${Object.values(r.texts).join(' ')}`.toLowerCase().includes(q)));
    const addSel = h('select', { class: 'input narrow', attrs: { 'aria-label': LG('add'), 'data-test': 'lang-add' }, on: { change: async (ev) => {
      let code = ev.target.value;
      if (!code) return;
      if (code === '*') code = (window.prompt(LG('addCode')) || '').trim();
      if (!code) { ev.target.value = ''; return; }
      try { await window.e4.addLang(code); await showTexts(); state.langState = await window.e4.langState(); } catch (err) { toast(err.message); ev.target.value = ''; }
    } } }, h('option', { value: '', text: LG('addPick'), attrs: { selected: true } }),
    ...Object.keys(LANG_NAMES).filter((c) => !tt.langs.includes(c)).map((c) => h('option', { value: c, text: `${langName(c)} (${c})` })),
    h('option', { value: '*', text: LG('addCode') }));
    const baseSel = h('select', { class: 'input narrow', attrs: { 'aria-label': LG('base'), 'data-test': 'lang-base' }, on: { change: async (ev) => {
      const c = ev.target.value;
      if (!window.confirm(LG('baseConfirm', { name: langName(c) }))) { ev.target.value = tt.base; return; }
      try { state.langState = await window.e4.setBaseLang(c); ed = null; await showTexts(); } catch (err) { toast(err.message); ev.target.value = tt.base; }
    } } }, ...tt.langs.map((c) => h('option', { value: c, text: langName(c), attrs: { selected: c === tt.base } })));
    const head = h('div', { class: 'pagehead' }, h('div', { class: 'grow' }, h('h1', { text: LG('title') }), h('div', { class: 'muted', text: LG('intro') })),
      h('button', { class: 'btn', attrs: { 'data-test': 'texts-export' }, on: { click: async () => { try { if (await window.e4.exportTexts()) toast(LG('exported')); } catch (err) { toast(err.message); } } } }, LG('export')),
      h('button', { class: 'btn', attrs: { 'data-test': 'texts-import' }, on: { click: async () => {
        try {
          const r = await window.e4.importTexts();
          if (!r) return;
          state.textImport = r;
          ed = null; // Editor lädt die Seiten neu (Grundsprache kann sich geändert haben)
          state.langState = await window.e4.langState();
          await showTexts();
        } catch (err) { toast(err.message); }
      } } }, LG('import')));
    const search = h('input', { class: 'input narrow', value: state.textSearch || '', attrs: { placeholder: LG('search'), 'aria-label': LG('search'), 'data-test': 'texts-search' },
      on: { input: (ev) => { state.textSearch = ev.target.value; const pos = ev.target.selectionStart; render(); const n = document.querySelector('[data-test="texts-search"]'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } } } });
    const missBtn = h('button', { class: `btn small toggle${state.textMissing ? ' on' : ''}`, text: LG('missing', { n: missingCount }), attrs: { 'aria-pressed': String(!!state.textMissing), 'data-test': 'texts-missing' },
      on: { click: () => { state.textMissing = !state.textMissing; render(); } } });
    const viewSel = h('select', { class: 'input narrow', attrs: { 'aria-label': LG('view'), title: LG('viewHint'), 'data-test': 'lang-view' },
      on: { change: (ev) => pickLang(ev.target.value) } }, ...tt.langs.map((c) => h('option', { value: c, text: langName(c), attrs: { selected: c === curLang() } })));
    const bar = h('div', { class: 'inline listbar' }, search, missBtn, h('span', { class: 'spacer' }),
      h('label', { class: 'inline small' }, LG('view'), viewSel), addSel);
    // Grundsprache: selten nötig, darum eingeklappt und mit Erklärung
    const baseBox = h('details', { class: 'card form basebox', attrs: { 'data-test': 'lang-basebox' } },
      h('summary', { text: `${LG('baseTitle')} – ${langName(tt.base)}` }),
      h('div', { class: 'hint', text: LG('baseHint') }),
      h('div', { class: 'inline' }, h('label', { class: 'inline small' }, LG('base'), baseSel),
        h('button', { class: 'btn small', attrs: { 'data-test': 'texts-copies', title: LG('copiesHint') }, on: { click: async () => {
          if (!window.confirm(LG('copiesConfirm'))) return;
          try { const n = await window.e4.clearTextCopies(); toast(LG('copiesDone', { n })); await showTexts(); } catch (err) { toast(err.message); }
        } } }, LG('copies'))),
      h('div', { class: 'hint', text: LG('copiesHint') }));
    const imp = state.textImport;
    const impBox = imp ? h('div', { class: `result ${imp.placeholders.length ? 'err' : 'ok'}`, attrs: { 'data-test': 'texts-import-result' } }, icon(imp.placeholders.length ? 'err' : 'ok'),
      h('div', {}, h('div', { text: LG('importDone', { n: imp.changed }) }),
        imp.langsAdded.length ? h('div', { text: LG('importLangs', { list: imp.langsAdded.map(langName).join(', ') }) }) : null,
        imp.unknown.length ? h('div', { text: LG('importUnknown', { list: imp.unknown.slice(0, 20).join(', ') }) }) : null,
        ...imp.placeholders.slice(0, 30).map((p) => h('div', { text: LG('importPh', { id: p.id, text: p.text, lang: langName(p.lang) }) })))) : null;
    state.textImport = null;
    if (!tt.rows.length) return h('div', {}, head, h('div', { class: 'card empty' }, h('div', { class: 'muted', text: LG('empty') })));
    const cols = h('colgroup', {}, h('col', { class: 't-id' }), h('col', { class: 't-kind' }), ...tt.langs.map(() => h('col', {})));
    const th = tt.langs.map((c) => h('th', {}, h('span', { text: `${langName(c)}${c === tt.base ? ` · ${LG('base')}` : ''}` }),
      c === tt.base ? null : h('button', { class: 'iconbtn small', attrs: { 'aria-label': `${LG('remove')}: ${langName(c)}`, title: LG('remove') }, on: { click: async () => {
        if (!window.confirm(LG('removeConfirm', { name: langName(c) }))) return;
        try { await window.e4.removeLang(c); state.langState = await window.e4.langState(); await showTexts(); } catch (err) { toast(err.message); }
      } } }, icon('close'))));
    const body = rows.slice(0, 500).map((r) => h('tr', { attrs: { 'data-text-row': r.id } },
      h('td', { class: 'mono small muted', text: r.id }), h('td', { class: 'small muted', text: kinds[r.kind] || r.kind }),
      ...tt.langs.map((c) => h('td', {}, h('input', { class: `input${r.texts[c] ? '' : ' missing'}`, value: r.texts[c] || '',
        attrs: { lang: c, placeholder: c === tt.base ? '' : r.texts[tt.base] || '', 'aria-label': `${r.id} ${langName(c)}`, 'data-text': `${r.id}-${c}` },
        on: { change: async (ev) => {
          try {
            r.texts = await window.e4.setText(r.id, c, ev.target.value);
            ev.target.classList.toggle('missing', !r.texts[c]);
            if (c === tt.base) ed = null;
          } catch (err) { toast(err.message); ev.target.value = r.texts[c] || ''; }
        } } })))));
    return h('div', {}, head, impBox, bar, h('div', { class: 'hint', text: LG('programHint') }), baseBox,
      h('div', { class: 'tablewrap' }, h('table', { class: 'list texttable' }, cols, h('thead', {}, h('tr', {}, h('th', { text: LG('colId') }), h('th', { text: LG('colKind') }), ...th)), h('tbody', {}, body))));
  }

  // ---------------------------------------------------------------- Anmeldung, Benutzer, Bedienprotokoll (Version 1, Punkt 4)
  const AU = (k, a) => T(`ui.auth.${k}`, a);
  const RANKS = { viewer: 0, operator: 1, setup: 2 };
  const authOn = () => !!(state.auth && state.auth.active);
  const role = () => (state.auth && state.auth.role) || 'setup';
  const isSetup = () => role() === 'setup';
  const roleName = (r) => T(`users.roles.${r}`);

  function onAuth(s) {
    if (WEB) { onWebAuth(s); return; }
    state.auth = s;
    closeModalIfLogin();
    if (authOn() && !isSetup() && state.view !== 'pages') { showPages(); return; }
    render();
  }
  /**
   * Einrichter-Bereiche (Geräte, Editor, Verwaltung, Einstellungen …) nur für Techniker – egal über welchen Knopf man
   * kommt (Ralf 06.11.2026: „Zum Editor“ auf der leeren Bedienseite führte ohne Anmeldung in den Editor).
   * true = gesperrt, die Anmeldung ist offen; nach erfolgreicher Anmeldung als Techniker geht es mit retry weiter.
   */
  function needSetupView(retry) {
    if (!authOn() || isSetup()) return false;
    openLogin({ reason: AU('reasonSetup'), need: 'setup', then: () => { if (isSetup()) retry(); } });
    return true;
  }
  function closeModalIfLogin() { if (document.querySelector('[data-test="login-dialog"]') && state.auth && state.auth.user) closeModal(); }

  /** oben im Programm: wer ist angemeldet (Klick: abmelden) bzw. „Anmelden“ */
  function authChip() {
    if (!authOn()) return null;
    const u = state.auth.user;
    return h('button', { class: `btn small authchip${u ? ' in' : ''}`, attrs: { 'data-test': 'auth-chip', title: u ? AU('logout') : AU('login') },
      on: { click: () => (u ? (window.confirm(AU('logoutConfirm', { name: u.name })) && window.e4.logout()) : openLogin({})) } },
    icon('user'), u ? `${u.name} · ${roleName(u.role)}` : AU('login'));
  }

  /** Leisten-Baustein „Anmeldung“ */
  function loginBadge(opts) {
    const u = state.auth && state.auth.user;
    const editing = !!(opts && (opts.edit || opts.preview));
    return h('span', { class: 'vlogin' }, h('span', { class: 'vloginname', text: u ? `${u.name} · ${roleName(u.role)}` : AU('guest') }),
      h('button', { class: 'btn small', text: u ? AU('logout') : AU('login'), attrs: { disabled: editing, 'data-test': 'bar-login' },
        on: { click: () => (u ? window.e4.logout() : openLogin({})) } }));
  }

  /**
   * Anmeldefenster: Benutzer antippen, Passwort oder PIN (Zifferntastatur). opts: { reason, need: 'operator' | 'setup', then }
   */
  function openLogin(opts) {
    opts = opts || {};
    const users = (state.auth && state.auth.users) || [];
    let sel = users.length === 1 ? users[0] : null;
    const err = h('div', { class: 'result err', attrs: { hidden: true, role: 'alert', 'data-test': 'login-error' } });
    const input = h('input', { class: 'input big', attrs: { type: 'password', autocomplete: 'off', 'aria-label': AU('secret'), 'data-test': 'login-secret' } });
    const tiles = h('div', { class: 'logintiles' });
    const pad = h('div', { class: 'pinpad', attrs: { hidden: true } }, ...['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'].map((k) =>
      h('button', { class: 'btn', text: k, attrs: { type: 'button', 'aria-label': k === 'C' ? AU('clear') : k === '⌫' ? '⌫' : k },
        on: { click: () => { if (k === 'C') input.value = ''; else if (k === '⌫') input.value = input.value.slice(0, -1); else input.value += k; input.focus(); } } })));
    const pick = (u) => {
      sel = u;
      for (const b of tiles.children) b.classList.toggle('on', b.dataset.user === u.id);
      input.placeholder = u.hasPassword && u.hasPin ? AU('secret') : u.hasPin ? AU('secretPin') : AU('secretPw');
      input.inputMode = u.hasPin && !u.hasPassword ? 'numeric' : 'text';
      pad.hidden = !u.hasPin;
      err.hidden = true;
      input.value = '';
      input.focus();
    };
    tiles.append(...users.map((u) => h('button', { class: 'logintile', text: u.name, attrs: { type: 'button', 'data-user': u.id, 'data-test': `login-user-${u.name}` }, on: { click: () => pick(u) } })));
    let lockTimer = null;
    const submit = async () => {
      if (!sel) return;
      const r = await window.e4.login(sel.id, input.value);
      if (!r.ok) {
        err.hidden = false;
        input.value = '';
        clearInterval(lockTimer);
        if (!r.locked) { err.replaceChildren(icon('err'), h('div', { text: AU('wrong', { n: r.left }) })); return; }
        // gesperrt: Restzeit zählt sichtbar herunter
        const until = Date.now() + r.wait * 1000;
        const show = () => {
          const left = Math.max(0, Math.ceil((until - Date.now()) / 1000));
          if (!document.body.contains(err)) { clearInterval(lockTimer); return; }
          if (!left) { clearInterval(lockTimer); err.replaceChildren(icon('ok'), h('div', { text: AU('unlocked') })); return; }
          err.replaceChildren(icon('err'), h('div', { text: left >= 60
            ? AU('lockedMin', { m: Math.floor(left / 60), s: String(left % 60).padStart(2, '0') }) : AU('locked', { s: left }) }));
        };
        show();
        lockTimer = setInterval(show, 1000);
        return;
      }
      state.auth = await window.e4.authState(); // sofort, nicht erst mit der Meldung des Kerns
      closeModal();
      if (opts.need && RANKS[r.user.role] < RANKS[opts.need]) { toast(AU(opts.need === 'setup' ? 'needSetup' : 'needOperator')); return; }
      if (opts.then) opts.then();
    };
    input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') submit(); });
    const panel = h('div', { class: 'panel loginpanel', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': AU('login'), 'data-test': 'login-dialog' } },
      h('div', { class: 'head' }, h('h2', { text: AU('login') }),
        h('button', { class: 'iconbtn', attrs: { 'aria-label': T('ui.common.close') }, on: { click: closeModal } }, icon('close'))),
      h('div', { class: 'form' }, opts.reason ? h('div', { class: 'hint', text: opts.reason }) : null,
        h('div', { class: 'label', text: AU('who') }), tiles, input, pad, err),
      h('div', { class: 'foot' }, h('div', { class: 'spacer' }), h('button', { class: 'btn', attrs: { 'data-test': 'login-cancel' }, on: { click: closeModal } }, opts.cancelText || T('ui.common.cancel')),
        h('button', { class: 'btn primary', attrs: { 'data-test': 'login-ok' }, on: { click: submit } }, AU('ok'))));
    const overlay = h('div', { class: 'overlay', on: { mousedown: (e) => { if (e.target === overlay) closeModal(); } } }, panel);
    setModal(overlay);
    if (sel) pick(sel);
  }

  // Abmelden nach Zeit ohne Bedienung
  let lastActivity = Date.now();
  for (const ev of ['pointerdown', 'keydown', 'wheel']) document.addEventListener(ev, () => { lastActivity = Date.now(); }, true);
  setInterval(() => {
    const a = state.auth;
    if (!a || !a.user || !a.logoutMin) return;
    if (Date.now() - lastActivity > a.logoutMin * 60000) { lastActivity = Date.now(); window.e4.logout('timeout'); }
  }, 15000);

  // ---- Im Browser (Handy/Tablet): Anmeldeseite, Verbindung zum PC
  let webNote = null; // Hinweis auf der Anmeldeseite, z. B. „Du wurdest abgemeldet.“
  function showWebLogin(note) {
    closeModal();
    webNote = note || null;
    Object.assign(state, { view: 'weblogin', page: null, pageBack: [], values: {}, webLost: false });
    render();
  }
  async function onWebAuth(s) {
    const was = state.auth && state.auth.user;
    state.auth = s;
    if (!s || !s.user) { if (state.view !== 'weblogin' || (s && s.expired)) showWebLogin(s && s.expired ? T('ui.web.expired') : null); return; }
    if (!was || state.view === 'weblogin') { await webEnter(); return; }
    render(); // am PC Name oder Rolle geändert
  }
  /** Lizenzen: easy4Visu (MIT) und die Lizenztexte der mitgelieferten Bausteine (LIZENZEN-DRITTER.txt) */
  async function showLicenses() {
    const O = (k, a) => T(`ui.options.${k}`, a);
    let lic;
    try { lic = await window.e4.getLicenses(); } catch (err) { toast(err.message); return; }
    const pre = (text) => h('pre', { class: 'lictext', text: text || O('licMissing') });
    const panel = h('div', { class: 'panel wide', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': O('licTitle'), 'data-test': 'licenses' } },
      h('div', { class: 'head' }, h('h2', { text: O('licTitle') }),
        h('button', { class: 'iconbtn', attrs: { 'aria-label': T('ui.common.close') }, on: { click: closeModal } }, icon('close'))),
      h('div', { class: 'muted small', text: O('licIntro', { v: lic.version }) }),
      h('h3', { text: O('licOwn') }), pre(lic.own),
      h('h3', { text: O('licThird') }), pre(lic.third),
      h('div', { class: 'foot' }, h('div', { class: 'spacer' }),
        h('button', { class: 'btn primary', on: { click: closeModal } }, T('ui.common.close'))));
    const overlay = h('div', { class: 'overlay center', on: { mousedown: (e) => { if (e.target === overlay) closeModal(); } } }, panel);
    setModal(overlay);
  }
  /** „Demo Talwerk ausprobieren“: Neustart mit dem mitgelieferten Beispielprojekt und simulierten Geräten */
  async function startTalwerkDemo() {
    if (!window.confirm(T('ui.demo.confirmMuster'))) return;
    try { await window.e4.setDemo('talwerk'); } catch (err) { toast(err.message); }
  }
  /** Demo-Modus: gelbes Band oben, solange simulierte Geräte laufen (am PC und im Browser) */
  async function showDemoBand() {
    try { state.demo = await window.e4.isDemo(); } catch (e) { state.demo = false; }
    const old = document.getElementById('demoband');
    if (!state.demo) { if (old) old.remove(); return; }
    if (!old) document.body.append(h('div', { attrs: { id: 'demoband', role: 'status', 'data-test': 'demo-band' }, text: T('ui.demo.band') }));
  }
  /** nach der Anmeldung: Sprache des Benutzers, Zustand, Startseite */
  async function webEnter() {
    try { state.langState = await window.e4.langState(); } catch (e) { /* bleibt */ }
    const prog = state.langState ? state.langState.program : 'de';
    dict = (await window.e4.texts(prog)).dict;
    document.documentElement.lang = prog;
    state.theme = await window.e4.getTheme();
    state.online = await window.e4.isOnline();
    try { state.alarms = await window.e4.alarmsActive(); } catch (e) { state.alarms = []; }
    await showDemoBand();
    await showPages();
  }
  /** Verbindung zum PC weg bzw. wieder da (meldet web.js) */
  async function onWebConn(ok) {
    if (state.view === 'weblogin') return;
    if (!ok) { if (!state.webLost) { state.webLost = true; tipRelease(); render(); } return; }
    if (!state.webLost) return;
    try { state.auth = await window.e4.authState(); } catch (e) { return; }
    state.webLost = false;
    if (!state.auth.user) { showWebLogin(T('ui.web.expired')); return; }
    state.online = await window.e4.isOnline();
    try { state.alarms = await window.e4.alarmsActive(); } catch (e) { /* bleibt */ }
    await showPages(state.page ? state.page.id : undefined);
  }
  function webLoginView() {
    const W = (k, a) => T(`ui.web.${k}`, a);
    const name = h('input', { class: 'input big', attrs: { type: 'text', id: 'web-user', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', 'data-test': 'web-user' } });
    try { name.value = localStorage.getItem('easy4visu.webUser') || ''; } catch (e) { /* leer */ }
    const secret = h('input', { class: 'input big', attrs: { type: 'password', id: 'web-secret', autocomplete: 'current-password', 'data-test': 'web-secret' } });
    const err = h('div', { class: 'result err', attrs: { hidden: !webNote, role: 'alert', 'data-test': 'web-login-error' } });
    const say = (text, ok) => { err.hidden = false; err.className = `result ${ok ? 'ok' : 'err'}`; err.replaceChildren(icon(ok ? 'ok' : 'err'), h('div', { text })); };
    if (webNote) say(webNote);
    let lockTimer = null;
    const btn = h('button', { class: 'btn primary big', text: W('login'), attrs: { type: 'submit', 'data-test': 'web-login-ok' } });
    const submit = async (ev) => {
      ev.preventDefault();
      if (!name.value.trim()) { name.focus(); return; }
      btn.disabled = true;
      let r;
      try { r = await window.e4.login(name.value, secret.value); } catch (e) { say(e.message); btn.disabled = false; return; }
      btn.disabled = false;
      secret.value = '';
      clearInterval(lockTimer);
      if (r.ok) {
        try { localStorage.setItem('easy4visu.webUser', name.value.trim()); } catch (e) { /* ohne Speicher */ }
        webNote = null;
        state.auth = await window.e4.authState();
        await webEnter();
        return;
      }
      if (!r.locked) { say(r.left === null || r.left === undefined ? W('wrong') : AU('wrong', { n: r.left })); return; }
      // gesperrt: Restzeit zählt sichtbar herunter
      const until = Date.now() + r.wait * 1000;
      const show = () => {
        const left = Math.max(0, Math.ceil((until - Date.now()) / 1000));
        if (!document.body.contains(err)) { clearInterval(lockTimer); return; }
        if (!left) { clearInterval(lockTimer); say(AU('unlocked'), true); return; }
        say(left >= 60 ? AU('lockedMin', { m: Math.floor(left / 60), s: String(left % 60).padStart(2, '0') }) : AU('locked', { s: left }));
      };
      show();
      lockTimer = setInterval(show, 1000);
    };
    const form = h('form', { class: 'weblogin card', attrs: { 'data-test': 'web-login', novalidate: true }, on: { submit } },
      wordmark(), h('h1', { text: W('loginTitle') }), h('p', { class: 'muted', text: W('loginIntro') }),
      h('label', { class: 'label', text: W('user'), attrs: { for: 'web-user' } }), name,
      h('label', { class: 'label', text: W('secret'), attrs: { for: 'web-secret' } }), secret, err, btn);
    setTimeout(() => (name.value ? secret : name).focus(), 0);
    return h('div', { class: 'webloginpage' }, form);
  }
  async function startWeb() {
    let langs = null;
    try { langs = await window.e4.langState(); } catch (e) { langs = null; }
    const prog = langs ? langs.program : 'de';
    dict = (await window.e4.texts(prog)).dict;
    document.documentElement.lang = prog;
    document.title = T('ui.app.title');
    window.e4.onValues(onValues);
    window.e4.onDeviceState(onDeviceState);
    window.e4.onOnline(onOnline);
    window.e4.onSeen(onSeen);
    window.e4.onAlarms(onAlarms);
    window.e4.onAuth(onAuth);
    window.e4.onLang(onLang);
    window.e4.onConn(onWebConn);
    let a = null;
    try { a = await window.e4.resume(); } catch (e) { a = null; }
    state.auth = a;
    if (a && a.user) await webEnter();
    else showWebLogin(a && !a.active ? T('ui.web.off') : null);
  }

  // ---- Benutzer verwalten (nur Einrichter)
  async function showUsers() {
    if (needSetupView(() => showUsers())) return;
    closeModal();
    await flushEditorSave();
    state.usersList = await window.e4.usersList();
    state.view = 'users';
    render();
  }

  function userDialog(u) {
    const D = { name: u ? u.name : '', role: u ? u.role : 'operator', password: '', pin: '', clearPin: false, error: null };
    const draw = () => {
      const panel = h('div', { class: 'panel', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': u ? AU('edit') : AU('add'), 'data-test': 'user-dialog' } },
        h('div', { class: 'head' }, h('h2', { text: u ? `${AU('edit')}: ${u.name}` : AU('add') }),
          h('button', { class: 'iconbtn', attrs: { 'aria-label': T('ui.common.close') }, on: { click: closeModal } }, icon('close'))),
        h('div', { class: 'form' },
          textField(AU('name'), () => D.name, (v) => { D.name = v; }, { key: 'user-name' }),
          selectField(AU('role'), D.role, ['viewer', 'operator', 'setup'].map((r) => [r, roleName(r)]), (v) => { D.role = v; }, 'user-role'),
          h('div', { class: 'row2' },
            textField(u ? AU('passwordNew') : AU('password'), () => D.password, (v) => { D.password = v; }, { key: 'user-password', type: 'password', placeholder: u ? AU('keepEmpty') : '' }),
            textField(u ? AU('pinNew') : AU('pin'), () => D.pin, (v) => { D.pin = v.replace(/\D/g, ''); }, { key: 'user-pin', type: 'password', placeholder: u ? AU('keepEmpty') : '' })),
          h('div', { class: 'hint', text: AU('secretHint') }),
          u && u.hasPin && u.hasPassword ? checkField(AU('clearPin'), D.clearPin, (on) => { D.clearPin = on; }, 'user-clearpin') : null,
          D.error ? h('div', { class: 'result err' }, icon('err'), h('div', { text: D.error })) : null),
        h('div', { class: 'foot' }, h('div', { class: 'spacer' }), h('button', { class: 'btn', on: { click: closeModal } }, T('ui.common.cancel')),
          h('button', { class: 'btn primary', attrs: { 'data-test': 'user-save' }, on: { click: async () => {
            try {
              const input = { name: D.name, role: D.role, password: D.password, pin: D.pin, clearPin: D.clearPin };
              if (u) await window.e4.userUpdate(u.id, input); else await window.e4.userAdd(input);
              closeModal();
              await showUsers();
              toast(AU('saved'));
            } catch (err) { D.error = err.message; draw(); }
          } } }, T('ui.common.save'))));
      setModal(h('div', { class: 'overlay' }, panel));
    };
    draw();
  }

  function usersView() {
    const list = state.usersList || [];
    const a = state.auth || {};
    const head = h('div', { class: 'pagehead' }, h('div', { class: 'grow' }, h('h1', { text: AU('usersTitle') }), h('div', { class: 'muted', text: AU('usersIntro') })),
      h('button', { class: 'btn primary', attrs: { 'data-test': 'user-add' }, on: { click: () => userDialog(null) } }, icon('plus'), AU('add')));
    if (!list.length) {
      return h('div', {}, head, h('div', { class: 'card empty' }, h('h2', { text: AU('firstTitle') }), h('div', { class: 'muted', text: AU('firstHint') })));
    }
    const setups = list.filter((u) => u.role === 'setup').length;
    const rows = list.map((u) => h('tr', { attrs: { 'data-user-row': u.name } },
      h('td', {}, u.name, a.user && a.user.id === u.id ? h('span', { class: 'badge', text: AU('you') }) : null),
      h('td', { text: roleName(u.role) }),
      h('td', { text: [u.hasPassword ? AU('hasPw') : null, u.hasPin ? AU('hasPin') : null].filter(Boolean).join(' + ') }),
      h('td', { class: 'actions' }, h('button', { class: 'btn small', text: AU('edit'), on: { click: () => userDialog(u) } }),
        h('button', { class: 'btn small danger', text: AU('remove'), on: { click: async () => {
          if (!window.confirm(AU('removeConfirm', { name: u.name }))) return;
          try { await window.e4.userRemove(u.id); await showUsers(); } catch (err) { toast(err.message); }
        } } }))));
    const minutes = [0, 5, 10, 15, 30, 60].map((n) => [String(n), n ? AU('minutes', { n }) : AU('never')]);
    const settings = h('section', { class: 'card form' }, h('h2', { text: AU('settingsTitle') }),
      h('div', { class: 'row2' },
        selectField(AU('guestRole'), a.guestRole || 'viewer', ['viewer', 'operator'].map((r) => [r, roleName(r)]), async (v) => { try { await window.e4.setAuthSettings({ guestRole: v }); } catch (err) { toast(err.message); } }, 'guest-role'),
        selectField(AU('logoutAfter'), String(a.logoutMin === undefined ? 10 : a.logoutMin), minutes, async (v) => { try { await window.e4.setAuthSettings({ logoutMin: Number(v) }); } catch (err) { toast(err.message); } }, 'logout-min')));
    return h('div', {}, head,
      setups === 1 ? h('div', { class: 'result warn', attrs: { 'data-test': 'second-setup' } }, icon('warn'), h('div', { text: AU('secondSetup') })) : null,
      h('div', { class: 'tablewrap' }, h('table', { class: 'list' },
        h('thead', {}, h('tr', {}, ...[AU('name'), AU('role'), AU('secret'), ''].map((x) => h('th', { text: x })))), h('tbody', {}, rows))),
      settings, a.emergency ? emergencyBox(list) : null);
  }

  /** Notfall-Zugang: Einrichter-Passwort neu setzen (nur mit --notfall als Windows-Administrator gestartet) */
  function emergencyBox(list) {
    const setups = list.filter((u) => u.role === 'setup');
    let who = setups[0] ? setups[0].id : '';
    const pw = h('input', { class: 'input', attrs: { type: 'password', 'aria-label': AU('passwordNew'), 'data-test': 'emergency-password' } });
    return h('section', { class: 'card form', attrs: { 'data-test': 'emergency' } }, h('h2', { text: AU('emergencyTitle') }), h('div', { class: 'hint', text: AU('emergencyHint') }),
      h('div', { class: 'row2' }, selectField(AU('name'), who, setups.map((u) => [u.id, u.name]), (v) => { who = v; }, 'emergency-user'),
        h('label', { class: 'field' }, h('span', { class: 'label', text: AU('passwordNew') }), pw)),
      h('div', { class: 'inline' }, h('button', { class: 'btn primary', text: AU('emergencyReset'), on: { click: async () => {
        try { await window.e4.emergencyReset(who, pw.value); pw.value = ''; toast(AU('emergencyDone', { name: (setups.find((u) => u.id === who) || {}).name })); } catch (err) { toast(err.message); }
      } } })));
  }

  // ---- Bedienprotokoll (nur Einrichter)
  const AUDIT_RANGES = { today: () => new Date(new Date().toDateString()).getTime(), 7: () => Date.now() - 7 * 86400e3, 30: () => Date.now() - 30 * 86400e3, all: () => 0 };
  const auditFilter = () => ({ from: AUDIT_RANGES[state.auditRange || 'today'](), user: state.auditUser || undefined });
  async function showAudit() {
    if (needSetupView(() => showAudit())) return;
    closeModal();
    await flushEditorSave();
    state.auditRange = state.auditRange || 'today';
    try {
      state.auditRows = await window.e4.auditQuery(Object.assign({ limit: 1000 }, auditFilter()));
      state.usersList = await window.e4.usersList();
    } catch (err) { toast(err.message); return; }
    state.view = 'audit';
    render();
  }
  function auditView() {
    const rows = state.auditRows || [];
    const kind = (k) => T(`users.kinds.${k}`);
    const range = h('div', { class: 'seg' }, ...[['today', AU('rangeToday')], ['7', AU('range7')], ['30', AU('range30')], ['all', AU('rangeAll')]].map(([k, text]) =>
      h('button', { class: (state.auditRange || 'today') === k ? 'on' : '', text, attrs: { 'data-test': `audit-range-${k}` }, on: { click: () => { state.auditRange = k; showAudit(); } } })));
    const who = h('select', { class: 'input auto', attrs: { 'aria-label': AU('colUser'), 'data-test': 'audit-user' }, on: { change: (ev) => { state.auditUser = ev.target.value; showAudit(); } } },
      h('option', { value: '', text: AU('allUsers'), attrs: { selected: !state.auditUser } }),
      ...(state.usersList || []).map((u) => h('option', { value: u.name, text: u.name, attrs: { selected: state.auditUser === u.name } })));
    const head = h('div', { class: 'pagehead' }, h('div', { class: 'grow' }, h('h1', { text: AU('auditTitle') }), h('div', { class: 'muted', text: AU('auditIntro') })),
      h('button', { class: 'btn', attrs: { 'data-test': 'audit-export' }, on: { click: async () => {
        try { if (await window.e4.exportAudit(auditFilter())) toast(AU('exported')); } catch (err) { toast(err.message); }
      } } }, AU('exportCsv')));
    const fmtV = (v) => (v === null || v === undefined ? '' : String(v).replace('.', ','));
    const body = rows.length ? h('div', { class: 'tablewrap' }, h('table', { class: 'list audittable' },
      h('thead', {}, h('tr', {}, ...['colTime', 'colUser', 'colKind', 'colDevice', 'colWhat', 'colChange'].map((k) => h('th', { text: AU(k) })))),
      h('tbody', {}, rows.map((r) => h('tr', { attrs: { 'data-audit-kind': r.kind } },
        h('td', { class: 'mono small', text: new Date(r.ts).toLocaleString('de-DE') }), h('td', { text: r.user || '–' }), h('td', { text: kind(r.kind) }),
        h('td', { class: 'small', text: [r.device, r.name].filter(Boolean).join(' · ') }), h('td', { text: r.what || '' }),
        h('td', { class: 'mono small', text: r.old !== null || r.new !== null ? `${fmtV(r.old) || '–'} → ${fmtV(r.new) || '–'}` : '' }))))))
      : h('div', { class: 'card empty' }, h('div', { class: 'muted', text: AU('empty') }));
    return h('div', {}, head, h('div', { class: 'inline listbar' }, range, who), body,
      rows.length >= 1000 ? h('div', { class: 'hint', text: AU('more', { n: rows.length }) }) : null);
  }

  // ---------------------------------------------------------------- Aufzeichnungen: Trends und Meldungen als CSV, Aufbewahrung
  const RC = (k, a) => T(`ui.records.${k}`, a);
  const canOperate = () => RANKS[role()] >= RANKS.operator;
  const rec = { sel: null, range: 'd7', from: '', to: '', step: 60000, aRange: 'd7', aFrom: '', aTo: '', level: '', info: null, infoTimer: null };
  const DAY = 86400e3;
  const localInput = (ts) => { const d = new Date(ts - new Date(ts).getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };
  /** Zeitraum aus der Auswahl: [from, to] in ms */
  function recRange(key, from, to) {
    const now = Date.now();
    const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
    if (key === 'today') return [midnight.getTime(), now];
    if (key === 'yesterday') return [midnight.getTime() - DAY, midnight.getTime() - 1];
    if (key === 'd30') return [now - 30 * DAY, now];
    if (key === 'custom') return [new Date(from).getTime(), new Date(to).getTime()];
    return [now - 7 * DAY, now];
  }
  const recKey = (s) => `${s.dev}|${s.name}`;
  const trendSpec = () => {
    const [from, to] = recRange(rec.range, rec.from, rec.to);
    return { series: (state.records.series || []).filter((s) => rec.sel.has(recKey(s))).map((s) => ({ dev: s.dev, name: s.name })), from, to, step: rec.step };
  };
  const fmtBytes = (n) => (n < 1e6 ? `${Math.max(1, Math.round(n / 1e3))} kB` : `${(n / 1e6).toFixed(1).replace('.', ',')} MB`);
  const fmtDate = (ts) => new Date(ts).toLocaleDateString('de-DE');

  async function showRecords() {
    if (needSetupView(() => showRecords())) return;
    closeModal();
    await flushEditorSave();
    try { state.records = await window.e4.recordsState(); } catch (err) { toast(err.message); return; }
    if (!rec.sel) rec.sel = new Set(state.records.series.map(recKey)); // beim ersten Mal: alle
    if (!rec.from) { const m = new Date(); m.setHours(0, 0, 0, 0); rec.from = rec.aFrom = localInput(m.getTime()); rec.to = rec.aTo = localInput(Date.now()); }
    state.view = 'records';
    render();
    recInfo();
  }

  /** Hinweis „ca. … Zeilen“ frisch holen (kurz verzögert, damit nicht jeder Klick einzeln fragt) */
  function recInfo() {
    clearTimeout(rec.infoTimer);
    rec.infoTimer = setTimeout(async () => {
      const node = document.querySelector('[data-test="rec-info"]');
      if (!node) return;
      const spec = trendSpec();
      if (!spec.series.length) { rec.info = null; node.textContent = ''; return; }
      try {
        rec.info = await window.e4.trendCsvInfo(spec);
        node.textContent = recInfoText();
        node.classList.toggle('bad', rec.info.tooMany);
      } catch (err) { rec.info = null; node.textContent = err.message; node.classList.add('bad'); }
    }, 150);
  }
  /** zuletzt geholter Hinweis; steht beim Neuzeichnen gleich wieder da (kein Flackern) */
  function recInfoText() {
    if (!rec.info) return '';
    const rows = rec.info.rows.toLocaleString('de-DE');
    return rec.info.tooMany ? RC('tooMany', { rows }) : RC(rec.info.cols === 1 ? 'info1' : 'info', { rows, cols: rec.info.cols });
  }

  function recordsView() {
    const R = state.records;
    const redraw = () => { render(); recInfo(); };
    // Auswahlknöpfe in einer Reihe, so breit wie ihr Text
    const recSeg = (...a) => { const n = segPick(...a); n.className = 'seg recseg'; return n; };
    const rangePick = (cur, onPick, key) => recSeg(['today', 'yesterday', 'd7', 'd30', 'custom'].map((k) => [k, RC(k)]), cur, onPick, key);
    const custom = (getF, setF, getT, setT, key) => h('div', { class: 'inline recdates' },
      h('label', { class: 'muted small', text: RC('from') }),
      h('input', { class: 'input auto', value: getF(), attrs: { type: 'datetime-local', 'data-field': `${key}-from` }, on: { change: (ev) => { setF(ev.target.value); recInfo(); } } }),
      h('label', { class: 'muted small', text: RC('to') }),
      h('input', { class: 'input auto', value: getT(), attrs: { type: 'datetime-local', 'data-field': `${key}-to` }, on: { change: (ev) => { setT(ev.target.value); recInfo(); } } }));
    // Variablen je Gerät
    const byDev = new Map();
    for (const s of R.series) { if (!byDev.has(s.dev)) byDev.set(s.dev, { name: s.device, list: [] }); byDev.get(s.dev).list.push(s); }
    const vars = R.series.length ? h('div', { class: 'recvars' },
      h('div', { class: 'inline small' },
        h('button', { class: 'btn small', text: RC('all'), attrs: { 'data-test': 'rec-all' }, on: { click: () => { rec.sel = new Set(R.series.map(recKey)); redraw(); } } }),
        h('button', { class: 'btn small', text: RC('none'), attrs: { 'data-test': 'rec-none' }, on: { click: () => { rec.sel = new Set(); redraw(); } } })),
      ...[...byDev.values()].map((g) => h('div', { class: 'recdev' },
        byDev.size > 1 ? h('div', { class: 'recdevname', text: g.name }) : null,
        h('div', { class: 'recchecks' }, ...g.list.map((s) => h('label', { class: 'check' },
          h('input', { attrs: { type: 'checkbox', 'data-field': `rec-var-${recKey(s)}` }, checked: rec.sel.has(recKey(s)),
            on: { change: (ev) => { if (ev.target.checked) rec.sel.add(recKey(s)); else rec.sel.delete(recKey(s)); recInfo(); } } }),
          h('span', { text: s.label }), s.unit ? h('span', { class: 'muted small', text: ` [${s.unit}]` }) : null))))))
      : h('div', { class: 'muted', text: RC('noVars') });
    const trendCard = h('section', { class: 'card recbox', attrs: { 'data-test': 'rec-trend' } },
      h('h2', { text: RC('trendTitle') }),
      h('div', { class: 'reclabel', text: RC('vars') }), vars,
      R.series.length ? h('div', {},
        h('div', { class: 'reclabel', text: RC('range') }), rangePick(rec.range, (k) => { rec.range = k; redraw(); }, 'rec-range'),
        rec.range === 'custom' ? custom(() => rec.from, (v) => { rec.from = v; }, () => rec.to, (v) => { rec.to = v; }, 'rec') : null,
        h('div', { class: 'reclabel', text: RC('step') }), recSeg(R.steps.map((st) => [st, RC(`step${st}`)]), rec.step, (st) => { rec.step = st; redraw(); }, 'rec-step'),
        h('div', { class: 'muted small', text: RC('stepHint') }),
        h('div', { class: 'recfoot' }, h('span', { class: `muted small recinfo${rec.info && rec.info.tooMany ? ' bad' : ''}`, text: recInfoText(), attrs: { 'data-test': 'rec-info', 'aria-live': 'polite' } }),
          h('button', { class: 'btn primary', attrs: { 'data-test': 'rec-save-trend' }, on: { click: async () => {
            try { const r = await window.e4.saveTrendCsv(trendSpec()); if (r) toast(RC('saved', { rows: r.rows.toLocaleString('de-DE') })); } catch (err) { toast(err.message); }
          } } }, RC('save')))) : null);
    const alarmSpec = () => { const [from, to] = recRange(rec.aRange, rec.aFrom, rec.aTo); return { from, to, level: rec.level }; };
    const alarmCard = h('section', { class: 'card recbox', attrs: { 'data-test': 'rec-alarms' } },
      h('h2', { text: RC('alarmTitle') }),
      h('div', { class: 'reclabel', text: RC('range') }), rangePick(rec.aRange, (k) => { rec.aRange = k; redraw(); }, 'rec-arange'),
      rec.aRange === 'custom' ? custom(() => rec.aFrom, (v) => { rec.aFrom = v; }, () => rec.aTo, (v) => { rec.aTo = v; }, 'rec-a') : null,
      h('div', { class: 'reclabel', text: RC('level') }),
      recSeg([['', RC('levelAll')], ['fault', RC('levelFault')], ['warn', RC('levelWarn')], ['info', RC('levelInfo')]], rec.level, (l) => { rec.level = l; redraw(); }, 'rec-level'),
      h('div', { class: 'recfoot' }, h('span', { class: 'muted small', text: RC('alarmCols') }),
        h('button', { class: 'btn primary', attrs: { 'data-test': 'rec-save-alarms' }, on: { click: async () => {
          try { const r = await window.e4.saveAlarmCsv(alarmSpec()); if (r) toast(RC('saved', { rows: r.rows.toLocaleString('de-DE') })); } catch (err) { toast(err.message); }
        } } }, RC('save'))));
    // Aufbewahrung (ändern nur Einrichter)
    const st = R.stats;
    const keepRow = (k, label, info) => h('div', { class: 'reckeep' }, h('span', { class: 'reckeepname', text: label }),
      h('select', { class: 'input auto', attrs: { 'data-field': `rec-keep-${k}`, disabled: !isSetup(), 'aria-label': label }, on: { change: async (ev) => {
        const days = Number(ev.target.value);
        if (days < R.retention[k] && !window.confirm(RC('shorter', { days: T(`records.days.${days}`) }))) { ev.target.value = R.retention[k]; return; }
        try { state.records = await window.e4.setRetention({ [k]: days }); toast(RC('keepSaved')); render(); } catch (err) { toast(err.message); ev.target.value = R.retention[k]; }
      } } }, ...R.choices.map((d) => h('option', { value: String(d), text: T(`records.days.${d}`), attrs: { selected: d === R.retention[k] } }))),
      h('span', { class: 'muted small', text: info }));
    const keepCard = h('section', { class: 'card recbox', attrs: { 'data-test': 'rec-keep' } },
      h('h2', { text: RC('keepTitle') }), h('div', { class: 'muted small', text: isSetup() ? RC('keepIntro') : `${RC('keepIntro')} ${RC('keepOnlySetup')}` }),
      keepRow('trend', RC('keepTrend'), st.trendOldest ? RC('size', { size: fmtBytes(st.trendBytes), date: fmtDate(st.trendOldest) }) : RC('empty')),
      keepRow('alarm', RC('keepAlarm'), st.alarmOldest ? RC('oldest', { date: fmtDate(st.alarmOldest) }) : RC('empty')),
      keepRow('audit', RC('keepAudit'), st.auditOldest ? RC('oldest', { date: fmtDate(st.auditOldest) }) : RC('empty')));
    return h('div', { class: 'recview' }, h('div', { class: 'pagehead' }, h('div', { class: 'grow' }, h('h1', { text: RC('title') }), h('div', { class: 'muted', text: RC('intro') }))),
      trendCard, alarmCard, keepCard);
  }

  /** am Trend-Element: genau den sichtbaren Zeitraum als Tabelle speichern */
  async function saveTrendShown(tv) {
    const span = TREND_RANGES[tv.range];
    const to = tv.end === null ? Date.now() : tv.end;
    const series = (tv.e.series || []).filter((s) => !s.missing).map((s) => ({ dev: s.dev, name: s.name }));
    try { const r = await window.e4.saveTrendCsv({ series, from: to - span, to, step: 'auto' }); if (r) toast(RC('saved', { rows: r.rows.toLocaleString('de-DE') })); } catch (err) { toast(err.message); }
  }

  // ---------------------------------------------------------------- Meldungen (Version 1, Punkt 3)
  const A = (k, a) => T(`ui.alarms.${k}`, a);
  const alarmView = {}; // Element-id -> 'current' | 'history'
  const openFaults = () => (state.alarms || []).filter((x) => x.canAck).length;
  const alarmTime = (ts) => {
    const d = new Date(ts);
    return d.toDateString() === new Date().toDateString() ? d.toLocaleTimeString('de-DE') : d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  };
  const alarmState = (x) => (x.gone === null || x.gone === undefined ? (x.ack ? 'ack' : 'come') : x.canAck ? 'gone' : 'done');
  const devName = (id) => (state.devices.find((d) => d.id === id) || {}).name || '';

  function alarmBadge() {
    const n = openFaults();
    return h('span', { class: `navbadge${n ? '' : ' hidden'}`, attrs: { 'data-alarm-badge': '1', 'aria-label': n ? `${n} ${A('level.fault')}` : null }, text: n ? String(n) : '' });
  }

  function onAlarms(list) {
    state.alarms = list || [];
    document.querySelectorAll('[data-alarm-badge]').forEach((n) => n.replaceWith(alarmBadge()));
    document.querySelectorAll('[data-alarm-line]').forEach((n) => n.replaceWith(alarmLine({ editing: n.hasAttribute('data-editing') })));
    for (const n of document.querySelectorAll('[data-alarm-list]')) {
      const e = { id: n.dataset.eid, height: n.dataset.height || undefined };
      n.replaceWith(alarmsElement(e, state.view === 'editor'));
    }
  }

  async function ackAlarm(id) {
    try {
      const n = await window.e4.ackAlarm(id);
      if (n > 1) toast(A('acked', { n }));
    } catch (err) { toast(err.message); }
  }

  /** Meldungszeile in der Leiste: neueste offene Meldung, Anzahl, Quittieren */
  function alarmLine(opts) {
    const list = state.alarms || [];
    const editing = !!(opts && (opts.editing || opts.edit || opts.preview));
    if (!list.length) {
      return h('span', { class: 'valarm none', attrs: { 'data-alarm-line': '1', 'data-editing': editing ? '' : null } }, h('span', { class: 'dot', attrs: { 'aria-hidden': 'true' } }), A('none'));
    }
    const top = list[0];
    return h('span', { class: `valarm lv-${top.level}${top.canAck && top.gone === null ? ' blink' : ''}`, attrs: { 'data-alarm-line': '1', 'data-editing': editing ? '' : null, role: 'status' } },
      h('span', { class: 'dot', attrs: { 'aria-hidden': 'true' } }),
      h('span', { class: 'valarmtext', text: `${top.text || top.name} · ${alarmTime(top.come)}` }),
      list.length > 1 ? h('b', { text: A('more', { n: list.length - 1 }) }) : null,
      openFaults() ? h('button', { class: 'btn small', text: A('ack'), attrs: { 'data-test': 'alarm-line-ack', disabled: editing }, on: { click: () => ackAlarm('all') } }) : null);
  }

  /** Element „Meldungsliste“: Aktuell / Verlauf, quittieren */
  function alarmsElement(e, editing) {
    const view = alarmView[e.id] || 'current';
    const H = { s: 180, m: 280, l: 440 }[e.height || 'm'];
    const list = h('div', { class: 'alarmrows' });
    list.style.maxHeight = `${H}px`;
    list.style.minHeight = `${Math.min(H, 120)}px`;
    const row = (x) => {
      const st = alarmState(x);
      return h('div', { class: `alarmrow lv-${x.level} st-${st}`, attrs: { 'data-alarm-row': x.id } },
        h('span', { class: `alevel lv-${x.level}`, text: A(`level.${x.level}`) }),
        h('span', { class: `astate st-${st}`, text: A(`state.${st}`) }),
        h('span', { class: 'atext' }, h('span', { text: x.text || x.name }), h('span', { class: 'muted', text: ` · ${devName(x.dev)} · ${x.name}` })),
        h('span', { class: 'atime mono', text: alarmTime(x.come) }),
        x.canAck ? h('button', { class: 'btn small', text: A('ack'), attrs: { disabled: editing, 'data-test': `alarm-ack-${x.id}` }, on: { click: () => ackAlarm(x.id) } }) : h('span'));
    };
    if (view === 'current') {
      const items = state.alarms || [];
      if (items.length) list.append(...items.map(row));
      else list.append(h('div', { class: 'alarmempty muted', text: A('none') }));
    } else {
      list.append(h('div', { class: 'alarmempty muted', text: '…' }));
      window.e4.alarmsHistory(200).then((items) => {
        list.replaceChildren(...(items.length ? items.map(row) : [h('div', { class: 'alarmempty muted', text: A('noneHistory') })]));
      }, () => {});
    }
    const tabs = h('div', { class: 'seg alarmtabs', attrs: { inert: editing } }, ...[['current', `${A('current')} ${(state.alarms || []).length || ''}`.trim()], ['history', A('history')]].map(([k, text]) =>
      h('button', { class: view === k ? 'on' : '', text, attrs: { 'aria-pressed': String(view === k), 'data-test': `alarm-tab-${k}` },
        on: { click: () => { alarmView[e.id] = k; const n = document.querySelector(`[data-eid="${CSS.escape(e.id)}"]`); if (n) n.replaceWith(alarmsElement(e, editing)); } } })));
    return h('div', { class: 'element el-alarms', attrs: { 'data-eid': e.id, 'data-alarm-list': '1', 'data-height': e.height || '' } },
      h('div', { class: 'alarmhead' }, h('span', { class: 'trendtitle', text: A('title') }), tabs, h('span', { class: 'spacer' }),
        openFaults() ? h('button', { class: 'btn small', text: A('ackAll'), attrs: { disabled: editing, 'data-test': 'alarm-ack-all' }, on: { click: () => ackAlarm('all') } }) : null),
      list);
  }

  // ---------------------------------------------------------------- Menüpunkt „Meldungen“: festlegen
  let alarmSave = null;
  async function showAlarms() {
    if (needSetupView(() => showAlarms())) return;
    closeModal();
    await flushEditorSave();
    state.alarmDefs = await window.e4.getAlarmDefs();
    state.alarmAck = await window.e4.getAlarmAck();
    state.allVars = {};
    for (const d of state.devices) {
      try { state.allVars[d.id] = (await window.e4.getDevice(d.id)).variables; } catch (e) { state.allVars[d.id] = []; }
    }
    state.view = 'alarms';
    render();
  }

  function alarmDefsChange(fn, full) {
    fn(state.alarmDefs);
    clearTimeout(alarmSave);
    alarmSave = setTimeout(async () => {
      // gespeichert werden nur Zeilen mit Variable; die Liste hier behält auch halb ausgefüllte Zeilen
      try { await window.e4.saveAlarmDefs(state.alarmDefs); } catch (err) { toast(err.message); }
      const s = document.querySelector('[data-test="alarms-saved"]');
      if (s) s.textContent = A('saved');
    }, 400);
    if (full) render();
  }

  function alarmsView() {
    const defs = state.alarmDefs || [];
    const keyOf = (v) => (v.id !== undefined && v.id !== null ? String(v.id) : v.name);
    const bitOptions = (cur, writableOnly, none) => [none ? h('option', { value: '', text: none, attrs: { selected: !cur } }) : h('option', { value: '', text: A('varChoose'), attrs: { disabled: true, selected: !cur } }),
      ...state.devices.map((d) => h('optgroup', { attrs: { label: d.name } }, (state.allVars[d.id] || []).filter((v) => v.type === 'BIT' && (!writableOnly || canWriteVar(v))).map((v) =>
        h('option', { value: `${d.id}|${keyOf(v)}`, text: `${v.userLabel || v.label} (${opText(v)})`, attrs: { selected: cur === `${d.id}|${keyOf(v)}` } }))))];
    const split = (val) => { const i = val.indexOf('|'); return { dev: val.slice(0, i), name: val.slice(i + 1) }; };
    const varLabel = (x) => { const v = (state.allVars[x.dev] || []).find((y) => keyOf(y) === x.name); return v ? v.userLabel || v.label : ''; };
    const rows = defs.map((x, i) => h('tr', { attrs: { 'data-alarm-def': i } },
      h('td', {}, h('select', { class: 'input', attrs: { 'aria-label': A('colVar'), 'data-test': `alarm-var-${i}` },
        on: { change: (ev) => alarmDefsChange((list) => { Object.assign(list[i], split(ev.target.value)); }, true) } }, bitOptions(x.name ? `${x.dev}|${x.name}` : ''))),
      h('td', {}, h('input', { class: 'input', value: x.text || '', attrs: { 'aria-label': A('colText'), placeholder: varLabel(x), 'data-test': `alarm-text-${i}` },
        on: { input: (ev) => alarmDefsChange((list) => { list[i].text = ev.target.value; }) } })),
      h('td', {}, h('select', { class: 'input', attrs: { 'aria-label': A('colLevel'), 'data-test': `alarm-level-${i}` },
        on: { change: (ev) => alarmDefsChange((list) => { list[i].level = ev.target.value; }, true) } },
      ...['fault', 'warn', 'info'].map((l) => h('option', { value: l, text: A(`level.${l}`), attrs: { selected: x.level === l } })))),
      h('td', {}, h('select', { class: 'input', attrs: { 'aria-label': A('colWhen') }, on: { change: (ev) => alarmDefsChange((list) => { list[i].when = Number(ev.target.value); }) } },
        h('option', { value: '1', text: '1', attrs: { selected: x.when !== 0 } }), h('option', { value: '0', text: '0', attrs: { selected: x.when === 0 } }))),
      h('td', {}, h('button', { class: 'iconbtn small', attrs: { 'aria-label': A('remove'), title: A('remove') },
        on: { click: () => alarmDefsChange((list) => { list.splice(i, 1); }, true) } }, icon('close')))));
    // neue Zeile: Variable wählen, Text leer (leer = Anzeige-Name der Variablen, steht grau im Feld)
    const add = () => alarmDefsChange((list) => { list.push({ id: uid(), dev: '', name: '', text: '', level: 'fault', when: 1 }); }, true);
    const head = h('div', { class: 'pagehead' },
      h('div', { class: 'grow' }, h('h1', { text: A('title') }), h('div', { class: 'muted', text: A('intro') })),
      h('span', { class: 'small muted', attrs: { 'data-test': 'alarms-saved' } }),
      h('button', { class: 'btn primary', attrs: { 'data-test': 'alarm-add' }, on: { click: add } }, icon('plus'), A('add')));
    if (!defs.length) {
      return h('div', {}, head, h('div', { class: 'card empty' }, h('h2', { text: A('empty') }), h('div', { class: 'muted', text: A('emptyHint') })));
    }
    const cols = h('colgroup', {}, ...['var', 'text', 'level', 'when', 'del'].map((k) => h('col', { class: `a-${k}` })));
    return h('div', {}, head, ackBox(), h('div', { class: 'tablewrap' }, h('table', { class: 'list alarmtable' }, cols,
      h('thead', {}, h('tr', {}, ...['colVar', 'colText', 'colLevel', 'colWhen'].map((k) => h('th', { text: A(k) })), h('th', { text: '' }))),
      h('tbody', {}, rows))));
  }

  /** Quittier-Merker je Gerät; Warnung, wenn ein Gerät Störungen hat, aber keinen Merker */
  function ackBox() {
    const keyOf = (v) => (v.id !== undefined && v.id !== null ? String(v.id) : v.name);
    const ack = state.alarmAck || {};
    const withFaults = new Set((state.alarmDefs || []).filter((x) => x.level === 'fault' && x.name).map((x) => x.dev));
    const missing = state.devices.filter((d) => withFaults.has(d.id) && !ack[d.id]);
    const rows = state.devices.map((d) => h('label', { class: 'ackrow' }, h('span', { class: 'acklabel', text: d.name }),
      h('select', { class: 'input', attrs: { 'data-ackvar': d.id, 'aria-label': `${A('ackVar')}: ${d.name}` },
        on: { change: async (ev) => {
          const next = Object.assign({}, state.alarmAck);
          if (ev.target.value) next[d.id] = ev.target.value; else delete next[d.id];
          try { state.alarmAck = await window.e4.saveAlarmAck(next); } catch (err) { toast(err.message); }
          render();
        } } },
      h('option', { value: '', text: A('ackNone'), attrs: { selected: !ack[d.id] } }),
      ...(state.allVars[d.id] || []).filter((v) => v.type === 'BIT' && canWriteVar(v)).map((v) =>
        h('option', { value: keyOf(v), text: `${v.userLabel || v.label} (${opText(v)})`, attrs: { selected: ack[d.id] === keyOf(v) } })))));
    return h('section', { class: 'card form ackbox' }, h('h2', { text: A('ackTitle') }), h('div', { class: 'hint', text: A('ackHint') }),
      h('div', { class: 'ackrows' }, rows),
      missing.length ? h('div', { class: 'result warn', attrs: { 'data-test': 'ack-missing' } }, icon('warn'),
        h('div', { text: A('ackMissing', { list: missing.map((d) => d.name).join(', ') }) })) : null);
  }

  /** „Als Meldung“ im Fenster der Variablen: Störung mit dem Anzeige-Namen anlegen */
  async function asAlarm(D) {
    const dev = state.detail && state.detail.id;
    const v = dev ? state.detail.variables.find((x) => x.name === D.name) : null;
    if (!v) return;
    const key = v.id !== undefined && v.id !== null ? String(v.id) : v.name;
    const defs = await window.e4.getAlarmDefs();
    if (defs.some((x) => x.dev === dev && x.name === key)) { toast(A('asAlarmExists')); return; }
    const text = D.label || v.userLabel || v.label;
    await window.e4.saveAlarmDefs(defs.concat([{ dev, name: key, text, level: 'fault', when: 1 }]));
    toast(A('asAlarmDone', { text }));
  }

  // ---------------------------------------------------------------- Trend (Version 1, Punkt 2)
  const TREND_RANGES = { '10m': 600e3, '1h': 3600e3, '8h': 8 * 3600e3, '1d': 86400e3, '1w': 7 * 86400e3, '1M': 30 * 86400e3 };
  const TREND_REFRESH = { '10m': 2000, '1h': 5000, '8h': 30000, '1d': 60000, '1w': 300000, '1M': 600000 };
  const TREND_COLORS = ['#3B8EEA', '#E8A317', '#22B07D', '#9B7BF0', '#E5534B'];
  const TREND_H = { s: 160, m: 240, l: 360 };
  const trendView = {}; // Element-id -> { range, end (ms, null = jetzt), loaded, e, editing }
  const TR = (k, a) => T(`ui.trend.${k}`, a);

  function trendLegendText(s) {
    if (s.missing) return TR('missing');
    const x = (state.values[s.dev] || {})[s.name];
    if (!x || x.quality !== 'good') return '–';
    if (s.bit) return x.value ? T('ui.page.on') : T('ui.page.off');
    return `${fmtD(Number(x.value), s.decimals)}${s.unit ? ` ${s.unit}` : ''}`;
  }
  function trendLegendUpdate(node, e) {
    trendView[e.id] && (trendView[e.id].e = e);
    for (const s of e.series || []) {
      const n = node.querySelector(`[data-trend-val="${CSS.escape(`${s.dev}|${s.name}`)}"]`);
      if (n) n.textContent = trendLegendText(s);
    }
  }

  /** Trend: Zeitbereich, Blättern, Legende mit aktuellen Werten, Kurven aus der Aufzeichnung */
  function trendElement(e, editing) {
    const tv = trendView[e.id] || (trendView[e.id] = { range: e.range || '1h', end: null });
    if (!TREND_RANGES[tv.range]) tv.range = '1h';
    tv.e = e;
    tv.editing = editing;
    const span = TREND_RANGES[tv.range];
    const redraw = () => { const n = document.querySelector(`[data-eid="${CSS.escape(e.id)}"]`); if (n) n.replaceWith(trendElement(tv.e, tv.editing)); };
    const series = e.series || [];
    const rangeSeg = h('div', { class: 'seg trendrange', attrs: { role: 'group', 'aria-label': E('trendRange') } },
      ...Object.keys(TREND_RANGES).map((k) => h('button', { class: tv.range === k ? 'on' : '', text: TR(`range.${k}`),
        attrs: { 'aria-pressed': String(tv.range === k), 'data-test': `trend-range-${k}` }, on: { click: () => { tv.range = k; redraw(); } } })));
    const navBtn = (text, label, fn, extra) => h('button', { class: `btn small${extra && extra.on ? ' primary' : ''}`, text,
      attrs: { 'aria-label': label, title: label, disabled: extra && extra.disabled, 'data-test': extra && extra.test }, on: { click: fn } });
    const nav = h('div', { class: 'trendnav' },
      navBtn('‹', TR('back'), () => { tv.end = (tv.end === null ? Date.now() : tv.end) - span; redraw(); }, { test: 'trend-back' }),
      navBtn('›', TR('forward'), () => { const n = tv.end + span; tv.end = n >= Date.now() ? null : n; redraw(); }, { disabled: tv.end === null, test: 'trend-forward' }),
      navBtn(TR('now'), TR('nowHint'), () => { tv.end = null; redraw(); }, { on: tv.end === null, test: 'trend-now' }),
      // als Tabelle speichern: nur am PC und nur, wenn die Kurven aufgezeichnet werden
      !WEB && !editing && canOperate() && series.some((s) => !s.missing) ? h('button', { class: 'btn small trendcsv', html: ICONS.download,
        attrs: { 'aria-label': RC('trendButton'), title: RC('trendButton'), 'data-test': 'trend-csv' }, on: { click: () => saveTrendShown(tv) } }) : null);
    const legend = h('div', { class: 'trendlegend' }, ...series.map((s) => {
      const sw = h('span', { class: `tswatch${s.bit ? ' bit' : ''}`, attrs: { 'aria-hidden': 'true' } });
      sw.style.background = TREND_COLORS[s.color] || TREND_COLORS[0];
      return h('span', { class: `tlegend${s.missing ? ' missing' : ''}` }, sw, h('span', { text: s.label }),
        h('b', { class: 'mono', text: trendLegendText(s), attrs: { 'data-trend-val': `${s.dev}|${s.name}` } }));
    }));
    const plot = h('div', { class: 'trendplot', attrs: { 'data-test': 'trend-plot' } });
    plot.style.height = `${TREND_H[e.height || 'm']}px`;
    if (!series.length) plot.append(h('div', { class: 'trendempty muted', text: TR(editing ? 'emptyEditor' : 'empty') }));
    const node = h('div', { class: 'element el-trend', attrs: { 'data-eid': e.id } },
      h('div', { class: 'trendhead', attrs: { inert: editing } }, e.label ? h('span', { class: 'trendtitle', text: e.label }) : null, h('span', { class: 'spacer' }), rangeSeg, nav),
      legend, plot);
    if (series.length) setTimeout(() => loadTrend(e.id), 0);
    return node;
  }

  async function loadTrend(id) {
    const tv = trendView[id];
    const node = document.querySelector(`[data-eid="${CSS.escape(id)}"]`);
    if (!tv || !node) return;
    const plot = node.querySelector('.trendplot');
    const series = (tv.e.series || []).filter((s) => !s.missing);
    const span = TREND_RANGES[tv.range];
    const to = tv.end === null ? Date.now() : tv.end;
    const from = to - span;
    const w = Math.max(240, Math.round(plot.clientWidth || 600));
    tv.loaded = Date.now();
    let data = [];
    try { data = series.length ? await window.e4.historyQuery(series.map((s) => ({ dev: s.dev, name: s.name })), from, to, w) : []; } catch (err) { data = []; }
    if (!plot.isConnected) return;
    drawTrend(plot, tv.e, series, data, from, to, tv.end === null);
  }
  // mitlaufende Trends nachladen (je nach Zeitbereich alle 2 s … 10 min)
  setInterval(() => {
    for (const [id, tv] of Object.entries(trendView)) {
      if (tv.end !== null || !tv.loaded || Date.now() - tv.loaded < TREND_REFRESH[tv.range]) continue;
      if (!document.querySelector(`[data-eid="${CSS.escape(id)}"]`)) { delete trendView[id]; continue; }
      loadTrend(id);
    }
  }, 1000);

  function trendTime(ts, span) {
    const d = new Date(ts);
    const hm = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    if (span <= 3600e3) return d.toLocaleTimeString('de-DE');
    if (span <= 86400e3) return hm;
    return `${d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })} ${span > 7 * 86400e3 ? '' : hm}`.trim();
  }

  /**
   * Kurven zeichnen. Skalen (Ralf 06.11.2026): Kurven mit gleicher Einheit teilen sich eine Skala (vom kleinsten bis zum
   * größten Bereich), ohne Einheit hat jede ihre eigene. Bis zu 4 Skalen: 1. links, 2. rechts, 3. außen links, 4. außen
   * rechts. Zahlen in der Farbe der Kurve, bei gemeinsamer Skala neutral. Bits als Stufenlinie unten.
   */
  function drawTrend(plot, e, series, data, from, to, live) {
    const W = Math.max(240, Math.round(plot.clientWidth || 600));
    const H = Math.max(120, Math.round(plot.clientHeight || 240));
    const nums = series.filter((s) => !s.bit);
    const bits = series.filter((s) => s.bit);
    // Skalenzahlen (oben, Mitte, unten) mit Einheit, z. B. „27,5 m³/h“; Platz nach der längsten
    const axisText = (s, i) => {
      const v = s.max - ((s.max - s.min) * i) / 4;
      const range = Math.abs(s.max - s.min);
      const dec = range >= 100 ? 1 : range >= 10 ? 10 : 100; // große Skala: ganze Zahlen, kleine: bis 2 Nachkommastellen
      return withUnit(Math.round(v * dec) / dec, s.unit);
    };
    const axisW = (s) => (s ? Math.max(46, 14 + 7 * Math.max(...[0, 2, 4].map((i) => axisText(s, i).length))) : 0);
    const groups = [];
    for (const n of nums) {
      const unit = String(n.unit || '').trim();
      let g = unit ? groups.find((x) => x.unit === unit) : null;
      if (!g) { g = { unit, min: n.min, max: n.max, members: [] }; groups.push(g); }
      g.min = Math.min(g.min, n.min);
      g.max = Math.max(g.max, n.max);
      g.members.push(n);
    }
    const axisOf = new Map();
    for (const g of groups) for (const n of g.members) axisOf.set(n, g);
    const shown = groups.slice(0, 4);
    const side = (k) => (k % 2 === 0 ? 'L' : 'R');
    const L = shown.length ? shown.filter((g, k) => side(k) === 'L').reduce((a, g) => a + axisW(g), 0) : 8;
    const R = shown.length > 1 ? shown.filter((g, k) => side(k) === 'R').reduce((a, g) => a + axisW(g), 0) : 12;
    const top = 8;
    const bottom = H - 22 - bits.length * 16;
    const pw = W - L - R;
    const ph = Math.max(20, bottom - top);
    const x = (ts) => L + Math.max(0, Math.min(1, (ts - from) / (to - from))) * pw;
    const yOf = (s, v) => { const a = axisOf.get(s) || s; return top + (1 - Math.max(-0.02, Math.min(1.02, (v - a.min) / ((a.max - a.min) || 1)))) * ph; };
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'trendsvg', role: 'img', 'aria-label': series.map((s) => s.label).join(', ') });
    for (let i = 0; i <= 4; i++) svg.append(svgEl('line', { x1: L, x2: W - R, y1: top + (ph * i) / 4, y2: top + (ph * i) / 4, class: i === 4 ? 'tgrid base' : 'tgrid' }));
    const label = (tx, ty, text, anchor, color) => { const t = svgEl('text', { x: tx, y: ty, 'text-anchor': anchor, class: 'tlabel' }); t.textContent = text; if (color) t.style.fill = color; return t; };
    // Skalen: innere direkt an der Kurvenfläche, die 3. und 4. weiter außen
    shown.forEach((g, k) => {
      const c = g.members.length === 1 ? TREND_COLORS[g.members[0].color] || TREND_COLORS[0] : null;
      const inner = k < 2;
      const xL = inner ? L - 6 : axisW(g) - 6;
      const xR = inner ? W - R + 6 : W - axisW(g) + 6;
      for (let i = 0; i <= 4; i += 2) {
        const t = label(side(k) === 'L' ? xL : xR, top + (ph * i) / 4 + 4, axisText(g, i), side(k) === 'L' ? 'end' : 'start', c);
        t.setAttribute('data-axis', String(k));
        svg.append(t);
      }
    });
    // Zeitachse: so viele Zeitpunkte, wie nebeneinander passen (je etwa 110 px)
    const ticks = Math.max(1, Math.min(4, Math.floor(pw / 110)));
    for (let i = 0; i <= ticks; i++) {
      const ts = from + ((to - from) * i) / ticks;
      svg.append(label(L + (pw * i) / ticks, H - 6, trendTime(ts, to - from), i === 0 ? 'start' : i === ticks ? 'end' : 'middle'));
    }
    const byKey = new Map(data.map((r) => [`${r.dev}|${r.name}`, r.points || []]));
    let any = false;
    const drawn = [];
    // Flächen liegen unter allen Linien (eigene Gruppe vor den Kurven)
    const areas = svgEl('g', { class: 'tareas' });
    svg.append(areas);
    series.forEach((s, si) => {
      const pts = byKey.get(`${s.dev}|${s.name}`) || [];
      if (pts.length) any = true;
      const lane = bits.indexOf(s);
      const yv = s.bit ? (v) => bottom + 10 + lane * 16 + (v ? 0 : 9) : (v) => yOf(s, v);
      let d = '';
      let pen = false;
      let last = null;
      // Tiefe „leicht“: Fläche unter jeder Kurve (Verlauf nach unten durchsichtig) – Stücke wie die Linie;
      // bei mehreren Kurven schwächer, damit es übersichtlich bleibt (Ralf 08.11.2026)
      const area = !s.bit ? [] : null;
      for (const p of pts) {
        const px = x(p[0]).toFixed(1);
        if (p[1] === null || p[1] === undefined) { pen = false; last = null; continue; }
        const ys = p.length === 3 ? [p[1], p[2]] : [p[1]];
        for (const v of ys) {
          const py = yv(v).toFixed(1);
          if (area) { if (!pen) area.push([]); area[area.length - 1].push(`${px} ${py}`); }
          if (!pen) d += `M${px} ${py}`;
          else if (s.bit) d += `H${px}V${py}`;
          else d += `L${px} ${py}`;
          pen = true;
        }
        last = ys[ys.length - 1];
      }
      // letzter Wert gilt bis jetzt (aufgezeichnet wird bei Änderung und jede Minute)
      if (pen && live && last !== null) {
        d += s.bit ? `H${x(Date.now()).toFixed(1)}` : `L${x(Date.now()).toFixed(1)} ${yv(last).toFixed(1)}`;
        if (area && area.length) area[area.length - 1].push(`${x(Date.now()).toFixed(1)} ${yv(last).toFixed(1)}`);
      }
      if (area && area.length) {
        const color = TREND_COLORS[s.color] || TREND_COLORS[0];
        const gid = `tarea-${String(e && e.id || 'x').replace(/[^w-]/g, '_')}-${si}`;
        const grad = svgEl('linearGradient', { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 });
        grad.append(svgEl('stop', { offset: 0, 'stop-color': color, 'stop-opacity': nums.length > 1 ? 0.16 : 0.3 }), svgEl('stop', { offset: 1, 'stop-color': color, 'stop-opacity': 0 }));
        const defs = svgEl('defs');
        defs.append(grad);
        const base = (top + ph).toFixed(1);
        const ad = area.map((run) => `M${run[0].split(' ')[0]} ${base}L${run.join('L')}L${run[run.length - 1].split(' ')[0]} ${base}Z`).join('');
        areas.append(defs, svgEl('path', { d: ad, class: 'tarea', fill: `url(#${gid})` }));
      }
      if (d) {
        const path = svgEl('path', { d, class: `tline${s.bit ? ' bit' : ''}` });
        path.style.stroke = TREND_COLORS[s.color] || TREND_COLORS[0];
        svg.append(path);
        // Tiefe „leicht“: Punkt am Ende jeder Kurve = aktueller Wert (bei „flach“ ausgeblendet)
        if (!s.bit && pen && last !== null) {
          let endX = live ? Date.now() : null;
          if (endX === null) for (const p of pts) if (p[1] !== null && p[1] !== undefined) endX = p[0];
          const dot = svgEl('circle', { cx: x(endX).toFixed(1), cy: yv(last).toFixed(1), r: 4, class: 'tdot' });
          dot.style.fill = TREND_COLORS[s.color] || TREND_COLORS[0];
          svg.append(dot);
        }
      }
      drawn.push({ s, pts, yv });
    });
    // Fadenkreuz: Zeit und Werte an der Stelle unter dem Zeiger
    const cross = svgEl('line', { y1: top, y2: H - 22, class: 'tcross', visibility: 'hidden' });
    const tip = h('div', { class: 'trendtip', attrs: { hidden: true } });
    svg.append(cross);
    const hit = svgEl('rect', { x: L, y: 0, width: pw, height: H, class: 'thit' });
    svg.append(hit);
    const at = (pts, ts) => {
      let best = null;
      for (const p of pts) { if (p[0] > ts) break; best = p; }
      return best;
    };
    const move = (ev) => {
      const r = svg.getBoundingClientRect();
      const px = ((ev.clientX - r.left) / r.width) * W;
      if (px < L || px > W - R) { cross.setAttribute('visibility', 'hidden'); tip.hidden = true; return; }
      const ts = from + ((px - L) / pw) * (to - from);
      cross.setAttribute('x1', px.toFixed(1));
      cross.setAttribute('x2', px.toFixed(1));
      cross.setAttribute('visibility', 'visible');
      tip.replaceChildren(h('div', { class: 'muted', text: new Date(ts).toLocaleString('de-DE') }), ...drawn.map(({ s, pts }) => {
        const p = at(pts, ts);
        let text = '–';
        if (p && p[1] !== null && p[1] !== undefined) {
          if (s.bit) text = p[p.length - 1] ? T('ui.page.on') : T('ui.page.off');
          else text = p.length === 3 && p[1] !== p[2] ? `${fmt(p[1])} … ${fmt(p[2])}` : fmt(p[1]);
          if (!s.bit && s.unit) text += ` ${s.unit}`;
        }
        const row = h('div', { class: 'tiprow' }, h('span', { text: s.label }), h('b', { class: 'mono', text }));
        row.style.color = TREND_COLORS[s.color] || TREND_COLORS[0];
        return row;
      }));
      tip.hidden = false;
      const left = (px / W) * 100;
      tip.style.left = left > 60 ? '' : `calc(${left}% + 12px)`;
      tip.style.right = left > 60 ? `calc(${100 - left}% + 12px)` : '';
    };
    hit.addEventListener('pointermove', move);
    hit.addEventListener('pointerdown', move);
    hit.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); tip.hidden = true; });
    const nodes = [svg, tip];
    if (!any) nodes.push(h('div', { class: 'trendempty muted', text: TR('noData') }));
    plot.replaceChildren(...nodes);
  }

  /** Schieberegler: beim Ziehen Wert groß anzeigen, gesendet wird erst beim Loslassen (Pfeiltasten: je Schritt) */
  function sliderElement(e, v, locked, pending) {
    const has = numOk(v, false);
    const cur = has ? Number(v) : e.min;
    const valText = steadyWidth(h('span', { class: 'mono', text: has ? fmtD(cur, e.decimals) : '–' }), e);
    const input = h('input', { class: `slide${pending ? ' pending' : ''}`, value: String(cur),
      attrs: { type: 'range', min: e.min, max: e.max, step: e.step || 1, disabled: locked, 'aria-label': e.label || e.ariaLabel, 'data-test': `slider-${e.name}` },
      on: {
        pointerdown: (ev) => { ev.target.dataset.dragging = '1'; },
        pointerup: (ev) => { const t = ev.target; setTimeout(() => { delete t.dataset.dragging; }, 300); },
        input: (ev) => { ev.target.dataset.dragging = '1'; valText.textContent = fmtD(Number(ev.target.value), e.decimals); },
        change: (ev) => { delete ev.target.dataset.dragging; sendValue(e, Number(ev.target.value)); },
      } });
    // Skala mit Strichen und Zahlen wie beim Bargraph (Ralf 08.11.2026); „Skala aus“: nur Anfang und Ende
    const scale = e.ticks === 'off' ? h('div', { class: 'barscale' }, h('span', { text: fmt(e.min) }), h('span', { text: withUnit(e.max, e.unit) }))
      : h('div', { class: 'slidescale' }, barTicks(e, false));
    // Wert hinter der Schiene wie beim Bargraph „seitlich“ (Ralf 08.11.2026)
    return h('div', { class: 'elslider' },
      h('div', { class: 'barhead' }, h('span', { class: 'ellabel', text: e.label })),
      h('div', { class: 'barside' }, h('div', { class: 'barmain' }, input, scale),
        h('span', { class: 'bignum barval side' }, valText, e.unit ? h('span', { class: 'unit', text: e.unit }) : null)));
  }

  function applyTyped(e, input) {
    const n = Number(String(input.value).trim().replace(',', '.'));
    if (!Number.isFinite(n) || n < e.min || n > e.max) {
      writes[wkey(e)] = { status: 'failed', text: T('ui.page.range', { min: fmt(e.min), max: fmt(e.max) }) };
      toast(writes[wkey(e)].text);
      delete input.dataset.dirty;
      updateElement(e.dev, e.name, true);
      return;
    }
    delete input.dataset.dirty;
    sendValue(e, n);
  }

  async function sendValue(e, value, opts) {
    const k = wkey(e);
    writes[k] = { status: 'sending', target: value, t0: Date.now() };
    updateElement(e.dev, e.name, true);
    try {
      await window.e4.writeValue(e.dev, e.name, value, opts);
      // Taster (Impuls): fertig, sobald gesendet. Sonst: bestätigt, wenn die easyE4 den Wert zurückmeldet
      if (e.kind === 'button') writes[k] = { status: 'done' };
      else writes[k].status = 'waiting';
    } catch (err) {
      writes[k] = { status: 'failed', text: err.message };
      toast(err.message); // unten groß lesbar – am Element ist bei kleiner Seite kaum Platz
    }
    updateElement(e.dev, e.name, true);
    const w = writes[k];
    if (w.status === 'waiting') {
      setTimeout(() => {
        if (writes[k] === w && w.status === 'waiting') {
          writes[k] = { status: 'unconfirmed', text: T('ui.page.unconfirmed', { value: fmt(Number(valueOf(e))) }) };
          updateElement(e.dev, e.name, true);
        }
      }, 4000);
    }
    if (w.status === 'done') setTimeout(() => { if (writes[k] === w) { delete writes[k]; updateElement(e.dev, e.name, true); } }, e.kind === 'button' ? 1200 : 2500);
  }

  /** alle Elemente einer Variablen neu zeichnen; ein gerade bearbeitetes Eingabefeld bleibt dabei unberührt */
  function updateElement(dev, name, force) {
    const shown = (state.shown || []).filter((e) => !e.missing && (e.deps || []).some((d) => d.dev === dev && d.name === name));
    if (!shown.length) return;
    const k = `${dev}|${name}`;
    const w = writes[k];
    const own = shown.find((e) => e.dev === dev && e.name === name);
    if (own && w && w.status === 'waiting' && Number(valueOf(own)) === Number(w.target)) {
      writes[k] = { status: 'done' };
      const done = writes[k];
      setTimeout(() => { if (writes[k] === done) { delete writes[k]; updateElement(dev, name, true); } }, 2500);
    }
    for (const e of shown) {
      const node = document.querySelector(`[data-eid="${CSS.escape(e.id)}"]`);
      if (!node) continue;
      if (tipActive && tipActive.e.id === e.id) continue; // gedrückten Tipptaster nicht ersetzen
      if (e.kind === 'trend') { trendLegendUpdate(node, e); continue; } // Kurve lädt selbst nach, nur die Legende neu
      // Sollwert: was gerade getippt wird, nie ersetzen (auch nicht beim Abschluss der vorigen Bestätigung);
      // steht nur der Cursor im Feld, wird neu gezeichnet und der Cursor bleibt im Feld
      const input = node.querySelector('input.spin');
      if (input && input.dataset.dirty) continue;
      const focused = !!input && document.activeElement === input;
      if (!force && focused) continue;
      const range = node.querySelector('input.slide');
      if (range && range.dataset.dragging) continue; // Schieberegler wird gerade gezogen
      const fresh = renderElement(e);
      if (node.style.zoom) fresh.style.cssText = node.style.cssText; // Schriftgröße des Elements bleibt
      node.replaceWith(fresh);
      const again = focused && fresh.querySelector('input.spin');
      if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
    }
  }

  // ------------------------------------------------------------------ Editor (Stufe 3, Teil 3a)
  // Links Elemente und Variablen, in der Mitte die Seite (Elemente frei, Raster 10 px), rechts die Eigenschaften.
  // Jede Änderung: Schnappschuss für „Rückgängig“, Seite neu ausrechnen (viewPage), kurz danach speichern.
  // die 8 häufigsten Elemente zuerst, die übrigen unter „Weitere Elemente“
  const LIB_TOP = ['number', 'lamp', 'switch', 'button', 'setpoint', 'simage', 'text', 'bar'];
  const LIB_MORE = ['frame', 'image', 'kpi', 'status', 'gauge', 'trend', 'alarms', 'choice', 'fkey', 'slider', 'device', 'lang'];
  /** aufgeklappt / zugeklappt merken (Weitere Elemente, Mehr Einstellungen) */
  const openPref = (key, value) => {
    try {
      if (value === undefined) return localStorage.getItem(`easy4visu.open.${key}`) === '1';
      localStorage.setItem(`easy4visu.open.${key}`, value ? '1' : '0');
    } catch (e) { /* gilt bis zum Neustart */ }
    return false;
  };
  /** Bereich zum Aufklappen; der Inhalt liegt immer im Fenster (nur verborgen), der Zustand wird gemerkt */
  function foldBox(key, title, body, test) {
    const d = h('details', { class: 'fold', attrs: { open: openPref(key), 'data-test': test } },
      h('summary', { class: 'foldhead', text: title }), body);
    d.addEventListener('toggle', () => openPref(key, d.open));
    return d;
  }
  const GLYPHS = { frame: '▭', text: 'T', image: '▨', simage: '◐', number: '123', lamp: '●', status: 'Aa', bar: '▤', gauge: '◔', switch: '⏻', button: '▢', setpoint: '±', slider: '⇆', clock: '◷', fkey: 'F',
    kpi: '#', choice: '▥', device: '⌁', trend: '∿', alarms: '⚠', lang: 'Aあ' };
  const BAR_GLYPHS = { logo: '▨', title: 'Aa', clock: '◷', conn: '●', text: 'T', spacer: '↔', pagekeys: '▤', fkey: 'F', alarms: '⚠', login: '☺', lang: 'Aあ' };
  const OPT_FIELDS = ['label', 'unit', 'min', 'max', 'step'];
  let ed = null;   // { pages, pageId, sel: { type: 'page' | 'el' | 'els', id | ids }, undo, redo, view, vars, panel, dev, search, dirty }
  let drag = null; // { type: 'new', kind } | { type: 'var', dev, name }
  const E = (k, a) => T(`ui.editor.${k}`, a);
  const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const curPage = () => ed.pages.find((p) => p.id === ed.pageId);
  /** Element (oder Rahmen) der aktuellen Seite: { el, index } */
  function findEl(id) {
    const items = curPage().items;
    const index = items.findIndex((e) => e.id === id);
    return index < 0 ? null : { el: items[index], index };
  }
  const resolvedEl = (id) => flatElements(ed.view).find((e) => e.id === id) || null;
  // wie kindsFor in src/core/pages.js: Ein-/Ausgänge und Analogwerte nur anzeigen
  const canWriteVar = (v) => !!v.writable && !['I', 'Q', 'IA', 'QA', 'ID'].includes(String(v.operand).toUpperCase());
  const glyph = (k) => h('span', { class: 'kglyph', text: GLYPHS[k], attrs: { 'aria-hidden': 'true' } });

  async function showEditor(pageId) {
    if (needSetupView(() => showEditor(pageId))) return;
    await refreshDevices();
    const vars = {};
    for (const d of state.devices) vars[d.id] = (await window.e4.getDevice(d.id)).variables;
    if (!ed) ed = { pages: await window.e4.listPages(), bars: await window.e4.getBars(), mode: 'page', undo: [], redo: [], panel: 'elements', search: '', sel: { type: 'page' }, dirty: false };
    ed.vars = vars;
    try { ed.symbols = await window.e4.symbolsList(); } catch (e) { ed.symbols = []; }
    if (!ed.pages.length) { ed.pages.push({ id: uid(), name: E('firstPage'), width: 1920, items: [] }); scheduleSave(); }
    if (pageId && ed.pages.some((p) => p.id === pageId)) { ed.pageId = pageId; ed.sel = { type: 'page' }; }
    if (!ed.pages.some((p) => p.id === ed.pageId)) ed.pageId = ed.pages[0].id;
    if (!vars[ed.dev]) ed.dev = state.devices[0] ? state.devices[0].id : null;
    state.view = 'editor';
    await refreshView();
    render();
  }

  /** Seite ausrechnen; passt eine Darstellung nicht zur Variablen (Ausgang als Schalter), wird sie angepasst */
  async function refreshView() {
    ed.view = await window.e4.viewPage(curPage());
    for (const r of flatElements(ed.view)) {
      if (r.missing || r.kind === 'text') continue;
      const f = findEl(r.id);
      if (f && f.el.kind !== r.kind) {
        f.el.kind = r.kind;
      }
    }
    const need = ed.view.devices.filter((id) => !state.values[id]);
    if (need.length) await loadValues(need);
  }

  const snapshot = () => JSON.stringify({ pages: ed.pages, bars: ed.bars, mode: ed.mode, pageId: ed.pageId, sel: ed.sel });

  /**
   * Änderung an den Seiten. opts.merge: Tippen im selben Feld ergibt nur einen Schritt „Rückgängig“;
   * opts.canvasOnly: nur die Seite neu zeichnen (das Eingabefeld rechts behält den Fokus)
   */
  async function change(fn, opts) {
    opts = opts || {};
    const now = Date.now();
    if (!(opts.merge && ed.mergeKey === opts.merge && now - ed.mergeAt < 3000)) {
      ed.undo.push(snapshot());
      if (ed.undo.length > 100) ed.undo.shift();
    }
    ed.mergeKey = opts.merge || null;
    ed.mergeAt = now;
    ed.redo = [];
    fn(curPage());
    await afterChange(opts);
  }

  async function afterChange(opts) {
    scheduleSave();
    await refreshView();
    if (opts && opts.canvasOnly) renderCanvas();
    else render();
  }

  async function undo(back) {
    const from = back ? ed.undo : ed.redo;
    if (!from.length) return;
    (back ? ed.redo : ed.undo).push(snapshot());
    const s = JSON.parse(from.pop());
    Object.assign(ed, { pages: s.pages, bars: s.bars || ed.bars, mode: s.mode || ed.mode, pageId: s.pageId, sel: s.sel, mergeKey: null });
    await afterChange({});
  }

  function scheduleSave() {
    ed.dirty = true;
    clearTimeout(ed.saveTimer);
    ed.saveTimer = setTimeout(saveNow, 400);
    const s = document.querySelector('[data-test="save-state"]');
    if (s) s.textContent = E('saving');
  }
  async function saveNow() {
    clearTimeout(ed.saveTimer);
    if (!ed.dirty) return;
    ed.dirty = false;
    try {
      await window.e4.savePages(ed.pages);
      await window.e4.saveBars(ed.bars);
    } catch (err) {
      ed.dirty = true;
      toast(err.message);
    }
    const s = document.querySelector('[data-test="save-state"]');
    if (s) s.textContent = ed.dirty ? E('saving') : E('saved');
  }
  /** vor dem Verlassen des Editors sofort speichern */
  async function flushEditorSave() { if (ed && ed.dirty) await saveNow(); }

  function select(sel) {
    ed.sel = sel;
    render();
  }
  /** ausgewählte Elemente (eines oder mehrere, Rahmen eingeschlossen) */
  const selIds = () => (ed.sel.type === 'els' ? ed.sel.ids.filter((id) => findEl(id)) : ed.sel.type === 'el' && findEl(ed.sel.id) ? [ed.sel.id] : []);
  const selOf = (ids) => (ids.length === 0 ? { type: 'page' } : ids.length === 1 ? { type: 'el', id: ids[0] } : { type: 'els', ids });
  /** Strg/Umschalt+Klick: Element zur Auswahl hinzufügen oder herausnehmen */
  function toggleSel(id) {
    const ids = selIds();
    select(selOf(ids.includes(id) ? ids.filter((x) => x !== id) : ids.concat([id])));
  }

  // ---------------------------------------------------------------- Ziehen & Ablegen
  function dragSource(node, data) {
    node.draggable = true;
    node.addEventListener('dragstart', (ev) => {
      ev.stopPropagation();
      drag = data;
      ev.dataTransfer.effectAllowed = 'copyMove';
      try { ev.dataTransfer.setData('text/plain', 'easy4visu'); } catch (e) { /* nur für den Browser nötig */ }
      document.body.classList.add('dragging');
    });
    node.addEventListener('dragend', () => { drag = null; clearDrop(); document.body.classList.remove('dragging'); });
  }
  function clearDrop() {
    document.querySelectorAll('.drop-in, .drop-before, .drop-on').forEach((n) => n.classList.remove('drop-in', 'drop-before', 'drop-on'));
  }
  /** accepts(drag) – passt das hierher? cls(drag) – Markierung beim Darüberziehen */
  function dropTarget(node, accepts, onDrop, cls) {
    node.addEventListener('dragover', (ev) => {
      if (!drag || !accepts(drag)) return;
      ev.preventDefault();
      ev.stopPropagation();
      const c = cls ? cls(drag) : 'drop-in';
      if (!node.classList.contains(c)) { clearDrop(); node.classList.add(c); }
    });
    node.addEventListener('dragleave', (ev) => {
      if (!node.contains(ev.relatedTarget)) node.classList.remove('drop-in', 'drop-before', 'drop-on');
    });
    node.addEventListener('drop', (ev) => {
      if (!drag || !accepts(drag)) return;
      ev.preventDefault();
      ev.stopPropagation();
      const d = drag;
      drag = null;
      clearDrop();
      document.body.classList.remove('dragging');
      onDrop(d);
    });
  }

  // Standardgröße neuer Elemente in Bildpunkten (wie SIZE in src/core/project.js)
  const SIZE = { lamp: [200, 40], status: [200, 40], switch: [240, 50], button: [200, 50], number: [200, 70], clock: [220, 70],
    setpoint: [260, 120], slider: [280, 90], bar: [280, 80], gauge: [260, 260], kpi: [220, 110], choice: [300, 90], device: [280, 90],
    trend: [600, 320], alarms: [600, 280], text: [300, 30], image: [200, 150], fkey: [160, 50], lang: [240, 50], frame: [320, 200] };
  const sizeOf = (e) => (e.kind === 'bar' && e.orient === 'v' ? [100, 240] : (SIZE[e.kind] || SIZE.number).slice());
  const GRIDPX = 10; // Raster der Seite
  const snap10 = (v) => Math.round(v / GRIDPX) * GRIDPX;
  const isFrame = (e) => !!e && e.kind === 'frame';
  /** liegt e ganz im Rahmen f? Dann gehört es dazu (wandert mit, wird mit kopiert) */
  const inFrame = (f, e) => e !== f && !isFrame(e) && e.x >= f.x && e.y >= f.y && e.x + e.w <= f.x + f.w && e.y + e.h <= f.y + f.h;
  const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  /** Elemente (ohne Rahmen) aus list, die ein anderes Element der Seite überdecken würden; moving = ids, die mitwandern */
  // Rahmen: andere Elemente ganz umschließen oder gar nicht berühren – nie halb darunter schieben;
  // Rahmen in Rahmen nur ganz darin
  function blockedBy(items, list, moving) {
    const within = (a, b) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
    const others = items.filter((o) => !moving.has(o.id));
    return list.filter((t) => {
      const frame = isFrame(findEl(t.id) ? findEl(t.id).el : t);
      return others.some((o) => o.id !== t.id && overlaps(t, o)
        && (frame ? !within(o, t) && !(isFrame(o) && within(t, o)) : !isFrame(o)));
    });
  }
  /** Rahmen zuerst (liegen hinter den Elementen) */
  const ordered = (items) => items.filter(isFrame).concat(items.filter((e) => !isFrame(e)));
  /** ids samt Inhalt der Rahmen darunter */
  function withContent(items, ids) {
    const set = new Set(ids);
    for (const e of items) if (set.has(e.id) && isFrame(e)) for (const o of items) if (inFrame(e, o)) set.add(o.id);
    return set;
  }
  /** Innenfläche eines Rahmens (dort landen neue Elemente) */
  const frameInner = (f) => ({ x: f.x + 20, y: f.y + (f.title ? 50 : 20), w: f.w - 40, h: f.h - (f.title ? 70 : 40) });
  /**
   * In einen Rahmen gezogen (Mitte bzw. Mauspunkt im Rahmen), aber ragt heraus: ganz hineinschieben, damit es zum Rahmen
   * gehört; shrink = zu große neue Elemente auf die Innenfläche verkleinern. Ergebnis: neuer Platz { x, y, w, h }.
   */
  function intoFrame(items, r, point, shrink) {
    const f = items.filter((o) => isFrame(o) && o.id !== r.id && point.x >= o.x && point.x < o.x + o.w && point.y >= o.y && point.y < o.y + o.h)
      .sort((a, b) => a.w * a.h - b.w * b.h)[0];
    if (!f || inFrame(f, r)) return r;
    const box = frameInner(f).w >= r.w && frameInner(f).h >= r.h ? frameInner(f) : { x: f.x, y: f.y, w: f.w, h: f.h };
    const w = shrink ? Math.min(r.w, Math.floor(box.w / GRIDPX) * GRIDPX) : r.w;
    const hh = shrink ? Math.min(r.h, Math.floor(box.h / GRIDPX) * GRIDPX) : r.h;
    if (w > box.w || hh > box.h || w < 2 * GRIDPX || hh < 2 * GRIDPX) return r;
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));
    return Object.assign({}, r, { x: clamp(snap10(r.x), Math.ceil(box.x / GRIDPX) * GRIDPX, Math.floor((box.x + box.w - w) / GRIDPX) * GRIDPX),
      y: clamp(snap10(r.y), Math.ceil(box.y / GRIDPX) * GRIDPX, Math.floor((box.y + box.h - hh) / GRIDPX) * GRIDPX), w, h: hh });
  }
  /**
   * Neue Elemente (und solche mit neuer Variable oder Darstellung) einmal so hoch machen, dass ihr Inhalt ganz passt –
   * danach bestimmt allein der Anwender die Größe. Gehört zum selben Schritt „Rückgängig“ wie das Anlegen.
   */
  const fitIds = new Set();
  function fitNewItems() {
    if (state.view !== 'editor' || !ed || !fitIds.size) return;
    let changed = false;
    for (const id of [...fitIds]) {
      fitIds.delete(id);
      const f = findEl(id);
      const box = document.querySelector(`#edcanvas [data-item="${CSS.escape(id)}"] > .element`);
      if (!f || !box) continue;
      const z = (f.el.font || 100) / 100;
      const need = Math.ceil((box.scrollHeight * z) / GRIDPX) * GRIDPX;
      if (need > f.el.h) { f.el.h = need; changed = true; }
      const needW = Math.ceil((box.scrollWidth * z) / GRIDPX) * GRIDPX; // z. B. Balken mit breiter Skala
      if (f.el.kind === 'bar' && needW > f.el.w) { f.el.w = needW; changed = true; }
    }
    if (changed) { scheduleSave(); refreshView().then(() => renderCanvas()); }
  }
  /** freie Stelle für w × h: zuerst im Bereich (Rahmen bzw. Bildschirm), sonst unter allem; ein neuer Rahmen meidet alles */
  function freeSpot(items, w, h, region, all) {
    const others = all ? items : items.filter((e) => !isFrame(e));
    for (let y = region.y; y + h <= region.y + region.h; y += GRIDPX) {
      for (let x = region.x; x + w <= region.x + region.w; x += GRIDPX) {
        const r = { x, y, w, h };
        if (!others.some((o) => overlaps(r, o))) return { x, y };
      }
    }
    return { x: region.x, y: snap10(itemsBottom(items) + 2 * GRIDPX) };
  }

  async function elementFromDrag(d) {
    if (d.type === 'var') return Object.assign({ id: uid() }, await window.e4.suggestElement(d.dev, d.name));
    if (d.kind === 'frame') return { id: uid(), kind: 'frame' }; // Überschrift tippt man danach rechts
    if (d.kind === 'text') return { id: uid(), kind: 'text', text: E('newText'), size: 'normal' };
    if (d.kind === 'image') return d.img ? { id: uid(), kind: 'image', img: d.img } : { id: uid(), kind: 'image' }; // Bild aus „Meine Symbole“ oder danach rechts wählen
    if (d.kind === 'simage') return { id: uid(), kind: 'image', states: true }; // Statusbild: Variable und Bilder danach rechts
    if (d.kind === 'fkey') return { id: uid(), kind: 'fkey', action: 'page' };
    if (d.kind === 'trend') return { id: uid(), kind: 'trend', series: [] }; // Kurven: Variablen darauf ziehen
    if (d.kind === 'alarms') return { id: uid(), kind: 'alarms' };
    if (d.kind === 'lang') return { id: uid(), kind: 'lang' };
    return { id: uid(), kind: d.kind, dev: '', name: '' }; // Variable wählt man danach rechts
  }

  /** nach dem Ablegen: Häkchen „aufzeichnen“ für neue Trend-Kurven setzen */
  let recordLater = [];
  async function ensureRecord(list) {
    let changed = false;
    for (const x of list) {
      const v = (ed.vars[x.dev] || []).find((y) => keyOfVar(y) === x.name);
      if (!v || v.userRecord) continue;
      try { await window.e4.setRecord(x.dev, v.name, true); v.userRecord = true; changed = true; } catch (err) { toast(err.message); }
    }
    if (changed && state.view === 'editor') { await refreshView(); render(); }
  }
  const freeColor = (series) => [0, 1, 2, 3, 4].find((c) => !series.some((x, i) => (x.color === undefined ? i : x.color) === c)) || 0;

  /**
   * Abgelegt: target = { at: { x, y } } (an diese Stelle der Seite) | { bindElId } (Variable auf ein Element)
   *   | { frameId } (in den Rahmen, freie Stelle) | {} (freie Stelle auf dem Bildschirm)
   */
  async function dropItem(d, target) {
    const el = target.bindElId ? null : await elementFromDrag(d);
    await change((page) => {
      if (target.bindElId) {
        const f = findEl(target.bindElId);
        if (!f) return;
        if (f.el.kind === 'trend') {
          f.el.series = f.el.series || [];
          if (f.el.series.some((x) => x.dev === d.dev && x.name === d.name)) return;
          if (f.el.series.length >= 4) { toast(E('trendFull')); return; }
          f.el.series.push({ dev: d.dev, name: d.name, color: freeColor(f.el.series) });
          ed.sel = { type: 'el', id: f.el.id };
          recordLater.push({ dev: d.dev, name: d.name });
          return;
        }
        f.el.dev = d.dev;
        f.el.name = d.name;
        for (const k of OPT_FIELDS) delete f.el[k];
        fitIds.add(f.el.id);
        ed.sel = { type: 'el', id: f.el.id };
        return;
      }
      const area = workArea(page, ed.bars);
      let [w, hh] = sizeOf(el);
      let spot;
      const screen = { x: 20, y: 20, w: area.w - 40, h: area.h - 40 };
      const inside = (p, r) => p.x >= r.x && p.y >= r.y && p.x + w <= r.x + r.w && p.y + hh <= r.y + r.h;
      if (target.at) {
        spot = { x: Math.max(0, Math.min(snap10(target.at.x), snap10(area.w - w))), y: Math.max(0, page.scroll ? snap10(target.at.y) : Math.min(snap10(target.at.y), Math.floor((area.h - hh) / GRIDPX) * GRIDPX)) };
        if (!isFrame(el)) {
          const fit = intoFrame(page.items, Object.assign({ id: el.id }, spot, { w, h: hh }), target.at, true);
          spot = { x: fit.x, y: fit.y };
          w = fit.w;
          hh = fit.h;
        }
        // dort liegt schon ein Element: die nächste freie Stelle rechts/unterhalb davon, sonst irgendwo frei
        if (isFrame(el) && blockedBy(page.items, [Object.assign({ id: el.id, kind: el.kind }, spot, { w, h: hh })], new Set()).length) {
          // neuer Rahmen auf Elementen: so weit vergrößern, dass er sie ganz umschließt (Rahmen um vorhandene Elemente);
          // geht das nicht (z. B. halb über einem anderen Rahmen), auf eine ganz freie Stelle
          let r = Object.assign({ id: el.id, kind: el.kind }, spot, { w, h: hh });
          for (let i = 0; i < 10; i++) {
            const hit = page.items.filter((o) => !isFrame(o) && overlaps(r, o) && !inFrame(r, o));
            if (!hit.length) break;
            const b = boundsOf(hit);
            const x = Math.max(0, Math.min(r.x, b.x - 2 * GRIDPX));
            const y = Math.max(0, Math.min(r.y, b.y - 2 * GRIDPX));
            r = Object.assign(r, { x, y, w: Math.max(r.x + r.w, b.x + b.w + 2 * GRIDPX) - x, h: Math.max(r.y + r.h, b.y + b.h + 2 * GRIDPX) - y });
          }
          if (blockedBy(page.items, [r], new Set()).length) spot = freeSpot(page.items, w, hh, screen, true);
          else { spot = { x: r.x, y: r.y }; w = r.w; hh = r.h; }
        } else if (!isFrame(el) && blockedBy(page.items, [Object.assign({ id: el.id }, spot, { w, h: hh })], new Set()).length) {
          // im Rahmen zuerst eine freie Stelle im selben Rahmen
          const fr = page.items.find((o) => isFrame(o) && inFrame(o, Object.assign({ id: el.id }, spot, { w, h: hh })));
          const inner = fr ? frameInner(fr) : null;
          const inFr = inner ? freeSpot(page.items, w, hh, inner) : null;
          if (inFr && inside(inFr, inner)) spot = inFr;
          else {
            const near = freeSpot(page.items, w, hh, { x: spot.x, y: spot.y, w: area.w - spot.x, h: area.h - spot.y });
            spot = inside(near, screen) || near.y < area.h ? near : freeSpot(page.items, w, hh, screen);
          }
        }
      } else {
        // Klick in der Elementliste: in den gewählten Rahmen, sonst auf eine leere Stelle des Bildschirms (nicht in einen Rahmen)
        const fr = target.frameId ? findEl(target.frameId) : null;
        if (fr) {
          const inner = frameInner(fr.el);
          const ww = Math.min(w, Math.max(40, inner.w));
          const p = freeSpot(page.items, ww, hh, inner);
          if (p.x + ww <= inner.x + inner.w && p.y + hh <= inner.y + inner.h) { w = ww; spot = p; }
        }
        if (!spot) spot = freeSpot(page.items, w, hh, screen, true);
      }
      Object.assign(el, spot, { w, h: hh });
      if (isFrame(el)) page.items.unshift(el); else { page.items.push(el); fitIds.add(el.id); }
      ed.sel = { type: 'el', id: el.id };
    });
    if (recordLater.length) { const list = recordLater; recordLater = []; await ensureRecord(list); }
  }

  /** Klick statt Ziehen: in den gewählten Rahmen (nur wenn genau dieser gewählt ist), sonst auf eine leere Stelle */
  function addBySelection(d) {
    const f = ed.sel.type === 'el' ? findEl(ed.sel.id) : null;
    if (f && isFrame(f.el) && !(d.type === 'new' && d.kind === 'frame')) return dropItem(d, { frameId: f.el.id });
    // vorher auf eine freie Stelle der Seite geklickt: dorthin (einmal), sonst auf einen freien Platz
    const at = ed.sel.type === 'page' && ed.clickAt && ed.clickAt.pageId === ed.pageId ? { x: ed.clickAt.x, y: ed.clickAt.y } : null;
    ed.clickAt = null;
    return dropItem(d, at ? { at } : {});
  }

  /** Löschen: Rahmen nehmen ihren Inhalt mit; ein Rahmen, der dadurch leer wird, verschwindet auch */
  function removeSelected() {
    const s = ed.sel;
    if (s.type === 'baritem') { removeBarItem(s.pos, s.id); return; }
    const ids = selIds();
    if (!ids.length) return;
    const gone = withContent(curPage().items, ids);
    if (gone.size > 1 && !window.confirm(E('deleteItemsConfirm', { n: gone.size }))) return;
    change((page) => {
      const emptied = page.items.filter((f) => isFrame(f) && !gone.has(f.id) && page.items.some((e) => gone.has(e.id) && inFrame(f, e)));
      page.items = page.items.filter((e) => !gone.has(e.id));
      for (const f of emptied) if (!page.items.some((e) => inFrame(f, e))) page.items.splice(page.items.indexOf(f), 1);
      ed.sel = { type: 'page' };
    });
  }

  /** Kopieren (Strg+D): mit dem Inhalt der Rahmen; daneben, wenn rechts Platz ist, sonst darunter */
  function duplicateSelected() {
    const ids = selIds();
    if (!ids.length) return;
    change((page) => {
      const set = withContent(page.items, ids);
      const src = page.items.filter((e) => set.has(e.id));
      const box = boundsOf(src);
      const area = workArea(page, ed.bars);
      const dx = box.x + 2 * box.w + GRIDPX <= area.w ? box.w + GRIDPX : 0;
      const dy = dx ? 0 : box.h + GRIDPX;
      const map = {};
      const copies = src.map((e) => { const n = Object.assign(JSON.parse(JSON.stringify(e)), { id: uid(), x: e.x + dx, y: e.y + dy }); map[e.id] = n.id; return n; });
      page.items.push(...copies);
      ed.sel = selOf(ids.map((id) => map[id]));
    });
  }
  const boundsOf = (list) => {
    const x = Math.min(...list.map((e) => e.x));
    const y = Math.min(...list.map((e) => e.y));
    return { x, y, w: Math.max(...list.map((e) => e.x + e.w)) - x, h: Math.max(...list.map((e) => e.y + e.h)) - y };
  };

  /**
   * „Rahmen darum“ (Ralf 08.11.2026): um die gewählten Elemente einen Rahmen legen. Abstand 20, wenn es eng ist 10
   * oder 0 Bildpunkte; der Rahmen darf andere Elemente nur ganz umschließen, nie halb überdecken.
   */
  function frameAroundSelected() {
    const page = curPage();
    const ids = selIds();
    const sel = page.items.filter((e) => ids.includes(e.id) && !isFrame(e));
    if (!sel.length) return;
    const b = boundsOf(sel);
    let r = null;
    for (const m of [2 * GRIDPX, GRIDPX, 0]) {
      const x = Math.max(0, b.x - m);
      const y = Math.max(0, b.y - m);
      const t = { id: '', kind: 'frame', x, y, w: b.x + b.w + m - x, h: b.y + b.h + m - y };
      if (!blockedBy(page.items, [t], new Set()).length) { r = t; break; }
    }
    if (!r) { toast(E('frameAroundNo')); return; }
    change((p) => {
      const el = Object.assign(r, { id: uid() });
      // hinter die Elemente, aber vor einen Rahmen, in dem er selbst liegt
      const outer = p.items.reduce((n, o, i) => (isFrame(o) && r.x >= o.x && r.y >= o.y && r.x + r.w <= o.x + o.w && r.y + r.h <= o.y + o.h ? i + 1 : n), 0);
      p.items.splice(outer, 0, el);
      ed.sel = { type: 'el', id: el.id };
    });
  }
  /** Rahmen bekommt eine Überschrift: wenn möglich nach oben wachsen, damit die Überschrift den Inhalt nicht verdeckt */
  function roomForTitle(f) {
    const page = curPage();
    const inside = page.items.filter((o) => inFrame(f, o));
    if (!inside.length) return;
    const need = f.y + 5 * GRIDPX - Math.min(...inside.map((o) => o.y));
    if (need <= 0) return;
    const d = Math.ceil(need / GRIDPX) * GRIDPX;
    const moving = withContent(page.items, [f.id]);
    // a) nach oben wachsen
    const up = { id: f.id, kind: 'frame', x: f.x, y: f.y - d, w: f.w, h: f.h + d };
    if (up.y >= 0 && !blockedBy(page.items, [up], moving).length) { f.y = up.y; f.h = up.h; return; }
    // b) sonst nach unten wachsen und den Inhalt nach unten schieben
    const down = { id: f.id, kind: 'frame', x: f.x, y: f.y, w: f.w, h: f.h + d };
    const moved = inside.map((o) => Object.assign({}, o, { y: o.y + d }));
    if (!blockedBy(page.items, [down].concat(moved), moving).length) { f.h = down.h; for (const o of inside) o.y += d; return; }
    toast(E('frameTitleNoRoom'));
  }

  function setOpt(id, key, raw) {
    const el = findEl(id).el;
    const text = String(raw).trim();
    const value = ['min', 'max', 'step'].includes(key) ? Number(text.replace(',', '.')) : text;
    if (text && (typeof value === 'string' || Number.isFinite(value))) el[key] = value;
    else delete el[key];
  }

  // Seiten
  function addPage() {
    change(() => {
      const cur = curPage(); // neue Seite für denselben Bildschirm
      const p = { id: uid(), name: E('newPage', { n: ed.pages.length + 1 }), width: cur.width || 1920, height: pageH(cur), screen: cur.screen, items: [] };
      ed.pages.push(p);
      ed.pageId = p.id;
      ed.sel = { type: 'page' };
    });
  }
  async function switchPage(id) {
    ed.pageId = id;
    ed.mode = 'page';
    ed.sel = { type: 'page' };
    await refreshView();
    render();
  }
  function movePage(dir) {
    change(() => {
      const i = ed.pages.findIndex((p) => p.id === ed.pageId);
      const j = i + dir;
      if (j < 0 || j >= ed.pages.length) return;
      ed.pages.splice(j, 0, ed.pages.splice(i, 1)[0]);
    });
  }
  function deletePage() {
    if (ed.pages.length < 2) { toast(E('lastPage')); return; }
    if (!window.confirm(E('deletePageConfirm', { name: curPage().name }))) return;
    change(() => {
      const i = ed.pages.findIndex((p) => p.id === ed.pageId);
      ed.pages.splice(i, 1);
      ed.pageId = ed.pages[Math.max(0, i - 1)].id;
      ed.sel = { type: 'page' };
    });
  }

  // ---------------------------------------------------------------- Seite: Elemente frei ziehen, Größe ändern, Hilfslinien
  // Bildschirmgrößen zur Auswahl (Breite, Höhe, Hinweis) – Tablets mit den Bildpunkten, die der Browser meldet
  const SCREENS = [
    ['pc', [[1920, 1080, 'Full HD'], [2560, 1440], [1600, 900], [1366, 768], [1280, 720]]],
    ['panel', [[800, 480, '7"'], [1024, 600, '7" / 10"'], [1280, 800, '10" / 12" / 15"'], [1024, 768, '10" / 15" · 4 : 3'], [1920, 1080, '15" – 24"']]],
    ['tablet', [[1280, 800, 'Android'], [1180, 820, 'iPad 10. / Air'], [1024, 768, 'iPad']]],
    ['phone', [[844, 390, 'iPhone 6,1" (ältere)'], [874, 402, 'iPhone 6,3" (neuere)'], [956, 440, 'iPhone Plus / Pro Max'], [800, 360, 'Android']]],
  ];
  const pageH = (p) => p.height || Math.round(((p.width || 1920) * 9) / 16);
  /**
   * WYSIWYG: die Seite hat eine feste Breite (z. B. 1920 px). Editor und Bedienseite zeichnen sie genau so und
   * vergrößern/verkleinern sie nur passend zum Platz (CSS zoom). Schmal (Handy): Karten untereinander.
   */
  const zoomOf = (node) => { const g = node && node.closest('.freegrid'); return (g && parseFloat(g.style.zoom)) || 1; };
  function fitGrid(grid) {
    const screen = grid.closest('.screen'); // mit Leisten: der ganze Bildschirm (Leisten + Karten) muss passen
    const box = (screen || grid).parentElement;
    if (!box || !grid.isConnected) return;
    const cs = getComputedStyle(box);
    const avail = box.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
    const w = Number(grid.dataset.w) || 1920;
    const stacked = !grid.classList.contains('edit') && !grid.classList.contains('freepage') && avail < 700;
    grid.classList.toggle('stacked', stacked);
    grid.style.width = stacked ? '' : `${w}px`;
    // Bedienseite ohne Rollen: der ganze Bildschirm (Breite und Höhe) passt hinein, was darunter liegt, ist abgeschnitten
    const hgt = Number(grid.dataset.h) || 0;
    // im Browser (Handy/Tablet) füllt die Seite die Breite und rollt bei Bedarf – quer wäre sie sonst winzig
    const fitall = hgt && !stacked && grid.classList.contains('fitall');
    const whole = fitall && !(WEB && !grid.classList.contains('edit'));
    grid.style.height = fitall ? `${hgt}px` : '';
    // verfügbare Höhe aus dem Fenster (nicht aus der Fläche selbst – die schrumpft mit der Seite und wächst sonst nie wieder)
    const main = box.closest('.content');
    const mainPad = main ? parseFloat(getComputedStyle(main).paddingBottom) || 0 : 0;
    const availH = window.innerHeight - box.getBoundingClientRect().top - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0) - mainPad;
    // im Editor nicht kleiner als 50 % (sonst kaum zu bedienen) – dann waagerecht rollen; Bedienseite passt immer ganz
    const bw = Number(grid.dataset.bw) || 0;
    const bh = Number(grid.dataset.bh) || 0;
    // Handy-Seite im Querformat, auf dem Tablet oder im Editor: nur wenig vergrößern, sonst ist alles riesig
    const maxUp = w < 700 ? (grid.classList.contains('edit') ? 1.5 : 1.3) : Infinity;
    const fit = Math.floor(Math.min(avail / (w + bw), whole && availH > 0 ? availH / (hgt + bh) : Infinity, maxUp) * 1000) / 1000;
    const zoom = stacked ? '' : String(grid.classList.contains('edit') ? Math.max(0.5, fit) : Math.max(WEB ? 0.1 : 0.2, fit));
    // im Browser: wie ein Bild verkleinern (transform) statt CSS zoom – Safari/iPad rechnet Schrift unter zoom anders,
    // dann passen Texte nicht mehr in ihre Kästen. So sieht die Seite überall genau wie am PC aus.
    if (WEB && screen && zoom && !grid.classList.contains('edit')) { scaleScreen(screen, box, Number(zoom), avail); return; }
    // kleiner wird sofort, größer erst ab einem spürbaren Schritt – so kann der Zoom nicht hin und her springen
    const old = parseFloat(grid.style.zoom);
    if (!(zoom && old && Number(zoom) > old && Number(zoom) - old < 0.005)) grid.style.zoom = zoom;
    // Bedien-Hilfen im Editor (Griff der Karten) bleiben auf dem Schirm gleich groß, egal wie stark verkleinert
    grid.style.setProperty('--unzoom', String(1 / (parseFloat(grid.style.zoom) || 1)));
    // Leisten genauso groß zeichnen wie die Karten (die untere Leiste im Editor liegt im Raster und wächst mit)
    if (screen) for (const b of screen.querySelectorAll(':scope > .vbar, :scope > .vmid > .vbar')) b.style.zoom = grid.style.zoom;
  }
  /** Bildschirm (Leisten + Seite) in natürlicher Größe auslegen und als Ganzes skalieren; die Hülle bekommt die sichtbare Höhe */
  function scaleScreen(screen, box, z, avail) {
    box.classList.add('scaled');
    const w = screen.offsetWidth;
    const left = Math.max(0, Math.floor((avail - w * z) / 2));
    const scale = (n) => Object.assign(n.style, { transformOrigin: '0 0', transform: `translateX(${left}px) scale(${z})` });
    scale(screen);
    box.style.height = `${Math.ceil(screen.offsetHeight * z)}px`;
    // untere Leiste (Seitentasten) bleibt am unteren Rand: in einer eigenen, nicht skalierten Hülle – in der skalierten
    // Seite würde „sticky“ mitskaliert und landete neben dem Bildschirmrand
    let holder = box.nextElementSibling && box.nextElementSibling.classList.contains('webbottom') ? box.nextElementSibling : null;
    const bar = holder ? holder.firstElementChild : screen.querySelector(':scope > .vbar-bottom:not(.ingrid)');
    if (!bar) return;
    if (!holder) { holder = h('div', { class: 'webbottom' }); box.after(holder); holder.append(bar); bar.style.width = `${w}px`; }
    scale(bar);
    const hh = Math.ceil(bar.offsetHeight * z);
    holder.style.height = `${hh}px`;
    // braucht sie mehr als ein Viertel der Höhe (Handy quer), liegt sie normal unter der Seite – sonst bliebe kaum Platz
    holder.classList.toggle('flow', hh > window.innerHeight / 4);
  }
  const refitAll = () => document.querySelectorAll('.freegrid').forEach((g) => fitGrid(g));
  window.addEventListener('resize', refitAll);
  // Handy drehen: die Maße stimmen oft erst nach einem Moment – mehrmals nachpassen
  window.addEventListener('orientationchange', () => { for (const ms of [100, 400, 1000]) setTimeout(refitAll, ms); });
  const gridObserver = new ResizeObserver((entries) => {
    for (const en of entries) { const g = en.target.querySelector(':scope > .freegrid, :scope > .screen > .vmid > .freegrid'); if (g) fitGrid(g); }
  });
  function watchGrid(grid) {
    queueMicrotask(() => { fitGrid(grid); const box = (grid.closest('.screen') || grid).parentElement; if (box) gridObserver.observe(box); });
    return grid;
  }
  /** Punkt auf der Seite (in Bildpunkten der Seite) unter dem Mauszeiger */
  function pagePoint(grid, clientX, clientY) {
    const r = grid.getBoundingClientRect();
    const z = zoomOf(grid);
    return { x: (clientX - r.left) / z, y: (clientY - r.top) / z };
  }
  let lastDragPos = { x: 0, y: 0 };
  document.addEventListener('dragover', (ev) => { lastDragPos = { x: ev.clientX, y: ev.clientY }; }, true); // vor den Ablagezielen
  let suppressClick = false;

  /**
   * An einer Kante oder der Mitte eines anderen Elements einrasten (bis 6 Bildpunkte entfernt).
   * edges: Lage der eigenen Kanten (z. B. links, Mitte, rechts) relativ zu pos; Ergebnis { pos, line } oder null
   */
  function alignTo(pos, edges, targets) {
    let best = null;
    for (const off of edges) for (const t of targets) {
      const d = t - (pos + off);
      if (Math.abs(d) <= 6 && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, line: t };
    }
    return best ? { pos: pos + best.d, line: best.line } : null;
  }

  /**
   * Element ziehen (mode 'move': verschieben; gewählte Elemente und der Inhalt von Rahmen wandern mit) oder an der
   * Ecke die Größe ändern (mode 'size'). Raster 10 px; Alt = pixelgenau; rote Hilfslinien bei bündigen Kanten.
   */
  function startItemDrag(ev, id, mode) {
    if (ev.button !== undefined && ev.button !== 0) return;
    const grid = ev.target.closest('.freegrid');
    const page = curPage();
    const main = findEl(id).el;
    const z = zoomOf(grid);
    const ids = mode === 'move' ? [...withContent(page.items, selIds().includes(id) ? selIds() : [id])] : [id];
    const start = ids.map((x) => { const e = findEl(x).el; return { id: x, x: e.x, y: e.y, w: e.w, h: e.h, node: grid.querySelector(`[data-item="${CSS.escape(x)}"]`) }; });
    const others = page.items.filter((e) => !ids.includes(e.id));
    const xs = others.flatMap((o) => [o.x, o.x + o.w / 2, o.x + o.w]);
    const ys = others.flatMap((o) => [o.y, o.y + o.h / 2, o.y + o.h]);
    const s0 = { x: ev.clientX, y: ev.clientY };
    const minX = Math.min(...start.map((t) => t.x));
    const minY = Math.min(...start.map((t) => t.y));
    // nicht über den Bildschirmrand hinaus (unten nur, wenn die Seite nicht rollen darf); was schon draußen liegt, darf nicht weiter hinaus
    const lim = screenLimit(page);
    const maxDx = Math.max(0, lim.w - Math.max(...start.map((t) => t.x + t.w)));
    const maxDy = Math.max(0, lim.h - Math.max(...start.map((t) => t.y + t.h)));
    let active = false;
    let res = null;
    let lines = [];
    const showLines = (v, hz) => {
      lines.forEach((n) => n.remove());
      lines = [];
      const H = Math.max(grid.scrollHeight, itemsBottom(page.items));
      if (v !== null) { const n = h('div', { class: 'guide v', attrs: { 'data-test': 'guide' } }); Object.assign(n.style, { left: `${v}px`, height: `${H}px` }); grid.append(n); lines.push(n); }
      if (hz !== null) { const n = h('div', { class: 'guide h', attrs: { 'data-test': 'guide' } }); n.style.top = `${hz}px`; grid.append(n); lines.push(n); }
    };
    const move = (m) => {
      const dx = (m.clientX - s0.x) / z;
      const dy = (m.clientY - s0.y) / z;
      if (!active) {
        if (Math.abs(dx) + Math.abs(dy) < 4 / z) return; // erst ab ein paar Pixeln: sonst ist es ein Klick
        active = true;
        grid.classList.add('dragging-items');
      }
      const fine = m.altKey;
      const sn = (v) => (fine ? Math.round(v) : snap10(v));
      let vLine = null;
      let hLine = null;
      if (mode === 'move') {
        let x = sn(main.x + dx);
        let y = sn(main.y + dy);
        if (!fine) {
          const ax = alignTo(x, [0, main.w / 2, main.w], xs);
          const ay = alignTo(y, [0, main.h / 2, main.h], ys);
          if (ax) { x = Math.round(ax.pos); vLine = ax.line; }
          if (ay) { y = Math.round(ay.pos); hLine = ay.line; }
        }
        const gx = Math.min(maxDx, Math.max(-minX, x - main.x));
        const gy = Math.min(maxDy, Math.max(-minY, y - main.y));
        res = start.map((t) => ({ id: t.id, x: t.x + gx, y: t.y + gy, w: t.w, h: t.h }));
      } else {
        let r = sn(main.x + main.w + dx);
        let b = sn(main.y + main.h + dy);
        if (!fine) {
          const ax = alignTo(r, [0], xs);
          const ay = alignTo(b, [0], ys);
          if (ax) { r = Math.round(ax.pos); vLine = ax.line; }
          if (ay) { b = Math.round(ay.pos); hLine = ay.line; }
        }
        r = Math.min(r, Math.max(lim.w, main.x + main.w));
        b = Math.min(b, Math.max(lim.h, main.y + main.h));
        res = [{ id, x: main.x, y: main.y, w: Math.max(2 * GRIDPX, r - main.x), h: Math.max(2 * GRIDPX, b - main.y) }];
      }
      const bad = new Set(blockedBy(page.items, res, new Set(ids)).map((t) => t.id));
      for (const t of res) {
        const n = start.find((q) => q.id === t.id).node;
        if (n) { Object.assign(n.style, { left: `${t.x}px`, top: `${t.y}px`, width: `${t.w}px`, height: `${t.h}px` }); n.classList.toggle('blocked', bad.has(t.id)); }
      }
      showLines(vLine, hLine);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      showLines(null, null);
      grid.classList.remove('dragging-items');
      if (!active) return;
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 0);
      if (!res || res.every((t) => { const o = start.find((q) => q.id === t.id); return o.x === t.x && o.y === t.y && o.w === t.w && o.h === t.h; })) return;
      // ein einzelnes Element in einen Rahmen gezogen, ragt aber heraus: ganz hineinschieben (sonst gehört es nicht dazu)
      if (mode === 'move' && res.length === 1 && !isFrame(findEl(res[0].id).el)) {
        res[0] = intoFrame(page.items, res[0], { x: res[0].x + res[0].w / 2, y: res[0].y + res[0].h / 2 }, false);
      }
      // auf einem anderen Element losgelassen: zurück an den alten Platz
      if (blockedBy(page.items, res, new Set(ids)).length) { renderCanvas(); toast(E('overlapBack')); return; }
      const keepSel = selIds().includes(id);
      change(() => {
        for (const t of res) Object.assign(findEl(t.id).el, { x: t.x, y: t.y, w: t.w, h: t.h });
        if (!keepSel) ed.sel = { type: 'el', id };
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  /** Rahmen auf freier Fläche aufziehen: berührte Elemente werden ausgewählt (Rahmen nur, wenn ganz darin) */
  function startRubberBand(ev, grid) {
    if (ev.button !== undefined && ev.button !== 0) return;
    const start = { x: ev.clientX, y: ev.clientY };
    let box = null;
    const rect = (m) => ({ left: Math.min(start.x, m.clientX), top: Math.min(start.y, m.clientY), right: Math.max(start.x, m.clientX), bottom: Math.max(start.y, m.clientY) });
    const move = (m) => {
      if (!box && Math.abs(m.clientX - start.x) + Math.abs(m.clientY - start.y) < 6) return;
      if (!box) { box = h('div', { class: 'rubberband', attrs: { 'data-test': 'rubberband' } }); document.body.append(box); }
      const r = rect(m);
      Object.assign(box.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.right - r.left}px`, height: `${r.bottom - r.top}px` });
    };
    const up = (m) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (!box) return;
      box.remove();
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 0);
      const r = rect(m);
      const ids = [...grid.querySelectorAll('[data-item]')].filter((n) => {
        const b = n.getBoundingClientRect();
        if (n.classList.contains('isframe')) return b.left >= r.left && b.right <= r.right && b.top >= r.top && b.bottom <= r.bottom;
        return b.left < r.right && b.right > r.left && b.top < r.bottom && b.bottom > r.top;
      }).map((n) => n.dataset.item);
      select(selOf(ids));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  /** Element verschieben; ein Rahmen nimmt seinen Inhalt mit */
  function shiftItem(page, e, dx, dy) {
    const list = isFrame(e) ? [e].concat(page.items.filter((o) => inFrame(e, o))) : [e];
    for (const o of list) { o.x = Math.max(0, o.x + dx); o.y = Math.max(0, o.y + dy); }
  }

  /** Fläche, in der Elemente liegen dürfen: Bildschirm ohne Leisten (darf die Seite rollen: nach unten offen) */
  const screenLimit = (page) => { const a = workArea(page, ed.bars); return { w: a.w, h: page.scroll ? Infinity : a.h }; };

  /** Elemente, die sich in Spalten (cols) bzw. Reihen (rows) überschneiden, zu Gruppen zusammenfassen */
  function itemGroups(list, by) {
    const touch = by === 'cols' ? (p, q) => p.x < q.x + q.w && q.x < p.x + p.w : (p, q) => p.y < q.y + q.h && q.y < p.y + p.h;
    const groups = [];
    for (const e of list) {
      const hit = groups.filter((g) => g.some((o) => touch(e, o)));
      const merged = [e].concat(...hit);
      groups.splice(0, groups.length, ...groups.filter((g) => !hit.includes(g)), merged);
    }
    return groups;
  }
  /** Anzahl der Element-Paare, die sich überdecken (Rahmen zählen nicht) */
  const overlapCount = (items) => {
    const els = items.filter((e) => !isFrame(e));
    let n = 0;
    els.forEach((p, i) => { for (const q of els.slice(i + 1)) if (overlaps(p, q)) n++; });
    return n;
  };

  /**
   * Ausrichten / gleiche Größe für die ausgewählten Elemente (das zuerst gewählte ist das Maß für die Größe).
   * Untereinander stehende Elemente bleiben dabei als Stapel zusammen (oben/unten), nebeneinander stehende als Reihe
   * (links/rechts). Würde sich danach etwas überdecken, passiert nichts (Hinweis).
   */
  function alignItems(how) {
    const ids = selIds();
    if (ids.length < 2) return;
    const apply = (page) => {
      const list = ids.map((id) => page.items.find((x) => x.id === id));
      const first = list[0];
      const box = boundsOf(list);
      if (how === 'top' || how === 'bottom') {
        for (const g of itemGroups(list, 'cols')) {
          const dy = how === 'top' ? box.y - Math.min(...g.map((e) => e.y)) : box.y + box.h - Math.max(...g.map((e) => e.y + e.h));
          g.forEach((e) => shiftItem(page, e, 0, dy));
        }
      }
      if (how === 'left' || how === 'right') {
        for (const g of itemGroups(list, 'rows')) {
          const dx = how === 'left' ? box.x - Math.min(...g.map((e) => e.x)) : box.x + box.w - Math.max(...g.map((e) => e.x + e.w));
          g.forEach((e) => shiftItem(page, e, dx, 0));
        }
      }
      for (const e of list) {
        if (how === 'width') e.w = first.w;
        if (how === 'height') e.h = first.h;
      }
    };
    // erst an einer Kopie ausprobieren: entstünden neue Überdeckungen, lieber nichts tun
    const trial = JSON.parse(JSON.stringify(curPage()));
    const before = overlapCount(trial.items);
    apply(trial);
    if (overlapCount(trial.items) > before) { toast(E('alignOverlap')); return; }
    change((page) => apply(page));
  }

  /** Pfeiltasten: ausgewählte Elemente um 10 Bildpunkte (mit Alt: 1) verschieben */
  function nudgeItems(dx, dy) {
    const ids = selIds();
    if (!ids.length) return false;
    const page = curPage();
    const set = withContent(page.items, ids);
    const list = page.items.filter((e) => set.has(e.id));
    const lim = screenLimit(page);
    const gx = Math.min(Math.max(0, lim.w - Math.max(...list.map((e) => e.x + e.w))), Math.max(-Math.min(...list.map((e) => e.x)), dx));
    const gy = Math.min(Math.max(0, lim.h - Math.max(...list.map((e) => e.y + e.h))), Math.max(-Math.min(...list.map((e) => e.y)), dy));
    if (!gx && !gy) return true;
    // nicht auf ein anderes Element schieben
    if (blockedBy(page.items, list.map((e) => ({ id: e.id, x: e.x + gx, y: e.y + gy, w: e.w, h: e.h })), set).length) { toast(E('overlapNo')); return true; }
    change(() => { for (const e of curPage().items.filter((x) => set.has(x.id))) { e.x += gx; e.y += gy; } }, { merge: `nudge-${ids.join()}`, canvasOnly: true });
    return true;
  }

  // ---------------------------------------------------------------- Ansicht
  let showRaster = (() => { try { return localStorage.getItem('easy4visu.raster') !== '0'; } catch (e) { return true; } })();
  function toggleRaster() {
    showRaster = !showRaster;
    try { localStorage.setItem('easy4visu.raster', showRaster ? '1' : '0'); } catch (e) { /* gilt bis zum Neustart */ }
    const g = document.querySelector('#edcanvas .freegrid');
    if (g) g.classList.toggle('raster', showRaster);
    const b = document.querySelector('[data-test="raster-toggle"]');
    if (b) { b.classList.toggle('on', showRaster); b.setAttribute('aria-pressed', String(showRaster)); }
  }

  function editorView() {
    state.shown = flatElements(ed.view);
    const tabs = h('div', { class: 'seg tabs', attrs: { role: 'tablist', 'aria-label': E('pages') } },
      ...ed.pages.map((p) => h('button', { class: p.id === ed.pageId && ed.mode !== 'bars' ? 'on' : '', text: p.name,
        attrs: { role: 'tab', 'aria-selected': String(p.id === ed.pageId), 'data-edit-tab': p.id }, on: { click: () => switchPage(p.id) } })));
    const barsTab = h('button', { class: `btn small toggle edtabs-bars${ed.mode === 'bars' ? ' on' : ''}`, attrs: { 'data-test': 'bars-tab', 'aria-pressed': String(ed.mode === 'bars'), title: L('intro') },
      on: { click: () => { ed.mode = ed.mode === 'bars' ? 'page' : 'bars'; ed.sel = { type: ed.mode === 'bars' ? 'bars' : 'page' }; render(); } } }, L('tab'));
    const toolbar = h('div', { class: 'edtoolbar' }, tabs, barsTab,
      h('button', { class: 'btn small', attrs: { 'data-test': 'add-page' }, on: { click: addPage } }, icon('plus'), E('addPage')),
      h('div', { class: 'spacer' }),
      // keine Platzanzeige beim Ziehen und kein Hinweis „Texte in: …“ mehr – verwirrte und ließ die Leiste springen (Ralf 08.11.2026)
      h('span', { class: 'small muted', attrs: { 'data-test': 'save-state', 'aria-live': 'polite' }, text: ed.dirty ? E('saving') : E('saved') }),
      h('button', { class: 'btn small', attrs: { disabled: !ed.undo.length, 'data-test': 'undo', title: E('undoKey') }, on: { click: () => undo(true) } }, E('undo')),
      h('button', { class: 'btn small', attrs: { disabled: !ed.redo.length, 'data-test': 'redo', title: E('redoKey') }, on: { click: () => undo(false) } }, E('redo')),
      h('button', { class: `btn small toggle${showRaster ? ' on' : ''}`, attrs: { 'data-test': 'raster-toggle', 'aria-pressed': String(showRaster), title: E('rasterHint') },
        on: { click: toggleRaster } }, E('raster')),
      h('button', { class: 'btn small primary', attrs: { 'data-test': 'preview' }, on: { click: () => showPages(ed.pageId) } }, E('preview')));
    return h('div', { class: 'editor' }, libraryPanel(),
      h('div', { class: 'edcenter' }, toolbar, h('div', { class: 'edscroll', attrs: { id: 'edcanvas', 'data-keep-scroll': 'canvas' } }, canvasView())),
      propsPanel());
  }

  /** nur die Seite neu zeichnen (beim Tippen rechts) */
  function renderCanvas() {
    const box = document.getElementById('edcanvas');
    if (!box || state.view !== 'editor') return;
    state.shown = flatElements(ed.view);
    const top = box.scrollTop;
    box.replaceChildren(canvasView());
    // Bildlauf halten, auch wenn die Seite erst gleich eingepasst wird
    box.scrollTop = top;
    queueMicrotask(() => { box.scrollTop = top; });
    requestAnimationFrame(() => { if (Math.abs(box.scrollTop - top) > 1) box.scrollTop = top; });
    setTimeout(fitNewItems, 30);
    const u = document.querySelector('[data-test="undo"]');
    if (u) u.disabled = !ed.undo.length;
    const r = document.querySelector('[data-test="redo"]');
    if (r) r.disabled = !ed.redo.length;
  }

  function canvasView() {
    const page = ed.view;
    // Bildschirmrahmen: zeigt, was im Betrieb zu sehen ist; ohne Rollen ist alles darunter abgedunkelt.
    // Mit Leisten ist die Fläche für die Elemente kleiner (Bildschirm minus Leisten).
    const barsEdit = ed.mode === 'bars';
    const area = workArea(page, ed.bars);
    const H = area.h;
    const bottomH = area.bars.bottom ? BAR_PX.bottom : 0;
    const isOut = (e) => !page.scroll && e.y + e.h > H;
    const outside = page.items.filter(isOut).length;
    const frame = h('div', { class: 'screenframe', attrs: { 'aria-hidden': 'true', 'data-test': 'screenframe' } },
      h('span', { class: 'screenlabel', text: E('screenLabel', { w: page.width || 1920, h: pageH(page) }) }));
    frame.style.height = `${H}px`;
    const below = page.scroll ? null : h('div', { class: 'offscreen', attrs: { 'aria-hidden': 'true' } });
    if (below) below.style.top = `${H + bottomH}px`;
    const warn = outside ? h('div', { class: 'offscreenhint', attrs: { 'data-test': 'offscreen-hint', role: 'status' } }, icon('warn'), h('span', { text: E('offscreenCount', { n: outside }) })) : null;
    if (warn) warn.style.top = `${H + 16 + bottomH}px`;
    // Schrift von Hinweis und Beschriftung passend zur Seitenbreite: auf dem Schirm etwa gleich groß, egal wie stark gezoomt
    const fs = `${Math.max(11, Math.round((page.width || 1920) / 100))}px`;
    frame.firstChild.style.fontSize = fs;
    if (bottomH) frame.firstChild.style.top = `calc(100% + ${bottomH + 12}px)`;
    if (warn) warn.style.fontSize = fs;
    // leere Seite: großer Hinweis mitten auf dem Bildschirm
    const empty = page.items.length || barsEdit ? null : h('div', { class: 'dropnew big emptypage', attrs: { 'data-test': 'drop-new' } }, icon('plus'), h('span', { text: E('dropFirst') }));
    const grid = h('div', { class: `pagegrid freegrid freepage edit edgrid${showRaster && !barsEdit ? ' raster' : ''}${barsEdit ? ' barsedit' : ''}`, attrs: { 'data-w': area.w, 'data-h': H } },
      below, frame, ...ordered(page.items).map((e) => editItemNode(e, isOut(e), barsEdit)), empty, warn);
    grid.style.minHeight = `${Math.max(page.scroll ? H : H + 160 + bottomH, itemsBottom(page.items) + 40)}px`;
    if (!page.scroll) grid.style.setProperty('--raster-h', `${H}px`); // Rasterpunkte nur auf dem Bildschirm
    // Hintergrund genau auf der Bildschirmfläche (wie auf der Bedienseite), hinter den Elementen
    if (page.bg) { const bgl = pageBg(h('div', { class: 'screenbg', attrs: { 'aria-hidden': 'true', 'data-test': 'screenbg' } }), page); bgl.style.height = `${page.scroll ? Math.max(H, itemsBottom(page.items)) : H}px`; grid.prepend(bgl); }
    watchGrid(grid);
    // Leisten der Vorlage: auf Seiten nur zum Ansehen, im Reiter „Leisten“ zum Bearbeiten
    const screen = screenNode(grid, page, area, { preview: !barsEdit, edit: barsEdit, bottomInGrid: true, pageKeys: buildKeymap(page, area).pageKeys });
    if (barsEdit) {
      grid.addEventListener('click', () => select({ type: 'bars' }));
      return screen;
    }
    grid.addEventListener('click', (ev) => {
      if ((ev.target !== grid && ev.target !== empty) || suppressClick) return;
      // echte Mausklicks merken: ein danach angeklicktes Element bzw. Symbol kommt genau an diese Stelle
      ed.clickAt = ev.detail > 0 ? Object.assign({ pageId: ed.pageId }, pagePoint(grid, ev.clientX, ev.clientY)) : null;
      select({ type: 'page' });
    });
    grid.addEventListener('pointerdown', (ev) => { if (ev.target === grid) startRubberBand(ev, grid); });
    // auf eine freie Stelle ziehen = neues Element genau dort
    dropTarget(grid, (d) => d.type === 'new' || d.type === 'var', (d) => dropItem(d, { at: pagePoint(grid, lastDragPos.x, lastDragPos.y) }), () => 'drop-grid');
    return screen;
  }

  /** Element (oder Rahmen) im Editor: anklicken, ziehen, an der Ecke die Größe ändern; Variable darauf ziehen */
  function editItemNode(e, outside, barsEdit) {
    const sel = !barsEdit && selIds().includes(e.id);
    const node = itemNode(e, isFrame(e) ? null : renderElement(e));
    node.classList.add('edel');
    if (sel) node.classList.add('sel');
    if (e.vis && e.vis.name) { node.classList.add('hasvis'); node.append(h('span', { class: 'visbadge', text: '👁', attrs: { title: E('visBadge'), 'aria-hidden': 'true' } })); }
    if (outside) { node.classList.add('outside'); node.title = E('offscreen'); }
    node.dataset.editEl = e.id;
    if (barsEdit) return node;
    const rz = h('div', { class: 'rz', attrs: { title: E('resizeWH'), 'data-resize-of': e.id } });
    rz.addEventListener('pointerdown', (ev) => { ev.stopPropagation(); ev.preventDefault(); startItemDrag(ev, e.id, 'size'); });
    node.append(rz);
    node.addEventListener('pointerdown', (ev) => { if (ev.target !== rz) startItemDrag(ev, e.id, 'move'); });
    node.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (suppressClick) return;
      if (ev.ctrlKey || ev.metaKey || ev.shiftKey) toggleSel(e.id);
      else select({ type: 'el', id: e.id });
    });
    // Variable auf ein Element ziehen = Variable tauschen (Trend: weitere Kurve); sonst an diese Stelle legen
    const bind = (d) => d.type === 'var' && !['text', 'image', 'fkey', 'frame', 'alarms', 'lang'].includes(e.kind);
    dropTarget(node, (d) => d.type === 'new' || d.type === 'var',
      (d) => (bind(d) ? dropItem(d, { bindElId: e.id }) : dropItem(d, { at: pagePoint(node.closest('.freegrid'), lastDragPos.x, lastDragPos.y) })),
      (d) => (bind(d) ? 'drop-on' : 'drop-in'));
    return node;
  }

  /** Hinweis im Editor: „Verlassen“/„Beenden“ vorhanden, aber nirgends „Anmelden“ – ohne Tastatur käme ein Techniker nicht heraus */
  function exitWithoutLogin() {
    const barItems = BAR_POS.flatMap((pos) => (ed.bars && ed.bars[pos] && ed.bars[pos].on !== false ? ed.bars[pos].items : []));
    const pageFkeys = ed.pages.flatMap((p) => (p.items || []).filter((e) => e.kind === 'fkey'));
    const all = barItems.filter((x) => x.type === 'fkey').concat(pageFkeys);
    const hasExit = all.some((x) => TECH_ONLY.includes(x.action));
    const hasLogin = barItems.some((x) => x.type === 'login') || all.some((x) => x.action === 'login');
    return hasExit && !hasLogin ? h('div', { class: 'result warn small', attrs: { 'data-test': 'exit-no-login' } }, icon('warn'), h('div', { text: L('exitNoLogin') })) : null;
  }

  function libraryPanel() {
    if (ed.mode === 'bars') {
      // Reiter „Leisten“: Bausteine statt Elemente
      return h('aside', { class: 'edpanel edlib', attrs: { 'aria-label': L('library') } }, h('h2', { text: L('library') }), exitWithoutLogin(),
        h('div', { class: 'liblist' }, BAR_TYPES.map((k) => h('button', { class: 'libitem', attrs: { 'data-bar-lib': k, title: L(`typeHint.${k}`) },
          on: { click: () => addBarItem(k) } }, h('span', { class: 'kglyph', text: BAR_GLYPHS[k], attrs: { 'aria-hidden': 'true' } }), h('span', { text: L(`type.${k}`) })))),
        hintText(L('libHelp')));
    }
    const tabs = h('div', { class: 'seg edtabs' }, ...['elements', 'variables', 'symbols'].map((k) => h('button', { class: ed.panel === k ? 'on' : '', text: k === 'symbols' ? MS('tab') : E(k),
      attrs: { 'aria-pressed': String(ed.panel === k), 'data-test': `panel-${k}` }, on: { click: () => { ed.panel = k; render(); } } })));
    let body;
    if (ed.panel === 'elements') {
      const libItem = (k) => {
        const n = h('button', { class: 'libitem', attrs: { 'data-lib': k, title: E('libHint') } }, glyph(k), h('span', { text: T(`ui.kinds.${k}`) }));
        dragSource(n, { type: 'new', kind: k });
        n.addEventListener('click', () => addBySelection({ type: 'new', kind: k }));
        return n;
      };
      body = h('div', {}, h('div', { class: 'liblist' }, LIB_TOP.map(libItem)),
        foldBox('libMore', E('libMore', { n: LIB_MORE.length }), h('div', { class: 'liblist' }, LIB_MORE.map(libItem)), 'lib-more'),
        hintText(E('libHelp')));
    } else if (ed.panel === 'symbols') {
      body = symbolsPanel();
    } else {
      body = varPanel();
    }
    return h('aside', { class: 'edpanel edlib', attrs: { 'aria-label': E('library'), 'data-keep-scroll': 'lib' } }, tabs, exitWithoutLogin(), body);
  }

  // ---- „Meine Symbole“: eigene Bildersammlung (Gruppen = Unterordner beim Einlesen)
  const MS = (k, a) => T(`ui.mySymbols.${k}`, a);
  const symGroups = (list) => {
    const m = new Map();
    for (const s of list) { if (!m.has(s.group)) m.set(s.group, []); m.get(s.group).push(s); }
    return [...m.entries()].sort((a, b) => (a[0] === '' ? -1 : b[0] === '' ? 1 : a[0].localeCompare(b[0], 'de', { numeric: true })));
  };
  async function addSymbols(how) {
    try {
      const r = await (how === 'folder' ? window.e4.symbolsAddFolder() : window.e4.symbolsAddFiles());
      if (!r) return;
      ed.symbols = r.symbols;
      toast(r.text);
      render();
    } catch (err) { toast(err.message); }
  }
  /** Name und Gruppe ändern oder aus der Sammlung nehmen (Rechtsklick) */
  function editSymbol(sym) {
    const v = { name: sym.name, group: sym.group };
    const groups = [...new Set(ed.symbols.map((x) => x.group).filter(Boolean))];
    const done = (list) => { ed.symbols = list; closeModal(); render(); };
    const groupIn = h('input', { class: 'input', value: v.group, attrs: { list: 'sym-groups', 'data-field': 'sym-group', autocomplete: 'off' }, on: { input: (e) => { v.group = e.target.value; } } });
    const panel = h('div', { class: 'panel narrow', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': MS('editTitle'), 'data-test': 'sym-edit' } },
      h('div', { class: 'head' }, h('h2', { text: MS('editTitle') }),
        h('button', { class: 'iconbtn', attrs: { 'aria-label': T('ui.common.close') }, on: { click: closeModal } }, icon('close'))),
      h('div', { class: 'symedit' }, h('img', { attrs: { src: imgUrl(sym.img), alt: '' } }),
        h('div', { class: 'form grow' }, textField(MS('name'), () => v.name, (x) => { v.name = x; }, { key: 'sym-name' }),
          h('div', { class: 'field' }, h('label', { text: MS('group') }), groupIn, h('datalist', { attrs: { id: 'sym-groups' } }, ...groups.map((g) => h('option', { value: g }))),
            h('div', { class: 'hint', text: MS('groupHint') })))),
      h('div', { class: 'foot' },
        h('button', { class: 'btn danger', attrs: { 'data-test': 'sym-remove' }, on: { click: async () => {
          if (!window.confirm(MS('removeConfirm', { name: sym.name }))) return;
          try { done(await window.e4.symbolRemove(sym.img)); } catch (err) { toast(err.message); }
        } } }, MS('remove')),
        h('div', { class: 'spacer' }),
        h('button', { class: 'btn', on: { click: closeModal } }, T('ui.common.cancel')),
        h('button', { class: 'btn primary', attrs: { 'data-test': 'sym-save' }, on: { click: async () => {
          try { done(await window.e4.symbolUpdate(sym.img, v)); } catch (err) { toast(err.message); }
        } } }, T('ui.common.save'))));
    const overlay = h('div', { class: 'overlay center', on: { mousedown: (e) => { if (e.target === overlay) closeModal(); } } }, panel);
    setModal(overlay);
  }
  /** Raster mit Vorschaubildern, nach Gruppen; onPick(sym) beim Anklicken, drag: auf die Seite ziehbar */
  function symbolGrid(list, onPick, drag, current) {
    return h('div', { class: 'symgroups' }, ...symGroups(list).map(([g, items]) => h('div', { class: 'symgroup', attrs: { 'data-sym-group': g } },
      h('div', { class: 'symgroupname', text: g || MS('general') }),
      h('div', { class: 'symgrid' }, ...items.map((sym) => {
        const n = h('button', { class: `symitem${sym.img === current ? ' on' : ''}`, attrs: { 'data-sym': sym.img, 'data-sym-name': sym.name.toLowerCase(), title: sym.name } },
          h('img', { attrs: { src: imgUrl(sym.img), alt: '', draggable: 'false' } }), h('span', { class: 'symname', text: sym.name }));
        if (drag) dragSource(n, { type: 'new', kind: 'image', img: sym.img });
        n.addEventListener('click', () => onPick(sym));
        n.addEventListener('contextmenu', (ev) => { ev.preventDefault(); editSymbol(sym); });
        return n;
      })))));
  }
  function symbolsPanel() {
    const list = ed.symbols || [];
    const add = h('div', { class: 'inline symadd' },
      h('button', { class: 'btn small', attrs: { 'data-test': 'sym-add-files', title: MS('addFilesHint') }, on: { click: () => addSymbols('files') } }, MS('addFiles')),
      h('button', { class: 'btn small', attrs: { 'data-test': 'sym-add-folder', title: MS('addFolderHint') }, on: { click: () => addSymbols('folder') } }, MS('addFolder')));
    if (!list.length) return h('div', { class: 'sympanel' }, add, h('div', { class: 'muted small', attrs: { 'data-test': 'sym-empty' }, text: MS('empty') }));
    const grid = symbolGrid(list, (sym) => addBySelection({ type: 'new', kind: 'image', img: sym.img }), true);
    const nohit = h('div', { class: 'muted small', text: MS('nohit'), attrs: { hidden: true } });
    // Suche ohne Neuzeichnen (Fokus bleibt im Feld)
    const filter = (q) => {
      const k = q.trim().toLowerCase();
      let any = false;
      for (const g of grid.querySelectorAll('.symgroup')) {
        let n = 0;
        for (const it of g.querySelectorAll('.symitem')) { const show = !k || it.dataset.symName.includes(k) || (g.dataset.symGroup || '').toLowerCase().includes(k); it.hidden = !show; if (show) n++; }
        g.hidden = !n;
        any = any || n > 0;
      }
      nohit.hidden = any;
    };
    const search = h('input', { class: 'input', value: ed.symSearch || '', attrs: { type: 'search', placeholder: MS('search'), 'aria-label': MS('search'), 'data-test': 'sym-search' },
      on: { input: (ev) => { ed.symSearch = ev.target.value; filter(ed.symSearch); } } });
    if (ed.symSearch) filter(ed.symSearch);
    return h('div', { class: 'sympanel' }, search, add, grid, nohit, hintText(MS('help')));
  }

  function varPanel() {
    if (!state.devices.length) return h('div', { class: 'muted small', text: E('noDevices') });
    const devSel = state.devices.length > 1 ? h('select', { class: 'input', attrs: { 'aria-label': T('ui.nav.devices'), 'data-test': 'var-device' },
      on: { change: (ev) => { ed.dev = ev.target.value; ed.search = ''; render(); } } },
      state.devices.map((d) => h('option', { value: d.id, text: d.name, attrs: { selected: d.id === ed.dev } }))) : null;
    const list = h('div', { class: 'varlist', attrs: { 'data-keep-scroll': 'vars' } });
    const search = h('input', { class: 'input', value: ed.search, attrs: { type: 'search', placeholder: E('search'), 'aria-label': E('search'), 'data-test': 'var-search' },
      on: { input: (ev) => { ed.search = ev.target.value; fillVars(list); } } });
    fillVars(list);
    return h('div', { class: 'varpanel' }, devSel, search, list, hintText(E('varHelp')));
  }

  function fillVars(list) {
    const q = ed.search.trim().toLowerCase();
    const used = new Set(flatElements(ed.view).filter((e) => e.dev === ed.dev).map((e) => e.name));
    const vars = (ed.vars[ed.dev] || []).filter((v) => !q || `${v.userLabel || v.label} ${v.name} ${opText(v)}`.toLowerCase().includes(q));
    const items = vars.map((v) => {
      const key = keyOfVar(v);
      const d = { type: 'var', dev: ed.dev, name: key };
      const n = h('div', { class: `varitem${used.has(key) ? ' used' : ''}`, attrs: { 'data-var': key, tabindex: '0', title: E('varHint') } },
        h('div', { class: 'vlabel', text: v.userLabel || v.label }),
        h('div', { class: 'small muted' }, h('span', { class: 'mono', text: opText(v) }), canWriteVar(v) ? null : ` · ${E('readOnly')}`));
      dragSource(n, d);
      n.addEventListener('dblclick', () => addBySelection(d));
      n.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') addBySelection(d); });
      return n;
    });
    list.replaceChildren(...(items.length ? items : [h('div', { class: 'muted small', text: E('noVars') })]));
  }

  // ---------------------------------------------------------------- Eigenschaften (rechts)
  /**
   * Hinweis kurz halten: der erste Satz steht da, der Rest kommt über ⓘ zum Aufklappen.
   * „z. B.“, „d. h.“ usw. beenden keinen Satz.
   */
  function hintText(text, tag) {
    const str = String(text || '');
    const re = /[.!?]\s+(?=[A-ZÄÖÜ„"(])/g;
    let m;
    let cut = -1;
    while ((m = re.exec(str))) {
      const before = str.slice(Math.max(0, m.index - 5), m.index + 1);
      if (!/(\bz\. ?B|\bd\. ?h|\bu\. ?a|\bbzw|\bca|\bggf|\bz|\bd|\bu|\bNr|\bvgl)\.$/.test(before)) { cut = m.index + 1; break; }
    }
    if (cut < 0) return h(tag || 'div', { class: 'hint', text: str });
    const rest = h('span', { class: 'hintmore', text: ` ${str.slice(cut).trim()}`, attrs: { hidden: true } });
    const btn = h('button', { class: 'infobtn', text: 'ⓘ', attrs: { type: 'button', title: E('moreInfo'), 'aria-label': E('moreInfo'), 'aria-expanded': 'false' },
      on: { click: (ev) => { ev.preventDefault(); ev.stopPropagation(); const open = rest.hidden; rest.hidden = !open; btn.setAttribute('aria-expanded', String(open)); } } });
    return h(tag || 'div', { class: 'hint' }, h('span', { text: str.slice(0, cut) }), ' ', btn, rest);
  }
  const prop = (label, control, hint) => h('label', { class: 'field' }, h('span', { class: 'label', text: label }), control, hint ? hintText(hint, 'span') : null);
  const propBox = (label, control, hint) => h('div', { class: 'field' }, h('span', { class: 'label', text: label }), control, hint ? hintText(hint, 'span') : null);
  function textInput(value, placeholder, onInput, key, multiline) {
    return h(multiline ? 'textarea' : 'input', { class: 'input', value: value === undefined || value === null ? '' : String(value),
      attrs: { placeholder: placeholder === undefined || placeholder === null ? '' : String(placeholder), 'data-prop': key, rows: multiline ? 3 : null },
      on: { input: (ev) => onInput(ev.target.value) } });
  }
  function segPick(choices, current, onPick, key) {
    // mehr als 5 Möglichkeiten (z. B. Darstellung einer Zahl): in Zeilen zu je 3 umbrechen; 4–5 mit langen Texten: je 2
    const long = choices.length >= 4 && choices.reduce((n, [, label]) => n + String(label).length, 0) > 32;
    return h('div', { class: `seg tight${choices.length > 5 ? ' wrap3' : long ? ' wrap2' : ''}`, attrs: { role: 'group' } }, ...choices.map(([v, label]) => h('button', { class: v === current ? 'on' : '', text: label,
      attrs: { 'aria-pressed': String(v === current), 'data-test': `${key}-${v}` }, on: { click: () => onPick(v) } })));
  }
  const actions = (around) => h('div', { class: 'inline edactions' },
    around ? h('button', { class: 'btn small', attrs: { 'data-test': 'frame-around', title: E('frameAroundHint') }, on: { click: frameAroundSelected } }, E('frameAround')) : null,
    h('button', { class: 'btn small', attrs: { 'data-test': 'duplicate', title: E('duplicateKey') }, on: { click: duplicateSelected } }, E('duplicate')),
    h('button', { class: 'btn small danger', attrs: { 'data-test': 'delete-sel', title: E('deleteKey') }, on: { click: removeSelected } }, T('ui.common.delete')));

  function propsPanel() {
    const s = ed.sel;
    const f = s.type === 'el' ? findEl(s.id) : null;
    if (ed.mode === 'bars') {
      const it = s.type === 'baritem' && ed.bars[s.pos] ? ed.bars[s.pos].items.find((x) => x.id === s.id) : null;
      return h('aside', { class: 'edpanel edprops', attrs: { 'aria-label': E('props'), 'data-keep-scroll': `props-bars-${s.pos || ''}-${s.id || ''}` } }, it ? barItemProps(s.pos, it) : barsProps());
    }
    const body = f ? (isFrame(f.el) ? frameProps(f.el) : elementProps(f.el, resolvedEl(s.id))) : selIds().length > 1 ? itemsProps(selIds()) : pageProps(curPage());
    // Bildlauf bleibt, solange dasselbe ausgewählt ist (Ralf 08.11.2026: sprang nach jeder Änderung nach oben)
    return h('aside', { class: 'edpanel edprops', attrs: { 'aria-label': E('props'), 'data-keep-scroll': `props-${ed.pageId}-${s.type}-${s.id || (s.ids || []).join(',')}` } }, body);
  }

  function itemsProps(ids) {
    const btn = (how, label) => h('button', { class: 'btn small', attrs: { 'data-test': `align-${how}` }, on: { click: () => alignItems(how) } }, label);
    return h('div', { class: 'form' }, h('h2', { text: E('elsProps', { n: ids.length }) }),
      propBox(E('align'), h('div', { class: 'alignbtns' }, btn('left', E('alignL')), btn('top', E('alignT')), btn('right', E('alignR')), btn('bottom', E('alignB')))),
      propBox(E('sameSize'), h('div', { class: 'alignbtns' }, btn('width', E('sameW')), btn('height', E('sameH'))), E('sameSizeHint')),
      actions(true),
      hintText(E('elsHelp')));
  }

  function pageProps(p) {
    const i = ed.pages.indexOf(p);
    return h('div', { class: 'form' }, h('h2', { text: E('pageProps') }),
      prop(E('pageName'), textInput(p.name, '', (v) => {
        const tab = document.querySelector(`[data-edit-tab="${CSS.escape(p.id)}"]`);
        if (tab) tab.textContent = v;
        change(() => { curPage().name = v; }, { merge: `name-${p.id}`, canvasOnly: true });
      }, 'page-name')),
      screenProps(p),
      bgProps(p),
      h('label', { class: 'check' }, h('input', { attrs: { type: 'checkbox', 'data-test': 'page-scroll' }, checked: !!p.scroll,
        on: { change: (ev) => change(() => { const pg = curPage(); if (ev.target.checked) pg.scroll = true; else delete pg.scroll; }) } }),
      h('span', {}, E('pageScroll'), h('span', { class: 'hint block', text: E('pageScrollHint') }))),
      h('label', { class: 'check' }, h('input', { attrs: { type: 'checkbox', 'data-test': 'page-bars' }, checked: !p.noBars,
        on: { change: (ev) => change(() => { const pg = curPage(); if (ev.target.checked) delete pg.noBars; else pg.noBars = true; }) } }),
      h('span', {}, L('showOnPage'), h('span', { class: 'hint block', text: L('showOnPageHint') }))),
      h('label', { class: 'check' }, h('input', { attrs: { type: 'checkbox', 'data-test': 'page-start' }, checked: !!p.start,
        on: { change: (ev) => change(() => { for (const x of ed.pages) delete x.start; if (ev.target.checked) curPage().start = true; }) } }),
      h('span', {}, E('pageStart'), h('span', { class: 'hint block', text: E('pageStartHint') }))),
      h('label', { class: 'check' }, h('input', { attrs: { type: 'checkbox', 'data-test': 'page-web' }, checked: !p.noWeb,
        on: { change: (ev) => change(() => { const pg = curPage(); if (ev.target.checked) delete pg.noWeb; else pg.noWeb = true; }) } }),
      h('span', {}, E('pageWeb'), h('span', { class: 'hint block', text: E('pageWebHint') }))),
      h('div', { class: 'inline' },
        h('button', { class: 'btn small', attrs: { disabled: i === 0 }, on: { click: () => movePage(-1) } }, E('pageLeft')),
        h('button', { class: 'btn small', attrs: { disabled: i === ed.pages.length - 1 }, on: { click: () => movePage(1) } }, E('pageRight')),
        h('button', { class: 'btn small danger', attrs: { 'data-test': 'delete-page' }, on: { click: deletePage } }, E('deletePage'))),
      hintText(E('pageHelp')));
  }

  // ---------------------------------------------------------------- Leisten bearbeiten (Reiter „Leisten (Vorlage)“)
  const barItemRef = (pos, id) => (ed.bars[pos] ? ed.bars[pos].items.find((x) => x.id === id) : null);
  /** Baustein in die gewählte Leiste (sonst oben) einfügen; die Leiste wird dabei eingeschaltet */
  function addBarItem(type) {
    const pos = (ed.sel.type === 'baritem' || ed.sel.type === 'bars') && ed.sel.pos ? ed.sel.pos : 'top';
    change(() => {
      const it = { id: uid(), type };
      if (type === 'fkey') it.action = 'page';
      const items = ed.bars[pos].items;
      const at = ed.sel.type === 'baritem' ? items.findIndex((x) => x.id === ed.sel.id) + 1 : items.length;
      items.splice(at > 0 ? at : items.length, 0, it);
      ed.bars[pos].on = true;
      ed.sel = { type: 'baritem', pos, id: it.id };
    });
  }
  function removeBarItem(pos, id) {
    change(() => { ed.bars[pos].items = ed.bars[pos].items.filter((x) => x.id !== id); ed.sel = { type: 'bars', pos }; });
  }

  function barsProps() {
    return h('div', { class: 'form' }, h('h2', { text: L('title') }), h('div', { class: 'hint', text: L('intro') }),
      ...BAR_POS.map((pos) => h('label', { class: 'check' }, h('input', { attrs: { type: 'checkbox', 'data-test': `bar-on-${pos}` }, checked: !!ed.bars[pos].on,
        on: { change: (ev) => change(() => { ed.bars[pos].on = ev.target.checked; ed.sel = { type: 'bars', pos }; }) } }), h('span', { text: L(`pos.${pos}`) }))),
      hintText(L('help')));
  }

  function barItemProps(pos, it) {
    const upd = (fn, opts) => change(() => { const x = barItemRef(pos, it.id); if (x) fn(x); }, opts);
    const items = ed.bars[pos].items;
    const i = items.indexOf(it);
    const move = (d) => change(() => { const list = ed.bars[pos].items; const [x] = list.splice(i, 1); list.splice(i + d, 0, x); });
    const parts = [h('h2', { text: L(`type.${it.type}`) }), h('div', { class: 'hint', text: L(`typeHint.${it.type}`) })];
    if (it.type === 'logo') {
      parts.push(h('div', { class: 'inline' }, h('button', { class: 'btn small primary', attrs: { 'data-test': 'bar-logo-pick' },
        on: { click: () => pickImage((pg, name) => { const x = barItemRef(pos, it.id); if (x) x.img = name; }, it.img) } }, it.img ? E('image.change') : L('logoPick'))));
      // zweites Logo fürs dunkle Design (z. B. mit heller Schrift)
      parts.push(propBox(L('logoDark'), h('div', { class: 'inline' },
        h('button', { class: 'btn small', attrs: { 'data-test': 'bar-logo-dark-pick' },
          on: { click: () => pickImage((pg, name) => { const x = barItemRef(pos, it.id); if (x) x.imgDark = name; }, it.imgDark) } }, it.imgDark ? E('image.change') : L('logoPick')),
        it.imgDark ? h('button', { class: 'btn small', attrs: { 'data-test': 'bar-logo-dark-remove' },
          on: { click: () => change(() => { const x = barItemRef(pos, it.id); if (x) delete x.imgDark; }) } }, L('logoDarkRemove')) : null), L('logoDarkHint')));
    }
    if (it.type === 'text') parts.push(prop(L('type.text'), textInput(it.text, '', (v) => upd((x) => { x.text = v; }, { merge: `bartext-${it.id}`, canvasOnly: true }), 'bar-text')));
    if (it.type === 'fkey') parts.push(...fkeyProps(it, upd));
    // in eine andere Leiste verschieben
    parts.push(propBox(L('inBar'), segPick(BAR_POS.map((p) => [p, L(`posShort.${p}`)]), pos, (np) => {
      if (np === pos) return;
      change(() => { ed.bars[pos].items = ed.bars[pos].items.filter((x) => x.id !== it.id); ed.bars[np].items.push(it); ed.bars[np].on = true; ed.sel = { type: 'baritem', pos: np, id: it.id }; });
    }, 'bar-pos')));
    parts.push(h('div', { class: 'inline edactions' },
      h('button', { class: 'btn small', attrs: { disabled: i <= 0, 'data-test': 'bar-item-back' }, on: { click: () => move(-1) } }, L('moveBack')),
      h('button', { class: 'btn small', attrs: { disabled: i >= items.length - 1, 'data-test': 'bar-item-fwd' }, on: { click: () => move(1) } }, L('moveFwd')),
      h('button', { class: 'btn small danger', attrs: { 'data-test': 'delete-sel' }, on: { click: () => removeBarItem(pos, it.id) } }, T('ui.common.delete'))));
    return h('div', { class: 'form' }, ...parts);
  }

  /** Einstellungen einer Funktionstaste (Baustein in einer Leiste oder Element auf der Seite); upd(fn, opts) ändert sie */
  function fkeyProps(f, upd) {
    const sel = (key, value, choices, onPick) => h('select', { class: 'input', attrs: { 'data-test': key },
      on: { change: (ev) => onPick(ev.target.value) } }, choices.map(([v, label]) => h('option', { value: v, text: label, attrs: { selected: String(v) === String(value) } })));
    const parts = [
      prop(L('label'), textInput(f.label, fkeyLabel(Object.assign({}, f, { label: '' })), (v) => upd((x) => { x.label = v; }, { merge: `fklabel-${f.id}`, canvasOnly: true }), 'fkey-label'), L('labelHint')),
      propBox(L('actionLabel'), sel('fkey-action', f.action, ['page', 'back', 'connect', 'fullscreen', 'theme', 'exit', 'write', 'login', 'quit', 'lang'].map((a) => [a, L(`action.${a}`)]),
        (v) => upd((x) => { x.action = v; if (v === 'page' && !x.page && ed.pages[0]) x.page = ed.pages[0].id; }))),
    ];
    if (f.action === 'page') {
      parts.push(propBox(L('targetPage'), sel('fkey-page', f.page || '', [['', '–']].concat(ed.pages.map((p) => [p.id, p.name])), (v) => upd((x) => { x.page = v; }))));
    }
    if (f.action === 'write') {
      const devId = f.dev || ed.dev || (state.devices[0] && state.devices[0].id) || '';
      const vars = (ed.vars[devId] || []).filter((v) => canWriteVar(v));
      parts.push(state.devices.length > 1 ? propBox(T('ui.nav.devices'), sel('fkey-dev', devId, state.devices.map((d) => [d.id, d.name]), (v) => upd((x) => { x.dev = v; x.name = ''; }))) : null,
        propBox(L('writeVar'), sel('fkey-var', f.name || '', [['', L('chooseVar')]].concat(vars.map((v) => [keyOfVar(v), (v.userLabel || v.label) + ' (' + opText(v) + ')'])),
          (v) => upd((x) => { x.dev = devId; x.name = v; }))),
        prop(L('writeValue'), h('input', { class: 'input narrow', value: String(f.value === undefined ? 1 : f.value), attrs: { type: 'number', 'data-test': 'fkey-value' },
          on: { change: (ev) => upd((x) => { x.value = Number(ev.target.value) || 0; }) } }), L('writeHint')));
    }
    parts.push(propBox(L('key'), sel('fkey-key', f.key || '', [['', L('noKey')]].concat(Array.from({ length: 12 }, (x, i) => ['F' + (i + 1), 'F' + (i + 1)])),
      (v) => upd((x) => { if (v) x.key = v; else delete x.key; }))));
    parts.push(h('label', { class: 'check' }, h('input', { attrs: { type: 'checkbox', 'data-test': 'fkey-confirm' }, checked: !!f.confirm,
      on: { change: (ev) => upd((x) => { if (ev.target.checked) x.confirm = true; else delete x.confirm; }) } }), h('span', { text: L('confirmLabel') })));
    return parts;
  }

  /** Hintergrund der Seite: Thema (Standard), eigene Farbe oder Bild (füllen, einpassen, kacheln) */
  function bgProps(p) {
    const B = (k) => E(`bg.${k}`);
    const bg = p.bg || {};
    const mode = bg.img ? 'image' : bg.color ? 'color' : 'theme';
    const lastColor = bg.color || '#dfe5ea';
    const pick = segPick([['theme', B('theme')], ['color', B('color')], ['image', B('image')]], mode, (v) => {
      if (v === 'theme') change((pg) => { delete pg.bg; });
      else if (v === 'color') change((pg) => { pg.bg = { color: lastColor }; });
      else if (bg.img) return;
      else pickImage((pg, name) => { pg.bg = { img: name, fit: 'cover' }; });
    }, 'bg');
    let extra = null;
    if (mode === 'color') {
      extra = h('div', { class: 'bgpick' }, h('input', { value: bg.color, attrs: { type: 'color', 'data-test': 'bg-color', 'aria-label': B('color') },
        on: { change: (ev) => change((pg) => { pg.bg = { color: ev.target.value }; }) } }), h('span', { class: 'small mono', text: bg.color }));
    } else if (mode === 'image') {
      extra = h('div', { class: 'form tight' },
        segPick([['cover', B('cover')], ['contain', B('contain')], ['tile', B('tile')]], bg.fit || 'cover', (v) => change((pg) => { pg.bg.fit = v; }), 'bgfit'),
        h('div', { class: 'inline' }, h('button', { class: 'btn small', attrs: { 'data-test': 'bg-image-change' },
          on: { click: () => pickImage((pg, name) => { pg.bg = { img: name, fit: (pg.bg && pg.bg.fit) || 'cover' }; }, bg.img) } }, E('image.change'))));
    }
    return propBox(B('title'), h('div', { class: 'form tight' }, pick, extra), B('hint'));
  }

  /** Bildschirmgröße: Auswahlliste nach Gruppen (PC, Industriepanel, Tablet) oder eigene Größe, dazu quer/hoch */
  function screenProps(p) {
    const w = p.width || 1920;
    const hgt = pageH(p);
    const portrait = hgt > w;
    const land = portrait ? [hgt, w] : [w, hgt]; // Liste steht quer
    const match = (g) => SCREENS.find(([k]) => k === g)[1].some(([a, b]) => a === land[0] && b === land[1]);
    const group = p.screen === 'custom' ? 'custom' : p.screen && p.screen !== 'custom' && match(p.screen) ? p.screen
      : (SCREENS.find(([k]) => match(k)) || ['custom'])[0];
    const cur = group === 'custom' ? 'custom' : `${group}:${land[0]}x${land[1]}`;
    // neue Breite: Elemente behalten Platz und Größe in Bildpunkten (größerer Bildschirm = mehr freie Fläche)
    const set = (fn) => change((pg) => fn(pg));
    const select = h('select', { class: 'input', attrs: { 'data-test': 'screen-size', 'aria-label': E('pageWidth') },
      on: { change: (ev) => {
        const v = ev.target.value;
        if (v === 'custom') { set((pg) => { pg.screen = 'custom'; pg.width = w; pg.height = hgt; }); return; }
        const [g, size] = v.split(':');
        const [a, b] = size.split('x').map(Number);
        // Handy: zuerst hochkant und rollend – die Seite füllt dann die Breite, nach unten wird gerollt
        const toPhone = g === 'phone' && group !== 'phone';
        const port = toPhone || portrait;
        set((pg) => { pg.screen = g; pg.width = port ? b : a; pg.height = port ? a : b; if (toPhone) pg.scroll = true; });
      } } },
      ...SCREENS.map(([g, list]) => h('optgroup', { attrs: { label: E(`screenGroup.${g}`) } },
        list.map(([a, b, note]) => h('option', { value: `${g}:${a}x${b}`, text: `${a} × ${b}${note ? `  ·  ${note}` : ''}`, attrs: { selected: cur === `${g}:${a}x${b}` } })))),
      h('option', { value: 'custom', text: E('screenCustom'), attrs: { selected: cur === 'custom' } }));
    const num = (val, key, label) => h('label', { class: 'field' }, h('span', { class: 'label', text: label }),
      h('input', { class: 'input', value: String(val), attrs: { type: 'number', min: 320, max: 3840, step: 1, 'data-test': `screen-${key}` },
        on: { change: (ev) => { const n = Math.max(320, Math.min(3840, Math.round(Number(ev.target.value) || 0))); set((pg) => { pg.screen = 'custom'; pg[key] = n; }); } } }));
    return propBox(E('pageWidth'), h('div', { class: 'form tight' }, select,
      group === 'custom' ? h('div', { class: 'inline' }, num(w, 'width', E('screenW')), num(hgt, 'height', E('screenH'))) : null,
      segPick([['land', E('landscape')], ['port', E('portrait')]], portrait ? 'port' : 'land', (v) => {
        if ((v === 'port') !== portrait) set((pg) => { pg.width = hgt; pg.height = w; });
      }, 'orient')), group === 'tablet' ? E('tabletHint') : group === 'phone' ? E('phoneHint') : E('pageWidthHint'));
  }

  /** Schriftgröße eines Elements (oder Rahmens) in % */
  function setFont(id, n) {
    const v = Math.max(60, Math.min(250, Math.round(Number(n) || 100)));
    change(() => { const k = findEl(id).el; if (v === 100) delete k.font; else k.font = v; });
  }
  function fontProp(e) {
    return propBox(E('fontEl'), h('div', { class: 'form tight' },
      segPick([[85, E('font.s')], [100, E('font.m')], [130, E('font.l')], [170, E('font.xl')]], e.font || 100, (n) => setFont(e.id, n), 'font'),
      h('label', { class: 'inline' }, h('span', { class: 'small', text: E('fontExact') }),
        h('input', { class: 'input narrow', value: String(e.font || 100), attrs: { type: 'number', min: 60, max: 250, step: 5, 'data-test': 'font-exact', 'aria-label': E('fontEl') },
          on: { change: (ev) => setFont(e.id, Number(ev.target.value)) } }), h('span', { class: 'small', text: '%' }))));
  }
  /** Platz und Größe in Bildpunkten (zum genauen Eintippen; ziehen geht auch) */
  function geomProps(e) {
    const num = (key, label, min) => h('label', { class: 'field' }, h('span', { class: 'label', text: label }),
      h('input', { class: 'input', value: String(e[key]), attrs: { type: 'number', min, step: GRIDPX, 'data-test': `geom-${key}` },
        on: { change: (ev) => change((page) => {
          const el = findEl(e.id).el;
          const n = Math.max(min, Math.round(Number(ev.target.value) || 0));
          if (key === 'x' || key === 'y') shiftItem(page, el, key === 'x' ? n - el.x : 0, key === 'y' ? n - el.y : 0); else el[key] = n;
        }) } }));
    return propBox(E('geometry'), h('div', { class: 'row4' }, num('x', 'X', 0), num('y', 'Y', 0), num('w', E('sizeW'), 2 * GRIDPX), num('h', E('sizeH'), 2 * GRIDPX)), E('geometryHint'));
  }

  /** Rahmen: Überschrift, Aussehen, Schrift; was darin liegt, gehört dazu */
  /** Einstellung „Sichtbar“: immer | nur wenn Variable 1 / 0 / von … bis */
  function visProps(e) {
    const vis = e.vis && e.vis.name ? e.vis : null;
    const upd = (fn) => change(() => { const el = findEl(e.id).el; fn(el); });
    const body = [segPick([['always', E('visAlways')], ['if', E('visIf')]], vis ? 'if' : 'always', (v) => upd((el) => {
      if (v === 'always') delete el.vis;
      else if (!el.vis) el.vis = { dev: '', name: '', op: 'on' };
    }), 'vis')];
    if (e.vis) {
      body.push(optVarSelect(e.vis.dev, e.vis.name, 'vis-var', (dev, name) => upd((el) => { el.vis = Object.assign({}, el.vis, { dev, name }); }), false, false));
      body.push(segPick([['on', '= 1'], ['off', '= 0'], ['range', E('visRange')]], e.vis.op || 'on', (v) => upd((el) => { el.vis.op = v; if (v === 'range' && el.vis.from === undefined) el.vis.from = 0; }), 'vis-op'));
      if (e.vis.op === 'range') {
        const n = (key) => textInput(e.vis[key] === undefined ? '' : String(e.vis[key]), '', (v) => change(() => {
          const el = findEl(e.id).el; const x = Number(String(v).replace(',', '.'));
          if (String(v).trim() === '' && key === 'to') delete el.vis.to; else if (Number.isFinite(x)) el.vis[key] = x;
        }, { merge: `vis-${key}-${e.id}`, canvasOnly: true }), `vis-${key}`);
        body.push(h('div', { class: 'row2' }, prop(E('visFrom'), n('from')), prop(E('visTo'), n('to'))));
      }
    }
    return propBox(E('vis'), h('div', { class: 'form tight' }, ...body), E('visHint'));
  }

  function frameProps(c) {
    const upd = (fn, opts) => change(() => fn(findEl(c.id).el), opts);
    return h('div', { class: 'form' }, h('h2', { text: T('ui.kinds.frame') }),
      prop(E('frameTitle'), textInput(c.title, '', (v) => upd((x) => { const was = !x.title; x.title = v; if (was && v) roomForTitle(x); }, { merge: `title-${c.id}`, canvasOnly: true }), 'frame-title'), E('frameTitleHint')),
      propBox(E('frameLook'), segPick([['line', E('look.line')], ['fill', E('look.fill')], ['title', E('look.title')]], c.look || 'line',
        (v) => upd((x) => { if (v === 'line') delete x.look; else x.look = v; }), 'look')),
      foldBox('props', E('moreSettings'), h('div', { class: 'form' }, visProps(c), fontProp(c), geomProps(c)), 'more-settings'),
      actions(),
      hintText(E('frameHelp')));
  }

  /** Bild wählen (Datei-Dialog im Hauptprogramm, Bild wird in den Datenordner kopiert) */
  /** Bild wählen: zuerst aus „Meine Symbole“ (wenn es welche gibt), sonst bzw. auf Wunsch eine Datei vom PC */
  async function pickImage(apply, current) {
    const fromFile = async () => {
      try {
        const name = await window.e4.pickImage();
        if (name) { closeModal(); await change((page) => apply(page, name)); }
      } catch (err) { toast(err.message); }
    };
    if (!ed || !ed.symbols || !ed.symbols.length) return fromFile();
    const panel = h('div', { class: 'panel', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': MS('pickTitle'), 'data-test': 'sym-pick' } },
      h('div', { class: 'head' }, h('h2', { text: MS('pickTitle') }),
        h('button', { class: 'iconbtn', attrs: { 'aria-label': T('ui.common.close') }, on: { click: closeModal } }, icon('close'))),
      h('div', { class: 'reclabel', text: MS('pickFrom') }),
      symbolGrid(ed.symbols, async (sym) => { closeModal(); await change((page) => apply(page, sym.img)); }, false, current),
      h('div', { class: 'foot' }, h('button', { class: 'btn', attrs: { 'data-test': 'sym-pick-file' }, on: { click: fromFile } }, MS('pickFile')),
        h('div', { class: 'spacer' }), h('button', { class: 'btn', on: { click: closeModal } }, T('ui.common.cancel'))));
    const overlay = h('div', { class: 'overlay center', on: { mousedown: (e) => { if (e.target === overlay) closeModal(); } } }, panel);
    setModal(overlay);
  }

  /** Auswahl einer Variablen mit „keine“ (Wechselbild, Rückmeldung); onlyBits: nur Bits zeigen */
  function optVarSelect(dev, name, key, onPick, onlyBits, noNone) {
    return h('select', { class: 'input', attrs: { 'data-prop': key },
      on: { change: (ev) => { const v = ev.target.value; const i = v.indexOf('|'); onPick(i < 0 ? '' : v.slice(0, i), i < 0 ? '' : v.slice(i + 1)); } } },
    noNone ? null : h('option', { value: '', text: E('varNoneOpt'), attrs: { selected: !name } }),
    state.devices.map((d) => h('optgroup', { attrs: { label: d.name } }, (ed.vars[d.id] || []).filter((v) => v.operand !== 'CLOCK' && (!onlyBits || v.type === 'BIT')).map((v) => {
      const k = keyOfVar(v);
      return h('option', { value: `${d.id}|${k}`, text: `${v.userLabel || v.label} (${opText(v)})`, attrs: { selected: d.id === dev && k === name } });
    }))));
  }

  /** Statusbild: Variable und je Zustand ein eigenes Bild; passt kein Zustand, gilt das Grundbild */
  function imageStatesProps(e) {
    const I = (k) => E(`image.${k}`);
    const parts = [propBox(I('swapVar'), optVarSelect(e.dev, e.name, 'image-var', (dev, name) => change(() => {
      const el = findEl(e.id).el;
      if (name) { el.dev = dev; el.name = name; } else { delete el.dev; delete el.name; delete el.map; }
    })), I('swapHint'))];
    if (e.name) parts.push(statesEditor(e, 'image'));
    return parts;
  }

  /**
   * Zustandsliste für Statusbild, Statusmeldung (lamp) und Statustext (status): je Zeile „Wenn“ Variable (sonst die des
   * Elements), Bedingung (Bit: ein/aus, sonst Wert oder Bereich), Aussehen (Bild bzw. Text, Farbe, Symbol), „blinkt“
   * und Reihenfolge – die oberste passende Zeile gilt.
   */
  function statesEditor(e, kind) {
    const S = (k, a2) => E(`state.${k}`, a2);
    const isBitVar = (dev, name) => { const v = (ed.vars[dev] || []).find((x) => keyOfVar(x) === name); return v ? v.type === 'BIT' : false; };
    // Statusmeldung bzw. Statusbild mit Bit-Variable ohne eigene Zeilen: „ein“ und „aus“ vorgeben (beim ersten Ändern übernommen)
    const list = e.map || (kind === 'lamp' || (kind === 'image' && isBitVar(e.dev, e.name)) ? [{ from: 1 }, { from: 0 }] : []);
    const upd = (fn, opts) => change(() => { const el = findEl(e.id).el; if (!el.map) el.map = JSON.parse(JSON.stringify(list)); fn(el); if (!el.map.length) delete el.map; }, opts);
    const num = (v) => { const n = Number(String(v).trim().replace(',', '.')); return String(v).trim() && Number.isFinite(n) ? n : undefined; };
    const move = (i, d) => upd((el) => { const [x] = el.map.splice(i, 1); el.map.splice(i + d, 0, x); });
    const rows = list.map((row, i) => {
      const dev = row.name ? row.dev : e.dev;
      const name = row.name || e.name;
      const bit = isBitVar(dev, name);
      const t = (k) => `state-${i}-${k}`;
      const when = bit
        ? h('div', { class: 'statebit' }, segPick([[1, S('on')], [0, S('off')]], row.to === undefined ? row.from : null,
          (v) => upd((el) => { el.map[i].from = v; delete el.map[i].to; }), t('bit')))
        : h('div', { class: 'stateval' },
          h('input', { class: 'input', value: String(row.from).replace('.', ','), attrs: { 'aria-label': S('from'), placeholder: S('from'), 'data-test': t('from') },
            on: { change: (ev) => upd((el) => { const n = num(ev.target.value); if (n !== undefined) el.map[i].from = n; }) } }),
          h('span', { class: 'small muted', text: S('until') }),
          h('input', { class: 'input', value: row.to === undefined ? '' : String(row.to).replace('.', ','), attrs: { placeholder: '–', 'aria-label': S('until'), 'data-test': t('to') },
            on: { change: (ev) => upd((el) => { const n = num(ev.target.value); if (n === undefined) delete el.map[i].to; else el.map[i].to = n; }) } }));
      const look = kind === 'image'
        ? h('button', { class: `imgthumb${row.img ? '' : ' empty'}`, attrs: { title: E('image.statePick'), 'data-test': t('pick') },
          on: { click: () => pickImage((page, n) => { const el = findEl(e.id).el; if (!el.map) el.map = JSON.parse(JSON.stringify(list)); el.map[i].img = n; }, row.img) } },
          row.img ? h('img', { attrs: { src: imgUrl(row.img), alt: '' } }) : h('span', { class: 'small', text: S('pickImage') }))
        : h('div', { class: 'statelook' },
          h('input', { class: 'input', value: row.text || '', attrs: { 'aria-label': E('map.text'), placeholder: bit ? T(`ui.page.${row.from ? 'on' : 'off'}`) : E('map.text'), 'data-test': t('text') },
            on: { input: (ev) => upd((el) => setRow(el.map[i], 'text', ev.target.value), { merge: `state-${e.id}-${i}-text`, canvasOnly: true }) } }),
          h('select', { class: 'input', attrs: { 'aria-label': E('map.color'), 'data-test': t('color') }, on: { change: (ev) => upd((el) => setRow(el.map[i], 'color', ev.target.value)) } },
            colorOptions(row.color, true)),
          h('select', { class: 'input', attrs: { 'aria-label': E('map.icon'), 'data-test': t('icon') }, on: { change: (ev) => upd((el) => setRow(el.map[i], 'icon', ev.target.value)) } },
            symbolOptions(row.icon)));
      // Variable der Zeile: im Normalfall die des Elements (steht oben) – dann nur „Wenn ein/aus“ und ein Link
      // „andere Variable …“; hat die Zeile eine eigene Variable (z. B. Störung), steht sie mit Auswahl da
      const varLine = () => h('div', { class: 'imgstatevar' }, h('span', { class: 'small muted', text: S('if') }),
        optVarSelect(dev, name, t('var'), (d, n) => upd((el) => {
          const r2 = el.map[i];
          if (d === el.dev && n === el.name) { delete r2.dev; delete r2.name; } else { r2.dev = d; r2.name = n; }
          if (isBitVar(d, n) && (r2.to !== undefined || (r2.from !== 0 && r2.from !== 1))) { r2.from = 1; delete r2.to; }
        }), false, true));
      const own = !!row.name;
      const card = h('div', { class: `imgstate state-${kind === 'image' ? 'img' : 'look'}`, attrs: { 'data-state-row': String(i) } },
        own ? varLine() : null,
        h('div', { class: `statewhen${own ? '' : ' withif'}` }, own ? null : h('span', { class: 'small muted', text: S('if') }), when, kind === 'image' ? look : null),
        kind === 'image' ? null : look,
        own ? null : h('button', { class: 'btn link small otherlink', text: S('otherVar'), attrs: { title: S('otherVarHint'), 'data-test': t('othervar') },
          on: { click: (ev) => { ev.currentTarget.remove(); card.prepend(varLine()); card.querySelector('.statewhen > .small').remove(); card.querySelector('.statewhen').classList.remove('withif'); } } }),
        h('div', { class: 'imgstatefoot' },
          h('label', { class: 'check small' }, h('input', { attrs: { type: 'checkbox', checked: !!row.blink, 'data-test': t('blink') },
            on: { change: (ev) => upd((el) => { if (ev.target.checked) el.map[i].blink = true; else delete el.map[i].blink; }) } }), S('blink')),
          h('span', { class: 'grow' }),
          h('button', { class: 'iconbtn small', text: '▲', attrs: { title: S('up'), 'aria-label': S('up'), disabled: i === 0, 'data-test': t('up') }, on: { click: () => move(i, -1) } }),
          h('button', { class: 'iconbtn small', text: '▼', attrs: { title: S('down'), 'aria-label': S('down'), disabled: i === list.length - 1, 'data-test': t('down') }, on: { click: () => move(i, 1) } }),
          h('button', { class: 'iconbtn small', attrs: { title: T('ui.common.delete'), 'aria-label': T('ui.common.delete'), 'data-test': t('del') }, on: { click: () => upd((el) => { el.map.splice(i, 1); }) } }, icon('close'))));
      return card;
    });
    // neue Zeile: Variable der letzten Zeile übernehmen; Wert = nächster Wert dieser Variablen (Bit: 1, danach 0)
    const newRow = (el) => {
      const last = el.map[el.map.length - 1];
      const row = { from: 0 };
      if (last && last.name) { row.dev = last.dev; row.name = last.name; }
      const same = el.map.filter((x) => (x.name || '') === (row.name || '') && (x.dev || '') === (row.dev || ''));
      const prev = same[same.length - 1];
      if (isBitVar(row.name ? row.dev : el.dev, row.name || el.name)) row.from = prev && prev.from === 1 && prev.to === undefined ? 0 : 1;
      else if (prev) row.from = (prev.to === undefined ? prev.from : prev.to) + 1;
      return row;
    };
    const add = () => upd((el) => { el.map.push(newRow(el)); });
    const body = [...rows, h('button', { class: 'btn small', attrs: { 'data-test': 'state-add' }, on: { click: add } }, icon('plus'), S('add'))];
    if (kind !== 'image') {
      // „sonst“: wenn keine Zeile passt
      const findOther = (el) => { if (!el.other) el.other = {}; return el.other; };
      body.push(mapRow(e.id, e.other, { key: 'other', title: E('map.other'), find: findOther, textPlaceholder: kind === 'lamp' ? S('otherLamp') : E('map.otherPlaceholder') }));
    }
    return propBox(S(kind === 'image' ? 'titleImage' : 'title'), h('div', { class: 'form tight' }, ...body), S(kind === 'image' ? 'hintImage' : 'hint'));
  }

  /** Taster: Rückmelde-Variable für den Leuchttaster */
  /** Schrift des leuchtenden Tasters: eigene Wahl, sonst passend zur Leuchtfarbe (auf Gelb und Weiß schwarz) */
  function litText(e) {
    if (e.litText === 'white' || e.litText === 'black') return e.litText;
    return e.fbColor === 'warn' || e.fbColor === 'white' ? 'black' : 'white';
  }

  function buttonFbProps(e) {
    return propBox(E('fbVar'), optVarSelect(e.fb && e.fb.dev, e.fb && e.fb.name, 'button-fb', (dev, name) => change(() => {
      const el = findEl(e.id).el;
      if (name) el.fb = { dev, name }; else delete el.fb;
    }), true), E('fbHint'));
  }

  function imageProps(e) {
    const I = (k) => E(`image.${k}`);
    return [
      h('div', { class: 'inline' },
        h('button', { class: 'btn small primary', attrs: { 'data-test': 'pick-image' }, on: { click: () => pickImage((page, name) => { findEl(e.id).el.img = name; }, e.img) } }, I(e.img ? 'change' : 'choose')),
        e.img ? h('button', { class: 'btn small', attrs: { 'data-test': 'remove-image' }, on: { click: () => change(() => { delete findEl(e.id).el.img; }) } }, I('remove')) : null),
      propBox(I('fit'), segPick([['contain', I('contain')], ['cover', I('cover')], ['none', I('none')]], e.fit || 'contain',
        (v) => change(() => { const el = findEl(e.id).el; if (v === 'contain') delete el.fit; else el.fit = v; }), 'fit'), I('fitHint')),
      prop(I('alt'), textInput(e.alt, '', (v) => change(() => { findEl(e.id).el.alt = v; }, { merge: `alt-${e.id}`, canvasOnly: true }), 'image-alt'), I('altHint')),
      hintText(I('help')),
    ];
  }

  function elementProps(e, r) {
    r = r || {};
    const parts = [h('h2', { text: T(`ui.kinds.${e.kind === 'image' && e.states ? 'simage' : e.kind}`) })];
    const more = []; // seltener gebraucht: unter „Mehr Einstellungen“
    if (e.kind === 'text') {
      parts.push(prop(E('text'), textInput(e.text, '', (v) => change(() => { findEl(e.id).el.text = v; }, { merge: `text-${e.id}`, canvasOnly: true }), 'text', true), E('textHint')));
      parts.push(placeholderProps(e, r));
      parts.push(propBox(E('textSize'), segPick([['normal', E('size.normal')], ['title', E('size.title')], ['hint', E('size.hint')]], e.size || 'normal',
        (v) => change(() => { findEl(e.id).el.size = v; }), 'size')));
      parts.push(propBox(E('align'), segPick([['left', E('alignLeft')], ['center', E('alignCenter')], ['right', E('alignRight')]], e.align || 'left',
        (v) => change(() => { const el = findEl(e.id).el; if (v === 'left') delete el.align; else el.align = v; }), 'align')));
    } else if (e.kind === 'image') {
      parts.push(...imageProps(e), ...(e.states ? imageStatesProps(e) : []));
    } else if (e.kind === 'fkey') {
      parts.push(...fkeyProps(e, (fn, opts) => change(() => fn(findEl(e.id).el), opts)));
    } else if (e.kind === 'device') {
      parts.push(...deviceProps(e, r));
    } else if (e.kind === 'trend') {
      parts.push(...trendProps(e, r));
    } else if (e.kind === 'lang') {
      parts.push(prop(E('label'), textInput(e.label, '', (v) => change(() => setOpt(e.id, 'label', v), { merge: `label-${e.id}`, canvasOnly: true }), 'label')),
        h('div', { class: 'hint', text: LG('langElement') }));
    } else if (e.kind === 'alarms') {
      // Höhe kommt allein vom Platz des Elements (Ecke ziehen / „Platz und Größe“) – „klein/mittel/groß“ entfällt (Ralf 08.11.2026)
      parts.push(h('div', { class: 'hint', text: A('intro') }));
    } else {
      parts.push(prop(E('variable'), varSelect(e), r.missing ? E(e.name ? 'varMissing' : 'varChoose') : `${r.deviceName} · ${r.operand}`));
      if (!r.missing && r.kinds && r.kinds.length > 1) {
        more.push(propBox(E('show'), segPick(r.kinds.map((k) => [k, T(`ui.kinds.${k}`)]), r.kind, (k) => change(() => { findEl(e.id).el.kind = k; fitIds.add(e.id); }), 'kind')));
      }
      const opt = (key, placeholder) => textInput(e[key], placeholder, (v) => change(() => setOpt(e.id, key, v), { merge: `${key}-${e.id}`, canvasOnly: true }), key);
      // Beschriftung abschaltbar (Ralf 08.11.2026) – nicht beim Taster, dort ist sie die Aufschrift
      const canHide = r.kind !== 'button';
      if (canHide) {
        parts.push(h('div', { class: 'optitem' }, checkField(E('showLabel'), !e.noLabel,
          (on) => change(() => { const el = findEl(e.id).el; if (on) delete el.noLabel; else el.noLabel = true; fitIds.add(e.id); }), 'show-label')));
      }
      if (!canHide || !e.noLabel) parts.push(prop(E('label'), opt('label', r.varLabel), e.label ? E('labelHint') : E('labelFromVar')));
      if (['number', 'kpi', 'setpoint', 'bar', 'gauge', 'slider'].includes(r.kind)) parts.push(prop(E('unit'), opt('unit', r.unit)));
      if (r.kind === 'bar' || r.kind === 'gauge') {
        parts.push(h('div', { class: 'row2' }, prop(E('scaleMin'), opt('min', fmt(r.min))), prop(E('scaleMax'), opt('max', fmt(r.max)))));
      }
      if (r.kind === 'setpoint' || r.kind === 'slider') {
        parts.push(h('div', { class: 'row3' }, prop(E('min'), opt('min', fmt(r.min))), prop(E('max'), opt('max', fmt(r.max))), prop(E('step'), opt('step', fmt(r.step)))));
      }
      if (!r.missing) parts.push(...lookProps(e, r, more));
      if (!r.missing && r.kind === 'button') more.push(buttonFbProps(e));
    }
    more.push(visProps(e), fontProp(e), geomProps(e));
    parts.push(foldBox('props', E('moreSettings'), h('div', { class: 'form' }, ...more), 'more-settings'));
    parts.push(actions(true), hintText(E('elHelp')));
    return h('div', { class: 'form' }, ...parts);
  }

  // ---------------------------------------------------------------- Teil 3b: Platzhalter, Werteliste, Darstellung
  const symbolOptions = (current) => [h('option', { value: '', text: E('symbolNone'), attrs: { selected: !current } }),
    ...SYM.names.map((n) => h('option', { value: n, text: T(`ui.symbols.${n}`), attrs: { selected: n === current } }))];
  const colorOptions = (current, withDefault) => [withDefault ? h('option', { value: '', text: E('colorDefault'), attrs: { selected: !current } }) : null,
    ...COLOR_ROLES.map((c) => h('option', { value: c, text: E(`color.${c}`), attrs: { selected: c === current } }))].filter(Boolean);

  /** Symbol als Raster zum Anklicken (für das Symbol des Elements) */
  function symbolPicker(current, onPick) {
    return h('div', { class: 'sympicker', attrs: { role: 'group' } },
      h('button', { class: `symbtn${current ? '' : ' on'}`, text: '–', attrs: { title: E('symbolNone'), 'aria-pressed': String(!current), 'data-test': 'symbol-none' }, on: { click: () => onPick('') } }),
      ...SYM.names.map((n) => h('button', { class: `symbtn${n === current ? ' on' : ''}`, html: SYM.svg(n, 22),
        attrs: { title: T(`ui.symbols.${n}`), 'aria-label': T(`ui.symbols.${n}`), 'aria-pressed': String(n === current), 'data-test': `symbol-${n}` }, on: { click: () => onPick(n) } })));
  }

  /** Werteliste ändern; leere Liste fällt weg */
  function mapChange(eid, fn, opts) {
    change(() => {
      const el = findEl(eid).el;
      if (!el.map) el.map = [];
      fn(el);
      if (!el.map.length) delete el.map;
    }, opts);
  }
  function setRow(row, key, raw) {
    const text = String(raw === undefined || raw === null ? '' : raw).trim();
    if (key === 'from' || key === 'to') {
      const n = Number(text.replace(',', '.'));
      if (text && Number.isFinite(n)) row[key] = n;
      else if (key === 'to') delete row.to;
      else row.from = 0;
    } else if (text) row[key] = text;
    else delete row[key];
  }

  /** eine Zeile der Werteliste: Wert (oder von–bis), Text, Farbe, Symbol */
  function mapRow(eid, row, opts) {
    const at = (fn) => (el) => { const r2 = opts.find(el); if (r2) fn(r2, el); };
    const inp = (key, placeholder, cls) => h('input', { class: `input${cls ? ` ${cls}` : ''}`, value: row && row[key] !== undefined ? String(row[key]).replace('.', ',') : '',
      attrs: { placeholder: placeholder || '', 'aria-label': E(`map.${key}`), 'data-map': `${opts.key}-${key}` },
      on: { input: (ev) => mapChange(eid, at((r2) => setRow(r2, key, ev.target.value)), { merge: `map-${eid}-${opts.key}-${key}`, canvasOnly: true }) } });
    const sel = (key, options) => h('select', { class: 'input', attrs: { 'aria-label': E(`map.${key}`), 'data-map': `${opts.key}-${key}` },
      on: { change: (ev) => mapChange(eid, at((r2) => setRow(r2, key, ev.target.value))) } }, options);
    return h('div', { class: 'maprow', attrs: { 'data-map-row': opts.key } },
      h('div', { class: 'mapwhen' }, opts.title ? h('span', { class: 'small', text: opts.title })
        : [inp('from', '0', 'num'), h('span', { class: 'muted small', text: E('map.until') }), inp('to', '', 'num')],
        opts.remove ? h('button', { class: 'iconbtn small', attrs: { 'aria-label': E('map.remove'), title: E('map.remove') }, on: { click: opts.remove } }, icon('close')) : null),
      opts.noText ? null : inp('text', opts.textPlaceholder || ''),
      h('div', { class: 'mapstyle' }, sel('color', colorOptions(row && row.color, true)), sel('icon', symbolOptions(row && row.icon))));
  }

  function mapEditor(e) {
    const rows = [];
    {
      (e.map || []).forEach((row, i) => rows.push(mapRow(e.id, row, { key: `r${i}`, find: (el) => el.map[i],
        remove: () => mapChange(e.id, (el) => { el.map.splice(i, 1); }) })));
      rows.push(h('button', { class: 'btn small', attrs: { 'data-test': 'map-add' }, on: { click: () => mapChange(e.id, (el) => {
        const last = el.map[el.map.length - 1];
        el.map.push({ from: last ? (last.to !== undefined ? last.to : last.from) + 1 : 0 });
      }) } }, icon('plus'), E('map.add')));
      // „sonst“
      const findOther = (el) => { if (!el.other) el.other = {}; return el.other; };
      rows.push(mapRow(e.id, e.other, { key: 'other', title: E('map.other'), find: findOther, textPlaceholder: E('map.otherPlaceholder') }));
    }
    const kindKey = e.kind === 'gauge' ? 'gauge' : e.kind === 'number' || e.kind === 'bar' ? 'number' : '';
    return propBox(E(kindKey ? `map.${kindKey}Title` : 'map.title'), h('div', { class: 'maplist' }, rows), E(kindKey ? `map.${kindKey}Hint` : 'map.hint'));
  }

  /** Darstellung je Art: Symbol/Text, Werteliste, Schalter-Stil, Taster-Art */
  function lookProps(e, r, more) {
    const parts = [];
    more = more || parts;
    const setField = (key, value) => change(() => { const el = findEl(e.id).el; if (value === '' || value === undefined || value === null) delete el[key]; else el[key] = value; });
    if (r.kind === 'lamp' || r.kind === 'status') {
      parts.push(statesEditor(e, r.kind));
      more.push(propBox(E('lookTitle'), segPick([['both', E('showBoth')], ['symbol', E('showSymbol')], ['text', E('showText')]], e.show || 'both',
        (v) => setField('show', v === 'both' ? '' : v), 'show')));
      more.push(propBox(E('symbol'), symbolPicker(e.icon || '', (n) => setField('icon', n)), E('symbolHint')));
    } else if (r.kind === 'number' || r.kind === 'gauge') {
      if (r.kind === 'gauge') {
        more.push(propBox(E('gaugeTicks'), segPick([['in', E('ticksIn')], ['out', E('ticksOut')]], e.ticks === 'out' ? 'out' : 'in',
          (v) => setField('ticks', v === 'out' ? 'out' : ''), 'gaugeticks'), E('gaugeTicksHint')));
      }
      more.push(mapEditor(e));
    } else if (r.kind === 'clock') {
      // nur ein Teil der Uhr in der Variablenliste (z. B. die Minute): ganze Uhr als eine Variable ergänzen
      const p = r.clockParts || {};
      if (!r.clockFull && (p[1] === undefined || p[2] === undefined)) {
        parts.push(r.protocol === 'mqtt' ? h('div', { class: 'result warn small' }, icon('warn'), h('div', { text: E('clockMqtt') }))
          : h('div', { class: 'result warn small', attrs: { 'data-test': 'clock-incomplete' } }, icon('warn'), h('div', { class: 'grow' }, h('div', { text: E('clockIncomplete') }),
            h('button', { class: 'btn small primary', attrs: { 'data-test': 'clock-add-full' }, on: { click: async () => {
              try {
                await window.e4.addVariable(e.dev, { operand: 'CLOCK', name: 'CLOCK', label: E('clockVarLabel') });
                ed.vars[e.dev] = (await window.e4.getDevice(e.dev)).variables;
                await refreshView();
                render();
              } catch (err) { toast(err.message); }
            } } }, E('clockAddFull')))));
      }
      parts.push(propBox(E('clockFmt'), segPick([['hm', E('clockHm')], ['hms', E('clockHms')], ['dt', E('clockDt')], ['d', E('clockD')]], e.clockFmt || 'hm',
        (v) => setField('clockFmt', v === 'hm' ? '' : v), 'clockfmt'), E('clockFmtHint')));
      parts.push(h('div', { class: 'optitem' }, checkField(E('clockWarn'), !!e.clockWarn, (on) => setField('clockWarn', on ? true : ''), 'clock-warn'),
        h('div', { class: 'muted small', text: E('clockWarnHint') })));
    } else if (r.kind === 'kpi') {
      more.push(propBox(E('kpiAddr'), segPick([['show', E('kpiAddrShow')], ['hide', E('kpiAddrHide')]], e.noAddr ? 'hide' : 'show',
        (v) => setField('noAddr', v === 'hide' ? true : ''), 'noaddr'), E('kpiAddrHint')));
      more.push(mapEditor(e));
    } else if (r.kind === 'choice') {
      parts.push(choiceEditor(e, r));
    } else if (r.kind === 'bar') {
      more.push(propBox(E('orient'), segPick([['h', E('orientH')], ['v', E('orientV')]], e.orient === 'v' ? 'v' : 'h',
        (v) => setField('orient', v === 'v' ? 'v' : ''), 'orient')));
      const fitField = (key, value) => change(() => { const el = findEl(e.id).el; if (value) el[key] = value; else delete el[key]; fitIds.add(e.id); });
      more.push(propBox(E('barWidth'), segPick([['s', E('widthS')], ['m', E('widthM')], ['l', E('widthL')]], e.bw || 's',
        (v) => fitField('bw', v === 's' ? '' : v), 'barwidth')));
      const defPos = e.orient === 'v' ? 'side' : 'top';
      more.push(propBox(E('valPos'), segPick([['top', E('posTop')], ['bottom', E('posBottom')], ['side', E('posSide')], ['none', E('posNone')]], e.valpos || defPos,
        (v) => fitField('valpos', v === defPos ? '' : v), 'valpos')));
      more.push(propBox(E('scaleTicks'), segPick([['on', E('ticksOn')], ['off', E('ticksOff')]], e.ticks === 'off' ? 'off' : 'on',
        (v) => fitField('ticks', v === 'off' ? 'off' : ''), 'ticks'), E('scaleTicksHint')));
      more.push(mapEditor(e));
    } else if (r.kind === 'slider') {
      more.push(propBox(E('scaleTicks'), segPick([['on', E('ticksOn')], ['off', E('ticksOff')]], e.ticks === 'off' ? 'off' : 'on',
        (v) => change(() => { const el = findEl(e.id).el; if (v === 'off') el.ticks = 'off'; else delete el.ticks; fitIds.add(e.id); }), 'ticks'), E('scaleTicksHint')));
    } else if (r.kind === 'switch') {
      more.push(propBox(E('switchStyle'), segPick([['slider', E('styleSlider')], ['buttons', E('styleButtons')]], e.style || 'slider',
        (v) => setField('style', v === 'buttons' ? 'buttons' : ''), 'style')));
      const txt = (key, placeholder) => textInput(e[key], placeholder, (v) => change(() => setOpt(e.id, key, v), { merge: `${key}-${e.id}`, canvasOnly: true }), key);
      more.push(h('div', { class: 'row2' }, prop(E('offText'), txt('offText', T('ui.page.off'))), prop(E('onText'), txt('onText', T('ui.page.on')))));
    } else if (r.kind === 'button') {
      parts.push(propBox(E('buttonMode'), segPick([['pulse', E('modePulse')], ['tip', E('modeTip')], ['toggle', E('modeToggle')]], e.mode || 'pulse',
        (v) => setField('mode', v === 'pulse' ? '' : v), 'mode'), E(`modeHint.${e.mode || 'pulse'}`)));
      // Leuchtfarbe (Leuchtdrucktaster): gilt für die Rückmeldung bzw. beim rastenden Taster für die eigene Variable
      const cur = e.fbColor || 'on';
      parts.push(propBox(E('fbColor'), h('div', { class: 'fbcolors', attrs: { role: 'radiogroup', 'aria-label': E('fbColor') } },
        ...['on', 'warn', 'alarm', 'blue', 'white'].map((c) => h('button', { class: `fbswatch lit-${c}${c === cur ? ' on' : ''}`,
          attrs: { role: 'radio', 'aria-checked': String(c === cur), 'aria-label': E(`fbColors.${c}`), title: E(`fbColors.${c}`), 'data-test': `fbcolor-${c}` },
          on: { click: () => setField('fbColor', c === 'on' ? '' : c) } }))), E('fbColorHint')));
      parts.push(propBox(E('litText'), segPick([['white', E('litWhite')], ['black', E('litBlack')]], litText(e), (v) => setField('litText', v), 'littext')));
    }
    return parts;
  }

  /** Betriebsart: Knöpfe mit Wert und Text (2–8) */
  function choiceEditor(e, r) {
    const opts = r.opts || [];
    // erste Änderung übernimmt die angezeigten (Standard-)Knöpfe in das Element
    const edit = (fn, o2) => change(() => { const el = findEl(e.id).el; if (!el.opts) el.opts = opts.map((o) => ({ v: o.v, t: o.t })); fn(el.opts); }, o2);
    const rows = opts.map((o, i) => h('div', { class: 'choicerow', attrs: { 'data-choice-row': i } },
      h('input', { class: 'input num', value: String(o.v), attrs: { inputmode: 'numeric', 'aria-label': E('choiceValue'), 'data-test': `choice-v-${i}` },
        on: { change: (ev) => { const n = Number(String(ev.target.value).replace(',', '.')); if (Number.isFinite(n)) edit((list) => { list[i].v = n; }); } } }),
      h('input', { class: 'input', value: o.t || '', attrs: { 'aria-label': E('choiceText'), 'data-test': `choice-t-${i}` },
        on: { input: (ev) => edit((list) => { list[i].t = ev.target.value; }, { merge: `choice-${e.id}-${i}`, canvasOnly: true }) } }),
      h('button', { class: 'iconbtn small', attrs: { 'aria-label': E('choiceRemove'), title: E('choiceRemove'), disabled: opts.length <= 2 },
        on: { click: () => edit((list) => { list.splice(i, 1); }) } }, icon('close'))));
    if (opts.length < 8) {
      rows.push(h('button', { class: 'btn small', attrs: { 'data-test': 'choice-add' }, on: { click: () => edit((list) => {
        list.push({ v: list.reduce((m, o) => Math.max(m, o.v), -1) + 1, t: '' });
      }) } }, icon('plus'), E('choiceAdd')));
    }
    return propBox(E('choiceTitle'), h('div', { class: 'maplist' }, rows), E('choiceHint'));
  }

  /** Trend: Überschrift, Kurven (Variable, Farbe, Skala), Zeitbereich beim Öffnen, Höhe */
  function trendProps(e, r) {
    const set = (fn, o2) => change(() => { const el = findEl(e.id).el; el.series = el.series || []; fn(el); }, o2);
    const resolved = r.series || [];
    const rows = (e.series || []).map((x, i) => {
      const rs = resolved[i] || {};
      const colors = h('div', { class: 'tcolors', attrs: { role: 'group', 'aria-label': E('trendColor') } }, ...TREND_COLORS.map((c, k) => {
        const b = h('button', { class: `tcolor${(rs.color === undefined ? i : rs.color) === k ? ' on' : ''}`, attrs: { 'aria-label': `${E('trendColor')} ${k + 1}`, 'data-test': `trend-color-${i}-${k}` },
          on: { click: () => set((el) => { el.series[i].color = k; }) } });
        b.style.background = c;
        return b;
      }));
      const num = (key, ph) => h('input', { class: 'input num', value: x[key] === undefined ? '' : String(x[key]).replace('.', ','),
        attrs: { inputmode: 'decimal', placeholder: ph, 'aria-label': E(key === 'min' ? 'scaleMinShort' : 'scaleMaxShort'), 'data-test': `trend-${key}-${i}` },
        on: { change: (ev) => set((el) => { const t = String(ev.target.value).trim().replace(',', '.'); if (t && Number.isFinite(Number(t))) el.series[i][key] = Number(t); else delete el.series[i][key]; }) } });
      return h('div', { class: 'maprow trendrow', attrs: { 'data-trend-row': i } },
        h('div', { class: 'mapwhen' }, h('span', { class: 'small grow', text: rs.missing ? E('varMissing') : `${rs.label} · ${rs.deviceName || ''}` }),
          h('button', { class: 'iconbtn small', attrs: { 'aria-label': E('trendRemove'), title: E('trendRemove') }, on: { click: () => set((el) => { el.series.splice(i, 1); }) } }, icon('close'))),
        colors,
        rs.bit || rs.missing ? null : h('div', { class: 'inline' }, h('span', { class: 'small muted', text: E('scaleMinShort') }), num('min', fmt(rs.min)),
          h('span', { class: 'small muted', text: E('scaleMaxShort') }), num('max', fmt(rs.max))),
        !rs.missing && !rs.recorded ? h('div', { class: 'result warn' }, icon('warn'), h('div', {}, h('div', { text: E('notRecorded') }),
          h('button', { class: 'btn small', attrs: { 'data-test': `trend-record-${i}` }, on: { click: () => ensureRecord([{ dev: x.dev, name: x.name }]) } }, E('recordOn')))) : null);
    });
    if ((e.series || []).length < 4) {
      rows.push(h('select', { class: 'input', attrs: { 'data-prop': 'trend-add', 'aria-label': E('trendAdd') },
        on: { change: async (ev) => {
          const val = ev.target.value;
          if (!val) return;
          const k = val.indexOf('|');
          const x = { dev: val.slice(0, k), name: val.slice(k + 1) };
          await set((el) => { if (!el.series.some((y) => y.dev === x.dev && y.name === x.name)) el.series.push(Object.assign({ color: freeColor(el.series) }, x)); });
          await ensureRecord([x]);
        } } },
      h('option', { value: '', text: E('trendAdd'), attrs: { selected: true } }),
      state.devices.map((d) => h('optgroup', { attrs: { label: d.name } }, (ed.vars[d.id] || []).filter((v) => v.operand !== 'CLOCK').map((v) =>
        h('option', { value: `${d.id}|${keyOfVar(v)}`, text: `${v.userLabel || v.label} (${opText(v)})` }))))));
    }
    return [
      prop(E('trendTitle'), textInput(e.label, '', (v) => change(() => setOpt(e.id, 'label', v), { merge: `label-${e.id}`, canvasOnly: true }), 'label')),
      propBox(E('trendSeries'), h('div', { class: 'maplist' }, rows), E('trendSeriesHint')),
      propBox(E('trendRange'), segPick(Object.keys(TREND_RANGES).map((k) => [k, TR(`range.${k}`)]), e.range || '1h',
        (v) => change(() => { const el = findEl(e.id).el; if (v === '1h') delete el.range; else el.range = v; if (trendView[e.id]) trendView[e.id].range = v; }), 'trendrange')),
    ];
  }

  /** Gerätekarte: Gerät, Beschriftung, Lebenszeichen-Zähler (Merkerwort, freiwillig) */
  function deviceProps(e, r) {
    const set = (fn) => change(() => fn(findEl(e.id).el));
    const devSel = h('select', { class: 'input', attrs: { 'data-prop': 'device' },
      on: { change: (ev) => set((el) => { el.dev = ev.target.value; el.name = ''; }) } },
    h('option', { value: '', text: E('devNone'), attrs: { disabled: true, selected: !e.dev } }),
    state.devices.map((d) => h('option', { value: d.id, text: d.name, attrs: { selected: d.id === e.dev } })));
    const vars = (ed.vars[e.dev] || []).filter((v) => v.type !== 'BIT' && v.operand !== 'CLOCK');
    const hbSel = h('select', { class: 'input', attrs: { 'data-prop': 'heartbeat', disabled: !e.dev },
      on: { change: (ev) => set((el) => { el.name = ev.target.value; }) } },
    h('option', { value: '', text: E('heartbeatNone'), attrs: { selected: !e.name } }),
    vars.map((v) => h('option', { value: keyOfVar(v), text: `${v.userLabel || v.label} (${opText(v)})`, attrs: { selected: keyOfVar(v) === e.name } })));
    return [
      prop(E('device'), devSel),
      prop(E('label'), textInput(e.label, r.deviceName || '', (v) => change(() => setOpt(e.id, 'label', v), { merge: `label-${e.id}`, canvasOnly: true }), 'label')),
      prop(E('heartbeat'), hbSel, E('heartbeatHint')),
    ];
  }

  /** Text mit Werten: Variable an der Schreibmarke als {1}, {2} … einfügen; je Platzhalter Format */
  function placeholderProps(e, r) {
    const resolved = (r && r.vars) || [];
    const add = h('select', { class: 'input', attrs: { 'data-prop': 'insert-var', 'aria-label': E('insertVar') },
      on: { change: (ev) => {
        const val = ev.target.value;
        if (!val) return;
        const i = val.indexOf('|');
        const ta = document.querySelector('[data-prop="text"]');
        change(() => {
          const el = findEl(e.id).el;
          el.vars = el.vars || [];
          const n = el.vars.reduce((m, x) => Math.max(m, x.n), 0) + 1;
          el.vars.push({ n, dev: val.slice(0, i), name: val.slice(i + 1) });
          const text = el.text || '';
          const pos = ta && ta.selectionStart !== null && ta.selectionStart !== undefined ? Math.min(ta.selectionStart, text.length) : text.length;
          el.text = `${text.slice(0, pos)}{${n}}${text.slice(pos)}`;
        });
      } } },
    h('option', { value: '', text: E('insertVar'), attrs: { selected: true } }),
    state.devices.map((d) => h('optgroup', { attrs: { label: d.name } }, (ed.vars[d.id] || []).map((v) =>
      h('option', { value: `${d.id}|${keyOfVar(v)}`, text: `${v.userLabel || v.label} (${opText(v)})` })))));
    const items = (e.vars || []).map((x) => {
      const rx = resolved.find((y) => y.n === x.n) || {};
      const set = (key, raw, num) => change(() => {
        const t = findEl(e.id).el.vars.find((y) => y.n === x.n);
        const text = String(raw).trim();
        if (!text) delete t[key];
        else if (num) { const n = Math.round(Number(text)); if (Number.isFinite(n)) t[key] = Math.max(0, Math.min(6, n)); }
        else t[key] = text;
      }, { merge: `ph-${e.id}-${x.n}-${key}`, canvasOnly: true });
      const remove = () => change(() => {
        const el = findEl(e.id).el;
        el.vars = el.vars.filter((y) => y.n !== x.n);
        el.text = String(el.text || '').split(`{${x.n}}`).join('');
        if (!el.vars.length) delete el.vars;
      });
      return h('div', { class: 'phitem', attrs: { 'data-ph': x.n } },
        h('div', { class: 'phhead' }, h('span', { class: 'mono badge', text: `{${x.n}}` }),
          h('span', { class: 'grow small', text: rx.missing ? E('varMissing') : `${rx.label} · ${rx.deviceName}` }),
          h('button', { class: 'iconbtn small', attrs: { 'aria-label': E('removePh'), title: E('removePh') }, on: { click: remove } }, icon('close'))),
        rx.clock
          ? segPick([['datetime', E('format.datetime')], ['date', E('format.date')], ['time', E('format.time')]], x.format || 'datetime',
            (v) => change(() => { const t = findEl(e.id).el.vars.find((y) => y.n === x.n); if (v === 'datetime') delete t.format; else t.format = v; }), `format-${x.n}`)
          : h('div', { class: 'row2' },
            prop(E('decimals'), h('input', { class: 'input', value: x.decimals === undefined ? '' : String(x.decimals),
              attrs: { inputmode: 'numeric', placeholder: E('decimalsAuto'), 'data-prop': `ph-${x.n}-decimals` }, on: { input: (ev) => set('decimals', ev.target.value, true) } })),
            prop(E('phUnit'), h('input', { class: 'input', value: x.unit || '',
              attrs: { placeholder: rx.varUnit || '', 'data-prop': `ph-${x.n}-unit` }, on: { input: (ev) => set('unit', ev.target.value) } }))));
    });
    return propBox(E('placeholders'), h('div', { class: 'phlist' }, add, ...items), E('placeholdersHint'));
  }

  function varSelect(e) {
    return h('select', { class: 'input', attrs: { 'data-prop': 'variable' },
      on: { change: (ev) => {
        const i = ev.target.value.indexOf('|');
        const dev = ev.target.value.slice(0, i);
        const name = ev.target.value.slice(i + 1);
        change(() => { const el = findEl(e.id).el; el.dev = dev; el.name = name; for (const k of OPT_FIELDS) delete el[k]; fitIds.add(e.id); });
      } } },
    h('option', { value: '', text: E('varNone'), attrs: { disabled: true, selected: !e.name } }),
    state.devices.map((d) => h('optgroup', { attrs: { label: d.name } }, (ed.vars[d.id] || []).map((v) => {
      const key = keyOfVar(v);
      return h('option', { value: `${d.id}|${key}`, text: `${v.userLabel || v.label} (${opText(v)})${canWriteVar(v) ? '' : ` – ${E('readOnly')}`}`, attrs: { selected: d.id === e.dev && key === e.name } });
    }))));
  }

  // Tastatur im Editor (nicht in Eingabefeldern)
  document.addEventListener('keydown', (ev) => {
    if (state.view !== 'editor' || !ed || document.getElementById('modal').firstChild) return;
    const tag = (ev.target && ev.target.tagName) || '';
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;
    const ctrl = ev.ctrlKey || ev.metaKey;
    const k = ev.key.toLowerCase();
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const step = ev.altKey ? 1 : GRIDPX;
    if (arrows[ev.key] && nudgeItems(arrows[ev.key][0] * step, arrows[ev.key][1] * step)) { ev.preventDefault(); return; }
    if (ev.key === 'Delete') { ev.preventDefault(); removeSelected(); }
    else if (ctrl && k === 'z' && !ev.shiftKey) { ev.preventDefault(); undo(true); }
    else if (ctrl && (k === 'y' || (k === 'z' && ev.shiftKey))) { ev.preventDefault(); undo(false); }
    else if (ctrl && k === 'd') { ev.preventDefault(); duplicateSelected(); }
    else if (ev.key === 'Escape') select({ type: 'page' });
  });

  // ------------------------------------------------------------------ Farbthema der Bedienseiten (Teil 4)
  // Gilt auf den Bedienseiten und auf der Seite im Editor; das Programmfenster selbst bleibt im Standard-Blau.
  const TH = window.E4_THEME;
  const appMode = () => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');

  /** Thema auf einen Bereich legen (CSS-Variablen, Schrift, Größe) */
  function themeNode(node, theme, mode) {
    const t = theme || state.theme || TH.DEFAULT;
    const vars = TH.vars(t, mode || appMode());
    for (const [k, v] of Object.entries(vars)) node.style.setProperty(k, v);
    // ohne eigene Farbe für Bedienelemente: eine früher gesetzte wieder entfernen (dann gilt die bisherige Fläche)
    if (!vars['--control']) { node.style.removeProperty('--control'); node.style.removeProperty('--control-border'); }
    node.classList.add('themed');
    node.classList.toggle('large', t.size === 'large');
    return node;
  }
  const logoNode = (t) => ((t || state.theme || {}).logo ? h('img', { class: 'themelogo', attrs: { src: (t || state.theme).logo, alt: '' } }) : null);

  let designSave = null;
  let designBack = 'devices';
  async function showDesign() {
    if (needSetupView(() => showDesign())) return;
    closeModal();
    await flushEditorSave();
    if (state.view !== 'design') designBack = state.view;
    state.theme = await window.e4.getTheme();
    state.themePresets = await window.e4.getThemePresets();
    state.view = 'design';
    render();
  }
  /** Änderung am Thema: sofort zeigen, kurz danach speichern */
  function themeChange(fn, full) {
    const t = JSON.parse(JSON.stringify(state.theme));
    fn(t);
    state.theme = t;
    clearTimeout(designSave);
    designSave = setTimeout(async () => { state.theme = await window.e4.saveTheme(state.theme); }, 300);
    if (full) render();
    else updateDesignLive();
  }

  function designView() {
    const D = (k, a) => T(`ui.design.${k}`, a);
    const t = state.theme;
    const head = h('div', { class: 'pagehead' },
      h('button', { class: 'iconbtn', attrs: { 'aria-label': T('ui.common.back') }, on: { click: () => (designBack === 'pages' ? showPages() : designBack === 'editor' ? showEditor() : designBack === 'detail' ? showDetail() : showDevices()) } }, icon('back')),
      h('div', { class: 'grow' }, h('h1', { text: D('title') }), h('div', { class: 'muted', text: D('intro') })),
      h('button', { class: 'btn', attrs: { 'data-test': 'theme-import' }, on: { click: async () => {
        try { const r = await window.e4.importTheme(); if (r) { state.theme = r; render(); toast(D('imported')); } } catch (err) { toast(err.message); }
      } } }, D('import')),
      h('button', { class: 'btn', attrs: { 'data-test': 'theme-export' }, on: { click: async () => {
        try { if (await window.e4.exportTheme()) toast(D('exported')); } catch (err) { toast(err.message); }
      } } }, D('export')),
      h('button', { class: 'btn', attrs: { 'data-test': 'theme-reset' }, on: { click: () => {
        if (window.confirm(D('resetConfirm'))) themeChange((x) => { Object.assign(x, JSON.parse(JSON.stringify(TH.DEFAULT))); }, true);
      } } }, D('reset')));

    const swatches = (p) => [
      h('span', { class: 'swatches' }, ...['accent', 'bg', 'on', 'warn', 'alarm'].map((r) => { const s = h('span', { class: 'sw' }); s.style.background = p.light[r]; return s; })),
      h('span', { class: 'swatches dark' }, ...['accent', 'bg', 'on', 'warn', 'alarm'].map((r) => { const s = h('span', { class: 'sw' }); s.style.background = p.dark[r]; return s; }))];
    const presets = h('div', { class: 'presetgrid' }, Object.entries(TH.PRESETS).map(([name, p]) => h('button', { class: 'preset',
      attrs: { 'data-preset': name, title: D(`presets.${name}`) },
      on: { click: () => themeChange((x) => {
        x.light = Object.assign({}, p.light);
        x.dark = Object.assign({}, p.dark);
        if (p.font) x.font = p.font; // Vorlage mit eigener Schrift/Form (Leitstand)
        if (p.radius) x.radius = p.radius;
      }, true) } },
    ...swatches(p), h('span', { text: D(`presets.${name}`) }))));
    // eigene Vorlagen: ganzes Design (Farben, Ecken, Schrift, Größe, Logo) mit Namen
    const own = (state.themePresets || []).map((p) => h('div', { class: 'preset own', attrs: { 'data-own-preset': p.name } },
      h('button', { class: 'presetapply', attrs: { title: p.name }, on: { click: () => {
        themeChange((x) => { for (const k of ['light', 'dark', 'radius', 'font', 'size', 'logo']) x[k] = JSON.parse(JSON.stringify(p[k])); }, true);
        toast(D('presetApplied', { name: p.name }));
      } } }, ...swatches(p), h('span', { text: p.name })),
      h('button', { class: 'iconbtn small presetdel', attrs: { 'aria-label': `${D('presetDelete')}: ${p.name}`, title: D('presetDelete') },
        on: { click: async () => {
          if (!window.confirm(D('presetDeleteConfirm', { name: p.name }))) return;
          state.themePresets = await window.e4.deleteThemePreset(p.id);
          render();
        } } }, icon('close'))));
    const presetName = h('input', { class: 'input', attrs: { placeholder: D('presetName'), 'aria-label': D('presetNameLabel'), 'data-test': 'preset-name', maxlength: '40' } });
    const savePreset = async () => {
      try {
        clearTimeout(designSave);
        state.theme = await window.e4.saveTheme(state.theme); // erst das aktuelle Design sichern
        state.themePresets = await window.e4.saveThemePreset(presetName.value);
        toast(D('presetSaved', { name: presetName.value.trim() }));
        render();
      } catch (err) { toast(err.message); }
    };
    presetName.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') savePreset(); });
    const ownBox = h('div', { class: 'ownpresets' },
      h('h3', { text: D('ownPresets') }),
      own.length ? h('div', { class: 'presetgrid' }, own) : null,
      h('div', { class: 'inline' }, presetName, h('button', { class: 'btn', attrs: { 'data-test': 'preset-save' }, on: { click: savePreset } }, D('presetSave'))),
      h('div', { class: 'hint', text: D('presetSaveHint') }));

    const baseInput = h('input', { class: 'colorinput', attrs: { type: 'color', value: t.light.accent.toLowerCase(), 'aria-label': D('deriveColor'), 'data-test': 'derive-color' } });
    const derive = h('div', { class: 'inline' }, baseInput,
      h('button', { class: 'btn', attrs: { 'data-test': 'derive' }, on: { click: () => themeChange((x) => Object.assign(x, TH.derive(baseInput.value)), true) } }, D('derive')));

    // Bedienelemente: ohne eigene Farbe wie bisher – angezeigt wird dann die heutige Knopf-Fläche
    const shown = (mode, role) => t[mode][role] || TH.vars(t, mode)['--surface2'];
    const colorRow = (role) => h('tr', {},
      h('td', {}, h('div', { text: D(`roles.${role}`) }), h('div', { class: 'muted small', text: D(`rolesHint.${role}`) }),
        TH.OPTIONAL.includes(role) && (t.light[role] || t.dark[role]) ? h('button', { class: 'btn small link', attrs: { 'data-test': `unset-${role}` },
          on: { click: () => themeChange((x) => { delete x.light[role]; delete x.dark[role]; }, true) } }, D('asBefore')) : null),
      ...['light', 'dark'].map((mode) => h('td', {}, h('div', { class: 'colorcell' },
        h('input', { class: 'colorinput', attrs: { type: 'color', value: shown(mode, role).toLowerCase(), 'aria-label': `${D(`roles.${role}`)} – ${D(mode)}`, 'data-color': `${mode}-${role}` },
          on: { input: (ev) => themeChange((x) => { x[mode][role] = ev.target.value.toUpperCase(); }),
            change: () => render() } }),
        h('span', { class: 'mono small muted', text: t[mode][role] || D('asSurface'), attrs: { 'data-hex': `${mode}-${role}` } }),
        h('span', { attrs: { 'data-badge': `${mode}-${role}` } }, badgeFor(t, mode, role))))));

    const controls = h('div', { class: 'designcontrols' },
      h('section', { class: 'card' }, h('h2', { text: D('presetsTitle') }), presets, ownBox),
      h('section', { class: 'card' }, h('h2', { text: D('deriveTitle') }), h('div', { class: 'muted small', text: D('deriveHint') }), derive),
      h('section', { class: 'card' }, h('h2', { text: D('colors') }), h('div', { class: 'muted small', text: D('colorsHint') }),
        h('table', { class: 'colortable' }, h('thead', {}, h('tr', {}, h('th', { text: '' }), h('th', { text: D('light') }), h('th', { text: D('dark') }))),
          h('tbody', {}, TH.ROLES.concat(TH.OPTIONAL).map(colorRow)))),
      h('section', { class: 'card form' }, h('h2', { text: D('shape') }),
        propBox(D('radius'), segPick([['square', D('radiusSquare')], ['soft', D('radiusSoft')], ['round', D('radiusRound')]], t.radius, (v) => themeChange((x) => { x.radius = v; }, true), 'radius')),
        propBox(D('depth'), segPick([['flat', D('depthFlat')], ['soft', D('depthSoft')]], t.depth || 'flat', (v) => themeChange((x) => { x.depth = v; }, true), 'depth'), D('depthHint')),
        propBox(D('font'), segPick([['plex', 'IBM Plex Sans'], ['inter', 'Inter'], ['atkinson', 'Atkinson'], ['leitstand', 'Leitstand']], t.font, (v) => themeChange((x) => { x.font = v; }, true), 'font'), D('fontHint')),
        propBox(D('size'), segPick([['normal', D('sizeNormal')], ['large', D('sizeLarge')]], t.size, (v) => themeChange((x) => { x.size = v; }, true), 'size'), D('sizeHint'))),
      h('section', { class: 'card form' }, h('h2', { text: D('logo') }),
        h('div', { class: 'inline' }, t.logo ? h('img', { class: 'themelogo big', attrs: { src: t.logo, alt: '' } }) : h('span', { class: 'muted small', text: D('noLogo') })),
        h('div', { class: 'inline' },
          h('button', { class: 'btn', attrs: { 'data-test': 'logo-pick' }, on: { click: async () => {
            try { const logo = await window.e4.pickLogo(); if (logo) themeChange((x) => { x.logo = logo; }, true); } catch (err) { toast(err.message); }
          } } }, D('logoPick')),
          t.logo ? h('button', { class: 'btn danger', attrs: { 'data-test': 'logo-remove' }, on: { click: () => themeChange((x) => { x.logo = null; }, true) } }, D('logoRemove')) : null),
        h('div', { class: 'hint', text: D('logoHint') })));

    return h('div', {}, head, h('div', { class: 'designgrid' }, controls,
      h('div', { class: 'designpreview', attrs: { id: 'designPreview' } }, previewPane('light'), previewPane('dark'))));
  }

  /** Lesbarkeit einer Farbe: ✓ / ⚠ / ✗ und Knopf „Vorschlag“ */
  function badgeFor(t, mode, role) {
    const D = (k, a) => T(`ui.design.${k}`, a);
    const checks = TH.check(t[mode]).filter((c) => c.role === role);
    if (!checks.length) return null;
    const worst = checks.reduce((a, b) => (b.ratio < a.ratio ? b : a));
    const mark = { ok: '✓', low: '⚠', bad: '✗' }[worst.level];
    return h('span', { class: 'inline' },
      h('span', { class: `readable ${worst.level}`, text: `${mark} ${D(`level.${worst.level}`)}`, attrs: { title: D('ratio', { r: String(worst.ratio).replace('.', ','), on: D(`roles.${worst.on}`) }) } }),
      worst.suggest ? h('button', { class: 'btn small link', attrs: { 'data-test': `fix-${mode}-${role}`, title: worst.suggest },
        on: { click: () => themeChange((x) => { x[mode][role] = worst.suggest; }, true) } }, D('suggest')) : null);
  }

  /** beim Ziehen im Farbwähler: nur Vorschau, Farbtext und Lesbarkeit neu (der Farbwähler bleibt offen) */
  function updateDesignLive() {
    const box = document.getElementById('designPreview');
    if (!box) return;
    box.replaceChildren(previewPane('light'), previewPane('dark'));
    for (const mode of ['light', 'dark']) {
      for (const role of TH.ROLES) {
        const hx = document.querySelector(`[data-hex="${mode}-${role}"]`);
        if (hx) hx.textContent = state.theme[mode][role];
        const b = document.querySelector(`[data-badge="${mode}-${role}"]`);
        if (b) b.replaceChildren(...[badgeFor(state.theme, mode, role)].filter(Boolean));
      }
    }
  }

  /** Beispielseite im Thema (hell oder dunkel) */
  function previewPane(mode) {
    const D = (k) => T(`ui.design.${k}`);
    const P = (k) => T(`ui.page.${k}`);
    const row = (...c) => h('div', { class: 'element' }, h('div', { class: 'elrow' }, ...c));
    const sym = (name, color, lit) => h('span', { class: `elsym c-${color}${lit ? ' lit' : ''}`, html: SYM.svg(name, 28) });
    const pane = h('div', { class: 'previewpane', attrs: { 'data-preview': mode } },
      h('div', { class: 'previewhead' }, logoNode(state.theme), h('h2', { text: D(`preview.${mode}`) })),
      h('div', { class: 'pagegrid grid12' },
        h('section', { class: 'card vcard span-6' }, h('h2', { text: D('preview.card') }), h('div', { class: 'elements grid2' },
          h('div', { class: 'cell' }, row(sym('pump', 'on', true), h('span', { class: 'ellabel', text: D('preview.pump') }), h('span', { class: 'elvalue c-on', text: D('preview.running') }))),
          h('div', { class: 'cell' }, row(h('span', { class: 'lamp c-off dark' }), h('span', { class: 'ellabel', text: D('preview.fan') }), h('span', { class: 'elvalue c-off', text: P('off') }))),
          h('div', { class: 'cell' }, row(h('span', { class: 'ellabel', text: D('preview.remote') }), h('button', { class: 'switch on', attrs: { tabindex: '-1' } }, h('span', { class: 'knob' })), h('span', { class: 'elvalue state-on', text: P('on') }))))),
        h('section', { class: 'card vcard span-6' }, h('h2', { text: D('preview.state') }), h('div', { class: 'elements grid2' },
          h('div', { class: 'cell' }, row(sym('tank', 'warn', true), h('span', { class: 'ellabel', text: D('preview.level') }), h('span', { class: 'elvalue c-warn', text: D('preview.high') }))),
          h('div', { class: 'cell' }, row(sym('warning', 'alarm', true), h('span', { class: 'ellabel', text: D('preview.motor') }), h('span', { class: 'elvalue c-alarm', text: D('preview.fault') }))),
          h('div', { class: 'cell' }, h('div', { class: 'element' }, h('div', { class: 'elnumber' }, h('div', { class: 'ellabel', text: D('preview.temp') }),
            h('div', { class: 'bignum' }, h('span', { class: 'mono', text: '21,5' }), h('span', { class: 'unit', text: '°C' }))))),
          h('div', { class: 'cell' }, h('div', { class: 'element' }, h('button', { class: 'btn press', text: D('preview.reset'), attrs: { tabindex: '-1' } })))))));
    return themeNode(pane, state.theme, mode);
  }

  // ------------------------------------------------------------------ Dialog: Gerät anlegen / bearbeiten
  const DEFAULTS = {
    modbus: { host: '', port: '', firmware: '240', netId: '', timeout: '', gap: '', unitId: '', addressing: 'direct' },
    json: { host: '', https: false, port: '', auth: 'basic', user: 'admin', verifyCert: false, timeout: '', gap: '' },
    mqtt: { host: '', port: '', tls: true, caFile: '', user: '', baseTopic: '', ownTopics: false, topics: { data: '', set: '', request: '', response: '' }, timeout: '' },
  };
  let draft = null;

  function openDeviceEditor(d) {
    const protocol = d ? d.protocol : 'modbus';
    draft = {
      id: d ? d.id : null,
      name: d ? d.name : '',
      protocol,
      enabled: d ? d.enabled !== false : true,
      intervalSec: d ? String(d.interval / 1000).replace('.', ',') : '1',
      settings: {},
      secretsStored: d ? d.secrets : { password: false, apikey: false },
      secrets: { password: '', apikey: '' },
      result: null,
      error: null,
      busy: false,
    };
    for (const p of Object.keys(DEFAULTS)) draft.settings[p] = JSON.parse(JSON.stringify(DEFAULTS[p]));
    if (d) {
      const s = Object.assign(draft.settings[protocol], JSON.parse(JSON.stringify(d.settings || {})));
      for (const k of Object.keys(s)) if (s[k] === undefined || s[k] === null) s[k] = '';
      if (protocol === 'mqtt') {
        s.topics = Object.assign({ data: '', set: '', request: '', response: '' }, s.topics);
        s.ownTopics = !!(s.topics.data || s.topics.set || s.topics.request || s.topics.response);
      }
    }
    renderEditor();
  }

  /**
   * Fenster (Seitenleiste rechts) zeigen. Wird dasselbe Fenster nach einer Änderung neu gezeichnet,
   * bleibt der Bildlauf, wo er war (Ralf 08.11.2026: sprang nach jeder Änderung nach oben)
   */
  function setModal(overlay) {
    const box = document.getElementById('modal');
    const old = box.querySelector('.panel');
    const panel = overlay.classList && overlay.classList.contains('panel') ? overlay : overlay.querySelector('.panel');
    const same = old && panel && old.getAttribute('aria-label') === panel.getAttribute('aria-label');
    const top = same ? old.scrollTop : 0;
    box.replaceChildren(overlay);
    if (same && top) {
      panel.scrollTop = top;
      requestAnimationFrame(() => { if (Math.abs(panel.scrollTop - top) > 1) panel.scrollTop = top; });
    }
  }

  function closeModal() {
    draft = null;
    assign = null;
    document.getElementById('modal').replaceChildren();
  }

  /** Einstellungen für das Programm: leere Felder weglassen (dann gelten die Standardwerte) */
  function cleanSettings() {
    const src = draft.settings[draft.protocol];
    const out = {};
    for (const [k, v] of Object.entries(src)) {
      if (k === 'ownTopics' || k === 'topics') continue;
      if (v === '' || v === null || v === undefined) continue;
      out[k] = ['port', 'netId', 'timeout', 'gap', 'unitId'].includes(k) ? Number(v) : v;
    }
    if (draft.protocol === 'mqtt' && src.ownTopics) {
      out.topics = {};
      for (const [k, v] of Object.entries(src.topics)) if (v.trim()) out.topics[k] = v.trim();
    }
    if (draft.protocol === 'json' && out.auth !== 'basic') delete out.user;
    return out;
  }
  function draftDevice() {
    const iv = Number(String(draft.intervalSec).replace(',', '.'));
    return { id: draft.id || undefined, name: draft.name.trim(), protocol: draft.protocol, enabled: draft.enabled,
      interval: Number.isFinite(iv) && iv > 0 ? Math.round(iv * 1000) : 1000, settings: cleanSettings() };
  }
  function draftSecrets() {
    const s = {};
    if (draft.secrets.password) s.password = draft.secrets.password;
    if (draft.secrets.apikey) s.apikey = draft.secrets.apikey;
    return s;
  }

  // Formular-Bausteine (ändern draft direkt; „rerender“ nur bei Feldern, die andere Felder ein-/ausblenden)
  function textField(label, get, set, opts) {
    const o = opts || {};
    const id = `f_${label.replace(/\W+/g, '_')}_${Math.random().toString(36).slice(2, 7)}`;
    return h('div', { class: 'field' },
      h('label', { text: label, attrs: { for: id } }),
      h('input', { class: `input${o.mono ? ' mono' : ''}`, value: get(), attrs: { id, type: o.type || 'text', placeholder: o.placeholder, inputmode: o.inputmode, autocomplete: 'off', 'data-field': o.key },
        on: { input: (e) => set(e.target.value) } }),
      o.hint ? h('div', { class: 'hint', text: o.hint }) : null);
  }
  function selectField(label, value, options, onChange, key) {
    const id = `s_${Math.random().toString(36).slice(2, 8)}`;
    return h('div', { class: 'field' },
      h('label', { text: label, attrs: { for: id } }),
      h('select', { class: 'input', attrs: { id, 'data-field': key }, on: { change: (e) => onChange(e.target.value) } },
        ...options.map(([v, text, off]) => h('option', { text, attrs: { value: v, selected: v === value, disabled: !!off } }))));
  }
  function checkField(label, checked, onChange, key) {
    return h('label', { class: 'check' }, h('input', { attrs: { type: 'checkbox', 'data-field': key }, checked, on: { change: (e) => onChange(e.target.checked) } }), label);
  }
  function secretField(label, which) {
    const stored = draft.secretsStored[which];
    return textField(label, () => draft.secrets[which], (v) => { draft.secrets[which] = v; },
      { type: 'password', key: which, placeholder: stored ? T('ui.editDevice.secretKeep') : '' });
  }

  function protocolFields() {
    const p = draft.protocol;
    const s = draft.settings[p];
    const E = (k) => T(`ui.editDevice.${k}`);
    const rerenderOn = (fn) => (v) => { fn(v); renderEditor(); };
    const out = [];
    if (p === 'modbus') {
      out.push(h('div', { class: 'row2' },
        textField(E('host'), () => s.host, (v) => { s.host = v.trim(); }, { placeholder: E('hostPlaceholder'), mono: true, key: 'host' }),
        textField(E('port'), () => s.port, (v) => { s.port = v.trim(); }, { placeholder: '502', inputmode: 'numeric', mono: true, key: 'port' })));
      out.push(h('div', { class: 'row2' },
        selectField(E('firmware'), s.firmware, Object.entries(dict.ui.editDevice.firmwareOptions), (v) => { s.firmware = v; }, 'firmware'),
        textField(E('netId'), () => s.netId, (v) => { s.netId = v.trim(); }, { inputmode: 'numeric', hint: E('netIdHint'), key: 'netId' })));
    } else if (p === 'json') {
      out.push(h('div', { class: 'row2' },
        textField(E('host'), () => s.host, (v) => { s.host = v.trim(); }, { placeholder: E('hostPlaceholder'), mono: true, key: 'host' }),
        textField(E('port'), () => s.port, (v) => { s.port = v.trim(); }, { placeholder: s.https ? '443' : '80', inputmode: 'numeric', mono: true, key: 'port' })));
      out.push(checkField(E('https'), !!s.https, rerenderOn((v) => { s.https = v; }), 'https'));
      out.push(selectField(E('auth'), s.auth, Object.entries(dict.ui.editDevice.authOptions), rerenderOn((v) => { s.auth = v; }), 'auth'));
      if (s.auth === 'basic') {
        out.push(h('div', { class: 'row2' },
          textField(E('user'), () => s.user, (v) => { s.user = v.trim(); }, { key: 'user' }),
          secretField(E('password'), 'password')));
      }
      if (s.auth === 'bearer') out.push(secretField(E('apikey'), 'apikey'));
    } else {
      out.push(h('div', { class: 'row2' },
        textField(E('brokerHost'), () => s.host, (v) => { s.host = v.trim(); }, { placeholder: '192.168.1.173', mono: true, key: 'host' }),
        textField(E('port'), () => s.port, (v) => { s.port = v.trim(); }, { placeholder: s.tls ? '8883' : '1883', inputmode: 'numeric', mono: true, key: 'port' })));
      out.push(checkField(E('tls'), !!s.tls, rerenderOn((v) => { s.tls = v; }), 'tls'));
      if (s.tls) {
        out.push(h('div', { class: 'field' },
          h('div', { class: 'label', text: E('caFile') }),
          h('div', { class: 'inline' },
            h('span', { class: `small ${s.caFile ? 'mono' : 'muted'}`, text: s.caFile || E('caNone') }), ' ',
            h('button', { class: 'btn small', on: { click: async () => { const f = await window.e4.pickCaFile(); if (f) { s.caFile = f; renderEditor(); } } } }, E('caPick')),
            s.caFile ? h('button', { class: 'btn small link', on: { click: () => { s.caFile = ''; renderEditor(); } } }, T('ui.common.delete')) : null)));
      }
      out.push(h('div', { class: 'row2' },
        textField(E('user'), () => s.user, (v) => { s.user = v.trim(); }, { key: 'user' }),
        secretField(E('password'), 'password')));
      if (!s.ownTopics) out.push(textField(E('baseTopic'), () => s.baseTopic, (v) => { s.baseTopic = v.trim(); }, { mono: true, hint: E('baseTopicHint'), key: 'baseTopic' }));
      out.push(checkField(E('ownTopics'), !!s.ownTopics, rerenderOn((v) => { s.ownTopics = v; }), 'ownTopics'));
      if (s.ownTopics) {
        out.push(h('div', { class: 'row2' },
          ...['Data', 'Set', 'Request', 'Response'].map((k) => textField(E(`topic${k}`), () => s.topics[k.toLowerCase()],
            (v) => { s.topics[k.toLowerCase()] = v; }, { mono: true }))));
      }
    }
    return out;
  }

  function moreFields() {
    const p = draft.protocol;
    const s = draft.settings[p];
    const E = (k) => T(`ui.editDevice.${k}`);
    const fields = [h('div', { class: 'row2' },
      textField(E('timeout'), () => s.timeout, (v) => { s.timeout = v.trim(); }, { inputmode: 'numeric', hint: E('timeoutHint') }),
      p !== 'mqtt' ? textField(E('gap'), () => s.gap, (v) => { s.gap = v.trim(); }, { inputmode: 'numeric', hint: E('gapHint') }) : h('div'))];
    if (p === 'modbus') {
      fields.push(h('div', { class: 'row2' },
        textField(E('unitId'), () => s.unitId, (v) => { s.unitId = v.trim(); }, { inputmode: 'numeric', placeholder: '1' }),
        selectField(E('addressing'), s.addressing, Object.entries(dict.ui.editDevice.addressingOptions), (v) => { s.addressing = v; })));
    }
    if (p === 'json' && s.https) fields.push(checkField(E('verifyCert'), !!s.verifyCert, (v) => { s.verifyCert = v; }));
    if (p === 'mqtt' && s.tls && !s.caFile) fields.push(checkField(E('verifyCert'), !!s.verifyCert, (v) => { s.verifyCert = v; }));
    return h('details', { class: 'more' }, h('summary', { text: E('more') }), h('div', { class: 'form' }, fields));
  }

  function resultBox(r) {
    if (!r) return null;
    const kind = !r.ok ? 'err' : r.warn ? 'warn' : 'ok';
    return h('div', { class: `result ${kind}`, attrs: { 'data-test': 'result' } }, icon(kind), h('div', {},
      h('div', { text: r.text }),
      r.suggest && r.suggest.addressing ? h('button', { class: 'btn small', on: { click: () => {
        draft.settings.modbus.addressing = r.suggest.addressing; draft.result = null; renderEditor();
      } } }, T('ui.editDevice.adopt')) : null));
  }

  function renderEditor() {
    if (!draft) return;
    const E = (k) => T(`ui.editDevice.${k}`);
    const protoSeg = h('div', { class: 'seg', attrs: { role: 'group', 'aria-label': E('protocol') } },
      ...['modbus', 'json', 'mqtt'].map((p) => h('button', { class: draft.protocol === p ? 'on' : '', text: protocolName(p),
        attrs: { 'aria-pressed': String(draft.protocol === p), 'data-protocol': p },
        on: { click: () => { draft.protocol = p; draft.result = null; renderEditor(); } } })));
    const panel = h('div', { class: 'panel', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': draft.id ? E('titleEdit') : E('titleNew') } },
      h('div', { class: 'head' }, h('h2', { text: draft.id ? E('titleEdit') : E('titleNew') }),
        h('button', { class: 'iconbtn', attrs: { 'aria-label': T('ui.common.close') }, on: { click: closeModal } }, icon('close'))),
      h('div', { class: 'form' },
        textField(E('name'), () => draft.name, (v) => { draft.name = v; }, { placeholder: E('namePlaceholder'), key: 'name' }),
        h('div', { class: 'field' }, h('div', { class: 'label', text: E('protocol') }), protoSeg,
          h('div', { class: 'hint', text: E(`protocols.${draft.protocol}Hint`) })),
        ...protocolFields(),
        h('div', { class: 'row2' },
          textField(E('interval'), () => draft.intervalSec, (v) => { draft.intervalSec = v; }, { inputmode: 'decimal', hint: E('intervalHint'), key: 'interval' }),
          h('div', { class: 'field' }, h('div', { class: 'label', text: ' ' }), checkField(E('enabled'), draft.enabled, (v) => { draft.enabled = v; }))),
        moreFields(),
        resultBox(draft.result),
        draft.error ? h('div', { class: 'result err' }, icon('err'), h('div', { text: draft.error })) : null),
      h('div', { class: 'foot' },
        h('button', { class: 'btn', attrs: { disabled: draft.busy, 'data-test': 'test' }, on: { click: testDraft } }, draft.busy ? E('testing') : E('test')),
        h('div', { class: 'spacer' }),
        draft.id ? h('button', { class: 'btn danger', on: { click: deleteDraft } }, T('ui.common.delete')) : null,
        h('button', { class: 'btn', on: { click: closeModal } }, T('ui.common.cancel')),
        h('button', { class: 'btn primary', attrs: { 'data-test': 'save' }, on: { click: saveDraft } }, T('ui.common.save'))));
    const overlay = h('div', { class: 'overlay', on: { mousedown: (e) => { if (e.target === overlay) closeModal(); } } }, panel);
    const focusKey = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.field : null;
    setModal(overlay);
    const again = focusKey ? panel.querySelector(`[data-field="${focusKey}"]`) : panel.querySelector('input');
    if (again) again.focus();
  }

  async function testDraft() {
    draft.busy = true;
    draft.result = null;
    draft.error = null;
    renderEditor();
    try {
      draft.result = await window.e4.testConnection(draftDevice(), draftSecrets());
    } catch (err) {
      draft.result = { ok: false, text: err.message };
    }
    if (!draft) return;
    draft.busy = false;
    renderEditor();
  }

  async function saveDraft() {
    draft.error = null;
    try {
      const saved = await window.e4.saveDevice(draftDevice(), draftSecrets());
      closeModal();
      await refreshDevices();
      if (state.view === 'detail' && state.detail && state.detail.id === saved.id) await showDetail(saved.id);
      else render();
      toast(`${saved.name}: ${T('ui.common.saved')}`);
    } catch (err) {
      draft.error = err.message;
      renderEditor();
    }
  }

  async function deleteDraft() {
    if (!window.confirm(T('ui.editDevice.deleteConfirm', { name: draft.name }))) return;
    await window.e4.removeDevice(draft.id);
    closeModal();
    await showDevices();
  }

  // ------------------------------------------------------------------ Dialog: Variablen einlesen
  /** im Einlese-Fenster weitere Dateien dazunehmen (z. B. das ST-Programm nachträglich) */
  async function addImportFiles(files) {
    const more = await window.e4.pickImportFiles();
    if (!more) return;
    const uniq = (list) => [...new Set(list)];
    await previewFiles({
      itf: more.itf || files.itf || null,
      symbols: uniq([...(files.symbols || []), ...(more.symbols || [])]),
      st: uniq([...(files.st || []), ...(more.st || [])]),
      comments: uniq([...(files.comments || []), ...(more.comments || [])]),
    });
  }

  async function startImport() {
    const files = await window.e4.pickImportFiles();
    if (!files) return;
    await previewFiles(files);
  }

  async function previewFiles(files) {
    const d = state.detail;
    const netId = d.settings && Number.isInteger(d.settings.netId) ? d.settings.netId : null;
    let preview;
    try {
      preview = await window.e4.previewImport(files, netId, d.id);
    } catch (err) {
      toast(err.message);
      return;
    }
    renderImport(files, preview);
  }

  function renderImport(files, preview) {
    const I = (k, a) => T(`ui.importDlg.${k}`, a);
    const base = (f) => String(f).split(/[\\/]/).pop();
    const fileRows = [['itf', files.itf ? [files.itf] : []], ['symbols', files.symbols || []], ['st', files.st || []], ['comments', files.comments || []]]
      .filter(([, list]) => list.length)
      .map(([k, list]) => h('div', { class: 'small' }, h('span', { class: 'muted', text: `${I(k)}: ` }), h('span', { class: 'mono', text: list.map(base).join(', ') })));
    const rows = preview.variables.map((v) => h('tr', {},
      h('td', { text: v.label }),
      h('td', { class: 'mono small', text: v.name }),
      h('td', { class: 'mono small', text: `${v.operand}${v.operand === 'CLOCK' ? '.' : ''}${v.index}` }),
      h('td', { class: 'mono small muted', text: addressText(v) }),
      h('td', {}, v.role ? h('span', { class: `badge ${v.role}`, text: T(`ui.detail.roles.${v.role}`) }) : null),
      h('td', { class: 'small muted', text: noteOf(v) })));
    const panel = h('div', { class: 'panel', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': I('title') } },
      h('div', { class: 'head' }, h('h2', { text: I('title') }),
        h('button', { class: 'iconbtn', attrs: { 'aria-label': T('ui.common.close') }, on: { click: closeModal } }, icon('close'))),
      h('div', {}, ...fileRows),
      h('div', { class: 'result ok' }, icon('ok'), h('div', { text: I('count', { n: preview.variables.length }) })),
      preview.warnings.length ? h('div', {}, h('div', { class: 'small', text: I('hints') }),
        h('ul', { class: 'warnlist' }, preview.warnings.map((w) => h('li', { text: w })))) : null,
      h('div', { class: 'tablewrap' }, h('table', { class: 'list' },
        h('thead', {}, h('tr', {}, ...['colLabel', 'colName', 'colOperand', 'colAddress', 'colRole'].map((k) => h('th', { text: T(`ui.detail.${k}`) })), h('th', { text: '' }))),
        h('tbody', {}, rows))),
      h('div', { class: 'foot' },
        h('button', { class: 'btn', attrs: { 'data-test': 'add-files' }, on: { click: () => addImportFiles(files) } }, icon('plus'), I('addFiles')),
        h('div', { class: 'spacer' }),
        h('button', { class: 'btn', on: { click: closeModal } }, T('ui.common.cancel')),
        h('button', { class: 'btn primary', attrs: { 'data-test': 'apply-import' }, on: { click: async () => {
          const res = await window.e4.applyImport(state.detail.id, preview.variables);
          closeModal();
          await refreshDevices();
          await showDetail(state.detail.id);
          toast(I('applied', { added: res.added.length, removed: res.removed.length }));
          // direkt weiter zur Schnell-Zuordnung (Vorschläge prüfen bzw. bei FUP/KOP festlegen)
          if (options.quickAssign && state.detail.variables.some((v) => !ALWAYS_SHOWN.has(String(v.operand).toUpperCase()))) openAssign(state.detail);
        } } }, I('apply'))));
    const overlay = h('div', { class: 'overlay center', on: { mousedown: (e) => { if (e.target === overlay) closeModal(); } } }, panel);
    setModal(overlay);
  }

  // ------------------------------------------------------------------ Start
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.getElementById('modal').firstChild) closeModal();
    // Bedienmodus: Esc verlässt ihn (später mit Passwortschutz), F11 = Vollbild
    else if (e.key === 'Escape' && state.view === 'pages' && !WEB && !['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) exitOperate();
    // Funktionstasten F1–F12 (Leisten, Seite); F11 ohne eigene Belegung = Vollbild
    else if (state.view === 'pages' && state.keymap && state.keymap[e.key] && !document.getElementById('modal').firstChild) { e.preventDefault(); runFkey(state.keymap[e.key]); }
    else if (e.key === 'F11' && state.view === 'pages') { e.preventDefault(); toggleFullscreen(); }
  });

  (async function start() {
    applyTheme();
    if (WEB) { await startWeb(); return; }
    dict = (await window.e4.texts()).dict;
    document.title = T('ui.app.title');
    window.e4.onValues(onValues);
    window.e4.onDeviceState(onDeviceState);
    window.e4.onOnline(onOnline);
    window.e4.onSeen(onSeen);
    window.e4.onAlarms(onAlarms);
    window.e4.onAuth(onAuth);
    window.e4.onLang(onLang);
    try { state.langState = await window.e4.langState(); } catch (e) { state.langState = null; }
    if (state.langState && state.langState.program !== 'de') { dict = (await window.e4.texts(state.langState.program)).dict; document.documentElement.lang = state.langState.program; }
    // Fenster schließen ohne Einrichter-Rechte: erst anmelden
    window.e4.onNeedLogin(() => openLogin({ reason: AU('reasonQuit'), need: 'setup', then: () => window.e4.quitApp().catch((err) => toast(err.message)) }));
    try { state.auth = await window.e4.authState(); } catch (e) { state.auth = null; }
    try { state.alarms = await window.e4.alarmsActive(); } catch (e) { state.alarms = []; }
    state.online = await window.e4.isOnline();
    state.theme = await window.e4.getTheme();
    await refreshDevices();
    await showDemoBand();
    render();
    if (state.auth && state.auth.emergency) { state.view = 'emergency'; render(); return; } // Notfall-Zugang
    let start = {};
    try { start = await window.e4.getStartOptions(); } catch (e) { start = {}; }
    // noch keine Seite mit Inhalt (z. B. neues Projekt): nicht in den Bedienmodus, sondern zu den Geräten (Ralf 08.11.2026)
    let anyPage = true;
    try { anyPage = (await window.e4.listPages()).some((p) => (p.items || []).length); } catch (e) { anyPage = true; }
    if (state.demo === 'talwerk' && anyPage && !start.startOperate) {
      await showPages(); // Demo Talwerk: gleich die Bedienseiten zeigen, im Fenster
    } else if (start.startOperate && anyPage) {
      // Kiosk: gleich die Startseite im Vollbild
      await showPages();
      if (!state.fullscreen) await toggleFullscreen();
    } else if (authOn() && !isSetup()) {
      // ohne Anmeldung darf man nur bedienen: Bedienseiten im Fenster, aber gleich zur Anmeldung auffordern;
      // wer sich als Einrichter anmeldet, landet dort, wo er zuletzt gearbeitet hat
      await showPages();
      // „Ohne Anmeldung“ ist kein Abbruch: man bleibt mit der eingestellten Rolle auf den Bedienseiten
      openLogin({ reason: AU('reasonStart', { role: roleName((state.auth && state.auth.guestRole) || 'viewer') }), cancelText: AU('withoutLogin'),
        then: () => { if (isSetup()) backToSetup(); } });
    }
  })();
})();
