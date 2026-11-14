// Comprobación de la migración: los números deben coincidir con la hoja Betting.xlsx.
const L = require('../logic.js');
L.setClvMode('real');   // las pruebas antiguas de CLV usan el CLV clásico; el de selección se prueba al final
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
  assert(s2.level > 1 && s2.level <= 6);
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

{
  // Análisis avanzado
  const B = (n, date, stake, odds, result, extra) => Object.assign({ id: 'a' + n, date, created: n, stake, odds, result, legs: [{ sel: 'X', odds }], book: 'bet365', sport: '⚽', type: '1X2' }, extra);
  const xs = [
    B(1, '2026-10-01', 1, 2.2, 'W', { fair: 2.0, closingFair: 2.1, level: 5 }),   // esperado +0,10
    B(2, '2026-10-02', 1, 1.9, 'L', { fair: 2.0, level: 2 }),                     // esperado −0,05
    B(3, '2026-10-02', 2, 1.5, 'W', { fair: 1.5, level: 1 }),                     // esperado 0
    B(4, '2026-11-03', 1, 3.0, 'L'),
    B(5, '2026-11-04', 1, 2.0, 'L'),
    B(6, '2026-11-05', 1, 2.0, 'W')];
  const e = L.expectedVsReal(xs);
  assert.strictEqual(e.n, 3);
  assert.strictEqual(e.ev, 0.05);
  assert.strictEqual(e.real, L.r2(1.2 - 1 + 1));
  assert.strictEqual(e.luck, L.r2(e.real - e.ev));
  assert.strictEqual(e.nClose, 1);
  assert(Math.abs(L.normCdf(0) - 0.5) < 1e-7 && Math.abs(L.normCdf(1.96) - 0.975) < 1e-3);
  const lt = L.luckTest(xs);
  assert.strictEqual(lt.n, 6);
  assert(lt.pLuck > 0 && lt.pLuck <= 0.5 && lt.yieldLo < lt.yield && lt.yield < lt.yieldHi);
  const cal = L.calibration(xs);
  assert.strictEqual(cal.reduce((a, r) => a + r.n, 0), 6);
  assert.strictEqual(cal.find(r => r.key === '60–75 %').n, 1);               // la de 1,50 justa = 66,7 %
  assert.deepStrictEqual(L.monthly(xs).map(r => r.key), ['2026-10', '2026-11']);
  assert.strictEqual(L.daily(xs)['2026-10-02'], L.r2(-1 + 1));
  const dd = L.drawdown(xs);
  assert(dd.max < 0 && dd.peakDate && dd.troughDate);
  assert.deepStrictEqual(L.streakRecords(xs), { win: 1, loss: 2 });
  assert(L.volatility(xs).sd > 0);
  const ct = L.crossTab(xs, b => b.book, b => b.type);
  assert.strictEqual(ct.cells['bet365|1X2'].n, 6);
  const bf = L.belowFairByMonth(xs);
  assert.strictEqual(bf[0].n, 3); assert(Math.abs(bf[0].below - 1 / 3) < 1e-9);
  const sv = L.stakeVsSuggested(xs, 1, 0.25);
  assert.strictEqual(sv.n, 3); assert.strictEqual(sv.noValue, 2);            // la 2 (bajo justa) y la 3 (justa) no tienen valor
  const vo = L.volume(xs);
  assert.strictEqual(vo.days, 5); assert.strictEqual(vo.maxDay, 2);
  const tl = L.tilt(xs);
  assert.strictEqual(tl.afterWin.n + tl.afterLoss.n, 5);
  assert.deepStrictEqual(L.limitWeeks(xs, 0.5), { weeks: 2, over: 1 });
  console.log('OK · análisis avanzado (esperado, suerte, calibración, caídas, disciplina)');
}

