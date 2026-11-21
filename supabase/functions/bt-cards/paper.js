// Resultados de partidos (CSV de football-data.co.uk) para cerrar las apuestas "en papel" y los picks de Claude,
// y el informe semanal de Telegram. Funciones puras: se prueban en node (test/cards.test.mjs).
import { teamSim } from './cards.js';

// Filas compactas de resultados: [fecha ISO, local, visitante, gL, gV, córnersTotales, tarjetasTotales]
export function resultRows(rows) {
  const out = [];
  rows.forEach(r => {
    const m = /^(\d{2})\/(\d{2})\/(\d{2,4})$/.exec(r.Date || '');
    const hg = parseFloat(r.FTHG), ag = parseFloat(r.FTAG);
    if (!m || !r.HomeTeam || !Number.isFinite(hg) || !Number.isFinite(ag)) return;
    const y = m[3].length === 2 ? '20' + m[3] : m[3];
    const n = k => parseFloat(r[k]);
    const c = n('HC') + n('AC'), k = n('HY') + n('AY') + n('HR') + n('AR');
    out.push([`${y}-${m[2]}-${m[1]}`, r.HomeTeam, r.AwayTeam, hg, ag, Number.isFinite(c) ? c : null, Number.isFinite(k) ? k : null]);
  });
  return out;
}

const dayDiff = (a, b) => Math.abs(new Date(a + 'T12:00:00Z') - new Date(b + 'T12:00:00Z')) / 864e5;

// Busca el partido: misma fecha (±1 día) y los dos equipos parecidos.
export function findResult(res, home, away, date) {
  let best = null, bs = 0;
  res.forEach(r => {
    if (dayDiff(r[0], date) > 1) return;
    const s = Math.min(teamSim(home, r[1]), teamSim(away, r[2]));
    if (s >= 0.5 && s > bs) { bs = s; best = r; }
  });
  return best;
}

// Resultado de una selección: W (ganada), L (perdida), V (nula) o null si no se puede saber.
// market: h2h | dc | dnb | totals | btts | corners | cards · outcome: 1 X 2 1X 12 X2 O U Y N
export function settle(market, outcome, point, r) {
  if (!r) return null;
  const hg = r[3], ag = r[4], res = hg > ag ? '1' : hg < ag ? '2' : 'X';
  const ou = total => {
    if (total == null || !Number.isFinite(+point)) return null;
    if (total === +point) return 'V';
    return (total > +point) === (outcome === 'O') ? 'W' : 'L';
  };
  if (market === 'h2h') return res === outcome ? 'W' : 'L';
  if (market === 'dc') return outcome.includes(res) ? 'W' : 'L';
  if (market === 'dnb') return res === 'X' ? 'V' : res === outcome ? 'W' : 'L';
  if (market === 'totals') return ou(hg + ag);
  if (market === 'btts') return (hg > 0 && ag > 0) === (outcome === 'Y') ? 'W' : 'L';
  if (market === 'corners') return ou(r[5]);
  if (market === 'cards') return ou(r[6]);
  return null;
}

// Beneficio de una apuesta en papel a 1 unidad.
export const unitProfit = (result, odds) => result === 'W' ? odds - 1 : result === 'L' ? -1 : 0;

// ---------- Informe semanal ----------
const r2 = x => Math.round(x * 100) / 100;
const eur = x => (x >= 0 ? '+' : '−') + Math.abs(r2(x)).toFixed(2).replace('.', ',') + ' €';
const pct = x => (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(1).replace('.', ',') + ' %';
const isClosed = b => !!b.result && b.result !== 'P';
function betProfit(b) {
  const s = +b.stake || 0, o = +b.odds || 1, f = !!b.bonus, r = b.result;
  const pay = r === 'W' ? (f ? s * (o - 1) : s * o) : r === 'V' ? (f ? 0 : s) : r === 'HW' ? (f ? s * .5 * (o - 1) : s * .5 * (1 + o)) : r === 'HL' ? (f ? 0 : s * .5) : r === 'CO' ? +b.cashout || 0 : 0;
  return r2(pay - (f ? 0 : s));
}

export function weeklyReport(items, now) {
  const to = new Date(now), from = new Date(to.getTime() - 7 * 864e5);
  const iso = d => d.toISOString().slice(0, 10), f = iso(from), t = iso(to);
  const inWeek = x => x.date >= f && x.date < t;
  const bets = items.filter(x => x.kind === 'bet').map(x => x.data).filter(b => isClosed(b) && inWeek(b));
  const real = bets.filter(b => !b.bonus);
  const staked = real.reduce((a, b) => a + (+b.stake || 0), 0), prof = bets.reduce((a, b) => a + betProfit(b), 0);
  const won = bets.filter(b => b.result === 'W' || b.result === 'HW').length;
  const clv = bets.filter(b => typeof b.clv === 'number');
  const noValue = real.filter(b => b.fair > 1 && b.odds > 1 && b.odds < b.fair);
  const byType = {};
  bets.forEach(b => { const k = b.type || 'Otros'; byType[k] = (byType[k] || 0) + betProfit(b); });
  const types = Object.entries(byType).sort((a, b) => b[1] - a[1]);
  const out = [`📊 <b>Resumen semanal</b> · ${f.slice(8)}/${f.slice(5, 7)} – ${t.slice(8)}/${t.slice(5, 7)}`, ''];
  if (!bets.length) out.push('Sin apuestas cerradas esta semana.');
  else {
    out.push(`Apuestas: <b>${bets.length}</b> · acierto ${Math.round(won / bets.length * 100)} %`);
    out.push(`Apostado: ${r2(staked).toFixed(2).replace('.', ',')} € · beneficio <b>${eur(prof)}</b>${staked > 0 ? ` · yield ${pct(prof / staked)}` : ''}`);
    if (clv.length) out.push(`CLV medio: ${pct(clv.reduce((a, b) => a + b.clv, 0) / clv.length)} en ${clv.length} apuestas`);
    if (types.length > 1) out.push(`Mejor mercado: ${types[0][0]} (${eur(types[0][1])}) · peor: ${types[types.length - 1][0]} (${eur(types[types.length - 1][1])})`);
    if (noValue.length) out.push(`⚠️ ${noValue.length} apuesta${noValue.length > 1 ? 's' : ''} por debajo de la cuota justa`);
  }
  const paperOf = kind => items.filter(x => x.kind === kind).map(x => x.data).filter(p => p.result && inWeek(p));
  [['paper', 'Picks en papel (1 unidad)'], ['claude', 'Picks de Claude (1 unidad)']].forEach(([k, name]) => {
    const ps = paperOf(k);
    if (!ps.length) return;
    const pr = ps.reduce((a, p) => a + unitProfit(p.result, +p.odds), 0);
    out.push('', `<b>${name}</b>: ${ps.length} · ${pr >= 0 ? '+' : '−'}${Math.abs(r2(pr)).toFixed(2).replace('.', ',')} u · yield ${pct(pr / ps.length)}`);
  });
  return out.join('\n');
}
