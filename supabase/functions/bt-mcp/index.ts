// bt-mcp: servidor MCP para que Claude analice los picks y la banca de la app Betting (lectura) y guarde sus picks (guardar_pick_claude).
// Protegido con una clave larga en la dirección (?k=...) guardada en bt_state('mcp_token').
import { createClient } from 'npm:@supabase/supabase-js@2';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const H = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS' };
const r2 = (x: number) => Math.round(x * 100) / 100;

// En la app una apuesta sin resultado tiene result 'P' (pendiente) o vacío.
const isClosed = (b: any) => !!b.result && b.result !== 'P';
const profit = (b: any) => {
  const s = +b.stake || 0, o = +b.odds || 1, f = !!b.bonus, r = b.result;
  const pay = r === 'W' ? (f ? s * (o - 1) : s * o) : r === 'V' ? (f ? 0 : s) : r === 'HW' ? (f ? s * .5 * (o - 1) : s * .5 * (1 + o)) : r === 'HL' ? (f ? 0 : s * .5) : r === 'CO' ? +b.cashout || 0 : 0;
  return r2(pay - (f ? 0 : s));
};

async function state() {
  const { data } = await db.from('bt_items').select('kind,data').eq('deleted', false).in('kind', ['bet', 'movement', 'settings']);
  const bets: any[] = [], moves: any[] = []; let st: any = {};
  (data || []).forEach((r: any) => { if (r.kind === 'bet') bets.push(r.data); else if (r.kind === 'movement') moves.push(r.data); else st = r.data; });
  return { bets, moves, st };
}

function funds(bets: any[], moves: any[]) {
  let net = 0, bonus = 0, prof = 0, pend = 0;
  moves.forEach(m => { const a = Math.abs(+m.amount || 0); if (m.type === 'deposit') net += a; else if (m.type === 'withdrawal') net -= a; else if (m.type === 'bonus') bonus += a; });
  bets.forEach(b => { if (isClosed(b)) prof += profit(b); else if (!b.bonus) pend += +b.stake || 0; });
  return { available: r2(net + bonus + prof - pend), enJuego: r2(pend), beneficioCerrado: r2(prof), depositosNetos: r2(net + bonus) };
}

async function toolEstado() {
  const { bets, moves, st } = await state();
  const f = funds(bets, moves), today = new Date().toISOString().slice(0, 10);
  const pend = bets.filter(b => !isClosed(b)).map(b => ({ fecha: b.date, evento: b.event, seleccion: (b.legs || []).map((l: any) => l.sel).join(' + ') || b.event, cuota: b.odds, importe: b.stake, casa: b.book, mercado: b.type, cuota_justa_al_apostar: b.fair || null }));
  const closed = bets.filter(b => isClosed(b) && !b.bonus), week = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const sum = (a: any[]) => r2(a.reduce((s, b) => s + profit(b), 0));
  return {
    banca_disponible_eur: f.available, en_juego_eur: f.enJuego, beneficio_total_cerrado_eur: f.beneficioCerrado, depositos_netos_mas_bonos_eur: f.depositosNetos,
    beneficio_hoy_eur: sum(closed.filter(b => b.date === today)), beneficio_7d_eur: sum(closed.filter(b => b.date >= week)), apuestas_cerradas: closed.length,
    pendientes: pend, ajustes: { unidad_pct_por_nivel: st.unit, fraccion_kelly: st.kelly, umbral_valor_pct: st.threshold, casas: st.books, limite_perdida_semana: st.lossWeek, limite_perdida_mes: st.lossMonth }
  };
}

