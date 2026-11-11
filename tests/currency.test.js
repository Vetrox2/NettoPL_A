const test = require('node:test');
const assert = require('node:assert/strict');
const fx = require('../js/currency.js');

const SAMPLE = [{
  table: 'A', no: '219/A/NBP/2026', effectiveDate: '2026-11-10',
  rates: [
    { currency: 'euro', code: 'EUR', mid: 4.3895 },
    { currency: 'forint (Węgry)', code: 'HUF', mid: 0.012109 },
    { currency: 'broken', code: 'XX', mid: 1 },
  ],
}];

const okFetch = (calls) => async (url) => { calls.push(url); return { ok: true, json: async () => SAMPLE }; };
const failFetch = async () => { throw new Error('offline'); };
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}

test('parses NBP table A', () => {
  const t = fx.parseTable(SAMPLE);
  assert.equal(t.no, '219/A/NBP/2026');
  assert.equal(t.date, '2026-11-10');
  assert.deepEqual(t.rates, { PLN: 1, EUR: 4.3895, HUF: 0.012109 });
});

test('rejects malformed responses', () => {
  assert.throws(() => fx.parseTable([]));
  assert.throws(() => fx.parseTable({ rates: [] }));
});

test('converts to and from PLN', () => {
  assert.equal(fx.toPln(5000, 4.3895), 21947.5);
  assert.equal(fx.toPln(1000000, 0.012109), 12109);
  assert.equal(Math.round(fx.fromPln(21947.5, 4.3895) * 100) / 100, 5000);
});

test('fetches once per day and caches', async () => {
  const calls = [];
  const storage = memoryStorage();
  const a = await fx.loadRates({ fetchImpl: okFetch(calls), storage, today: '2026-11-11' });
  assert.equal(a.source, 'live');
  const b = await fx.loadRates({ fetchImpl: okFetch(calls), storage, today: '2026-11-11' });
  assert.equal(b.source, 'cache');
  assert.equal(calls.length, 1);
  const c = await fx.loadRates({ fetchImpl: okFetch(calls), storage, today: '2026-11-12' });
  assert.equal(c.source, 'live');
  assert.equal(calls.length, 2);
});

test('falls back to saved rates when offline', async () => {
  const storage = memoryStorage();
  await fx.loadRates({ fetchImpl: okFetch([]), storage, today: '2026-11-10' });
  const r = await fx.loadRates({ fetchImpl: failFetch, storage, today: '2026-11-11' });
  assert.equal(r.source, 'stale');
  assert.equal(r.data.rates.EUR, 4.3895);
});

test('fails when offline with nothing saved', async () => {
  await assert.rejects(fx.loadRates({ fetchImpl: failFetch, storage: memoryStorage(), today: '2026-11-11' }));
});

test('treats HTTP errors as failures', async () => {
  const notFound = async () => ({ ok: false, status: 404 });
  await assert.rejects(fx.loadRates({ fetchImpl: notFound, storage: null, today: '2026-11-11' }), /404/);
});
