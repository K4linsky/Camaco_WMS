'use strict';
// Symulator urzadzenia ESP32 "storagewms-1" z 3 czujnikami E18-D80NK.
// Publikuje te same tematy i ladunki co firmware (StorageWMS.ino):
//   storagewms/1/status               "online" / "offline" (LWT)   retained
//   storagewms/1/sensor/<n>/state     "detected" / "clear"          retained
//
// Zmienne srodowiskowe: MQTT_HOST (127.0.0.1), MQTT_PORT (1883), SIM_SPEED (1 = czas rzeczywisty, 5 = 5x szybciej),
// SIM_DROPOUTS (1 = symuluj okresowe zaniki polaczenia urzadzenia, 0 = wylacz).
const { MqttClient } = require('../src/mqtt-client');

const COUNT = 3;
const speed = Number(process.env.SIM_SPEED) || 1;
const dropouts = process.env.SIM_DROPOUTS !== '0';
const STATUS = 'storagewms/1/status';
const topic = (i) => `storagewms/1/sensor/${i + 1}/state`;
const rnd = (a, b) => (a + Math.random() * (b - a)) * 1000 / speed;

const client = new MqttClient({
  host: process.env.MQTT_HOST || '127.0.0.1',
  port: Number(process.env.MQTT_PORT) || 1883,
  clientId: 'storagewms-1',
  will: { topic: STATUS, payload: 'offline', retain: true },
  reconnectMs: 8000 / speed,
});

const sensors = Array.from({ length: COUNT }, (_, i) => ({ occupied: false, next: Date.now() + rnd(2, 10), slow: i === COUNT - 1 }));

function publishState(i) {
  client.publish(topic(i), sensors[i].occupied ? 'detected' : 'clear', true);
  console.log(`[sym] ${topic(i)} = ${sensors[i].occupied ? 'detected' : 'clear'}`);
}

client.on('connect', () => {
  console.log('[sym] polaczono z brokerem');
  client.publish(STATUS, 'online', true);
  sensors.forEach((_, i) => publishState(i)); // jak firmware po (re)connect
});
client.on('offline', () => console.log('[sym] rozlaczono'));
client.on('error', (e) => console.log('[sym] blad: ' + e.message));
client.start();

setInterval(() => {
  const t = Date.now();
  sensors.forEach((s, i) => {
    if (t < s.next) return;
    s.occupied = !s.occupied;
    // ostatni czujnik bywa zajety dlugo - pozwala zobaczyc alert o zbyt dlugim zajeciu
    s.next = t + (s.occupied ? (s.slow ? rnd(90, 150) : rnd(8, 40)) : rnd(5, 25));
    publishState(i);
  });
  if (dropouts && client.connected && Math.random() < 1 / (150 / speed)) {
    console.log('[sym] symulacja utraty polaczenia urzadzenia (LWT)');
    client.kill();
  }
}, 1000 / Math.min(speed, 5));
