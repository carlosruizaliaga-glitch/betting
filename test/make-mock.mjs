// Genera test/mock-browser.js: simula el servidor para probar la app en local sin tocar la nube.
// Solo datos inventados. Uso: node test/make-mock.mjs
import fs from 'fs';
import { buildPicks } from '../supabase/functions/bt-picks/picks.js';

// Fechas relativas a hoy: day(13) = mañana, day(14) = pasado mañana (así la simulación no caduca).
const today0 = new Date();
const day = (d, h) => new Date(Date.UTC(today0.getUTCFullYear(), today0.getUTCMonth(), today0.getUTCDate() + d - 12, +h.slice(0, 2), +h.slice(3, 5))).toISOString().replace('.000Z', 'Z');
const h2h = (key, h, a, o) => ({ key, markets: [{ key: 'h2h', outcomes: o.length === 3
  ? [{ name: h, price: o[0] }, { name: 'Draw', price: o[1] }, { name: a, price: o[2] }]
  : [{ name: h, price: o[0] }, { name: a, price: o[1] }] }] });
const withTot = (b, point, over, under) => ({ ...b, markets: b.markets.concat([{ key: 'totals', outcomes: [{ name: 'Over', price: over, point }, { name: 'Under', price: under, point }] }]) });
const ev = (id, h, a, t, books) => ({ id, home_team: h, away_team: a, commence_time: t, bookmakers: books });
const now = new Date();

const laliga = buildPicks([
  ev('e1', 'Equipo Rojo', 'Equipo Azul', day(13, '16:30'), [withTot(h2h('pinnacle', 'Equipo Rojo', 'Equipo Azul', [2.15, 3.55, 3.45]), 2.5, 1.95, 1.95),
    withTot(h2h('marathonbet', 'Equipo Rojo', 'Equipo Azul', [2.35, 3.5, 3.3]), 2.5, 2.1, 1.8), h2h('betfair_ex_eu', 'Equipo Rojo', 'Equipo Azul', [2.2, 3.85, 3.6])]),
  ev('e2', 'Equipo Verde', 'Equipo Negro', day(13, '19:00'), [withTot(h2h('pinnacle', 'Equipo Verde', 'Equipo Negro', [2.6, 3.3, 2.8]), 2.5, 2.05, 1.85),
    withTot(h2h('williamhill', 'Equipo Verde', 'Equipo Negro', [2.55, 3.3, 2.85]), 2.5, 2.0, 1.8)])
], { league: 'LaLiga', sportKey: 'soccer_spain_la_liga', now, withTotals: true });
const nba = buildPicks([
  ev('n1', 'Lakers', 'Celtics', day(14, '02:00'), [h2h('pinnacle', 'Lakers', 'Celtics', [1.8, 2.05]), h2h('unibet_se', 'Lakers', 'Celtics', [1.95, 1.9])])
], { league: 'NBA', sportKey: 'basketball_nba', now });
const picks = laliga.concat(nba).map(p => ({ ...p, first_fair_prob: p.id === 'e1' ? { '1': 0.42, 'X': 0.27, '2': 0.31 } : p.fair_prob }));

const bet = (n, d, sel, lvl, stake, odds, result, extra = {}) => ({ id: 'b-mock-' + n, kind: 'bet', updated_at: 1, deleted: false, data: {
  id: 'b-mock-' + n, date: d, book: 'bet365', sport: '⚽', type: '1X2', tipster: 'Prueba', league: 'LaLiga', level: lvl, stake, odds, result,
  legs: [{ event: '', sel, odds }], created: n, ...extra } });
