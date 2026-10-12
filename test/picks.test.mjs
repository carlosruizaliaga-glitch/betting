// Comprueba el quitado de margen, el consenso, el valor, Más/Menos, 2 resultados y el mensaje de Telegram.
import assert from 'assert';
import { devig, buildPicks, formatMessages, minOdds, pinnacleFair, clv, moveOf, outcomeName, hasValue } from '../supabase/functions/bt-picks/picks.js';

const sum = o => Object.values(o).reduce((a, b) => a + b, 0);
const close = (a, b, e = 1e-9) => Math.abs(a - b) < e;

// ---------- Quitar margen ----------
const pin = { '1': 2.15, 'X': 3.55, '2': 3.45 };
const m = devig(pin, 'mult'), p = devig(pin, 'power');
assert(close(sum(m), 1) && close(sum(p), 1));
assert(p['1'] > m['1'] && p['X'] < m['X']);   // power: el favorito sube, los no favoritos bajan
const two = devig({ '1': 1.5, '2': 2.7 }, 'power');
assert(close(sum(two), 1) && Object.keys(two).join() === '1,2');

// ---------- Fútbol 1X2 ----------
const h2hBook = (key, h, a, o) => ({ key, markets: [{ key: 'h2h', outcomes: [{ name: h, price: o[0] }, { name: 'Draw', price: o[1] }, { name: a, price: o[2] }] }] });
const totBook = (key, point, over, under) => ({ key: 'totals', outcomes: [{ name: 'Over', price: over, point }, { name: 'Under', price: under, point }] });
const now = new Date('2026-10-01T00:00:00Z');
const ev = { id: 'e1', home_team: 'Girona', away_team: 'Betis', commence_time: '2026-10-04T16:30:00Z',
  bookmakers: [h2hBook('pinnacle', 'Girona', 'Betis', [2.15, 3.55, 3.45]), h2hBook('marathonbet', 'Girona', 'Betis', [2.35, 3.5, 3.3]),
    h2hBook('sport888', 'Girona', 'Betis', [2.1, 3.6, 3.4])] };

// Solo Pinnacle → igual que antes (45 % / 27 % / 28 %).
const [pk] = buildPicks([ev], { league: 'LaLiga', sportKey: 'soccer_spain_la_liga', threshold: 3, now });
assert.deepStrictEqual(pk.fair_src, ['pinnacle']);
assert.strictEqual(pk.sport, 'soccer');
assert.strictEqual(pk.favorite, '1');
assert.strictEqual(pk.best['1'].book, 'Marathonbet');
assert.strictEqual(pk.value_outcome, '1');
assert.strictEqual(pk.totals, null);

// Con exchange de Betfair líquido → consenso de las dos fuentes; neto de 5 % de comisión.
const evBf = { ...ev, bookmakers: ev.bookmakers.concat([h2hBook('betfair_ex_eu', 'Girona', 'Betis', [2.2, 3.9, 3.6])]) };
const [pkBf] = buildPicks([evBf], { league: 'LaLiga', sportKey: 'soccer_spain_la_liga', threshold: 3, now });
assert.deepStrictEqual(pkBf.fair_src, ['pinnacle', 'betfair']);
assert(close(sum(pkBf.fair_prob), 1));
const pPin = devig(pin, 'power'), pBf = devig({ '1': 2.2, 'X': 3.9, '2': 3.6 }, 'power');
assert(close(pkBf.fair_prob['1'], (pPin['1'] + pBf['1']) / 2, 1e-6));
assert.strictEqual(pkBf.best['X'].odds, 3.76);
// Exchange sin liquidez (mucho margen) → no entra en el consenso.
const evThin = { ...ev, bookmakers: ev.bookmakers.concat([h2hBook('betfair_ex_eu', 'Girona', 'Betis', [1.9, 3.2, 3.1])]) };
assert.deepStrictEqual(buildPicks([evThin], { league: 'x', sportKey: 'soccer_x', now })[0].fair_src, ['pinnacle']);

// ---------- Más/Menos 2,5 ----------
const withTot = { ...ev, bookmakers: [
  { key: 'pinnacle', markets: [ev.bookmakers[0].markets[0], totBook('pinnacle', 2.5, 1.95, 1.95)] },
  { key: 'marathonbet', markets: [ev.bookmakers[1].markets[0], totBook('marathonbet', 2.5, 2.1, 1.8)] },
  { key: 'sport888', markets: [ev.bookmakers[2].markets[0], totBook('sport888', 3.5, 3.0, 1.4)] }] };
