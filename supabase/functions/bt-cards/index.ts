// bt-cards: modelo de tarjetas y córneres con los CSV gratuitos de football-data.co.uk (sin clave ni créditos).
// POST { secret, action: 'cards', pickId } → calcula, guarda en bt_picks.cc y devuelve { cc }.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { pickMessage } from './tg.js';
import { LEAGUES, seasonCode, prevSeason, parseCsv, buildTable, mergeTables, ccModel } from './cards.js';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, apikey, authorization, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const CACHE_H = 12;

// Tabla de una temporada (en caché 12 h en bt_state para no descargar el CSV cada vez).
async function seasonTable(code: string, season: string) {
  const key = `fd:${code}:${season}`;
  const { data: c } = await db.from('bt_state').select('data').eq('key', key).maybeSingle();
  if (c && c.data && Date.now() - c.data.at < CACHE_H * 3600e3) return c.data.table;
  const res = await fetch(`https://www.football-data.co.uk/mmz4281/${season}/${code}.csv`);
  if (!res.ok) return null;
  const table = buildTable(parseCsv(await res.text()));
  await db.from('bt_state').upsert({ key, data: { at: Date.now(), table }, updated_at: new Date().toISOString() });
  return table;
}

// Secretos con nombre tolerante (mayúsculas/espacios).
function env(k: string) {
  const norm = (x: string) => x.trim().toUpperCase().replace(/[\s-]+/g, '_');
  const all = Deno.env.toObject(), hit = Object.keys(all).find(n => norm(n) === k);
  return hit ? (all[hit] || '').trim() : '';
}
// Envía a Telegram el resumen de un partido con todos los mercados que haya guardados.
async function sendPick(id: string) {
  const token = env('TELEGRAM_BOT_TOKEN'), chat = env('TELEGRAM_CHAT_ID');
  if (!token || !chat) return json({ error: 'missing_telegram' });
  const { data: p } = await db.from('bt_picks').select('home,away,league,commence_time,fair_odds,fair_prob,totals,extras,cc').eq('id', id).maybeSingle();
  if (!p) return json({ error: 'pick_not_found' }, 404);
  const { data: row } = await db.from('bt_items').select('data').eq('id', 'settings').maybeSingle();
  const thr = (row && row.data && row.data.threshold != null ? +row.data.threshold : 3) / 100;
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text: pickMessage(p, thr), parse_mode: 'HTML', disable_web_page_preview: true }) });
  const out = await res.json();
  return json(out.ok ? { ok: true } : { error: 'telegram', message: out.description || 'Error de Telegram' });
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  let body: any; try { body = await req.json(); } catch { return json({ error: 'bad_request' }, 400); }
  const { data: ok, error: chk } = await db.rpc('bt_check', { p_secret: String(body.secret || '') });
  if (chk) return json({ error: /too_many/.test(chk.message) ? 'too_many_attempts' : 'check_failed' }, 429);
  if (!ok) return json({ error: 'bad_secret' }, 401);
  try {
    if (body.action === 'send') return await sendPick(String(body.pickId || ''));
    if (body.action !== 'cards') return json({ error: 'unknown_action' }, 400);
    const { data: p } = await db.from('bt_picks').select('id,sport_key,home,away').eq('id', String(body.pickId || '')).maybeSingle();
    if (!p) return json({ error: 'pick_not_found' }, 404);
    const code = (LEAGUES as any)[p.sport_key];
    if (!code) return json({ error: 'league_not_covered' });
    const { data: row } = await db.from('bt_items').select('data').eq('id', 'settings').maybeSingle();
    const thr = (row && row.data && row.data.threshold != null ? +row.data.threshold : 3) / 100;
    const season = seasonCode(), cur = await seasonTable(code, season), prev = await seasonTable(code, prevSeason(season));
    if (!cur && !prev) return json({ error: 'no_data' });
    const table = cur ? mergeTables(cur, prev, 0.5) : prev;
    const m = ccModel(table, p.home, p.away, thr);
    if (!m) return json({ error: 'teams_not_found' });
    const cc = { ...m, source: `football-data.co.uk ${code} ${season}`, at: new Date().toISOString() };
    await db.from('bt_picks').update({ cc }).eq('id', p.id);
    return json({ cc });
  } catch (e) {
    console.error(e);
    return json({ error: 'server', message: String((e as Error).message || e) }, 500);
  }
});
