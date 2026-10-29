'use strict';
// Minimalny koder/dekoder pakietow MQTT 3.1.1 (wystarczajacy dla ESP32 + PubSubClient).
const T = { CONNECT: 1, CONNACK: 2, PUBLISH: 3, PUBACK: 4, SUBSCRIBE: 8, SUBACK: 9, PINGREQ: 12, PINGRESP: 13, DISCONNECT: 14 };

function encLen(n) {
  const out = [];
  do {
    let d = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) d |= 128;
    out.push(d);
  } while (n > 0);
  return Buffer.from(out);
}
function bin(b) {
  const l = Buffer.alloc(2);
  l.writeUInt16BE(b.length);
  return Buffer.concat([l, b]);
}
const str = (s) => bin(Buffer.from(s, 'utf8'));
const packet = (first, body) => Buffer.concat([Buffer.from([first]), encLen(body.length), body]);
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };

const encode = {
  connect({ clientId, keepalive = 30, username, password, will }) {
    let flags = 0x02; // clean session
    const parts = [str('MQTT'), Buffer.from([4])];
    if (will) flags |= 0x04 | (will.retain ? 0x20 : 0);
    if (username) flags |= 0x80;
    if (username && password) flags |= 0x40;
    parts.push(Buffer.from([flags]), u16(keepalive), str(clientId));
    if (will) parts.push(str(will.topic), bin(Buffer.from(will.payload)));
    if (username) parts.push(str(username));
    if (username && password) parts.push(str(password));
    return packet(T.CONNECT << 4, Buffer.concat(parts));
  },
  connack: (code = 0) => packet(T.CONNACK << 4, Buffer.from([0, code])),
  publish(topic, payload, retain = false) {
    return packet((T.PUBLISH << 4) | (retain ? 1 : 0), Buffer.concat([str(topic), Buffer.from(payload)]));
  },
  puback: (id) => packet(T.PUBACK << 4, u16(id)),
  subscribe: (id, topics) =>
    packet((T.SUBSCRIBE << 4) | 2, Buffer.concat([u16(id), ...topics.flatMap((t) => [str(t), Buffer.from([0])])])),
  suback: (id, count) => packet(T.SUBACK << 4, Buffer.concat([u16(id), Buffer.alloc(count, 0)])),
  pingreq: () => Buffer.from([T.PINGREQ << 4, 0]),
  pingresp: () => Buffer.from([T.PINGRESP << 4, 0]),
  disconnect: () => Buffer.from([T.DISCONNECT << 4, 0]),
};

class Reader {
  constructor(buf) { this.buf = buf; this.o = 0; }
  u8() { if (this.o + 1 > this.buf.length) throw new Error('short'); return this.buf[this.o++]; }
  u16() { if (this.o + 2 > this.buf.length) throw new Error('short'); const v = this.buf.readUInt16BE(this.o); this.o += 2; return v; }
  bin() { const n = this.u16(); if (this.o + n > this.buf.length) throw new Error('short'); const b = this.buf.subarray(this.o, this.o + n); this.o += n; return b; }
  str() { return this.bin().toString('utf8'); }
  rest() { const b = this.buf.subarray(this.o); this.o = this.buf.length; return b; }
  get more() { return this.o < this.buf.length; }
}

function decode(first, body) {
  const type = first >> 4;
  const flags = first & 15;
  const r = new Reader(body);
  switch (type) {
    case T.CONNECT: {
      const proto = r.str();
      const level = r.u8();
      const cf = r.u8();
      const keepalive = r.u16();
      const clientId = r.str();
      const pkt = { type: 'connect', proto, level, keepalive, clientId, will: null };
      if (cf & 0x04) pkt.will = { topic: r.str(), payload: r.bin(), retain: !!(cf & 0x20) };
      if (cf & 0x80) pkt.username = r.str();
      if (cf & 0x40) pkt.password = r.str();
      return pkt;
    }
    case T.CONNACK: r.u8(); return { type: 'connack', code: r.u8() };
    case T.PUBLISH: {
      const qos = (flags >> 1) & 3;
      const topic = r.str();
      const id = qos > 0 ? r.u16() : 0;
      return { type: 'publish', qos, retain: !!(flags & 1), topic, id, payload: r.rest() };
    }
    case T.SUBSCRIBE: {
      const id = r.u16();
      const topics = [];
      while (r.more) { topics.push(r.str()); r.u8(); }
      return { type: 'subscribe', id, topics };
    }
    case T.SUBACK: return { type: 'suback', id: r.u16() };
    case T.PUBACK: return { type: 'puback', id: r.u16() };
    case T.PINGREQ: return { type: 'pingreq' };
    case T.PINGRESP: return { type: 'pingresp' };
    case T.DISCONNECT: return { type: 'disconnect' };
    default: return { type: 'other', code: type };
  }
}

function createParser(onPacket, onError) {
  let buf = Buffer.alloc(0);
  let dead = false;
  const fail = (e) => { dead = true; onError(e); };
  return (chunk) => {
    if (dead) return;
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (buf.length < 2) return;
      let mult = 1, len = 0, i = 1, b;
      do {
        if (i > 4) return fail(new Error('bad remaining length'));
        if (i >= buf.length) return;
        b = buf[i++];
        len += (b & 127) * mult;
        mult *= 128;
      } while (b & 128);
      if (buf.length < i + len) return;
      const first = buf[0];
      const body = buf.subarray(i, i + len);
      buf = buf.subarray(i + len);
      let pkt;
      try { pkt = decode(first, body); } catch (e) { return fail(e); }
      onPacket(pkt);
    }
  };
}

function topicMatch(filter, topic) {
  const f = filter.split('/');
  const t = topic.split('/');
  for (let i = 0; i < f.length; i++) {
    if (f[i] === '#') return true;
    if (i >= t.length) return false;
    if (f[i] !== '+' && f[i] !== t[i]) return false;
  }
  return f.length === t.length;
}

module.exports = { encode, createParser, topicMatch };
