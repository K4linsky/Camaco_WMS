'use strict';
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const TOPIC_STATUS = /^storagewms\/([^/]+)\/status$/;
const TOPIC_SENSOR = /^storagewms\/([^/]+)\/sensor\/(\d+)\/state$/;

function fmtDuration(sec) {
  if (sec < 60) return sec + ' s';
  const m = Math.floor(sec / 60);
  if (m < 60) return m + ' min';
  return Math.floor(m / 60) + ' h ' + (m % 60) + ' min';
}

// Stan aplikacji: czujniki, urzadzenia, aktywne alerty i historia zdarzen.
class Store extends EventEmitter {
  constructor({ sensorNames = [], occupiedAlertSec = 3600, expectedDevices = 0, historyLimit = 500, historyFile = null, now = Date.now } = {}) {
    super();
    this.sensorNames = sensorNames;
    this.expectedDevices = expectedDevices > 0 ? expectedDevices : sensorNames.length;
    this.occupiedAlertSec = occupiedAlertSec;
    this.historyLimit = historyLimit;
    this.historyFile = historyFile;
    this.now = now;
    this.devices = new Map();
    this.sensors = new Map();
    this.alerts = new Map();
    this.events = [];
    this.nextId = 1;
    this.mqttConnected = false;
    this._load();
    // czujniki znane z firmware (urzadzenie 1, 3 czujniki) widoczne od razu jako "brak danych"
    sensorNames.forEach((_, i) => this._sensor('1', i + 1));
    this._device('1');
  }

  _load() {
    if (!this.historyFile) return;
    try {
      const lines = fs.readFileSync(this.historyFile, 'utf8').split('\n').filter(Boolean).slice(-this.historyLimit);
      for (const l of lines) {
        try { const e = JSON.parse(l); e.id = this.nextId++; this.events.push(e); } catch (x) { /* pomin uszkodzona linie */ }
      }
    } catch (e) { /* brak pliku */ }
  }

  _device(id) {
    if (!this.devices.has(id)) this.devices.set(id, { id, status: 'unknown', since: null });
    return this.devices.get(id);
  }

  _sensor(device, n) {
    this._device(device);
    const key = device + ':' + n;
    if (!this.sensors.has(key)) {
      this.sensors.set(key, { key, device, id: n, name: this.sensorNames[n - 1] || 'Czujnik ' + n, state: 'unknown', since: null, lastSeen: null });
    }
    return this.sensors.get(key);
  }

  _log(type, fields) {
    const e = { id: this.nextId++, ts: this.now(), type, ...fields };
    this.events.push(e);
    if (this.events.length > this.historyLimit) this.events.shift();
    if (this.historyFile) {
      try {
        fs.mkdirSync(path.dirname(this.historyFile), { recursive: true });
        const { id, ...rest } = e;
        fs.appendFileSync(this.historyFile, JSON.stringify(rest) + '\n');
      } catch (err) { /* historia w pamieci nadal dziala */ }
    }
    return e;
  }

  setMqttConnected(v) {
    if (this.mqttConnected === v) return;
    this.mqttConnected = v;
    this.emit('change');
  }

  handleMessage(topic, payload) {
    const value = String(payload).trim();
    let m = TOPIC_STATUS.exec(topic);
    if (m) {
      if (value !== 'online' && value !== 'offline') return false;
      const d = this._device(m[1]);
      if (d.status !== value) {
        d.status = value;
        d.since = this.now();
        this._log('device', { device: d.id, value, message: `Urządzenie ${d.id}: ${value === 'online' ? 'połączone' : 'rozłączone'}` });
      }
      this._evaluate();
      this.emit('change');
      return true;
    }
    m = TOPIC_SENSOR.exec(topic);
    if (m) {
      if (value !== 'detected' && value !== 'clear') return false;
      // czujniki spoza skonfigurowanej listy (np. stary retained sensor/4) ignorujemy
      if (this.sensorNames.length && Number(m[2]) > this.sensorNames.length) return false;
      const s = this._sensor(m[1], Number(m[2]));
      s.lastSeen = this.now();
      if (s.state !== value) {
        s.state = value;
        s.since = this.now();
        this._log('sensor', { device: s.device, sensor: s.id, value, message: `${s.name}: ${value === 'detected' ? 'pełne (wykryto obiekt)' : 'puste'}` });
      }
      this._evaluate();
      this.emit('change');
      return true;
    }
    return false;
  }

  _isOnline(sensor) {
    return this.devices.get(sensor.device).status === 'online';
  }

  // Wylicza aktywne alerty i loguje ich pojawienie sie / ustapienie.
  _evaluate() {
    const want = new Map();
    const t = this.now();
    for (const d of this.devices.values()) {
      if (d.status === 'offline') {
        want.set('offline:' + d.id, { type: 'device_offline', level: 'critical', device: d.id, since: d.since, message: `Urządzenie ${d.id} jest offline - brak odczytów z czujników` });
      }
    }
    for (const s of this.sensors.values()) {
      if (s.state === 'detected' && this._isOnline(s) && s.since && (t - s.since) / 1000 >= this.occupiedAlertSec) {
        want.set('occupied:' + s.key, {
          type: 'occupied_too_long', level: 'warning', device: s.device, sensor: s.id,
          since: s.since + this.occupiedAlertSec * 1000,
          message: `${s.name}: pełne dłużej niż ${fmtDuration(this.occupiedAlertSec)}`,
        });
      }
    }
    let changed = false;
    for (const [key, a] of want) {
      if (!this.alerts.has(key)) {
        this.alerts.set(key, { key, ...a });
        this._log('alert', { device: a.device, sensor: a.sensor, level: a.level, message: a.message });
        changed = true;
      }
    }
    for (const [key, a] of [...this.alerts]) {
      if (!want.has(key)) {
        this.alerts.delete(key);
        this._log('alert_clear', { device: a.device, sensor: a.sensor, message: 'Alert ustąpił: ' + a.message });
        changed = true;
      }
    }
    return changed;
  }

  tick() {
    if (this._evaluate()) this.emit('change');
  }

  history({ limit = 100, sensor, type } = {}) {
    let ev = this.events;
    if (sensor) ev = ev.filter((e) => `${e.device}:${e.sensor}` === sensor);
    if (type) ev = ev.filter((e) => e.type === type);
    return ev.slice(-limit).reverse();
  }

  snapshot() {
    return {
      now: this.now(),
      mqttConnected: this.mqttConnected,
      occupiedAlertSec: this.occupiedAlertSec,
      expectedDevices: Math.max(this.expectedDevices, this.sensors.size),
      devices: [...this.devices.values()],
      sensors: [...this.sensors.values()].map((s) => ({ ...s, online: this._isOnline(s) })),
      alerts: [...this.alerts.values()],
      events: this.history({ limit: 100 }),
    };
  }
}

module.exports = { Store, TOPIC_STATUS, TOPIC_SENSOR };
