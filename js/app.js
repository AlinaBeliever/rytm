// app.js — запуск додатку: маршрути, навігація, анімації переходів, гарячі клавіші,
// нагадування, service worker.
import * as store from './storage.js';
import * as notif from './notifications.js';
import { todayISO, addDays, startOfWeek, snoozeTarget } from './logic.js';
import { state, ui, saveUI } from './state.js';
import { applyTheme } from './theme.js';
import { unlockAudioOnGesture } from './sounds.js';
import { seedSamplesIfFirstRun } from './samples.js';
import { toast } from './ui/components.js';
import {
  renderDay, renderWeek, renderNoDate, openTaskForm, toggleOccurrence, setOccurrenceDone, snoozeOccurrence,
  openReminderSheet, openMissedSheet,
} from './ui/tasks.js';
import { renderHabits, renderHabitStats, renderProgress, openHabitForm } from './ui/habits.js';
import { renderSettings, openIOSGuide } from './ui/settings.js';

const view = document.getElementById('view');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

const ROUTES = {
  today: { render: renderDay, nav: 'today', title: 'Сьогодні', fab: 'task' },
  nodate: { render: renderNoDate, nav: 'today', title: 'Без дати', fab: 'task' },
  week: { render: renderWeek, nav: 'week', title: 'Тиждень', fab: 'task' },
  habits: { render: renderHabits, nav: 'habits', title: 'Звички', fab: 'habit' },
  habit: { render: (root, ctx, id) => renderHabitStats(root, ctx, id), nav: 'habits', title: 'Звичка', fab: null },
  progress: { render: renderProgress, nav: 'progress', title: 'Прогрес', fab: null },
  settings: { render: renderSettings, nav: 'settings', title: 'Налаштування', fab: null },
};

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [name, param] = h.split('/');
  return ROUTES[name] ? { name, param } : { name: 'today', param: null };
}

let renderToken = 0;
let lastRouteKey = '';
let refreshQueued = false;

const ctx = {
  refresh() {
    if (refreshQueued) return;
    refreshQueued = true;
    queueMicrotask(() => {
      refreshQueued = false;
      render();
    });
  },
  navigate(hash) {
    if (location.hash === hash) render();
    else location.hash = hash;
  },
};

async function render() {
  const token = ++renderToken;
  const { name, param } = parseHash();
  const route = ROUTES[name];
  const routeKey = `${name}/${param || ''}`;
  const sameRoute = routeKey === lastRouteKey;

  // запам'ятовуємо позиції й фокус для плавних переходів (FLIP)
  const before = new Map();
  if (sameRoute && !reduceMotion.matches) {
    view.querySelectorAll('[data-flip]').forEach((el) => before.set(el.dataset.flip, el.getBoundingClientRect()));
  }
  const active = document.activeElement;
  const focusHost = active && view.contains(active) ? active.closest('[data-focus-key]') : null;
  const focusKey = focusHost?.dataset.focusKey;
  const focusAction = focusHost && active !== focusHost ? active.dataset.action : null;

  const next = document.createElement('div');
  next.className = `view view-${name}`;
  let mounted;
  try {
    mounted = await route.render(next, ctx, param);
  } catch (e) {
    console.error(e);
    next.innerHTML = `<div class="empty"><p>Щось пішло не так. Спробуйте оновити сторінку.</p></div>`;
  }
  if (token !== renderToken) return; // з'явився новіший рендер

  view.replaceChildren(next);
  lastRouteKey = routeKey;
  if (typeof mounted === 'function') mounted();

  // навігація
  document.querySelectorAll('.nav-link').forEach((a) => {
    const on = a.dataset.nav === route.nav;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  document.title = `${route.title} · Ритм`;
  const fab = document.getElementById('fab');
  fab.hidden = !route.fab;
  fab.setAttribute('aria-label', route.fab === 'habit' ? 'Нова звичка' : 'Нове завдання');

  // відновлення фокусу
  if (focusKey) {
    const host = next.querySelector(`[data-focus-key="${CSS.escape(focusKey)}"]`);
    const target = focusAction ? host?.querySelector(`[data-action="${focusAction}"]`) : host;
    if (target) target.focus({ preventScroll: true });
  } else if (!sameRoute && active === document.body) {
    // нічого
  }

  // FLIP-анімація: елементи плавно переїжджають на нові місця
  if (before.size) {
    next.querySelectorAll('[data-flip]').forEach((el) => {
      const old = before.get(el.dataset.flip);
      const now = el.getBoundingClientRect();
      if (old) {
        const dy = old.top - now.top;
        const dx = old.left - now.left;
        if (Math.abs(dy) > 1 || Math.abs(dx) > 1) {
          el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 300, easing: 'cubic-bezier(.2,.8,.2,1)' });
        }
      } else {
        el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' });
      }
    });
  } else if (!sameRoute && !reduceMotion.matches) {
    next.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 180, easing: 'ease-out' });
  }
  if (!sameRoute) window.scrollTo(0, 0);
}

