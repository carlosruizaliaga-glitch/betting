// bt-cards: datos gratuitos de football-data.co.uk (sin clave ni créditos) y Telegram.
// POST { secret, action }:
//   cards   { pickId }  → modelo de tarjetas y córneres, lo guarda en bt_picks.cc
//   send    { pickId }  → envía el partido con todos sus mercados a Telegram
//   results { items:[{id, sport_key, home, away, date, market, outcome, point}] } → { id: {result, score} } para cerrar apuestas en papel
//   weekly  (o { action:'weekly', cronKey } desde pg_cron) → informe semanal a Telegram
import { createClient } from 'npm:@supabase/supabase-js@2';
import { pickMessage } from './tg.js';
import { LEAGUES, seasonCode, prevSeason, parseCsv, buildTable, mergeTables, ccModel } from './cards.js';
import { resultRows, findResult, settle, weeklyReport } from './paper.js';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, apikey, authorization, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const CACHE_H = 6;

// Temporada (tabla de equipos + resultados), en caché en bt_state para no descargar el CSV cada vez.
async function season(code: string, s: string) {
  const key = `fd:${code}:${s}`;
  const { data: c } = await db.from('bt_state').select('data').eq('key', key).maybeSingle();
  if (c && c.data && c.data.res && Date.now() - c.data.at < CACHE_H * 3600e3) return c.data;
  const res = await fetch(`https://www.football-data.co.uk/mmz4281/${s}/${code}.csv`);
  if (!res.ok) return null;
  const rows = parseCsv(await res.text());
  const data = { at: Date.now(), table: buildTable(rows), res: resultRows(rows) };
  await db.from('bt_state').upsert({ key, data, updated_at: new Date().toISOString() });
  return data;
}

function env(k: string) {
  const norm = (x: string) => x.trim().toUpperCase().replace(/[\s-]+/g, '_');
  const all = Deno.env.toObject(), hit = Object.keys(all).find(n => norm(n) === k);
  return hit ? (all[hit] || '').trim() : '';
}
async function telegram(text: string) {
  const token = env('TELEGRAM_BOT_TOKEN'), chat = env('TELEGRAM_CHAT_ID');
  if (!token || !chat) return { error: 'missing_telegram' };
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true }) });
  const out = await res.json();
  return out.ok ? { ok: true } : { error: 'telegram', message: out.description || 'Error de Telegram' };
}
async function threshold() {
  const { data: row } = await db.from('bt_items').select('data').eq('id', 'settings').maybeSingle();
  return (row && row.data && row.data.threshold != null ? +row.data.threshold : 3) / 100;
}

async function sendPick(id: string) {
  const { data: p } = await db.from('bt_picks').select('home,away,league,commence_time,fair_odds,fair_prob,totals,extras,cc').eq('id', id).maybeSingle();
  if (!p) return json({ error: 'pick_not_found' }, 404);
  return json(await telegram(pickMessage(p, await threshold())));
}

async function cards(id: string) {
  const { data: p } = await db.from('bt_picks').select('id,sport_key,home,away').eq('id', id).maybeSingle();
  if (!p) return json({ error: 'pick_not_found' }, 404);
  const code = (LEAGUES as any)[p.sport_key];
  if (!code) return json({ error: 'league_not_covered' });
  const s = seasonCode(), cur = await season(code, s), prev = await season(code, prevSeason(s));
  if (!cur && !prev) return json({ error: 'no_data' });
  const table = cur ? mergeTables(cur.table, prev && prev.table, 0.5) : prev.table;
  const m = ccModel(table, p.home, p.away, await threshold());
  if (!m) return json({ error: 'teams_not_found' });
  const cc = { ...m, source: `football-data.co.uk ${code} ${s}`, at: new Date().toISOString() };
  await db.from('bt_picks').update({ cc }).eq('id', p.id);
  return json({ cc });
}

async function results(items: any[]) {
  const out: Record<string, unknown> = {}, cache: Record<string, any> = {};
  for (const it of (items || []).slice(0, 200)) {
    const code = (LEAGUES as any)[it.sport_key];
    if (!code) { out[it.id] = { result: null, reason: 'league_not_covered' }; continue; }
    const s = seasonCode(new Date(it.date + 'T12:00:00Z'));
    if (!(code + s in cache)) cache[code + s] = await season(code, s);
    const data = cache[code + s];
    const r = data ? findResult(data.res, it.home, it.away, it.date) : null;
    if (!r) { out[it.id] = { result: null, reason: 'not_found' }; continue; }
    out[it.id] = { result: settle(it.market, it.outcome, it.point, r), score: `${r[3]}-${r[4]}`, corners: r[5], cards: r[6] };
  }
  return json({ results: out });
}

async function weekly() {
  const { data } = await db.from('bt_items').select('kind,data').eq('deleted', false).in('kind', ['bet', 'paper', 'claude']);
  return json(await telegram(weeklyReport(data || [], new Date())));
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  let body: any; try { body = await req.json(); } catch { return json({ error: 'bad_request' }, 400); }
  if (body.action === 'weekly' && body.cronKey) {
    const { data: k } = await db.from('bt_state').select('data').eq('key', 'cron_key').maybeSingle();
    if (!k || body.cronKey !== k.data.key) return json({ error: 'bad_cron' }, 401);
    return await weekly();
  }
  const { data: ok, error: chk } = await db.rpc('bt_check', { p_secret: String(body.secret || '') });
  if (chk) return json({ error: /too_many/.test(chk.message) ? 'too_many_attempts' : 'check_failed' }, 429);
  if (!ok) return json({ error: 'bad_secret' }, 401);
  try {
    if (body.action === 'send') return await sendPick(String(body.pickId || ''));
    if (body.action === 'cards') return await cards(String(body.pickId || ''));
    if (body.action === 'results') return await results(body.items);
    if (body.action === 'weekly') return await weekly();
    return json({ error: 'unknown_action' }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: 'server', message: String((e as Error).message || e) }, 500);
  }
});
