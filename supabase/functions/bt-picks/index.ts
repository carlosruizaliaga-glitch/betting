// bt-picks: pide cuotas 1X2 a The Odds API, quita el margen de Pinnacle, guarda los picks
// en bt_picks y los envía a Telegram. Protegida con el código de acceso de la app.
//
// POST { secret, action }:
//   status       → créditos que quedan y qué secretos faltan (no gasta créditos)
//   detect_chat  → lee getUpdates del bot para encontrar tu chat_id
//   picks        → picks guardados de las próximas horas (no gasta créditos)
//   extras       → { pickId, confirmLow } Ambos marcan y Más/Menos 0,5, 1,5 y 3,5 de un partido (2 créditos)
//   scan         → { mode: 'value'|'all', send: true, confirmLow: false }
//                  (manual: ligas activas + Más/Menos en fútbol; auto: solo ligas ⭐ y solo ganador)
// POST { action: 'cron', cronKey } (pg_cron cada 5 min): cuota de cierre, CLV, cierre automático y envío diario.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { BOOKS, buildPicks, buildExtras, formatMessages, pinnacleFair, closingFairFor, clv, sportOf, settleOutcome, betProfit, finalScore } from './picks.js';

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
// Lee un secreto tolerando mayúsculas/minúsculas y espacios en el nombre.
const norm = (k: string) => k.trim().toUpperCase().replace(/[\s-]+/g, '_');
function env(k: string) {
  const exact = Deno.env.get(k);
  if (exact) return exact.trim();
  const all = Deno.env.toObject();
  const hit = Object.keys(all).find(n => norm(n) === k);
  return hit ? (all[hit] || '').trim() : '';
}
// Nombres (no valores) de los secretos propios, para diagnosticar desde la app.
const ownSecretNames = () => Object.keys(Deno.env.toObject())
  .filter(n => !/^(SUPABASE_|SB_|DENO_|DB_|PATH$|HOME$|HOSTNAME$|PWD$|LANG$|TZ$|NO_COLOR$|EDGE_|JWT_|VERIFY_JWT)/i.test(n)).sort();
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
    fav: (s.scan || []).filter((l: any) => l.on && l.fav && l.key),
    totals: s.totals !== false,
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
  // Envío automático: solo ligas ⭐ (si no hay ninguna, todas las activas) y solo mercado ganador.
  const scanList = body.auto && st.fav.length ? st.fav : st.scan;
  const marketsFor = (key: string) => !body.auto && st.totals && sportOf(key) === 'soccer' ? 'h2h,totals' : 'h2h';
  const covers = (have: string, want: string) => want.split(',').every(m => (have || 'h2h').split(',').includes(m));
  const now = new Date(), to = new Date(now.getTime() + WINDOW_H * 3600e3);
  const window = { commenceTimeFrom: isoZ(now), commenceTimeTo: isoZ(to) };

  // 1) Qué ligas tienen partidos en 72 h (el endpoint /events no gasta créditos).
  const leagues = await Promise.all(scanList.map(async (l: any) => {
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
  const cacheMap = new Map((cached || []).filter((c: any) => covers(c.markets, marketsFor(c.sport_key))).map((c: any) => [c.sport_key, c]));
  const toFetch = active.filter(l => !cacheMap.has(l.key));
  // Coste = mercados × regiones (hasta 10 casas = 1 región).
  const cost = toFetch.reduce((n, l) => n + marketsFor(l.key).split(',').length, 0);

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
    const markets = marketsFor(l.key);
    const r = await oddsGet(`/sports/${l.key}/odds`, { ...window, bookmakers: BOOKS.join(','), markets, oddsFormat: 'decimal' });
    if (r.ok && Array.isArray(r.data)) {
      await db.from('bt_odds_cache').upsert({ sport_key: l.key, fetched_at: new Date().toISOString(), data: r.data, markets });
      return { key: l.key, data: r.data, fetched_at: new Date().toISOString(), markets };
    }
    return { key: l.key, error: (r.data && r.data.message) || ('HTTP ' + r.status) };
  }));
  const fetchedMap = new Map(fetched.filter(f => !f.error).map(f => [f.key, f]));

  // 5) Picks.
  let picks: any[] = [];
  for (const l of active) {
    const src: any = fetchedMap.get(l.key) || cacheMap.get(l.key);
    if (!src) continue;
    picks = picks.concat(buildPicks(src.data, { league: l.name, sportKey: l.key, threshold: st.threshold, method: st.devig, now,
      capturedAt: new Date(src.fetched_at), withTotals: (src.markets || 'h2h').includes('totals') })
      .filter(p => new Date(p.commence_time) <= to));
  }
  if (picks.length) {
    // Movimiento: se conserva la primera captura de cada partido.
    const prev = new Map();
    for (let i = 0; i < picks.length; i += 200) {
      const { data } = await db.from('bt_picks').select('id,first_fair_prob,first_captured_at').in('id', picks.slice(i, i + 200).map(p => p.id));
      for (const r of data || []) prev.set(r.id, r);
    }
    for (const p of picks) {
      const o: any = prev.get(p.id);
      p.first_fair_prob = (o && o.first_fair_prob) || p.fair_prob;
      p.first_captured_at = (o && o.first_captured_at) || p.captured_at;
    }
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

// ---------- Mercados extra bajo demanda (ambos marcan y Más/Menos 1,5 y 3,5) ----------
// Solo en fútbol y partidos sin empezar. Cuesta 1 crédito por mercado (2 en total) y se guarda 30 min.
async function extras(body: any) {
  if (!env('ODDS_API_KEY')) return { error: 'missing_odds_key' };
  const { data: p } = await db.from('bt_picks').select('id,sport_key,commence_time,extras').eq('id', String(body.pickId || '')).maybeSingle();
  if (!p) return { error: 'no_pick' };
  if (sportOf(p.sport_key) !== 'soccer') return { error: 'not_soccer' };
  if (new Date(p.commence_time) <= new Date()) return { error: 'started' };
  if (p.extras && p.extras.at && Date.now() - new Date(p.extras.at).getTime() < CACHE_MIN * 60e3) {
    return { ok: true, extras: p.extras, cost: 0, credits: await loadCredits() };
  }
  const cost = 2;
  if (!credits) credits = await loadCredits();
  if (credits && credits.remaining != null) {
    const quota = (credits.used || 0) + credits.remaining;
    if (credits.remaining < cost) return { error: 'no_credits', cost, credits, quota };
    if (!body.confirmLow && quota > 0 && credits.remaining - cost < quota * LOW_SHARE) return { needConfirm: true, cost, credits, quota };
  }
  const st = await settings();
  const r = await oddsGet(`/sports/${p.sport_key}/events/${p.id}/odds`, { bookmakers: BOOKS.join(','), markets: 'btts,alternate_totals', oddsFormat: 'decimal' });
  if (!r.ok) return { error: (r.data && (r.data.message || r.data.error_code)) || ('HTTP ' + r.status) };
  const ex = buildExtras(r.data, st.devig, st.threshold);
  await db.from('bt_picks').update({ extras: ex }).eq('id', p.id);
  await saveCredits();
  return { ok: true, extras: ex, cost, credits };
}

// ---------- Tareas programadas ----------
const MIN = 60e3;
const madridHM = (d: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
const madridDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(d);
const toMin = (hm: string) => +hm.slice(0, 2) * 60 + +hm.slice(3, 5);

async function pickBets() {
  const { data, error } = await db.from('bt_items').select('id,data,updated_at').eq('kind', 'bet').eq('deleted', false).not('data->>pickId', 'is', null);
  if (error) throw error;
  return (data || []).filter((r: any) => r.data.pickId && (r.data.legs || []).length <= 1);
}

// Cuota de cierre de Pinnacle: solo partidos con apuesta tuya, entre 6 min antes y 1 min después
// del inicio (con la tarea cada 5 min siempre cae una vez). 1 crédito por partido.
async function captureClosing(now: Date) {
  const bets = await pickBets();
  const ids = [...new Set(bets.map((r: any) => r.data.pickId))];
  if (!ids.length) return { fetched: 0, missed: 0 };
  // Línea de Más/Menos apostada en cada partido (si la hay): se pide también ese mercado (1 crédito más).
  const totPoint = new Map(), bttsIds = new Set();
  for (const r of bets) {
    if (r.data.pickMarket === 'totals' && r.data.point != null) totPoint.set(r.data.pickId, +r.data.point);
    if (r.data.pickMarket === 'btts') bttsIds.add(r.data.pickId);
  }
  const { data: picks } = await db.from('bt_picks').select('id,sport_key,commence_time,totals').in('id', ids).is('closing', null);
  const st = await settings();
  let fetched = 0, missed = 0;
  for (const p of picks || []) {
    const t = new Date(p.commence_time).getTime(), n = now.getTime();
    if (t > n + 6 * MIN) continue;
    if (t < n - MIN) {
      await db.from('bt_picks').update({ closing: { missed: true }, closing_at: now.toISOString() }).eq('id', p.id);
      missed++; continue;
    }
    if (!env('ODDS_API_KEY')) break;
    const tp = totPoint.get(p.id);
    // h2h siempre (también sirve para doble oportunidad y empate no vale); más la línea de goles y/o ambos marcan si se apostó.
    const mk = ['h2h'];
    if (tp != null) mk.push(p.totals && +p.totals.point === tp ? 'totals' : 'alternate_totals');
    if (bttsIds.has(p.id)) mk.push('btts');
    const r = await oddsGet(`/sports/${p.sport_key}/events/${p.id}/odds`, { bookmakers: 'pinnacle', markets: mk.join(','), oddsFormat: 'decimal' });
    const c = r.ok ? pinnacleFair(r.data, st.devig, tp, bttsIds.has(p.id)) : null;
    if (c) {
      await db.from('bt_picks').update({ closing: { ...c, at: now.toISOString() }, closing_at: now.toISOString() }).eq('id', p.id);
      fetched++;
    }
  }
  if (fetched) await saveCredits();
  return { fetched, missed };
}

// Escribe el CLV en las apuestas cuyo partido ya tiene cuota de cierre (la app lo recibe al sincronizar).
async function fillClv() {
  const need = (await pickBets()).filter((r: any) => r.data.pickOutcome && r.data.clv == null && !r.data.clvMissed);
  if (!need.length) return 0;
  const { data: picks } = await db.from('bt_picks').select('id,closing').in('id', [...new Set(need.map((r: any) => r.data.pickId))]).not('closing', 'is', null);
  const map = new Map((picks || []).map((p: any) => [p.id, p.closing]));
  let n = 0;
  for (const r of need) {
    const c: any = map.get(r.data.pickId);
    const fair = closingFairFor(c, r.data);
    let data;
    // Sin cierre (apuesta apuntada con el partido ya empezado): se marca para que la app no espere.
    if (c && c.missed) data = { ...r.data, clvMissed: true };
    else if (fair > 1 && +r.data.odds > 1) data = { ...r.data, closingFair: Math.round(fair * 1000) / 1000, clv: clv(+r.data.odds, fair) };
    else continue;
    const { error } = await db.from('bt_items').update({ data, updated_at: Math.max(Date.now(), r.updated_at + 1), server_ts: new Date().toISOString() })
      .eq('id', r.id).eq('updated_at', r.updated_at);
    if (!error) n++;
  }
  return n;
}

// Cierre automático: apuestas pendientes hechas desde picks cuyo partido ya debería haber terminado.
// /scores con daysFrom cuesta 2 créditos por consulta: como mucho una por liga cada 30 min y 8 intentos por partido.
const SETTLE_AFTER_MIN: Record<string, number> = { soccer: 115, basketball: 150, tennis: 90 };
const SETTLE_EVERY_MIN = 30, SETTLE_MAX_TRIES = 8;
const RESULT_ES: Record<string, string> = { W: '✅ GANADA', L: '❌ PERDIDA', V: '➖ NULA', HW: '✅ MEDIO GANADA', HL: '❌ MEDIO PERDIDA' };
const eur = (x: number) => (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x).toFixed(2).replace('.', ',') + ' €';

async function autoSettle(now: Date) {
  const { data: row } = await db.from('bt_items').select('data').eq('id', 'settings').maybeSingle();
  const st = (row && row.data) || {};
  if (st.autoSettle === false || !env('ODDS_API_KEY')) return null;
  const pend = (await pickBets()).filter((r: any) => r.data.result === 'P' && r.data.pickOutcome && r.data.commence);
  if (!pend.length) return null;
  const { data: picks } = await db.from('bt_picks').select('id,sport_key,home,away').in('id', [...new Set(pend.map((r: any) => r.data.pickId))]);
  const pickMap = new Map((picks || []).map((p: any) => [p.id, p]));
  const { data: stRow } = await db.from('bt_state').select('data').eq('key', 'settle').maybeSingle();
  const state = (stRow && stRow.data) || { last: {}, tries: {} };
  state.last = state.last || {}; state.tries = state.tries || {};

  // Partidos que ya deberían haber terminado, agrupados por liga.
  const bySport = new Map();
  for (const r of pend) {
    const p: any = pickMap.get(r.data.pickId);
    if (!p) continue;
    const mins = (now.getTime() - new Date(r.data.commence).getTime()) / MIN;
    if (mins < (SETTLE_AFTER_MIN[sportOf(p.sport_key)] || 120) || mins > 3 * 24 * 60) continue;
    if ((state.tries[p.id] || 0) >= SETTLE_MAX_TRIES) continue;
    if (!bySport.has(p.sport_key)) bySport.set(p.sport_key, []);
    bySport.get(p.sport_key).push(r);
  }
  let calls = 0;
  const done: string[] = [];
  for (const [sportKey, rows] of bySport) {
    const last = state.last[sportKey];
    if (last && now.getTime() - new Date(last).getTime() < SETTLE_EVERY_MIN * MIN) continue;
    const ids = [...new Set(rows.map((r: any) => r.data.pickId))];
    const res = await oddsGet(`/sports/${sportKey}/scores`, { daysFrom: '3', eventIds: ids.join(','), dateFormat: 'iso' });
    calls++;
    state.last[sportKey] = now.toISOString();
    if (!res.ok || !Array.isArray(res.data)) continue;
    const evMap = new Map(res.data.map((e: any) => [e.id, e]));
    for (const id of ids) {
      const ev: any = evMap.get(id), fs = finalScore(ev);
      if (!fs) { state.tries[id] = (state.tries[id] || 0) + 1; continue; }
      delete state.tries[id];
      for (const r of rows.filter((x: any) => x.data.pickId === id)) {
        const d = r.data, market = d.pickMarket || 'h2h';
        const result = settleOutcome(market, d.pickOutcome, fs.home, fs.away, d.point != null ? +d.point : NaN);
        if (!result) continue;
        const data = { ...d, result, closedAt: now.getTime(), autoSettled: true, score: `${fs.home}-${fs.away}` };
        const { error } = await db.from('bt_items').update({ data, updated_at: Math.max(Date.now(), r.updated_at + 1), server_ts: new Date().toISOString() })
          .eq('id', r.id).eq('updated_at', r.updated_at);
        if (error) continue;
        const sel = (d.legs && d.legs[0] && d.legs[0].sel) || '', ev2 = (d.legs && d.legs[0] && d.legs[0].event) || '';
        done.push(`${RESULT_ES[result] || result} · ${sel}${ev2 ? ` (${ev2} · ${fs.home}-${fs.away})` : ''} · ${eur(betProfit(result, d.stake, d.odds, d.bonus))}`);
      }
    }
  }
  if (calls) {
    await db.from('bt_state').upsert({ key: 'settle', data: state, updated_at: now.toISOString() });
    await saveCredits();
  }
  if (done.length && st.settleNotify !== false && env('TELEGRAM_BOT_TOKEN') && env('TELEGRAM_CHAT_ID')) {
    const esc = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    await telegram('sendMessage', { chat_id: env('TELEGRAM_CHAT_ID'), parse_mode: 'HTML',
      text: `<b>🧾 APUESTAS CERRADAS AUTOMÁTICAMENTE</b>\n${done.map(esc).join('\n')}\n\nSi algo no cuadra, cámbialo en la app.` });
  }
  return { calls, settled: done.length };
}

// Envío diario: una vez al día, en la hora siguiente a la elegida (hora de Madrid).
async function autoSend(now: Date) {
  const { data: row } = await db.from('bt_items').select('data').eq('id', 'settings').maybeSingle();
  const a = row && row.data && row.data.autoSend;
  if (!a || !a.on || !/^\d{2}:\d{2}$/.test(a.time || '')) return null;
  const diff = toMin(madridHM(now)) - toMin(a.time), day = madridDay(now);
  if (diff < 0 || diff >= 60) return null;
  const { data: last } = await db.from('bt_state').select('data').eq('key', 'auto_send').maybeSingle();
  if (last && last.data && last.data.day === day) return null;
  await db.from('bt_state').upsert({ key: 'auto_send', data: { day, at: now.toISOString() }, updated_at: now.toISOString() });
  const r: any = await scan({ send: true, auto: true });
  if ((r.needConfirm || r.error) && env('TELEGRAM_CHAT_ID')) {
    const why = r.needConfirm ? `quedan ${r.credits.remaining} créditos (menos del 10 %)` : r.error === 'no_credits' ? 'no quedan créditos' : r.error;
    await telegram('sendMessage', { chat_id: env('TELEGRAM_CHAT_ID'), text: `⚠️ Envío automático omitido: ${why}. Puedes enviarlo a mano desde la app.` });
  }
  await db.from('bt_state').upsert({ key: 'auto_send', data: { day, at: now.toISOString(), cost: r.cost || 0, sent: r.sent || 0, error: r.error || (r.needConfirm ? 'low_credits' : null) }, updated_at: now.toISOString() });
  return { cost: r.cost || 0, sent: r.sent || 0 };
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  credits = null;
  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'bad_json' }, 400); }

  if (body.action === 'cron') {
    const { data: k } = await db.from('bt_state').select('data').eq('key', 'cron_key').maybeSingle();
    if (!k || !body.cronKey || body.cronKey !== k.data.key) return json({ error: 'bad_cron' }, 401);
    try {
      const now = new Date();
      return json({ ok: true, closing: await captureClosing(now), clv: await fillClv(), settle: await autoSettle(now), auto: await autoSend(now) });
    } catch (e) {
      console.error(e);
      return json({ error: 'server', message: String((e && (e as Error).message) || e) }, 500);
    }
  }

  const { data: okSecret, error: chkErr } = await db.rpc('bt_check', { p_secret: String(body.secret || '') });
  if (chkErr) return json({ error: /too_many/.test(chkErr.message) ? 'too_many_attempts' : 'check_failed' }, 429);
  if (!okSecret) return json({ error: 'bad_secret' }, 401);

  try {
    switch (body.action) {
      case 'status': {
        const secrets = { odds: !!env('ODDS_API_KEY'), token: !!env('TELEGRAM_BOT_TOKEN'), chat: !!env('TELEGRAM_CHAT_ID') };
        let sports: string[] | null = null, sportsInfo: any[] | null = null, oddsError = null;
        if (secrets.odds) {
          const r = await oddsGet('/sports', {}); // no gasta créditos
          if (r.ok) {
            sports = r.data.map((s: any) => s.key);
            sportsInfo = r.data.filter((s: any) => !s.has_outrights).map((s: any) => ({ key: s.key, title: s.title, group: s.group, description: s.description }));
            await saveCredits();
          }
          else oddsError = (r.data && r.data.error_code) || ('HTTP ' + r.status);
        }
        const { data: last } = await db.from('bt_state').select('data').eq('key', 'last_scan').maybeSingle();
        const { data: auto } = await db.from('bt_state').select('data').eq('key', 'auto_send').maybeSingle();
        return json({ ok: true, secrets, names: ownSecretNames(), oddsError, credits: credits || await loadCredits(), sports, sportsInfo, lastScan: last && last.data, autoSend: auto && auto.data });
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
      case 'extras':
        return json(await extras(body));
      default:
        return json({ error: 'unknown_action' }, 400);
    }
  } catch (e) {
    console.error(e);
    return json({ error: 'server', message: String((e && (e as Error).message) || e) }, 500);
  }
});
