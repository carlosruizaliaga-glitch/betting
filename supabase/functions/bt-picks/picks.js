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
const ORDER = ['1', 'X', '2', 'O', 'U', 'Y', 'N'];
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

// Cuotas de Más/Menos por línea: {2.5: {O, U}, ...}. Con 'alternate_totals' salen más líneas.
function totalsLines(bookmaker, keys = ['totals']) {
  if (!bookmaker) return {};
  const lines = {};
  for (const mk of keys) {
    const m = market(bookmaker, mk);
    for (const o of (m && m.outcomes) || []) {
      const k = o.name === 'Over' ? 'O' : o.name === 'Under' ? 'U' : null;
      if (!k || !(+o.price > 1) || o.point == null) continue;
      (lines[o.point] = lines[o.point] || {})[k] = +o.price;
    }
  }
  for (const p of Object.keys(lines)) if (!(lines[p].O && lines[p].U)) delete lines[p];
  return lines;
}

// Ambos marcan: {Y, N}
function bttsOdds(bookmaker) {
  const m = bookmaker && market(bookmaker, 'btts');
  if (!m) return null;
  const r = {};
  for (const o of m.outcomes || []) {
    const k = o.name === 'Yes' ? 'Y' : o.name === 'No' ? 'N' : null;
    if (k && +o.price > 1) r[k] = +o.price;
  }
  return r.Y && r.N ? r : null;
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

// ---------- Mercados derivados del 1X2 (sin gastar créditos) ----------
// Doble oportunidad (1X, 12, X2) y "empate no vale" (1, 2), a partir de la probabilidad justa del 1X2.
export function derivedMarkets(prob) {
  if (!prob || prob['1'] == null || prob.X == null || prob['2'] == null) return null;
  const dc = { '1X': prob['1'] + prob.X, '12': prob['1'] + prob['2'], 'X2': prob.X + prob['2'] };
  const dnb = { '1': prob['1'] / (prob['1'] + prob['2']), '2': prob['2'] / (prob['1'] + prob['2']) };
  return { dc: { fair_prob: dc, fair_odds: toOdds(dc) }, dnb: { fair_prob: dnb, fair_odds: toOdds(dnb) } };
}

// Más/Menos en las líneas pedidas y Ambos marcan, a partir de /events/{id}/odds con los mercados
// 'btts' y 'alternate_totals' (bajo demanda: 1 crédito por mercado).
export function buildExtras(ev, method, threshold, wanted = [0.5, 1.5, 3.5]) {
  const keys = ['totals', 'alternate_totals'];
  const pinL = totalsLines(bookOf(ev, 'pinnacle'), keys), bfL = totalsLines(bookOf(ev, 'betfair_ex_eu'), keys);
  const lines = [];
  for (const point of wanted) {
    const c = consensus(pinL[point], bfL[point], method);
    if (!c) continue;
    const fairOdds = toOdds(c.prob), best = bestPrices(ev, b => totalsLines(b, keys)[point], fairOdds);
    lines.push({ point, fair_prob: c.prob, fair_odds: fairOdds, fair_src: c.src, best, value_outcome: valueOf(best, threshold) });
  }
  let btts = null;
  const c = consensus(bttsOdds(bookOf(ev, 'pinnacle')), bttsOdds(bookOf(ev, 'betfair_ex_eu')), method);
  if (c) {
    const fairOdds = toOdds(c.prob), best = bestPrices(ev, bttsOdds, fairOdds);
    btts = { fair_prob: c.prob, fair_odds: fairOdds, fair_src: c.src, best, value_outcome: valueOf(best, threshold) };
  }
  return { btts, lines, at: new Date().toISOString() };
}

// Cuota de cierre de PINNACLE (el CLV se mide siempre contra Pinnacle, como hasta ahora).
// Devuelve {pin_odds, fair_prob, fair_odds, devig, totals?} o null.
export function pinnacleFair(ev, method, totalsPoint, withBtts) {
  const pin = h2h(bookOf(ev, 'pinnacle'), ev);
  if (!pin) return null;
  const prob = devig(pin, method);
  const out = { pin_odds: pin, fair_prob: prob, fair_odds: toOdds(prob), devig: method };
  if (totalsPoint != null) {
    const line = totalsLines(bookOf(ev, 'pinnacle'), ['totals', 'alternate_totals'])[totalsPoint];
    if (line) { const tp = devig(line, method); out.totals = { point: totalsPoint, pin_odds: line, fair_prob: tp, fair_odds: toOdds(tp) }; }
  }
  if (withBtts) {
    const b = bttsOdds(bookOf(ev, 'pinnacle'));
    if (b) { const bp = devig(b, method); out.btts = { pin_odds: b, fair_prob: bp, fair_odds: toOdds(bp) }; }
  }
  return out;
}

// Cuota justa de cierre que corresponde a una apuesta (según su mercado), o null si no hay.
export function closingFairFor(c, bet) {
  if (!c || c.missed) return null;
  const o = bet.pickOutcome;
  if (bet.pickMarket === 'totals') return c.totals && +c.totals.point === +bet.point && c.totals.fair_odds ? c.totals.fair_odds[o] || null : null;
  if (bet.pickMarket === 'btts') return c.btts && c.btts.fair_odds ? c.btts.fair_odds[o] || null : null;
  if (bet.pickMarket === 'dc' || bet.pickMarket === 'dnb') {
    const d = derivedMarkets(c.fair_prob);
    return d && d[bet.pickMarket].fair_odds[o] || null;
  }
  return c.fair_odds ? c.fair_odds[o] || null : null;
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

// ---------- Cierre automático con el marcador final ----------
// Resultado de una apuesta: 'W', 'L', 'V' (nula), 'HW'/'HL' (medio ganada/perdida en líneas de cuarto).
// market 'h2h': '1'/'X'/'2'; 'totals': 'O'/'U' con su línea (point); 'btts': 'Y'/'N';
// 'dc' (doble oportunidad): '1X'/'12'/'X2'; 'dnb' (empate no vale): '1'/'2' (empate = nula).
export function settleOutcome(market, outcome, home, away, point) {
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null;
  if (market === 'totals') {
    if (!Number.isFinite(point)) return null;
    const total = home + away;
    const one = line => total === line ? 'V' : (total > line) === (outcome === 'O') ? 'W' : 'L';
    // Líneas de cuarto (2,25 / 2,75): media apuesta a cada línea vecina.
    if (Math.abs(point * 4 % 2) === 1) {
      const a = one(point - 0.25), b = one(point + 0.25);
      if (a === b) return a;
      const r = [a, b].sort().join('');
      return r === 'VW' ? 'HW' : r === 'LV' ? 'HL' : null;
    }
    return one(point);
  }
  if (market === 'btts') return (home > 0 && away > 0) === (outcome === 'Y') ? 'W' : 'L';
  const res = home > away ? '1' : home < away ? '2' : 'X';
  if (market === 'dc') return outcome.includes(res) ? 'W' : 'L';
  if (market === 'dnb') return res === 'X' ? 'V' : res === outcome ? 'W' : 'L';
  return res === outcome ? 'W' : 'L';
}

// Beneficio de una apuesta cerrada (mismas reglas que la app: pago redondeado a céntimos − riesgo).
export function betProfit(result, stake, odds, bonus, cashout) {
  const r2c = x => Math.round(Number((x * 100).toPrecision(12))) / 100;
  const s = +stake || 0, o = +odds || 1, f = !!bonus;
  const pay = result === 'W' ? (f ? s * (o - 1) : s * o) : result === 'V' ? (f ? 0 : s)
    : result === 'HW' ? (f ? s * 0.5 * (o - 1) : s * 0.5 * (1 + o)) : result === 'HL' ? (f ? 0 : s * 0.5)
    : result === 'CO' ? +cashout || 0 : 0;
  return r2c(r2c(pay) - (f ? 0 : r2c(s)));
}

// Marcador de la respuesta de /scores: {home, away} o null si aún no ha terminado.
export function finalScore(ev) {
  if (!ev || !ev.completed || !Array.isArray(ev.scores)) return null;
  const get = name => { const s = ev.scores.find(x => x.name === name); return s ? parseFloat(s.score) : NaN; };
  const home = get(ev.home_team), away = get(ev.away_team);
  return Number.isFinite(home) && Number.isFinite(away) ? { home, away } : null;
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
export const outcomeName = (p, o, mkt) => mkt === 'dc' ? (o === '1X' ? `${p.home} o empate` : o === '12' ? `${p.home} o ${p.away}` : `${p.away} o empate`)
  : mkt === 'dnb' ? `${o === '1' ? p.home : p.away} (empate nula)`
  : mkt === 'btts' ? `Ambos marcan: ${o === 'Y' ? 'sí' : 'no'}`
  : o === '1' ? p.home : o === '2' ? p.away : o === 'X' ? 'Empate'
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
  const head = `<b>🔥 PICKS · PRECIO JUSTO SIN MARGEN</b>\n` +
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
