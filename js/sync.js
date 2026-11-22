// sync.js — вхід в акаунт і синхронізація з Supabase.
//
// Додаток «local-first»: усе читається й пишеться в IndexedDB (storage.js), тому працює
// офлайн. Тут ми лише (1) відправляємо на сервер записи, що змінилися, і (2) підтягуємо
// зміни з інших пристроїв. Конфлікти вирішує новіший updatedAt.
// Без бібліотек: GoTrue і PostgREST — звичайний fetch.

import * as store from './storage.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, VAPID_PUBLIC_KEY } from './config.js';
import * as notif from './notifications.js';

const SESSION_KEY = 'rytm.auth';
const PUSH_KEY = 'rytm.push';
const PAGE = 1000;
const MIN_PULL_GAP_MS = 15_000;

/* ----------------------- Відповідність полів ------------------------ */
// camelCase у додатку ↔ snake_case у базі
const TABLES = {
  tasks: {
    table: 'tasks',
    conflict: 'id',
    fields: {
      id: 'id', title: 'title', note: 'note', date: 'date', time: 'time', weekOf: 'week_of', priority: 'priority',
      emoji: 'emoji', repeat: 'repeat', reminders: 'reminders', done: 'done', doneAt: 'done_at', snoozed: 'snoozed',
      exceptions: 'exceptions', sample: 'sample', createdAt: 'created_at', updatedAt: 'updated_at', deletedAt: 'deleted_at',
    },
    defaults: {
      title: '', note: '', emoji: null, date: null, time: null, weekOf: null, priority: 2, repeat: null, reminders: [], done: false,
      doneAt: null, snoozed: false, exceptions: {}, sample: false, deletedAt: null,
    },
  },
  habits: {
    table: 'habits',
    conflict: 'id',
    fields: {
      id: 'id', name: 'name', emoji: 'emoji', color: 'color', freq: 'freq', goal: 'goal', reminderTime: 'reminder_time',
      startDate: 'start_date', endDate: 'end_date', dayMarks: 'day_marks',
      archived: 'archived', order: 'sort_order', sample: 'sample', createdAt: 'created_at', updatedAt: 'updated_at',
      deletedAt: 'deleted_at',
    },
    defaults: {
      name: '', emoji: '✅', color: '#2f7d6d', freq: { type: 'daily' }, goal: { type: 'bool' }, reminderTime: null,
      startDate: null, endDate: null, dayMarks: {}, archived: false, order: null, sample: false, deletedAt: null,
    },
  },
  completions: {
    table: 'completions',
    conflict: 'user_id,kind,ref_id,date',
    fields: { id: 'id', kind: 'kind', refId: 'ref_id', date: 'date', count: 'count', createdAt: 'created_at', updatedAt: 'updated_at' },
    defaults: { count: 0 },
  },
};

const iso = (v) => (v ? new Date(v).toISOString() : v);
const TS = ['createdAt', 'updatedAt', 'deletedAt', 'doneAt'];

function toRow(name, rec, userId) {
  const { fields, defaults } = TABLES[name];
  const row = { user_id: userId };
  for (const [local, remote] of Object.entries(fields)) {
    let v = rec[local];
    if (v === undefined) v = defaults[local] ?? null;
    row[remote] = v;
  }
  return row;
}
function fromRow(name, row) {
  const rec = {};
  for (const [local, remote] of Object.entries(TABLES[name].fields)) {
    let v = row[remote];
    if (TS.includes(local) && v) v = iso(v);
    if (local === 'time' || local === 'reminderTime') v = v ? String(v).slice(0, 5) : null;
    rec[local] = v;
  }
  return rec;
}
const metaToRow = (rec, userId) => ({
  user_id: userId, key: rec.id, value: rec.value ?? null, created_at: rec.createdAt, updated_at: rec.updatedAt,
});
const metaFromRow = (row) => ({ id: row.key, value: row.value, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) });

/* ----------------------------- Сесія ------------------------------- */

let session = null;
const authListeners = new Set();
const statusListeners = new Set();
export const status = { state: 'signed-out', lastSync: null, error: null }; // signed-out | idle | syncing | error | offline

try {
  session = JSON.parse(localStorage.getItem(SESSION_KEY));
} catch {
  session = null;
}
if (session) status.state = 'idle';

function setStatus(patch) {
  Object.assign(status, patch);
  statusListeners.forEach((fn) => fn(status));
}
function saveSession(s) {
  session = s;
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* приватний режим */
  }
}
export const getUser = () => (session ? session.user : null);
export const isSignedIn = () => !!session;
export function onAuthChange(fn) {
  authListeners.add(fn);
  return () => authListeners.delete(fn);
}
export function onStatus(fn) {
  statusListeners.add(fn);
  return () => statusListeners.delete(fn);
}

