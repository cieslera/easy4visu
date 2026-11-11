'use strict';
/**
 * window.e4 im Browser (Handy/Tablet): dieselben Funktionen wie app/preload.js im Programmfenster, nur über das Netzwerk.
 * Aufrufe gehen als POST /api/<Name> an den eingebauten Webserver (src/web/server.js), Meldungen kommen als
 * Datenstrom /api/events. Bleibt der Datenstrom stumm (WLAN weg), meldet onConn(false) – die Oberfläche sperrt dann.
 */
(function () {
  const handlers = {};
  const emit = (type, data) => (handlers[type] || []).forEach((cb) => { try { cb(data); } catch (e) { /* weiter mit den anderen */ } });
  const on = (type) => (cb) => { (handlers[type] = handlers[type] || []).push(cb); };
  const netText = () => (document.documentElement.lang === 'de' ? 'Keine Verbindung zur Visu' : 'No connection to the visualisation');

  let source = null;
  let lastMsg = 0;
  let connected = null;
  const setConn = (ok) => { if (connected !== ok) { connected = ok; emit('conn', ok); } };

  async function call(name, ...args) {
    let r;
    try {
      r = await fetch(`/api/${name}`, { method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'content-type': 'application/json', 'x-e4': '1' }, body: JSON.stringify({ args }) });
    } catch (e) {
      setConn(false);
      throw Object.assign(new Error(netText()), { code: 'net' });
    }
    if (r.status === 401) {
      // Sitzung abgelaufen (z. B. nach Zeit ohne Bedienung oder Neustart am PC): zurück zur Anmeldung
      closeEvents();
      emit('auth', { active: true, user: null, role: null, web: true, expired: true });
      throw Object.assign(new Error(netText()), { code: 'login' });
    }
    const j = await r.json();
    if (!j.ok) throw Object.assign(new Error(j.error), { code: j.code });
    return j.result;
  }

  function closeEvents() {
    if (source) source.close();
    source = null;
  }

  function openEvents() {
    closeEvents();
    lastMsg = Date.now();
    const es = new EventSource('/api/events');
    source = es;
    const any = () => { lastMsg = Date.now(); };
    es.addEventListener('hello', () => { any(); setConn(true); });
    es.addEventListener('ping', any);
    for (const type of ['values', 'deviceState', 'online', 'seen', 'alarms', 'auth', 'lang']) {
      es.addEventListener(type, (ev) => { any(); setConn(true); let d = null; try { d = JSON.parse(ev.data); } catch (e) { return; } emit(type, d); });
    }
    es.onerror = () => {
      if (source !== es) return;
      setConn(false);
      // Sitzung weg (Server antwortet 401) → EventSource gibt auf; prüfen, ob noch angemeldet
      if (es.readyState === EventSource.CLOSED) {
        setTimeout(async () => {
          if (source !== es) return;
          try { const a = await call('authState'); if (a && a.user) openEvents(); else { closeEvents(); emit('auth', Object.assign({}, a, { expired: true })); } } catch (e) { setTimeout(() => { if (source === es) openEvents(); }, 3000); }
        }, 2000);
      }
    };
  }

  // stummer Datenstrom (alle 15 s kommt ein Lebenszeichen): neu aufbauen
  setInterval(() => {
    if (source && Date.now() - lastMsg > 40000) { setConn(false); openEvents(); }
  }, 5000);
  // Handy weckt den Browser auf: gleich nachsehen, statt auf das nächste Lebenszeichen zu warten
  document.addEventListener('visibilitychange', () => { if (!document.hidden && source && Date.now() - lastMsg > 20000) openEvents(); });

  const fn = (name) => (...args) => call(name, ...args);
  const unavailable = () => Promise.reject(new Error('–'));

  window.e4 = {
    web: true,
    texts: fn('texts'),
    authState: fn('authState'),
    async login(name, secret) {
      const r = await call('login', name, secret);
      if (r && r.ok) openEvents();
      return r;
    },
    async logout(reason) {
      try { await call('logout', reason); } finally {
        closeEvents();
        emit('auth', { active: true, user: null, role: null, web: true, expired: reason === 'timeout' });
      }
      return true;
    },
    /** nach dem Laden: angemeldet? dann gleich den Datenstrom öffnen */
    async resume() {
      const a = await call('authState');
      if (a && a.user) openEvents();
      return a;
    },
    langState: fn('langState'),
    setLanguage: fn('setLanguage'),
    getTheme: fn('getTheme'),
    listDevices: fn('listDevices'),
    deviceValues: fn('deviceValues'),
    writeValue: fn('writeValue'),
    listPages: fn('listPages'),
    getBars: fn('getBars'),
    viewPage: fn('viewPage'),
    devicePage: fn('devicePage'),
    alarmsActive: fn('alarmsActive'),
    alarmsHistory: fn('alarmsHistory'),
    ackAlarm: fn('ackAlarm'),
    historyQuery: fn('historyQuery'),
    isOnline: fn('isOnline'),
    getStartOptions: () => Promise.resolve({}),
    exitOperate: unavailable,
    setOnline: unavailable,
    quitApp: unavailable,
    /** Vollbild über den Browser (geht nicht auf jedem Handy, z. B. nicht auf dem iPhone) */
    async toggleFullscreen() {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
      } catch (e) { /* nicht erlaubt */ }
      return !!document.fullscreenElement;
    },
    onValues: on('values'),
    onDeviceState: on('deviceState'),
    onDeviceError: on('deviceError'),
    onOnline: on('online'),
    onSeen: on('seen'),
    onAlarms: on('alarms'),
    onAuth: on('auth'),
    onLang: on('lang'),
    onConn: on('conn'),
    onNeedLogin: () => {},
  };
})();