/* ------------------------------ Події ------------------------------ */

window.addEventListener('hashchange', render);
store.subscribe(() => ctx.refresh());

document.getElementById('fab').addEventListener('click', () => {
  const { name } = parseHash();
  if (ROUTES[name].fab === 'habit') openHabitForm(null);
  else openTaskForm(null, { defaults: defaultsForRoute() });
});

function defaultsForRoute() {
  const { name } = parseHash();
  if (name === 'nodate') return { date: null };
  if (name === 'week') {
    const t = todayISO();
    return { date: state.weekStart <= t && t <= addDays(state.weekStart, 6) ? t : state.weekStart };
  }
  return { date: state.selectedDate };
}

/* -------------------------- Гарячі клавіші ------------------------- */

document.addEventListener('keydown', (e) => {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target;
  if (t.closest && t.closest('input, textarea, select, [contenteditable="true"]')) return;
  if (document.querySelector('dialog[open]')) return;
  const { name } = parseHash();
  const key = e.key;

  if (key === 'n' || key === 'N' || key === 'т' || key === 'Т') {
    e.preventDefault();
    if (name === 'habits') openHabitForm(null);
    else openTaskForm(null, { defaults: defaultsForRoute() });
    return;
  }
  if (key === 'ArrowLeft' || key === 'ArrowRight') {
    if (t.closest && t.closest('.date-strip, .hscroll')) return;
    const d = key === 'ArrowLeft' ? -1 : 1;
    if (name === 'today') state.selectedDate = addDays(state.selectedDate, d);
    else if (name === 'week') state.weekStart = addDays(state.weekStart, 7 * d);
    else if (name === 'habits') {
      const nd = addDays(state.habitDate, d);
      if (nd <= todayISO()) state.habitDate = nd;
    } else return;
    e.preventDefault();
    ctx.refresh();
    return;
  }
  const rows = [...view.querySelectorAll('li.task')];
  const row = t.closest ? t.closest('li.task') : null;
  if (key === ' ' || key === 'Spacebar') {
    if (row && t === row) {
      e.preventDefault();
      row.querySelector('[data-action="toggle"]').click();
    } else if (!row && rows.length && !(t.closest && t.closest('button, a'))) {
      e.preventDefault();
      rows[0].focus();
    }
    return;
  }
  if (key === 'ArrowDown' || key === 'ArrowUp') {
    if (!rows.length) return;
    e.preventDefault();
    const i = row ? rows.indexOf(row) : -1;
    const j = key === 'ArrowDown' ? Math.min(rows.length - 1, i + 1) : Math.max(0, i - 1);
    rows[j].focus();
    return;
  }
  if (key === 'Enter' && row && t === row) {
    e.preventDefault();
    row.querySelector('[data-action="open"]').click();
  }
});

/* --------------------------- Нагадування --------------------------- */

let pendingMissed = [];
let missedOpen = false;

async function showMissed() {
  if (missedOpen || !pendingMissed.length || document.visibilityState !== 'visible') return;
  if (document.querySelector('dialog[open]')) return setTimeout(showMissed, 1500);
  missedOpen = true;
  const list = pendingMissed;
  pendingMissed = [];
  await openMissedSheet(list);
  missedOpen = false;
  showMissed();
}
document.addEventListener('visibilitychange', showMissed);

