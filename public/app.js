'use strict';
(function () {
  const $ = (id) => document.getElementById(id);
  let snap = null;
  let offset = 0; // roznica zegara serwera i przegladarki
  let live = false;

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function dur(sec) {
    sec = Math.max(0, Math.floor(sec));
    if (sec < 60) return sec + ' s';
    const m = Math.floor(sec / 60);
    if (m < 60) return m + ' min ' + (sec % 60) + ' s';
    return Math.floor(m / 60) + ' h ' + (m % 60) + ' min';
  }
  const nowSrv = () => Date.now() + offset;
  const hhmmss = (ts) => new Date(ts).toLocaleTimeString('pl-PL');
  const dateTimeFull = (ts) => new Date(ts).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });

  function renderConn() {
    const c = $('conn');
    if (!live) { c.textContent = 'Brak połączenia z serwerem'; c.className = 'conn bad'; return; }
    if (!snap.mqttConnected) { c.textContent = 'Serwer: brak brokera MQTT'; c.className = 'conn bad'; return; }
    // "urzadzenie" = pojedynczy czujnik/miejsce; online gdy jego kontroler jest online
    const total = snap.expectedDevices || snap.sensors.length;
    const online = snap.sensors.filter((s) => s.online).length;
    c.textContent = `Urządzenia online: ${online}/${total}`;
    c.className = 'conn ' + (online === total ? 'ok' : 'bad');
  }

  function renderAlerts() {
    const box = $('alerts');
    box.replaceChildren();
    if (!snap.alerts.length) box.append(el('div', 'noalert', '✔ Brak alertów'));
    const grid = el('div', 'alert-grid');
    for (const a of snap.alerts) {
      const d = el('div', 'alert ' + a.level);
      d.setAttribute('role', 'alert');
      d.append(el('span', 'ico', a.level === 'critical' ? '⛔' : '⚠️'));
      const t = el('div', '', a.message);
      t.append(el('small', '', 'od ' + hhmmss(a.since) + ' (' + dur((nowSrv() - a.since) / 1000) + ')'));
      d.append(t);
      grid.append(d);
    }
    if (snap.alerts.length) box.append(grid);
    renderFreeList(box);
  }

  // boxy ze statusem WOLNY: regal / polka / box + data ostatniej zmiany na WOLNY
  function renderFreeList(box) {
    const free = [];
    for (const r of snap.racks || []) {
      r.shelves.forEach((sh, i) => {
        for (const b of sh.boxes) {
          const s = b.sensor && snap.sensors.find((x) => x.key === b.sensor);
          if (s && s.online && s.state === 'clear') free.push({ rack: r.label, shelf: sh.label || 'Półka ' + (i + 1), box: b.product || 'Bez nazwy', since: s.since });
        }
      });
    }
    const wrap = el('div', 'freelist');
    wrap.append(el('div', 'freelist-title', 'PUSTE (' + free.length + ')'));
    if (!free.length) wrap.append(el('div', 'empty', 'Brak pustych boxów'));
    for (const f of free) {
      const row = el('div', 'free-row');
      row.append(el('span', 'free-path', f.rack + ' › ' + f.shelf + ' › ' + f.box));
      row.append(el('small', '', f.since ? 'puste od ' + dateTimeFull(f.since) : 'brak daty zmiany'));
      wrap.append(row);
    }
    box.append(wrap);
  }

  // widok regałów tylko do odczytu; edycja jest na osobnej stronie (racks.html)
  function boxView(b) {
    const s = b.sensor ? snap.sensors.find((x) => x.key === b.sensor) : null;
    const known = s && s.online && s.state !== 'unknown';
    const card = el('div', 'box ' + (!known ? 'off' : s.state === 'detected' ? 'busy' : 'free'));
    card.append(el('div', 'product-name', b.product || 'Bez nazwy'));
    card.append(el('div', 'status', !b.sensor ? 'BRAK CZUJNIKA' : !known ? 'BRAK DANYCH' : s.state === 'detected' ? 'PEŁNY' : 'PUSTY'));
    card.append(el('div', 'updated', s && s.lastSeen ? 'Aktualizacja: ' + dateTimeFull(s.lastSeen) : 'Aktualizacja: brak odczytu'));
    return card;
  }

  function renderRacks() {
    const box = $('racks');
    box.replaceChildren();
    const racks = snap.racks || [];
    let total = 0, busy = 0;
    for (const r of racks) {
      const rack = el('div', 'rack');
      rack.append(el('div', 'rack-title', r.label));
      if (!r.shelves.length) rack.append(el('div', 'empty', 'Brak półek'));
      r.shelves.forEach((sh, i) => {
        const row = el('div', 'shelf');
        row.append(el('div', 'shelf-title', sh.label || 'Półka ' + (i + 1)));
        const boxes = el('div', 'boxes');
        if (!sh.boxes.length) boxes.append(el('div', 'empty', 'Brak boxów'));
        for (const b of sh.boxes) {
          total++;
          const s = b.sensor && snap.sensors.find((x) => x.key === b.sensor);
          if (s && s.online && s.state === 'detected') busy++;
          boxes.append(boxView(b));
        }
        row.append(boxes);
        rack.append(row);
      });
      box.append(rack);
    }
    if (!racks.length) box.append(el('div', 'empty', 'Brak regałów - dodaj je w "Edytuj Regały"'));
    $('rack-summary').textContent = total ? `pełne boxy: ${busy} z ${total}` : '';
  }

  function render() {
    if (!snap) return;
    renderConn();
    renderAlerts();
    renderRacks();
  }

  function connect() {
    const es = new EventSource((location.protocol === 'file:' ? 'http://localhost:3000' : '') + '/api/stream');
    es.addEventListener('state', (m) => {
      snap = JSON.parse(m.data);
      offset = snap.now - Date.now();
      live = true;
      render();
    });
    es.onerror = () => { live = false; if (snap) renderConn(); else $('conn').textContent = 'Brak połączenia z serwerem'; };
  }

  setInterval(() => {
    $('clock').textContent = new Date().toLocaleTimeString('pl-PL');
  }, 1000);
  connect();
})();
