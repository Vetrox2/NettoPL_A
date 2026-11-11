const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateYear } = require('../js/calc.js');

test('standard 10 000 PLN gross', () => {
  const m = calculateYear({ gross: 10000 }).months[0];
  assert.equal(m.pension, 976);
  assert.equal(m.disability, 150);
  assert.equal(m.sickness, 245);
  assert.equal(m.health, 776.61);
  assert.equal(m.taxBase, 8379);
  assert.equal(m.tax, 705);
  assert.equal(m.net, 7147.39);
});

test('elevated work costs (300 PLN) lower the tax', () => {
  const m = calculateYear({ gross: 10000, elevatedKup: true }).months[0];
  assert.equal(m.kup, 300);
  assert.equal(m.tax, 699);
  assert.equal(m.net, 7153.39);
});

test('no PIT-2: tax-reducing amount not applied monthly', () => {
  const m = calculateYear({ gross: 10000, pit2: false }).months[0];
  assert.equal(m.tax, 1005);
});

test('young relief below the limit: no PIT all year', () => {
  const r = calculateYear({ gross: 5000, youngReliefMonths: 12 });
  assert.equal(r.totals.tax, 0);
  assert.equal(r.months[0].health, 388.31);
  assert.equal(r.months[0].net, 3926.19);
});

test('young relief limit exceeded in September', () => {
  const r = calculateYear({ gross: 10000, youngReliefMonths: 12 });
  for (let i = 0; i < 8; i++) assert.equal(r.months[i].tax, 0);
  const sep = r.months[8];
  assert.equal(sep.exempt, 5528);
  assert.equal(sep.taxBase, 3609);
  assert.equal(sep.tax, 133);
  assert.ok(sep.events.includes('reliefLimit'));
  assert.equal(r.months[9].tax, 705);
  assert.equal(r.totals.exempt, 85528);
});

test('relief ends when turning 26 (partial year)', () => {
  const r = calculateYear({ gross: 5000, youngReliefMonths: 4 });
  assert.equal(r.months[3].tax, 0);
  assert.ok(r.months[4].tax > 0);
});

test('crossing the 120 000 PLN threshold', () => {
  const r = calculateYear({ gross: 20000 });
  assert.equal(r.months[6].tax, toTax(17008 * 0.12));
  assert.equal(r.months[7].tax, 4954);
  assert.ok(r.months[7].events.includes('highBracket'));
  assert.equal(r.months[8].tax, toTax(17008 * 0.32));
});

test('pension/disability cap (30× average wage)', () => {
  const r = calculateYear({ gross: 30000 });
  assert.equal(r.months[8].pension, 2928);
  assert.equal(r.months[9].pension, Math.round(12600 * 0.0976 * 100) / 100);
  assert.ok(r.months[9].events.includes('zusCap'));
  assert.equal(r.months[10].pension, 0);
  assert.equal(r.months[10].disability, 0);
  assert.equal(r.months[10].sickness, 735);
});

test('totals equal sum of months', () => {
  const r = calculateYear({ gross: 12345.67, youngReliefMonths: 6, elevatedKup: true });
  const net = r.months.reduce((a, m) => a + Math.round(m.net * 100), 0) / 100;
  assert.equal(r.totals.net, net);
  assert.equal(
    Math.round((r.totals.gross - r.totals.social - r.totals.health - r.totals.tax) * 100) / 100,
    r.totals.net,
  );
});

function toTax(x) { return Math.max(0, Math.round(x - 300)); }

test("author's costs: 50% of the creative share after ZUS", () => {
  // 10 000 gross, 80% creative: creative revenue 8000, its ZUS 1096.80 → costs 3451.60
  const m = calculateYear({ gross: 10000, authorShare: 80 }).months[0];
  assert.equal(m.kupAuthor, 3451.6);
  assert.equal(m.kupStandard, 250);
  assert.equal(m.kup, 3701.6);
  assert.equal(m.taxBase, 4927); // 10000 - 1371 - 3701.60 = 4927.40
  assert.equal(m.tax, 291); // 591.24 - 300
});

test("author's costs at 100%: no standard 250 PLN costs", () => {
  const m = calculateYear({ gross: 10000, authorShare: 100, elevatedKup: true }).months[0];
  assert.equal(m.kupStandard, 0);
  assert.equal(m.kupAuthor, 4314.5);
});

test("author's costs capped at 120 000 PLN per year", () => {
  const r = calculateYear({ gross: 40000, authorShare: 100 });
  // monthly due: (40000 - 5484) / 2 = 17258 → cap hit in month 7
  assert.equal(r.months[5].kupAuthor, 17258);
  assert.equal(r.months[6].kupAuthor, 120000 - 6 * 17258);
  assert.ok(r.months[6].events.includes('authorCap'));
  assert.equal(r.months[7].kupAuthor, 0);
  assert.equal(r.totals.kupAuthor, 120000);
});

test("author's costs only on the taxable part under the young relief", () => {
  const r = calculateYear({ gross: 10000, youngReliefMonths: 12, authorShare: 100 });
  assert.equal(r.months[0].kupAuthor, 0);
  assert.ok(r.months[8].kupAuthor > 0 && r.months[8].kupAuthor < r.months[9].kupAuthor);
});
