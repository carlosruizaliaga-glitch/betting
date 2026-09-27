// Cálculos puros (sin pantalla). Replican la hoja "Betting Tracker v2.20":
// - Riesgo = stake (0 si es apuesta gratis).
// - Pago según resultado; se redondea a céntimos y beneficio = pago − riesgo.
// - Stake por nivel = disponible × nivel × unidad %, redondeado a céntimos.
(function (root) {
  'use strict';

  const r2 = x => Math.round(Number((x * 100).toPrecision(12))) / 100;

  const RESULTS = {
    P: { label: 'PENDIENTE', short: 'PEND' },
    W: { label: 'GANADA', short: 'G' },
    L: { label: 'PERDIDA', short: 'P' },
    V: { label: 'NULA', short: 'N' },
    HW: { label: '1/2 GANADA', short: '1/2G' },
    HL: { label: '1/2 PERDIDA', short: '1/2P' },
    CO: { label: 'CASH OUT', short: 'CO' }
  };

  const isClosed = b => b.result && b.result !== 'P';
  const risk = b => b.bonus ? 0 : r2(+b.stake || 0);

  function payout(b) {
    const s = +b.stake || 0, o = +b.odds || 1, f = !!b.bonus;
    switch (b.result) {
      case 'W': return r2(f ? s * (o - 1) : s * o);
      case 'V': return r2(f ? 0 : s);
      case 'HW': return r2(f ? s * 0.5 * (o - 1) : s * 0.5 * (1 + o));
      case 'HL': return r2(f ? 0 : s * 0.5);
      case 'CO': return r2(+b.cashout || 0);
      default: return 0;
    }
  }
  const potential = b => r2(b.bonus ? (+b.stake || 0) * ((+b.odds || 1) - 1) : (+b.stake || 0) * (+b.odds || 1));
  const profit = b => isClosed(b) ? r2(payout(b) - risk(b)) : 0;

  // Cuota total de una combinada = producto de las cuotas de sus selecciones.
  const comboOdds = legs => r2((legs || []).reduce((p, l) => p * (+l.odds || 1), 1));

  const byTime = (a, b) => (a.date || '').localeCompare(b.date || '') || (a.created || 0) - (b.created || 0);

  // ---------- Fechas (Europe/Madrid) ----------
  const madridDate = d => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d || new Date());
  const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const weekStart = iso => { const d = new Date(iso + 'T12:00:00Z'); return addDays(iso, -((d.getUTCDay() + 6) % 7)); };

  // ---------- Caja ----------
  // Tipos de movimiento: deposit (+), withdrawal (importe positivo, resta), bonus (crédito de bono), freebet (apuesta gratis).
  function funds(bets, moves, excludeId) {
    const books = {};
    const B = name => books[name] || (books[name] = { book: name, deposits: 0, withdrawals: 0, bonus: 0, freebets: 0, freebetsUsed: 0, profit: 0, closedRisk: 0, pendingRisk: 0, pendingN: 0 });
    moves.forEach(m => {
      const x = B(m.book || '—'), a = Math.abs(+m.amount || 0);
      if (m.type === 'deposit') x.deposits += a;
      else if (m.type === 'withdrawal') x.withdrawals += a;
      else if (m.type === 'bonus') x.bonus += a;
      else if (m.type === 'freebet') x.freebets += a;
    });
    bets.forEach(b => {
      if (b.id === excludeId) return;
      const x = B(b.book || '—');
      if (b.bonus) x.freebetsUsed += +b.stake || 0;
      if (isClosed(b)) { x.profit += profit(b); x.closedRisk += risk(b); }
      else { x.pendingRisk += risk(b); x.pendingN++; }
    });
    const list = Object.values(books).map(x => {
      const net = x.deposits - x.withdrawals;
      return Object.assign(x, {
        net: r2(net), profit: r2(x.profit), closedRisk: r2(x.closedRisk), pendingRisk: r2(x.pendingRisk),
        freeLeft: r2(x.freebets - x.freebetsUsed),
        available: r2(net + x.bonus + x.profit - x.pendingRisk)
      });
    }).sort((a, b) => b.available - a.available);
    const sum = k => r2(list.reduce((s, x) => s + x[k], 0));
    return { books: list, total: { net: sum('net'), deposits: sum('deposits'), withdrawals: sum('withdrawals'), bonus: sum('bonus'), freeLeft: sum('freeLeft'),
      profit: sum('profit'), closedRisk: sum('closedRisk'), pendingRisk: sum('pendingRisk'), pendingN: list.reduce((s, x) => s + x.pendingN, 0), available: sum('available') } };
  }

  const stakeFor = (available, level, unitPct) => r2(Math.max(0, available) * level * (unitPct || 1) / 100);

  // ---------- Estadísticas ----------
  function summarize(bets) {
    const closed = bets.filter(isClosed);
    const w = closed.filter(b => b.result === 'W').length, l = closed.filter(b => b.result === 'L').length;
    const rsk = r2(closed.reduce((s, b) => s + risk(b), 0));
    const pr = r2(closed.reduce((s, b) => s + profit(b), 0));
    return { n: closed.length, w, l, risk: rsk, profit: pr, yield: rsk > 0 ? pr / rsk : null, winPct: (w + l) ? w / (w + l) : null };
  }

  function periods(bets, today) {
    const ws = addDays(today, -6), m = today.slice(0, 7), y = today.slice(0, 4);
    const f = fn => summarize(bets.filter(b => fn(b.date || '')));
    return [
      { key: 'HOY', ...f(d => d === today) },
      { key: '7D', ...f(d => d >= ws && d <= today) },
      { key: 'MES', ...f(d => d.slice(0, 7) === m && d <= today) },
      { key: 'AÑO', ...f(d => d.slice(0, 4) === y && d <= today) },
      { key: 'TOTAL', ...f(() => true) }
    ];
  }

  // Beneficio acumulado apuesta a apuesta (orden de la hoja: fecha y orden de alta).
  function profitHistory(bets) {
    let acc = 0;
    return bets.filter(isClosed).sort(byTime).map(b => { acc = r2(acc + profit(b)); return { date: b.date, id: b.id, value: acc }; });
  }

  function peaks(bets) {
    const h = profitHistory(bets), vals = [0].concat(h.map(p => p.value));
    const cur = vals[vals.length - 1], max = Math.max(...vals), min = Math.min(...vals);
    return { current: cur, max, min, fromPeak: r2(cur - max), fromTrough: r2(cur - min) };
  }

  // Evolución del bank: depósitos netos + bonos + beneficio acumulado.
  function bankSeries(bets, moves) {
    const ev = [];
    moves.forEach(m => {
      const a = Math.abs(+m.amount || 0);
      const d = m.type === 'deposit' || m.type === 'bonus' ? a : m.type === 'withdrawal' ? -a : 0;
      if (d) ev.push({ date: m.date, created: m.created || 0, delta: d });
    });
    bets.filter(isClosed).forEach(b => ev.push({ date: b.date, created: b.created || 0, delta: profit(b), bet: b }));
    ev.sort(byTime);
    let acc = 0;
    return ev.map(e => { acc = r2(acc + e.delta); return { date: e.date, value: acc, delta: e.delta, bet: e.bet }; });
  }

  function oddsStats(bets) {
    const c = bets.filter(b => b.result === 'W' || b.result === 'L');
    const st = arr => {
      const o = arr.map(b => +b.odds).filter(x => x > 1);
      return o.length ? { n: o.length, avg: o.reduce((s, x) => s + x, 0) / o.length, min: Math.min(...o), max: Math.max(...o) } : { n: 0 };
    };
    return { all: st(c), won: st(c.filter(b => b.result === 'W')), lost: st(c.filter(b => b.result === 'L')) };
  }

  const ODDS_RANGES = [
    { key: '1,01–1,50', lo: 0, hi: 1.5 }, { key: '1,51–2,00', lo: 1.5, hi: 2 },
    { key: '2,01–3,00', lo: 2, hi: 3 }, { key: '>3,00', lo: 3, hi: Infinity }
  ];
  const oddsRange = o => (ODDS_RANGES.find(r => o > r.lo && o <= r.hi) || ODDS_RANGES[0]).key;

  function groupBy(bets, keyFn, order) {
    const g = {};
    bets.filter(isClosed).forEach(b => { const k = keyFn(b) || '—'; (g[k] = g[k] || []).push(b); });
    const rows = Object.keys(g).map(k => Object.assign({ key: k }, summarize(g[k])));
    if (order) return order.map(k => rows.find(r => r.key === k) || { key: k, n: 0, w: 0, l: 0, risk: 0, profit: 0, yield: null, winPct: null });
    return rows.sort((a, b) => b.n - a.n || a.key.localeCompare(b.key));
  }

  // Racha: ganadas (G, 1/2G) o perdidas (P, 1/2P) seguidas desde la última cerrada. Nulas y cash out no cortan ni suman.
  function streak(bets) {
    const c = bets.filter(b => ['W', 'HW', 'L', 'HL'].includes(b.result)).sort(byTime).reverse();
    if (!c.length) return { type: null, n: 0 };
    const win = r => r === 'W' || r === 'HW';
    const t = win(c[0].result);
    let n = 0;
    for (const b of c) { if (win(b.result) !== t) break; n++; }
    return { type: t ? 'W' : 'L', n };
  }

  function clvStats(bets) {
    const v = bets.filter(b => typeof b.clv === 'number' && isFinite(b.clv));
    return { n: v.length, avg: v.length ? v.reduce((s, b) => s + b.clv, 0) / v.length : null, pos: v.length ? v.filter(b => b.clv > 0).length / v.length : null };
  }

  // Beneficio de la semana (lunes–domingo) y del mes en curso, para los límites de pérdida.
  function lossWindows(bets, today) {
    const ws = weekStart(today), m = today.slice(0, 7);
    return {
      week: summarize(bets.filter(b => b.date >= ws && b.date <= today)).profit,
      month: summarize(bets.filter(b => (b.date || '').slice(0, 7) === m)).profit
    };
  }

  const L = { r2, RESULTS, isClosed, risk, payout, potential, profit, comboOdds, byTime, madridDate, addDays, weekStart,
    funds, stakeFor, summarize, periods, profitHistory, peaks, bankSeries, oddsStats, ODDS_RANGES, oddsRange, groupBy, streak, clvStats, lossWindows };
  if (typeof module !== 'undefined') module.exports = L; else root.Logic = L;
})(typeof window !== 'undefined' ? window : globalThis);
