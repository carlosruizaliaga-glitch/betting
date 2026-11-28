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
assert(m.corners.lines.every(l => !l.int && l.line % 1 === 0.5));   // se mantienen las líneas con medio punto
m.corners.ints.forEach(l => assert(l.int && Math.abs(l.over + l.exact + l.under - 100) < 0.3));   // córners: líneas enteras (más, exactamente, menos)
m.cards.lines.forEach(l => assert(Math.abs(l.over + l.under - 100) < 0.05));
for (let k = 1; k < m.corners.ints.length; k++) assert(m.corners.ints[k].over < m.corners.ints[k - 1].over);
assert(m.corners.ints.every(l => l.minOver > l.fairOver && l.minUnder > l.fairUnder && l.minExact > l.fairExact));
assert.strictEqual(m.v, 2);
const ex = m.corners.ints.reduce((a, l) => a + l.exact, 0); assert(ex > 60 && ex <= 100);
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

{
  const P = await import('../supabase/functions/bt-cards/paper.js');
  const csv = 'Div,Date,HomeTeam,AwayTeam,FTHG,FTAG,HC,AC,HY,AY,HR,AR\nSP1,14/11/2026,Real Madrid,Barcelona,2,1,6,4,2,3,0,1\nSP1,15/11/2026,Ath Madrid,Sevilla,0,0,3,5,1,1,0,0';
  const C = await import('../supabase/functions/bt-cards/cards.js');
  const res = P.resultRows(C.parseCsv(csv));
  assert.strictEqual(res.length, 2); assert.strictEqual(res[0][0], '2026-11-14'); assert.strictEqual(res[0][5], 10); assert.strictEqual(res[0][6], 6);
  const r = P.findResult(res, 'Real Madrid CF', 'FC Barcelona', '2026-11-14');
  assert(r && r[1] === 'Real Madrid');
  assert.strictEqual(P.findResult(res, 'Real Madrid', 'Barcelona', '2026-11-20'), null);
  assert.strictEqual(P.settle('h2h', '1', null, r), 'W'); assert.strictEqual(P.settle('dc', 'X2', null, r), 'L');
  assert.strictEqual(P.settle('totals', 'O', 2.5, r), 'W'); assert.strictEqual(P.settle('btts', 'Y', null, r), 'W');
  assert.strictEqual(P.settle('corners', 'U', 9.5, r), 'L'); assert.strictEqual(P.settle('cards', 'O', 5.5, r), 'W'); assert.strictEqual(P.settle('corners', 'O', 10, r), 'L'); assert.strictEqual(P.settle('corners', 'E', 10, r), 'W'); assert.strictEqual(P.settle('corners', 'U', 11, r), 'W');
  const r0 = P.findResult(res, 'Atletico Madrid', 'Sevilla FC', '2026-11-15');
  assert.strictEqual(P.settle('dnb', '1', null, r0), 'V');
  const now = new Date('2026-11-23T08:00:00Z');
  const items = [{ kind: 'bet', data: { date: '2026-11-18', stake: 10, odds: 2, result: 'W', type: '1X2', legs: [{}], clv: 0.02 } },
    { kind: 'bet', data: { date: '2026-11-19', stake: 10, odds: 1.8, result: 'L', type: 'Goles', fair: 1.9, legs: [{}] } },
    { kind: 'paper', data: { date: '2026-11-18', odds: 2.1, result: 'W' } }, { kind: 'claude', data: { date: '2026-11-17', odds: 1.9, result: 'L' } }];
  const rep = P.weeklyReport(items, now);
  assert(rep.includes('Apuestas: <b>2</b>') && rep.includes('+0,00 €') && rep.includes('por debajo de la cuota justa') && rep.includes('Picks en papel') && rep.includes('Picks de Claude'));
  console.log('OK resultados, cierre en papel e informe semanal');
}
{
  const P = await import('../supabase/functions/bt-cards/paper.js');
  const TG = await import('../supabase/functions/bt-cards/tg.js');
  // API-Football → filas de resultados: solo partidos terminados, marcador a los 90 minutos
  const rows = P.apifRows([
    { fixture: { date: '2026-11-26T20:00:00+00:00', status: { short: 'FT' } }, teams: { home: { name: 'Bayern München' }, away: { name: 'Arsenal' } }, goals: { home: 2, away: 1 }, score: { fulltime: { home: 2, away: 1 } } },
    { fixture: { date: '2026-11-26T20:00:00+00:00', status: { short: 'NS' } }, teams: { home: { name: 'Celtic' }, away: { name: 'Roma' } }, goals: { home: null, away: null } }]);
  assert.strictEqual(rows.length, 1);
  const m = P.findResult(rows, 'Bayern Munich', 'Arsenal', '2026-11-26');
  assert.strictEqual(P.settle('h2h', '1', null, m), 'W'); assert.strictEqual(P.settle('dc', 'X2', null, m), 'L'); assert.strictEqual(P.settle('totals', 'U', 3.5, m), 'W');
  // Aviso con "mis casas": solo cuenta el precio de las casas elegidas
  const pk = { home: 'Rojo', away: 'Azul', league: 'LaLiga', commence_time: '2026-11-29T20:00:00Z', fair_odds: { 1: 2, X: 3.5, 2: 4 }, prices: { Unibet: { 1: 1.9, X: 3.7, 2: 4 }, Marathonbet: { 1: 2.3, X: 3.3, 2: 3.8 } } };
  const msg = TG.digestMessage([pk], ['Unibet'], 3);
  assert(msg.includes('Empate: <b>Unibet 3,70</b>') && !msg.includes('Marathonbet'));
  assert(TG.digestMessage([pk], ['Betsson'], 3).includes('Sin valor en tus casas'));
  console.log('OK cierre con API-Football y aviso con mis casas');
}
