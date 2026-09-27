// Comprobación de la migración: los números deben coincidir con la hoja Betting.xlsx.
const L = require('../logic.js');
const assert = require('assert');
const mk = (n, d, sel, lvl, stake, odds, result) => ({ id: 'b' + n, date: d, book: 'bet365', sport: '⚽', type: '1X2', tipster: 'Carlos', level: lvl, stake, odds, result, created: n, legs: [{ sel, odds }] });
const bets = [
  mk(1, '2026-09-24', 'Noruega', 4, 0.60, 1.80, 'W'), mk(2, '2026-09-24', 'Polonia', 5, 0.72, 1.66, 'L'),
  mk(3, '2026-09-24', 'Francia', 6, 0.82, 1.42, 'W'), mk(4, '2026-09-24', 'Austria', 6, 0.77, 1.45, 'W'),
  mk(5, '2026-09-24', 'Girona', 5, 0.60, 1.50, 'W'), mk(6, '2026-09-24', 'Tenerife', 3, 0.34, 1.90, 'L'),
  mk(7, '2026-09-24', 'Valladolid', 3, 0.33, 2.20, 'P'), mk(8, '2026-09-24', 'Mallorca', 3, 0.32, 1.95, 'P'),
  mk(9, '2026-09-26', 'España', 8, 1.18, 2.05, 'W')];
const moves = [{ id: 'm1', date: '2026-09-24', book: 'bet365', type: 'deposit', amount: 15, created: 0 }];

const s = L.summarize(bets);
assert.deepStrictEqual([s.n, s.w, s.l, s.risk, s.profit], [7, 5, 2, 5.03, 1.65]);
assert.strictEqual(Math.round(s.yield * 10000) / 10000, 0.328);
const f = L.funds(bets, moves).total;
assert.deepStrictEqual([f.net, f.pendingRisk, f.pendingN, f.available], [15, 0.65, 2, 16]);
// Profits fila a fila como en la hoja
assert.deepStrictEqual(bets.map(L.profit), [0.48, -0.72, 0.34, 0.35, 0.3, -0.34, 0, 0, 1.24]);
const p = L.peaks(bets);
assert.deepStrictEqual([p.current, p.max, p.min], [1.65, 1.65, -0.24]);
// Stake por nivel: el 24/09 cada apuesta se hizo con las anteriores aún pendientes;
// el 26/09 (España) las 6 primeras ya estaban cerradas.
const exp = bets.map((b, i) => {
  const before = bets.slice(0, i).map(x => b.date === '2026-09-24' ? Object.assign({}, x, { result: 'P' }) : x);
  return L.stakeFor(L.funds(before, moves).total.available, b.level, 1);
});
assert.deepStrictEqual(exp, bets.map(b => b.stake));
// Otros resultados
const b = { stake: 10, odds: 2, bonus: false };
assert.strictEqual(L.profit({ ...b, result: 'V' }), 0);
assert.strictEqual(L.profit({ ...b, result: 'HW' }), 5);
assert.strictEqual(L.profit({ ...b, result: 'HL' }), -5);
assert.strictEqual(L.profit({ ...b, result: 'CO', cashout: 13.5 }), 3.5);
assert.strictEqual(L.profit({ ...b, bonus: true, result: 'W' }), 10);
assert.strictEqual(L.profit({ ...b, bonus: true, result: 'L' }), 0);
assert.strictEqual(L.comboOdds([{ odds: 1.5 }, { odds: 2 }]), 3);
assert.deepStrictEqual(L.streak(bets), { type: 'W', n: 1 });
assert.strictEqual(L.weekStart('2026-09-27'), '2026-09-21');
console.log('OK · cerradas', s.n, '(' + s.w + 'G/' + s.l + 'P) · stake', s.risk, '· beneficio', s.profit, '· yield', (s.yield * 100).toFixed(1) + '%',
  '· disponible', f.available, '· pendiente', f.pendingRisk, '· mín', p.min, '· stakes por nivel OK');
