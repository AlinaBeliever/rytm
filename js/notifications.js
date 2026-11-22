// notifications.js — нагадування без бекенду.
//
// Як це працює зараз: поки додаток відкритий (зокрема у фоновій вкладці чи згорнутий),
// планувальник раз на 20 секунд і при поверненні на вкладку перевіряє, чи не настав час
// якогось нагадування. Якщо настав — показує системне сповіщення через service worker
// (registration.showNotification) і грає звук.
//
// Після входу в акаунт сервер (Supabase Edge Function send-reminders, щохвилини) надсилає
// Web Push і на закритий додаток. Пристрої з активною підпискою не дублюють сповіщення
// локально (див. serverPushOn). Підписка — subscribeToPush() нижче + sync.registerPush().

import * as store from './storage.js';
import {
  reminderEvents, habitReminderEvents, inQuietHours, taskDoneSet, habitCounts, todayISO, occurrencesForDay,
  isHabitScheduled, habitTarget, localDateTime, addDays,
} from './logic.js';
import { playSound } from './sounds.js';

const CHECK_INTERVAL_MS = 20_000;
const LIVE_GRACE_MS = 5 * 60_000; // спізнення до 5 хв — ще «вчасно», більше — «пропущено»
const MAX_LOOKBACK_MS = 7 * 24 * 3600_000;

let handlers = {
  onFired: () => {},
  onMissed: () => {},
  onAction: () => {},
  onTimezoneChange: () => {},
};
let intervalId = null;
let preciseTimer = null;
let checking = false;

export function isSupported() {
  return 'Notification' in globalThis && 'serviceWorker' in navigator;
}
export function permissionState() {
  return 'Notification' in globalThis ? Notification.permission : 'unsupported';
}
/** Точніший стан дозволу: Permissions API (якщо є), інакше Notification.permission */
export async function getPermission() {
  if (!('Notification' in globalThis)) return 'unsupported';
  try {
    if (navigator.permissions && navigator.permissions.query) {
      const st = (await navigator.permissions.query({ name: 'notifications' })).state;
      return st === 'prompt' ? 'default' : st;
    }
  } catch {
    /* деякі браузери не знають 'notifications' у Permissions API */
  }
  return Notification.permission;
}
export function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
export function isStandalone() {
  return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

/** Запит дозволу — викликати ТІЛЬКИ після натискання кнопки користувачем */
export async function requestPermission() {
  if (!('Notification' in globalThis)) return 'unsupported';
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

async function swRegistration() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 3000))]);
  } catch {
    return null;
  }
}

/** Показати системне сповіщення (через service worker, з запасним варіантом) */
export async function showSystemNotification({ title, body, tag, data = {}, actions = [] }) {
  if ((await getPermission()) !== 'granted') return false;
  const options = {
    body,
    tag,
    data,
    icon: 'icons/icon-192.png',
    badge: 'icons/badge-96.png',
    renotify: true,
    actions,
  };
  try {
    const reg = await swRegistration();
    if (reg && reg.showNotification) {
      await reg.showNotification(title, options);
      return true;
    }
  } catch (e) {
    console.warn('showNotification через SW не вдалося', e);
  }
  try {
    delete options.actions; // звичайні Notification не підтримують дії
    new Notification(title, options);
    return true;
  } catch {
    return false;
  }
}

function describe(ev) {
  const { occ, offset } = ev;
  const today = todayISO();
  const dayWord = occ.date === today ? '' : occ.date === addDays(today, 1) ? 'завтра ' : `${occ.date.slice(8)}.${occ.date.slice(5, 7)} `;
  if (!offset) return `Зараз · ${dayWord}${occ.time}`;
  const off = offset >= 1440 ? 'за 1 день' : offset >= 60 ? `за ${offset / 60} год` : `за ${offset} хв`;
  return `Нагадування ${off} · ${dayWord}о ${occ.time}`;
}

/** Цей пристрій підписаний на пуші з сервера — сервер сам надішле сповіщення, дублювати не треба */
function serverPushOn() {
  try {
    return !!localStorage.getItem('rytm.push') && !!localStorage.getItem('rytm.auth') && Notification.permission === 'granted';
  } catch {
    return false;
  }
}

async function fire(ev, settings) {
  const isHabit = !!ev.habit;
  const title = isHabit ? `${ev.habit.emoji || ''} ${ev.habit.name}`.trim() : ev.occ.task.title;
  const body = isHabit ? 'Час для звички' : describe(ev);
  const data = isHabit
    ? { kind: 'habit', habitId: ev.habit.id, date: ev.date, url: './#/habits' }
    : { kind: 'task', taskId: ev.occ.task.id, occDate: ev.occ.occDate, url: `./?task=${ev.occ.task.id}&occ=${ev.occ.occDate}` };
  const actions = isHabit ? [] : [
    { action: 'done', title: 'Виконано' },
    { action: 'snooze15', title: 'Відкласти на 15 хв' },
  ];
  const viaServer = serverPushOn();
  let shown = viaServer;
  if (settings.notificationsEnabled && !viaServer) shown = await showSystemNotification({ title, body, tag: ev.id, data, actions });
  if (!settings.mute) playSound(settings.sound, settings.volume);
  const detail = { id: ev.id, title, body, data, shown, at: ev.at };
  window.dispatchEvent(new CustomEvent('rytm:reminder', { detail }));
  handlers.onFired(detail);
}

