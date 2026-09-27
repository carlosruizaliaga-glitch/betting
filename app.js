(function () {
  'use strict';
  const L = window.Logic, S = window.Store;

  const DEFAULT_SETTINGS = {
    id: 'settings', books: ['bet365'], sports: ['⚽'], types: ['1X2', 'Combinada'], tipsters: ['Carlos'], leagues: [],
    unit: 1, lossWeek: null, lossMonth: null, threshold: 3, sendMode: 'value', devig: 'power', scan: [], autoSend: { on: false, time: '10:00' }
  };

  // ---------- Acceso a datos ----------
  const settings = () => Object.assign({}, DEFAULT_SETTINGS, S.get('settings') || {});
  const bets = () => S.list('bet');
  const moves = () => S.list('movement');
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const today = () => L.madridDate();

  // ---------- Formato español ----------
  function fnum(x, dec) {
    dec = dec == null ? 2 : dec;
    const neg = x < 0, s = Math.abs(+x || 0).toFixed(dec).split('.');
    s[0] = s[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return (neg ? '−' : '') + s.join(',');
  }
  const eur = x => fnum(x) + ' €';
  const seur = x => (x > 0 ? '+' : '') + eur(x);
  const pct = (x, dec) => x == null ? '—' : fnum(x * 100, dec == null ? 1 : dec) + ' %';
  const spct = (x, dec) => x == null ? '—' : (x > 0 ? '+' : '') + pct(x, dec);
  const odds = x => fnum(x, 2);
  const cls = x => x > 0 ? 'pos' : x < 0 ? 'neg' : 'muted';
  const fdate = iso => iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : '';
  const fdateShort = iso => { const d = new Date(iso + 'T12:00:00'); return d.toLocaleDateString('es-ES', { weekday: 'short' }).toUpperCase().replace('.', '') + ' ' + iso.slice(8, 10) + '/' + iso.slice(5, 7); };
  const pnum = v => { const n = parseFloat(String(v || '').replace(/\s/g, '').replace(',', '.')); return isFinite(n) ? n : NaN; };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const selText = b => (b.legs || []).map(l => l.sel).filter(Boolean).join(' + ') || '—';
  const tag = r => `<span class="tag ${r}">${L.RESULTS[r] ? L.RESULTS[r].label : r}</span>`;

  function toast(msg) {
    document.querySelectorAll('.toast').forEach(t => t.remove());
    const t = document.createElement('div');
    t.className = 'toast'; t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2400);
  }

  // Diálogo propio (confirm/alert del navegador fallan en apps instaladas).
  function ask(msg, opts) {
    opts = Object.assign({ ok: 'ACEPTAR', cancel: 'CANCELAR', danger: false }, opts);
    return new Promise(resolve => {
      const root = document.createElement('div');
      root.className = 'overlay dialog';
      root.innerHTML = `<div class="dlg" role="alertdialog"><div>${esc(msg).replace(/\n/g, '<br>')}</div>
        <div class="actions">${opts.cancel ? `<button data-no>${esc(opts.cancel)}</button>` : ''}
        <button data-yes class="${opts.danger ? 'danger' : 'primary'}">${esc(opts.ok)}</button></div></div>`;
      document.body.appendChild(root);
      const done = v => { root.remove(); resolve(v); };
      root.querySelector('[data-yes]').onclick = () => done(true);
      const no = root.querySelector('[data-no]');
      if (no) no.onclick = () => done(false);
      root.addEventListener('click', ev => { if (ev.target === root) done(false); });
    });
  }
  const confirmDelete = msg => ask(msg, { ok: 'ELIMINAR', danger: true });
  const notify = msg => ask(msg, { cancel: null });

  // ---------- Hoja modal ----------
  let sheetEl = null;
  function sheet(html) {
    closeSheet();
    const ov = document.createElement('div');
    ov.className = 'overlay';
    ov.innerHTML = `<div class="sheet" role="dialog">${html}</div>`;
    ov.addEventListener('click', ev => { if (ev.target === ov) closeSheet(); });
    document.body.appendChild(ov);
    document.body.style.overflow = 'hidden';
    sheetEl = ov;
    return ov.querySelector('.sheet');
  }
  function closeSheet() {
    if (sheetEl) sheetEl.remove();
    sheetEl = null;
    document.body.style.overflow = '';
  }

  // ---------- Navegación y cabecera ----------
  let tab = 'home';
  const filters = { book: '', sport: '', type: '', tipster: '', league: '', result: '' };
  let statsPeriod = 'TOTAL', statsBy = 'sport';
  const view = document.getElementById('view');
  function go(t) { tab = t; render(); window.scrollTo(0, 0); }
  document.querySelectorAll('nav.tabs button').forEach(b => b.addEventListener('click', () => go(b.dataset.tab)));
  document.getElementById('fab').addEventListener('click', () => openBet());
  document.getElementById('syncBtn').addEventListener('click', () => { S.syncNow(); toast('Sincronizando…'); });

  function renderHeader() {
    const st = S.status(), pend = S.pending();
    const dot = document.getElementById('syncDot'), txt = document.getElementById('syncTxt');
    let c = '', t = '';
    if (st === 'syncing') { c = 'warn'; t = 'SYNC…'; }
    else if (st === 'bad_secret') { c = 'err'; t = 'CÓDIGO NO VÁLIDO'; }
    else if (st === 'offline') { c = 'warn'; t = pend ? `OFFLINE · ${pend} PEND.` : 'OFFLINE'; }
    else if (st === 'error') { c = 'err'; t = pend ? `ERROR · ${pend} PEND.` : 'ERROR DE RED'; }
    else if (pend) { c = 'warn'; t = `${pend} POR SUBIR`; }
    else if (st === 'ok') { c = 'ok'; t = 'SINCRONIZADO'; }
    else t = '…';
    dot.className = 'dot ' + c; txt.textContent = t;
  }

  let lastVersion = -1;
  S.onChange(() => {
    renderHeader();
    if (S.version() !== lastVersion) render();
  });

  function render() {
    lastVersion = S.version();
    if (!S.loggedIn()) { document.body.classList.add('noapp'); return renderLogin(); }
    document.body.classList.remove('noapp');
    renderHeader();
    const navTab = tab === 'cash' ? 'home' : tab;
    document.querySelectorAll('nav.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === navTab));
    ({ home: renderHome, bets: renderBets, picks: renderPicks, stats: renderStats, settings: renderSettings, cash: renderCash })[tab]();
    if (S.status() === 'bad_secret') {
      view.insertAdjacentHTML('afterbegin', `<div class="banner">EL CÓDIGO YA NO ES VÁLIDO. AJUSTES → CERRAR SESIÓN Y VUELVE A ENTRAR.</div>`);
    }
  }

  // ---------- Entrada con código ----------
  async function renderLogin() {
    view.innerHTML = `<div class="login"><img src="icon-512.png" alt=""><h1>BETTING</h1>
      <div class="muted">REGISTRO DE APUESTAS</div><div class="card" id="loginCard"><div class="muted">Conectando…</div></div></div>`;
    const card = view.querySelector('#loginCard');
    let serverState;
    try { serverState = await S.serverStatus(); }
    catch (e) {
      card.innerHTML = `<div>No hay conexión. La primera vez necesitas internet para entrar.</div>
        <button class="primary block" id="retry" style="margin-top:12px">REINTENTAR</button>`;
      card.querySelector('#retry').onclick = renderLogin;
      return;
    }
    const creating = serverState === 'new';
    card.innerHTML = creating
      ? `<b class="pos">CREA TU CÓDIGO DE ACCESO</b><div class="muted" style="margin-top:4px">Mínimo 6 caracteres. Apúntalo: sin él no se puede entrar ni pedir picks.</div>
         <label>CÓDIGO</label><input id="c1" type="password" autocomplete="new-password">
         <label>REPITE EL CÓDIGO</label><input id="c2" type="password" autocomplete="new-password">
         <button class="primary block" id="go" style="margin-top:14px">CREAR Y ENTRAR</button>`
      : `<b class="pos">INTRODUCE TU CÓDIGO</b>
         <label>CÓDIGO</label><input id="c1" type="password" autocomplete="current-password">
         <button class="primary block" id="go" style="margin-top:14px">ENTRAR</button>`;
    const btn = card.querySelector('#go');
    const label = btn.textContent;
    const submit = async () => {
      const c1 = card.querySelector('#c1').value;
      if (creating) {
        if (c1.length < 6) { toast('Mínimo 6 caracteres'); return; }
        if (c1 !== card.querySelector('#c2').value) { toast('Los códigos no coinciden'); return; }
      } else if (!c1) return;
      btn.disabled = true; btn.textContent = 'COMPROBANDO…';
      try {
        const r = await S.login(c1, creating);
        if (r === 'created' || r === 'ok') render();
        else if (r === 'not_configured') renderLogin();
        else { toast(r === 'too_short' ? 'Mínimo 6 caracteres' : 'Código incorrecto'); btn.disabled = false; btn.textContent = label; }
      } catch (e) {
        toast(/too_many/.test(e.message) ? 'Demasiados intentos. Espera 10 minutos.' : 'Sin conexión. Inténtalo de nuevo.');
        btn.disabled = false; btn.textContent = label;
      }
    };
    btn.onclick = submit;
    card.querySelectorAll('input').forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); }));
  }

  // ---------- Aviso de límite de pérdida ----------
  function lossBanner(bs) {
    const st = settings(), w = L.lossWindows(bs, today()), out = [];
    if (st.lossWeek > 0 && -w.week >= st.lossWeek) out.push(`⛔ LÍMITE SEMANAL SUPERADO: ${eur(w.week)} (LÍMITE −${eur(st.lossWeek)}). PARA ESTA SEMANA.`);
    if (st.lossMonth > 0 && -w.month >= st.lossMonth) out.push(`⛔ LÍMITE MENSUAL SUPERADO: ${eur(w.month)} (LÍMITE −${eur(st.lossMonth)}). PARA ESTE MES.`);
    return out.map(t => `<div class="banner">${t}</div>`).join('');
  }

  // ---------- INICIO ----------
  function renderHome() {
    const bs = bets(), ms = moves();
    const f = L.funds(bs, ms).total, s = L.summarize(bs), st = L.streak(bs);
    const bank = L.r2(f.net + f.bonus + f.profit);
    const base = f.net + f.bonus;
    const pend = bs.filter(b => !L.isClosed(b)).sort(L.byTime);
    view.innerHTML = `${lossBanner(bs)}
      <div class="card hero">
        <div class="lbl">BANK</div>
        <div class="big num">${eur(bank)}</div>
        <div class="num"><span class="${cls(f.profit)}">${seur(f.profit)}</span> <span class="${cls(f.profit)}">(${spct(base ? f.profit / base : null)})</span></div>
        <div class="muted num" style="margin-top:4px">DISPONIBLE ${eur(f.available)} · EN JUEGO ${eur(f.pendingRisk)}</div>
        <div class="kpis">
          <div><div class="k">YIELD</div><div class="v num ${cls(s.yield)}">${spct(s.yield)}</div></div>
          <div><div class="k">ACIERTO</div><div class="v num">${pct(s.winPct, 0)}</div></div>
          <div><div class="k">CERRADAS</div><div class="v num">${s.n}</div></div>
          <div><div class="k">RACHA</div><div class="v num ${st.type === 'W' ? 'pos' : st.type === 'L' ? 'neg' : ''}">${st.n ? st.n + (st.type === 'W' ? 'G' : 'P') : '—'}</div></div>
        </div>
      </div>
      <h2>PENDIENTES <span class="acc">${pend.length}</span></h2>
      ${pend.length ? pend.map(pendCard).join('') : '<div class="card empty">SIN APUESTAS PENDIENTES</div>'}
      <h2>EVOLUCIÓN DEL BANK</h2>
      <div class="card">${bankChart(L.bankSeries(bs, ms))}</div>
      <h2>RESUMEN</h2>
      <div class="card">${periodTable(L.periods(bs, today()))}</div>
      <button class="block" id="toCash" style="margin-top:6px">CAJA · SALDO POR CASA ›</button>`;
    view.querySelectorAll('[data-close]').forEach(el => el.onclick = () => quickClose(el.dataset.id, el.dataset.close));
    view.querySelectorAll('[data-more]').forEach(el => el.onclick = () => openBet(S.get(el.dataset.more)));
    view.querySelector('#toCash').onclick = () => go('cash');
    wireChart();
  }

  function pendCard(b) {
    return `<div class="pend">
      <div class="row"><div class="grow"><b class="ellipsis" style="display:block">${esc(selText(b))}</b>
        <div class="muted ellipsis">${fdate(b.date)} · ${esc(b.book)} · ${esc(b.type)}${b.league ? ' · ' + esc(b.league) : ''}</div></div>
        <div class="num" style="text-align:right"><b>@${odds(b.odds)}</b><div class="muted">${eur(b.stake)} → ${eur(L.potential(b))}</div></div></div>
      <div class="btns">
        <button class="btn-w" data-close="W" data-id="${b.id}">GANADA</button>
        <button class="btn-l" data-close="L" data-id="${b.id}">PERDIDA</button>
        <button class="btn-v" data-close="V" data-id="${b.id}">NULA</button>
        <button data-more="${b.id}" aria-label="Más opciones">···</button>
      </div></div>`;
  }

  function quickClose(id, r) {
    const b = S.get(id); if (!b) return;
    const nb = Object.assign({}, b, { result: r, closedAt: Date.now() });
    S.put('bet', nb);
    toast(`${L.RESULTS[r].label} · ${seur(L.profit(nb))}`);
  }

  function periodTable(rows) {
    return `<table class="tbl"><tr><th></th><th>N</th><th>APOSTADO</th><th>BENEFICIO</th><th>YIELD</th></tr>
      ${rows.map(r => `<tr><td>${r.key}</td><td class="num">${r.n}</td><td class="num">${eur(r.risk)}</td>
        <td class="num ${cls(r.profit)}">${seur(r.profit)}</td><td class="num ${cls(r.yield)}">${spct(r.yield)}</td></tr>`).join('')}</table>`;
  }

  // Gráfico de línea del bank con cruceta al tocar/pasar el dedo.
  let chartPts = [];
  function bankChart(series) {
    if (series.length < 2) return '<div class="empty">AÚN NO HAY DATOS</div>';
    const W = 600, H = 176, pl = 4, pr = 64, pt = 10, pb = 26;
    const vals = series.map(p => p.value), lo = Math.min(...vals), hi = Math.max(...vals), span = (hi - lo) || 1;
    const x = i => pl + (W - pl - pr) * i / (series.length - 1);
    const y = v => pt + (H - pt - pb) * (1 - (v - lo) / span);
    chartPts = series.map((p, i) => ({ x: x(i), y: y(p.value), p }));
    const d = chartPts.map((q, i) => (i ? 'L' : 'M') + q.x.toFixed(1) + ' ' + q.y.toFixed(1)).join(' ');
    const last = chartPts[chartPts.length - 1];
    const col = last.p.value >= series[0].value ? 'var(--pos)' : 'var(--neg)';
    return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Evolución del bank">
      <defs><linearGradient id="gA" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#00e676" stop-opacity=".22"/><stop offset="1" stop-color="#00e676" stop-opacity="0"/></linearGradient></defs>
      <line x1="${pl}" x2="${W - pr}" y1="${y(hi)}" y2="${y(hi)}" stroke="var(--line)" stroke-dasharray="3 4"/>
      <line x1="${pl}" x2="${W - pr}" y1="${y(lo)}" y2="${y(lo)}" stroke="var(--line)" stroke-dasharray="3 4"/>
      <text x="${W - pr + 6}" y="${y(hi) + 4}" fill="var(--muted)" font-size="12" font-family="inherit">${fnum(hi)}</text>
      <text x="${W - pr + 6}" y="${y(lo) + 4}" fill="var(--muted)" font-size="12" font-family="inherit">${fnum(lo)}</text>
      <path d="${d} L${last.x.toFixed(1)} ${H - pb} L${pl} ${H - pb} Z" fill="url(#gA)"/>
      <path d="${d}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round"/>
      <circle cx="${last.x}" cy="${last.y}" r="4" fill="${col}"/>
      <text x="${pl}" y="${H - 3}" fill="var(--muted)" font-size="11" font-family="inherit">${fdate(series[0].date)}</text>
      <text x="${W - pr}" y="${H - 3}" fill="var(--muted)" font-size="11" font-family="inherit" text-anchor="end">${fdate(last.p.date)}</text>
      <line id="cx" y1="${pt}" y2="${H - pb}" stroke="var(--muted)" visibility="hidden"/>
      <circle id="cd" r="5" fill="#000" stroke="${col}" stroke-width="2" visibility="hidden"/>
      <rect x="0" y="0" width="${W}" height="${H}" fill="transparent" id="hit"/>
    </svg><div class="tip"></div></div>`;
  }
  function wireChart() {
    const box = view.querySelector('.chart'); if (!box) return;
    const svg = box.querySelector('svg'), tip = box.querySelector('.tip'), cx = svg.querySelector('#cx'), cd = svg.querySelector('#cd');
    const show = ev => {
      const r = svg.getBoundingClientRect(), vx = (ev.clientX - r.left) * 600 / r.width;
      let best = chartPts[0];
      chartPts.forEach(q => { if (Math.abs(q.x - vx) < Math.abs(best.x - vx)) best = q; });
      cx.setAttribute('x1', best.x); cx.setAttribute('x2', best.x); cx.setAttribute('visibility', 'visible');
      cd.setAttribute('cx', best.x); cd.setAttribute('cy', best.y); cd.setAttribute('visibility', 'visible');
      const p = best.p;
      tip.innerHTML = `${fdate(p.date)} · <b>${eur(p.value)}</b>${p.bet ? `<br>${esc(selText(p.bet))} <span class="${cls(p.delta)}">${seur(p.delta)}</span>` : `<br>CAJA ${seur(p.delta)}`}`;
      tip.style.display = 'block';
      const px = best.x * r.width / 600;
      tip.style.left = Math.max(0, Math.min(r.width - tip.offsetWidth, px - tip.offsetWidth / 2)) + 'px';
    };
    const hide = () => { tip.style.display = 'none'; cx.setAttribute('visibility', 'hidden'); cd.setAttribute('visibility', 'hidden'); };
    svg.addEventListener('pointermove', show);
    svg.addEventListener('pointerdown', show);
    svg.addEventListener('pointerleave', hide);
  }

  // ---------- APUESTAS ----------
  function renderBets() {
    const st = settings(), all = bets();
    const uniq = (k, base) => Array.from(new Set((base || []).concat(all.map(b => b[k]).filter(Boolean))));
    const opt = (k, label, list) => `<select data-f="${k}"><option value="">${label}</option>${list.map(v => `<option ${filters[k] === v ? 'selected' : ''} value="${esc(v)}">${esc(v)}</option>`).join('')}</select>`;
    const list = all.filter(b => Object.keys(filters).every(k => !filters[k] || (k === 'result' ? b.result === filters[k] : b[k] === filters[k])))
      .sort((a, b) => L.byTime(b, a));
    const s = L.summarize(list);
    let html = `<div class="filters" style="margin-top:12px">
      ${opt('book', 'CASA', uniq('book', st.books))}${opt('sport', 'DEPORTE', uniq('sport', st.sports))}${opt('type', 'TIPO', uniq('type', st.types))}
      ${opt('tipster', 'TIPSTER', uniq('tipster', st.tipsters))}${opt('league', 'LIGA', uniq('league', st.leagues))}
      <select data-f="result"><option value="">RESULTADO</option>${Object.keys(L.RESULTS).map(r => `<option ${filters.result === r ? 'selected' : ''} value="${r}">${L.RESULTS[r].label}</option>`).join('')}</select></div>
      <div class="muted" style="margin:8px 0 0">${list.length} APUESTAS · ${eur(s.risk)} CERRADO · <span class="${cls(s.profit)}">${seur(s.profit)}</span> · YIELD ${spct(s.yield)}</div>`;
    if (!list.length) html += '<div class="card empty">NINGUNA APUESTA CON ESTOS FILTROS</div>';
    let lastDate = null, open = false;
    list.forEach(b => {
      if (b.date !== lastDate) {
        if (open) html += '</div>';
        html += `<div class="datehdr">${fdateShort(b.date).split(" ")[0]} · ${fdate(b.date)}</div><div class="card list" style="margin-top:4px;padding:0 12px">`;
        lastDate = b.date; open = true;
      }
      const p = L.profit(b);
      html += `<div class="item tap" data-id="${b.id}"><div class="grow"><div class="ellipsis"><b>${esc(selText(b))}</b></div>
        <div class="muted ellipsis">${esc(b.sport)} ${esc(b.type)} · ${esc(b.book)}${b.league ? ' · ' + esc(b.league) : ''}${b.tipster ? ' · ' + esc(b.tipster) : ''}${b.level ? ' · N' + b.level : ''}</div></div>
        <div class="num" style="text-align:right">${eur(b.stake)} @${odds(b.odds)}<div>${L.isClosed(b) ? `<span class="${cls(p)}">${seur(p)}</span> ` : ''}${tag(b.result)}</div>${typeof b.clv === 'number' ? `<div class="muted">CLV <span class="${cls(b.clv)}">${spct(b.clv)}</span></div>` : b.pickId ? '<div class="muted">CLV PENDIENTE</div>' : ''}</div></div>`;
    });
    if (open) html += '</div>';
    view.innerHTML = html;
    view.querySelectorAll('[data-f]').forEach(el => el.onchange = () => { filters[el.dataset.f] = el.value; render(); });
    view.querySelectorAll('[data-id]').forEach(el => el.onclick = () => openBet(S.get(el.dataset.id)));
  }

  // ---------- NUEVA / EDITAR APUESTA ----------
  // prefill (desde un pick): { event, sel, league, fair, pickId }
  function openBet(existing, prefill) {
    const st = settings(), all = bets();
    const lastBook = (all.slice().sort((a, b) => (b.created || 0) - (a.created || 0))[0] || {}).book;
    const isNew = !existing;
    const b = existing ? JSON.parse(JSON.stringify(existing)) : {
      id: 'b-' + uid(), date: today(), book: lastBook || st.books[0] || '', sport: st.sports[0] || '⚽', type: st.types[0] || '1X2',
      tipster: st.tipsters[0] || '', league: (prefill && prefill.league) || '', level: null, stake: null, odds: null,
      result: 'P', cashout: null, live: false, bonus: false,
      legs: [{ event: (prefill && prefill.event) || '', sel: (prefill && prefill.sel) || '', odds: null }],
      notes: '', pickId: (prefill && prefill.pickId) || null, fair: (prefill && prefill.fair) || null,
      pickOutcome: (prefill && prefill.outcome) || null, commence: (prefill && prefill.commence) || null
    };
    if (prefill && prefill.sport) b.sport = prefill.sport;
    if (!b.legs || !b.legs.length) b.legs = [{ event: '', sel: '', odds: b.odds }];
    const avail = L.funds(all, moves(), b.id).total.available;
    const chips = (k, list) => {
      const vals = Array.from(new Set(list.concat(b[k] ? [b[k]] : [])));
      return `<div class="chips scroll-x" data-chips="${k}">${vals.map(v => `<button type="button" class="${v === b[k] ? 'on' : ''}" data-v="${esc(v)}">${esc(v)}</button>`).join('')}</div>`;
    };
    const m = sheet(`<h3>${isNew ? '+ NUEVA APUESTA' : 'EDITAR APUESTA'}</h3>
      ${b.fair ? `<div class="muted">PICK · CUOTA JUSTA PINNACLE <b class="cyan">${odds(b.fair)}</b>${b.closingFair ? ` · CIERRE <b class="cyan">${odds(b.closingFair)}</b> · CLV <b class="${cls(b.clv)}">${spct(b.clv, 2)}</b>` : b.pickId ? ' · CLV AL EMPEZAR EL PARTIDO' : ''}</div>` : ''}
      <div id="legs"></div>
      <button type="button" class="small" id="addLeg" style="margin-top:2px">+ SELECCIÓN (COMBINADA)</button>
      <label>NIVEL DE STAKE · DISPONIBLE ${eur(avail)} · UNIDAD ${fnum(st.unit, 2).replace(/,00$/, '')} %</label>
      <div class="levels" id="levels">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => `<button type="button" data-l="${n}" class="${b.level === n ? 'on' : ''}"><b>${n}</b><span>${fnum(L.stakeFor(avail, n, st.unit))}</span></button>`).join('')}</div>
      <div class="row" style="margin-top:6px"><div class="grow"><label style="margin-top:4px">STAKE €</label><input id="stake" inputmode="decimal" value="${b.stake != null ? fnum(b.stake) : ''}" placeholder="0,00"></div>
        <div class="grow"><label style="margin-top:4px">FECHA</label><input id="date" type="date" value="${esc(b.date)}"></div></div>
      <label>RESULTADO</label>
      <div class="res" id="res">${Object.keys(L.RESULTS).map(r => `<button type="button" data-r="${r}" class="${b.result === r ? 'on' : ''}">${r === 'P' ? 'PEND.' : L.RESULTS[r].label}</button>`).join('')}</div>
      <div id="coBox" style="display:none"><label>IMPORTE COBRADO EN CASH OUT €</label><input id="co" inputmode="decimal" value="${b.cashout != null ? fnum(b.cashout) : ''}"></div>
      <div class="preview num" id="preview"></div>
      <label>CASA</label>${chips('book', st.books)}
      <label>DEPORTE</label>${chips('sport', st.sports)}
      <label>TIPO</label>${chips('type', st.types)}
      <label>TIPSTER</label>${chips('tipster', st.tipsters)}
      <label>LIGA</label><input id="league" list="leaguesDl" value="${esc(b.league)}" placeholder="Opcional" autocomplete="off">
      <datalist id="leaguesDl">${Array.from(new Set(st.leagues.concat((st.scan || []).map(l => l.name), all.map(x => x.league).filter(Boolean)))).map(v => `<option value="${esc(v)}">`).join('')}</datalist>
      <div class="row" style="margin-top:12px;gap:18px">
        <label class="row" style="margin:0;gap:6px"><input type="checkbox" id="live" ${b.live ? 'checked' : ''}> EN DIRECTO</label>
        <label class="row" style="margin:0;gap:6px"><input type="checkbox" id="bonus" ${b.bonus ? 'checked' : ''}> APUESTA GRATIS</label></div>
      <label>NOTAS</label><input id="notes" value="${esc(b.notes)}" autocomplete="off">
      <div class="actions">${isNew ? '' : '<button class="danger" id="del">ELIMINAR</button>'}<button id="cancel">CANCELAR</button><button class="primary" id="ok">GUARDAR</button></div>`);

    const $ = s => m.querySelector(s);
    function renderLegs() {
      const multi = b.legs.length > 1;
      $('#legs').innerHTML = b.legs.map((l, i) => `
        ${l.event ? `<div class="muted" style="margin-top:8px">${esc(l.event)}</div>` : ''}
        <label style="${l.event ? 'margin-top:2px' : ''}">${multi ? 'SELECCIÓN ' + (i + 1) : 'SELECCIÓN'} · CUOTA</label>
        <div class="leg"><input data-sel="${i}" value="${esc(l.sel)}" placeholder="Ej. Girona" autocomplete="off">
          <input data-odds="${i}" inputmode="decimal" value="${l.odds != null ? odds(l.odds) : (!multi && b.odds ? odds(b.odds) : '')}" placeholder="1,85">
          ${multi ? `<button type="button" class="danger" data-rm="${i}">×</button>` : '<span></span>'}</div>`).join('');
      $('#legs').querySelectorAll('[data-sel]').forEach(el => el.oninput = () => { b.legs[+el.dataset.sel].sel = el.value; });
      $('#legs').querySelectorAll('[data-odds]').forEach(el => el.oninput = () => { b.legs[+el.dataset.odds].odds = pnum(el.value); refresh(); });
      $('#legs').querySelectorAll('[data-rm]').forEach(el => el.onclick = () => { b.legs.splice(+el.dataset.rm, 1); renderLegs(); refresh(); });
    }
    function totalOdds() {
      if (b.legs.length > 1) return b.legs.every(l => l.odds > 1) ? L.comboOdds(b.legs) : NaN;
      return b.legs[0].odds != null ? b.legs[0].odds : NaN;
    }
    function refresh() {
      const o = totalOdds(), s = pnum($('#stake').value);
      $('#coBox').style.display = b.result === 'CO' ? '' : 'none';
      const tmp = Object.assign({}, b, { odds: o, stake: s, cashout: pnum($('#co').value), bonus: $('#bonus').checked });
      const okNums = o > 1 && s > 0;
      const combo = b.legs.length > 1 ? `CUOTA TOTAL <b>${isFinite(o) ? odds(o) : '—'}</b> · ` : '';
      const edge = b.fair && o > 1 ? ` · VS JUSTA <b class="${cls(o / b.fair - 1)}">${spct(o / b.fair - 1)}</b>` : '';
      $('#preview').innerHTML = okNums
        ? `<span>${combo}RIESGO <b>${eur(L.risk(tmp))}</b> · POTENCIAL <b>${eur(L.potential(tmp))}</b>${edge}</span>${L.isClosed(tmp) ? `<b class="${cls(L.profit(tmp))}">${seur(L.profit(tmp))}</b>` : ''}`
        : `<span class="muted">${combo}PON CUOTA Y STAKE</span>`;
    }
    renderLegs(); refresh();

    $('#addLeg').onclick = () => {
      if (b.legs.length === 1 && b.legs[0].odds == null && b.odds) b.legs[0].odds = b.odds;
      b.legs.push({ event: '', sel: '', odds: null });
      if (st.types.includes('Combinada')) { b.type = 'Combinada'; m.querySelectorAll('[data-chips="type"] button').forEach(x => x.classList.toggle('on', x.dataset.v === 'Combinada')); }
      renderLegs(); refresh();
      const last = m.querySelector(`[data-sel="${b.legs.length - 1}"]`); if (last) last.focus();
    };
    m.querySelectorAll('[data-chips]').forEach(box => box.querySelectorAll('button').forEach(btn => btn.onclick = () => {
      b[box.dataset.chips] = btn.dataset.v;
      box.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === btn));
    }));
    $('#levels').querySelectorAll('button').forEach(btn => btn.onclick = () => {
      b.level = +btn.dataset.l;
      $('#levels').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === btn));
      $('#stake').value = fnum(L.stakeFor(avail, b.level, st.unit));
      refresh();
    });
    $('#stake').oninput = refresh;
    $('#co').oninput = refresh;
    $('#bonus').onchange = refresh;
    $('#res').querySelectorAll('button').forEach(btn => btn.onclick = () => {
      b.result = btn.dataset.r;
      $('#res').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === btn));
      refresh();
      if (b.result === 'CO') $('#co').focus();
    });
    $('#cancel').onclick = closeSheet;
    $('#ok').onclick = () => {
      b.legs = b.legs.map(l => ({ event: l.event || '', sel: (l.sel || '').trim(), odds: isFinite(l.odds) ? l.odds : null }))
        .filter((l, i) => i === 0 || l.sel || l.odds);
      const o = totalOdds(), s = pnum($('#stake').value);
      if (!b.legs[0].sel) { toast('Escribe la selección'); return; }
      if (!(o > 1)) { toast(b.legs.length > 1 ? 'Pon la cuota de cada selección' : 'Pon una cuota mayor que 1'); return; }
      if (!(s > 0)) { toast('Elige nivel o escribe el stake'); return; }
      if (b.result === 'CO' && !(pnum($('#co').value) >= 0)) { toast('Pon el importe del cash out'); return; }
      if (b.legs.length === 1) b.legs[0].odds = o;
      const wasClosed = existing && L.isClosed(existing);
      Object.assign(b, {
        odds: o, stake: L.r2(s), date: $('#date').value || today(), league: $('#league').value.trim(),
        live: $('#live').checked, bonus: $('#bonus').checked, notes: $('#notes').value.trim(),
        cashout: b.result === 'CO' ? L.r2(pnum($('#co').value)) : null,
        created: b.created || Date.now()
      });
      if (b.level != null && L.r2(s) !== L.stakeFor(avail, b.level, st.unit) && isNew) b.levelManual = true;
      if (b.closingFair && b.legs.length === 1) b.clv = b.odds / b.closingFair - 1;
      else if (b.legs.length > 1) { delete b.clv; delete b.closingFair; }
      if (L.isClosed(b) && !wasClosed) b.closedAt = Date.now();
      if (!L.isClosed(b)) delete b.closedAt;
      S.put('bet', b);
      closeSheet();
      toast(isNew ? 'APUESTA GUARDADA' : 'CAMBIOS GUARDADOS');
    };
    const del = $('#del');
    if (del) del.onclick = async () => {
      if (!await confirmDelete(`¿Eliminar la apuesta "${selText(existing)}"?`)) return;
      S.remove('bet', existing); closeSheet();
    };
    if (isNew && !b.legs[0].sel) setTimeout(() => { const i = m.querySelector('[data-sel="0"]'); if (i) i.focus(); }, 50);
    else if (isNew) setTimeout(() => { const i = m.querySelector('[data-odds="0"]'); if (i) i.focus(); }, 50);
  }

  // ---------- PICKS ----------
  // Los últimos picks se guardan en el móvil para verlos sin conexión.
  const PK = 'betting.picks.v1';
  let pickCache = { picks: [], credits: null, at: null, lastScan: null };
  try { Object.assign(pickCache, JSON.parse(localStorage.getItem(PK) || '{}')); } catch (e) { console.error(e); }
  const savePicks = patch => { Object.assign(pickCache, patch); try { localStorage.setItem(PK, JSON.stringify(pickCache)); } catch (e) { console.error(e); } };
  let picksMode = null, picksBusy = false, picksMsg = '', picksLoadedAt = 0;
  const OUT_NAME = (p, o) => o === '1' ? p.home : o === '2' ? p.away : 'Empate';

  const ERRORS = {
    missing_odds_key: 'Falta el secreto ODDS_API_KEY en Supabase.',
    bad_odds_key: 'La clave de The Odds API no es válida. Revisa ODDS_API_KEY.',
    no_credits: 'No quedan créditos suficientes en The Odds API este mes.',
    missing_telegram: 'Picks guardados, pero falta configurar Telegram (TELEGRAM_BOT_TOKEN y TELEGRAM_CHAT_ID).',
    bad_secret: 'Código de acceso no válido.',
    too_many_attempts: 'Demasiados intentos. Espera 10 minutos.'
  };
  const errText = e => ERRORS[e] || ('Error: ' + e);

  function creditsHtml(c) {
    if (!c || c.remaining == null) return '<span class="muted">CRÉDITOS —</span>';
    const quota = (c.used || 0) + c.remaining, share = quota ? c.remaining / quota : 1;
    return `CRÉDITOS <b class="${share < 0.1 ? 'neg' : share < 0.25 ? 'yellow' : 'pos'}">${c.remaining}</b><span class="muted"> / ${quota}</span>`;
  }

  async function refreshPicks() {
    try {
      const r = await S.callPicks({ action: 'picks' });
      if (r && r.ok) { savePicks({ picks: r.picks, credits: r.credits || pickCache.credits, at: Date.now() }); picksLoadedAt = Date.now(); if (tab === 'picks') render(); }
    } catch (e) { /* sin conexión: se ven los guardados */ }
  }

  async function runScan(send, confirmLow) {
    if (picksBusy) return;
    picksBusy = true; picksMsg = send ? 'BUSCANDO PARTIDOS Y ENVIANDO…' : 'BUSCANDO PARTIDOS…'; render();
    try {
      const r = await S.callPicks({ action: 'scan', mode: picksMode, send, confirmLow: !!confirmLow });
      picksBusy = false;
      if (r.needConfirm) {
        const left = r.credits.remaining - r.cost;
        picksMsg = ''; render();
        if (await ask(`Esta pulsación gasta ${r.cost} crédito(s) y te dejará con ${left} de ${r.quota} (menos del 10 %).\n¿Seguir?`, { ok: 'GASTAR' })) return runScan(send, true);
        return;
      }
      if (r.error) { picksMsg = '⛔ ' + errText(r.error); if (r.credits) savePicks({ credits: r.credits }); render(); return; }
      savePicks({ picks: r.picks, credits: r.credits || pickCache.credits, at: Date.now(), lastScan: { at: new Date().toISOString(), cost: r.cost, sent: r.sent, mode: r.mode } });
      picksLoadedAt = Date.now();
      const withEv = r.leagues.filter(l => l.events > 0).length;
      const off = r.leagues.filter(l => l.error).map(l => l.name);
      picksMsg = `${r.leagues.length} LIGAS · ${withEv} CON PARTIDOS · GASTO ${r.cost} CRÉDITO${r.cost === 1 ? '' : 'S'}` +
        (send ? (r.tgError ? ` · ⛔ ${errText(r.tgError)}` : ` · ✓ ENVIADO A TELEGRAM (${r.sent} MENSAJE${r.sent === 1 ? '' : 'S'})`) : '') +
        (off.length ? ` · SIN DATOS: ${off.join(', ')}` : '');
      render();
    } catch (e) {
      picksBusy = false; picksMsg = '⛔ Sin conexión. Inténtalo de nuevo.'; render();
    }
  }

  function renderPicks() {
    const st = settings();
    if (!picksMode) picksMode = st.sendMode;
    if (!picksBusy && Date.now() - picksLoadedAt > 60000 && navigator.onLine) { picksLoadedAt = Date.now(); refreshPicks(); }
    const now = Date.now();
    const all = (pickCache.picks || []).filter(p => new Date(p.commence_time).getTime() > now - 2 * 3600e3);
    const list = all.filter(p => picksMode === 'all' || p.value_outcome)
      .sort((a, b) => a.commence_time.localeCompare(b.commence_time) || a.league.localeCompare(b.league));
    const ls = pickCache.lastScan;
    let html = `<div class="card">
      <div class="num">${creditsHtml(pickCache.credits)}</div>
      ${ls ? `<div class="muted">ÚLTIMA BÚSQUEDA ${fdate(L.madridDate(new Date(ls.at)))} ${new Date(ls.at).toLocaleTimeString('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit' })}</div>` : ''}
      <div class="seg" style="margin-top:10px"><button data-pm="value" class="${picksMode === 'value' ? 'on' : ''}">SOLO ⭐ VALOR</button><button data-pm="all" class="${picksMode === 'all' ? 'on' : ''}">TODOS</button></div>
      <button class="primary block" id="scanSend" style="margin-top:8px;padding:15px" ${picksBusy ? 'disabled' : ''}>${picksBusy ? '…' : '⚡ PICKS 1X2 → TELEGRAM'}</button>
      <button class="small block" id="scanOnly" style="margin-top:6px" ${picksBusy ? 'disabled' : ''}>BUSCAR SIN ENVIAR</button>
      ${picksMsg ? `<div class="muted" style="margin-top:8px">${esc(picksMsg)}</div>` : ''}
      <div class="muted" style="margin-top:8px">CADA LIGA CON PARTIDOS GASTA 1 CRÉDITO. LAS PEDIDAS HACE MENOS DE 30 MIN SON GRATIS. VALOR ≥ +${fnum(st.threshold, st.threshold % 1 ? 1 : 0)} % SOBRE LA CUOTA JUSTA.</div>
    </div>`;
    if (!list.length) html += `<div class="card empty">${all.length ? 'NINGÚN PARTIDO CON ⭐ VALOR AHORA. TOCA "TODOS" PARA VERLOS.' : 'AÚN NO HAY PICKS. PULSA EL BOTÓN.'}</div>`;
    let hdr = null;
    list.forEach(p => {
      const d = p.commence_time, day = L.madridDate(new Date(d)), h = `${esc(p.league.toUpperCase())} · ${fdateShort(day)}`;
      if (h !== hdr) { html += `<div class="datehdr">⚽ ${h}</div>`; hdr = h; }
      const time = new Date(d).toLocaleTimeString('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit' });
      const started = new Date(d).getTime() <= now;
      html += `<div class="card" style="margin-top:4px;padding:10px">
        <div class="row"><b class="grow ellipsis">${time} ${esc(p.home)} – ${esc(p.away)}</b>${p.value_outcome ? '<span class="yellow">⭐</span>' : ''}${started ? '<span class="tag">EN JUEGO</span>' : ''}</div>
        <div class="pickrow">${['1', 'X', '2'].map(o => {
          const b = p.best && p.best[o], isVal = p.value_outcome === o, isFav = p.favorite === o;
          return `<button class="pk${isFav ? ' fav' : ''}${isVal ? ' val' : ''}" data-pick="${esc(p.id)}" data-o="${o}">
            <span class="o">${o}${isVal ? ' ⭐' : isFav ? ' ➜' : ''}</span>
            <b>${fnum(p.fair_prob[o] * 100, 0)} %</b>
            <span>JUSTA ${odds(p.fair_odds[o])}</span>
            <span class="cyan">B365 ≥ ${odds(Math.ceil(p.fair_odds[o] * (1 + st.threshold / 100) * 100 - 1e-9) / 100)}</span>
            <span class="muted">${b ? esc(b.book) : '—'}</span>
            <span class="${b && b.edge > 0 ? 'pos' : 'muted'}">${b ? `${odds(b.odds)} (${b.edge >= 0 ? '+' : ''}${fnum(b.edge * 100, 0)} %)` : ''}</span>
          </button>`;
        }).join('')}</div></div>`;
    });
    html += `<div class="muted" style="margin:10px 0">TOCA 1, X O 2 PARA APUNTAR LA APUESTA CON EL PARTIDO Y LA CUOTA JUSTA YA PUESTOS. B365 ≥ ES LA CUOTA MÍNIMA DE BET365 PARA QUE HAYA VALOR (JUSTA + UMBRAL).</div>`;
    view.innerHTML = html;
    view.querySelectorAll('[data-pm]').forEach(b => b.onclick = () => { picksMode = b.dataset.pm; render(); });
    view.querySelector('#scanSend').onclick = () => runScan(true);
    view.querySelector('#scanOnly').onclick = () => runScan(false);
    view.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => {
      const p = (pickCache.picks || []).find(x => x.id === b.dataset.pick), o = b.dataset.o;
      if (!p) return;
      openBet(null, { event: `${p.home} – ${p.away}`, sel: OUT_NAME(p, o), league: p.league, fair: L.r2(p.fair_odds[o]), pickId: p.id, outcome: o, commence: p.commence_time, sport: '⚽' });
    });
  }

  // ---------- ESTADÍSTICAS ----------
  function renderStats() {
    const all = bets(), t = today();
    const inPeriod = b => statsPeriod === 'TOTAL' ? true
      : statsPeriod === 'AÑO' ? b.date.slice(0, 4) === t.slice(0, 4)
      : statsPeriod === 'MES' ? b.date.slice(0, 7) === t.slice(0, 7)
      : b.date >= L.addDays(t, -6) && b.date <= t;
    const bs = all.filter(inPeriod);
    const s = L.summarize(bs), pk = L.peaks(bs), os = L.oddsStats(bs), st = L.streak(bs), clv = L.clvStats(bs);
    const f = L.funds(all, moves()).total;
    const nv = r => bs.filter(b => b.result === r).length;
    const byOpts = { sport: 'DEPORTE', type: 'TIPO', tipster: 'TIPSTER', league: 'LIGA', book: 'CASA', odds: 'CUOTA' };
    const groups = statsBy === 'odds' ? L.groupBy(bs, b => L.oddsRange(+b.odds), L.ODDS_RANGES.map(r => r.key)) : L.groupBy(bs, b => b[statsBy]);
    const kv = (k, v) => `<div class="kv"><span class="muted">${k}</span><span class="num">${v}</span></div>`;
    const orow = (k, o) => `<tr><td>${k}</td><td class="num">${o.n}</td><td class="num">${o.n ? odds(o.avg) : '—'}</td><td class="num">${o.n ? odds(o.min) : '—'}</td><td class="num">${o.n ? odds(o.max) : '—'}</td></tr>`;
    const clvN = clv.n, goal = 300;
    view.innerHTML = `
      <div class="seg" style="margin-top:12px">${['7D', 'MES', 'AÑO', 'TOTAL'].map(p => `<button data-p="${p}" class="${p === statsPeriod ? 'on' : ''}">${p}</button>`).join('')}</div>
      <h2>RENDIMIENTO · APUESTAS CERRADAS</h2>
      <div class="card">
        ${kv('APUESTAS', `${s.n} · <span class="pos">${s.w}G</span> <span class="neg">${s.l}P</span> ${nv('V')}N${nv('HW') + nv('HL') ? ` · ${nv("HW")} 1/2G ${nv("HL")} 1/2P` : ''}${nv('CO') ? ` · ${nv('CO')}CO` : ''}`)}
        ${kv('APOSTADO', eur(s.risk))}
        ${kv('BENEFICIO', `<span class="${cls(s.profit)}">${seur(s.profit)}</span>`)}
        ${kv('RETORNO (YIELD)', `<span class="${cls(s.yield)}">${spct(s.yield)}</span>`)}
        ${kv('ACIERTO', pct(s.winPct))}
        ${kv('RACHA ACTUAL', st.n ? `<span class="${st.type === 'W' ? 'pos' : 'neg'}">${st.n} ${st.type === 'W' ? 'GANADA' : 'PERDIDA'}${st.n > 1 ? 'S' : ''}</span>` : '—')}
      </div>
      <h2>CLV · <span class="acc">¿FUNCIONA EL SISTEMA?</span></h2>
      <div class="card">
        ${kv('CLV MEDIO', clv.avg == null ? '—' : `<span class="${cls(clv.avg)}">${spct(clv.avg, 2)}</span>`)}
        ${kv('APUESTAS CON CLV +', clv.pos == null ? '—' : pct(clv.pos, 0))}
        ${kv('MUESTRA', `<b class="${clvN >= goal ? 'pos' : 'yellow'}">${clvN} / ${goal}</b>`)}
        ${kv('ESPERANDO CIERRE', bs.filter(b => b.pickId && typeof b.clv !== 'number' && (b.legs || []).length <= 1).length)}
        <div style="height:4px;background:var(--line);margin-top:6px"><div style="height:4px;width:${Math.min(100, clvN / goal * 100)}%;background:var(--cyan)"></div></div>
        <div class="muted" style="margin-top:8px">REGLA: CONFIAR SOLO CON CLV MEDIO &gt; +1 % EN 300+ APUESTAS. SE RELLENA SOLO CON LAS APUESTAS HECHAS DESDE UN PICK: AL EMPEZAR EL PARTIDO SE GUARDA LA CUOTA DE CIERRE DE PINNACLE.</div>
      </div>
      <h2>PICOS Y CAÍDAS · BENEFICIO ACUMULADO</h2>
      <div class="card">
        ${kv('ACTUAL', `<span class="${cls(pk.current)}">${seur(pk.current)}</span>`)}
        ${kv('MÁXIMO HISTÓRICO', seur(pk.max))}
        ${kv('MÍNIMO HISTÓRICO', seur(pk.min))}
        ${kv('CAÍDA DESDE EL PICO', `<span class="${cls(pk.fromPeak)}">${seur(pk.fromPeak)}</span>`)}
        ${kv('SUBIDA DESDE EL MÍNIMO', `<span class="${cls(pk.fromTrough)}">${seur(pk.fromTrough)}</span>`)}
      </div>
      <h2>CUOTAS</h2>
      <div class="card"><table class="tbl"><tr><th></th><th>N</th><th>MEDIA</th><th>MÍN</th><th>MÁX</th></tr>
        ${orow('TODAS', os.all)}${orow('<span class="pos">GANADAS</span>', os.won)}${orow('<span class="neg">PERDIDAS</span>', os.lost)}</table></div>
      <h2>RENDIMIENTO POR</h2>
      <div class="chips scroll-x">${Object.keys(byOpts).map(k => `<button data-by="${k}" class="${k === statsBy ? 'on' : ''}">${byOpts[k]}</button>`).join('')}</div>
      <div class="card"><table class="tbl"><tr><th></th><th>N</th><th>APOST.</th><th>BENEF.</th><th>YIELD</th><th>ACIERTO</th></tr>
        ${groups.map(g => `<tr><td class="ellipsis" style="max-width:110px">${esc(g.key)}</td><td class="num">${g.n}</td><td class="num">${fnum(g.risk)}</td>
          <td class="num ${cls(g.profit)}">${g.profit > 0 ? '+' : ''}${fnum(g.profit)}</td><td class="num ${cls(g.yield)}">${spct(g.yield, 0)}</td><td class="num">${pct(g.winPct, 0)}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">SIN DATOS</td></tr>'}</table></div>
      <h2>CAJA</h2>
      <div class="card">
        ${kv('DEPÓSITOS', eur(f.deposits))}${kv('RETIRADAS', eur(f.withdrawals))}${kv('DEPÓSITOS NETOS', eur(f.net))}
        ${kv('CRÉDITO DE BONO', eur(f.bonus))}${kv('APUESTAS GRATIS RESTANTES', eur(f.freeLeft))}
      </div>
      <h2>RESUMEN POR PERIODO</h2>
      <div class="card">${periodTable(L.periods(all, t))}</div>`;
    view.querySelectorAll('[data-p]').forEach(el => el.onclick = () => { statsPeriod = el.dataset.p; render(); });
    view.querySelectorAll('[data-by]').forEach(el => el.onclick = () => { statsBy = el.dataset.by; render(); });
  }

  // ---------- CAJA ----------
  const MOVE_TYPES = { deposit: 'DEPÓSITO', withdrawal: 'RETIRADA', bonus: 'BONO', freebet: 'AP. GRATIS' };
  function renderCash() {
    const ms = moves().sort((a, b) => L.byTime(b, a)), fd = L.funds(bets(), ms);
    view.innerHTML = `<div class="row" style="margin-top:10px"><button class="small" id="back">‹ INICIO</button><div class="grow"></div><button class="small primary" id="addMove">+ MOVIMIENTO</button></div>
      <h2>SALDO DISPONIBLE POR CASA</h2>
      <div class="card"><table class="tbl"><tr><th>CASA</th><th>NETO</th><th>BENEF.</th><th>EN JUEGO</th><th>DISPON.</th></tr>
        ${fd.books.map(x => `<tr><td>${esc(x.book)}</td><td class="num">${fnum(x.net)}</td><td class="num ${cls(x.profit)}">${fnum(x.profit)}</td><td class="num">${fnum(x.pendingRisk)}</td><td class="num"><b>${fnum(x.available)}</b></td></tr>`).join('')}
        <tr><td><b>TOTAL</b></td><td class="num">${fnum(fd.total.net)}</td><td class="num ${cls(fd.total.profit)}">${fnum(fd.total.profit)}</td><td class="num">${fnum(fd.total.pendingRisk)}</td><td class="num"><b class="pos">${fnum(fd.total.available)}</b></td></tr></table>
        <div class="muted" style="margin-top:6px">DISPONIBLE = DEPÓSITOS NETOS + BONOS + BENEFICIO − EN JUEGO.${fd.total.freeLeft ? ` APUESTAS GRATIS RESTANTES: ${eur(fd.total.freeLeft)}.` : ''}</div></div>
      <h2>MOVIMIENTOS</h2>
      <div class="card list" style="padding:0 12px">${ms.length ? ms.map(m => `<div class="item tap" data-id="${m.id}"><div class="grow"><b>${MOVE_TYPES[m.type] || m.type}</b> · ${esc(m.book)}
        <div class="muted">${fdate(m.date)}${m.note ? ' · ' + esc(m.note) : ''}</div></div><div class="num ${m.type === 'withdrawal' ? 'neg' : 'pos'}">${m.type === 'withdrawal' ? '−' : '+'}${eur(Math.abs(m.amount))}</div></div>`).join('')
        : '<div class="empty">SIN MOVIMIENTOS</div>'}</div>`;
    view.querySelector('#back').onclick = () => go('home');
    view.querySelector('#addMove').onclick = () => openMove();
    view.querySelectorAll('[data-id]').forEach(el => el.onclick = () => openMove(S.get(el.dataset.id)));
  }

  function openMove(existing) {
    const st = settings(), isNew = !existing;
    const mv = existing ? Object.assign({}, existing) : { id: 'm-' + uid(), date: today(), book: st.books[0] || '', type: 'deposit', amount: null, note: '' };
    const m = sheet(`<h3>${isNew ? '+ MOVIMIENTO DE CAJA' : 'EDITAR MOVIMIENTO'}</h3>
      <label>TIPO</label><div class="seg" id="mt">${Object.keys(MOVE_TYPES).map(k => `<button type="button" data-t="${k}" class="${mv.type === k ? 'on' : ''}">${MOVE_TYPES[k]}</button>`).join('')}</div>
      <div class="muted" id="mtHelp" style="margin-top:6px"></div>
      <label>CASA</label><div class="chips scroll-x" id="mb">${Array.from(new Set(st.books.concat(mv.book ? [mv.book] : []))).map(v => `<button type="button" data-v="${esc(v)}" class="${v === mv.book ? 'on' : ''}">${esc(v)}</button>`).join('')}</div>
      <div class="row"><div class="grow"><label>IMPORTE €</label><input id="amt" inputmode="decimal" value="${mv.amount != null ? fnum(Math.abs(mv.amount)) : ''}" placeholder="0,00"></div>
        <div class="grow"><label>FECHA</label><input id="date" type="date" value="${esc(mv.date)}"></div></div>
      <label>NOTA</label><input id="note" value="${esc(mv.note)}" autocomplete="off">
      <div class="actions">${isNew ? '' : '<button class="danger" id="del">ELIMINAR</button>'}<button id="cancel">CANCELAR</button><button class="primary" id="ok">GUARDAR</button></div>`);
    const help = { deposit: 'Dinero que metes en la casa.', withdrawal: 'Dinero que sacas de la casa.', bonus: 'Crédito de bono que la casa te da como saldo.', freebet: 'Apuesta gratis recibida. Al usarla, marca "APUESTA GRATIS" en la apuesta: solo cuenta la ganancia neta.' };
    const setHelp = () => { m.querySelector('#mtHelp').textContent = help[mv.type]; };
    setHelp();
    m.querySelectorAll('#mt button').forEach(b => b.onclick = () => { mv.type = b.dataset.t; m.querySelectorAll('#mt button').forEach(x => x.classList.toggle('on', x === b)); setHelp(); });
    m.querySelectorAll('#mb button').forEach(b => b.onclick = () => { mv.book = b.dataset.v; m.querySelectorAll('#mb button').forEach(x => x.classList.toggle('on', x === b)); });
    m.querySelector('#cancel').onclick = closeSheet;
    m.querySelector('#ok').onclick = () => {
      const a = pnum(m.querySelector('#amt').value);
      if (!(a > 0)) { toast('Pon un importe'); return; }
      S.put('movement', Object.assign(mv, { amount: L.r2(a), date: m.querySelector('#date').value || today(), note: m.querySelector('#note').value.trim(), created: mv.created || Date.now() }));
      closeSheet();
    };
    const del = m.querySelector('#del');
    if (del) del.onclick = async () => { if (await confirmDelete('¿Eliminar este movimiento?')) { S.remove('movement', existing); closeSheet(); } };
    setTimeout(() => m.querySelector('#amt').focus(), 50);
  }

  // ---------- AJUSTES ----------
  const LISTS = { books: 'CASAS', sports: 'DEPORTES', types: 'TIPOS DE APUESTA', tipsters: 'TIPSTERS', leagues: 'LIGAS' };
  function saveSettings(patch) { S.put('settings', Object.assign(settings(), patch)); }
  function renderSettings() {
    const st = settings();
    const st2 = S.status();
    view.innerHTML = `
      <h2>STAKE</h2>
      <div class="card"><label style="margin-top:0">UNIDAD (% DEL DISPONIBLE POR NIVEL)</label>
        <div class="row"><input id="unit" inputmode="decimal" value="${fnum(st.unit, 2)}" style="max-width:120px"><span class="muted">NIVEL 5 = 5 × ${fnum(st.unit, 2)} % = ${fnum(5 * st.unit, 2)} % DEL DISPONIBLE</span></div></div>
      <h2>LÍMITES DE PÉRDIDA</h2>
      <div class="card"><div class="row"><div class="grow"><label style="margin-top:0">SEMANAL €</label><input id="lw" inputmode="decimal" value="${st.lossWeek ? fnum(st.lossWeek) : ''}" placeholder="Sin límite"></div>
        <div class="grow"><label style="margin-top:0">MENSUAL €</label><input id="lm" inputmode="decimal" value="${st.lossMonth ? fnum(st.lossMonth) : ''}" placeholder="Sin límite"></div></div>
        <div class="muted" style="margin-top:6px">SI LO SUPERAS, INICIO MUESTRA UN AVISO EN ROJO. SEMANA = LUNES A DOMINGO.</div></div>
      <h2>ESCÁNER DE PICKS</h2>
      <div class="card"><label style="margin-top:0">LIGAS (TOCA PARA ACTIVAR / DESACTIVAR)</label>
        <div class="chips">${(st.scan || []).map((l, i) => `<button data-scan="${i}" class="${l.on ? 'on' : ''}">${esc(l.name)}</button>`).join('')}</div>
        <details style="margin-top:8px"><summary class="muted">AÑADIR O QUITAR UNA LIGA</summary>
          <div class="row" style="margin-top:6px"><input id="scName" placeholder="Nombre" style="flex:1"><input id="scKey" placeholder="soccer_…" style="flex:1.4"></div>
          <div class="row" style="margin-top:6px"><button class="small" id="scAdd">AÑADIR</button><select id="scDel" style="flex:1"><option value="">Quitar…</option>${(st.scan || []).map((l, i) => `<option value="${i}">${esc(l.name)} · ${esc(l.key)}</option>`).join('')}</select></div>
        </details>
        <div class="row" style="margin-top:12px"><div class="grow"><label style="margin-top:0">UMBRAL DE VALOR %</label><input id="thr" inputmode="decimal" value="${fnum(st.threshold, st.threshold % 1 ? 1 : 0)}"></div>
          <div class="grow"><label style="margin-top:0">ENVÍO POR DEFECTO</label><div class="seg"><button data-sm="value" class="${st.sendMode === 'value' ? 'on' : ''}">SOLO ⭐</button><button data-sm="all" class="${st.sendMode === 'all' ? 'on' : ''}">TODOS</button></div></div></div>
        <label>QUITAR EL MARGEN DE PINNACLE</label>
        <div class="seg"><button data-dv="power" class="${st.devig !== 'mult' ? 'on' : ''}">POWER</button><button data-dv="mult" class="${st.devig === 'mult' ? 'on' : ''}">PROPORCIONAL</button></div>
        <div class="muted" style="margin-top:6px">PROPORCIONAL REPARTE EL MARGEN A PARTES IGUALES; POWER CARGA MÁS MARGEN A LOS NO FAVORITOS, QUE ES DONDE LAS CASAS LO PONEN DE VERDAD.</div></div>
      <h2>ENVÍO AUTOMÁTICO DIARIO</h2>
      <div class="card"><div class="row"><div class="grow"><div class="seg"><button data-auto="off" class="${!(st.autoSend && st.autoSend.on) ? 'on' : ''}">APAGADO</button><button data-auto="on" class="${st.autoSend && st.autoSend.on ? 'on' : ''}">ENCENDIDO</button></div></div>
        <input id="autoTime" type="time" value="${esc((st.autoSend && st.autoSend.time) || '10:00')}" style="width:120px"></div>
        <div class="muted" style="margin-top:6px">CADA DÍA A ESA HORA (MADRID) TE LLEGAN LOS PICKS A TELEGRAM CON EL ENVÍO POR DEFECTO. GASTA 1 CRÉDITO POR LIGA CON PARTIDOS: UNOS 10 AL DÍA ≈ 300 AL MES DE LOS 500 GRATIS. SI QUEDAN MENOS DEL 10 %, NO GASTA Y TE AVISA.</div></div>
      <h2>CONEXIÓN · THE ODDS API Y TELEGRAM</h2>
      <div class="card"><div id="conn" class="muted">PULSA COMPROBAR PARA VER EL ESTADO.</div>
        <div class="row" style="margin-top:8px;gap:6px"><button class="small" id="chk">COMPROBAR</button><button class="small" id="chat">DETECTAR MI CHAT_ID</button></div></div>
      <h2>LISTAS</h2>
      ${Object.keys(LISTS).map(k => `<div class="card listedit"><label style="margin-top:0">${LISTS[k]}</label>
        <div class="chips">${(st[k] || []).map((v, i) => `<button data-list="${k}" data-i="${i}">${esc(v)}<i>×</i></button>`).join('') || '<span class="muted">VACÍA</span>'}</div>
        <div class="row" style="margin-top:8px"><input data-new="${k}" placeholder="Añadir…" autocomplete="off"><button class="small" data-add="${k}">AÑADIR</button></div></div>`).join('')}
      <h2>CAJA</h2>
      <button class="block" id="toCash">DEPÓSITOS, RETIRADAS Y BONOS ›</button>
      <h2>COPIA DE SEGURIDAD</h2>
      <div class="card"><div class="row" style="flex-wrap:wrap;gap:6px">
        <button class="small" id="csvBets">APUESTAS (EXCEL/CSV)</button><button class="small" id="csvMoves">CAJA (EXCEL/CSV)</button>
        <button class="small" id="json">COPIA COMPLETA</button><button class="small" id="imp">IMPORTAR COPIA</button>
        <input type="file" id="impFile" accept="application/json,.json" style="display:none"></div></div>
      <h2>SESIÓN</h2>
      <div class="card"><div class="muted">ESTADO: ${st2 === 'ok' ? '<span class="pos">SINCRONIZADO</span>' : esc(String(st2).toUpperCase())}${S.lastSync() ? ' · ÚLTIMA ' + new Date(S.lastSync()).toLocaleString('es-ES', { timeZone: 'Europe/Madrid' }) : ''}</div>
        <button class="danger block" id="logout" style="margin-top:10px">CERRAR SESIÓN EN ESTE MÓVIL</button></div>
      <div class="muted" style="text-align:center;margin-top:18px">BETTING · FASE 3</div>`;
    const num = (id, key, min) => view.querySelector(id).onchange = ev => {
      const v = pnum(ev.target.value);
      if (ev.target.value.trim() === '' && key !== 'unit') { saveSettings({ [key]: null }); return; }
      if (!(v > (min || 0))) { toast('Número no válido'); render(); return; }
      saveSettings({ [key]: L.r2(v) }); toast('GUARDADO');
    };
    num('#unit', 'unit'); num('#lw', 'lossWeek'); num('#lm', 'lossMonth');
    view.querySelectorAll('[data-list]').forEach(b => b.onclick = async () => {
      const k = b.dataset.list, list = settings()[k].slice(), v = list[+b.dataset.i];
      if (!await confirmDelete(`¿Quitar "${v}" de ${LISTS[k]}? Las apuestas que ya lo usan no cambian.`)) return;
      list.splice(+b.dataset.i, 1); saveSettings({ [k]: list });
    });
    view.querySelectorAll('[data-add]').forEach(b => {
      const k = b.dataset.add, input = view.querySelector(`[data-new="${k}"]`);
      const add = () => {
        const v = input.value.trim(); if (!v) return;
        const list = settings()[k].slice();
        if (list.includes(v)) { toast('Ya existe'); return; }
        list.push(v); saveSettings({ [k]: list });
      };
      b.onclick = add;
      input.addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
    });
    view.querySelectorAll('[data-scan]').forEach(b => b.onclick = () => {
      const scan = settings().scan.map(x => Object.assign({}, x)); const l = scan[+b.dataset.scan]; l.on = !l.on; saveSettings({ scan });
    });
    view.querySelector('#scAdd').onclick = () => {
      const name = view.querySelector('#scName').value.trim(), key = view.querySelector('#scKey').value.trim();
      if (!name || !/^[a-z0-9_]+$/.test(key)) { toast('Pon nombre y clave (ej. soccer_spain_la_liga)'); return; }
      saveSettings({ scan: settings().scan.concat([{ name, key, on: true }]) });
    };
    view.querySelector('#scDel').onchange = async ev => {
      const i = ev.target.value; if (i === '') return;
      const scan = settings().scan.slice(), l = scan[+i];
      if (await confirmDelete(`¿Quitar ${l.name} del escáner?`)) { scan.splice(+i, 1); saveSettings({ scan }); } else render();
    };
    view.querySelector('#thr').onchange = ev => { const v = pnum(ev.target.value); if (!(v >= 0)) { toast('Número no válido'); render(); return; } saveSettings({ threshold: v }); toast('GUARDADO'); };
    view.querySelectorAll('[data-sm]').forEach(b => b.onclick = () => { saveSettings({ sendMode: b.dataset.sm }); picksMode = b.dataset.sm; });
    view.querySelectorAll('[data-dv]').forEach(b => b.onclick = () => saveSettings({ devig: b.dataset.dv }));
    view.querySelectorAll('[data-auto]').forEach(b => b.onclick = () => saveSettings({ autoSend: Object.assign({}, settings().autoSend, { on: b.dataset.auto === 'on' }) }));
    view.querySelector('#autoTime').onchange = ev => {
      if (!/^\d{2}:\d{2}$/.test(ev.target.value)) { toast('Hora no válida'); return; }
      saveSettings({ autoSend: Object.assign({}, settings().autoSend, { time: ev.target.value }) }); toast('GUARDADO');
    };
    view.querySelector('#chk').onclick = checkConnection;
    view.querySelector('#chat').onclick = detectChat;
    view.querySelector('#toCash').onclick = () => go('cash');
    view.querySelector('#csvBets').onclick = exportBetsCsv;
    view.querySelector('#csvMoves').onclick = exportMovesCsv;
    view.querySelector('#json').onclick = () => shareOrDownload(`betting-${today()}.json`, JSON.stringify({ app: 'betting', version: 1, items: S.exportAll() }), 'application/json');
    view.querySelector('#imp').onclick = () => view.querySelector('#impFile').click();
    view.querySelector('#impFile').onchange = ev => importBackup(ev.target.files[0]);
    view.querySelector('#logout').onclick = async () => {
      const p = S.pending();
      if (!await ask(p ? `Hay ${p} cambio(s) sin subir que se perderán. ¿Cerrar sesión?` : '¿Cerrar sesión en este móvil? Los datos siguen en la nube.', { ok: 'CERRAR SESIÓN', danger: true })) return;
      S.logout(); render();
    };
  }

  async function checkConnection() {
    const box = view.querySelector('#conn'); box.textContent = 'COMPROBANDO…';
    try {
      const r = await S.callPicks({ action: 'status' });
      if (r.error) { box.innerHTML = `<span class="neg">⛔ ${esc(errText(r.error))}</span>`; return; }
      const ok = v => v ? '<span class="pos">✓</span>' : '<span class="neg">✗ FALTA</span>';
      if (r.credits) savePicks({ credits: r.credits });
      const missing = r.sports ? settings().scan.filter(l => l.on && !r.sports.includes(l.key)).map(l => l.name) : [];
      box.innerHTML = `<div class="kv"><span>ODDS_API_KEY</span><span>${ok(r.secrets.odds)}${r.oddsError ? ' <span class="neg">' + esc(r.oddsError) + '</span>' : ''}</span></div>
        <div class="kv"><span>TELEGRAM_BOT_TOKEN</span><span>${ok(r.secrets.token)}</span></div>
        <div class="kv"><span>TELEGRAM_CHAT_ID</span><span>${ok(r.secrets.chat)}</span></div>
        <div class="kv"><span>CRÉDITOS</span><span class="num">${creditsHtml(r.credits)}</span></div>
        ${r.autoSend ? `<div class="kv"><span>ÚLTIMO ENVÍO AUTOMÁTICO</span><span>${fdate(r.autoSend.day)}${r.autoSend.error ? ' <span class="neg">' + esc(r.autoSend.error === 'low_credits' ? 'OMITIDO: CRÉDITOS' : r.autoSend.error) + '</span>' : ''}</span></div>` : ''}
        <div class="muted" style="margin-top:6px">SECRETOS QUE VE SUPABASE: ${r.names && r.names.length ? esc(r.names.join(', ')) : 'NINGUNO'}</div>
        ${missing.length ? `<div class="muted" style="margin-top:6px">SIN COMPETICIÓN ACTIVA AHORA (NO GASTAN): ${esc(missing.join(', '))}</div>` : ''}`;
    } catch (e) { box.innerHTML = '<span class="neg">⛔ SIN CONEXIÓN</span>'; }
  }
  async function detectChat() {
    const box = view.querySelector('#conn'); box.textContent = 'BUSCANDO…';
    try {
      const r = await S.callPicks({ action: 'detect_chat' });
      if (r.error) { box.innerHTML = `<span class="neg">⛔ ${r.error === 'missing_token' ? 'PRIMERO GUARDA TELEGRAM_BOT_TOKEN EN SUPABASE.' : esc(r.error)}</span>`; return; }
      if (!r.chats.length) { box.innerHTML = '<span class="yellow">NO HAY MENSAJES. ABRE TU BOT EN TELEGRAM, ESCRÍBELE "hola" Y VUELVE A PULSAR.</span>'; return; }
      box.innerHTML = r.chats.map(c => `<div class="kv"><span>${esc(c.name || 'CHAT')}</span><span><b class="pos" style="font-size:18px">${esc(c.id)}</b> <button class="small" data-copy="${esc(c.id)}">COPIAR</button></span></div>`).join('') +
        '<div class="muted" style="margin-top:6px">ESTE NÚMERO ES TU TELEGRAM_CHAT_ID.</div>';
      box.querySelectorAll('[data-copy]').forEach(b => b.onclick = async () => {
        try { await navigator.clipboard.writeText(b.dataset.copy); toast('COPIADO'); } catch (e) { toast('Mantén pulsado el número para copiarlo'); }
      });
    } catch (e) { box.innerHTML = '<span class="neg">⛔ SIN CONEXIÓN</span>'; }
  }

  // ---------- Exportar / importar ----------
  async function shareOrDownload(filename, text, mime) {
    const blob = new Blob([text], { type: mime });
    try {
      const file = new File([blob], filename, { type: mime });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: filename }); return; }
    } catch (err) { if (err && err.name === 'AbortError') return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const n2 = v => v == null || !isFinite(v) ? '' : String(L.r2(v)).replace('.', ',');
  const csv = rows => '﻿' + rows.map(r => r.map(q).join(';')).join('\r\n');
  function exportBetsCsv() {
    const rows = [['Fecha', 'Casa', 'Deporte', 'Tipo', 'Tipster', 'Liga', 'Nivel', 'En directo', 'Selección', 'Partido', 'Stake', 'Cuota', 'Apuesta gratis', 'Resultado', 'En riesgo', 'Pago potencial', 'Pago', 'Beneficio', 'Cash out', 'CLV', 'Notas']];
    bets().sort(L.byTime).forEach(b => rows.push([fdate(b.date), b.book, b.sport, b.type, b.tipster, b.league, b.level, b.live ? 'S' : 'N', selText(b),
      (b.legs || []).map(l => l.event).filter(Boolean).join(' + '), n2(b.stake), n2(b.odds), b.bonus ? 'S' : 'N', L.RESULTS[b.result] ? L.RESULTS[b.result].label : b.result,
      n2(L.risk(b)), n2(L.potential(b)), L.isClosed(b) ? n2(L.payout(b)) : '', L.isClosed(b) ? n2(L.profit(b)) : '', n2(b.cashout), b.clv != null ? n2(b.clv * 100) + '%' : '', b.notes]));
    shareOrDownload(`betting-apuestas-${today()}.csv`, csv(rows), 'text/csv');
  }
  function exportMovesCsv() {
    const rows = [['Fecha', 'Casa', 'Tipo', 'Importe', 'Nota']];
    moves().sort(L.byTime).forEach(m => rows.push([fdate(m.date), m.book, MOVE_TYPES[m.type] || m.type, n2(m.type === 'withdrawal' ? -m.amount : m.amount), m.note]));
    shareOrDownload(`betting-caja-${today()}.csv`, csv(rows), 'text/csv');
  }
  function importBackup(file) {
    if (!file) return;
    const r = new FileReader();
    r.onload = async () => {
      try {
        const data = JSON.parse(r.result);
        if (data.app !== 'betting' || !Array.isArray(data.items)) throw new Error('No es una copia de Betting');
        const n = data.items.filter(i => i.kind === 'bet' && !i.deleted).length;
        if (!await ask(`¿Importar la copia (${n} apuestas)? Se combinará con los datos actuales y se subirá a la nube.`, { ok: 'IMPORTAR' })) return;
        S.importAll(data.items); toast('COPIA IMPORTADA');
      } catch (e) { notify('No se pudo importar: ' + e.message); }
    };
    r.readAsText(file);
  }

  window.BettingApp = { openBet };
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
  render();
})();
