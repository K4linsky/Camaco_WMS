'use strict';
(function () {
  const $ = (id) => document.getElementById(id);
  const API = location.protocol === 'file:' ? 'http://localhost:3000' : '';
  let snap = null;
  let racksDirty = false;

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  const dateTimeFull = (ts) => new Date(ts).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });

  function showError(msg) {
    const box = $('rack-error');
    box.textContent = msg || '';
    box.hidden = !msg;
  }

  async function api(method, path, body) {
    try {
      const r = await fetch(API + path, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!r.ok) {
        let msg = 'Błąd ' + r.status;
        try { msg = (await r.json()).error || msg; } catch (e) { /* brak tresci */ }
        showError(msg);
        return false;
      }
      showError('');
      return true;
    } catch (e) {
      showError('Brak połączenia z serwerem');
      return false;
    }
  }

  function boxCard(rack, shelf, b) {
    const base = `/api/racks/${rack.id}/shelves/${shelf.id}/boxes/${b.id}`;
    const s = b.sensor ? (snap.sensors || []).find((x) => x.key === b.sensor) : null;
    const known = s && s.online && s.state !== 'unknown';
    const cls = !known ? 'off' : s.state === 'detected' ? 'busy' : 'free';
    const card = el('div', 'box ' + cls);

    const product = el('input', 'product');
    product.type = 'text';
    product.maxLength = 80;
    product.value = b.product;
    product.placeholder = 'Produkt';
    product.setAttribute('aria-label', 'Produkt w boxie');
    product.addEventListener('change', () => api('PUT', base, { product: product.value }));
    card.append(product);

    const status = !b.sensor ? 'BRAK CZUJNIKA' : !known ? 'BRAK DANYCH' : s.state === 'detected' ? 'PEŁNY' : 'PUSTY';
    card.append(el('div', 'status', status));
    card.append(el('div', 'updated', s && s.lastSeen ? 'Aktualizacja: ' + dateTimeFull(s.lastSeen) : 'Aktualizacja: brak odczytu'));

    // czujniki wolne (nieprzypisane do innego boxa) + aktualnie wybrany
    const taken = new Set();
    for (const r of snap.racks) for (const sh of r.shelves) for (const x of sh.boxes) if (x.sensor && x.id !== b.id) taken.add(x.sensor);
    const sel = el('select', 'sensor-sel');
    sel.setAttribute('aria-label', 'Czujnik boxa');
    sel.append(new Option('— bez czujnika —', ''));
    const keys = (snap.sensors || []).map((x) => ({ key: x.key, name: x.name }));
    if (b.sensor && !keys.some((k) => k.key === b.sensor)) keys.push({ key: b.sensor, name: 'Czujnik ' + b.sensor });
    for (const k of keys) {
      if (!taken.has(k.key)) sel.append(new Option(`${k.name} (${k.key})`, k.key));
    }
    sel.value = b.sensor || '';
    sel.addEventListener('change', () => api('PUT', base, { sensor: sel.value || null }));
    card.append(sel);

    const del = el('button', 'btn small danger', 'Usuń box');
    del.type = 'button';
    del.addEventListener('click', () => { if (confirm('Usunąć ten box?')) api('DELETE', base); });
    card.append(del);
    return card;
  }

  function shelfRow(rack, shelf, idx) {
    const row = el('div', 'shelf');
    const base = `/api/racks/${rack.id}/shelves/${shelf.id}`;
    const head = el('div', 'shelf-head');
    const label = el('input', 'shelf-label');
    label.type = 'text';
    label.maxLength = 80;
    label.value = shelf.label;
    label.placeholder = 'Półka ' + (idx + 1);
    label.setAttribute('aria-label', 'Etykieta półki');
    label.addEventListener('change', () => api('PUT', base, { label: label.value }));
    head.append(label);
    const del = el('button', 'btn small danger', 'Usuń półkę');
    del.type = 'button';
    del.addEventListener('click', () => {
      if (confirm(`Usunąć półkę razem z boxami (${shelf.boxes.length})?`)) api('DELETE', base);
    });
    head.append(del);
    row.append(head);

    const boxes = el('div', 'boxes');
    if (!shelf.boxes.length) boxes.append(el('div', 'empty', 'Brak boxów'));
    for (const b of shelf.boxes) boxes.append(boxCard(rack, shelf, b));
    row.append(boxes);

    const add = el('button', 'btn small', '+ Dodaj box');
    add.type = 'button';
    add.addEventListener('click', () => api('POST', base + '/boxes', {}));
    row.append(add);
    return row;
  }

  function rackCard(rack) {
    const box = el('div', 'rack');
    const head = el('div', 'rack-head');
    const label = el('input', 'rack-label');
    label.type = 'text';
    label.maxLength = 80;
    label.value = rack.label;
    label.required = true;
    label.setAttribute('aria-label', 'Etykieta regału');
    label.addEventListener('change', () => {
      if (!label.value.trim()) { label.value = rack.label; return; }
      api('PUT', '/api/racks/' + rack.id, { label: label.value });
    });
    head.append(label);
    const del = el('button', 'btn small danger', 'Usuń regał');
    del.type = 'button';
    del.addEventListener('click', () => {
      if (confirm(`Usunąć regał "${rack.label}" razem z półkami (${rack.shelves.length})?`)) api('DELETE', '/api/racks/' + rack.id);
    });
    head.append(del);
    box.append(head);

    if (!rack.shelves.length) box.append(el('div', 'empty', 'Brak półek'));
    rack.shelves.forEach((s, i) => box.append(shelfRow(rack, s, i)));

    const add = el('button', 'btn small', '+ Dodaj półkę');
    add.type = 'button';
    add.addEventListener('click', () => api('POST', `/api/racks/${rack.id}/shelves`, {}));
    box.append(add);
    return box;
  }

  function renderRacks() {
    // nie przerysowuj podczas edycji pola - zmiana zostanie pokazana po opuszczeniu pola
    const a = document.activeElement;
    if (a && (a.tagName === 'INPUT' || a.tagName === 'SELECT') && $('racks').contains(a)) { racksDirty = true; return; }
    racksDirty = false;
    const box = $('racks');
    box.replaceChildren();
    const racks = snap.racks || [];
    for (const r of racks) box.append(rackCard(r));
    if (!racks.length) box.append(el('div', 'empty', 'Brak regałów - dodaj pierwszy powyżej'));
  }

  function setConn(ok) {
    const c = $('conn');
    c.textContent = ok ? 'Połączono' : 'Brak połączenia z serwerem';
    c.className = 'conn ' + (ok ? 'ok' : 'bad');
  }

  const es = new EventSource(API + '/api/stream');
  es.addEventListener('state', (m) => { snap = JSON.parse(m.data); setConn(true); renderRacks(); });
  es.onerror = () => setConn(false);

  $('addrack').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const ok = await api('POST', '/api/racks', { label: $('newrack-label').value, shelves: Number($('newrack-shelves').value) || 0, boxes: Number($('newrack-boxes').value) || 0 });
    if (ok) $('newrack-label').value = '';
  });
  $('racks').addEventListener('focusout', () => {
    // poczekaj, az fokus przejdzie na kolejny element (np. klikniety przycisk)
    setTimeout(() => { if (racksDirty && snap) renderRacks(); }, 150);
  });
  setInterval(() => { $('clock').textContent = new Date().toLocaleTimeString('pl-PL'); }, 1000);
})();
