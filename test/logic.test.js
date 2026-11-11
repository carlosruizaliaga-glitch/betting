// Comprobación de la migración: los números deben coincidir con la hoja Betting.xlsx.
const L = require('../logic.js');
const assert = require('assert');
const mk = (n, d, sel, lvl, stake, odds, result) => ({ id: 'b' + n, date: d, book: 'bet365', sport: '⚽', type: '1X2', tipster: 'Carlos', level: lvl, stake, odds, result, created: n, legs: [{ sel, odds }] });
const bets = [
  mk(1, '2026-09-24', 'Equipo A', 4, 0.60, 1.80, 'W'), mk(2, '2026-09-24', 'Equipo B', 5, 0.72, 1.66, 'L'),
  mk(3, '2026-09-24', 'Equipo C', 6, 0.82, 1.42, 'W'), mk(4, '2026-09-24', 'Equipo D', 6, 0.77, 1.45, 'W'),
  mk(5, '2026-09-24', 'Equipo E', 5, 0.60, 1.50, 'W'), mk(6, '2026-09-24', 'Equipo F', 3, 0.34, 1.90, 'L'),
  mk(7, '2026-09-24', 'Equipo G', 3, 0.33, 2.20, 'P'), mk(8, '2026-09-24', 'Equipo H', 3, 0.32, 1.95, 'P'),
  mk(9, '2026-09-26', 'Equipo I', 8, 1.18, 2.05, 'W')];
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

// ---------- CLV por grupos y acumulado (fase 4D) ----------
{
  const c = (n, d, league, odds, fair, clv, result) => ({ id: 'c' + n, date: d, created: n, league, stake: 1, odds, fair, clv, result, legs: [{ sel: 'x', odds }] });
  const cb = [c(1, '2026-10-01', 'LaLiga', 2.0, 1.9, 0.04, 'W'), c(2, '2026-10-02', 'LaLiga', 1.8, 1.85, -0.02, 'L'),
    c(3, '2026-10-03', 'Premier', 2.2, 2.0, 0.06, 'L'), { id: 'c4', date: '2026-10-04', result: 'W', stake: 1, odds: 2 }];
  const byL = L.clvBy(cb, b => b.league);
  assert.deepStrictEqual(byL.map(r => [r.key, r.n]), [['LaLiga', 2], ['Premier', 1]]);
  assert(Math.abs(byL[0].avg - 0.01) < 1e-12 && byL[0].pos === 0.5 && byL[0].profit === 0);
  assert.strictEqual(Math.round(L.edgeAtBet(cb[0]) * 1000), 53);
  assert.strictEqual(L.edgeAtBet(cb[3]), null);
  const ser = L.clvSeries(cb);
  assert.deepStrictEqual(ser.map(p => Math.round(p.value * 1000)), [40, 10, 27]);
  const ordered = L.clvBy(cb, b => b.league, ['Premier', 'Serie A']);
  assert.deepStrictEqual(ordered.map(r => r.n), [1, 0]);
  console.log('OK · CLV por grupos y acumulado');
}

{
  // Importe sugerido: Kelly fraccionado traducido a nivel de stake
  const s1 = L.suggestStake(2.35, 2.2, 100, 1, 0.25);        // +6,8 % sobre la justa
  assert(Math.abs(s1.edge - (2.35 / 2.2 - 1)) < 1e-9);
  assert.strictEqual(s1.level, 1);                           // un cuarto de Kelly ≈ 1,3 % de la banca → nivel 1 (mínimo)
  assert.strictEqual(s1.stake, 1);
  const s2 = L.suggestStake(3.4, 2.5, 200, 0.5, 0.25);       // +36 %: ventaja grande, unidad pequeña
  assert(s2.level > 1 && s2.level <= 5);
  const s3 = L.suggestStake(1.95, 2.0, 100, 1, 0.25);        // por debajo de la justa: no apostar
  assert.strictEqual(s3.level, 0); assert.strictEqual(s3.stake, 0);
  assert.strictEqual(L.suggestStake(null, 2, 100, 1, 0.25), null);
  console.log('OK · importe sugerido');
}

{
  // Hora de la apuesta y fiabilidad de la cuota justa
  const k0 = Date.parse('2026-10-10T18:00:00Z');
  const mk = (hAntes, fair, closing, extra) => Object.assign({ id: 'x' + hAntes, commence: new Date(k0).toISOString(), created: k0 - hAntes * 3600e3, fair, closingFair: closing, clv: 0.01 }, extra);
  assert.strictEqual(L.hourBucket(mk(30, 2, 2)), 'MÁS DE 24 H');
  assert.strictEqual(L.hourBucket(mk(10, 2, 2)), '6–24 H');
  assert.strictEqual(L.hourBucket(mk(2, 2, 2)), '1–6 H');
  assert.strictEqual(L.hourBucket(mk(0.5, 2, 2)), 'MENOS DE 1 H');
  assert.strictEqual(L.hourBucket({ created: 1 }), null);
  // fiabilidad: prob. justa al apostar 0,50 (fair 2,0) y de cierre 0,40 (closing 2,5) → error y sesgo −10 puntos
  const rows = L.fairDrift([mk(5, 2, 2.5, { league: 'A' }), mk(5, 2, 2, { league: 'A' }), mk(5, 2, 1.6, { league: 'B' })], b => b.league);
  const a = rows.find(r => r.key === 'A'), b2 = rows.find(r => r.key === 'B');
  assert.strictEqual(a.n, 2);
  assert(Math.abs(a.error - 0.05) < 1e-9 && Math.abs(a.bias + 0.05) < 1e-9);
  assert(Math.abs(b2.bias - 0.125) < 1e-9);
  console.log('OK · hora de la apuesta y fiabilidad de la cuota justa');
}
