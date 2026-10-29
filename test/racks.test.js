'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { RackStore, ValidationError, NotFoundError } = require('../src/racks');

test('regal z polkami i boxami, domyslnie bez czujnikow', () => {
  const store = new RackStore();
  const r = store.addRack({ label: ' A1 ', shelves: 2, boxes: 3 });
  assert.strictEqual(r.label, 'A1');
  assert.strictEqual(r.shelves.length, 2);
  assert.ok(r.shelves.every((s) => s.boxes.length === 3 && s.boxes.every((b) => b.sensor === null && b.product === '')));
});

test('box: produkt i czujnik, czujnik tylko dla jednego boxa', () => {
  const store = new RackStore();
  const r = store.addRack({ label: 'A', shelves: 1, boxes: 2 });
  const [b1, b2] = r.shelves[0].boxes;
  store.updateBox(r.id, r.shelves[0].id, b1.id, { product: 'Opony', sensor: '1:2' });
  assert.strictEqual(b1.product, 'Opony');
  assert.throws(() => store.updateBox(r.id, r.shelves[0].id, b2.id, { sensor: '1:2' }), ValidationError);
  store.updateBox(r.id, r.shelves[0].id, b1.id, { sensor: null });
  store.updateBox(r.id, r.shelves[0].id, b2.id, { sensor: '1:2' });
  assert.strictEqual(b2.sensor, '1:2');
  assert.strictEqual(b1.product, 'Opony');
});

test('walidacja i brakujace obiekty', () => {
  const store = new RackStore();
  assert.throws(() => store.addRack({ label: '  ' }), ValidationError);
  assert.throws(() => store.addRack({ label: 'x', shelves: 99 }), ValidationError);
  const r = store.addRack({ label: 'A', shelves: 1, boxes: 1 });
  const s = r.shelves[0];
  assert.throws(() => store.updateBox(r.id, s.id, s.boxes[0].id, { sensor: 'abc' }), ValidationError);
  assert.throws(() => store.updateBox(r.id, s.id, 9999, { product: 'x' }), NotFoundError);
  assert.throws(() => store.deleteRack(9999), NotFoundError);
});

test('dodawanie i usuwanie boxow, polek, regalow', () => {
  const store = new RackStore();
  const r = store.addRack({ label: 'A' });
  const s = store.addShelf(r.id, { boxes: 1 });
  const b = store.addBox(r.id, s.id, { product: 'Śruby', sensor: '1:1' });
  assert.strictEqual(s.boxes.length, 2);
  store.deleteBox(r.id, s.id, b.id);
  assert.strictEqual(s.boxes.length, 1);
  store.deleteShelf(r.id, s.id);
  assert.strictEqual(r.shelves.length, 0);
  store.deleteRack(r.id);
  assert.strictEqual(store.list().length, 0);
});
