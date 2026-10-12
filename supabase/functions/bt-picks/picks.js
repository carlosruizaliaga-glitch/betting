// Cálculo de picks a partir de las cuotas de The Odds API (sin dependencias: se usa en la
// Edge Function y en los tests con Node).
//
// - 1X2 en fútbol (3 resultados) y ganador en baloncesto/tenis (2 resultados: '1' y '2').
// - Más/Menos goles ('O'/'U') en fútbol, en la línea de Pinnacle más cercana a 2,5.
// - Cuota justa de consenso: Pinnacle + exchange de Betfair (si tiene liquidez), sin margen.

// 10 casas = 1 "región" en The Odds API: cuestan lo mismo que 4.
export const BOOKS = ['pinnacle', 'betfair_ex_eu', 'matchbook', 'marathonbet', 'sport888', 'williamhill', 'unibet_se', 'betsson', 'onexbet', 'nordicbet'];
const BOOK_NAMES = {
  pinnacle: 'Pinnacle', betfair_ex_eu: 'Betfair Exch.', matchbook: 'Matchbook', marathonbet: 'Marathonbet', sport888: '888sport',
  williamhill: 'William Hill', unibet_se: 'Unibet', betsson: 'Betsson', onexbet: '1xBet', nordicbet: 'NordicBet'
};
// En los exchanges se paga comisión sobre la ganancia: se compara la cuota neta.
const COMMISSION = { betfair_ex_eu: 0.05, matchbook: 0.02 };
// Si el exchange tiene más margen que esto, hay poca liquidez y no entra en el consenso.
const EXCHANGE_MAX_OVERROUND = 1.06;

export const OUTCOMES = ['1', 'X', '2'];
const ORDER = ['1', 'X', '2', 'O', 'U'];
const sortKeys = keys => keys.slice().sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
const r2 = x => Math.round(x * 100) / 100;
export const sportOf = key => String(key || '').split('_')[0];

// Quita el margen a un conjunto de cuotas {resultado: cuota}.
// "mult": proporcional (p = (1/c) / Σ(1/c)).
// "power": p = (1/c)^k con k tal que Σp = 1; carga más margen a los no favoritos.
export function devig(odds, method) {
  const keys = sortKeys(Object.keys(odds));
  const inv = keys.map(o => 1 / odds[o]);
  let p;
  if (method === 'mult') {
    const s = inv.reduce((a, b) => a + b, 0);
    p = inv.map(x => x / s);
  } else {
    let lo = 0.5, hi = 3;
    for (let i = 0; i < 60; i++) {
      const k = (lo + hi) / 2, s = inv.reduce((a, x) => a + Math.pow(x, k), 0);
      if (s > 1) lo = k; else hi = k;
    }
    const k = (lo + hi) / 2;
    p = inv.map(x => Math.pow(x, k));
    const s = p.reduce((a, b) => a + b, 0);
    p = p.map(x => x / s);
  }
  return Object.fromEntries(keys.map((o, i) => [o, p[i]]));
}

const market = (bookmaker, key) => (bookmaker.markets || []).find(x => x.key === key);
const bookOf = (ev, key) => (ev.bookmakers || []).find(b => b.key === key);

// Cuotas de ganador de una casa: {'1','X','2'} o {'1','2'}; null si faltan o no cuadran.
function h2h(bookmaker, ev) {
  const m = bookmaker && market(bookmaker, 'h2h');
  if (!m) return null;
  const r = {};
  for (const o of m.outcomes || []) {
    const k = o.name === ev.home_team ? '1' : o.name === ev.away_team ? '2' : o.name === 'Draw' ? 'X' : null;
    if (k && +o.price > 1) r[k] = +o.price;
  }
  return r['1'] && r['2'] ? r : null;
}

