'use strict';
/**
 * Symbole für Statusleuchten, Statustexte und Wertelisten (eigene Zeichnungen, MIT wie das Projekt).
 * Linien im Raster 24 × 24, Farbe = currentColor – so passen sie zu Hell/Dunkel und zur Farbe der Werteliste.
 * Neue Symbole: hier eintragen (Name nur a–z, 0–9, „-“) und den Namen in src/i18n/de.json unter ui.symbols ergänzen.
 */
(function () {
  const fan = (deg) => `<path transform="rotate(${deg} 12 12)" d="M12 10.3 C10.2 7 10.6 3.6 13.6 3.3 C15.8 4.6 15 8.3 12 10.3 Z"></path>`;
  const SYMBOLS = {
    pump: '<circle cx="12" cy="11" r="7.5"></circle><path d="M9.5 6.8 L17.6 11 L9.5 15.2 Z"></path><path d="M6 21 H18 M8 18.4 L7 21 M16 18.4 L17 21"></path>',
    fan: `<circle cx="12" cy="12" r="1.7"></circle>${fan(0)}${fan(120)}${fan(240)}<circle cx="12" cy="12" r="9.5" stroke-dasharray="2 3"></circle>`,
    motor: '<circle cx="12" cy="12" r="8.5"></circle><path d="M8.5 15.5 V8.5 L12 13 L15.5 8.5 V15.5"></path>',
    valve: '<path d="M3.5 8 L20.5 16 V8 L3.5 16 Z"></path><path d="M12 12 V5 M8.5 5 H15.5"></path>',
    heater: '<path d="M4 19 H20"></path><path d="M8 16 C6.6 13.5 9.4 11.5 8 9 C7.2 7.6 7.8 6 8.6 5 M12 16 C10.6 13.5 13.4 11.5 12 9 C11.2 7.6 11.8 6 12.6 5 M16 16 C14.6 13.5 17.4 11.5 16 9 C15.2 7.6 15.8 6 16.6 5"></path>',
    light: '<path d="M9 17.5 H15 M10 20.5 H14"></path><path d="M12 3 A6 6 0 0 0 8.2 13.6 C9 14.4 9.2 15.4 9.2 16 H14.8 C14.8 15.4 15 14.4 15.8 13.6 A6 6 0 0 0 12 3 Z"></path>',
    door: '<path d="M6 21 V3.5 H17 V21 M4 21 H19"></path><path d="M14 12.2 V12.3" stroke-width="2.6"></path>',
    bell: '<path d="M6 16.5 V11 A6 6 0 0 1 18 11 V16.5 L19.8 18.5 H4.2 Z"></path><path d="M10 21 H14"></path>',
    tank: '<rect x="6" y="3" width="12" height="18" rx="3"></rect><path d="M6 12.5 H18 M9 16 H15"></path>',
    temp: '<path d="M10 4.5 A2 2 0 0 1 14 4.5 V13.8 A4 4 0 1 1 10 13.8 Z"></path><path d="M12 9 V16.5"></path>',
    drop: '<path d="M12 3 C12 3 5.8 10 5.8 14.3 A6.2 6.2 0 0 0 18.2 14.3 C18.2 10 12 3 12 3 Z"></path>',
    flame: '<path d="M12 3 C14.2 7 18 9.2 18 14.2 A6 6 0 0 1 6 14.2 C6 11.4 7.6 9.4 9 7.6 C9.6 9.4 10.6 10.4 11.6 10.6 C12.2 8 12.4 5.6 12 3 Z"></path>',
    snow: '<path d="M12 3 V21 M4.2 7.5 L19.8 16.5 M4.2 16.5 L19.8 7.5"></path><path d="M9.5 4.5 L12 6.5 L14.5 4.5 M9.5 19.5 L12 17.5 L14.5 19.5"></path>',
    power: '<path d="M12 3 V11.5"></path><path d="M7.2 6.3 A7.5 7.5 0 1 0 16.8 6.3"></path>',
    gear: '<circle cx="12" cy="12" r="3.2"></circle><path d="M12 2.5 V5.5 M12 18.5 V21.5 M2.5 12 H5.5 M18.5 12 H21.5 M5.3 5.3 L7.4 7.4 M16.6 16.6 L18.7 18.7 M5.3 18.7 L7.4 16.6 M16.6 7.4 L18.7 5.3"></path><circle cx="12" cy="12" r="6.6"></circle>',
    clock: '<circle cx="12" cy="12" r="9"></circle><path d="M12 7 V12 L15.5 14"></path>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"></rect><path d="M8 11 V8 A4 4 0 0 1 16 8 V11"></path>',
    warning: '<path d="M12 3 L22 20 H2 Z"></path><path d="M12 10 V14 M12 17.4 V17.5" stroke-width="2.2"></path>',
    ok: '<circle cx="12" cy="12" r="9"></circle><path d="M7.5 12.3 L10.6 15.3 L16.5 9"></path>',
    stop: '<circle cx="12" cy="12" r="9"></circle><path d="M8.8 8.8 L15.2 15.2 M15.2 8.8 L8.8 15.2"></path>',
    conveyor: '<rect x="2.5" y="9" width="19" height="7" rx="3.5"></rect><circle cx="6.5" cy="12.5" r="1.4"></circle><circle cx="17.5" cy="12.5" r="1.4"></circle><path d="M8 6 H16"></path>',
    up: '<path d="M12 19.5 V4.5 M6 10.5 L12 4.5 L18 10.5"></path>',
    down: '<path d="M12 4.5 V19.5 M6 13.5 L12 19.5 L18 13.5"></path>',
  };
  window.E4_SYMBOLS = {
    names: Object.keys(SYMBOLS),
    has: (name) => Object.prototype.hasOwnProperty.call(SYMBOLS, name),
    /** SVG-Text (nur feste Zeichnungen aus dieser Datei, nie Eingaben) */
    svg: (name, size) => (Object.prototype.hasOwnProperty.call(SYMBOLS, name)
      ? `<svg width="${size || 24}" height="${size || 24}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SYMBOLS[name]}</svg>`
      : ''),
  };
})();
