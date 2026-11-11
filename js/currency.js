/*
 * NettoPL — exchange rates from the National Bank of Poland (NBP) public API.
 *
 * Uses table A (average rates of the most traded currencies), fetched once per day
 * straight from the browser (the API allows cross-origin requests) and cached in
 * localStorage so the page still works offline with the last known rates.
 *
 * Works in the browser (window.NettoFx) and in Node (module.exports) for tests.
 */
(function (root) {
  'use strict';

  const API_URL = 'https://api.nbp.pl/api/exchangerates/tables/a/?format=json';
  const CACHE_KEY = 'nettopl:nbp-a';

  /**
   * Turn the NBP response into { table, no, date, rates: { CODE: plnPerUnit } }.
   * PLN is always present with a rate of 1.
   */
  function parseTable(json) {
    const t = Array.isArray(json) ? json[0] : json;
    if (!t || !Array.isArray(t.rates) || !t.effectiveDate) {
      throw new Error('Unexpected NBP response');
    }
    const rates = { PLN: 1 };
    for (const r of t.rates) {
      if (r && /^[A-Z]{3}$/.test(r.code) && Number(r.mid) > 0) rates[r.code] = Number(r.mid);
    }
    return { table: t.table, no: t.no, date: t.effectiveDate, rates };
  }

  /** Foreign amount → PLN, rounded to grosze. */
  function toPln(amount, rate) {
    return Math.round(amount * rate * 100) / 100;
  }

  /** PLN amount → foreign currency (not rounded; formatting does that). */
  function fromPln(pln, rate) {
    return pln / rate;
  }

  function readCache(storage) {
    try {
      const c = JSON.parse(storage.getItem(CACHE_KEY));
      return c && c.data && c.data.rates ? c : null;
    } catch (_) {
      return null;
    }
  }

  function writeCache(storage, cache) {
    try { storage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch (_) { /* storage unavailable */ }
  }

  /**
   * Load table A rates.
   * Resolves to { data, source: 'live' | 'cache' | 'stale', error? }.
   *   cache — already fetched today, no request made
   *   stale — request failed, using the last saved rates
   * Rejects only when the request fails and nothing is cached.
   *
   * @param {object} [opts]
   * @param {Function} [opts.fetchImpl]  fetch implementation (injectable for tests)
   * @param {Storage}  [opts.storage]    localStorage-like object, may be null
   * @param {string}   [opts.today]      YYYY-MM-DD in the user's timezone
   * @param {boolean}  [opts.force]      ignore today's cache
   */
  async function loadRates(opts = {}) {
    const fetchImpl = opts.fetchImpl || root.fetch.bind(root);
    const storage = opts.storage === undefined ? safeLocalStorage() : opts.storage;
    const today = opts.today || localDate(new Date());
    const cached = storage ? readCache(storage) : null;

    if (cached && cached.fetchedOn === today && !opts.force) {
      return { data: cached.data, source: 'cache' };
    }

    try {
      const res = await fetchImpl(API_URL, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`NBP API returned ${res.status}`);
      const data = parseTable(await res.json());
      if (storage) writeCache(storage, { fetchedOn: today, data });
      return { data, source: 'live' };
    } catch (error) {
      if (cached) return { data: cached.data, source: 'stale', error };
      throw error;
    }
  }

  function safeLocalStorage() {
    try { return root.localStorage || null; } catch (_) { return null; }
  }

  function localDate(d) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  const api = { API_URL, CACHE_KEY, parseTable, toPln, fromPln, loadRates };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NettoFx = api;
})(typeof self !== 'undefined' ? self : this);
