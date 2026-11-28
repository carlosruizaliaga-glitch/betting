// Mensaje de Telegram de un partido: precio justo 1X2, doble oportunidad, empate no válido, goles, ambos marcan, córners y tarjetas
// (con la cuota mínima para que haya valor según el umbral). Texto plano con HTML básico.
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const f2 = x => (Math.round(x * 100) / 100).toFixed(2).replace('.', ',');
const pc = x => Math.round(x * 100) + '%';
const minOdds = (fair, thr) => Math.ceil(fair * (1 + thr) * 100 - 1e-9) / 100;

// Aviso de valor solo con "mis casas": la mejor selección con valor de cada mercado (1X2 y Más/Menos) usando el precio de esas casas.
export function digestMessage(picks, mine, thr) {
  const set = new Set((mine || []).map(x => String(x).toLowerCase())), hits = [];
  (picks || []).forEach(p => [['h2h', p], ['totals', p.totals]].forEach(([mk, m]) => {
    if (!m || !m.prices || !m.fair_odds) return;
    let best = null;
    Object.entries(m.prices).forEach(([bk, row]) => {
      if (!set.has(bk.toLowerCase())) return;
      Object.keys(m.fair_odds).forEach(k => { const o = row[k]; if (o > 1) { const e = o / m.fair_odds[k] - 1; if (e * 100 >= thr && (!best || e > best.e)) best = { k, bk, o, e }; } });
    });
    if (best) hits.push({ p, mk, m, ...best });
  }));
  const name = h => h.mk === 'totals' ? `${h.k === 'O' ? 'Más' : 'Menos'} de ${String(h.m.point).replace('.', ',')} goles` : h.k === 'X' ? 'Empate' : h.k === '1' ? h.p.home : h.p.away;
  const when = iso => new Date(iso).toLocaleString('es-ES', { timeZone: 'Europe/Madrid', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const head = `<b>⭐ VALOR EN TUS CASAS</b> · ${esc(mine.join(', '))} · umbral +${String(thr).replace('.', ',')}%`;
  if (!hits.length) return head + '\n\nSin valor en tus casas en las próximas 72 h.';
  hits.sort((a, b) => a.p.commence_time.localeCompare(b.p.commence_time));
  return head + '\n\n' + hits.slice(0, 40).map(h => `🕕 <b>${esc(h.p.home)} – ${esc(h.p.away)}</b> · ${esc(h.p.league)} · ${esc(when(h.p.commence_time))}\n${esc(name(h))}: <b>${esc(h.bk)} ${f2(h.o)}</b> (+${(h.e * 100).toFixed(1).replace('.', ',')} %) · justa ${f2(h.m.fair_odds[h.k])}`).join('\n\n');
}

export function pickMessage(p, thr) {
  const out = [];
  const when = new Date(p.commence_time).toLocaleString('es-ES', { timeZone: 'Europe/Madrid', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  out.push(`⚽ <b>${esc(p.home)} – ${esc(p.away)}</b>`, `${esc(p.league)} · ${esc(when)}`, '');
  const pr = p.fair_prob || {}, fo = p.fair_odds || {};
  const line = (label, prob, fair) => `${label}: ${pc(prob)} · justa ${f2(fair)} · <b>≥ ${f2(minOdds(fair, thr))}</b>`;
  if (pr['1'] && pr['X'] && pr['2']) {
    out.push('<b>1X2</b>');
    [['1', p.home], ['X', 'Empate'], ['2', p.away]].forEach(([k, n]) => out.push(line(esc(n), pr[k], fo[k] || 1 / pr[k])));
    out.push('', '<b>Doble oportunidad</b>');
    [['1X', pr['1'] + pr['X']], ['12', pr['1'] + pr['2']], ['X2', pr['X'] + pr['2']]].forEach(([k, q]) => out.push(line(k, q, 1 / q)));
    const s = pr['1'] + pr['2'];
    out.push('', '<b>Empate no válido</b>', line(esc(p.home), pr['1'] / s, s / pr['1']), line(esc(p.away), pr['2'] / s, s / pr['2']));
  }
  const tot = [];
  if (p.totals && p.totals.fair_odds) tot.push(p.totals);
  if (p.extras && p.extras.lines) tot.push(...p.extras.lines);
  if (tot.length) {
    out.push('', '<b>Goles</b>');
    tot.sort((a, b) => a.point - b.point).forEach(m => out.push(`Más/Menos ${String(m.point).replace('.', ',')}: más ${pc(m.fair_prob.O)} (≥ ${f2(minOdds(m.fair_odds.O, thr))}) · menos ${pc(m.fair_prob.U)} (≥ ${f2(minOdds(m.fair_odds.U, thr))})`));
  }
  if (p.extras && p.extras.btts && p.extras.btts.fair_odds) {
    const b = p.extras.btts;
    out.push('', `<b>Ambos marcan</b>: sí ${pc(b.fair_prob.Y)} (≥ ${f2(minOdds(b.fair_odds.Y, thr))}) · no ${pc(b.fair_prob.N)} (≥ ${f2(minOdds(b.fair_odds.N, thr))})`);
  }
  if (p.cc) {
    [['corners', 'Córners'], ['cards', 'Tarjetas']].forEach(([k, n]) => {
      const m = p.cc[k]; if (!m) return;
      out.push('', `<b>${n}</b> · media esperada ${String(m.mu).replace('.', ',')} <i>(modelo propio)</i>`);
      (m.lines.concat(m.ints || [])).forEach(l => out.push(l.int ? `${l.line}: más ${Math.round(l.over)}% (≥ ${f2(l.minOver)}) · exacto ${Math.round(l.exact)}% (≥ ${f2(l.minExact)}) · menos ${Math.round(l.under)}% (≥ ${f2(l.minUnder)})` : `${String(l.line).replace('.', ',')}: más ${Math.round(l.over)}% (≥ ${f2(l.minOver)}) · menos ${Math.round(l.under)}% (≥ ${f2(l.minUnder)})`));
    });
  }
  out.push('', '<i>≥ = cuota mínima en tu casa para que haya valor. Mercado afinado de Pinnacle y Betfair.</i>');
  return out.join('\n');
}