async function toolPicks(args: any) {
  const hours = Math.min(168, Math.max(1, +args.horas || 48)), onlyValue = args.solo_valor === true;
  const now = new Date(), until = new Date(now.getTime() + hours * 3600e3);
  const { data: picks } = await db.from('bt_picks').select('id,home,away,league,sport,commence_time,fair_odds,fair_prob,first_fair_prob,best,prices,totals,extras,model,fair_src,devig,cc').gt('commence_time', now.toISOString()).lt('commence_time', until.toISOString()).order('commence_time').limit(300);
  const { bets, moves, st } = await state();
  const f = funds(bets, moves), thr = (st.threshold != null ? +st.threshold : 3) / 100;
  const books: string[] = (st.myBooks && st.myBooks.length ? st.myBooks : st.books && st.books.length ? st.books : ['bet365']).map((x: string) => x.toLowerCase());
  const outNo: any[] = [], outYes: any[] = [];
  const byPick: Record<string, any[]> = {};
  bets.forEach(b => { if (b.pickId && !isClosed(b)) (byPick[b.pickId] = byPick[b.pickId] || []).push(b); });
  const kelly = (o: number, fair: number) => { const p = 1 / fair, k = (p * o - 1) / (o - 1); return k > 0 ? k * (+st.kelly || 0.25) : 0; };
  for (const p of picks || []) {
    const opts: any[] = [];
    const add = (mk: string, fo: Record<string, number>, best: any, prices: any) => {
      for (const k of Object.keys(fo || {})) {
        let o = 0, book = '';
        for (const [bk, row] of Object.entries(prices || {})) if (books.includes(bk.toLowerCase()) && (row as any)[k] > o) { o = (row as any)[k]; book = bk; }
        if (!o && best && best[k]) { o = best[k].odds; book = best[k].book + ' (mejor del mercado, no es tu casa)'; }
        if (!o) continue;
        const edge = o / fo[k] - 1;
        opts.push({ mercado: mk, resultado: k, cuota: o, casa: book, cuota_justa: r2(fo[k]), probabilidad_justa_pct: r2(100 / fo[k]), ventaja_pct: r2(edge * 100), stake_kelly_eur: edge > 0 ? r2(f.available * kelly(o, fo[k])) : 0, hay_valor: edge >= thr });
      }
    };
    add('1X2/ganador', p.fair_odds, p.best, p.prices);
    if (p.totals && p.totals.fair_odds) add('Más/Menos ' + p.totals.point, p.totals.fair_odds, p.totals.best, p.totals.prices);
    // Doble oportunidad y empate no válido, derivados de las probabilidades justas 1X2 (sin cuota de casa: se da la mínima con valor)
    const pr = p.fair_prob || {}, derived: any[] = [];
    if (pr['1'] && pr['X'] && pr['2']) {
      const mk = (mercado: string, resultado: string, prob: number) => derived.push({ mercado, resultado, probabilidad_justa_pct: r2(prob * 100), cuota_justa: r2(1 / prob), cuota_minima_con_valor: r2(Math.ceil(100 / prob * (1 + thr) - 1e-9) / 100) });
      mk('Doble oportunidad', '1X', pr['1'] + pr['X']); mk('Doble oportunidad', 'X2', pr['X'] + pr['2']); mk('Doble oportunidad', '12', pr['1'] + pr['2']);
      mk('Empate no válido', '1 (DNB)', pr['1'] / (pr['1'] + pr['2'])); mk('Empate no válido', '2 (DNB)', pr['2'] / (pr['1'] + pr['2']));
    }
    const mine = byPick[p.id] || [];
    const sel = mine.length || !onlyValue ? opts : opts.filter(o => o.hay_valor);
    if (!sel.length) continue;
    const item: any = { pick_id: p.id, partido: p.home + ' - ' + p.away, liga: p.league, empieza_utc: p.commence_time, fuentes_precio_justo: p.fair_src, prediccion_modelo_pct: p.model || null, opciones_ahora: sel, mercados_derivados: derived, extras_guardados: p.extras || null, modelo_tarjetas_corners: p.cc || null };
    if (mine.length) { item.mis_apuestas = mine.map(b => ({ seleccion: (b.legs || []).map((l: any) => l.sel).join(' + ') || b.event, cuota_que_cogi: b.odds, importe_eur: b.stake, cuota_justa_al_apostar: b.fair || null, casa: b.book })); outYes.push(item); }
    else outNo.push(item);
  }
  return { banca_disponible_eur: f.available, umbral_valor_pct: thr * 100, nota: 'ventaja = cuota/cuota_justa - 1. stake_kelly_eur ya aplica la fracción Kelly del usuario. sin_apostar: todos los partidos sin apuesta (hay_valor marca los que tienen ventaja). apostados: partidos donde ya hay apuesta pendiente, con las opciones ACTUALES para comparar con lo que se cogió. mercados_derivados: doble oportunidad y empate no válido calculados desde el precio justo 1X2 (comparar con la cuota real de la casa). modelo_tarjetas_corners: modelo propio (football-data.co.uk) con media y líneas de córneres y tarjetas si el usuario lo calculó en la app. Solo lectura: no se apuesta desde aquí.', sin_apostar: outNo, apostados: outYes };
}

