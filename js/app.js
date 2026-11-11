/* NettoPL — UI wiring. All state lives in the form and (optionally) localStorage. */
(function () {
  'use strict';

  const { calculateYear, PARAMS_2026 } = window.NettoCalc;
  const Fx = window.NettoFx;
  const STORAGE_KEY = 'nettopl:v1';
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];

  const SEGMENTS = [
    { key: 'net', label: 'Net pay', hint: 'what you take home' },
    { key: 'social', label: 'Social security (ZUS)', hint: 'pension, disability, sickness' },
    { key: 'health', label: 'Health insurance', hint: 'składka zdrowotna' },
    { key: 'tax', label: 'Income tax (PIT)', hint: 'zaliczka na podatek' },
  ];

  const $ = (id) => document.getElementById(id);
  const form = $('calc-form');
  const el = {
    gross: $('gross'), young: $('young'), birthday: $('birthday'), birthdayField: $('birthday-field'),
    elevated: $('elevated'), pit2: $('pit2'),
    author: $('author'), authorField: $('author-field'),
    authorShare: $('author-share'), authorRange: $('author-share-range'), authorHelp: $('author-help'),
    currency: $('currency'), displayCurrency: $('display-currency'), fxInfo: $('fx-info'),
    grossHelp: $('gross-help'), tableCurrency: $('table-currency'),
  };

  // Exchange rates: status is 'loading' | 'ok' | 'stale' | 'error'
  const fx = { data: null, status: 'loading' };
  // Currency the results are shown in, and its PLN rate.
  let display = { code: 'PLN', rate: 1 };

  const moneyFormats = {};
  const fmtFor = (code) => (moneyFormats[code] ||= new Intl.NumberFormat('pl-PL', { style: 'currency', currency: code }));
  const fmtNum = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtRate = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 4, maximumFractionDigits: 6 });
  const fmtDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  let currencyNames = null;
  try { currencyNames = new Intl.DisplayNames(['en'], { type: 'currency' }); } catch (_) { /* old browser */ }
  const currencyName = (code) => (code === 'PLN' ? 'Polish złoty' : (currencyNames && currencyNames.of(code)) || code);
  const PREFERRED = ['PLN', 'EUR', 'USD', 'GBP', 'CHF'];
  const fmtInt = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 0 });
  const fmtPct = new Intl.NumberFormat('pl-PL', { style: 'percent', maximumFractionDigits: 1 });
  // All amounts come from the calculation in PLN and are converted for display here.
  const conv = (pln) => Fx.fromPln(pln, display.rate);
  const money = (pln) => fmtFor(display.code).format(conv(pln));
  const plnMoney = (pln) => fmtFor('PLN').format(pln);
  const num = (pln) => (pln === 0 ? '–' : fmtNum.format(conv(pln)));

  // --- Setup ---------------------------------------------------------------
  $('tax-year').textContent = PARAMS_2026.year;
  MONTHS.forEach((name, i) => {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = `${name} 2026`;
    el.birthday.appendChild(opt);
  });
  document.querySelectorAll('[data-param]').forEach((node) => {
    node.textContent = fmtInt.format(PARAMS_2026[node.dataset.param]);
  });

  restore();
  loadRates();
  // Keep the slider and the number box in step.
  el.authorRange.addEventListener('input', () => { el.authorShare.value = el.authorRange.value; });
  el.authorShare.addEventListener('input', () => {
    if (el.authorShare.value !== '') el.authorRange.value = clampShare(el.authorShare.value);
  });
  el.authorShare.addEventListener('change', () => { el.authorShare.value = clampShare(el.authorShare.value); });
  form.addEventListener('input', update);
  form.addEventListener('change', update);
  form.addEventListener('submit', (e) => e.preventDefault());
  el.fxInfo.addEventListener('click', (e) => {
    if (e.target.closest('[data-fx-retry]')) loadRates(true);
  });
  update();

  // --- State ---------------------------------------------------------------
  function clampShare(v) {
    const n = Math.round(Number(String(v).replace(',', '.')));
    return Number.isFinite(n) ? Math.max(1, Math.min(100, n)) : 50;
  }

  function readInputs() {
    const gross = parseFloat(String(el.gross.value).replace(',', '.'));
    return {
      gross: Number.isFinite(gross) && gross > 0 ? gross : 0,
      young: el.young.checked,
      birthday: Number(el.birthday.value),
      elevated: el.elevated.checked,
      pit2: el.pit2.checked,
      author: el.author.checked,
      authorShare: clampShare(el.authorShare.value),
      currency: el.currency.value || 'PLN',
      displayCurrency: el.displayCurrency.value || 'PLN',
    };
  }

  function save(state) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) { /* storage unavailable */ }
  }

  function restore() {
    let state = null;
    try { state = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch (_) { /* ignore */ }
    if (!state || typeof state !== 'object') return;
    if (typeof state.gross === 'number' && state.gross > 0) el.gross.value = state.gross;
    el.young.checked = !!state.young;
    if (Number.isInteger(state.birthday) && state.birthday >= 0 && state.birthday <= 12) {
      el.birthday.value = String(state.birthday);
    }
    el.elevated.checked = !!state.elevated;
    el.pit2.checked = state.pit2 !== false;
    el.author.checked = !!state.author;
    if (typeof state.authorShare === 'number') {
      el.authorShare.value = el.authorRange.value = clampShare(state.authorShare);
    }
    // Rates aren't loaded yet: add the saved currencies so the selection survives until they are.
    for (const [select, code] of [[el.currency, state.currency], [el.displayCurrency, state.displayCurrency]]) {
      if (typeof code === 'string' && /^[A-Z]{3}$/.test(code)) {
        if (code !== 'PLN') select.appendChild(currencyOption(code, select === el.displayCurrency));
        select.value = code;
      }
    }
  }

  // --- Exchange rates ------------------------------------------------------
  async function loadRates(force = false) {
    fx.status = 'loading';
    renderFxInfo(readInputs());
    try {
      const { data, source } = await Fx.loadRates({ force });
      fx.data = data;
      fx.status = source === 'stale' ? 'stale' : 'ok';
      fillCurrencySelects();
    } catch (_) {
      fx.status = fx.data ? 'stale' : 'error';
    }
    update();
  }

  function currencyOption(code, long) {
    const opt = document.createElement('option');
    opt.value = code;
    opt.textContent = long ? `${code} – ${currencyName(code)}` : code;
    if (!long) opt.title = currencyName(code);
    return opt;
  }

  function fillCurrencySelects() {
    const codes = Object.keys(fx.data.rates);
    const sorted = [
      ...PREFERRED.filter((c) => codes.includes(c)),
      ...codes.filter((c) => !PREFERRED.includes(c)).sort(),
    ];
    for (const select of [el.currency, el.displayCurrency]) {
      const current = select.value;
      select.replaceChildren(...sorted.map((c) => currencyOption(c, select === el.displayCurrency)));
      select.value = codes.includes(current) ? current : 'PLN';
    }
  }

  /** PLN per unit of `code`, or null when the rate isn't available. */
  function rateOf(code) {
    if (code === 'PLN') return 1;
    return (fx.data && fx.data.rates[code]) || null;
  }

  function renderFxInfo(state) {
    const used = [...new Set([state.currency, state.displayCurrency])].filter((c) => c !== 'PLN');
    const box = el.fxInfo;
    box.hidden = used.length === 0;
    box.classList.remove('is-error');
    if (box.hidden) return;

    if (fx.status === 'loading' && !fx.data) {
      box.innerHTML = '<span>Loading exchange rates from NBP…</span>';
      return;
    }
    if (!fx.data) {
      box.classList.add('is-error');
      box.innerHTML = `<span>Couldn't load exchange rates from NBP. Check your internet connection.</span>
        <button type="button" data-fx-retry>Try again</button>`;
      return;
    }

    const date = fmtDate.format(new Date(`${fx.data.date}T00:00:00`));
    const lines = used.map((c) => (rateOf(c)
      ? `<span class="fx-rate">1 ${c} = ${fmtRate.format(rateOf(c))} PLN</span>`
      : `<span class="fx-rate">${c}: no NBP rate</span>`)).join('');
    const stale = fx.status === 'stale'
      ? `<span>Couldn't reach NBP, so these are the last saved rates.</span>
         <button type="button" data-fx-retry>Try again</button>`
      : '';
    box.innerHTML = `${lines}
      <span>NBP average rate, table <a href="https://nbp.pl/en/statistic-and-financial-reporting/rates/table-a/" target="_blank" rel="noopener">${fx.data.no}</a> of ${date}</span>
      ${stale}`;
    if (stale) box.classList.add('is-error');
  }

  // --- Render --------------------------------------------------------------
  function update() {
    const state = readInputs();
    save(state);
    el.birthdayField.hidden = !state.young;
    el.authorField.hidden = !state.author;
    el.authorHelp.textContent = state.authorShare === 100
      ? "Your whole salary is creative work, so only author's costs apply (no standard 250/300 PLN)."
      : 'As stated in your contract or timesheet. The standard work costs still apply to the rest of the salary.';

    renderFxInfo(state);
    const inRate = rateOf(state.currency);
    const outRate = rateOf(state.displayCurrency);
    if (!inRate || !outRate) {
      renderUnavailable(fx.status === 'loading' ? 'Loading exchange rates…' : 'Exchange rate unavailable');
      return;
    }
    display = { code: state.displayCurrency, rate: outRate };

    // Taxes are always calculated in złoty.
    const grossPln = Fx.toPln(state.gross, inRate);
    el.grossHelp.textContent = state.currency === 'PLN'
      ? 'The amount from your contract, before any deductions.'
      : `≈ ${plnMoney(grossPln)} gross per month in złoty.`;
    el.tableCurrency.textContent = `Amounts in ${display.code}.`;

    const reliefMonths = state.young ? state.birthday : 0;
    const result = calculateYear({
      gross: grossPln,
      youngReliefMonths: reliefMonths,
      elevatedKup: state.elevated,
      pit2: state.pit2,
      authorShare: state.author ? state.authorShare : 0,
    });

    renderKpis(result);
    renderSplit(result.totals);
    renderTable(result, reliefMonths);
  }

  function renderKpis({ months, totals }) {
    const nets = months.map((m) => m.net);
    const min = Math.min(...nets);
    const max = Math.max(...nets);
    const deductions = totals.gross - totals.net;

    if (totals.gross === 0) {
      $('kpi-month-label').textContent = 'Net per month';
      $('kpi-month').textContent = money(0);
      $('kpi-month-note').textContent = 'Enter your gross salary';
    } else if (min === max) {
      $('kpi-month-label').textContent = 'Net per month';
      $('kpi-month').textContent = money(min);
      $('kpi-month-note').textContent = 'The same every month';
    } else {
      $('kpi-month-label').textContent = 'Average net per month';
      $('kpi-month').textContent = money(totals.net / 12);
      $('kpi-month-note').textContent = `Varies from ${money(min)} to ${money(max)}`;
    }

    if (display.code !== 'PLN' && totals.gross) {
      $('kpi-month-note').textContent += ` · ${plnMoney(min === max ? min : totals.net / 12)}`;
    }

    $('kpi-year').textContent = money(totals.net);
    $('kpi-year-note').textContent = `from ${money(totals.gross)} gross`;
    $('kpi-deductions').textContent = money(deductions);
    $('kpi-deductions-note').textContent = totals.gross
      ? `${fmtPct.format(deductions / totals.gross)} of gross`
      : '';
  }

  function renderUnavailable(message) {
    $('kpi-month-label').textContent = 'Net per month';
    for (const id of ['kpi-month', 'kpi-year', 'kpi-deductions']) $(id).textContent = '–';
    $('kpi-month-note').textContent = message;
    $('kpi-year-note').textContent = '';
    $('kpi-deductions-note').textContent = '';
    $('split-bar').replaceChildren();
    $('legend').replaceChildren();
    $('months-body').innerHTML = `<tr><td colspan="11" class="muted">${message}</td></tr>`;
    $('months-foot').replaceChildren();
  }

  function renderSplit(totals) {
    const bar = $('split-bar');
    const legend = $('legend');
    bar.replaceChildren();
    legend.replaceChildren();

    const parts = SEGMENTS.map((s) => ({ ...s, value: totals[s.key] }));
    const label = parts.map((p) => `${p.label} ${money(p.value)}`).join(', ');
    bar.setAttribute('aria-label', totals.gross ? `Annual split: ${label}` : 'No data');

    for (const p of parts) {
      const share = totals.gross ? p.value / totals.gross : 0;
      if (share > 0) {
        const seg = document.createElement('span');
        seg.className = `seg seg-${p.key}`;
        seg.style.flexGrow = String(p.value);
        seg.title = `${p.label}: ${money(p.value)} (${fmtPct.format(share)})`;
        if (share >= 0.07) seg.textContent = fmtPct.format(share);
        bar.appendChild(seg);
      }

      const li = document.createElement('li');
      li.innerHTML = `
        <span class="swatch seg-${p.key}" aria-hidden="true"></span>
        <span class="legend-text">
          <span class="legend-label">${p.label}</span>
          <span class="legend-hint">${p.hint}</span>
        </span>
        <span class="legend-value">
          <strong>${money(p.value)}</strong>
          <small>${fmtPct.format(share)}</small>
        </span>`;
      legend.appendChild(li);
    }
  }

  const EVENT_TEXT = {
    reliefLimit: 'Young relief limit reached — PIT starts',
    highBracket: 'Crossed 120 000 PLN — 32% bracket',
    zusCap: 'ZUS cap reached — no more pension & disability',
    authorCap: "Author's costs limit (120 000 PLN) reached",
  };

  function renderTable({ months, totals }, reliefMonths) {
    const body = $('months-body');
    body.replaceChildren();

    for (const m of months) {
      const notes = m.events.filter((e) => EVENT_TEXT[e]).map((e) => EVENT_TEXT[e]);
      if (reliefMonths > 0 && reliefMonths < 12 && m.month === reliefMonths + 1) {
        notes.unshift('You turn 26 — relief ends');
      }

      const tr = document.createElement('tr');
      if (notes.length) tr.className = 'has-event';
      tr.innerHTML = `
        <th scope="row">
          ${MONTHS[m.month - 1]}
          ${m.reliefActive && m.exempt > 0 ? '<span class="tag tag-young" title="Covered by the relief for young people">ulga</span>' : ''}
        </th>
        <td class="num">${num(m.gross)}</td>
        <td class="num">${num(m.pension)}</td>
        <td class="num">${num(m.disability)}</td>
        <td class="num">${num(m.sickness)}</td>
        <td class="num">${num(m.health)}</td>
        <td class="num muted"${costTitle(m)}>${num(m.kup)}</td>
        <td class="num muted">${num(m.taxBase)}</td>
        <td class="num">${num(m.tax)}</td>
        <td class="num net">${num(m.net)}</td>
        <td class="bar-col">${miniBar(m)}</td>`;
      body.appendChild(tr);

      if (notes.length) {
        const noteRow = document.createElement('tr');
        noteRow.className = 'event-row';
        noteRow.innerHTML = `<td colspan="11">${notes.map((n) => `<span class="event">${n}</span>`).join('')}</td>`;
        body.appendChild(noteRow);
      }
    }

    $('months-foot').innerHTML = `
      <tr>
        <th scope="row">Year</th>
        <td class="num">${num(totals.gross)}</td>
        <td class="num">${num(totals.pension)}</td>
        <td class="num">${num(totals.disability)}</td>
        <td class="num">${num(totals.sickness)}</td>
        <td class="num">${num(totals.health)}</td>
        <td class="num muted"${costTitle(totals)}>${num(totals.kup)}</td>
        <td class="num muted">${num(totals.taxBase)}</td>
        <td class="num">${num(totals.tax)}</td>
        <td class="num net">${num(totals.net)}</td>
        <td class="bar-col"></td>
      </tr>`;
  }

  function costTitle(m) {
    if (!m.kupAuthor) return '';
    return ` title="Standard ${num(m.kupStandard)} + author's ${num(m.kupAuthor)}"`;
  }

  function miniBar(m) {
    if (!m.gross) return '';
    return `<span class="mini-bar" aria-hidden="true">${SEGMENTS.map((s) =>
      m[s.key] > 0 ? `<span class="seg seg-${s.key}" style="flex-grow:${m[s.key]}"></span>` : '',
    ).join('')}</span>`;
  }
})();