// Cuotas de Más/Menos por línea: {2.5: {O, U}, ...}
function totalsLines(bookmaker) {
  const m = bookmaker && market(bookmaker, 'totals');
  if (!m) return {};
  const lines = {};
  for (const o of m.outcomes || []) {
    const k = o.name === 'Over' ? 'O' : o.name === 'Under' ? 'U' : null;
    if (!k || !(+o.price > 1) || o.point == null) continue;
    (lines[o.point] = lines[o.point] || {})[k] = +o.price;
  }
  for (const p of Object.keys(lines)) if (!(lines[p].O && lines[p].U)) delete lines[p];
  return lines;
}

const sameKeys = (a, b) => a && b && sortKeys(Object.keys(a)).join() === sortKeys(Object.keys(b)).join();
const overround = odds => Object.values(odds).reduce((s, o) => s + 1 / o, 0);

// Probabilidad justa de consenso a partir de Pinnacle y el exchange de Betfair.
function consensus(pin, bf, method) {
  const src = [];
  if (pin) src.push(['pinnacle', devig(pin, method)]);
  if (bf && (!pin || sameKeys(pin, bf)) && overround(bf) < EXCHANGE_MAX_OVERROUND) src.push(['betfair', devig(bf, method)]);
  if (!src.length) return null;
  const keys = Object.keys(src[0][1]);
  const p = Object.fromEntries(keys.map(k => [k, src.reduce((s, [, q]) => s + q[k], 0) / src.length]));
  const t = Object.values(p).reduce((a, b) => a + b, 0);
  for (const k of keys) p[k] /= t;
  return { prob: p, src: src.map(s => s[0]) };
}

// Mejor cuota (neta de comisión) de las casas en las que se puede apostar, para cada resultado.
function bestPrices(ev, getOdds, fairOdds) {
  const best = {};
  for (const b of ev.bookmakers || []) {
    if (b.key === 'pinnacle') continue;
    const o = getOdds(b);
    if (!o) continue;
    const c = COMMISSION[b.key] || 0;
    for (const k of Object.keys(fairOdds)) {
      if (!(o[k] > 1)) continue;
      const net = r2(1 + (o[k] - 1) * (1 - c));
      if (!best[k] || net > best[k].odds) best[k] = { book: BOOK_NAMES[b.key] || b.title || b.key, odds: net, edge: net / fairOdds[k] - 1 };
    }
  }
  return best;
}

function valueOf(best, threshold) {
  let v = null;
  for (const k of Object.keys(best)) {
    if (best[k].edge * 100 >= threshold && (!v || best[k].edge > best[v].edge)) v = k;
  }
  return v;
}

const toOdds = prob => Object.fromEntries(Object.keys(prob).map(k => [k, 1 / prob[k]]));

// Más/Menos: línea de Pinnacle más cercana a 2,5 (si no hay Pinnacle, la del exchange).
function buildTotals(ev, method, threshold) {
  const pinL = totalsLines(bookOf(ev, 'pinnacle')), bfL = totalsLines(bookOf(ev, 'betfair_ex_eu'));
  const points = Object.keys(Object.keys(pinL).length ? pinL : bfL).map(Number);
  if (!points.length) return null;
  const point = points.sort((a, b) => Math.abs(a - 2.5) - Math.abs(b - 2.5) || a - b)[0];
  const c = consensus(pinL[point], bfL[point], method);
  if (!c) return null;
  const fairOdds = toOdds(c.prob);
  const best = bestPrices(ev, b => totalsLines(b)[point], fairOdds);
  return { point, pin_odds: pinL[point] || null, fair_prob: c.prob, fair_odds: fairOdds, fair_src: c.src, best, value_outcome: valueOf(best, threshold) };
}

// Cuota de cierre de PINNACLE (el CLV se mide siempre contra Pinnacle, como hasta ahora).
// Devuelve {pin_odds, fair_prob, fair_odds, devig, totals?} o null.
export function pinnacleFair(ev, method, totalsPoint) {
  const pin = h2h(bookOf(ev, 'pinnacle'), ev);
  if (!pin) return null;
  const prob = devig(pin, method);
  const out = { pin_odds: pin, fair_prob: prob, fair_odds: toOdds(prob), devig: method };
  if (totalsPoint != null) {
    const line = totalsLines(bookOf(ev, 'pinnacle'))[totalsPoint];
    if (line) { const tp = devig(line, method); out.totals = { point: totalsPoint, pin_odds: line, fair_prob: tp, fair_odds: toOdds(tp) }; }
  }
  return out;
}

