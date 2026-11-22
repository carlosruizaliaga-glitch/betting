// Modelo de tarjetas y córneres a partir de los CSV gratuitos de football-data.co.uk (sin clave ni límite de consultas).
// Estima la media de córneres y tarjetas de un partido con el historial de los dos equipos (media por partido, ajustada
// hacia la media de la liga) y reparte las probabilidades con una binomial negativa (los córneres y las tarjetas varían más que Poisson).

export const LEAGUES = {
  soccer_spain_la_liga: 'SP1', soccer_spain_segunda_division: 'SP2', soccer_epl: 'E0', soccer_efl_champ: 'E1',
  soccer_germany_bundesliga: 'D1', soccer_germany_bundesliga2: 'D2', soccer_italy_serie_a: 'I1', soccer_italy_serie_b: 'I2',
  soccer_france_ligue_one: 'F1', soccer_france_ligue_two: 'F2', soccer_portugal_primeira_liga: 'P1',
  soccer_netherlands_eredivisie: 'N1', soccer_belgium_first_div: 'B1', soccer_turkey_super_league: 'T1', soccer_greece_super_league: 'G1',
  soccer_spl: 'SC0'
};

// Temporada actual en el formato de football-data: 2627 = 2026/27 (empieza en julio).
export function seasonCode(d) {
  d = d || new Date();
  const y = d.getUTCFullYear(), s = d.getUTCMonth() >= 6 ? y : y - 1;
  return String(s).slice(2) + String(s + 1).slice(2);
}
export const prevSeason = code => String(+code.slice(0, 2) - 1).padStart(2, '0') + String(+code.slice(2) - 1).padStart(2, '0');

export function parseCsv(text) {
  const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const head = lines[0].split(',');
  return lines.slice(1).map(l => { const c = l.split(','), o = {}; head.forEach((h, i) => { o[h] = c[i]; }); return o; });
}

// Resumen por equipo (partidos en casa y fuera: córneres y tarjetas totales del partido) y de la liga.
export function buildTable(rows) {
  const teams = {}, lg = { n: 0, c: 0, c2: 0, k: 0, k2: 0 };
  const T = n => teams[n] || (teams[n] = { hn: 0, an: 0, hC: 0, aC: 0, hK: 0, aK: 0 });
  rows.forEach(r => {
    const v = ['HC', 'AC', 'HY', 'AY', 'HR', 'AR'].map(k => parseFloat(r[k]));
    if (!r.HomeTeam || !r.AwayTeam || v.some(x => !Number.isFinite(x))) return;
    const c = v[0] + v[1], k = v[2] + v[3] + v[4] + v[5];
    const h = T(r.HomeTeam), a = T(r.AwayTeam);
    h.hn++; h.hC += c; h.hK += k; a.an++; a.aC += c; a.aK += k;
    lg.n++; lg.c += c; lg.c2 += c * c; lg.k += k; lg.k2 += k * k;
  });
  return { teams, lg };
}

// Une la temporada actual con la anterior (esta pesa la mitad) para tener más muestra a principio de temporada.
export function mergeTables(cur, prev, w) {
  w = w == null ? 0.5 : w;
  if (!prev) return cur;
  const teams = {};
  const add = (t, f) => Object.keys(t).forEach(n => { const o = teams[n] || (teams[n] = { hn: 0, an: 0, hC: 0, aC: 0, hK: 0, aK: 0 }); Object.keys(o).forEach(k => { o[k] += t[n][k] * f; }); });
  add(cur.teams, 1); add(prev.teams, w);
  const lg = {}; Object.keys(cur.lg).forEach(k => { lg[k] = cur.lg[k] + prev.lg[k] * w; });
  return { teams, lg };
}

const STOP = new Set(['fc', 'cf', 'cd', 'ud', 'sc', 'ac', 'as', 'afc', 'ssc', 'sv', 'fk', 'sk', 'if', 'bk', 'club', 'de', 'del', 'the', 'real', 'calcio', 'futbol', 'football']);
const ALIAS = { man: 'manchester', utd: 'united', spurs: 'tottenham', wolves: 'wolverhampton', inter: 'internazionale', psg: 'paris', st: 'saint', nott: 'nottingham', forest: 'forest' };
const tokens = name => {
  const t = String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  const o = t.map(x => ALIAS[x] || x).filter(x => !STOP.has(x));
  return o.length ? o : t;
};
export function teamSim(a, b) {
  const A = tokens(a), B = tokens(b);
  if (!A.length || !B.length) return 0;
  if (A.join(' ') === B.join(' ')) return 1;
  const small = A.length <= B.length ? A : B, big = A.length <= B.length ? B : A;
  return small.filter(x => big.some(y => y === x || (x.length > 3 && y.length > 3 && (y.startsWith(x) || x.startsWith(y))))).length / small.length;
}
const plain = name => String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export function findTeam(table, name) {
  const names = Object.keys(table.teams), p = plain(name);
  const exact = names.find(n => plain(n) === p);
  if (exact) return exact;
  let best = null, bs = 0;
  names.forEach(n => {
    const A = tokens(name), B = tokens(n), sim = teamSim(name, n);
    const s = sim - 0.01 * Math.abs(A.length - B.length);       // a igualdad, el nombre con más palabras en común
    if (sim >= 0.5 && s > bs) { bs = s; best = n; }
  });
  return best;
}

