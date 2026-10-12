// Cierre automático: resultado con el marcador final y beneficio.
import assert from 'assert';
import { settleOutcome as S, betProfit as P, finalScore } from '../supabase/functions/bt-picks/picks.js';

// 1X2 y ganador
assert.strictEqual(S('h2h', '1', 2, 1), 'W');
assert.strictEqual(S('h2h', '1', 1, 1), 'L');
assert.strictEqual(S('h2h', 'X', 1, 1), 'W');
assert.strictEqual(S('h2h', '2', 0, 3), 'W');
assert.strictEqual(S('h2h', '2', 101, 99), 'L');            // baloncesto
// Más/Menos
assert.strictEqual(S('totals', 'O', 2, 1, 2.5), 'W');
assert.strictEqual(S('totals', 'U', 2, 1, 2.5), 'L');
assert.strictEqual(S('totals', 'O', 1, 1, 2), 'V');          // línea entera: nula
assert.strictEqual(S('totals', 'O', 1, 1, 2.25), 'HL');      // 2,25: mitad a 2 (nula) y mitad a 2,5 (perdida)
assert.strictEqual(S('totals', 'O', 2, 1, 2.75), 'HW');      // 2,75: mitad a 2,5 (ganada) y mitad a 3 (nula)
assert.strictEqual(S('totals', 'U', 2, 1, 2.75), 'HL');
assert.strictEqual(S('totals', 'U', 1, 0, 2.25), 'W');
assert.strictEqual(S('totals', 'O', NaN, 1, 2.5), null);
// Beneficio (igual que la hoja/app)
assert.strictEqual(P('W', 0.77, 1.45), 0.35);
assert.strictEqual(P('L', 0.72, 1.66), -0.72);
assert.strictEqual(P('V', 1, 2), 0);
assert.strictEqual(P('HW', 10, 2), 5);
assert.strictEqual(P('HL', 10, 2), -5);
assert.strictEqual(P('W', 10, 2, true), 10);
// Marcador
assert.deepStrictEqual(finalScore({ completed: true, home_team: 'A', away_team: 'B', scores: [{ name: 'B', score: '1' }, { name: 'A', score: '2' }] }), { home: 2, away: 1 });
assert.strictEqual(finalScore({ completed: false, home_team: 'A', away_team: 'B', scores: [] }), null);
assert.strictEqual(finalScore({ completed: true, home_team: 'A', away_team: 'B', scores: null }), null);
console.log('OK cierre automático');
