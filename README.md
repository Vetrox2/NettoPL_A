# NettoPL

Gross-to-net salary calculator for an employment contract (*umowa o pracę*) in Poland.
Enter your monthly gross salary and see what you take home, with a month-by-month
breakdown for the whole year: social security (ZUS), health insurance and income tax (PIT).

Supports:

- **Tax relief for young people** (*ulga dla młodych*, PIT-0): no PIT on up to 85 528 PLN of pay per year
  for people under 26, including the month you turn 26.
- **Higher work costs** (*podwyższone koszty uzyskania przychodu*): 300 PLN instead of 250 PLN
  per month when you commute from another town.
- **Author's costs** (*50% koszty autorskie*, KUP50): choose what percentage of your salary is creative work;
  50% of that part (after ZUS) is deducted as costs, up to 120 000 PLN per year. Standard costs still apply
  to the rest of the salary.
- **Other currencies**: enter your salary in any of the 32 currencies in NBP table A and/or show the results
  in one. Rates come from the public [NBP API](https://api.nbp.pl/) (average rate, table A), fetched once a day
  and saved in the browser for offline use. The rate and table number used are shown next to the form.
  Tax is always calculated in złoty.
- **PIT-2** on/off (monthly 300 PLN tax-reducing amount).
- The 120 000 PLN threshold (32% bracket) and the annual ZUS pension/disability cap (282 600 PLN in 2026),
  highlighted in the month they kick in.

Frontend only, no build step, no backend. The only network request is to the NBP API, and only for exchange rates. Your inputs are remembered in your browser's `localStorage`.

## Run

Open `index.html` in a browser. Or serve the folder:

```sh
npm start        # npx serve .
```

## Test

```sh
npm test         # node --test, needs Node 18+
```

## Structure

| File | What it does |
| --- | --- |
| `js/calc.js` | Pure calculation (2026 parameters in `PARAMS_2026`), works in the browser and in Node |
| `js/currency.js` | NBP exchange rates: fetch, daily cache, conversion |
| `js/app.js` | Form handling, rendering, `localStorage` |
| `css/styles.css` | Styles, light and dark theme |
| `tests/*.test.js` | Calculation and exchange-rate tests |

Tax rules for a new year: add a new parameter set next to `PARAMS_2026` in `js/calc.js`.