// P(X > línea) con binomial negativa de media mu y dispersión r (r grande = Poisson).
export function overProb(mu, r, line) {
  const k0 = Math.floor(line) + 1;           // más de 9,5 = al menos 10
  let p = Math.pow(r / (r + mu), r), cdf = 0;
  for (let k = 0; k < k0; k++) { cdf += p; p *= (k + r) / (k + 1) * mu / (r + mu); }
  return Math.min(0.999, Math.max(0.001, 1 - cdf));
}

const r2 = x => Math.round(x * 100) / 100;
// Probabilidad de exactamente k (binomial negativa) para k = 0..n.
export function pmfs(mu, r, n) {
  const out = []; let p = Math.pow(r / (r + mu), r);
  for (let k = 0; k <= n; k++) { out.push(p); p *= (k + r) / (k + 1) * mu / (r + mu); }
  return out;
}
// Líneas enteras como en bet365: Más de N (más de N, sin devolución), Exactamente N y Menos de N (menos de N).
function marketInt(mu, r, thr, halfSpan, floorLine) {
  const base = Math.max(floorLine, Math.round(mu)), lo = Math.max(1, base - halfSpan), hi = base + halfSpan, pm = pmfs(mu, r, hi + 1), lines = [];
  const clamp = x => Math.min(0.999, Math.max(0.001, x)), min = f => r2(Math.ceil(f * (1 + thr) * 100 - 1e-9) / 100);
  for (let n = lo; n <= hi; n++) {
    let cdf = 0; for (let k = 0; k < n; k++) cdf += pm[k];          // P(X < n)
    const u = clamp(cdf), e = clamp(pm[n]), o = clamp(1 - cdf - pm[n]);
    lines.push({ line: n, int: true, over: r2(o * 100), exact: r2(e * 100), under: r2(u * 100),
      fairOver: r2(1 / o), fairExact: r2(1 / e), fairUnder: r2(1 / u), minOver: min(1 / o), minExact: min(1 / e), minUnder: min(1 / u) });
  }
  return { mu: r2(mu), lines };
}
function market(mu, r, nMin, thr, halfSpan, floorLine) {
  const base = Math.max(floorLine, Math.round(mu - 0.5) + 0.5), lines = [];
  for (let l = base - halfSpan; l <= base + halfSpan + 1e-9; l += 1) {
    if (l < 0.5) continue;
    const o = overProb(mu, r, l), u = 1 - o;
    lines.push({ line: l, over: r2(o * 100), under: r2(u * 100), fairOver: r2(1 / o), fairUnder: r2(1 / u),
      minOver: r2(Math.ceil(100 / o * (1 + thr) - 1e-9) / 100), minUnder: r2(Math.ceil(100 / u * (1 + thr) - 1e-9) / 100) });
  }
  return { mu: r2(mu), lines };
}

// Modelo del partido: media de córneres y tarjetas y líneas con probabilidad, cuota justa y cuota mínima con valor.
export function ccModel(table, home, away, thr) {
  const th = findTeam(table, home), ta = findTeam(table, away);
  if (!th || !ta || table.lg.n < 20) return null;
  const lg = table.lg, mC = lg.c / lg.n, mK = lg.k / lg.n;
  const disp = (m, s2) => { const v = s2 / lg.n - m * m; return v > m ? Math.min(200, Math.max(3, m * m / (v - m))) : 200; };
  const K = 4, H = table.teams[th], A = table.teams[ta];
  const rate = (sum, n, mean) => (sum + K * mean) / (n + K);
  const muC = (rate(H.hC, H.hn, mC) + rate(A.aC, A.an, mC)) / 2, muK = (rate(H.hK, H.hn, mK) + rate(A.aK, A.an, mK)) / 2;
  const n = Math.round(Math.min(H.hn, A.an));
  return { v: 2, teams: { home: th, away: ta }, matches: n, leagueMatches: Math.round(lg.n), leagueMean: { corners: r2(mC), cards: r2(mK) },
    corners: marketInt(muC, disp(mC, lg.c2), thr, 4, 3), cards: market(muK, disp(mK, lg.k2), n, thr, 2, 1.5) };
}
