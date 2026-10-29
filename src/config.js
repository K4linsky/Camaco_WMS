'use strict';
const path = require('path');

const int = (v, d) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : d);

module.exports = {
  httpPort: int(process.env.PORT, 3000),
  httpHost: process.env.HOST || '0.0.0.0',
  // Gdy ustawione MQTT_HOST - laczymy sie z zewnetrznym brokerem (np. Mosquitto) i nie startujemy brokera wbudowanego.
  mqttExternalHost: process.env.MQTT_HOST || '',
  mqttPort: int(process.env.MQTT_PORT, 1883),
  mqttUser: process.env.MQTT_USER || '',
  mqttPassword: process.env.MQTT_PASSWORD || '',
  // Prog alertu: czas ciaglego zajecia miejsca (sekundy). Domyslnie 60 min.
  occupiedAlertSec: int(process.env.ALERT_OCCUPIED_SEC, 3600),
  sensorNames: (process.env.SENSOR_NAMES || 'Miejsce 1,Miejsce 2,Miejsce 3').split(',').map((s) => s.trim()).filter(Boolean),
  // Oczekiwana liczba urzadzen (czujnikow) pokazywana jako mianownik w "Urzadzenia online". Domyslnie tyle, ile nazw w SENSOR_NAMES.
  expectedDevices: int(process.env.EXPECTED_DEVICES, 0),
  racksFile: process.env.RACKS_FILE || path.join(__dirname, '..', 'data', 'racks.json'),
  historyFile: process.env.HISTORY_FILE || path.join(__dirname, '..', 'data', 'history.jsonl'),
};
