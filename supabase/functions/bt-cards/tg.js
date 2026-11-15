// Mensaje de Telegram de un partido: precio justo 1X2, doble oportunidad, empate no válido, goles, ambos marcan, córners y tarjetas
// (con la cuota mínima para que haya valor según el umbral). Texto plano con HTML básico.
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const f2 = x => (Math.round(x * 100) / 100).toFixed(2).replace('.', ',');
const pc = x => Math.round(x * 100) + '%';
const minOdds = (fair, thr) => Math.ceil(fair * (1 + thr) * 100 - 1e-9) / 100;

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
      m.lines.forEach(l => out.push(`${String(l.line).replace('.', ',')}: más ${Math.round(l.over)}% (≥ ${f2(l.minOver)}) · menos ${Math.round(l.under)}% (≥ ${f2(l.minUnder)})`));
    });
  }
  out.push('', '<i>≥ = cuota mínima en tu casa para que haya valor. Mercado afinado de Pinnacle y Betfair.</i>');
  return out.join('\n');
}