function normalizeSession(d) {
  return {
    access_token: d.access_token,
    refresh_token: d.refresh_token,
    expires_at: d.expires_at || Math.floor(Date.now() / 1000) + (d.expires_in || 3600),
    user: { id: d.user.id, email: d.user.email },
  };
}

function authError(body, fallback) {
  const m = String(body?.msg || body?.error_description || body?.message || body?.error || fallback);
  if (/invalid login credentials/i.test(m)) return 'Невірна пошта або пароль.';
  if (/already registered|already been registered/i.test(m)) return 'Цей email уже зареєстровано — натисніть «Увійти».';
  if (/email not confirmed/i.test(m)) return 'Пошту ще не підтверджено. Перейдіть за посиланням з листа.';
  if (/password should be at least|weak/i.test(m)) return 'Пароль закороткий: потрібно щонайменше 6 символів.';
  if (/rate limit|too many/i.test(m)) return 'Забагато спроб. Зачекайте хвилину і спробуйте знову.';
  if (/valid email|invalid.*email/i.test(m)) return 'Перевірте адресу пошти.';
  return m;
}

async function authRequest(path, body) {
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('Немає з’єднання з інтернетом.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(authError(data, `Помилка ${res.status}`));
  return data;
}

export async function signIn(email, password) {
  const d = await authRequest('token?grant_type=password', { email, password });
  await onSignedIn(normalizeSession(d));
}

/** Повертає 'signed-in' або 'confirm' (якщо сервер вимагає підтвердити пошту) */
export async function signUp(email, password) {
  const d = await authRequest('signup', { email, password });
  if (d.access_token) {
    await onSignedIn(normalizeSession(d));
    return 'signed-in';
  }
  return 'confirm';
}

export async function resetPassword(email) {
  await authRequest('recover', { email });
}

async function onSignedIn(s) {
  saveSession(s);
  setStatus({ state: 'idle', error: null });
  authListeners.forEach((fn) => fn(getUser()));
  await sync({ first: true });
}

export async function signOut() {
  try {
    if (session) {
      await fetch(`${SUPABASE_URL}/auth/v1/logout?scope=local`, {
        method: 'POST',
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${session.access_token}` },
      });
    }
  } catch {
    /* офлайн — все одно виходимо */
  }
  await unregisterPush({ remote: false });
  saveSession(null);
  setStatus({ state: 'signed-out', lastSync: null, error: null });
  authListeners.forEach((fn) => fn(null));
}

let refreshing = null;
async function ensureFreshToken() {
  if (!session) throw new Error('Не виконано вхід');
  if (session.expires_at - 60 > Date.now() / 1000) return;
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const d = await authRequest('token?grant_type=refresh_token', { refresh_token: session.refresh_token });
        saveSession(normalizeSession(d));
      } catch (e) {
        // токен відкликано → потрібен новий вхід; тимчасова помилка мережі — ні
        if (/invalid|expired|not found|already used/i.test(e.message)) {
          saveSession(null);
          setStatus({ state: 'signed-out' });
          authListeners.forEach((fn) => fn(null));
        }
        throw e;
      } finally {
        refreshing = null;
      }
    })();
  }
  return refreshing;
}

async function api(path, { method = 'GET', body, headers = {} } = {}) {
  await ensureFreshToken();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`${method} ${path.split('?')[0]}: ${res.status} ${t.slice(0, 200)}`);
  }
  return res.status === 204 ? null : res.json().catch(() => null);
}

/* --------------------------- Синхронізація ------------------------- */

let running = null;
let rerun = false;
let lastPullAt = 0;
let pushTimer = null;

async function pullTable(name) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const page = await api(`${TABLES[name].table}?select=*&order=id.asc&limit=${PAGE}&offset=${from}`);
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return rows.map((r) => fromRow(name, r));
}
async function pullMeta() {
  const rows = await api('user_meta?select=*');
  return rows.filter((r) => store.isSyncedMeta(r.key)).map(metaFromRow);
}

async function pull() {
  let changed = 0;
  let remoteCount = 0;
  let remoteSamplesOnly = true;
  const data = {};
  for (const name of Object.keys(TABLES)) {
    data[name] = await pullTable(name);
    remoteCount += data[name].length;
    if (name !== 'completions' && data[name].some((r) => !r.sample && !r.deletedAt)) remoteSamplesOnly = false;
  }
  data.meta = await pullMeta();
  remoteCount += data.meta.length;
  for (const name of [...Object.keys(TABLES), 'meta']) changed += await store.applyRemote(name, data[name]);
  lastPullAt = Date.now();
  return { changed, remoteCount, remoteSamplesOnly };
}

async function push() {
  const batch = await store.takeDirty();
  const total = Object.values(batch).reduce((n, a) => n + a.length, 0);
  if (!total) return 0;
  try {
    const uid = session.user.id;
    for (const name of Object.keys(TABLES)) {
      const recs = batch[name];
      for (let i = 0; i < recs.length; i += 200) {
        await api(`${TABLES[name].table}?on_conflict=${TABLES[name].conflict}`, {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: recs.slice(i, i + 200).map((r) => toRow(name, r, uid)),
        });
      }
    }
    if (batch.meta.length) {
      await api('user_meta?on_conflict=user_id,key', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: batch.meta.map((r) => metaToRow(r, uid)),
      });
    }
  } catch (e) {
    store.requeueDirty(batch);
    throw e;
  }
  return total;
}

/**
 * Повна синхронізація: спершу підтягуємо чуже, потім відправляємо своє.
 * first: перший вхід на цьому пристрої — вся локальна база відправляється на сервер,
 * а приклади (samples) прибираються, якщо в акаунті вже є справжні дані.
 */
export async function sync({ first = false, force = true } = {}) {
  if (!session) return;
  if (!force && Date.now() - lastPullAt < MIN_PULL_GAP_MS) return;
  if (running) {
    rerun = true;
    return running;
  }
  running = (async () => {
    setStatus({ state: 'syncing', error: null });
    try {
      await ensureTimezone();
      if (first) await store.markAllDirty();
      const res = await pull();
      if (first && res.remoteCount && !res.remoteSamplesOnly) await dropLocalSamples();
      await push();
      if (res.changed || first) store.notifyChanged('all');
      setStatus({ state: 'idle', lastSync: Date.now(), error: null });
    } catch (e) {
      console.warn('Синхронізація не вдалася', e);
      setStatus({ state: navigator.onLine === false ? 'offline' : 'error', error: e.message });
    } finally {
      running = null;
      if (rerun) {
        rerun = false;
        sync({ force: true });
      }
    }
  })();
  return running;
}

async function dropLocalSamples() {
  const [tasks, habits] = await Promise.all([store.getTasks(), store.getHabits()]);
  for (const t of tasks.filter((x) => x.sample)) await store.deleteTask(t.id);
  for (const h of habits.filter((x) => x.sample)) await store.deleteHabit(h.id);
}

async function ensureTimezone() {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (!tz) return;
  const s = await store.getSettings();
  if (s.timezone !== tz) await store.saveSettings({ timezone: tz });
}

/** Запустити автосинхронізацію: старт, повернення у вкладку, мережа, зміни. */
export function startAutoSync() {
  if (session) sync({ force: true });
  const soft = () => sync({ force: false });
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && soft());
  window.addEventListener('focus', soft);
  window.addEventListener('online', () => sync({ force: true }));
  setInterval(() => document.visibilityState === 'visible' && soft(), 60_000);
  store.onDirty(() => {
    if (!session) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => sync({ force: true }), 1200);
  });
  if (session) refreshPush();
}

/* ------------------------------ Web Push --------------------------- */

const isoNow = () => new Date().toISOString();

/** Підписує цей пристрій на сповіщення з сервера. Потрібен дозвіл і вхід в акаунт. */
export async function registerPush() {
  if (!session) throw new Error('Спершу увійдіть в акаунт.');
  if (!notif.isSupported() || !('PushManager' in globalThis)) throw new Error('Цей браузер не підтримує пуш-сповіщення.');
  const sub = await notif.subscribeToPush(VAPID_PUBLIC_KEY);
  await api('push_subscriptions?on_conflict=endpoint', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: [{
      user_id: session.user.id,
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
      user_agent: navigator.userAgent.slice(0, 300),
      updated_at: isoNow(),
    }],
  });
  try {
    localStorage.setItem(PUSH_KEY, sub.endpoint);
  } catch {
    /* ігноруємо */
  }
}

export async function unregisterPush({ remote = true } = {}) {
  let endpoint = null;
  try {
    endpoint = localStorage.getItem(PUSH_KEY);
    localStorage.removeItem(PUSH_KEY);
  } catch {
    /* ігноруємо */
  }
  try {
    if (remote && session && endpoint) await api(`push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`, { method: 'DELETE' });
    const reg = await navigator.serviceWorker?.getRegistration();
    const sub = await reg?.pushManager?.getSubscription();
    if (sub) await sub.unsubscribe();
  } catch (e) {
    console.warn('Не вдалося скасувати підписку', e);
  }
}

/** Чи цей пристрій отримує пуші з сервера (тоді локальні системні сповіщення не дублюємо) */
export function pushActive() {
  try {
    return !!session && !!localStorage.getItem(PUSH_KEY) && notif.permissionState() === 'granted';
  } catch {
    return false;
  }
}

/** Підписки можуть «протухати» — раз на запуск перевіряємо й оновлюємо запис на сервері */
async function refreshPush() {
  try {
    if (notif.permissionState() !== 'granted') return;
    const s = await store.getSettings();
    if (s.notificationsEnabled) await registerPush();
  } catch (e) {
    console.warn('Оновлення підписки на пуші не вдалося', e);
  }
}