const items = [
  bet(1, '2026-10-01', 'Equipo A', 4, 0.6, 1.8, 'W'), bet(2, '2026-10-01', 'Equipo B', 5, 0.72, 1.66, 'L'),
  bet(3, '2026-10-02', 'Equipo C', 6, 0.82, 1.42, 'W'), bet(4, '2026-10-05', 'Equipo D', 3, 0.33, 2.2, 'P'),
  bet(5, '2026-10-12', 'Equipo Verde', 4, 0.6, 2.8, 'P', { pickId: 'e2', pickOutcome: '1', pickMarket: 'h2h', fair: 2.71, commence: day(13, '19:00') }),
  bet(6, '2026-10-06', 'Equipo E', 5, 0.7, 2.10, 'W', { pickId: 'x6', pickOutcome: '1', pickMarket: 'h2h', fair: 2.00, closingFair: 1.95, clv: 2.10 / 1.95 - 1, autoSettled: true, score: '2-0' }),
  bet(7, '2026-10-07', 'Equipo F', 5, 0.7, 1.70, 'L', { pickId: 'x7', pickOutcome: '1', pickMarket: 'h2h', fair: 1.78, closingFair: 1.80, clv: 1.70 / 1.80 - 1, league: 'Premier' }),
  bet(8, '2026-10-08', 'Más 2,5', 4, 0.5, 1.95, 'W', { pickId: 'x8', pickOutcome: 'O', pickMarket: 'totals', point: 2.5, fair: 1.92, closingFair: 1.90, clv: 1.95 / 1.90 - 1, type: 'Goles' }),
  bet(9, '2026-10-09', 'Equipo G', 6, 0.8, 2.40, 'L', { pickId: 'x9', pickOutcome: '2', pickMarket: 'h2h', fair: 2.30, closingFair: 2.20, clv: 2.40 / 2.20 - 1 }),
  { id: 'm-mock-1', kind: 'movement', updated_at: 1, deleted: false, data: { id: 'm-mock-1', date: '2026-10-01', book: 'bet365', type: 'deposit', amount: 15, created: 0 } },
  { id: 'settings', kind: 'settings', updated_at: 1, deleted: false, data: { id: 'settings', books: ['bet365'], sports: ['⚽', '🏀', '🎾'], types: ['1X2', 'Combinada'],
    tipsters: ['Prueba'], leagues: [], unit: 1, threshold: 3, sendMode: 'value', devig: 'power', totals: true, autoSend: { on: true, time: '12:00' },
    scan: [{ name: 'LaLiga', key: 'soccer_spain_la_liga', on: true, fav: true }, { name: 'Premier', key: 'soccer_epl', on: false },
      { name: 'NBA', key: 'basketball_nba', on: true, fav: false }] } }
];
const sportsInfo = [
  { key: 'soccer_spain_la_liga', title: 'La Liga - Spain', group: 'Soccer', description: 'Spanish Soccer' },
  { key: 'soccer_efl_champ', title: 'Championship', group: 'Soccer', description: 'EFL Championship' },
  { key: 'soccer_turkey_super_league', title: 'Turkey Super League', group: 'Soccer', description: 'Turkish Soccer' },
  { key: 'basketball_nba', title: 'NBA', group: 'Basketball', description: 'US Basketball' },
  { key: 'basketball_euroleague', title: 'Basketball Euroleague', group: 'Basketball', description: 'Basketball Euroleague' },
  { key: 'tennis_atp_shanghai', title: 'ATP Shanghai Masters', group: 'Tennis', description: "Men's Singles" },
  { key: 'icehockey_nhl', title: 'NHL', group: 'Ice Hockey', description: 'US Ice Hockey' }
];

const js = `// Simulación del servidor para probar la app en local sin tocar la nube (solo datos inventados).
// Generado con: node test/make-mock.mjs. Uso en la consola del navegador: await import('/test/mock-browser.js')
window.__mock = ${JSON.stringify({ items, picks, sportsInfo })};
const _f = window.fetch;
window.fetch = async (url, opt) => {
  const u = String(url), body = opt && opt.body ? JSON.parse(opt.body) : {};
  const R = d => new Response(JSON.stringify(d), { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (u.includes('/rpc/bt_setup')) return R('ok');
  if (u.includes('/rpc/bt_status')) return R('configured');
  if (u.includes('/rpc/bt_sync')) return R({ now: new Date().toISOString(), items: body.p_since ? [] : __mock.items });
  if (u.includes('/functions/v1/bt-picks')) {
    const cr = { remaining: 418, used: 82, last: 1, at: new Date().toISOString() };
    if (body.action === 'picks') return R({ ok: true, picks: __mock.picks, credits: cr });
    if (body.action === 'status') return R({ ok: true, secrets: { odds: true, token: true, chat: true }, names: ['ODDS_API_KEY', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'],
      credits: cr, sports: __mock.sportsInfo.map(s => s.key), sportsInfo: __mock.sportsInfo });
    if (body.action === 'detect_chat') return R({ ok: true, chats: [{ id: '123456789', name: 'Prueba' }] });
    if (body.action === 'scan') return R({ ok: true, mode: body.mode, cost: 3, sent: 1, tgError: null, credits: { ...cr, remaining: 415, used: 85 }, picks: __mock.picks,
      leagues: [{ name: 'LaLiga', events: 2 }, { name: 'NBA', events: 1 }], fetchErrors: [] });
  }
  return _f(url, opt);
};
localStorage.clear(); await Store.login('prueba-local', false);
`;
fs.writeFileSync(new URL('./mock-browser.js', import.meta.url), js);
console.log('mock-browser.js ·', picks.length, 'picks ·', items.length, 'items');
