'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { Store } = require('../src/store');
const { encode, createParser, topicMatch } = require('../src/mqtt-packet');
const { createBroker } = require('../src/broker');
const { MqttClient } = require('../src/mqtt-client');

function mkStore(extra = {}) {
  let t = 1_000_000;
  const store = new Store({ sensorNames: ['A', 'B', 'C', 'D'], occupiedAlertSec: 60, now: () => t, ...extra });
  return { store, advance: (s) => { t += s * 1000; } };
}

test('sensory z firmware sa widoczne od startu jako brak danych', () => {
  const { store } = mkStore();
  const s = store.snapshot();
  assert.strictEqual(s.sensors.length, 4);
  assert.ok(s.sensors.every((x) => x.state === 'unknown' && !x.online));
});

test('stan czujnika i status urzadzenia', () => {
  const { store } = mkStore();
  assert.ok(store.handleMessage('storagewms/1/status', 'online'));
  assert.ok(store.handleMessage('storagewms/1/sensor/2/state', 'detected'));
  const s = store.snapshot().sensors.find((x) => x.key === '1:2');
  assert.strictEqual(s.state, 'detected');
  assert.strictEqual(s.online, true);
  assert.ok(store.snapshot().events.length >= 2);
});

test('odrzuca nieznane tematy i ladunki', () => {
  const { store } = mkStore();
  assert.strictEqual(store.handleMessage('inne/temat', 'x'), false);
  assert.strictEqual(store.handleMessage('storagewms/1/sensor/1/state', 'blah'), false);
  assert.strictEqual(store.handleMessage('storagewms/1/status', 'maybe'), false);
});

test('powtorzony ten sam stan nie tworzy nowego zdarzenia', () => {
  const { store } = mkStore();
  store.handleMessage('storagewms/1/status', 'online');
  store.handleMessage('storagewms/1/sensor/1/state', 'clear');
  const n = store.events.length;
  store.handleMessage('storagewms/1/sensor/1/state', 'clear');
  assert.strictEqual(store.events.length, n);
});

test('alert zbyt dlugiego zajecia pojawia sie i znika', () => {
  const { store, advance } = mkStore();
  store.handleMessage('storagewms/1/status', 'online');
  store.handleMessage('storagewms/1/sensor/1/state', 'detected');
  advance(59); store.tick();
  assert.strictEqual(store.alerts.size, 0);
  advance(2); store.tick();
  assert.strictEqual(store.alerts.size, 1);
  store.handleMessage('storagewms/1/sensor/1/state', 'clear');
  assert.strictEqual(store.alerts.size, 0);
  assert.ok(store.events.some((e) => e.type === 'alert_clear'));
});

test('alert krytyczny gdy urzadzenie offline', () => {
  const { store } = mkStore();
  store.handleMessage('storagewms/1/status', 'online');
  store.handleMessage('storagewms/1/status', 'offline');
  const a = [...store.alerts.values()];
  assert.strictEqual(a.length, 1);
  assert.strictEqual(a[0].level, 'critical');
  assert.ok(store.snapshot().sensors.every((s) => !s.online));
});

test('parser MQTT obsluguje pakiety dzielone na czesci', () => {
  const got = [];
  const parse = createParser((p) => got.push(p), (e) => { throw e; });
  const buf = encode.publish('storagewms/1/sensor/1/state', 'detected', true);
  parse(buf.subarray(0, 5));
  parse(buf.subarray(5));
  assert.strictEqual(got.length, 1);
  assert.strictEqual(got[0].topic, 'storagewms/1/sensor/1/state');
  assert.strictEqual(got[0].payload.toString(), 'detected');
});

test('topicMatch: wildcardy', () => {
  assert.ok(topicMatch('storagewms/#', 'storagewms/1/status'));
  assert.ok(topicMatch('storagewms/+/status', 'storagewms/1/status'));
  assert.ok(!topicMatch('storagewms/+/status', 'storagewms/1/sensor/1/state'));
});

test('broker: retained + LWT dzialaja end-to-end', async () => {
  const broker = createBroker();
  await broker.listen(0, '127.0.0.1');
  const port = broker.server.address().port;
  const dev = new MqttClient({ host: '127.0.0.1', port, clientId: 'dev', will: { topic: 'storagewms/1/status', payload: 'offline', retain: true } });
  await new Promise((r) => { dev.on('connect', r); dev.start(); });
  dev.publish('storagewms/1/status', 'online', true);
  await new Promise((r) => setTimeout(r, 50));

  const got = [];
  const sub = new MqttClient({ host: '127.0.0.1', port, clientId: 'sub', subscriptions: ['storagewms/#'] });
  sub.on('message', (t, p) => got.push(t + '=' + p));
  await new Promise((r) => { sub.on('connect', r); sub.start(); });
  await new Promise((r) => setTimeout(r, 50));
  assert.deepStrictEqual(got, ['storagewms/1/status=online']);

  dev.kill();
  await new Promise((r) => setTimeout(r, 100));
  assert.strictEqual(got[got.length - 1], 'storagewms/1/status=offline');

  dev.stop(); sub.stop(); broker.close();
});
