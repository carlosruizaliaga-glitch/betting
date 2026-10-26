// Comprueba los mercados nuevos: doble oportunidad, empate no vale, ambos marcan y otras líneas de goles.
import assert from 'assert';
import { derivedMarkets, buildExtras, settleOutcome, closingFairFor, pinnacleFair, outcomeName, devig } from '../supabase/functions/bt-picks/picks.js';

const close = (a, b, e = 1e-9) => Math.abs(a - b) < e;

// ---------- Derivados del 1X2 ----------
const prob = { '1': 0.5, 'X': 0.3, '2': 0.2 };
const d = derivedMarkets(prob);
assert(close(d.dc.fair_prob['1X'], 0.8) && close(d.dc.fair_prob['12'], 0.7) && close(d.dc.fair_prob['X2'], 0.5));
assert(close(d.dc.fair_odds['X2'], 2));
assert(close(d.dnb.fair_prob['1'], 0.5 / 0.7) && close(d.dnb.fair_prob['1'] + d.dnb.fair_prob['2'], 1));
assert.strictEqual(derivedMarkets({ '1': 0.6, '2': 0.4 }), null);   // baloncesto/tenis: no hay empate

// ---------- Cierre de apuestas ----------
assert.strictEqual(settleOutcome('dc', '1X', 1, 1), 'W');
assert.strictEqual(settleOutcome('dc', '1X', 0, 2), 'L');
assert.strictEqual(settleOutcome('dc', '12', 1, 1), 'L');
assert.strictEqual(settleOutcome('dc', 'X2', 0, 3), 'W');
assert.strictEqual(settleOutcome('dnb', '1', 2, 0), 'W');
assert.strictEqual(settleOutcome('dnb', '1', 0, 1), 'L');
assert.strictEqual(settleOutcome('dnb', '2', 1, 1), 'V');           // empate: se devuelve
assert.strictEqual(settleOutcome('btts', 'Y', 1, 2), 'W');
assert.strictEqual(settleOutcome('btts', 'Y', 0, 3), 'L');
assert.strictEqual(settleOutcome('btts', 'N', 0, 3), 'W');
assert.strictEqual(settleOutcome('btts', 'N', 0, 0), 'W');
assert.strictEqual(settleOutcome('totals', 'O', 1, 1, 1.5), 'W');   // otras líneas siguen funcionando
assert.strictEqual(settleOutcome('totals', 'U', 2, 1, 3.5), 'W');

// ---------- Extras: ambos marcan y líneas 1,5 / 3,5 ----------
const bk = (key, markets) => ({ key, markets });
const tot = (mkey, rows) => ({ key: mkey, outcomes: rows.flatMap(([pt, o, u]) => [{ name: 'Over', price: o, point: pt }, { name: 'Under', price: u, point: pt }]) });
const btts = (y, n) => ({ key: 'btts', outcomes: [{ name: 'Yes', price: y }, { name: 'No', price: n }] });
const ev = { id: 'e1', home_team: 'A', away_team: 'B', bookmakers: [
  bk('pinnacle', [tot('alternate_totals', [[1.5, 1.4, 3.0], [3.5, 3.0, 1.4]]), btts(1.9, 1.95)]),
  bk('marathonbet', [tot('alternate_totals', [[1.5, 1.55, 2.7], [3.5, 3.0, 1.4]]), btts(2.05, 1.8)]),
  bk('williamhill', [tot('alternate_totals', [[2.5, 2.0, 1.9]])])] };
const ex = buildExtras(ev, 'mult', 3);
assert.deepStrictEqual(ex.lines.map(l => l.point), [1.5, 3.5]);
const l15 = ex.lines[0];
assert(close(l15.fair_prob.O + l15.fair_prob.U, 1));
assert.strictEqual(l15.best.O.book, 'Marathonbet');
assert.strictEqual(l15.value_outcome, 'O');                          // 1,55 contra justa ≈ 1,47
assert.strictEqual(ex.btts.best.Y.book, 'Marathonbet');
assert(close(ex.btts.fair_prob.Y + ex.btts.fair_prob.N, 1));
assert.strictEqual(ex.btts.value_outcome, 'Y');                      // 2,05 contra justa ≈ 1,96
assert.strictEqual(buildExtras({ ...ev, bookmakers: [bk('williamhill', [])] }, 'mult', 3).btts, null);   // sin Pinnacle ni Betfair: sin precio justo

// ---------- Cuota de cierre según el mercado ----------
const closing = { fair_prob: prob, fair_odds: { '1': 2, 'X': 1 / 0.3, '2': 5 }, totals: { point: 1.5, fair_odds: { O: 1.4, U: 3.5 } }, btts: { fair_odds: { Y: 1.9, N: 2.1 } } };
assert.strictEqual(closingFairFor(closing, { pickMarket: 'h2h', pickOutcome: '1' }), 2);
assert.strictEqual(closingFairFor(closing, { pickMarket: 'totals', pickOutcome: 'O', point: 1.5 }), 1.4);
assert.strictEqual(closingFairFor(closing, { pickMarket: 'totals', pickOutcome: 'O', point: 2.5 }), null);
assert.strictEqual(closingFairFor(closing, { pickMarket: 'btts', pickOutcome: 'N' }), 2.1);
assert(close(closingFairFor(closing, { pickMarket: 'dc', pickOutcome: '1X' }), 1 / 0.8));
assert(close(closingFairFor(closing, { pickMarket: 'dnb', pickOutcome: '2' }), 0.7 / 0.2));
assert.strictEqual(closingFairFor({ missed: true }, { pickMarket: 'h2h', pickOutcome: '1' }), null);

// pinnacleFair guarda la línea alternativa y ambos marcan
const pf = pinnacleFair({ home_team: 'A', away_team: 'B', bookmakers: [bk('pinnacle', [
  { key: 'h2h', outcomes: [{ name: 'A', price: 2.0 }, { name: 'Draw', price: 3.4 }, { name: 'B', price: 4.0 }] },
  tot('alternate_totals', [[1.5, 1.4, 3.0]]), btts(1.9, 1.95)])] }, 'mult', 1.5, true);
assert(pf.totals && pf.totals.point === 1.5 && pf.btts && close(pf.btts.fair_prob.Y + pf.btts.fair_prob.N, 1));

// ---------- Nombres ----------
const p = { home: 'Girona', away: 'Betis' };
assert.strictEqual(outcomeName(p, '1X', 'dc'), 'Girona o empate');
assert.strictEqual(outcomeName(p, '12', 'dc'), 'Girona o Betis');
assert.strictEqual(outcomeName(p, '2', 'dnb'), 'Betis (empate nula)');
assert.strictEqual(outcomeName(p, 'Y', 'btts'), 'Ambos marcan: sí');
assert.strictEqual(outcomeName(p, '1'), 'Girona');
console.log('OK extras · doble oportunidad, empate no vale, ambos marcan, líneas y cierre');