// Guarda una recomendación de Claude como "pick de Claude" (se cierra sola con el resultado y se compara con el sistema).
const MK = ['h2h', 'dc', 'dnb', 'totals', 'btts', 'corners', 'cards'];
async function toolSave(a: any) {
  const market = String(a.mercado || ''), outcome = String(a.resultado || '').toUpperCase(), odds = +a.cuota;
  if (!MK.includes(market)) return { error: 'mercado no válido: ' + MK.join(', ') };
  if (!['1', 'X', '2', '1X', '12', 'X2', 'O', 'U', 'Y', 'N'].includes(outcome)) return { error: 'resultado no válido (1, X, 2, 1X, 12, X2, O, U, Y, N)' };
  if (!(odds > 1)) return { error: 'cuota no válida' };
  let p: any = null;
  if (a.pick_id) { const { data } = await db.from('bt_picks').select('id,sport_key,home,away,league,commence_time').eq('id', String(a.pick_id)).maybeSingle(); p = data; }
  if (!p) return { error: 'pick_id no encontrado: usa el pick_id que devuelve picks_proximos' };
  const point = a.linea != null && a.linea !== '' ? +a.linea : null;
  const id = `cl-${p.id}-${market}-${outcome}${point != null ? '-' + point : ''}`;
  const data = { id, pickId: p.id, date: String(p.commence_time).slice(0, 10), commence: p.commence_time, sport_key: p.sport_key, home: p.home, away: p.away, league: p.league,
    event: `${p.home} – ${p.away}`, sel: String(a.seleccion || '').slice(0, 120), market, outcome, point, odds, fair: +a.cuota_justa > 1 ? +a.cuota_justa : null,
    stake: +a.importe_eur > 0 ? +a.importe_eur : null, reason: String(a.motivo || '').slice(0, 400), result: null, created: Date.now() };
  const { error } = await db.from('bt_items').upsert({ id, kind: 'claude', data, updated_at: Date.now(), deleted: false, server_ts: new Date().toISOString() });
  return error ? { error: error.message } : { ok: true, id, nota: 'Guardado como pick de Claude. La app lo cierra sola con el resultado (ligas cubiertas por football-data.co.uk).' };
}

