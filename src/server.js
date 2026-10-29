'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { Store } = require('./store');
const { RackStore, ValidationError, NotFoundError } = require('./racks');
const { MqttClient } = require('./mqtt-client');
const { createBroker } = require('./broker');

const PUBLIC = path.join(__dirname, '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.json': 'application/json' };
const log = (m) => console.log(new Date().toISOString().slice(11, 19) + ' ' + m);

function createApp(cfg = config) {
  const store = new Store({ sensorNames: cfg.sensorNames, occupiedAlertSec: cfg.occupiedAlertSec, expectedDevices: cfg.expectedDevices, historyFile: cfg.historyFile });
  const racks = new RackStore({ file: cfg.racksFile });
  const streams = new Set();
  const snapshot = () => ({ ...store.snapshot(), racks: racks.list() });

  const broadcast = () => {
    const data = 'event: state\ndata: ' + JSON.stringify(snapshot()) + '\n\n';
    for (const res of streams) res.write(data);
  };
  store.on('change', broadcast);
  racks.on('change', broadcast);

  const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
  const json = (res, code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CORS });
    res.end(obj === undefined ? '' : JSON.stringify(obj));
  };

  const readBody = (req) => new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 10000) { reject(new ValidationError('Za duże żądanie')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
        resolve(body);
      } catch (e) { reject(new ValidationError('Niepoprawny JSON')); }
    });
    req.on('error', reject);
  });

  // /api/racks[/:id[/shelves[/:sid[/boxes[/:bid]]]]]
  async function handleRacks(req, res, parts) {
    const [, , rackId, shelvesSeg, shelfId, boxesSeg, boxId] = parts;
    try {
      const m = req.method;
      if (m === 'GET' && !rackId) return json(res, 200, racks.list());
      const body = m === 'POST' || m === 'PUT' ? await readBody(req) : {};
      const ok = (code, result) => json(res, code, result);
      if (!rackId) {
        if (m === 'POST') return ok(201, racks.addRack(body));
      } else if (!shelvesSeg) {
        if (m === 'PUT') return ok(200, racks.updateRack(rackId, body));
        if (m === 'DELETE') { racks.deleteRack(rackId); return ok(204); }
      } else if (shelvesSeg === 'shelves' && !boxesSeg) {
        if (!shelfId && m === 'POST') return ok(201, racks.addShelf(rackId, body));
        if (shelfId && m === 'PUT') return ok(200, racks.updateShelf(rackId, shelfId, body));
        if (shelfId && m === 'DELETE') { racks.deleteShelf(rackId, shelfId); return ok(204); }
      } else if (shelvesSeg === 'shelves' && shelfId && boxesSeg === 'boxes') {
        if (!boxId && m === 'POST') return ok(201, racks.addBox(rackId, shelfId, body));
        if (boxId && m === 'PUT') return ok(200, racks.updateBox(rackId, shelfId, boxId, body));
        if (boxId && m === 'DELETE') { racks.deleteBox(rackId, shelfId, boxId); return ok(204); }
      }
      return json(res, 405, { error: 'method not allowed' });
    } catch (e) {
      if (e instanceof ValidationError) return json(res, 400, { error: e.message });
      if (e instanceof NotFoundError) return json(res, 404, { error: e.message });
      return json(res, 500, { error: 'błąd serwera' });
    }
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
    if (url.pathname === '/api/racks' || url.pathname.startsWith('/api/racks/')) {
      return handleRacks(req, res, url.pathname.split('/').filter(Boolean));
    }
    if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' });

    if (url.pathname === '/api/stream') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'Access-Control-Allow-Origin': '*' });
      res.write('retry: 2000\nevent: state\ndata: ' + JSON.stringify(snapshot()) + '\n\n');
      streams.add(res);
      req.on('close', () => streams.delete(res));
      return;
    }
    if (url.pathname === '/api/state') return json(res, 200, snapshot());
    if (url.pathname === '/api/history') {
      const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit'), 10) || 100, 1), 500);
      return json(res, 200, store.history({ limit, sensor: url.searchParams.get('sensor') || undefined, type: url.searchParams.get('type') || undefined }));
    }
    if (url.pathname === '/api/health') return json(res, 200, { ok: true, mqttConnected: store.mqttConnected });

    let rel;
    try { rel = decodeURIComponent(url.pathname); } catch (e) { return json(res, 400, { error: 'bad request' }); }
    if (rel === '/') rel = '/index.html';
    const file = path.normalize(path.join(PUBLIC, rel));
    if (!file.startsWith(PUBLIC + path.sep)) return json(res, 403, { error: 'forbidden' });
    fs.readFile(file, (err, buf) => {
      if (err) return json(res, 404, { error: 'not found' });
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(buf);
    });
  });

  const keepAlive = setInterval(() => { for (const r of streams) r.write(': ping\n\n'); }, 15000);
  const ticker = setInterval(() => store.tick(), 1000);
  server.on('close', () => { clearInterval(keepAlive); clearInterval(ticker); });

  return { server, store, racks, streams };
}

async function main() {
  const app = createApp();
  let broker = null;
  let mqttHost = config.mqttExternalHost;
  if (!mqttHost) {
    broker = createBroker({ log });
    await broker.listen(config.mqttPort, '0.0.0.0');
    mqttHost = '127.0.0.1';
    log(`Wbudowany broker MQTT nasłuchuje na porcie ${config.mqttPort}`);
  } else {
    log(`Używam zewnętrznego brokera MQTT ${mqttHost}:${config.mqttPort}`);
  }

  const mqtt = new MqttClient({
    host: mqttHost, port: config.mqttPort, clientId: 'storagemaster-backend-' + process.pid,
    username: config.mqttUser || undefined, password: config.mqttPassword || undefined,
    subscriptions: ['storagewms/#'],
  });
  mqtt.on('connect', () => { log('MQTT: połączono'); app.store.setMqttConnected(true); });
  mqtt.on('offline', () => { log('MQTT: rozłączono'); app.store.setMqttConnected(false); });
  mqtt.on('error', (e) => log('MQTT błąd: ' + e.message));
  mqtt.on('message', (topic, payload) => {
    if (app.store.handleMessage(topic, payload)) log(`${topic} = ${payload}`);
  });
  mqtt.start();

  app.server.listen(config.httpPort, config.httpHost, () => log(`Panel magazyniera: http://localhost:${config.httpPort}`));
  const stop = () => { mqtt.stop(); if (broker) broker.close(); app.server.close(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

if (require.main === module) {
  main().catch((e) => { console.error('Błąd startu:', e.message); process.exit(1); });
}

module.exports = { createApp };
