// storage.js — ЄДИНЕ місце, яке знає, де лежать дані.
// Це IndexedDB у браузері (працює без інтернету). Файл sync.js дзеркалить зміни
// у Supabase і підтягує зміни з інших пристроїв.
//
// Кожен запис має: id (UUID), createdAt, updatedAt (ISO-рядки).
// Видалення «м'яке» (deletedAt) — так синхронізація зможе передати видалення на інші пристрої.

import { uuid } from './logic.js';

export const SCHEMA_VERSION = 1;
const DB_NAME = 'rytm';
const DB_VERSION = 1;
const STORES = ['tasks', 'habits', 'completions', 'meta'];

export const DEFAULT_SETTINGS = {
  notificationsEnabled: false,
  sound: 'bell',
  volume: 0.7,
  mute: false,
  quietHours: { enabled: true, from: '23:00', to: '08:00' },
  defaultReminder: 10, // хвилин до; 0 — у момент; null — без нагадування
  morningSummary: { enabled: false, time: '08:00' },
  timezone: null, // сервер рахує нагадування за цим поясом; ставиться автоматично
};

let dbPromise = null;
let memoryFallback = null; // якщо IndexedDB недоступна (дуже рідко) — дані живуть до перезавантаження
const listeners = new Set();
let channel = null;

const nowISO = () => new Date().toISOString();

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (!('indexedDB' in globalThis)) {
      memoryFallback = Object.fromEntries(STORES.map((s) => [s, new Map()]));
      resolve(null);
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('tasks')) db.createObjectStore('tasks', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('habits')) db.createObjectStore('habits', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('completions')) {
        const s = db.createObjectStore('completions', { keyPath: 'id' });
        s.createIndex('byRef', ['kind', 'refId', 'date'], { unique: true });
      }
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      console.warn('IndexedDB недоступна, дані зберігаються тимчасово', req.error);
      memoryFallback = Object.fromEntries(STORES.map((s) => [s, new Map()]));
      resolve(null);
    };
  });
  return dbPromise;
}

