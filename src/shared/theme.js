'use strict';
/**
 * Farbthema der Bedienseiten (Stufe 3, Teil 4) – gemeinsam für Programm (require) und Fenster (<script>, window.E4_THEME).
 *
 * Thema: { light: Rollen, dark: Rollen, radius: 'square' | 'soft' | 'round', font: 'plex' | 'inter' | 'atkinson' | 'leitstand',
 *          size: 'normal' | 'large', depth: 'flat' | 'soft' (Taster/Rahmen mit leichter Tiefe), logo: 'data:image/…' | null }
 * Rollen: { accent, bg, surface, text, on, off, warn, alarm, control? } als #RRGGBB. control = Bedienelemente (Taster,
 * Schalter-Knöpfe, Betriebsart, Funktionstasten, Plus/Minus); fehlt sie, sehen sie aus wie bisher (Fläche). Alles Weitere (Rahmen, blasse Flächen,
 * Schrift auf Akzent …) wird daraus berechnet (vars). Lesbarkeit nach WCAG: Kontrast ≥ 4,5 gut, ≥ 3 knapp.
 */
(function (root) {
  const ROLES = ['accent', 'bg', 'surface', 'text', 'on', 'off', 'warn', 'alarm'];
  const OPTIONAL = ['control']; // darf fehlen: dann wie bisher
  const RADIUS = { square: 4, soft: 14, round: 22 };
  const FONTS = {
    plex: "'IBM Plex Sans', 'Segoe UI', sans-serif",
    inter: "'Inter', 'Segoe UI', sans-serif",
    atkinson: "'Atkinson Hyperlegible', 'Segoe UI', sans-serif",
    leitstand: "'IBM Plex Sans', 'Segoe UI', sans-serif",
  };
  // Schrift für Überschriften und große Werte; ohne Eintrag dieselbe wie der Text
  const DISPLAY = { leitstand: "'Space Grotesk', 'IBM Plex Sans', 'Segoe UI', sans-serif" };
  const MAX_LOGO = 1024 * 1024 * 1.4; // Bild bis 1 MB (als data:-Text etwa 1,37 MB)

  // ---------------------------------------------------------------- Farbrechnung
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const isHex = (s) => /^#[0-9a-f]{6}$/i.test(String(s || ''));
  function rgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const hex = (r, g, b) => `#${[r, g, b].map((x) => clamp(Math.round(x), 0, 255).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
  function hsl(hx) {
    const [r, g, b] = rgb(hx).map((x) => x / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h * 60, s, l];
  }
  function fromHsl(h, s, l) {
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
    return hex(f(0) * 255, f(8) * 255, f(4) * 255);
  }
  /** a und b mischen: t = Anteil von b (0…1) */
  function mix(a, b, t) {
    const x = rgb(a);
    const y = rgb(b);
    return hex(x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t);
  }
  function luminance(hx) {
    const c = rgb(hx).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  /** Kontrast nach WCAG (1 … 21) */
  function contrast(a, b) {
    const x = luminance(a);
    const y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }
  /** Farbton behalten, Helligkeit ändern, bis der Kontrast zu bg reicht (Vorschlag „besser lesbar“) */
  function fix(color, bg, min) {
    if (contrast(color, bg) >= min) return color.toUpperCase();
    const [h, s, l] = hsl(color);
    const darker = luminance(bg) > 0.18;
    for (let i = 1; i <= 100; i++) {
      const c = fromHsl(h, s, clamp(darker ? l - i / 100 : l + i / 100, 0, 1));
      if (contrast(c, bg) >= min) return c;
    }
    return darker ? '#000000' : '#FFFFFF';
  }
  // Schrift auf Bedienelementen: die Textfarbe des Designs, wenn gut lesbar – sonst Weiß oder Fast-Schwarz (Ralf 07.11.2026)
  const onControl = (c, text) => {
    if (contrast(text, c) >= 4.5) return text;
    const best = contrast('#FFFFFF', c) >= contrast('#0D1217', c) ? '#FFFFFF' : '#0D1217';
    return contrast(best, c) > contrast(text, c) ? best : text;
  };
  const readableOn = (bg) => (contrast('#FFFFFF', bg) >= contrast('#0D1217', bg) ? '#FFFFFF' : '#0D1217');

  // ---------------------------------------------------------------- Vorlagen
  const SEMANTIC = {
    light: { on: '#1E7F4F', off: '#6B7480', warn: '#965700', alarm: '#B42318' },
    dark: { on: '#45C486', off: '#7D8894', warn: '#F0B44C', alarm: '#F27C70' },
  };
  const preset = (light, dark) => ({ light: Object.assign({}, SEMANTIC.light, light), dark: Object.assign({}, SEMANTIC.dark, dark) });
  const PRESETS = {
    blue: preset({ accent: '#1D5FD1', bg: '#EEF1F4', surface: '#FFFFFF', text: '#17202A' },
      { accent: '#6EA4F7', bg: '#0D1217', surface: '#151C23', text: '#E6EDF3' }),
    green: preset({ accent: '#17734A', bg: '#EDF3EF', surface: '#FFFFFF', text: '#14221B', on: '#1D6FB8' },
      { accent: '#4CC38A', bg: '#0C1410', surface: '#131D18', text: '#E4EFE8', on: '#6EB6F7' }),
    anthracite: preset({ accent: '#2F3A46', bg: '#ECEEF0', surface: '#FFFFFF', text: '#1A1F24' },
      { accent: '#C9D2DB', bg: '#111417', surface: '#1A1E22', text: '#E8ECEF' }),
    // Leitstand (Entwurf 29.10.2026): dunkler Grund, Grün für Akzent und „läuft“, eigene Schrift für Werte
    leitstand: Object.assign(preset({ accent: '#0B7A5C', bg: '#EEF2F5', surface: '#FFFFFF', text: '#0B0F14', on: '#0B7A5C', control: '#E8EDF2' },
      { accent: '#2DD4A0', bg: '#0B0F14', surface: '#121820', text: '#E7EDF3', on: '#2DD4A0', off: '#93A1B0', warn: '#F7B32B', alarm: '#FF6B6B', control: '#26313D' }),
    { font: 'leitstand', radius: 'soft' }),
    orange: preset({ accent: '#B54708', bg: '#F4F1EE', surface: '#FFFFFF', text: '#231A14' },
      { accent: '#F79A4C', bg: '#14100D', surface: '#1E1813', text: '#F2EAE3' }),
    contrast: {
      light: { accent: '#0033A0', bg: '#FFFFFF', surface: '#FFFFFF', text: '#000000', on: '#00602F', off: '#3D3D3D', warn: '#7A4100', alarm: '#A30000' },
      dark: { accent: '#7FB2FF', bg: '#000000', surface: '#000000', text: '#FFFFFF', on: '#5CE69A', off: '#BFBFBF', warn: '#FFC94D', alarm: '#FF8A80' },
    },
  };
  const DEFAULT = Object.assign({ radius: 'soft', font: 'plex', size: 'normal', depth: 'flat', logo: null }, JSON.parse(JSON.stringify(PRESETS.blue)));

  /** Thema aus einer Farbe ableiten (z. B. Firmenfarbe): Akzent lesbar machen, Flächen leicht getönt, Zustandsfarben bleiben */
  function derive(base) {
    const [h, s] = hsl(base);
    const sat = Math.min(s, 0.9);
    const light = Object.assign({}, SEMANTIC.light, {
      bg: fromHsl(h, Math.min(sat, 0.25), 0.95), surface: '#FFFFFF', text: fromHsl(h, Math.min(sat, 0.3), 0.12),
    });
    light.accent = fix(base, light.surface, 4.5);
    const dark = Object.assign({}, SEMANTIC.dark, {
      bg: fromHsl(h, Math.min(sat, 0.3), 0.07), surface: fromHsl(h, Math.min(sat, 0.25), 0.11), text: fromHsl(h, Math.min(sat, 0.2), 0.92),
    });
    dark.accent = fix(fromHsl(h, sat, Math.max(hsl(base)[2], 0.6)), dark.surface, 4.5);
    // getönte Flächen können Zustandsfarben knapp unlesbar machen: Helligkeit nachziehen, Farbton bleibt
    for (const r of [light, dark]) for (const k of ['on', 'off', 'warn', 'alarm']) r[k] = fix(r[k], r.surface, 4.5);
    return { light, dark };
  }

  // ---------------------------------------------------------------- Prüfen und anwenden
  /** Lesbarkeit: welche Farbe auf welchem Grund, Kontrast, Stufe 'ok' | 'low' | 'bad', Vorschlag */
  function check(roles) {
    const pairs = [
      ['text', 'bg'], ['text', 'surface'], ['accent', 'surface'], ['on', 'surface'], ['off', 'surface'], ['warn', 'surface'], ['alarm', 'surface'],
    ].concat(isHex(roles.control) ? [['control', 'surface', 'text']] : []);
    return pairs.map(([fg, bg, txt]) => {
      // Bedienelemente: Lesbarkeit der Schrift auf dem Knopf (nicht Knopf auf Fläche)
      if (txt) {
        const r2 = contrast(onControl(roles[fg], roles[txt]), roles[fg]); // Schrift passt sich an (onControl)
        const lv = r2 >= 4.5 ? 'ok' : r2 >= 3 ? 'low' : 'bad';
        return { role: fg, on: txt, ratio: Math.round(r2 * 10) / 10, level: lv, suggest: lv === 'ok' ? null : fix(roles[fg], roles[txt], 4.5) };
      }
      const ratio = contrast(roles[fg], roles[bg]);
      const level = ratio >= 4.5 ? 'ok' : ratio >= 3 ? 'low' : 'bad';
      return { role: fg, on: bg, ratio: Math.round(ratio * 10) / 10, level, suggest: level === 'ok' ? null : fix(roles[fg], roles[bg], 4.5) };
    });
  }

  /** alle CSS-Variablen für eine Ansicht (hell oder dunkel) */
  function vars(theme, mode) {
    const r = theme[mode === 'dark' ? 'dark' : 'light'];
    const dark = mode === 'dark';
    return {
      '--bg': r.bg, '--surface': r.surface, '--text': r.text,
      '--surface2': mix(r.surface, r.text, dark ? 0.06 : 0.035),
      '--border': mix(r.surface, r.text, dark ? 0.16 : 0.14),
      '--border-strong': mix(r.surface, r.text, dark ? 0.26 : 0.27),
      '--muted': mix(r.text, r.surface, 0.36),
      '--accent': r.accent, '--accent-hover': mix(r.accent, dark ? '#FFFFFF' : '#000000', 0.15),
      '--accent-soft': mix(r.surface, r.accent, dark ? 0.2 : 0.11), '--on-accent': readableOn(r.accent),
      '--on': r.on, '--on-soft': mix(r.surface, r.on, dark ? 0.2 : 0.12), '--off': r.off,
      '--warn': r.warn, '--warn-soft': mix(r.surface, r.warn, dark ? 0.2 : 0.12),
      '--alarm': r.alarm, '--alarm-soft': mix(r.surface, r.alarm, dark ? 0.2 : 0.11),
      '--radius': `${RADIUS[theme.radius] || RADIUS.soft}px`,
      '--font': FONTS[theme.font] || FONTS.plex,
      '--font-display': DISPLAY[theme.font] || FONTS[theme.font] || FONTS.plex,
      '--font-num': FONTS[theme.font] || FONTS.plex, // Werte: zarte Textschrift, Ziffern gleich breit (tabular-nums)
      // Bedienelemente: nur mit eigener Farbe gesetzt (sonst gelten in styles.css die bisherigen Flächen)
      ...(isHex(r.control) ? { '--control': r.control, '--control-border': mix(r.control, r.text, dark ? 0.2 : 0.18), '--on-control': onControl(r.control, r.text) } : {}),
      // Tiefe „leicht“: Bedienelemente stehen etwas hervor und sinken beim Drücken ein, Rahmen mit weichem Schatten
      ...depthVars(theme.depth, dark, r),
    };
  }

  /** Tiefe „leicht“ für Zeigerinstrument (Skala in einer Rille, Bereich des Zeigers leuchtet, spitzer Zeiger mit
   *  Schatten, glänzender Knopf) und Bargraph (eingelassenes Rohr, Füllung mit Glanz und heller Füllstandskante) */
  function gaugeBarVars(dark) {
    return {
      // Entwurf 3 (Ralf 08.11.2026): Farbband überall gleich breit, eingelassen (grauer Innenschatten, nicht farbig),
      // spitzer Zeiger bis ins Band mit leichtem grauem Schatten, kleiner gefüllter Kreis in der Mitte
      '--g-track': dark ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.08)', '--g-track-w': '12px', '--g-cap': 'butt',
      '--g-zone-w': '12px', '--g-zone-on-w': '12px', '--g-dim': '1', '--g-on': '1', '--g-glow': 'none',
      '--g-band': 'url(#e4gin)', '--g-in-op': dark ? '0.8' : '0.35',
      // Zeiger und Kreis in der Schriftfarbe (dunkel weiß, hell schwarz); Wert unten mittig, Einheit darunter,
      // Zahlen an der Skala ohne Einheit (Ralf 08.11.2026)
      '--g-hub-r': '5px', '--g-hub-ring': 'none', '--g-hub-fill': 'var(--text)', '--g-needle': 'var(--text)', '--g-scale-c': 'var(--text)', '--g-hl': 'none',
      '--g-val-bottom': '2%', '--g-val-size': '30px', '--g-val-dir': 'column', '--g-val-align': 'center', '--g-scale-unit': 'none', '--g-line': 'none', '--g-poly': 'inline', '--g-svgval': 'inline', '--g-htmlval': 'none', '--g-plain': 'inline',
      '--g-shadow': `drop-shadow(1px 2px 1.5px rgba(0,0,0,${dark ? 0.7 : 0.3}))`,
      '--bar-in': dark ? 'inset 0 2px 6px rgba(0,0,0,0.75), inset 0 0 0 1px rgba(255,255,255,0.04)' : 'inset 0 2px 4px rgba(15,23,42,0.18)',
      '--bar-gloss-h': 'linear-gradient(180deg, rgba(255,255,255,0.30), rgba(255,255,255,0) 55%, rgba(0,0,0,0.14))',
      '--bar-gloss-v': 'linear-gradient(90deg, rgba(0,0,0,0.16), rgba(255,255,255,0.30) 45%, rgba(0,0,0,0.10))',
      '--bar-edge-h': 'inset -2px 0 0 rgba(255,255,255,0.55)', '--bar-edge-v': 'inset 0 2px 0 rgba(255,255,255,0.55)',
      // Trend: etwas kräftigere Linien, ruhiges gestricheltes Gitter, Punkt am Kurvenende
      '--t-line-w': '2px', '--t-grid-dash': '2 5', '--t-grid-op': '0.7', '--t-dot': 'inline', '--t-area': 'inline',
    };
  }

  function depthVars(depth, dark, r) {
    if (depth !== 'soft') return { '--ctl-image': 'none', '--ctl-shadow': 'none', '--ctl-press': 'none', '--ctl-shift': '0px', '--ctl-scale': '0.97', '--frame-shadow': 'none', '--ctl-room': '0px', '--ctl-side': '0px', '--ctl-lit': 'initial', '--ctl-lit-image': 'none', '--ctl-sel': 'none',
      // Zeigerinstrument und Bargraph: „initial“ = in styles.css gilt die bisherige Darstellung
      '--g-track': 'initial', '--g-track-w': 'initial', '--g-dim': 'initial', '--g-on': 'initial', '--g-glow': 'initial', '--g-line': 'initial', '--g-poly': 'initial', '--g-shadow': 'initial', '--bar-in': 'initial', '--bar-gloss-h': 'initial', '--bar-gloss-v': 'initial', '--bar-edge-h': 'initial', '--bar-edge-v': 'initial', '--t-line-w': 'initial', '--t-grid-dash': 'initial', '--t-grid-op': 'initial', '--t-dot': 'initial', '--t-area': 'initial',
      '--g-cap': 'initial', '--g-zone-w': 'initial', '--g-zone-on-w': 'initial', '--g-hub-r': 'initial', '--g-hub-ring': 'initial', '--g-hub-fill': 'initial', '--g-val-bottom': 'initial', '--g-val-size': 'initial', '--g-band': 'initial', '--g-in-op': 'initial', '--g-hl': 'initial', '--g-needle': 'initial', '--g-scale-c': 'initial', '--g-val-dir': 'initial', '--g-val-align': 'initial', '--g-scale-unit': 'initial', '--g-svgval': 'initial', '--g-htmlval': 'initial', '--g-plain': 'initial' }; // initial = Leuchtring wie bisher
    return dark ? {
      '--ctl-image': 'linear-gradient(rgba(255,255,255,0.08), rgba(255,255,255,0) 55%, rgba(0,0,0,0.14))',
      '--ctl-shadow': 'inset 0 1px 0 rgba(255,255,255,0.10), 0 2px 0 rgba(0,0,0,0.6), 0 3px 7px rgba(0,0,0,0.5)',
      '--ctl-press': 'inset 0 2px 5px rgba(0,0,0,0.6)', '--ctl-shift': '2px', '--ctl-scale': '1', '--ctl-room': '7px', '--ctl-side': '3px',
      '--ctl-lit': 'inset 0 1px 0 rgba(255,255,255,0.25), 0 2px 0 rgba(0,0,0,0.6), 0 3px 8px rgba(0,0,0,0.5)',
      '--ctl-lit-image': 'linear-gradient(rgba(255,255,255,0.12), rgba(255,255,255,0) 55%, rgba(0,0,0,0.12))',
      '--ctl-sel': 'inset 0 2px 6px rgba(0,0,0,0.55), inset 0 0 0 1px rgba(0,0,0,0.25)', // gewählt: eingedrückt
      ...gaugeBarVars(true),
      '--frame-shadow': 'inset 0 1px 0 rgba(255,255,255,0.06), 0 8px 22px rgba(0,0,0,0.55)',
    } : {
      '--ctl-image': 'linear-gradient(rgba(255,255,255,0.55), rgba(255,255,255,0) 55%, rgba(0,0,0,0.06))',
      '--ctl-shadow': `inset 0 1px 0 rgba(255,255,255,0.8), 0 2px 0 ${mix(r.control || r.surface, r.text, 0.28)}, 0 3px 6px rgba(15,23,42,0.14)`,
      '--ctl-press': 'inset 0 2px 4px rgba(15,23,42,0.22)', '--ctl-shift': '2px', '--ctl-scale': '1', '--ctl-room': '7px', '--ctl-side': '3px',
      '--ctl-lit': 'inset 0 1px 0 rgba(255,255,255,0.35), 0 2px 0 rgba(0,0,0,0.28), 0 3px 8px rgba(15,23,42,0.22)',
      '--ctl-lit-image': 'linear-gradient(rgba(255,255,255,0.18), rgba(255,255,255,0) 55%, rgba(0,0,0,0.08))',
      '--ctl-sel': 'inset 0 2px 5px rgba(0,0,0,0.38), inset 0 0 0 1px rgba(0,0,0,0.12)', // gewählt: eingedrückt
      ...gaugeBarVars(false),
      '--frame-shadow': '0 1px 2px rgba(15,23,42,0.06), 0 6px 16px rgba(15,23,42,0.10)',
    };
  }

  /** Thema prüfen: unbekannte Felder weg, ungültige Farben aus dem Standard */
  function clean(t) {
    t = t && typeof t === 'object' ? t : {};
    const out = { radius: RADIUS[t.radius] ? t.radius : 'soft', font: FONTS[t.font] ? t.font : 'plex', size: t.size === 'large' ? 'large' : 'normal', depth: t.depth === 'soft' ? 'soft' : 'flat', logo: null };
    for (const mode of ['light', 'dark']) {
      out[mode] = {};
      for (const role of ROLES) out[mode][role] = isHex(t[mode] && t[mode][role]) ? t[mode][role].toUpperCase() : DEFAULT[mode][role];
      for (const role of OPTIONAL) if (isHex(t[mode] && t[mode][role])) out[mode][role] = t[mode][role].toUpperCase();
    }
    if (typeof t.logo === 'string' && t.logo.length <= MAX_LOGO && /^data:image\/(png|jpeg|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(t.logo)) out.logo = t.logo;
    return out;
  }

  const api = { ROLES, OPTIONAL, RADIUS, FONTS, DISPLAY, PRESETS, DEFAULT, MAX_LOGO, contrast, mix, fix, derive, check, vars, clean, isHex, onControl };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.E4_THEME = api;
})(typeof window !== 'undefined' ? window : globalThis);
