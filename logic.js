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

  // Importe sugerido según la ventaja. Con p = 1 / cuota justa, Kelly dice apostar (p·cuota − 1) / (cuota − 1) de la banca;
  // se usa solo una fracción (por defecto un cuarto) y se traduce al nivel de stake más cercano (mínimo 1, máximo capLevel).
  // Sin ventaja (cuota ≤ justa) no se sugiere apostar: level 0.
  function suggestStake(odds, fair, available, unitPct, frac, capLevel) {
    const o = +odds, f = +fair;
    if (!(o > 1) || !(f > 1)) return null;
    const edge = o / f - 1;
    if (!(edge > 0)) return { edge, pct: 0, stake: 0, level: 0 };
    const pct = Math.max(0, ((o / f - 1) / (o - 1)) * (frac > 0 ? frac : 0.25) * 100);
    const unit = unitPct > 0 ? unitPct : 1;
    const level = Math.max(1, Math.min(capLevel || 5, Math.round(pct / unit)));
    return { edge, pct, stake: stakeFor(available, level, unit), level };
  }

  // ---------- Confianza y nivel de stake ----------
  // Confianza (0–100) en que la probabilidad justa del mercado es buena para ESTA selección. Parte de 70 y suma o resta por:
  // fuentes afinadas, acuerdo de casas normales y del modelo, tiempo hasta el partido, tipo de mercado, movimiento y tamaño de la ventaja.
  // i = { p, srcN, soft, model, hours, kind: 'main'|'extra', move, edge }  (p, soft y model son probabilidades 0–1 o null)
  function pickConfidence(i) {
    let score = 70;
    const why = [];
    const add = (d, txt) => { if (d) { score += d; why.push({ d, txt }); } };
    add(i.srcN >= 2 ? 10 : -5, i.srcN >= 2 ? 'Pinnacle y Betfair coinciden en el precio' : 'Solo hay una fuente afinada');
    if (i.soft != null) {
      const d = Math.abs(i.p - i.soft);
      if (d <= 0.02) add(5, 'Las casas normales coinciden con el mercado');
      else if (d > 0.05) add(-10, `Las casas normales se separan ${Math.round(d * 100)} puntos`);
    }
    if (i.model != null) {
      const d = i.model - i.p, a = Math.abs(d);
      let pen = a <= 0.05 ? 10 : a <= 0.10 ? 0 : a <= 0.20 ? -10 : -20;
      if (pen < 0 && d > 0) pen = Math.round(pen / 2);          // si el modelo da MÁS probabilidad que el mercado, penaliza la mitad
      add(pen, a <= 0.05 ? 'El modelo coincide con el mercado' : a <= 0.10 ? 'El modelo se separa algo del mercado'
        : `El modelo se separa ${Math.round(a * 100)} puntos del mercado (${d > 0 ? 'a favor' : 'en contra'})`);
    }
    if (i.hours != null) {
      if (i.hours > 48) add(-10, 'Faltan más de 48 h: el precio puede moverse mucho');
      else if (i.hours > 24) add(-5, 'Falta más de un día');
      else if (i.hours <= 6) add(5, 'Cerca del inicio: el precio está más afinado');
    }
    if (i.p < 0.2) add(-10, 'Selección muy improbable: más variación');
    else if (i.p >= 0.5) add(5, 'Selección probable: menos variación');
    if (i.kind === 'extra') add(-8, 'Mercado con menos liquidez (otras líneas o ambos marcan)');
    if (i.move != null && Math.abs(i.move) >= 0.02) add(i.move > 0 ? 5 : -5, i.move > 0 ? 'El mercado se mueve a tu favor' : 'El mercado se mueve en contra');
    if (i.edge > 0.08) add(-15, 'Ventaja muy grande: comprueba que es la misma selección y que la cuota es real');
    score = Math.max(0, Math.min(100, Math.round(score)));
    return { score, label: score >= 70 ? 'ALTA' : score >= 50 ? 'MEDIA' : 'BAJA', sigma: 0.01 + (100 - score) / 100 * 0.03, why: why.sort((a, b) => Math.abs(b.d) - Math.abs(a.d)) };
  }

  // Nivel de stake según valor y confianza: Kelly fraccionado con una probabilidad prudente (p − incertidumbre).
  // Menos confianza = probabilidad más baja = menos stake, y tope de nivel (alta 5, media 3, baja 2). Sin ventaja prudente: no apostar (nivel 0).
  function stakeByConfidence(odd, p, conf, available, unitPct, frac) {
    const o = +odd;
    if (!(o > 1) || !(p > 0)) return null;
    const pc = Math.max(0.005, p - conf.sigma), edgeRaw = o * p - 1, edgeC = o * pc - 1;
    if (!(edgeC > 0)) return { edgeRaw, edgeC, pc, pct: 0, level: 0, stake: 0, cap: 0 };
    const pct = (edgeC / (o - 1)) * (frac > 0 ? frac : 0.25) * 100, unit = unitPct > 0 ? unitPct : 1;
    const cap = conf.score >= 70 ? 5 : conf.score >= 50 ? 3 : 2;
    const level = Math.max(1, Math.min(cap, Math.round(pct / unit)));
    return { edgeRaw, edgeC, pc, pct, level, stake: stakeFor(available, level, unit), cap };
  }

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

  // CLV en dos partes (1 + real = (1 + precio pagado) × (1 + selección)):
  //  · selección: cuota justa al apostar ÷ cuota justa al cierre − 1 (sin margen: no depende de la casa).
  //  · precio pagado: tu cuota ÷ cuota justa al apostar − 1 (lo que cobra la casa; con bet365 casi siempre negativo).
  //  · real: tu cuota ÷ cuota justa al cierre − 1 (el CLV clásico, guardado en b.clv).
  // Stats usa el modo elegido en Ajustes (por defecto, selección).
  let clvMode = 'sel';
  const setClvMode = m => { clvMode = m === 'real' ? 'real' : 'sel'; };
  const clvSel = b => b.fair > 1 && b.closingFair > 1 && isSingleB(b) ? b.fair / b.closingFair - 1 : null;
  const clvPaid = b => b.fair > 1 && b.odds > 1 && isSingleB(b) ? b.odds / b.fair - 1 : null;
  function isSingleB(b) { return (b.legs || []).length <= 1; }
  const clvOf = (b, mode) => {
    const m = mode || clvMode;
    if (m === 'real') return typeof b.clv === 'number' && isFinite(b.clv) ? b.clv : null;
    return typeof b.clv === 'number' && isFinite(b.clv) ? clvSel(b) : null;
  };
  const hasClv = b => clvOf(b) != null;

  function clvStats(bets, mode) {
    const v = bets.map(b => clvOf(b, mode)).filter(x => x != null);
    return { n: v.length, avg: v.length ? v.reduce((s, x) => s + x, 0) / v.length : null, pos: v.length ? v.filter(x => x > 0).length / v.length : null };
  }

  // Desglose medio del CLV: precio pagado, selección y real (solo apuestas con cierre).
  function clvParts(bets) {
    const v = bets.filter(b => typeof b.clv === 'number' && isFinite(b.clv) && clvSel(b) != null && clvPaid(b) != null);
    const avg = f => v.length ? v.reduce((s, b) => s + f(b), 0) / v.length : null;
    return { n: v.length, paid: avg(clvPaid), sel: avg(clvSel), real: avg(b => b.clv), selPos: v.length ? v.filter(b => clvSel(b) > 0).length / v.length : null };
  }

  // CLV agrupado (por liga, mercado…): n, CLV medio, % positivas y resultado económico de esas apuestas.
  function clvBy(bets, keyFn, order) {
    const g = {};
    bets.filter(hasClv).forEach(b => { const k = keyFn(b) || '—'; (g[k] = g[k] || []).push(b); });
    const row = k => {
      const list = g[k] || [], s = summarize(list), c = clvStats(list);
      return { key: k, n: list.length, avg: c.avg, pos: c.pos, profit: s.profit, yield: s.yield };
    };
    if (order) return order.map(row);
    return Object.keys(g).map(row).sort((a, b) => b.n - a.n || a.key.localeCompare(b.key));
  }

  // ---------- Análisis avanzado (Stats) ----------
  const isSingle = b => (b.legs || []).length <= 1;
  const winR = r => r === 'W' || r === 'HW', lossR = r => r === 'L' || r === 'HL';

  // Beneficio esperado frente al real. Esperado = importe × (tu cuota ÷ cuota justa al apostar − 1).
  // "Suerte" = real − esperado. evClose usa la cuota justa de cierre (lo que dice el CLV).
  function expectedVsReal(bets) {
    const list = bets.filter(b => isClosed(b) && !b.bonus && b.result !== 'CO' && isSingle(b) && b.fair > 1 && b.odds > 1);
    let ev = 0, evClose = 0, nClose = 0, real = 0, rsk = 0;
    list.forEach(b => {
      const st = risk(b);
      ev += st * (b.odds / b.fair - 1); real += profit(b); rsk += st;
      if (b.closingFair > 1) { evClose += st * (b.odds / b.closingFair - 1); nClose++; }
    });
    return { n: list.length, risk: r2(rsk), ev: r2(ev), real: r2(real), luck: r2(real - ev), evClose: r2(evClose), nClose };
  }

  // Distribución normal (aproximación de Abramowitz-Stegun, error < 1e-7).
  function erf(x) {
    const sg = Math.sign(x); x = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * x);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return sg * y;
  }
  const normCdf = z => 0.5 * (1 + erf(z / Math.SQRT2));

  // ¿Es suerte? Si no tuvieras ninguna ventaja (cuota = justa), el beneficio esperado sería 0 con varianza Σ importe²·(cuota − 1).
  // pLuck = probabilidad de llegar a un resultado tan bueno (o tan malo) solo por azar. Rango del yield al 95 %.
  function luckTest(bets) {
    const list = bets.filter(b => (b.result === 'W' || b.result === 'L') && !b.bonus && b.odds > 1 && isSingle(b));
    let pr = 0, v = 0, rsk = 0;
    list.forEach(b => { const st = +b.stake || 0; pr += profit(b); v += st * st * (b.odds - 1); rsk += st; });
    const sd = Math.sqrt(v), z = sd > 0 ? pr / sd : 0;
    return { n: list.length, enough: list.length >= 20, profit: r2(pr), z, pLuck: 1 - normCdf(Math.abs(z)),
      yield: rsk > 0 ? pr / rsk : null, yieldLo: rsk > 0 ? (pr - 1.96 * sd) / rsk : null, yieldHi: rsk > 0 ? (pr + 1.96 * sd) / rsk : null };
  }

  // Calibración: por tramos de probabilidad (justa si la hay; si no, la de tu cuota), cuánto deberías acertar y cuánto aciertas.
  const CAL_KEYS = ['< 30 %', '30–45 %', '45–60 %', '60–75 %', '> 75 %'];
  function calibration(bets) {
    const rows = CAL_KEYS.map(k => ({ key: k, n: 0, exp: 0, won: 0 }));
    bets.filter(b => (b.result === 'W' || b.result === 'L') && isSingle(b) && b.odds > 1).forEach(b => {
      const pr = b.fair > 1 ? 1 / b.fair : 1 / b.odds;
      const i = pr < 0.3 ? 0 : pr < 0.45 ? 1 : pr < 0.6 ? 2 : pr < 0.75 ? 3 : 4;
      rows[i].n++; rows[i].exp += pr; if (b.result === 'W') rows[i].won++;
    });
    return rows.map(r => ({ key: r.key, n: r.n, expPct: r.n ? r.exp / r.n : null, actPct: r.n ? r.won / r.n : null }));
  }

  // Resumen por mes (cerradas), en orden.
  function monthly(bets) {
    const g = {};
    bets.filter(isClosed).forEach(b => { const k = (b.date || '').slice(0, 7); (g[k] = g[k] || []).push(b); });
    return Object.keys(g).sort().map(k => Object.assign({ key: k }, summarize(g[k])));
  }

  // Beneficio de cada día (cerradas): { 'AAAA-MM-DD': beneficio }.
  function daily(bets) {
    const d = {};
    bets.filter(isClosed).forEach(b => { d[b.date] = r2((d[b.date] || 0) + profit(b)); });
    return d;
  }

  // Peor caída del beneficio acumulado: cuánto, desde qué fecha (pico) hasta cuál (fondo), cuántas apuestas y si ya se recuperó.
  function drawdown(bets) {
    const h = profitHistory(bets);
    let peak = 0, peakDate = null, peakI = -1, best = { max: 0, peakDate: null, troughDate: null, bets: 0, recoveredDate: null };
    let cur = null;
    h.forEach((pt, i) => {
      if (pt.value >= peak) {
        if (cur && cur.recoveredDate === null) cur.recoveredDate = pt.date;
        peak = pt.value; peakDate = pt.date; peakI = i; cur = null;
      } else {
        const dd = r2(pt.value - peak);
        if (dd < best.max) { best = { max: dd, peakDate, troughDate: pt.date, bets: i - peakI, recoveredDate: null }; cur = best; }
      }
    });
    return best;
  }

  // Rachas récord (ganadas y perdidas seguidas). Nulas y cash out no cortan.
  function streakRecords(bets) {
    const c = bets.filter(b => winR(b.result) || lossR(b.result)).sort(byTime);
    let w = 0, l = 0, cw = 0, cl = 0;
    c.forEach(b => { if (winR(b.result)) { cw++; cl = 0; } else { cl++; cw = 0; } w = Math.max(w, cw); l = Math.max(l, cl); });
    return { win: w, loss: l };
  }

  // Volatilidad: desviación del beneficio por apuesta, en € y en "importes medios".
  function volatility(bets) {
    const c = bets.filter(isClosed);
    if (c.length < 2) return null;
    const pr = c.map(profit), m = pr.reduce((a, x) => a + x, 0) / pr.length;
    const sd = Math.sqrt(pr.reduce((a, x) => a + (x - m) * (x - m), 0) / (pr.length - 1));
    const avgStake = c.reduce((a, b) => a + risk(b), 0) / c.length;
    return { sd: r2(sd), perStake: avgStake > 0 ? sd / avgStake : null };
  }

  // Tabla cruzada (p. ej. liga × tipo): las filas y columnas con más apuestas y el resumen de cada cruce.
  function crossTab(bets, rowFn, colFn, maxRows, maxCols) {
    const c = bets.filter(isClosed), top = (fn, n) => {
      const cnt = {}; c.forEach(b => { const k = fn(b) || '—'; cnt[k] = (cnt[k] || 0) + 1; });
      return Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a] || a.localeCompare(b)).slice(0, n);
    };
    const rows = top(rowFn, maxRows || 6), cols = top(colFn, maxCols || 3), cells = {};
    rows.forEach(r => cols.forEach(k => { cells[r + '|' + k] = summarize(c.filter(b => (rowFn(b) || '—') === r && (colFn(b) || '—') === k)); }));
    return { rows, cols, cells };
  }

  // Disciplina: por mes, % de apuestas por debajo de la cuota justa y ventaja media (solo las que tienen cuota justa).
  function belowFairByMonth(bets) {
    const g = {};
    bets.filter(b => b.fair > 1 && b.odds > 1 && isSingle(b)).forEach(b => { const k = (b.date || '').slice(0, 7); (g[k] = g[k] || []).push(b.odds / b.fair - 1); });
    return Object.keys(g).sort().map(k => ({ key: k, n: g[k].length, below: g[k].filter(e => e < 0).length / g[k].length, avgEdge: g[k].reduce((a, e) => a + e, 0) / g[k].length }));
  }

  // Nivel real frente al sugerido por Kelly (solo apuestas desde un pick con nivel y cuota justa).
  function stakeVsSuggested(bets, unitPct, frac) {
    const list = bets.filter(b => b.level && b.fair > 1 && b.odds > 1 && isSingle(b));
    let above = 0, same = 0, below = 0, sumReal = 0, sumSug = 0, noValue = 0;
    list.forEach(b => {
      const sg = suggestStake(b.odds, b.fair, 100, unitPct, frac);
      const lv = sg ? sg.level : 0;
      if (!lv) noValue++;
      sumReal += b.level; sumSug += lv;
      if (b.level > lv) above++; else if (b.level === lv) same++; else below++;
    });
    const n = list.length;
    return { n, above, same, below, noValue, avgReal: n ? sumReal / n : null, avgSug: n ? sumSug / n : null };
  }

  // Volumen: días con apuestas, media por día activo, máximo en un día y media semanal.
  function volume(bets) {
    const d = {};
    bets.forEach(b => { if (b.date) d[b.date] = (d[b.date] || 0) + 1; });
    const days = Object.keys(d).sort(), n = bets.length;
    if (!days.length) return { n: 0, days: 0, perDay: null, maxDay: 0, maxDate: null, perWeek: null };
    const maxDate = days.reduce((a, k) => d[k] > d[a] ? k : a, days[0]);
    const span = (new Date(days[days.length - 1]) - new Date(days[0])) / 864e5 + 1;
    return { n, days: days.length, perDay: n / days.length, maxDay: d[maxDate], maxDate, perWeek: n / Math.max(1, span / 7) };
  }

  // Efecto tras ganar o perder: importe medio y resultado de la apuesta siguiente (por orden de alta).
  function tilt(bets) {
    const c = bets.slice().sort(byTime), g = { W: [], L: [] };
    for (let i = 1; i < c.length; i++) {
      const prev = c[i - 1].result;
      if (winR(prev)) g.W.push(c[i]); else if (lossR(prev)) g.L.push(c[i]);
    }
    const avgStake = c.length ? c.reduce((a, b) => a + (+b.stake || 0), 0) / c.length : 0;
    const f = list => { const sm = summarize(list); const st = list.length ? list.reduce((a, b) => a + (+b.stake || 0), 0) / list.length : null;
      return { n: list.length, avgStake: st, vsAvg: st != null && avgStake > 0 ? st / avgStake - 1 : null, yield: sm.yield }; };
    return { afterWin: f(g.W), afterLoss: f(g.L), avgStake };
  }

  // Semanas (lunes–domingo) en las que la pérdida superó el límite semanal.
  function limitWeeks(bets, lossWeek) {
    if (!(lossWeek > 0)) return null;
    const g = {};
    bets.filter(isClosed).forEach(b => { const k = weekStart(b.date); g[k] = r2((g[k] || 0) + profit(b)); });
    const weeks = Object.keys(g);
    return { weeks: weeks.length, over: weeks.filter(k => -g[k] >= lossWeek).length };
  }

  // Horas que faltaban para el partido cuando se apuntó la apuesta (null si no se sabe).
  const hoursBefore = b => {
    const t = b.commence ? new Date(b.commence).getTime() : NaN;
    return b.created && isFinite(t) ? (t - b.created) / 3600e3 : null;
  };
  const HOUR_KEYS = ['MÁS DE 24 H', '6–24 H', '1–6 H', 'MENOS DE 1 H'];
  const hourBucket = b => { const h = hoursBefore(b); return h == null ? null : h >= 24 ? HOUR_KEYS[0] : h >= 6 ? HOUR_KEYS[1] : h >= 1 ? HOUR_KEYS[2] : HOUR_KEYS[3]; };

  // Fiabilidad de la cuota justa: cuánto cambió la probabilidad justa entre el momento de apostar y el cierre (en puntos).
  // error = media del valor absoluto; sesgo = media con signo (positivo: el mercado acabó viendo la selección más probable).
  function fairDrift(bets, keyFn) {
    const g = {};
    bets.filter(b => b.fair > 1 && b.closingFair > 1).forEach(b => { const k = keyFn(b) || '—'; (g[k] = g[k] || []).push(1 / b.closingFair - 1 / b.fair); });
    return Object.keys(g).map(k => {
      const d = g[k], n = d.length;
      return { key: k, n, error: d.reduce((s, x) => s + Math.abs(x), 0) / n, bias: d.reduce((s, x) => s + x, 0) / n };
    }).sort((a, b) => b.n - a.n || a.key.localeCompare(b.key));
  }

  // Ventaja sobre la cuota justa en el momento de apostar (cuota / justa del pick − 1).
  const edgeAtBet = b => b.fair > 1 && b.odds > 1 ? b.odds / b.fair - 1 : null;

  // CLV medio acumulado apuesta a apuesta (en orden de fecha), para ver si converge por encima de +1 %.
  function clvSeries(bets) {
    let sum = 0, n = 0;
    return bets.filter(hasClv).sort(byTime)
      .map(b => { const c = clvOf(b); sum += c; n++; return { date: b.date, value: sum / n, n, bet: b, clv: c }; });
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
    funds, stakeFor, suggestStake, summarize, periods, profitHistory, peaks, bankSeries, oddsStats, ODDS_RANGES, oddsRange, groupBy, streak, clvStats, lossWindows,
    clvBy, edgeAtBet, clvSeries, hoursBefore, hourBucket, HOUR_KEYS, fairDrift,
    expectedVsReal, luckTest, normCdf, CAL_KEYS, calibration, monthly, daily, drawdown, streakRecords, volatility, crossTab,
    belowFairByMonth, stakeVsSuggested, volume, tilt, limitWeeks, pickConfidence, stakeByConfidence, setClvMode, clvOf, clvSel, clvPaid, clvParts };
  if (typeof module !== 'undefined') module.exports = L; else root.Logic = L;
})(typeof window !== 'undefined' ? window : globalThis);
