/*
 * NettoPL — gross-to-net salary calculation for an employment contract
 * (umowa o pracę) in Poland. Pure functions, no DOM access.
 *
 * All money is handled internally in grosze (integers) to avoid floating-point
 * drift, and converted back to PLN in the returned result.
 *
 * Works both in the browser (exposes window.NettoCalc) and in Node (module.exports),
 * so the page can be opened straight from disk without a build step.
 */
(function (root) {
  'use strict';

  /** Tax and contribution parameters for 2026. */
  const PARAMS_2026 = {
    year: 2026,
    // Employee social security (ZUS) rates
    pensionRate: 0.0976, // emerytalne
    disabilityRate: 0.015, // rentowe
    sicknessRate: 0.0245, // chorobowe
    healthRate: 0.09, // składka zdrowotna
    // Annual cap on the pension + disability base: 30 × projected average wage (9 420 PLN)
    pensionCap: 282600,
    // PIT scale
    taxRateLow: 0.12,
    taxRateHigh: 0.32,
    taxThreshold: 120000,
    monthlyTaxReduction: 300, // kwota zmniejszająca podatek (1/12 of 3 600)
    // Monthly deductible costs (koszty uzyskania przychodu)
    kupStandard: 250,
    kupElevated: 300, // working away from place of residence
    // Author's costs (autorskie koszty uzyskania przychodu): 50% of creative revenue,
    // capped per year (art. 22 ust. 9a ustawy o PIT)
    authorCostRate: 0.5,
    authorCostLimit: 120000,
    // Tax relief for young people (ulga dla młodych / PIT-0)
    youngReliefLimit: 85528,
  };

  const toGr = (pln) => Math.round(pln * 100);
  const toPln = (gr) => gr / 100;
  /** Round grosze to full złoty (Ordynacja podatkowa: < 50 gr down, ≥ 50 gr up). */
  const roundToZloty = (gr) => Math.round(gr / 100) * 100;

  /**
   * Calculate a full year, month by month.
   *
   * @param {object} input
   * @param {number|number[]} input.gross    Monthly gross in PLN, or 12 values (one per month).
   * @param {number} [input.youngReliefMonths=0]  Number of months (from January) covered by the
   *                                              young people's relief: 0 = none, 12 = whole year.
   * @param {boolean} [input.elevatedKup=false]   Higher work costs (commuting from another town).
   * @param {number} [input.authorShare=0]       Percentage (0–100) of salary paid for creative work
   *                                              (copyright), eligible for 50% author's costs.
   * @param {boolean} [input.pit2=true]           Employer applies the monthly tax-reducing amount.
   * @param {object} [params=PARAMS_2026]
   */
  function calculateYear(input, params = PARAMS_2026) {
    const p = params;
    const grossList = Array.isArray(input.gross)
      ? input.gross
      : new Array(12).fill(input.gross);
    if (grossList.length !== 12) throw new Error('gross must be a number or 12 values');

    const reliefMonths = Math.max(0, Math.min(12, input.youngReliefMonths || 0));
    const kupGr = toGr(input.elevatedKup ? p.kupElevated : p.kupStandard);
    const reductionGr = input.pit2 === false ? 0 : toGr(p.monthlyTaxReduction);
    const capGr = toGr(p.pensionCap);
    const reliefLimitGr = toGr(p.youngReliefLimit);
    const thresholdGr = toGr(p.taxThreshold);
    const authorShare = Math.max(0, Math.min(100, Number(input.authorShare) || 0)) / 100;
    const authorLimitGr = toGr(p.authorCostLimit);

    let cumPensionBase = 0;
    let cumExempt = 0;
    let cumTaxBase = 0;
    let cumAuthorCost = 0;

    const months = grossList.map((grossPln, i) => {
      const g = Math.max(0, toGr(Number(grossPln) || 0));
      const events = [];

      // --- Social security (ZUS) ---
      const pensionBase = Math.min(g, Math.max(0, capGr - cumPensionBase));
      if (g > 0 && pensionBase < g && cumPensionBase < capGr) events.push('zusCap');
      else if (g > 0 && pensionBase === 0) events.push('zusCapped');
      cumPensionBase += g;

      const pension = Math.round(pensionBase * p.pensionRate);
      const disability = Math.round(pensionBase * p.disabilityRate);
      const sickness = Math.round(g * p.sicknessRate);
      const social = pension + disability + sickness;

      // --- Health insurance: 9% of gross minus social contributions, not tax-deductible ---
      const health = Math.round((g - social) * p.healthRate);

      // --- Young people's relief: revenue exempt up to the annual limit ---
      let exempt = 0;
      const reliefActive = i < reliefMonths;
      if (reliefActive) {
        exempt = Math.min(g, Math.max(0, reliefLimitGr - cumExempt));
        if (exempt < g && cumExempt < reliefLimitGr && exempt > 0) events.push('reliefLimit');
        else if (exempt === 0 && g > 0) events.push('reliefUsed');
        cumExempt += exempt;
      }
      const taxableRevenue = g - exempt;

      // --- Income tax advance (zaliczka na PIT) ---
      let kup = 0;
      let kupStandard = 0;
      let kupAuthor = 0;
      let socialDeducted = 0;
      let taxBase = 0;
      let tax = 0;
      if (taxableRevenue > 0) {
        // Only the contributions attributable to the taxable part of revenue are deductible.
        socialDeducted =
          taxableRevenue === g ? social : Math.round((social * taxableRevenue) / g);
        // Standard monthly costs cover the non-creative part of the salary. When the whole
        // salary is creative work, only the author's costs apply.
        if (authorShare < 1) kupStandard = Math.min(kupGr, taxableRevenue);
        if (authorShare > 0) {
          // 50% of creative revenue after the social contributions attributable to it.
          const creativeRevenue = Math.round(taxableRevenue * authorShare);
          const creativeSocial = Math.round(socialDeducted * authorShare);
          const due = Math.round(Math.max(0, creativeRevenue - creativeSocial) * p.authorCostRate);
          const room = Math.max(0, authorLimitGr - cumAuthorCost);
          kupAuthor = Math.min(due, room);
          if (due > 0 && room > 0 && due >= room) events.push('authorCap');
          cumAuthorCost += kupAuthor;
        }
        kup = kupStandard + kupAuthor;
        taxBase = roundToZloty(Math.max(0, taxableRevenue - kup - socialDeducted));

        const lowPart = Math.min(taxBase, Math.max(0, thresholdGr - cumTaxBase));
        const highPart = taxBase - lowPart;
        if (highPart > 0) events.push(lowPart > 0 ? 'highBracket' : 'inHighBracket');
        cumTaxBase += taxBase;

        const grossTax = lowPart * p.taxRateLow + highPart * p.taxRateHigh - reductionGr;
        tax = Math.max(0, roundToZloty(grossTax));
      }

      const net = g - social - health - tax;

      return {
        month: i + 1,
        gross: toPln(g),
        pension: toPln(pension),
        disability: toPln(disability),
        sickness: toPln(sickness),
        social: toPln(social),
        health: toPln(health),
        exempt: toPln(exempt),
        kup: toPln(kup),
        kupStandard: toPln(kupStandard),
        kupAuthor: toPln(kupAuthor),
        taxBase: toPln(taxBase),
        tax: toPln(tax),
        net: toPln(net),
        reliefActive,
        events,
      };
    });

    const sum = (key) => toPln(months.reduce((acc, m) => acc + toGr(m[key]), 0));
    const totals = {};
    for (const key of ['gross', 'pension', 'disability', 'sickness', 'social', 'health',
      'exempt', 'kup', 'kupStandard', 'kupAuthor', 'taxBase', 'tax', 'net']) {
      totals[key] = sum(key);
    }

    return { params: p, months, totals };
  }

  const api = { PARAMS_2026, calculateYear };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NettoCalc = api;
})(typeof self !== 'undefined' ? self : this);