{
  // CLV en dos partes: selección (sin margen) y precio pagado
  const b1 = { id: 'c1', date: '2026-10-01', stake: 1, odds: 1.90, fair: 2.00, closingFair: 1.90, clv: 1.90 / 1.90 - 1, result: 'W', legs: [{ sel: 'A', odds: 1.9 }] };
  const b2 = { id: 'c2', date: '2026-10-02', stake: 1, odds: 1.80, fair: 1.90, closingFair: 2.00, clv: 1.80 / 2.00 - 1, result: 'L', legs: [{ sel: 'B', odds: 1.8 }] };
  assert(Math.abs(L.clvSel(b1) - (2.0 / 1.9 - 1)) < 1e-12);          // el mercado se movió a favor: +5,3 %
  assert(Math.abs(L.clvPaid(b1) - (1.9 / 2.0 - 1)) < 1e-12);         // pagaste un 5 % de margen
  assert(Math.abs((1 + L.clvPaid(b1)) * (1 + L.clvSel(b1)) - (1 + b1.clv)) < 1e-12);
  L.setClvMode('sel');
  assert(L.clvStats([b1, b2]).pos === 0.5);
  assert(Math.abs(L.clvOf(b2) - (1.9 / 2.0 - 1)) < 1e-12);
  L.setClvMode('real');
  assert.strictEqual(L.clvOf(b2), b2.clv);
  assert(L.clvStats([b1, b2]).avg < 0);
  const cp = L.clvParts([b1, b2]);
  assert.strictEqual(cp.n, 2); assert(cp.paid < 0);
  L.setClvMode('sel');
  console.log('OK · CLV de selección y precio pagado');
}

{
  // Confianza y nivel de stake
  const hi = L.pickConfidence({ p: 0.7, srcN: 2, soft: 0.69, model: 0.72, hours: 3, kind: 'main', move: 0.03, edge: 0.04 });
  assert(hi.score >= 90 && hi.label === 'ALTA' && hi.sigma < 0.01);
  const lo = L.pickConfidence({ p: 0.15, srcN: 1, soft: 0.25, model: 0.01, hours: 60, kind: 'extra', move: -0.03, edge: 0.1 });
  assert(lo.score < 30 && lo.label === 'BAJA' && lo.sigma > 0.02);
  const mid = L.pickConfidence({ p: 0.7, srcN: 2, soft: 0.69, model: 0.9, hours: 8, kind: 'main', move: 0, edge: 0.097 });   // modelo a favor, ventaja grande
  assert(mid.label === 'MEDIA' && mid.why.some(w => /ventaja muy grande/i.test(w.txt)));
  const a = L.stakeByConfidence(1.57, 0.7, mid, 100, 1, 0.25), b = L.stakeByConfidence(1.57, 0.7, hi, 100, 1, 0.25), c = L.stakeByConfidence(1.57, 0.7, lo, 100, 1, 0.25);
  assert(a.pc < 0.7 && a.level >= 1 && a.level <= 4);
  assert(b.level >= a.level && a.level >= c.level);                       // más confianza, más nivel
  assert(c.level <= 3);                                                   // tope por confianza baja
  const z = L.stakeByConfidence(1.45, 0.7, lo, 100, 1, 0.25);              // ventaja pequeña + poca confianza: no apostar
  assert.strictEqual(z.level, 0); assert.strictEqual(z.stake, 0);
  assert.strictEqual(L.stakeByConfidence(null, 0.5, mid, 100, 1, 0.25), null);
  console.log('OK · confianza y nivel de stake');
}

{
  // Caso Almería: justa 1,88 (53,3 %), cuota 1,90, confianza alta: ventaja +1,3 % → ahora sí nivel 1
  const hi2 = L.pickConfidence({ p: 0.533, srcN: 2, soft: 0.52, model: null, hours: 5, kind: 'main', move: -0.02, edge: 0.013 });
  const r = L.stakeByConfidence(1.9, 0.533, hi2, 14, 1, 0.25);
  assert(hi2.label === 'ALTA' && r.edgeC > 0 && r.level === 1);
  const r0 = L.stakeByConfidence(1.88, 0.533, hi2, 14, 1, 0.25);           // en la justa: sin ventaja → no
  assert.strictEqual(r0.level, 0);
  console.log('OK · confianza menos conservadora');
}

