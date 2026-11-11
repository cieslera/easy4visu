'use strict';
/**
 * Plausibilitätsprüfung beim Einlesen: passt die .itf-Datei zur eingestellten Firmware des Geräts?
 * easySoft schreibt je Firmware andere Register in die .itf (docs/ITF-FORMAT.md):
 *   FW 2.40+:      Merker ab 46001, IA/QA 32 Bit ab 42001 bzw. 40001
 *   FW 1.40–2.3x:  Merker ab 1001, IA/QA 32 Bit ab 6501 bzw. 6001
 * Eine .itf eines anderen Geräts (z. B. NT1 statt NT2) fällt so sofort auf.
 */

const { t } = require('../i18n');

/** Welche Firmware-Stufe zeigt die .itf? '240', '140' oder null (nicht erkennbar) */
function itfFirmware(variables) {
  let newer = false;
  let older = false;
  for (const v of variables || []) {
    const r = v.modbus && v.modbus.register;
    if (r === undefined) continue;
    if (r >= 40001) newer = true;
    else if ((r >= 1001 && r <= 1512) || (r >= 6001 && r <= 6596)) older = true;
  }
  if (newer && !older) return '240';
  if (older && !newer) return '140';
  return null;
}

/** Warnung (Text) oder null. firmware = Einstellung des Geräts ('240', '140', 'old') */
function firmwareWarning(variables, firmware) {
  const fromItf = itfFirmware(variables);
  if (!fromItf) return null;
  const dev = firmware === '140' || firmware === 'old' ? firmware : '240';
  const matches = fromItf === '240' ? dev === '240' : dev !== '240';
  if (matches) return null;
  return t('import.warn.fwMismatch', {
    itf: t(`ui.editDevice.firmwareOptions.${fromItf}`),
    dev: t(`ui.editDevice.firmwareOptions.${dev}`),
  });
}

module.exports = { itfFirmware, firmwareWarning };
