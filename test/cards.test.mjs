import assert from 'node:assert';
import * as C from '../supabase/functions/bt-cards/cards.js';

const hdr = 'Div,HomeTeam,AwayTeam,HC,AC,HY,AY,HR,AR';
const rows = [];
// Liga de 4 equipos con partidos repartidos; "Alfa" saca muchos córneres y "Delta" pocas tarjetas
const T = ['Alfa', 'Beta FC', 'Gamma', 'Real Delta'];
let i = 0;
for (let r = 0; r < 6; r++) for (const h of T) for (const a of T) if (h !== a) {
  i++;
  const hc = h === 'Alfa' ? 9 : 5, ac = a === 'Alfa' ? 7 : 4, hy = a === 'Real Delta' || h === 'Real Delta' ? 1 : 3, ay = hy;
  rows.push([ 'X', h, a, hc, ac, hy, ay, i % 20 === 0 ? 1 : 0, 0 ].join(','));
}
const t = C.buildTable(C.parseCsv(hdr + '\n' + rows.join('\n')));
assert.strictEqual(t.lg.n, 72);
const m = C.ccModel(t, 'Alfa', 'Beta', 0.03);
assert.strictEqual(m.teams.home, 'Alfa'); assert.strictEqual(m.teams.away, 'Beta FC');
const m2 = C.ccModel(t, 'Gamma', 'Delta', 0.03);
assert.strictEqual(m2.teams.away, 'Real Delta');                       // «Delta» encuentra «Real Delta»
assert(m.corners.mu > m2.corners.mu);                                  // Alfa saca más córneres
assert(m2.cards.mu < m.cards.mu);                                      // con Delta hay menos tarjetas
// Probabilidades coherentes: más/menos suman 100 y bajan al subir la línea
m.corners.lines.forEach(l => assert(Math.abs(l.over + l.under - 100) < 0.05));
for (let k = 1; k < m.corners.lines.length; k++) assert(m.corners.lines[k].over < m.corners.lines[k - 1].over);
assert(m.corners.lines.every(l => l.minOver > l.fairOver && l.minUnder > l.fairUnder));
assert.strictEqual(C.ccModel(t, 'Nadie', 'Beta', 0.03), null);
// binomial negativa: la mediana queda cerca de la media
const o = C.overProb(10, 20, 9.5); assert(o > 0.45 && o < 0.65);
assert(C.overProb(10, 20, 14.5) < C.overProb(10, 20, 12.5));
assert.strictEqual(C.seasonCode(new Date('2026-11-15')), '2627'); assert.strictEqual(C.seasonCode(new Date('2027-03-01')), '2627');
assert.strictEqual(C.prevSeason('2627'), '2526');
// Unión de temporadas: la anterior pesa la mitad
const mt = C.mergeTables(t, t, 0.5); assert(Math.abs(mt.lg.n - 108) < 1e-9);
console.log('OK modelo de tarjetas y córneres');

{
  const { pickMessage } = await import('../supabase/functions/bt-cards/tg.js');
  const p = { home: 'A & B', away: 'C', league: 'LaLiga', commence_time: '2026-11-20T20:00:00Z', fair_prob: { 1: 0.5, X: 0.25, 2: 0.25 }, fair_odds: { 1: 2, X: 4, 2: 4 },
    totals: { point: 2.5, fair_odds: { O: 1.9, U: 2.1 }, fair_prob: { O: 0.526, U: 0.476 } },
    cc: { corners: { mu: 9.7, lines: [{ line: 9.5, over: 49.1, under: 50.9, minOver: 2.1, minUnder: 2.02 }] }, cards: { mu: 4.6, lines: [{ line: 3.5, over: 65, under: 35, minOver: 1.59, minUnder: 2.94 }] } } };
  const m = pickMessage(p, 0.03);
  assert(m.includes('A &amp; B') && m.includes('Doble oportunidad') && m.includes('Empate no válido') && m.includes('Córners') && m.includes('Tarjetas'));
  assert(m.includes('≥ 2,06'));                              // 1 a cuota justa 2,00 con umbral 3 %
  assert(!pickMessage({ ...p, cc: null }, 0.03).includes('Córners'));
  console.log('OK mensaje de Telegram');
}