async function handleAction({ action, taskId, occDate }) {
  if (!taskId) return;
  if (action === 'done') {
    await setOccurrenceDone(taskId, occDate);
    toast('Позначено виконаним');
  } else if (action === 'snooze15') {
    await snoozeOccurrence(taskId, occDate, snoozeTarget('15m', new Date()));
  } else {
    const task = await store.getTask(taskId);
    if (task && occDate) state.selectedDate = task.repeat ? (task.exceptions?.[occDate]?.date || occDate) : task.date || occDate;
    ctx.navigate('#/today');
    openReminderSheet(taskId, occDate);
  }
}

function startReminders() {
  notif.startScheduler({
    onFired(detail) {
      if (detail.data?.kind === 'summary') {
        if (document.visibilityState === 'visible') toast(`${detail.title} ${detail.body}`, { timeout: 7000 });
        return;
      }
      if (detail.data?.kind === 'habit') {
        if (document.visibilityState === 'visible') toast(`${detail.title} — час для звички`, { timeout: 7000 });
        return;
      }
      if (document.visibilityState === 'visible') {
        if (!document.querySelector('dialog[open]')) openReminderSheet(detail.data.taskId, detail.data.occDate);
        else toast(`🔔 ${detail.title}`, { timeout: 7000 });
      } else if (!detail.shown) {
        pendingMissed.push({ id: detail.id, taskId: detail.data.taskId, occDate: detail.data.occDate, date: detail.data.occDate, title: detail.title });
      }
    },
    onMissed(list) {
      pendingMissed.push(...list);
      showMissed();
    },
    onAction: handleAction,
    onTimezoneChange(prev, now) {
      toast(`Часовий пояс змінився (${now}). Нагадування перераховано за місцевим часом.`, { timeout: 7000 });
    },
  });
}

/* ------------------------- Service worker -------------------------- */

async function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('sw.js');
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      nw?.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) {
          toast('Доступна нова версія', { action: 'Оновити', onAction: () => location.reload(), timeout: 10000 });
        }
      });
    });
  } catch (e) {
    console.warn('Service worker не зареєстровано', e);
  }
}

/* ---------------------------- iPhone ------------------------------- */

function iosBanner() {
  const el = document.getElementById('shell-banner');
  if (!notif.isIOS() || notif.isStandalone() || ui.iosHintDismissed) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.innerHTML = `<span>Встановіть «Ритм» на головний екран, щоб отримувати нагадування.</span>
    <button type="button" class="btn btn-sm" data-ios="how">Як?</button>
    <button type="button" class="icon-btn subtle" data-ios="close" aria-label="Закрити підказку">✕</button>`;
  el.onclick = (e) => {
    const b = e.target.closest('[data-ios]');
    if (!b) return;
    if (b.dataset.ios === 'how') openIOSGuide();
    saveUI({ iosHintDismissed: true });
    el.hidden = true;
  };
}

/* ------------------------------ Старт ------------------------------ */

async function boot() {
  applyTheme();
  unlockAudioOnGesture();
  await store.init();
  await seedSamplesIfFirstRun();

  // нова доба — оновити «Сьогодні», якщо додаток відкритий через північ
  let day = todayISO();
  setInterval(() => {
    const t = todayISO();
    if (t !== day) {
      if (state.selectedDate === day) state.selectedDate = t;
      if (state.habitDate === day) state.habitDate = t;
      if (state.weekStart === startOfWeek(day)) state.weekStart = startOfWeek(t);
      day = t;
      ctx.refresh();
    }
  }, 30_000);

  await render();
  iosBanner();
  registerSW();

  // відкриття з натискання на сповіщення (коли вкладки не було)
  const params = new URLSearchParams(location.search);
  if (params.get('task')) {
    const p = { action: params.get('action') || 'open', taskId: params.get('task'), occDate: params.get('occ') };
    history.replaceState(null, '', location.pathname + (location.hash || '#/today'));
    await handleAction(p);
  }
  startReminders();
  document.documentElement.classList.add('ready');
}

boot();