const TOOLS = [
  { name: 'estado_banca', description: 'Banca disponible, dinero en juego, apuestas pendientes, beneficio reciente y ajustes de Betting (unidad, Kelly, umbral, límites).', inputSchema: { type: 'object', properties: {} } },
  { name: 'guardar_pick_claude', description: 'Guarda en la app Betting cada recomendación final de Claude para medir después si acierta. Una llamada por apuesta recomendada.', inputSchema: { type: 'object', required: ['pick_id', 'mercado', 'resultado', 'cuota'], properties: {
    pick_id: { type: 'string', description: 'pick_id del partido (de picks_proximos)' },
    mercado: { type: 'string', enum: ['h2h', 'dc', 'dnb', 'totals', 'btts', 'corners', 'cards'], description: 'h2h=1X2, dc=doble oportunidad, dnb=empate no válido, totals=goles más/menos, btts=ambos marcan, corners, cards=tarjetas' },
    resultado: { type: 'string', description: '1, X, 2 (h2h y dnb); 1X, 12, X2 (dc); O=más, U=menos (totals, corners, cards); Y/N (btts)' },
    linea: { type: 'number', description: 'Línea para totals, corners y cards (por ejemplo 2.5 o 9.5)' },
    cuota: { type: 'number', description: 'Cuota mínima o cuota de bet365 a la que lo recomiendas' },
    cuota_justa: { type: 'number', description: 'Tu cuota justa estimada' },
    seleccion: { type: 'string', description: 'Texto corto, por ejemplo "Más de 9,5 córners"' },
    importe_eur: { type: 'number', description: 'Importe recomendado en €' },
    motivo: { type: 'string', description: 'Motivo en una o dos frases' } } } },
  { name: 'picks_proximos', description: 'Picks de las próximas horas con precio justo (Pinnacle/Betfair sin margen), cuota disponible en las casas del usuario, ventaja y stake Kelly sugerido. Devuelve sin_apostar (todos los partidos sin apuesta, con hay_valor) y apostados (con apuesta pendiente y sus opciones actuales), más doble oportunidad, empate no válido y modelo de tarjetas y córneres.', inputSchema: { type: 'object', properties: { horas: { type: 'number', description: 'Ventana en horas (1-168, por defecto 48)' }, solo_valor: { type: 'boolean', description: 'Solo opciones con valor en sin_apostar (por defecto false)' } } } }
];

async function handle(m: any) {
  const id = m.id, ok = (result: unknown) => ({ jsonrpc: '2.0', id, result });
  if (m.method === 'initialize') return ok({ protocolVersion: (m.params && m.params.protocolVersion) || '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'betting', version: '1.5.0' } });
  if (m.method === 'ping') return ok({});
  if (m.method === 'tools/list') return ok({ tools: TOOLS });
  if (m.method === 'tools/call') {
    try {
      const n = m.params && m.params.name, a = (m.params && m.params.arguments) || {};
      const res = n === 'estado_banca' ? await toolEstado() : n === 'picks_proximos' ? await toolPicks(a) : n === 'guardar_pick_claude' ? await toolSave(a) : null;
      if (!res) return { jsonrpc: '2.0', id, error: { code: -32602, message: 'Herramienta desconocida' } };
      return ok({ content: [{ type: 'text', text: JSON.stringify(res) }] });
    } catch (e) { return ok({ isError: true, content: [{ type: 'text', text: 'Error: ' + (e as Error).message }] }); }
  }
  if (id === undefined) return null;
  return { jsonrpc: '2.0', id, error: { code: -32601, message: 'Método no soportado' } };
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: H });
  const k = new URL(req.url).searchParams.get('k') || '';
  const { data } = await db.from('bt_state').select('data').eq('key', 'mcp_token').maybeSingle();
  const tok = data && data.data && data.data.token;
  if (!tok || k.length < 20 || k !== tok) return new Response(JSON.stringify({ error: 'no autorizado' }), { status: 401, headers: H });
  if (req.method !== 'POST') return new Response(null, { status: 405, headers: H });
  let body: any; try { body = await req.json(); } catch { return new Response('{}', { status: 400, headers: H }); }
  if (Array.isArray(body)) { const r = (await Promise.all(body.map(handle))).filter(Boolean); return r.length ? new Response(JSON.stringify(r), { headers: H }) : new Response(null, { status: 202, headers: H }); }
  const r = await handle(body);
  return r ? new Response(JSON.stringify(r), { headers: H }) : new Response(null, { status: 202, headers: H });
});