// CLV = mi cuota / cuota justa de cierre − 1.
export const clv = (myOdds, closingFair) => myOdds / closingFair - 1;

// events: respuesta de /v4/sports/{key}/odds. Devuelve un pick por partido.
export function buildPicks(events, opts) {
  const { league, sportKey, threshold = 3, method = 'power', now = new Date(), capturedAt = new Date(), withTotals = false } = opts;
  const out = [];
  for (const ev of events || []) {
    if (new Date(ev.commence_time) <= now) continue;
    const c = consensus(h2h(bookOf(ev, 'pinnacle'), ev), h2h(bookOf(ev, 'betfair_ex_eu'), ev), method);
    if (!c) continue;
    const prob = c.prob, fairOdds = toOdds(prob);
    const best = bestPrices(ev, b => h2h(b, ev), fairOdds);
    const favorite = Object.keys(prob).reduce((a, b) => prob[b] > prob[a] ? b : a);
    out.push({
      id: ev.id, sport_key: sportKey, sport: sportOf(sportKey), league, home: ev.home_team, away: ev.away_team, commence_time: ev.commence_time,
      pin_odds: h2h(bookOf(ev, 'pinnacle'), ev) || {}, fair_prob: prob, fair_odds: fairOdds, fair_src: c.src, best, favorite,
      value_outcome: valueOf(best, threshold), devig: method, captured_at: capturedAt.toISOString(),
      totals: withTotals && sportOf(sportKey) === 'soccer' ? buildTotals(ev, method, threshold) : null
    });
  }
  return out;
}

// Movimiento: cambio de probabilidad justa (en puntos) desde la primera captura.
export const moveOf = (p, o) => p.first_fair_prob && p.first_fair_prob[o] != null && p.fair_prob[o] != null ? p.fair_prob[o] - p.first_fair_prob[o] : 0;

// ---------- Mensaje de Telegram (HTML, hora de Madrid) ----------
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const dec = (x, d) => x.toFixed(d).replace('.', ',');
const pct = x => Math.round(x * 100) + '%';
const spct = x => (x >= 0 ? '+' : '−') + Math.round(Math.abs(x) * 100) + '%';
const SPORT_EMOJI = { soccer: '⚽', basketball: '🏀', tennis: '🎾' };
export const sportEmoji = key => SPORT_EMOJI[sportOf(key)] || '🏆';

export function madrid(iso) {
  const d = new Date(iso);
  const f = (o) => new Intl.DateTimeFormat('es-ES', Object.assign({ timeZone: 'Europe/Madrid' }, o)).format(d);
  const dd = f({ day: '2-digit' }).padStart(2, '0'), mm = f({ month: '2-digit' }).padStart(2, '0');
  return {
    day: f({ year: 'numeric' }) + '-' + mm + '-' + dd,
    label: f({ weekday: 'short' }).replace('.', '').toUpperCase() + ' ' + dd + '/' + mm,
    time: f({ hour: '2-digit', minute: '2-digit', hour12: false })
  };
}

// Cuota mínima en otra casa (bet365) para superar el umbral de valor sobre la justa.
export const minOdds = (fair, threshold) => Math.ceil(fair * (1 + threshold / 100) * 100 - 1e-9) / 100;
const point = n => dec(n, n % 1 ? (n * 10 % 1 ? 2 : 1) : 0);
export const outcomeName = (p, o) => o === '1' ? p.home : o === '2' ? p.away : o === 'X' ? 'Empate'
  : o === 'O' ? `Más ${point(p.totals ? p.totals.point : 2.5)}` : o === 'U' ? `Menos ${point(p.totals ? p.totals.point : 2.5)}` : o;
export const hasValue = p => !!(p.value_outcome || (p.totals && p.totals.value_outcome));

