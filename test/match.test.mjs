// Comprueba la búsqueda del partido por nombres y la ficha (marcador, descanso, goles, córners y tarjetas).
import assert from 'assert';
import { teamTokens, teamSim, findFixture, buildMatch, FIXTURE_DONE, parsePrediction } from '../supabase/functions/bt-picks/picks.js';

// ---------- Nombres ----------
assert.deepStrictEqual(teamTokens('Atlético de Madrid'), ['atletico', 'madrid']);
assert.strictEqual(teamSim('Girona', 'Girona FC'), 1);
assert.strictEqual(teamSim('Manchester United', 'Man United'), 1);          // alias "man"
assert(teamSim('Manchester City', 'Manchester United') < 0.75);             // comparten solo una palabra
assert.strictEqual(teamSim('Bayer Leverkusen', 'Bayer 04 Leverkusen') , 1);
assert(teamSim('Real Betis', 'Real Madrid') < 0.5);
assert(teamSim('Athletic Club', 'Atletico Madrid') < 0.5);

// ---------- Búsqueda del partido ----------
const fx = (id, home, away, date) => ({ fixture: { id, date, status: { short: 'FT' } }, teams: { home: { id: id * 10 + 1, name: home }, away: { id: id * 10 + 2, name: away } },
  goals: { home: 2, away: 1 }, score: { halftime: { home: 1, away: 0 }, fulltime: { home: 2, away: 1 } } });
const list = [fx(1, 'Manchester City', 'Arsenal', '2026-10-04T14:00:00+00:00'), fx(2, 'Girona', 'Real Betis', '2026-10-04T16:30:00+00:00'),
  fx(3, 'Girona', 'Real Betis', '2026-10-05T16:30:00+00:00'), fx(4, 'Athletic Club', 'Sevilla', '2026-10-04T16:30:00+00:00')];
assert.strictEqual(findFixture(list, 'Girona', 'Betis', '2026-10-04T16:30:00Z').fixture.id, 2);
assert.strictEqual(findFixture(list, 'Girona', 'Betis', '2026-10-04T19:30:00Z'), undefined || null);   // otra hora: no es ese partido
assert.strictEqual(findFixture(list, 'Barcelona', 'Betis', '2026-10-04T16:30:00Z'), null);
assert(FIXTURE_DONE.includes('FT') && !FIXTURE_DONE.includes('1H'));

// ---------- Ficha ----------
const f = fx(2, 'Girona', 'Real Betis', '2026-10-04T16:30:00+00:00');
const ev = [
  { type: 'Goal', detail: 'Normal Goal', time: { elapsed: 23, extra: null }, team: { id: 21 }, player: { name: 'Stuani' } },
  { type: 'Goal', detail: 'Penalty', time: { elapsed: 58, extra: null }, team: { id: 21 }, player: { name: 'Stuani' } },
  { type: 'Goal', detail: 'Own Goal', time: { elapsed: 71, extra: null }, team: { id: 22 }, player: { name: 'Fekir' } },   // propia puerta del Betis: cuenta para el Girona
  { type: 'Goal', detail: 'Normal Goal', time: { elapsed: 90, extra: 3 }, team: { id: 22 }, player: { name: 'Iglesias' } },
  { type: 'Card', detail: 'Yellow Card', time: { elapsed: 40 }, team: { id: 21 }, player: { name: 'X' } }];
const stats = [{ team: { id: 21 }, statistics: [{ type: 'Corner Kicks', value: 6 }, { type: 'Yellow Cards', value: 2 }, { type: 'Red Cards', value: null }] },
  { team: { id: 22 }, statistics: [{ type: 'Corner Kicks', value: 4 }, { type: 'Yellow Cards', value: 3 }, { type: 'Red Cards', value: 1 }] }];
f.goals = { home: 3, away: 1 }; f.score.fulltime = { home: 3, away: 1 };
const m = buildMatch(f, ev, stats);
assert.deepStrictEqual(m.ft, [3, 1]);
assert.deepStrictEqual(m.ht, [1, 0]);
assert.deepStrictEqual(m.corners, [6, 4]);
assert.deepStrictEqual(m.yellow, [2, 3]);
assert.deepStrictEqual(m.red, [0, 1]);
assert.strictEqual(m.goals.length, 4);
assert.deepStrictEqual(m.goals.map(g => g.t).join(''), 'hhha'.replace('hhha', 'hhh' + 'a'));
assert.strictEqual(m.goals[2].k, 'o');
assert.strictEqual(m.goals[2].t, 'h');             // la propia puerta se cambió de lado para cuadrar con el 3–1
assert.strictEqual(m.goals[3].x, 3);
assert.strictEqual(m.src, 'apif');

// sin estadísticas: las tarjetas salen de los eventos y los córners quedan sin dato
const m2 = buildMatch(f, ev, []);
assert.strictEqual(m2.corners, null);
assert.deepStrictEqual(m2.yellow, [1, 0]);
// ---------- Predicción de API-Football ----------
const pr = parsePrediction({ predictions: { percent: { home: '50%', draw: '30%', away: '20%' }, advice: 'Double chance : 1X' } });
assert(Math.abs(pr.p['1'] - 0.5) < 1e-9 && Math.abs(pr.p.X - 0.3) < 1e-9 && pr.advice === 'Double chance : 1X');
const pr2 = parsePrediction({ predictions: { percent: { home: '45%', draw: '45%', away: '20%' } } });   // suma 110: se normaliza
assert(Math.abs(pr2.p['1'] + pr2.p.X + pr2.p['2'] - 1) < 1e-9);
assert.strictEqual(parsePrediction({ predictions: {} }), null);
assert.strictEqual(parsePrediction(null), null);
console.log('OK ficha del partido · nombres, búsqueda, marcador, goles, córners y tarjetas');
