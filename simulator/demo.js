'use strict';
// Uruchamia serwer + symulator jednym poleceniem (krotki prog alertu, zeby alert byl widoczny w demo).
const { spawn } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const env = { ...process.env, ALERT_OCCUPIED_SEC: process.env.ALERT_OCCUPIED_SEC || '60' };
const procs = [
  spawn(process.execPath, [path.join(root, 'src', 'server.js')], { env, stdio: 'inherit' }),
];
setTimeout(() => procs.push(spawn(process.execPath, [path.join(__dirname, 'simulator.js')], { env, stdio: 'inherit' })), 1000);

const stop = () => { procs.forEach((p) => p.kill()); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
procs[0].on('exit', (c) => { procs.forEach((p) => p.kill()); process.exit(c || 0); });
