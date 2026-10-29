'use strict';
(function () {
  const $ = (id) => document.getElementById(id);
  const API = location.protocol === 'file:' ? 'http://localhost:3000' : '';
  let events = [];

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  const dateTime = (ts) => new Date(ts).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });

  function render() {
    const ul = $('history');
    const f = $('filter').value;
    ul.replaceChildren();
    const ev = events.filter((e) => f === 'all' || (f === 'alert' ? e.type.startsWith('alert') : e.type === f));
    if (!ev.length) { ul.append(el('li', 'empty', 'Brak zdarzeń')); return; }
    for (const e of ev) {
      const li = el('li', e.type === 'alert' ? 'alert-ev' : '');
      li.append(el('time', '', dateTime(e.ts)));
      li.append(el('span', '', (e.type === 'alert' ? '⚠ ' : '') + e.message));
      ul.append(li);
    }
  }

  async function load() {
    try {
      const r = await fetch(API + '/api/history?limit=500');
      events = await r.json();
      render();
    } catch (e) { /* kolejna proba przy nastepnej zmianie */ }
  }

  function setConn(ok) {
    const c = $('conn');
    c.textContent = ok ? 'Połączono' : 'Brak połączenia z serwerem';
    c.className = 'conn ' + (ok ? 'ok' : 'bad');
  }

  const es = new EventSource(API + '/api/stream');
  es.addEventListener('state', () => { setConn(true); load(); });
  es.onerror = () => setConn(false);

  $('filter').addEventListener('change', render);
  setInterval(() => { $('clock').textContent = new Date().toLocaleTimeString('pl-PL'); }, 1000);
  load();
})();
