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
      navPush(Object.assign(navState(!!sheetEl), { dialog: true }));
      const done = (v, fromHistory) => {
        if (!root.isConnected) return;
        root.remove(); resolve(v);
        if (!fromHistory) navBack();
      };
      root._cancel = () => done(false, true);
      root.querySelector('[data-yes]').onclick = () => done(true);
      const no = root.querySelector('[data-no]');
      if (no) no.onclick = () => done(false);
      root.addEventListener('click', ev => { if (ev.target === root) done(false); });
    });
  }
  const confirmDelete = msg => ask(msg, { ok: 'ELIMINAR', danger: true });
  const notify = msg => ask(msg, { cancel: null });

  // ---------- Hoja modal ----------
  // Cada hoja abierta es una entrada del historial: el gesto "atrás" del móvil la cierra.
  let sheetEl = null;
  function sheet(html) {
    const reuse = !!sheetEl;
    if (sheetEl) sheetEl.remove();
    const ov = document.createElement('div');
    ov.className = 'overlay';
    ov.innerHTML = `<div class="sheet" role="dialog">${html}</div>`;
    ov.addEventListener('click', ev => { if (ev.target === ov) closeSheet(); });
    document.body.appendChild(ov);
    document.body.style.overflow = 'hidden';
    sheetEl = ov;
    if (!reuse) navPush(navState(true));
    return ov.querySelector('.sheet');
  }
  function closeSheet(fromHistory) {
    if (!sheetEl) return;
    sheetEl.remove();
    sheetEl = null;
    document.body.style.overflow = '';
    if (fromHistory !== true) navBack();   // (los botones pasan el evento del clic: solo cuenta el true del gesto atrás)
  }

  // ---------- Navegación y cabecera ----------
  let tab = 'home';
  const filters = { book: '', sport: '', type: '', tipster: '', league: '', result: '' };
  let statsPeriod = 'TOTAL', statsBy = 'sport';
  const view = document.getElementById('view');
  // ---------- Atrás (gesto o botón del móvil) ----------
  // Cada pantalla, hoja y diálogo es una entrada del historial: al ir atrás el móvil anima directamente
  // a lo anterior (cerrar la ventana → pantalla anterior). Debajo de todo hay una entrada de INICIO
  // que, al alcanzarla, se vuelve a poner: así la app nunca se cierra con el gesto.
  function navState(sheetOpen) { return { bt: 1, tab, sheet: !!sheetOpen }; }
  // Cola de cambios del historial: los "atrás" que provoca la app al cerrar con un botón se agrupan en un solo
  // history.go(-n) y las entradas nuevas esperan a que termine (el navegador cancela o junta los pasos si se solapan).
  let backN = 0, awaitingPop = false, flushT = null;
  const pendingPush = [];
  function navPush(state) { if (backN || awaitingPop || flushT) { pendingPush.push(state); scheduleNav(); } else history.pushState(state, ''); }
  function navBack() { if (pendingPush.length) { pendingPush.pop(); return; } backN++; scheduleNav(); }
  function scheduleNav() { if (!flushT && !awaitingPop) flushT = setTimeout(flushNav, 0); }
  function flushNav() {
    flushT = null;
    if (awaitingPop) return;
    if (backN) { const n = backN; backN = 0; awaitingPop = true; history.go(-n); return; }
    while (pendingPush.length) history.pushState(pendingPush.shift(), '');
  }
  function go(t) {
    if (t === tab) { window.scrollTo(0, 0); return; }
    tab = t;
    navPush(navState(false));
    render(); window.scrollTo(0, 0);
  }
  document.querySelectorAll('nav.tabs button').forEach(b => b.addEventListener('click', () => go(b.dataset.tab)));
  history.replaceState({ bt: 1, tab: 'home', guard: true }, '');
  history.pushState({ bt: 1, tab: 'home' }, '');
  window.addEventListener('popstate', ev => {
    const st = ev.state || {};
    if (awaitingPop) { awaitingPop = false; flushNav(); return; }
    const dlg = document.querySelector('.overlay.dialog');
    if (dlg && !st.dialog) { if (dlg._cancel) dlg._cancel(); else dlg.remove(); return; }
    if (sheetEl && !st.sheet) closeSheet(true);
    else if (!sheetEl && st.sheet) history.replaceState(Object.assign({}, st, { sheet: false }), '');
    if (st.guard) history.pushState({ bt: 1, tab: 'home' }, '');
    const t = st.tab || 'home';
    if (t !== tab) { tab = t; render(); window.scrollTo(0, 0); }
  });
  document.getElementById('fab').addEventListener('click', () => openBet());
  document.getElementById('syncBtn').addEventListener('click', () => { S.syncNow(); toast('Sincronizando…'); });

  function renderHeader() {
    const st = S.status(), pend = S.pending();
    const dot = document.getElementById('syncDot'), txt = document.getElementById('syncTxt');
    let c = '', t = '';
    // La sincronización periódica (cada 20 s) es silenciosa: mientras dura se deja la cabecera como estaba.
    if (st === 'syncing') { if (txt.textContent) return; t = '…'; }
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
    // Llegan datos nuevos de la nube: se redibuja la pantalla sin mover el scroll.
    if (S.version() !== lastVersion) { const y = window.scrollY; render(); window.scrollTo(0, y); }
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
        <div><span class="chg ${cls(f.profit)}">${seur(f.profit)} · ${spct(base ? f.profit / base : null)}</span></div>
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

  // Gráficos de línea con cruceta al tocar/pasar el dedo. Cada gráfico guarda sus puntos para el tooltip.
  const charts = {};
  // opts: { id, label, axis(v), tip(p), color, area, refs: [{ v, label, col }] }
  function lineChart(series, opts) {
    if (series.length < 2) return '<div class="empty">AÚN NO HAY DATOS SUFICIENTES</div>';
    const W = 600, H = 176, pl = 4, pr = 70, pt = 10, pb = 26;
    const refs = opts.refs || [];
    const vals = series.map(p => p.value).concat(refs.map(r => r.v));
    const lo = Math.min(...vals), hi = Math.max(...vals), span = (hi - lo) || 1;
    const x = i => pl + (W - pl - pr) * i / (series.length - 1);
    const y = v => pt + (H - pt - pb) * (1 - (v - lo) / span);
    const pts = series.map((p, i) => ({ x: x(i), y: y(p.value), p }));
    charts[opts.id] = { pts, tip: opts.tip };
    const d = pts.map((q, i) => (i ? 'L' : 'M') + q.x.toFixed(1) + ' ' + q.y.toFixed(1)).join(' ');
    const last = pts[pts.length - 1], col = opts.color;
    const hline = (v, stroke, label, lcol) => `<line x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}" stroke="${stroke}" stroke-dasharray="3 4"/>
      <text x="${W - pr + 6}" y="${y(v) + 4}" fill="${lcol || 'var(--muted)'}" font-size="12" font-family="inherit">${label}</text>`;
    const axisLines = refs.length ? refs.map(r => hline(r.v, r.col || 'var(--line)', r.label, r.col)).join('')
      : hline(hi, 'var(--line)', opts.axis(hi)) + hline(lo, 'var(--line)', opts.axis(lo));
    return `<div class="chart" data-chart="${opts.id}"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.label)}">
      <defs><linearGradient id="gA-${opts.id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#00e676" stop-opacity=".22"/><stop offset="1" stop-color="#00e676" stop-opacity="0"/></linearGradient></defs>
      ${axisLines}
      ${opts.area ? `<path d="${d} L${last.x.toFixed(1)} ${H - pb} L${pl} ${H - pb} Z" fill="url(#gA-${opts.id})"/>` : ''}
      <path d="${d}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round"/>
      <circle cx="${last.x}" cy="${last.y}" r="4" fill="${col}"/>
      <text x="${pl}" y="${H - 3}" fill="var(--muted)" font-size="11" font-family="inherit">${fdate(series[0].date)}</text>
      <text x="${W - pr}" y="${H - 3}" fill="var(--muted)" font-size="11" font-family="inherit" text-anchor="end">${fdate(last.p.date)}</text>
      <line class="cx" y1="${pt}" y2="${H - pb}" stroke="var(--muted)" visibility="hidden"/>
      <circle class="cd" r="5" fill="var(--bg)" stroke="${col}" stroke-width="2" visibility="hidden"/>
      <rect x="0" y="0" width="${W}" height="${H}" fill="transparent"/>
    </svg><div class="tip"></div></div>`;
  }
  function bankChart(series) {
    const col = series.length && series[series.length - 1].value >= series[0].value ? 'var(--pos)' : 'var(--neg)';
    return lineChart(series, { id: 'bank', label: 'Evolución del bank', axis: v => fnum(v), color: col, area: true,
      tip: p => `${fdate(p.date)} · <b>${eur(p.value)}</b>${p.bet ? `<br>${esc(selText(p.bet))} <span class="${cls(p.delta)}">${seur(p.delta)}</span>` : `<br>CAJA ${seur(p.delta)}`}` });
  }
  function wireChart() {
    view.querySelectorAll('.chart[data-chart]').forEach(box => {
      const c = charts[box.dataset.chart]; if (!c) return;
      const svg = box.querySelector('svg'), tip = box.querySelector('.tip'), cx = svg.querySelector('.cx'), cd = svg.querySelector('.cd');
      const show = ev => {
        const r = svg.getBoundingClientRect(), vx = (ev.clientX - r.left) * 600 / r.width;
        let best = c.pts[0];
        c.pts.forEach(q => { if (Math.abs(q.x - vx) < Math.abs(best.x - vx)) best = q; });
        cx.setAttribute('x1', best.x); cx.setAttribute('x2', best.x); cx.setAttribute('visibility', 'visible');
        cd.setAttribute('cx', best.x); cd.setAttribute('cy', best.y); cd.setAttribute('visibility', 'visible');
        tip.innerHTML = c.tip(best.p);
        tip.style.display = 'block';
        const px = best.x * r.width / 600;
        tip.style.left = Math.max(0, Math.min(r.width - tip.offsetWidth, px - tip.offsetWidth / 2)) + 'px';
      };
      const hide = () => { tip.style.display = 'none'; cx.setAttribute('visibility', 'hidden'); cd.setAttribute('visibility', 'hidden'); };
      svg.addEventListener('pointermove', show);
      svg.addEventListener('pointerdown', show);
      svg.addEventListener('pointerleave', hide);
    });
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
        <div class="num" style="text-align:right">${eur(b.stake)} @${odds(b.odds)}<div>${L.isClosed(b) ? `<span class="${cls(p)}">${seur(p)}</span> ` : ''}${tag(b.result)}</div>${b.autoSettled ? `<div class="muted">${esc(b.score || '')} · AUTO</div>` : ''}${typeof b.clv === 'number' ? `<div class="muted">CLV <span class="${cls(b.clv)}">${spct(b.clv)}</span></div>` : b.pickId ? `<div class="muted">${b.clvMissed ? 'SIN CIERRE' : 'CLV PENDIENTE'}</div>` : ''}</div></div>`;
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
    if (prefill && prefill.type) b.type = prefill.type;
    if (prefill && prefill.pickId) { b.pickMarket = prefill.market || 'h2h'; if (prefill.point != null) b.point = prefill.point; }
    if (!b.legs || !b.legs.length) b.legs = [{ event: '', sel: '', odds: b.odds }];
    const avail = L.funds(all, moves(), b.id).total.available;
    const chips = (k, list) => {
      const vals = Array.from(new Set(list.concat(b[k] ? [b[k]] : [])));
      return `<div class="chips scroll-x" data-chips="${k}">${vals.map(v => `<button type="button" class="${v === b[k] ? 'on' : ''}" data-v="${esc(v)}">${esc(v)}</button>`).join('')}</div>`;
    };
    const m = sheet(`<h3>${isNew ? '+ NUEVA APUESTA' : 'EDITAR APUESTA'}</h3>
      ${b.fair ? `<div class="muted">PICK · CUOTA JUSTA <b class="cyan">${odds(b.fair)}</b>${b.closingFair ? ` · CIERRE <b class="cyan">${odds(b.closingFair)}</b> · CLV <b class="${cls(b.clv)}">${spct(b.clv, 2)}</b>` : b.clvMissed ? ' · SIN CIERRE (APUNTADA CON EL PARTIDO EMPEZADO)' : b.pickId ? (b.commence && new Date(b.commence) <= new Date() ? ' · <span class="yellow">PARTIDO YA EMPEZADO: NO TENDRÁ CLV</span>' : ' · CLV AL EMPEZAR EL PARTIDO') : ''}</div>` : ''}
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
      if (existing && existing.autoSettled && b.result !== existing.result) { delete b.autoSettled; delete b.score; }
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
  const ptxt = n => fnum(n, n % 1 ? (n * 10 % 1 ? 2 : 1) : 0);
  const OUT_NAME = (p, o) => o === '1' ? p.home : o === '2' ? p.away : o === 'X' ? 'Empate'
    : o === 'O' ? 'Más ' + ptxt(p.totals ? p.totals.point : 2.5) : o === 'U' ? 'Menos ' + ptxt(p.totals ? p.totals.point : 2.5) : o;
  const OUT_ORDER = ['1', 'X', '2'];
  const outKeys = prob => OUT_ORDER.filter(o => prob && prob[o] != null);
  const SPORT_EMOJI = { soccer: '⚽', basketball: '🏀', tennis: '🎾' };
  const sportOf = key => String(key || '').split('_')[0];
  const sportEmoji = key => SPORT_EMOJI[sportOf(key)] || '🏆';
  const pickHasValue = p => !!(p.value_outcome || (p.totals && p.totals.value_outcome));
  const minB365 = (fair, thr) => Math.ceil(fair * (1 + thr / 100) * 100 - 1e-9) / 100;
  // Cambio de probabilidad justa (en puntos) desde la primera captura del partido.
  const moveOf = (p, o) => p.first_fair_prob && p.first_fair_prob[o] != null && p.fair_prob[o] != null ? p.fair_prob[o] - p.first_fair_prob[o] : 0;
  const moveHtml = d => Math.abs(d) >= 0.01 ? ` <span class="${d > 0 ? 'cyan' : 'purple'}">${d > 0 ? '↑' : '↓'}${Math.round(Math.abs(d) * 100)}</span>` : '';

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

  // Preferencias de la pantalla PICKS (solo en este móvil; si no se pueden guardar, se usan las de por defecto).
  const PV = 'betting.picksview.v1';
  const pv = { sport: '', league: '', day: '', sort: 'value' };
  try { Object.assign(pv, JSON.parse(localStorage.getItem(PV) || '{}')); } catch (e) { /* sin almacenamiento */ }
  const savePv = () => { try { localStorage.setItem(PV, JSON.stringify(pv)); } catch (e) { /* sin almacenamiento */ } };
  const openPicks = new Set();

  // Mayor ventaja del partido sobre la cuota justa (en cualquier mercado), para ordenar por valor.
  const bestEdge = p => {
    const edges = [];
    [p, p.totals].forEach(mk => { if (mk && mk.best) Object.values(mk.best).forEach(b => edges.push(b.edge)); });
    return edges.length ? Math.max(...edges) : -1;
  };
  const valueEdge = p => {
    const e = [];
    if (p.value_outcome && p.best[p.value_outcome]) e.push(p.best[p.value_outcome].edge);
    if (p.totals && p.totals.value_outcome && p.totals.best[p.totals.value_outcome]) e.push(p.totals.best[p.totals.value_outcome].edge);
    return e.length ? Math.max(...e) : null;
  };

  // Casillas de un mercado. compact = fila corta (resultado, %, cuota mínima de bet365); si no, detalle con la mejor casa.
  function pickCells(p, mk, market, thr, compact) {
    const keys = market === 'totals' ? ['O', 'U'] : outKeys(mk.fair_prob);
    return `<div class="${compact ? 'pkrow' : 'pickrow'}" style="grid-template-columns:repeat(${keys.length},1fr)">${keys.map(o => {
      const b = mk.best && mk.best[o], isVal = mk.value_outcome === o, isFav = market === 'h2h' && p.favorite === o;
      const label = market === 'totals' ? OUT_NAME(p, o).toUpperCase() : o;
      const attrs = `data-pick="${esc(p.id)}" data-o="${o}" data-m="${market}"`;
      if (compact) return `<button class="pkc${isFav ? ' fav' : ''}${isVal ? ' val' : ''}" ${attrs}>
        <span class="o">${label}${isVal ? ' ⭐' : ''}</span><b>${fnum(mk.fair_prob[o] * 100, 0)}%${market === 'h2h' ? moveHtml(moveOf(p, o)) : ''}</b>
        <span class="cyan">≥ ${odds(minB365(mk.fair_odds[o], thr))}</span></button>`;
      return `<button class="pk${isFav ? ' fav' : ''}${isVal ? ' val' : ''}" ${attrs}>
        <span class="o">${label}${isVal ? ' ⭐' : isFav ? ' ➜' : ''}</span>
        <b>${fnum(mk.fair_prob[o] * 100, 0)} %${market === 'h2h' ? moveHtml(moveOf(p, o)) : ''}</b>
        <span>JUSTA ${odds(mk.fair_odds[o])}</span>
        <span class="cyan">B365 ≥ ${odds(minB365(mk.fair_odds[o], thr))}</span>
        <span class="muted">${b ? esc(b.book) : '—'}</span>
        <span class="${b && b.edge > 0 ? 'pos' : 'muted'}">${b ? `${odds(b.odds)} (${b.edge >= 0 ? '+' : ''}${fnum(b.edge * 100, 0)} %)` : ''}</span>
      </button>`;
    }).join('')}</div>`;
  }

  function renderPicks() {
    const st = settings();
    if (!picksMode) picksMode = st.sendMode;
    if (!picksBusy && Date.now() - picksLoadedAt > 60000 && navigator.onLine) { picksLoadedAt = Date.now(); refreshPicks(); }
    const now = Date.now(), today = L.madridDate(), tomorrow = L.addDays(today, 1), after = L.addDays(today, 2);
    // Partidos aún no empezados (los empezados ya no se pueden apostar con CLV).
    const upcoming = (pickCache.picks || []).filter(p => new Date(p.commence_time).getTime() > now);
    const dayOf = p => L.madridDate(new Date(p.commence_time));
    const sports = Array.from(new Set(upcoming.map(p => sportOf(p.sport_key))));
    const leagues = Array.from(new Set(upcoming.filter(p => !pv.sport || sportOf(p.sport_key) === pv.sport).map(p => p.league))).sort();
    if (pv.sport && !sports.includes(pv.sport)) pv.sport = '';
    if (pv.league && !leagues.includes(pv.league)) pv.league = '';
    const filtered = upcoming.filter(p => (!pv.sport || sportOf(p.sport_key) === pv.sport) && (!pv.league || p.league === pv.league) &&
      (!pv.day || (pv.day === 'later' ? dayOf(p) >= after : dayOf(p) === pv.day)));
    const list = filtered.filter(p => picksMode === 'all' || pickHasValue(p))
      .sort(pv.sort === 'time' ? (a, b) => a.commence_time.localeCompare(b.commence_time) || a.league.localeCompare(b.league)
        : (a, b) => (pickHasValue(b) - pickHasValue(a)) || bestEdge(b) - bestEdge(a) || a.commence_time.localeCompare(b.commence_time));
    // Apuestas que ya tienes en cada partido (para no repetir).
    const mine = {};
    bets().forEach(b => { if (b.pickId) (mine[b.pickId] = mine[b.pickId] || []).push(b); });
    const nVal = filtered.filter(pickHasValue).length;
    const ls = pickCache.lastScan;
    const chip = (k, v, label) => `<button data-pf="${k}" data-v="${v}" class="${pv[k] === v ? 'on' : ''}">${label}</button>`;

    let html = `<div class="card">
      <div class="row"><div class="grow num">${creditsHtml(pickCache.credits)}</div>
        ${ls ? `<span class="muted">${fdate(L.madridDate(new Date(ls.at))).slice(0, 5)} ${new Date(ls.at).toLocaleTimeString('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit' })}</span>` : ''}</div>
      <div class="row" style="margin-top:8px;gap:6px">
        <button class="primary grow" id="scanSend" style="padding:13px 6px" ${picksBusy ? 'disabled' : ''}>${picksBusy ? '…' : '⚡ PICKS → TELEGRAM'}</button>
        <button id="scanOnly" style="padding:13px 10px" ${picksBusy ? 'disabled' : ''}>BUSCAR</button></div>
      ${picksMsg ? `<div class="muted" style="margin-top:8px">${esc(picksMsg)}</div>` : ''}
    </div>
    <div class="seg">${['value', 'all'].map(m => `<button data-pm="${m}" class="${picksMode === m ? 'on' : ''}">${m === 'value' ? `SOLO ⭐ (${nVal})` : `TODOS (${filtered.length})`}</button>`).join('')}</div>
    <div class="chips scroll-x pkfilters">
      ${sports.length > 1 ? chip('sport', '', 'TODOS') + sports.map(s => chip('sport', s, SPORT_EMOJI[s] || '🏆')).join('') + '<span class="sep"></span>' : ''}
      ${chip('day', '', 'CUALQUIER DÍA')}${chip('day', today, 'HOY')}${chip('day', tomorrow, 'MAÑANA')}${chip('day', 'later', 'DESPUÉS')}
    </div>
    <div class="row" style="gap:6px;margin-top:6px">
      <select id="pfLeague" class="grow"><option value="">TODAS LAS LIGAS</option>${leagues.map(l => `<option ${pv.league === l ? 'selected' : ''} value="${esc(l)}">${esc(l)}</option>`).join('')}</select>
      <div class="seg" style="width:150px">${chip('sort', 'value', 'VALOR')}${chip('sort', 'time', 'HORA')}</div>
    </div>`;

    if (!list.length) html += `<div class="card empty">${!(pickCache.picks || []).length ? 'AÚN NO HAY PICKS. PULSA BUSCAR.'
      : !filtered.length ? 'NINGÚN PARTIDO CON ESTOS FILTROS.' : 'NINGÚN PARTIDO CON ⭐ VALOR AHORA. TOCA "TODOS" PARA VERLOS.'}</div>`;
    let hdr = null;
    list.forEach(p => {
      const d = new Date(p.commence_time), day = dayOf(p);
      if (pv.sort === 'time') { const h = fdateShort(day); if (h !== hdr) { html += `<div class="datehdr">${h}</div>`; hdr = h; } }
      const time = d.toLocaleTimeString('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit' });
      const ve = valueEdge(p), my = mine[p.id] || [], open = openPicks.has(p.id);
      const when = pv.sort === 'time' ? time : `${day === today ? 'HOY' : day === tomorrow ? 'MAÑ' : fdateShort(day).split(' ')[0]} ${time}`;
      html += `<div class="pkcard${ve != null ? ' v' : ''}">
        <div class="pkhead" data-toggle="${esc(p.id)}">
          <div class="grow" style="min-width:0"><div class="ellipsis"><b>${esc(p.home)} – ${esc(p.away)}</b></div>
            <div class="muted ellipsis">${when} · ${sportEmoji(p.sport_key)} ${esc(p.league)}</div></div>
          ${my.length ? `<span class="tag mine" title="Ya apostado">✓ ${my.length > 1 ? my.length + ' ' : ''}APOSTADO</span>` : ''}
          ${ve != null ? `<span class="tag P">⭐ +${fnum(ve * 100, 0)}%</span>` : ''}
          <span class="muted">${open ? '▲' : '▼'}</span>
        </div>
        ${open ? pickCells(p, p, 'h2h', st.threshold, false) + (p.totals ? pickCells(p, p.totals, 'totals', st.threshold, false) : '') +
          `<div class="muted" style="margin-top:6px">PRECIO JUSTO: ${(p.fair_src || ['pinnacle']).map(s => s === 'betfair' ? 'BETFAIR' : 'PINNACLE').join(' + ')} · CAPTURA ${new Date(p.captured_at).toLocaleTimeString('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit' })}${my.length ? ' · TUS APUESTAS: ' + my.map(b => esc(selText(b)) + ' @' + odds(b.odds)).join(', ') : ''}</div>`
          : pickCells(p, p, 'h2h', st.threshold, true) + (p.totals ? pickCells(p, p.totals, 'totals', st.threshold, true) : '')}
      </div>`;
    });
    html += `<div class="muted" style="margin:10px 0">≥ = CUOTA MÍNIMA DE BET365 PARA QUE HAYA VALOR. ↑↓ = CAMBIO DE PROBABILIDAD DESDE LA PRIMERA BÚSQUEDA. TOCA UNA CASILLA PARA APUNTAR; TOCA EL PARTIDO PARA VER CASAS Y CUOTAS. LOS PARTIDOS EMPEZADOS NO SE MUESTRAN.</div>`;
    view.innerHTML = html;
    view.querySelectorAll('[data-pm]').forEach(b => b.onclick = () => { picksMode = b.dataset.pm; render(); });
    view.querySelectorAll('[data-pf]').forEach(b => b.onclick = () => { pv[b.dataset.pf] = b.dataset.v; savePv(); render(); });
    view.querySelector('#pfLeague').onchange = ev => { pv.league = ev.target.value; savePv(); render(); };
    view.querySelector('#scanSend').onclick = () => runScan(true);
    view.querySelector('#scanOnly').onclick = () => runScan(false);
    view.querySelectorAll('[data-toggle]').forEach(h => h.onclick = () => {
      const id = h.dataset.toggle; if (openPicks.has(id)) openPicks.delete(id); else openPicks.add(id); render();
    });
    view.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => {
      const p = (pickCache.picks || []).find(x => x.id === b.dataset.pick), o = b.dataset.o, market = b.dataset.m;
      if (!p) return;
      const mk = market === 'totals' ? p.totals : p, sp = sportOf(p.sport_key);
      openBet(null, { event: `${p.home} – ${p.away}`, sel: OUT_NAME(p, o), league: p.league, fair: L.r2(mk.fair_odds[o]), pickId: p.id, outcome: o,
        commence: p.commence_time, sport: sportEmoji(p.sport_key), market, point: market === 'totals' ? p.totals.point : null,
        type: market === 'totals' ? 'Goles' : sp === 'soccer' ? '1X2' : 'Ganador' });
    });
  }

  // ---------- ESTADÍSTICAS ----------
  const EDGE_KEYS = ['≥ UMBRAL', 'JUSTA–UMBRAL', 'BAJO JUSTA'];
  // Tabla de CLV agrupado: n, CLV medio, % positivas, beneficio y yield.
  function clvTable(rows, keepEmpty) {
    const list = keepEmpty ? rows : rows.filter(r => r.n);
    if (!list.some(r => r.n)) return '<div class="muted">SIN APUESTAS CON CLV TODAVÍA</div>';
    return `<table class="tbl"><tr><th></th><th>N</th><th>CLV</th><th>CLV+</th><th>BENEF.</th><th>YIELD</th></tr>
      ${list.map(r => `<tr><td class="ellipsis" style="max-width:120px">${esc(r.key)}</td><td class="num">${r.n}</td>
        <td class="num ${cls(r.avg)}">${r.n ? spct(r.avg, 1) : '—'}</td><td class="num">${r.n ? pct(r.pos, 0) : '—'}</td>
        <td class="num ${cls(r.profit)}">${r.n ? (r.profit > 0 ? '+' : '') + fnum(r.profit) : '—'}</td><td class="num ${cls(r.yield)}">${r.n ? spct(r.yield, 0) : '—'}</td></tr>`).join('')}</table>`;
  }

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
    const clvN = clv.n, goal = 300, st0 = settings();
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
        ${kv('ESPERANDO CIERRE', bs.filter(b => b.pickId && typeof b.clv !== 'number' && !b.clvMissed && (b.legs || []).length <= 1).length)}
        <div style="height:4px;background:var(--line);margin-top:6px"><div style="height:4px;width:${Math.min(100, clvN / goal * 100)}%;background:var(--cyan)"></div></div>
        <div class="muted" style="margin-top:8px">REGLA: CONFIAR SOLO CON CLV MEDIO &gt; +1 % EN 300+ APUESTAS. SE RELLENA SOLO CON LAS APUESTAS HECHAS DESDE UN PICK: AL EMPEZAR EL PARTIDO SE GUARDA LA CUOTA DE CIERRE DE PINNACLE.</div>
      </div>
      ${clvN ? `<h2>CLV MEDIO ACUMULADO</h2>
      <div class="card">${lineChart(L.clvSeries(bs), { id: 'clv', label: 'CLV medio acumulado', color: 'var(--cyan)',
        refs: [{ v: 0, label: '0 %' }, { v: 0.01, label: 'OBJ +1 %', col: 'var(--yellow)' }],
        tip: p => `${fdate(p.date)} · ${p.n} APUESTAS<br>MEDIA <b class="${cls(p.value)}">${spct(p.value, 2)}</b> · ${esc(selText(p.bet))} <span class="${cls(p.bet.clv)}">${spct(p.bet.clv, 1)}</span>` })}
        <div class="muted" style="margin-top:6px">SI LA LÍNEA SE ASIENTA POR ENCIMA DE LA AMARILLA (+1 %) CON MUCHAS APUESTAS, EL SISTEMA FUNCIONA.</div></div>
      <h2>CLV SEGÚN TU VENTAJA AL APOSTAR</h2>
      <div class="card">${clvTable(L.clvBy(bs, b => { const e = L.edgeAtBet(b); return e == null ? null : e * 100 >= st0.threshold ? EDGE_KEYS[0] : e >= 0 ? EDGE_KEYS[1] : EDGE_KEYS[2]; }, EDGE_KEYS), true)}
        <div class="muted" style="margin-top:6px">VENTAJA = TU CUOTA FRENTE A LA JUSTA DEL PICK AL APOSTAR. ≥ UMBRAL: CON VALOR · JUSTA–UMBRAL: POCO VALOR · BAJO JUSTA: SIN VALOR. AQUÍ SE VE SI TE COMPENSA ESPERAR A LA CUOTA MÍNIMA (≥).</div></div>
      <h2>CLV POR LIGA</h2>
      <div class="card">${clvTable(L.clvBy(bs, b => b.league))}</div>
      <h2>CLV POR MERCADO</h2>
      <div class="card">${clvTable(L.clvBy(bs, b => b.pickMarket === 'totals' ? 'MÁS/MENOS' : 'GANADOR (1X2)'))}</div>` : ''}
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
    wireChart();
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
      <div class="card"><label style="margin-top:0">LIGAS · ✓ = SE BUSCA · ⭐ = ENTRA EN EL ENVÍO DIARIO</label>
        ${(st.scan || []).map((l, i) => `<div class="lg">
          <button class="chk${l.on ? ' on' : ''}" data-son="${i}" aria-label="Activar">${l.on ? '✓' : ''}</button>
          <span class="grow ellipsis${l.on ? '' : ' muted'}">${sportEmoji(l.key)} ${esc(l.name)}</span>
          <button class="star${l.fav ? ' on' : ''}" data-sfav="${i}" aria-label="Favorita">⭐</button>
          <button class="rm" data-srm="${i}" aria-label="Quitar">×</button></div>`).join('') || '<div class="muted">SIN LIGAS</div>'}
        <button class="block" id="addLeague" style="margin-top:8px">+ AÑADIR LIGA O DEPORTE</button>
        <div class="muted" style="margin-top:8px">${scanBudget(st)}</div>
        <label>MÁS/MENOS GOLES EN BÚSQUEDAS MANUALES</label>
        <div class="seg"><button data-tot="on" class="${st.totals !== false ? 'on' : ''}">CON MÁS/MENOS</button><button data-tot="off" class="${st.totals === false ? 'on' : ''}">SOLO GANADOR</button></div>
        <div class="row" style="margin-top:12px"><div class="grow"><label style="margin-top:0">UMBRAL DE VALOR %</label><input id="thr" inputmode="decimal" value="${fnum(st.threshold, st.threshold % 1 ? 1 : 0)}"></div>
          <div class="grow"><label style="margin-top:0">ENVÍO POR DEFECTO</label><div class="seg"><button data-sm="value" class="${st.sendMode === 'value' ? 'on' : ''}">SOLO ⭐</button><button data-sm="all" class="${st.sendMode === 'all' ? 'on' : ''}">TODOS</button></div></div></div>
        <label>QUITAR EL MARGEN (PINNACLE Y BETFAIR)</label>
        <div class="seg"><button data-dv="power" class="${st.devig !== 'mult' ? 'on' : ''}">POWER</button><button data-dv="mult" class="${st.devig === 'mult' ? 'on' : ''}">PROPORCIONAL</button></div>
        <div class="muted" style="margin-top:6px">PROPORCIONAL REPARTE EL MARGEN A PARTES IGUALES; POWER CARGA MÁS MARGEN A LOS NO FAVORITOS, QUE ES DONDE LAS CASAS LO PONEN DE VERDAD.</div></div>
      <h2>ENVÍO AUTOMÁTICO DIARIO</h2>
      <div class="card"><div class="row"><div class="grow"><div class="seg"><button data-auto="off" class="${!(st.autoSend && st.autoSend.on) ? 'on' : ''}">APAGADO</button><button data-auto="on" class="${st.autoSend && st.autoSend.on ? 'on' : ''}">ENCENDIDO</button></div></div>
        <input id="autoTime" type="time" value="${esc((st.autoSend && st.autoSend.time) || '10:00')}" style="width:120px"></div>
        <div class="muted" style="margin-top:6px">CADA DÍA A ESA HORA (MADRID) TE LLEGAN LOS PICKS A TELEGRAM CON EL ENVÍO POR DEFECTO. GASTA 1 CRÉDITO POR LIGA CON PARTIDOS: UNOS 10 AL DÍA ≈ 300 AL MES DE LOS 500 GRATIS. SI QUEDAN MENOS DEL 10 %, NO GASTA Y TE AVISA.</div></div>
      <h2>CIERRE AUTOMÁTICO DE APUESTAS</h2>
      <div class="card"><div class="seg"><button data-aset="on" class="${st.autoSettle !== false ? 'on' : ''}">ENCENDIDO</button><button data-aset="off" class="${st.autoSettle === false ? 'on' : ''}">APAGADO</button></div>
        <label>AVISO EN TELEGRAM AL CERRAR</label>
        <div class="seg"><button data-anot="on" class="${st.settleNotify !== false ? 'on' : ''}">SÍ</button><button data-anot="off" class="${st.settleNotify === false ? 'on' : ''}">NO</button></div>
        <div class="muted" style="margin-top:6px">LAS APUESTAS HECHAS DESDE UN PICK (1X2, GANADOR Y MÁS/MENOS) SE CIERRAN SOLAS CON EL MARCADOR FINAL, UNAS 2 H DESPUÉS DEL INICIO. GASTA 2 CRÉDITOS POR LIGA Y CONSULTA (COMO MUCHO UNA CADA 30 MIN). PUEDES CORREGIRLAS A MANO. EN FÚTBOL CUENTA EL RESULTADO QUE DA LA API (EN COPAS CON PRÓRROGA, REVÍSALO).</div></div>
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
    const editScan = (i, fn) => { const scan = settings().scan.map(x => Object.assign({}, x)); fn(scan[i], scan); saveSettings({ scan }); };
    view.querySelectorAll('[data-son]').forEach(b => b.onclick = () => editScan(+b.dataset.son, l => { l.on = !l.on; if (!l.on) l.fav = false; }));
    view.querySelectorAll('[data-sfav]').forEach(b => b.onclick = () => editScan(+b.dataset.sfav, l => { l.fav = !l.fav; if (l.fav) l.on = true; }));
    view.querySelectorAll('[data-srm]').forEach(b => b.onclick = async () => {
      const i = +b.dataset.srm, l = settings().scan[i];
      if (await confirmDelete(`¿Quitar ${l.name} del escáner? Las apuestas y picks que ya tienes no cambian.`)) editScan(i, (x, scan) => scan.splice(i, 1));
    });
    view.querySelector('#addLeague').onclick = openLeaguePicker;
    view.querySelectorAll('[data-tot]').forEach(b => b.onclick = () => saveSettings({ totals: b.dataset.tot === 'on' }));
    view.querySelector('#thr').onchange = ev => { const v = pnum(ev.target.value); if (!(v >= 0)) { toast('Número no válido'); render(); return; } saveSettings({ threshold: v }); toast('GUARDADO'); };
    view.querySelectorAll('[data-sm]').forEach(b => b.onclick = () => { saveSettings({ sendMode: b.dataset.sm }); picksMode = b.dataset.sm; });
    view.querySelectorAll('[data-dv]').forEach(b => b.onclick = () => saveSettings({ devig: b.dataset.dv }));
    view.querySelectorAll('[data-auto]').forEach(b => b.onclick = () => saveSettings({ autoSend: Object.assign({}, settings().autoSend, { on: b.dataset.auto === 'on' }) }));
    view.querySelectorAll('[data-aset]').forEach(b => b.onclick = () => saveSettings({ autoSettle: b.dataset.aset === 'on' }));
    view.querySelectorAll('[data-anot]').forEach(b => b.onclick = () => saveSettings({ settleNotify: b.dataset.anot === 'on' }));
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

  // Estimación de créditos: solo gastan las ligas que tengan partidos en las próximas 72 h.
  function scanBudget(st) {
    const on = (st.scan || []).filter(l => l.on), fav = on.filter(l => l.fav);
    const manual = on.reduce((n, l) => n + (st.totals !== false && sportOf(l.key) === 'soccer' ? 2 : 1), 0);
    const daily = (fav.length ? fav : on).length;
    return `BÚSQUEDA MANUAL: HASTA ${manual} CRÉDITO${manual === 1 ? '' : 'S'}. ENVÍO DIARIO: ${fav.length ? 'SOLO ⭐' : 'TODAS LAS ACTIVAS (MARCA ⭐ PARA AHORRAR)'}, HASTA ${daily}/DÍA ≈ ${daily * 30}/MES DE 500. SOLO GASTAN LAS LIGAS CON PARTIDOS EN 72 H.`;
  }

  // Selector con todas las competiciones de The Odds API (la lista no gasta créditos).
  async function openLeaguePicker() {
    const m = sheet(`<h3>+ AÑADIR LIGA O DEPORTE</h3><input id="lq" placeholder="Buscar (p. ej. Championship, NBA, ATP)…" autocomplete="off" style="margin-top:8px">
      <div id="ll" class="muted" style="margin-top:8px">CARGANDO COMPETICIONES…</div><div class="actions"><button id="lclose">CERRAR</button></div>`);
    m.querySelector('#lclose').onclick = closeSheet;
    let info;
    try {
      const r = await S.callPicks({ action: 'status' });
      if (r.error || !r.sportsInfo) { m.querySelector('#ll').innerHTML = `<span class="neg">⛔ ${esc(r.error ? errText(r.error) : 'NO SE PUDO LEER LA LISTA (REVISA ODDS_API_KEY)')}</span>`; return; }
      info = r.sportsInfo;
      if (r.credits) savePicks({ credits: r.credits });
    } catch (e) { m.querySelector('#ll').innerHTML = '<span class="neg">⛔ SIN CONEXIÓN</span>'; return; }
    const GROUP_ORDER = ['Soccer', 'Basketball', 'Tennis'];
    const GROUP_ES = { Soccer: '⚽ FÚTBOL', Basketball: '🏀 BALONCESTO', Tennis: '🎾 TENIS' };
    const rank = g => (GROUP_ORDER.indexOf(g) + 1) || 99;
    const draw = () => {
      const q = m.querySelector('#lq').value.trim().toLowerCase();
      const have = new Set(settings().scan.map(l => l.key));
      const rows = info.filter(x => !q || (x.title + ' ' + (x.description || '') + ' ' + x.key).toLowerCase().includes(q))
        .sort((a, b) => rank(a.group) - rank(b.group) || a.group.localeCompare(b.group) || a.title.localeCompare(b.title));
      let html = '', g = null;
      rows.forEach(x => {
        if (x.group !== g) { g = x.group; html += `<div class="datehdr">${esc(GROUP_ES[g] || '🏆 ' + g.toUpperCase())}</div>`; }
        html += `<div class="lg"><span class="grow"><b>${esc(x.title)}</b><div class="muted">${esc(x.description || '')}</div></span>
          ${have.has(x.key) ? '<span class="tag W">AÑADIDA</span>' : `<button class="small" data-add-key="${esc(x.key)}">AÑADIR</button>`}</div>`;
      });
      m.querySelector('#ll').innerHTML = html || 'NADA COINCIDE';
      m.querySelectorAll('[data-add-key]').forEach(b => b.onclick = () => {
        const x = info.find(i => i.key === b.dataset.addKey);
        saveSettings({ scan: settings().scan.concat([{ name: x.title, key: x.key, on: true, fav: false }]) });
        toast('AÑADIDA: ' + x.title); draw();
      });
    };
    m.querySelector('#lq').oninput = draw;
    draw();
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
