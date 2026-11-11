'use strict';
/**
 * Treiber je Protokoll erzeugen. settings.protocol: 'modbus', 'json', 'mqtt'.
 * Siehe driver.js für die gemeinsame Schnittstelle.
 */

const { t } = require('../i18n');

const PROTOCOLS = {
  modbus: () => require('./modbus/driver').ModbusDriver,
  json: () => require('./json/driver').JsonDriver,
  mqtt: () => require('./mqtt/driver').MqttDriver,
};

function createDriver(settings, secrets, opts) {
  const make = PROTOCOLS[settings && settings.protocol];
  if (!make) throw new Error(t('device.errors.unknownProtocol', { protocol: settings && settings.protocol }));
  const Cls = make();
  return new Cls(settings, secrets, opts);
}

module.exports = { createDriver, protocols: () => Object.keys(PROTOCOLS) };