/** Головна перевірка: що мало спрацювати з моменту минулої перевірки */
export async function checkReminders() {
  if (checking) return;
  checking = true;
  try {
    const settings = await store.getSettings();
    const now = Date.now();

    // зміна часового поясу (подорожі): час рахується з «місцева дата + час», тому
    // нагадування автоматично переплановуються; просто повідомляємо користувача
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown';
    const prevTz = await store.getMeta('tz');
    if (prevTz !== tz) {
      await store.setMeta('tz', tz);
      if (prevTz) handlers.onTimezoneChange(prevTz, tz);
    }

    let last = await store.getMeta('lastReminderCheck');
    if (!last || last > now) last = now - 60_000;
    if (now - last > MAX_LOOKBACK_MS) last = now - MAX_LOOKBACK_MS;

    const [tasks, completions, habits] = await Promise.all([store.getTasks(), store.getCompletions(), store.getHabits()]);
    const doneSet = taskDoneSet(completions);
    const counts = habitCounts(completions);
    const log = (await store.getMeta('reminderLog')) || {};
    const missed = [];

    for (const ev of reminderEvents(tasks, doneSet, last, now)) {
      if (log[ev.id]) continue;
      log[ev.id] = now;
      const live = now - ev.at <= LIVE_GRACE_MS;
      const quiet = inQuietHours(new Date(ev.at), settings.quietHours);
      if (live && !quiet) await fire(ev, settings);
      else missed.push({ id: ev.id, taskId: ev.occ.task.id, occDate: ev.occ.occDate, date: ev.occ.date, time: ev.occ.time, title: ev.occ.task.title });
    }
    for (const ev of habitReminderEvents(habits, counts, last, now)) {
      if (log[ev.id]) continue;
      log[ev.id] = now;
      if (now - ev.at <= LIVE_GRACE_MS && !inQuietHours(new Date(ev.at), settings.quietHours)) await fire(ev, settings);
    }

    // ранкове зведення
    const ms = settings.morningSummary;
    if (ms?.enabled && ms.time) {
      const today = todayISO(new Date(now));
      const at = localDateTime(today, ms.time).getTime();
      const key = `summary|${today}`;
      if (!log[key] && at > last && at <= now) {
        log[key] = now;
        if (now - at <= LIVE_GRACE_MS && !inQuietHours(new Date(at), settings.quietHours)) {
          const nTasks = occurrencesForDay(tasks, doneSet, today).filter((o) => !o.done).length;
          const nHabits = habits.filter((h) => !h.archived && isHabitScheduled(h, today) && (counts.get(h.id)?.get(today) || 0) < habitTarget(h)).length;
          const body = `Сьогодні ${nTasks} ${plural(nTasks, 'завдання', 'завдання', 'завдань')} і ${nHabits} ${plural(nHabits, 'звичка', 'звички', 'звичок')}`;
          if (settings.notificationsEnabled && !serverPushOn()) await showSystemNotification({ title: 'Доброго ранку!', body, tag: key, data: { kind: 'summary', url: './#/today' } });
          if (!settings.mute) playSound(settings.sound, settings.volume);
          window.dispatchEvent(new CustomEvent('rytm:reminder', { detail: { id: key, title: 'Доброго ранку!', body, data: { kind: 'summary' } } }));
          handlers.onFired({ id: key, title: 'Доброго ранку!', body, data: { kind: 'summary' } });
        }
      }
    }

    // чистимо журнал від записів, старших за 14 днів
    const cutoff = now - 14 * 24 * 3600_000;
    for (const k of Object.keys(log)) if (log[k] < cutoff) delete log[k];
    await store.setMeta('reminderLog', log);
    await store.setMeta('lastReminderCheck', now);

    if (missed.length) handlers.onMissed(missed);
    scheduleNextPrecise(tasks, doneSet, now);
  } catch (e) {
    console.error('Помилка перевірки нагадувань', e);
  } finally {
    checking = false;
  }
}

/** Точний таймер на найближче нагадування в межах інтервалу (щоб не запізнюватись на 20 с) */
function scheduleNextPrecise(tasks, doneSet, now) {
  clearTimeout(preciseTimer);
  const next = reminderEvents(tasks, doneSet, now, now + CHECK_INTERVAL_MS)[0];
  if (next) preciseTimer = setTimeout(checkReminders, Math.max(0, next.at - Date.now()) + 50);
}

function plural(n, one, few, many) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

/** Запуск планувальника. Викликається один раз після старту додатку. */
export function startScheduler(h = {}) {
  handlers = { ...handlers, ...h };
  if (intervalId) clearInterval(intervalId);
  intervalId = setInterval(checkReminders, CHECK_INTERVAL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkReminders();
  });
  window.addEventListener('focus', () => checkReminders());
  store.subscribe((what) => {
    if (what === 'tasks' || what === 'all') checkReminders();
  });
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'notification-action') handlers.onAction(e.data);
    });
  }
  return checkReminders();
}

/* ------------------------------- Web Push -------------------------------- */

function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/**
 * Підписка на Web Push. Повертає об'єкт підписки (endpoint + ключі), який треба
 * зберегти на сервері (таблиця push_subscriptions у Supabase).
 * vapidPublicKey — публічний VAPID-ключ сервера.
 */
export async function subscribeToPush(vapidPublicKey) {
  const reg = await swRegistration();
  if (!reg || !reg.pushManager) throw new Error('Push не підтримується');
  const existing = await reg.pushManager.getSubscription();
  const sub = existing || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) }));
  return sub.toJSON();
}