function reqP(req) {
  return new Promise((res, rej) => {
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

async function all(store) {
  const db = await openDB();
  if (!db) return [...memoryFallback[store].values()].map(clone);
  return reqP(db.transaction(store).objectStore(store).getAll());
}
async function get(store, id) {
  const db = await openDB();
  if (!db) return clone(memoryFallback[store].get(id));
  return reqP(db.transaction(store).objectStore(store).get(id));
}
async function put(store, value) {
  const db = await openDB();
  if (!db) {
    memoryFallback[store].set(value.id, clone(value));
    return value;
  }
  await reqP(db.transaction(store, 'readwrite').objectStore(store).put(value));
  return value;
}
async function putMany(store, values) {
  const db = await openDB();
  if (!db) {
    values.forEach((v) => memoryFallback[store].set(v.id, clone(v)));
    return;
  }
  const tx = db.transaction(store, 'readwrite');
  const os = tx.objectStore(store);
  values.forEach((v) => os.put(v));
  await new Promise((res, rej) => {
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
  });
}
async function clearStore(store) {
  const db = await openDB();
  if (!db) return memoryFallback[store].clear();
  await reqP(db.transaction(store, 'readwrite').objectStore(store).clear());
}
function clone(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}

/* --------------- Відстеження змін для синхронізації ---------------- */
// Список id записів, які ще не відправлені на сервер. Лежить у localStorage,
// щоб пережити перезавантаження й роботу офлайн.
const DIRTY_KEY = 'rytm.dirty';
const dirtyListeners = new Set();
export const isSyncedMeta = (id) => id === 'settings' || String(id).startsWith('order:');

function readDirty() {
  try {
    return JSON.parse(localStorage.getItem(DIRTY_KEY)) || {};
  } catch {
    return {};
  }
}
function writeDirty(d) {
  try {
    localStorage.setItem(DIRTY_KEY, JSON.stringify(d));
  } catch {
    /* приватний режим */
  }
}
function markDirty(storeName, ids) {
  if (storeName === 'meta') ids = ids.filter(isSyncedMeta);
  if (!ids.length) return;
  const d = readDirty();
  const set = new Set(d[storeName] || []);
  ids.forEach((i) => set.add(i));
  d[storeName] = [...set];
  writeDirty(d);
  dirtyListeners.forEach((fn) => fn());
}
export function onDirty(fn) {
  dirtyListeners.add(fn);
  return () => dirtyListeners.delete(fn);
}
/** Забирає (і очищає) список змінених записів: {tasks:[rec], habits:[rec], ...} */
export async function takeDirty() {
  const d = readDirty();
  writeDirty({});
  const out = {};
  for (const s of STORES) {
    const recs = [];
    for (const id of d[s] || []) {
      const r = await get(s, id);
      if (r) recs.push(r);
    }
    out[s] = recs;
  }
  return out;
}
/** Повертає записи назад у чергу (якщо відправка не вдалася) */
export function requeueDirty(batch) {
  for (const s of STORES) markDirty(s, (batch[s] || []).map((r) => r.id));
}
export function markAllDirty() {
  return Promise.all(STORES.map(async (s) => markDirty(s, (await all(s)).map((r) => r.id))));
}

/** Запис з позначкою «потрібно синхронізувати» */
async function putTracked(storeName, rec) {
  await put(storeName, rec);
  markDirty(storeName, [rec.id]);
  return rec;
}

/* --------------- Застосування даних із сервера (без позначки) ------- */

export const rawAll = (s) => all(s);

/**
 * Зливає записи з сервера: перемагає новіший updatedAt. Для completions унікальність
 * (kind, refId, date) важливіша за id — якщо id різні, лишається id із сервера.
 * Повертає кількість змінених записів.
 */
export async function applyRemote(storeName, incoming) {
  if (!incoming.length) return 0;
  const current = await all(storeName);
  const byId = new Map(current.map((r) => [r.id, r]));
  const byRef = storeName === 'completions' ? new Map(current.map((c) => [`${c.kind}|${c.refId}|${c.date}`, c])) : null;
  const toWrite = [];
  const toDelete = [];
  for (const r of incoming) {
    let cur = byId.get(r.id);
    if (byRef) {
      const same = byRef.get(`${r.kind}|${r.refId}|${r.date}`);
      if (same && (!cur || same.id !== cur.id)) cur = same;
    }
    if (cur && String(r.updatedAt) <= String(cur.updatedAt)) continue;
    if (cur && cur.id !== r.id) toDelete.push(cur.id);
    toWrite.push(r);
  }
  if (!toWrite.length) return 0;
  const db = await openDB();
  if (!db) {
    toDelete.forEach((id) => memoryFallback[storeName].delete(id));
  } else if (toDelete.length) {
    const tx = db.transaction(storeName, 'readwrite');
    toDelete.forEach((id) => tx.objectStore(storeName).delete(id));
    await new Promise((res, rej) => {
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });
  }
  await putMany(storeName, toWrite);
  return toWrite.length;
}
export function notifyChanged(what = 'all') {
  emit(what);
}

function stamp(rec) {
  const t = nowISO();
  return { ...rec, id: rec.id || uuid(), createdAt: rec.createdAt || t, updatedAt: t };
}

/* ------------------------- Підписки на зміни ------------------------ */

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit(what, fromOtherTab = false) {
  listeners.forEach((fn) => {
    try {
      fn(what);
    } catch (e) {
      console.error(e);
    }
  });
  if (!fromOtherTab && channel) channel.postMessage({ what });
}

export async function init() {
  await openDB();
  if ('BroadcastChannel' in globalThis && !channel) {
    channel = new BroadcastChannel('rytm-data');
    channel.onmessage = (e) => emit(e.data?.what || 'all', true);
  }
}

/* ------------------------------ Завдання ---------------------------- */

export async function getTasks({ includeDeleted = false } = {}) {
  const list = await all('tasks');
  return includeDeleted ? list : list.filter((t) => !t.deletedAt);
}
export async function getTask(id) {
  const t = await get('tasks', id);
  return t && !t.deletedAt ? t : null;
}
export async function saveTask(task) {
  const rec = stamp({
    title: '',
    note: '',
    date: null,
    time: null,
    weekOf: null,
    priority: 2,
    repeat: null,
    reminders: [],
    done: false,
    doneAt: null,
    exceptions: {},
    ...task,
  });
  await putTracked('tasks', rec);
  emit('tasks');
  return rec;
}
export async function deleteTask(id) {
  const t = await get('tasks', id);
  if (!t) return;
  await putTracked('tasks', { ...t, deletedAt: nowISO(), updatedAt: nowISO() });
  emit('tasks');
}

/* ------------------------------ Звички ------------------------------ */

export async function getHabits({ includeDeleted = false } = {}) {
  const list = await all('habits');
  const res = includeDeleted ? list : list.filter((h) => !h.deletedAt);
  return res.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.createdAt).localeCompare(String(b.createdAt)));
}
export async function getHabit(id) {
  const h = await get('habits', id);
  return h && !h.deletedAt ? h : null;
}
export async function saveHabit(habit) {
  const rec = stamp({
    name: '',
    emoji: '✅',
    color: '#2f7d6d',
    freq: { type: 'daily' },
    goal: { type: 'bool' },
    reminderTime: null,
    startDate: null,
    endDate: null,
    dayMarks: {},
    archived: false,
    ...habit,
  });
  await putTracked('habits', rec);
  emit('habits');
  return rec;
}
export async function deleteHabit(id) {
  const h = await get('habits', id);
  if (!h) return;
  await putTracked('habits', { ...h, deletedAt: nowISO(), updatedAt: nowISO() });
  emit('habits');
}

/* ------------------------------ Виконання --------------------------- */
// Запис виконання: {id, kind:'task'|'habit', refId, date:'YYYY-MM-DD', count, createdAt, updatedAt}
// count = 0 означає «знято» (запис лишається для синхронізації).

export async function getCompletions({ kind = null, refId = null, from = null, to = null } = {}) {
  const list = await all('completions');
  return list.filter(
    (c) =>
      c.count > 0 &&
      (!kind || c.kind === kind) &&
      (!refId || c.refId === refId) &&
      (!from || c.date >= from) &&
      (!to || c.date <= to)
  );
}

async function findCompletion(kind, refId, date) {
  const db = await openDB();
  if (!db) return [...memoryFallback.completions.values()].find((c) => c.kind === kind && c.refId === refId && c.date === date);
  return reqP(db.transaction('completions').objectStore('completions').index('byRef').get([kind, refId, date]));
}

export async function setCompletion(kind, refId, date, count) {
  const existing = await findCompletion(kind, refId, date);
  const rec = stamp({ ...(existing || { kind, refId, date }), count: Math.max(0, count) });
  await putTracked('completions', rec);
  emit('completions');
  return rec.count;
}
/** Перемикає так/ні. Повертає новий count (0 або 1). */
export async function toggleCompletion(kind, refId, date) {
  const existing = await findCompletion(kind, refId, date);
  return setCompletion(kind, refId, date, existing && existing.count > 0 ? 0 : 1);
}
export async function incrementCompletion(kind, refId, date, delta = 1) {
  const existing = await findCompletion(kind, refId, date);
  return setCompletion(kind, refId, date, (existing?.count || 0) + delta);
}

/* ---------------------- Налаштування й службові дані ---------------- */

export async function getSettings() {
  const rec = await get('meta', 'settings');
  const v = rec?.value || {};
  return {
    ...DEFAULT_SETTINGS,
    ...v,
    quietHours: { ...DEFAULT_SETTINGS.quietHours, ...(v.quietHours || {}) },
    morningSummary: { ...DEFAULT_SETTINGS.morningSummary, ...(v.morningSummary || {}) },
  };
}
export async function saveSettings(patch) {
  const cur = await getSettings();
  const value = { ...cur, ...patch };
  const rec = await get('meta', 'settings');
  await putTracked('meta', stamp({ ...(rec || {}), id: 'settings', value }));
  emit('settings');
  return value;
}
export async function getMeta(key, fallback = null) {
  const rec = await get('meta', key);
  return rec ? rec.value : fallback;
}
export async function setMeta(key, value, { silent = true } = {}) {
  const rec = await get('meta', key);
  await putTracked('meta', stamp({ ...(rec || {}), id: key, value }));
  if (!silent) emit('meta');
}

/* --------------------------- Експорт / імпорт ----------------------- */

export async function exportAll() {
  const [tasks, habits, completions, meta] = await Promise.all(STORES.map((s) => all(s)));
  return {
    app: 'rytm',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: nowISO(),
    data: {
      tasks,
      habits,
      completions,
      meta: meta.filter((m) => !['reminderLog', 'lastReminderCheck'].includes(m.id)),
    },
  };
}

/** Перевіряє файл перед імпортом. Повертає {ok, errors[], summary} */
export function validateImport(obj) {
  const errors = [];
  if (!obj || typeof obj !== 'object') return { ok: false, errors: ['Файл не містить даних JSON.'] };
  if (obj.app !== 'rytm') errors.push('Це не файл резервної копії цього додатку.');
  if (typeof obj.schemaVersion !== 'number') errors.push('Немає номера версії схеми.');
  else if (obj.schemaVersion > SCHEMA_VERSION)
    errors.push(`Файл створено новішою версією додатку (схема ${obj.schemaVersion}). Оновіть додаток.`);
  const d = obj.data;
  if (!d || typeof d !== 'object') errors.push('Немає розділу data.');
  const summary = {};
  if (d) {
    const checks = {
      tasks: (r) => typeof r.title === 'string',
      habits: (r) => typeof r.name === 'string',
      completions: (r) =>
        ['task', 'habit'].includes(r.kind) && typeof r.refId === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.date) && typeof r.count === 'number',
      meta: () => true,
    };
    for (const s of STORES) {
      const arr = d[s] ?? [];
      if (!Array.isArray(arr)) {
        errors.push(`Розділ «${s}» має бути списком.`);
        continue;
      }
      const bad = arr.filter((r) => !r || typeof r.id !== 'string' || !checks[s](r)).length;
      if (bad) errors.push(`У розділі «${s}» ${bad} пошкоджених записів.`);
      summary[s] = arr.filter((r) => r && !r.deletedAt && (s !== 'completions' || r.count > 0)).length;
    }
  }
  return { ok: errors.length === 0, errors, summary };
}

