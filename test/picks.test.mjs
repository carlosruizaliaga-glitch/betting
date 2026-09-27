// Comprueba el quitado de margen, el valor y el formato del mensaje de Telegram.
import assert from 'assert';
import { devig, buildPicks, formatMessages } from '../supabase/functions/bt-picks/picks.js';

const pin = { '1': 2.15, 'X': 3.55, '2': 3.45 };
const m = devig(pin, 'mult'), p = devig(pin, 'power');
const sum = o => Object.values(o).reduce((a, b) => a + b, 0);
assert(Math.abs(sum(m) - 1) < 1e-9 && Math.abs(sum(p) - 1) < 1e-9);
assert(p['1'] > m['1'] && p['X'] < m['X']);   // power: el favorito sube, los no favoritos bajan

const book = (key, o) => ({ key, markets: [{ key: 'h2h', outcomes: [{ name: 'Girona', price: o[0] }, { name: 'Draw', price: o[1] }, { name: 'Betis', price: o[2] }] }] });
const ev = { id: 'e1', home_team: 'Girona', away_team: 'Betis', commence_time: '2026-10-04T16:30:00Z',
  bookmakers: [book('pinnacle', [2.15, 3.55, 3.45]), book('marathonbet', [2.35, 3.5, 3.3]), book('sport888', [2.1, 3.6, 3.4]), book('betfair_ex_eu', [2.2, 3.9, 3.6])] };
const [pk] = buildPicks([ev], { league: 'LaLiga', sportKey: 'soccer_spain_la_liga', threshold: 3, method: 'power', now: new Date('2026-10-01T00:00:00Z') });
assert.strictEqual(pk.favorite, '1');
assert.strictEqual(pk.best['1'].book, 'Marathonbet');
assert.strictEqual(pk.best['X'].odds, 3.76);          // Betfair 3,90 neto de 5 % de comisión
assert.strictEqual(pk.value_outcome, '1');
const msg = formatMessages([pk], { mode: 'all', threshold: 3 });
console.log(msg.join('\n---\n'));
assert(msg[0].includes('DOM 04/10') && msg[0].includes('18:30 Girona – Betis'));
// Sin pinnacle no hay pick; partidos pasados se ignoran
assert.strictEqual(buildPicks([{ ...ev, bookmakers: ev.bookmakers.slice(1) }], { league: 'x', sportKey: 'y', now: new Date('2026-10-01') }).length, 0);
assert.strictEqual(buildPicks([ev], { league: 'x', sportKey: 'y', now: new Date('2026-10-05') }).length, 0);
console.log('OK picks · power 1=' + (p['1'] * 100).toFixed(1) + '% vs proporcional ' + (m['1'] * 100).toFixed(1) + '%');
