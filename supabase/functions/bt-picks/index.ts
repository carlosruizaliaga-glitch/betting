// bt-picks: pide cuotas 1X2 a The Odds API, quita el margen de Pinnacle, guarda los picks
// en bt_picks y los envía a Telegram. Protegida con el código de acceso de la app.
//
// POST { secret, action }:
//   status       → créditos que quedan y qué secretos faltan (no gasta créditos)
//   detect_chat  → lee getUpdates del bot para encontrar tu chat_id
//   picks        → picks guardados de las próximas horas (no gasta créditos)
//   scan         → { mode: 'value'|'all', send: true, confirmLow: false }
import { createClient } from 'npm:@supabase/supabase-js@2';
import { BOOKS, buildPicks, formatMessages } from './picks.js';

const ODDS = 'https://api.the-odds-api.com/v4';
const CACHE_MIN = 30;
const WINDOW_H = 72;
const LOW_SHARE = 0.10;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, apikey, authorization, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const env = (k: string) => (Deno.env.get(k) || '').trim();
const isoZ = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

type Credits = { remaining: number | null; used: number | null; last: number | null; at: string };
let credits: Credits | null = null;

async function oddsGet(path: string, params: Record<string, string>) {
  const u = new URL(ODDS + path);
  u.searchParams.set('apiKey', env('ODDS_API_KEY'));
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const res = await fetch(u);
  const rem = res.headers.get('x-requests-remaining'), used = res.headers.get('x-requests-used');
  if (rem != null) {
    credits = { remaining: Math.round(+rem), used: used != null ? Math.round(+used) : null, last: +(res.headers.get('x-requests-last') || 0), at: new Date().toISOString() };
  }
  const text = await res.text();
  let data: any; try { data = JSON.parse(text); } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

async function saveCredits() {
  if (credits) await db.from('bt_state').upsert({ key: 'credits', data: credits, updated_at: new Date().toISOString() });
}
async function loadCredits(): Promise<Credits | null> {
  const { data } = await db.from('bt_state').select('data').eq('key', 'credits').maybeSingle();
  return data ? data.data : null;
}

async function settings() {
  const { data } = await db.from('bt_items').select('data').eq('id', 'settings').maybeSingle();
  const s = (data && data.data) || {};
  return {
    scan: (s.scan || []).filter((l: any) => l.on && l.key),
    threshold: s.threshold != null ? +s.threshold : 3,
    sendMode: s.sendMode === 'all' ? 'all' : 'value',
    devig: s.devig === 'mult' ? 'mult' : 'power'
  };
}

async function telegram(method: string, body: Record<string, unknown>) {
  const res = await fetch(`https://api.telegram.org/bot${env('TELEGRAM_BOT_TOKEN')}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  return await res.json();
}

async function picksFromDb() {
  const since = new Date(Date.now() - 3 * 3600e3).toISOString();
  const { data, error } = await db.from('bt_picks').select('*').gte('commence_time', since).order('commence_time').limit(400);
  if (error) throw error;
  return data || [];
}

// ---------- scan ----------
async function scan(body: any) {
  if (!env('ODDS_API_KEY')) return { error: 'missing_odds_key' };
  const st = await settings();
  const mode = body.mode === 'all' || body.mode === 'value' ? body.mode : st.sendMode;
  const now = new Date(), to = new Date(now.getTime() + WINDOW_H * 3600e3);
  const window = { commenceTimeFrom: isoZ(now), commenceTimeTo: isoZ(to) };

  // 1) Qué ligas tienen partidos en 72 h (el endpoint /events no gasta créditos).
  const leagues = await Promise.all(st.scan.map(async (l: any) => {
    const r = await oddsGet(`/sports/${l.key}/events`, window);
    const n = r.ok && Array.isArray(r.data) ? r.data.length : 0;
    return { ...l, events: n, error: r.ok ? null : (r.data && r.data.error_code) || ('HTTP ' + r.status) };
  }));
  if (leagues.some(l => l.error === 'INVALID_KEY' || l.error === 'MISSING_KEY')) return { error: 'bad_odds_key' };
  const active = leagues.filter(l => l.events > 0);
  if (!credits) credits = await loadCredits();

  // 2) Caché de 30 min: no se vuelve a pagar una liga pedida hace poco.
  const fresh = new Date(now.getTime() - CACHE_MIN * 60e3).toISOString();
  const { data: cached } = await db.from('bt_odds_cache').select('*').in('sport_key', active.map(l => l.key)).gte('fetched_at', fresh);
  const cacheMap = new Map((cached || []).map((c: any) => [c.sport_key, c]));
  const toFetch = active.filter(l => !cacheMap.has(l.key));
  const cost = toFetch.length; // markets (1) × regiones (4 casas = 1)

  // 3) Aviso si la pulsación deja la cuota por debajo del 10 %.
  if (cost > 0 && credits && credits.remaining != null) {
    const quota = (credits.used || 0) + credits.remaining;
    if (credits.remaining < cost) { await saveCredits(); return { error: 'no_credits', cost, credits, quota }; }
    if (!body.confirmLow && quota > 0 && credits.remaining - cost < quota * LOW_SHARE) {
      await saveCredits();
      return { needConfirm: true, cost, credits, quota, leagues: leagues.map(l => ({ name: l.name, events: l.events, error: l.error })) };
    }
  }

  // 4) Cuotas h2h de las ligas que faltan.
  const fetched = await Promise.all(toFetch.map(async l => {
    const r = await oddsGet(`/sports/${l.key}/odds`, { ...window, bookmakers: BOOKS.join(','), markets: 'h2h', oddsFormat: 'decimal' });
    if (r.ok && Array.isArray(r.data)) {
      await db.from('bt_odds_cache').upsert({ sport_key: l.key, fetched_at: new Date().toISOString(), data: r.data });
      return { key: l.key, data: r.data, fetched_at: new Date().toISOString() };
    }
    return { key: l.key, error: (r.data && r.data.message) || ('HTTP ' + r.status) };
  }));
  const fetchedMap = new Map(fetched.filter(f => !f.error).map(f => [f.key, f]));

  // 5) Picks.
  let picks: any[] = [];
  for (const l of active) {
    const src: any = fetchedMap.get(l.key) || cacheMap.get(l.key);
    if (!src) continue;
    picks = picks.concat(buildPicks(src.data, { league: l.name, sportKey: l.key, threshold: st.threshold, method: st.devig, now, capturedAt: new Date(src.fetched_at) })
      .filter(p => new Date(p.commence_time) <= to));
  }
  if (picks.length) {
    const { error } = await db.from('bt_picks').upsert(picks);
    if (error) throw error;
  }

  // 6) Telegram.
  let sent = 0, tgError = null;
  if (body.send !== false) {
    if (!env('TELEGRAM_BOT_TOKEN') || !env('TELEGRAM_CHAT_ID')) tgError = 'missing_telegram';
    else {
      for (const text of formatMessages(picks, { mode, threshold: st.threshold, method: st.devig })) {
        const r = await telegram('sendMessage', { chat_id: env('TELEGRAM_CHAT_ID'), text, parse_mode: 'HTML', disable_web_page_preview: true });
        if (r.ok) sent++; else { tgError = r.description || 'telegram_error'; break; }
      }
    }
  }
  await saveCredits();
  await db.from('bt_state').upsert({ key: 'last_scan', data: { at: now.toISOString(), mode, cost, picks: picks.length, sent }, updated_at: now.toISOString() });
  return {
    ok: true, mode, cost, sent, tgError, credits, picks: await picksFromDb(),
    leagues: leagues.map(l => ({ name: l.name, key: l.key, events: l.events, error: l.error, cached: cacheMap.has(l.key) })),
    fetchErrors: fetched.filter(f => f.error)
  };
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  credits = null;
  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'bad_json' }, 400); }

  const { data: okSecret, error: chkErr } = await db.rpc('bt_check', { p_secret: String(body.secret || '') });
  if (chkErr) return json({ error: /too_many/.test(chkErr.message) ? 'too_many_attempts' : 'check_failed' }, 429);
  if (!okSecret) return json({ error: 'bad_secret' }, 401);

  try {
    switch (body.action) {
      case 'status': {
        const secrets = { odds: !!env('ODDS_API_KEY'), token: !!env('TELEGRAM_BOT_TOKEN'), chat: !!env('TELEGRAM_CHAT_ID') };
        let sports: string[] | null = null, oddsError = null;
        if (secrets.odds) {
          const r = await oddsGet('/sports', {}); // no gasta créditos
          if (r.ok) { sports = r.data.map((s: any) => s.key); await saveCredits(); }
          else oddsError = (r.data && r.data.error_code) || ('HTTP ' + r.status);
        }
        const { data: last } = await db.from('bt_state').select('data').eq('key', 'last_scan').maybeSingle();
        return json({ ok: true, secrets, oddsError, credits: credits || await loadCredits(), sports, lastScan: last && last.data });
      }
      case 'detect_chat': {
        if (!env('TELEGRAM_BOT_TOKEN')) return json({ error: 'missing_token' });
        const r = await telegram('getUpdates', {});
        if (!r.ok) return json({ error: r.description || 'telegram_error' });
        const chats = new Map();
        for (const u of r.result || []) {
          const c = (u.message || u.edited_message || u.channel_post || {}).chat;
          if (c) chats.set(c.id, { id: String(c.id), name: c.title || [c.first_name, c.last_name].filter(Boolean).join(' ') || c.username || '' });
        }
        return json({ ok: true, chats: [...chats.values()] });
      }
      case 'picks':
        return json({ ok: true, picks: await picksFromDb(), credits: await loadCredits() });
      case 'scan':
        return json(await scan(body));
      default:
        return json({ error: 'unknown_action' }, 400);
    }
  } catch (e) {
    console.error(e);
    return json({ error: 'server', message: String((e && (e as Error).message) || e) }, 500);
  }
});