// Ficha de un partido: una línea por resultado (letra fija para alinear columnas),
// el valor encontrado y la cuota mínima de bet365.
function pickLines(p, threshold) {
  const m = madrid(p.commence_time);
  const cut = s => s.length > 16 ? s.slice(0, 15) + '…' : s;
  const h2hKeys = sortKeys(Object.keys(p.fair_prob));
  const tot = p.totals;
  const keys = h2hKeys.concat(tot ? ['O', 'U'] : []);
  const names = Object.fromEntries(keys.map(o => [o, cut(outcomeName(p, o))]));
  const w = Math.max(...keys.map(o => names[o].length));
  const mv = d => Math.abs(d) >= 0.01 ? ` ${d > 0 ? '↑' : '↓'}${Math.round(Math.abs(d) * 100)}` : '';
  const row = (o, prob, fair, isVal, d) => `${names[o].padEnd(w)}  ${pct(prob).padStart(3)}  justa ${dec(fair, 2)}${isVal ? '  ⭐' : ''}${mv(d)}`;
  const rows = h2hKeys.map(o => row(o, p.fair_prob[o], p.fair_odds[o], p.value_outcome === o, moveOf(p, o)));
  if (tot) rows.push(...['O', 'U'].map(o => row(o, tot.fair_prob[o], tot.fair_odds[o], tot.value_outcome === o, 0)));
  const lines = [`🕕 <b>${m.time} · ${esc(p.home)} – ${esc(p.away)}</b>`, `<pre>${esc(rows.join('\n'))}</pre>`];
  const target = p.value_outcome || p.favorite;
  if (p.value_outcome) {
    const v = p.best[p.value_outcome];
    lines.push(`⭐ ${esc(v.book)} ${dec(v.odds, 2)} (${spct(v.edge)})`);
  }
  lines.push(`🎯 bet365: <b>${esc(outcomeName(p, target))} si ≥ ${dec(minOdds(p.fair_odds[target], threshold), 2)}</b>`);
  if (tot && tot.value_outcome) {
    const v = tot.best[tot.value_outcome];
    lines.push(`⭐ ${esc(outcomeName(p, tot.value_outcome))}: ${esc(v.book)} ${dec(v.odds, 2)} (${spct(v.edge)})`);
    lines.push(`🎯 bet365: <b>${esc(outcomeName(p, tot.value_outcome))} si ≥ ${dec(minOdds(tot.fair_odds[tot.value_outcome], threshold), 2)}</b>`);
  }
  return lines.join('\n');
}

// Devuelve los trozos de mensaje (Telegram admite hasta 4096 caracteres).
export function formatMessages(picks, { mode = 'value', threshold = 3, method = 'power', analyzed } = {}) {
  const list = picks.filter(p => mode === 'all' || hasValue(p))
    .sort((a, b) => a.league.localeCompare(b.league) || a.commence_time.localeCompare(b.commence_time));
  const n = analyzed != null ? analyzed : picks.length;
  const head = `<b>⚡ PICKS · PRECIO JUSTO SIN MARGEN</b>\n` +
    `${mode === 'all' ? 'Todos los partidos' : `Solo ⭐ valor ≥ +${dec(threshold, threshold % 1 ? 1 : 0)}%`} · ${list.length}/${n} · 72 h · ${method === 'mult' ? 'proporcional' : 'power'}`;
  if (!list.length) return [head + `\n\nSin partidos ${mode === 'all' ? '' : 'con valor '}en las próximas 72 h.`];
  const blocks = [];
  let lastHdr = null;
  for (const p of list) {
    const hdr = `${sportEmoji(p.sport_key)} <b>${esc(p.league.toUpperCase())} · ${madrid(p.commence_time).label}</b>`;
    blocks.push((hdr !== lastHdr ? hdr + '\n' : '') + pickLines(p, threshold));
    lastHdr = hdr;
  }
  const chunks = [];
  let cur = head;
  for (const b of blocks) {
    if ((cur + '\n\n' + b).length > 3900) { chunks.push(cur); cur = b; } else cur += '\n\n' + b;
  }
  chunks.push(cur);
  return chunks;
}
