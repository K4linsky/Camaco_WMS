'use strict';
const net = require('net');
const { EventEmitter } = require('events');
const { encode, createParser } = require('./mqtt-packet');

// Minimalny klient MQTT (QoS 0) z automatycznym ponawianiem polaczenia.
class MqttClient extends EventEmitter {
  constructor({ host, port = 1883, clientId, username, password, will, subscriptions = [], keepalive = 30, reconnectMs = 3000 }) {
    super();
    Object.assign(this, { host, port, clientId, username, password, will, subscriptions, keepalive, reconnectMs });
    this.connected = false;
    this.stopped = false;
    this.sock = null;
  }

  start() { this.stopped = false; this._connect(); return this; }

  _connect() {
    const sock = net.connect(this.port, this.host);
    this.sock = sock;
    sock.setNoDelay(true);
    const parse = createParser((p) => this._onPacket(p), () => sock.destroy());
    sock.on('connect', () => {
      sock.write(encode.connect({ clientId: this.clientId, keepalive: this.keepalive, username: this.username, password: this.password, will: this.will }));
    });
    sock.on('data', parse);
    sock.on('error', (e) => { if (this.listenerCount('error')) this.emit('error', e); });
    sock.on('close', () => {
      if (this.sock !== sock) return;
      clearInterval(this.ping);
      const was = this.connected;
      this.connected = false;
      if (was) this.emit('offline');
      if (!this.stopped) this.timer = setTimeout(() => this._connect(), this.reconnectMs);
    });
  }

  _onPacket(p) {
    if (p.type === 'connack') {
      if (p.code !== 0) { this.emit('error', new Error('MQTT CONNACK ' + p.code)); return this.sock.destroy(); }
      this.connected = true;
      if (this.subscriptions.length) this.sock.write(encode.subscribe(1, this.subscriptions));
      this.ping = setInterval(() => this.sock.write(encode.pingreq()), (this.keepalive * 1000) / 2);
      this.emit('connect');
    } else if (p.type === 'publish') {
      this.emit('message', p.topic, p.payload.toString('utf8'));
    }
  }

  publish(topic, payload, retain = false) {
    if (this.connected) this.sock.write(encode.publish(topic, payload, retain));
  }

  // Zerwanie polaczenia bez DISCONNECT -> broker opublikuje LWT.
  kill() { if (this.sock) this.sock.destroy(); }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    clearInterval(this.ping);
    if (this.sock) {
      try { this.sock.write(encode.disconnect()); } catch (e) { /* ignoruj */ }
      this.sock.end();
    }
  }
}

module.exports = { MqttClient };
