'use strict';
const net = require('net');
const { encode, createParser, topicMatch } = require('./mqtt-packet');

// Wbudowany, minimalny broker MQTT 3.1.1: retained, LWT, wildcardy + i #, QoS 0/1 (dostarczanie QoS 0).
// Przeznaczony do sieci lokalnej magazynu - brak uwierzytelniania (patrz README).
function createBroker({ log = () => {} } = {}) {
  const sessions = new Set();
  const retained = new Map();

  function deliver(topic, payload, retain) {
    if (retain) {
      if (payload.length === 0) retained.delete(topic);
      else retained.set(topic, payload);
    }
    const pkt = encode.publish(topic, payload, false);
    for (const s of sessions) {
      if (s.subs.some((f) => topicMatch(f, topic))) s.sock.write(pkt);
    }
  }

  const server = net.createServer((sock) => {
    const s = { sock, subs: [], clientId: null, will: null, ready: false };
    sock.setNoDelay(true);
    const handshake = setTimeout(() => { if (!s.ready) sock.destroy(); }, 10000);

    const parse = createParser((p) => {
      if (!s.ready) {
        if (p.type !== 'connect' || p.proto !== 'MQTT' || p.level !== 4) { sock.write(encode.connack(1)); return sock.end(); }
        s.ready = true;
        clearTimeout(handshake);
        s.clientId = p.clientId;
        s.will = p.will;
        for (const o of sessions) if (o.clientId === p.clientId) { o.will = null; o.sock.destroy(); }
        sessions.add(s);
        if (p.keepalive > 0) sock.setTimeout(p.keepalive * 1500, () => sock.destroy());
        sock.write(encode.connack(0));
        log('klient MQTT polaczony: ' + p.clientId);
        return;
      }
      switch (p.type) {
        case 'publish':
          if (p.qos === 1) sock.write(encode.puback(p.id));
          deliver(p.topic, p.payload, p.retain);
          break;
        case 'subscribe':
          s.subs.push(...p.topics);
          sock.write(encode.suback(p.id, p.topics.length));
          for (const [t, pl] of retained) {
            if (p.topics.some((f) => topicMatch(f, t))) sock.write(encode.publish(t, pl, true));
          }
          break;
        case 'pingreq': sock.write(encode.pingresp()); break;
        case 'disconnect': s.will = null; sock.end(); break;
        default: break;
      }
    }, () => sock.destroy());

    sock.on('data', parse);
    sock.on('error', () => {});
    sock.on('close', () => {
      clearTimeout(handshake);
      if (!s.ready) return;
      sessions.delete(s);
      log('klient MQTT rozlaczony: ' + s.clientId);
      if (s.will) deliver(s.will.topic, s.will.payload, s.will.retain);
    });
  });

  return {
    server,
    listen: (port, host) => new Promise((res, rej) => { server.once('error', rej); server.listen(port, host, res); }),
    close: () => { for (const s of sessions) s.sock.destroy(); server.close(); },
  };
}

module.exports = { createBroker };