const [pkT] = buildPicks([withTot], { league: 'LaLiga', sportKey: 'soccer_spain_la_liga', threshold: 3, now, withTotals: true });
assert.strictEqual(pkT.totals.point, 2.5);
assert(close(pkT.totals.fair_prob.O, 0.5));
assert.strictEqual(pkT.totals.best.O.book, 'Marathonbet');           // 888sport es otra línea (3,5): no cuenta
assert.strictEqual(pkT.totals.value_outcome, 'O');                     // 2,10 vs justa 2,00 → +5 %
assert.strictEqual(outcomeName(pkT, 'O'), 'Más 2,5');
assert(hasValue({ value_outcome: null, totals: { value_outcome: 'O' } }));

// ---------- Baloncesto / tenis (2 resultados) ----------
const twoBook = (key, o) => ({ key, markets: [{ key: 'h2h', outcomes: [{ name: 'Lakers', price: o[0] }, { name: 'Celtics', price: o[1] }] }] });
const evNba = { id: 'n1', home_team: 'Lakers', away_team: 'Celtics', commence_time: '2026-10-03T02:00:00Z',
  bookmakers: [twoBook('pinnacle', [1.8, 2.05]), twoBook('williamhill', [1.95, 1.9])] };
const [nba] = buildPicks([evNba], { league: 'NBA', sportKey: 'basketball_nba', threshold: 3, now, withTotals: true });
assert.deepStrictEqual(Object.keys(nba.fair_prob).sort(), ['1', '2']);
assert.strictEqual(nba.sport, 'basketball');
assert.strictEqual(nba.totals, null);                                  // Más/Menos solo en fútbol
assert.strictEqual(nba.value_outcome, '1');
assert.strictEqual(nba.best['1'].book, 'William Hill');

// ---------- Movimiento ----------
assert(close(moveOf({ fair_prob: { '1': 0.48 }, first_fair_prob: { '1': 0.45 } }, '1'), 0.03));
assert.strictEqual(moveOf({ fair_prob: { '1': 0.48 } }, '1'), 0);

// ---------- Mensaje ----------
const msg = formatMessages([{ ...pkT, first_fair_prob: { '1': 0.42, 'X': 0.27, '2': 0.31 } }, nba], { mode: 'all', threshold: 3 });
console.log(msg.join('\n---\n'));
assert(msg[0].includes('DOM 04/10') && msg[0].includes('18:30 · Girona – Betis'));
assert(msg[0].includes('⭐ Marathonbet 2,35 (+6%)') && msg[0].includes('bet365: <b>Girona si ≥ 2,28</b>'));
assert(msg[0].includes('Girona     45%  justa 2,21  ⭐ ↑3') && msg[0].includes('Betis      28%  justa 3,60 ↓3'));
assert(msg[0].includes('Más 2,5    50%  justa 2,00  ⭐') && msg[0].includes('bet365: <b>Más 2,5 si ≥ 2,06</b>'));
assert(msg[0].includes('🏀 <b>NBA') && !/Lakers[^\n]*Empate/.test(msg[0]));
assert.strictEqual(minOdds(8.49, 3), 8.75);
assert.strictEqual(minOdds(2, 0), 2);

// Sin pinnacle ni exchange no hay pick; partidos pasados se ignoran
assert.strictEqual(buildPicks([{ ...ev, bookmakers: ev.bookmakers.slice(1) }], { league: 'x', sportKey: 'soccer_x', now }).length, 0);
assert.strictEqual(buildPicks([ev], { league: 'x', sportKey: 'soccer_x', now: new Date('2026-10-05') }).length, 0);

// ---------- Cierre y CLV (siempre contra Pinnacle) ----------
const closeEv = { ...withTot, bookmakers: [{ key: 'pinnacle', markets: [h2hBook('pinnacle', 'Girona', 'Betis', [2.05, 3.6, 3.7]).markets[0], totBook('pinnacle', 2.5, 1.9, 2.0)] }] };
const c = pinnacleFair(closeEv, 'power', 2.5);
assert(c && close(c.fair_odds['1'], 1 / c.fair_prob['1']));
assert(c.totals && c.totals.point === 2.5 && close(sum(c.totals.fair_prob), 1));
assert.strictEqual(pinnacleFair(closeEv, 'power').totals, undefined);
assert.strictEqual(Math.round(clv(2.3, 2.1) * 1000) / 1000, 0.095);
assert.strictEqual(pinnacleFair({ ...ev, bookmakers: [] }, 'power'), null);
console.log('OK picks · consenso, 2 resultados, Más/Menos, movimiento y CLV');
