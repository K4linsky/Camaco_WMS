'use strict';
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const MAX_LABEL = 80;
const MAX_SHELVES = 50;
const MAX_BOXES = 50;
const SENSOR_KEY = /^[^:\s]+:\d+$/; // "<id urzadzenia>:<nr czujnika>", np. "1:3"

class ValidationError extends Error {}
class NotFoundError extends Error {}

function cleanText(v, field, { required = false } = {}) {
  if (v === undefined || v === null) {
    if (required) throw new ValidationError(`Brak pola: ${field}`);
    return '';
  }
  if (typeof v !== 'string') throw new ValidationError(`Pole ${field} musi być tekstem`);
  const s = v.trim();
  if (required && !s) throw new ValidationError(`Pole ${field} nie może być puste`);
  if (s.length > MAX_LABEL) throw new ValidationError(`Pole ${field} jest za długie (max ${MAX_LABEL} znaków)`);
  return s;
}

function cleanCount(v, field, max) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > max) throw new ValidationError(`${field}: 0-${max}`);
  return n;
}

// Regaly zdefiniowane przez magazyniera: regal -> polki -> boxy.
// Box = jeden produkt + przypisany czujnik (klucz "urzadzenie:numer"). Stan boxa (wolny/zajety, czas)
// pochodzi z czujnika, wiec nie jest tu przechowywany.
class RackStore extends EventEmitter {
  constructor({ file = null } = {}) {
    super();
    this.file = file;
    this.racks = [];
    this.nextId = 1;
    this._load();
  }

  _load() {
    if (!this.file) return;
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.racks = Array.isArray(data.racks) ? data.racks : [];
      for (const r of this.racks) {
        this.nextId = Math.max(this.nextId, r.id + 1);
        r.shelves = Array.isArray(r.shelves) ? r.shelves : [];
        for (const s of r.shelves) {
          this.nextId = Math.max(this.nextId, s.id + 1);
          s.boxes = Array.isArray(s.boxes) ? s.boxes : [];
          for (const b of s.boxes) this.nextId = Math.max(this.nextId, b.id + 1);
        }
      }
      if (Number.isInteger(data.nextId)) this.nextId = Math.max(this.nextId, data.nextId);
    } catch (e) { /* brak lub uszkodzony plik - start od zera */ }
  }

  _save() {
    this.emit('change');
    if (!this.file) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ nextId: this.nextId, racks: this.racks }, null, 2));
      fs.renameSync(tmp, this.file);
    } catch (e) { /* stan w pamieci nadal dziala */ }
  }

  _find(list, id, what) {
    const x = list.find((i) => i.id === Number(id));
    if (!x) throw new NotFoundError(`Nie znaleziono: ${what}`);
    return x;
  }

  _rack(id) { return this._find(this.racks, id, 'regał'); }
  _shelf(rackId, sid) { return this._find(this._rack(rackId).shelves, sid, 'półka'); }
  _box(rackId, sid, bid) { return this._find(this._shelf(rackId, sid).boxes, bid, 'box'); }

  // sensor: null/'' = brak przypisania; kazdy czujnik moze obslugiwac tylko jeden box
  _cleanSensor(v, exceptBoxId) {
    if (v === null || v === '') return null;
    if (typeof v !== 'string' || !SENSOR_KEY.test(v)) throw new ValidationError('Niepoprawny czujnik');
    for (const r of this.racks) for (const s of r.shelves) for (const b of s.boxes) {
      if (b.sensor === v && b.id !== exceptBoxId) throw new ValidationError(`Czujnik ${v} jest już przypisany do boxa "${b.product || 'bez nazwy'}"`);
    }
    return v;
  }

  _newBox(product, sensor) {
    return { id: this.nextId++, product, sensor };
  }

  _newShelf(label, boxes = 0) {
    const shelf = { id: this.nextId++, label, boxes: [] };
    for (let i = 0; i < boxes; i++) shelf.boxes.push(this._newBox('', null));
    return shelf;
  }

  list() { return this.racks; }

  addRack({ label, shelves = 0, boxes = 0 } = {}) {
    label = cleanText(label, 'etykieta', { required: true });
    const n = cleanCount(shelves, 'Liczba półek', MAX_SHELVES);
    const b = cleanCount(boxes, 'Liczba boxów na półce', MAX_BOXES);
    const rack = { id: this.nextId++, label, shelves: [] };
    for (let i = 0; i < n; i++) rack.shelves.push(this._newShelf('', b));
    this.racks.push(rack);
    this._save();
    return rack;
  }

  updateRack(id, { label } = {}) {
    const rack = this._rack(id);
    rack.label = cleanText(label, 'etykieta', { required: true });
    this._save();
    return rack;
  }

  deleteRack(id) {
    const rack = this._rack(id);
    this.racks.splice(this.racks.indexOf(rack), 1);
    this._save();
  }

  addShelf(rackId, { label, boxes = 0 } = {}) {
    const rack = this._rack(rackId);
    if (rack.shelves.length >= MAX_SHELVES) throw new ValidationError(`Maksymalnie ${MAX_SHELVES} półek na regale`);
    const shelf = this._newShelf(cleanText(label, 'etykieta'), cleanCount(boxes, 'Liczba boxów', MAX_BOXES));
    rack.shelves.push(shelf);
    this._save();
    return shelf;
  }

  updateShelf(rackId, shelfId, { label } = {}) {
    const shelf = this._shelf(rackId, shelfId);
    shelf.label = cleanText(label, 'etykieta');
    this._save();
    return shelf;
  }

  deleteShelf(rackId, shelfId) {
    const rack = this._rack(rackId);
    rack.shelves.splice(rack.shelves.indexOf(this._shelf(rackId, shelfId)), 1);
    this._save();
  }

  addBox(rackId, shelfId, { product, sensor = null } = {}) {
    const shelf = this._shelf(rackId, shelfId);
    if (shelf.boxes.length >= MAX_BOXES) throw new ValidationError(`Maksymalnie ${MAX_BOXES} boxów na półce`);
    const box = this._newBox(cleanText(product, 'produkt'), this._cleanSensor(sensor));
    shelf.boxes.push(box);
    this._save();
    return box;
  }

  updateBox(rackId, shelfId, boxId, { product, sensor } = {}) {
    const box = this._box(rackId, shelfId, boxId);
    if (product === undefined && sensor === undefined) throw new ValidationError('Brak zmian');
    const newProduct = product === undefined ? box.product : cleanText(product, 'produkt');
    const newSensor = sensor === undefined ? box.sensor : this._cleanSensor(sensor, box.id);
    box.product = newProduct;
    box.sensor = newSensor;
    this._save();
    return box;
  }

  deleteBox(rackId, shelfId, boxId) {
    const shelf = this._shelf(rackId, shelfId);
    shelf.boxes.splice(shelf.boxes.indexOf(this._box(rackId, shelfId, boxId)), 1);
    this._save();
  }
}

module.exports = { RackStore, ValidationError, NotFoundError };
