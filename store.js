// Almacén local + sincronización con Supabase.
// Cada dato (apuesta, movimiento de caja, ajustes) es un "item" con
// updated_at; ante conflicto gana la versión más reciente. Los cambios se guardan
// primero en el móvil (funciona sin conexión) y se suben cuando hay red.
(function (root) {
  'use strict';
  const API = 'https://wlspqhzihcqfehjgyuco.supabase.co/rest/v1/rpc/';
  const KEY = 'sb_publishable_q1IeGj-Ayl82IJYlMYoo5w_9VxlLMZV';
  const LS = 'betting.v1';

  let db = { items: {}, outbox: {}, since: null, secret: null, me: null, lastSync: null };
  try { Object.assign(db, JSON.parse(localStorage.getItem(LS) || '{}')); } catch (e) { console.error(e); }

  const listeners = [];
  let status = navigator.onLine ? 'idle' : 'offline'; // idle | syncing | ok | offline | bad_secret | error
  let timer = null, syncing = false, again = false, version = 0;

  function persist() {
    try { localStorage.setItem(LS, JSON.stringify(db)); }
    catch (e) { console.error(e); }
  }
  function emit() { listeners.forEach(f => { try { f(); } catch (e) { console.error(e); } }); }

  async function rpc(name, body) {
    const res = await fetch(API + name, {
      method: 'POST',
      headers: { apikey: KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch (e) { data = text; }
    if (!res.ok) {
      const msg = (data && data.message) || text || ('HTTP ' + res.status);
      const err = new Error(msg); err.server = true; throw err;
    }
    return data;
  }

  function put(kind, data, deleted) {
    const old = db.items[data.id];
    const updated_at = Math.max(Date.now(), old ? old.updated_at + 1 : 0);
    db.items[data.id] = { id: data.id, kind, data, updated_at, deleted: !!deleted };
    db.outbox[data.id] = updated_at;
    version++;
    persist(); emit(); schedule(600);
  }

  function merge(remote) {
    let changed = false;
    remote.forEach(r => {
      const local = db.items[r.id];
      if (!local || r.updated_at >= local.updated_at) {
        if (!local || JSON.stringify(local) !== JSON.stringify(r)) changed = true;
        db.items[r.id] = r;
        if (db.outbox[r.id] && db.outbox[r.id] <= r.updated_at) delete db.outbox[r.id];
      }
    });
    return changed;
  }

  async function sync() {
    if (!db.secret) return;
    if (syncing) { again = true; return; }
    syncing = true; status = 'syncing'; emit();
    try {
      const sent = Object.assign({}, db.outbox);
      const changes = Object.keys(sent).map(id => db.items[id]).filter(Boolean)
        .map(i => ({ id: i.id, kind: i.kind, data: i.data, updated_at: i.updated_at, deleted: i.deleted }));
      const res = await rpc('bt_sync', { p_secret: db.secret, p_changes: changes, p_since: db.since });
      if (res && res.error === 'bad_secret') { status = 'bad_secret'; return; }
      Object.keys(sent).forEach(id => { if (db.outbox[id] === sent[id]) delete db.outbox[id]; });
      if (merge(res.items || [])) version++;
      db.since = res.now;
      db.lastSync = Date.now();
      status = 'ok';
      persist();
    } catch (e) {
      console.warn('sync', e);
      status = (e.server && /too_many_attempts/.test(e.message)) ? 'error' : (navigator.onLine ? 'error' : 'offline');
    } finally {
      syncing = false; emit();
      if (again) { again = false; schedule(300); }
    }
  }

  function schedule(ms) {
    clearTimeout(timer);
    timer = setTimeout(sync, ms || 0);
  }

  // Sincroniza al abrir, al volver a la app, al recuperar la red y cada 20 s.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(0); });
  window.addEventListener('online', () => schedule(0));
  window.addEventListener('offline', () => { status = 'offline'; emit(); });
  setInterval(() => { if (!document.hidden) sync(); }, 20000);

  const Store = {
    onChange: f => listeners.push(f),
    status: () => status,
    version: () => version,
    pending: () => Object.keys(db.outbox).length,
    lastSync: () => db.lastSync,
    loggedIn: () => !!db.secret,
    me: () => db.me,
    setMe: id => { db.me = id; persist(); emit(); },
    list: kind => Object.values(db.items).filter(i => i.kind === kind && !i.deleted).map(i => i.data),
    get: id => (db.items[id] && !db.items[id].deleted) ? db.items[id].data : null,
    has: id => !!db.items[id],
    put: (kind, data) => put(kind, data, false),
    remove: (kind, data) => put(kind, data, true),
    syncNow: () => sync(),
    // Estado del servidor: 'new' (sin código) o 'configured'.
    serverStatus: () => rpc('bt_status'),
    // Crea (create=true) o comprueba el código. Devuelve created|ok|bad|too_short|not_configured.
    login: async (secret, create) => {
      const r = await rpc('bt_setup', { p_secret: secret, p_create: !!create });
      if (r === 'created' || r === 'ok') {
        db.secret = secret; db.since = null; persist();
        await sync();
      }
      return r;
    },
    logout: () => { version++; db = { items: {}, outbox: {}, since: null, secret: null, me: null, lastSync: null }; persist(); emit(); },
    exportAll: () => Object.values(db.items),
    importAll: items => {
      items.forEach(i => { if (i && i.id && i.kind && i.data) put(i.kind, i.data, i.deleted); });
    }
  };
  root.Store = Store;
  if (db.secret) schedule(0);
})(window);