{
  // Riesgo
  const mv = [{ id: 'd1', date: '2026-10-01', type: 'deposit', amount: 100, created: 0 }];
  const R = (n, date, stake, odds, result, extra) => Object.assign({ id: 'r' + n, date, created: n, stake, odds, result, legs: [{ sel: 'X', odds }], league: 'LaLiga', book: 'bet365' }, extra);
  const rb = [R(1, '2026-10-02', 10, 2, 'L', { fair: 2.2 }), R(2, '2026-10-03', 5, 2, 'W', { fair: 1.8 }), R(3, '2026-10-04', 5, 2, 'P', { fair: 2.0 })];
  const bb = L.bankBefore(rb, mv);
  assert.strictEqual(bb.r1, 100); assert.strictEqual(bb.r2, 90); assert.strictEqual(bb.r3, 95);   // la banca baja tras perder y sube tras ganar
  const rs = L.riskStats(rb, mv);
  assert.strictEqual(rs.stake.n, 3);
  assert(Math.abs(rs.stake.max - 0.1) < 1e-9);
  assert.strictEqual(rs.stake.over5, 1);                                                             // las tres superan el 5 % de la banca
  assert.strictEqual(rs.kelly.n, 3); assert(Math.abs(rs.kelly.noEdgePct - 2 / 3) < 1e-9);            // la 1 (2,0 vs 2,2) y la 3 (2,0 vs 2,0) no tienen ventaja
  assert(Math.abs(rs.kelly.noEdgeMoney - 0.75) < 1e-9);                                               // 15 de 20 € sin ventaja
  assert.strictEqual(rs.exposure.n, 1); assert.strictEqual(rs.exposure.risk, 5);
  assert.strictEqual(rs.conc.topLeague, 'LaLiga');
  // Simulación: determinista y con sentido
  const many = [];
  for (let i = 0; i < 40; i++) many.push(R(100 + i, '2026-10-' + String(1 + (i % 28)).padStart(2, '0'), 2, 2, i % 2 ? 'W' : 'L', { fair: 2.0 }));
  const sim1 = L.riskSim(many, mv), sim2 = L.riskSim(many, mv);
  assert.deepStrictEqual(sim1, sim2);
  assert(sim1.p5 < sim1.p50 && sim1.p50 < sim1.p95 && sim1.pBelow50 < 0.01);                          // apuestas del 2 % sin ventaja: nunca se pierde la mitad
  const big = many.map(b => Object.assign({}, b, { stake: 30 }));
  const simB = L.riskSim(big, mv);
  assert(simB.pBelow50 > sim1.pBelow50 && simB.pDD30 > 0.5);                                         // importes enormes: riesgo muchísimo mayor
  assert.strictEqual(L.riskSim(many.slice(0, 3), mv), null);
  assert(L.expectedLongestLoss(0.5, 100) >= 5 && L.expectedLongestLoss(0.5, 100) <= 8);
  assert.strictEqual(L.expectedLongestLoss(0, 100), null);
  console.log('OK · riesgo (tamaño sobre banca, Kelly, exposición, simulación)');
}

{
  // Favoritos que fallan
  const F = (n, fair, odds, result) => ({ id: 'f' + n, date: '2026-10-0' + n, created: n, stake: 10, odds, result, fair, legs: [{ sel: 'X', odds }] });
  const fb = [F(1, 1.25, 1.3, 'W'), F(2, 1.25, 1.3, 'L'), F(3, 1.6, 1.7, 'W'), F(4, 3, 3.1, 'L'), F(5, 1.25, 1.3, 'W')];
  const fs = L.favStats(fb, 0.5);
  assert.strictEqual(fs.n, 4);                                   // la de cuota justa 3 (33 %) no es favorita
  assert.strictEqual(fs.wins, 3);
  assert(Math.abs(fs.exp - (0.8 * 3 + 0.625) / 4) < 1e-9);
  assert.strictEqual(fs.fails.length, 1); assert.strictEqual(fs.lost, 10);
  assert.strictEqual(L.favStats(fb, 0.7).n, 3);
  assert(fs.bands.length >= 2 && fs.bands.reduce((a, x) => a + x.n, 0) === 4);
  console.log('OK · favoritos que fallan');
}