/**
 * Імпорт. mode: 'merge' — об'єднати (з двох версій запису перемагає новіша за updatedAt);
 *               'replace' — повністю замінити поточні дані.
 */
export async function importAll(obj, { mode = 'merge' } = {}) {
  const v = validateImport(obj);
  if (!v.ok) throw new Error(v.errors.join(' '));
  for (const s of STORES) {
    const incoming = obj.data[s] || [];
    if (mode === 'replace') {
      await clearStore(s);
      await putMany(s, incoming);
      markDirty(s, incoming.map((r) => r.id));
      continue;
    }
    const current = new Map((await all(s)).map((r) => [r.id, r]));
    let toWrite = incoming.filter((r) => {
      const cur = current.get(r.id);
      return !cur || String(r.updatedAt || '') > String(cur.updatedAt || '');
    });
    if (s === 'completions') {
      // унікальність (kind, refId, date): замінюємо існуючий запис з іншим id
      const byRef = new Map([...current.values()].map((c) => [`${c.kind}|${c.refId}|${c.date}`, c]));
      toWrite = toWrite
        .map((r) => {
          const cur = byRef.get(`${r.kind}|${r.refId}|${r.date}`);
          if (cur && cur.id !== r.id) return String(r.updatedAt) > String(cur.updatedAt) ? { ...r, id: cur.id } : null;
          return r;
        })
        .filter(Boolean);
    }
    await putMany(s, toWrite);
    markDirty(s, toWrite.map((r) => r.id));
  }
  emit('all');
  return v.summary;
}

export async function clearAll() {
  for (const s of STORES) await clearStore(s);
  emit('all');
}
