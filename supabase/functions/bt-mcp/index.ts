// bt-mcp: servidor MCP (solo lectura) para que Claude analice los picks y la banca de la app Betting.
// Protegido con una clave larga en la dirección (?k=...) guardada en bt_state('mcp_token').
import { createClient } from 'npm:@supabase/supabase-js@2';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const H = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS' };
const r2 = (x: number) => Math.round(x * 100) / 100;

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
  bets.forEach(b => { if (b.result) prof += profit(b); else if (!b.bonus) pend += +b.stake || 0; });
  return { available: r2(net + bonus + prof - pend), enJuego: r2(pend), beneficioCerrado: r2(prof), depositosNetos: r2(net + bonus) };
}

async function toolEstado() {
  const { bets, moves, st } = await state();
  const f = funds(bets, moves), today = new Date().toISOString().slice(0, 10);
  const pend = bets.filter(b => !b.result).map(b => ({ fecha: b.date, evento: b.event, seleccion: (b.legs || []).map((l: any) => l.sel).join(' + ') || b.event, cuota: b.odds, importe: b.stake, casa: b.book, mercado: b.type }));
  const closed = bets.filter(b => b.result && !b.bonus), week = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const sum = (a: any[]) => r2(a.reduce((s, b) => s + profit(b), 0));
  return {
    banca_disponible_eur: f.available, en_juego_eur: f.enJuego, beneficio_total_cerrado_eur: f.beneficioCerrado, depositos_netos_mas_bonos_eur: f.depositosNetos,
    beneficio_hoy_eur: sum(closed.filter(b => b.date === today)), beneficio_7d_eur: sum(closed.filter(b => b.date >= week)), apuestas_cerradas: closed.length,
    pendientes: pend, ajustes: { unidad_pct_por_nivel: st.unit, fraccion_kelly: st.kelly, umbral_valor_pct: st.threshold, casas: st.books, limite_perdida_semana: st.lossWeek, limite_perdida_mes: st.lossMonth }
  };
}

async function toolPicks(args: any) {
  const hours = Math.min(168, Math.max(1, +args.horas || 48)), onlyValue = args.solo_valor !== false;
  const now = new Date(), until = new Date(now.getTime() + hours * 3600e3);
  const { data: picks } = await db.from('bt_picks').select('id,home,away,league,sport,commence_time,fair_odds,fair_prob,first_fair_prob,best,prices,totals,extras,model,fair_src,devig').gt('commence_time', now.toISOString()).lt('commence_time', until.toISOString()).order('commence_time').limit(300);
  const { bets, moves, st } = await state();
  const f = funds(bets, moves), thr = (st.threshold != null ? +st.threshold : 3) / 100;
  const books: string[] = (st.myBooks && st.myBooks.length ? st.myBooks : st.books && st.books.length ? st.books : ['bet365']).map((x: string) => x.toLowerCase());
  const out: any[] = [];
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
    const sel = onlyValue ? opts.filter(o => o.hay_valor) : opts;
    if (!sel.length) continue;
    out.push({ pick_id: p.id, partido: p.home + ' - ' + p.away, liga: p.league, empieza_utc: p.commence_time, fuentes_precio_justo: p.fair_src, prediccion_modelo_pct: p.model || null, opciones: sel });
  }
  return { banca_disponible_eur: f.available, umbral_valor_pct: thr * 100, nota: 'ventaja = cuota/cuota_justa - 1. stake_kelly_eur ya aplica la fracción Kelly del usuario. Solo lectura: no se apuesta desde aquí.', picks: out };
}

const TOOLS = [
  { name: 'estado_banca', description: 'Banca disponible, dinero en juego, apuestas pendientes, beneficio reciente y ajustes de Betting (unidad, Kelly, umbral, límites).', inputSchema: { type: 'object', properties: {} } },
  { name: 'picks_proximos', description: 'Picks de las próximas horas con precio justo (Pinnacle/Betfair sin margen), cuota disponible en las casas del usuario, ventaja y stake Kelly sugerido. Por defecto solo los que tienen valor.', inputSchema: { type: 'object', properties: { horas: { type: 'number', description: 'Ventana en horas (1-168, por defecto 48)' }, solo_valor: { type: 'boolean', description: 'Solo opciones con valor (por defecto true)' } } } }
];

async function handle(m: any) {
  const id = m.id, ok = (result: unknown) => ({ jsonrpc: '2.0', id, result });
  if (m.method === 'initialize') return ok({ protocolVersion: (m.params && m.params.protocolVersion) || '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'betting', version: '1.0.0' } });
  if (m.method === 'ping') return ok({});
  if (m.method === 'tools/list') return ok({ tools: TOOLS });
  if (m.method === 'tools/call') {
    try {
      const n = m.params && m.params.name, a = (m.params && m.params.arguments) || {};
      const res = n === 'estado_banca' ? await toolEstado() : n === 'picks_proximos' ? await toolPicks(a) : null;
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
