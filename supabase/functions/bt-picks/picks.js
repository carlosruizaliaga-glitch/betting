// Cálculo de picks 1X2 a partir de las cuotas de Pinnacle (sin dependencias: se usa en la
// Edge Function y en los tests con Node).

export const BOOKS = ['pinnacle', 'sport888', 'marathonbet', 'betfair_ex_eu'];
const BOOK_NAMES = { pinnacle: 'Pinnacle', sport888: '888sport', marathonbet: 'Marathonbet', betfair_ex_eu: 'Betfair Exch.' };
// En el exchange se paga comisión sobre la ganancia: se compara la cuota neta.
const EXCHANGE_COMMISSION = { betfair_ex_eu: 0.05 };
export const OUTCOMES = ['1', 'X', '2'];

const r2 = x => Math.round(x * 100) / 100;

// Quita el margen. "mult": proporcional (p = (1/c) / Σ(1/c)).
// "power": p = (1/c)^k con k tal que Σp = 1; carga más margen a los no favoritos.
export function devig(odds, method) {
  const inv = OUTCOMES.map(o => 1 / odds[o]);
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
  return Object.fromEntries(OUTCOMES.map((o, i) => [o, p[i]]));
}

function h2h(bookmaker, ev) {
  const m = (bookmaker.markets || []).find(x => x.key === 'h2h');
  if (!m) return null;
  const get = name => { const o = m.outcomes.find(x => x.name === name); return o ? +o.price : null; };
  const r = { '1': get(ev.home_team), 'X': get('Draw'), '2': get(ev.away_team) };
  return OUTCOMES.every(o => r[o] > 1) ? r : null;
}

// events: respuesta de /v4/sports/{key}/odds. Devuelve un pick por partido con Pinnacle.
export function buildPicks(events, opts) {
  const { league, sportKey, threshold = 3, method = 'power', now = new Date(), capturedAt = new Date() } = opts;
  const out = [];
  for (const ev of events || []) {
    if (new Date(ev.commence_time) <= now) continue;
    const pinBook = (ev.bookmakers || []).find(b => b.key === 'pinnacle');
    const pin = pinBook && h2h(pinBook, ev);
    if (!pin) continue;
    const prob = devig(pin, method);
    const fairOdds = Object.fromEntries(OUTCOMES.map(o => [o, 1 / prob[o]]));
    const best = {};
    for (const b of ev.bookmakers || []) {
      if (b.key === 'pinnacle') continue;
      const o = h2h(b, ev);
      if (!o) continue;
      const c = EXCHANGE_COMMISSION[b.key] || 0;
      for (const k of OUTCOMES) {
        const net = r2(1 + (o[k] - 1) * (1 - c));
        if (!best[k] || net > best[k].odds) best[k] = { book: BOOK_NAMES[b.key] || b.title || b.key, odds: net, edge: net / fairOdds[k] - 1 };
      }
    }
    const favorite = OUTCOMES.reduce((a, b) => prob[b] > prob[a] ? b : a, '1');
    let valueOutcome = null;
    for (const k of OUTCOMES) {
      if (best[k] && best[k].edge * 100 >= threshold && (!valueOutcome || best[k].edge > best[valueOutcome].edge)) valueOutcome = k;
    }
    out.push({
      id: ev.id, sport_key: sportKey, league, home: ev.home_team, away: ev.away_team, commence_time: ev.commence_time,
      pin_odds: pin, fair_prob: prob, fair_odds: fairOdds, best, favorite, value_outcome: valueOutcome,
      devig: method, captured_at: capturedAt.toISOString()
    });
  }
  return out;
}

// ---------- Mensaje de Telegram (HTML, hora de Madrid) ----------
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const dec = (x, d) => x.toFixed(d).replace('.', ',');
const pct = x => Math.round(x * 100) + '%';
const spct = x => (x >= 0 ? '+' : '−') + Math.round(Math.abs(x) * 100) + '%';

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

function pickLines(p, threshold) {
  const m = madrid(p.commence_time);
  const probs = OUTCOMES.map(o => `${o} ${pct(p.fair_prob[o])} (${dec(p.fair_odds[o], 2)})`).join(' · ');
  const fb = p.best[p.favorite];
  const star = e => e * 100 >= threshold ? ' ⭐' : '';
  const lines = [`${m.time} ${esc(p.home)} – ${esc(p.away)}`, probs,
    `➜ ${p.favorite}` + (fb ? ` · mejor: ${esc(fb.book)} ${dec(fb.odds, 2)} (${spct(fb.edge)})${star(fb.edge)}` : '')];
  if (p.value_outcome && p.value_outcome !== p.favorite) {
    const v = p.best[p.value_outcome];
    lines.push(`⭐ VALOR ${p.value_outcome} · ${esc(v.book)} ${dec(v.odds, 2)} (${spct(v.edge)})`);
  }
  return lines.join('\n');
}

// Devuelve los trozos de mensaje (Telegram admite hasta 4096 caracteres).
export function formatMessages(picks, { mode = 'value', threshold = 3, method = 'power', analyzed } = {}) {
  const list = picks.filter(p => mode === 'all' || p.value_outcome)
    .sort((a, b) => a.league.localeCompare(b.league) || a.commence_time.localeCompare(b.commence_time));
  const n = analyzed != null ? analyzed : picks.length;
  const head = `<b>⚡ PICKS 1X2 · PINNACLE SIN MARGEN</b>\n` +
    `${mode === 'all' ? 'Todos los partidos' : `Solo ⭐ valor ≥ +${dec(threshold, threshold % 1 ? 1 : 0)}%`} · ${list.length}/${n} · 72 h · ${method === 'mult' ? 'proporcional' : 'power'}`;
  if (!list.length) return [head + `\n\nSin partidos ${mode === 'all' ? '' : 'con valor '}en las próximas 72 h.`];
  const blocks = [];
  let lastHdr = null;
  for (const p of list) {
    const hdr = `⚽ <b>${esc(p.league.toUpperCase())} · ${madrid(p.commence_time).label}</b>`;
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
