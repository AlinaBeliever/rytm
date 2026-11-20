// Екрани завдань: День (Сьогодні), Тиждень, Без дати. Форма завдання. Дії над завданнями.
import * as store from '../storage.js';
import {
  todayISO, addDays, startOfWeek, weekday, occurrencesForDay, overdueItems, sortOpen, taskDoneSet,
  applySnooze, moveOccurrence, parseQuickAdd, occKey, localDateTime,
} from '../logic.js';
import { icon } from './icons.js';
import {
  esc, openModal, confirmDialog, snoozePicker, toast, weekdayShort, dayMonth, shortDM, prettyDate,
  relativeDayLabel, WEEKDAYS_SHORT, plural, cap,
} from './components.js';
import { state, ui, saveUI } from '../state.js';
import { enableDrag } from './drag.js';

export const PRIORITIES = [
  { v: 1, label: 'Високий', cls: 'p1' },
  { v: 2, label: 'Середній', cls: 'p2' },
  { v: 3, label: 'Низький', cls: 'p3' },
];
const REMINDER_OPTIONS = [
  { v: 0, label: 'У момент' },
  { v: 5, label: 'За 5 хв' },
  { v: 10, label: 'За 10 хв' },
  { v: 30, label: 'За 30 хв' },
  { v: 60, label: 'За 1 год' },
  { v: 1440, label: 'За 1 день' },
];
const REPEAT_LABEL = { daily: 'щодня', weekdays: 'по буднях', weekly: 'щотижня', monthly: 'щомісяця' };

/* ------------------------------ Дані ------------------------------- */

async function loadTaskData() {
  const [tasks, completions] = await Promise.all([store.getTasks(), store.getCompletions({ kind: 'task' })]);
  return { tasks, doneSet: taskDoneSet(completions) };
}

/* ---------------------------- Дії ---------------------------------- */

export async function toggleOccurrence(taskId, occDate) {
  const task = await store.getTask(taskId);
  if (!task) return;
  if (task.repeat) {
    await store.toggleCompletion('task', task.id, occDate);
  } else {
    const done = !task.done;
    await store.saveTask({ ...task, done, doneAt: done ? new Date().toISOString() : null });
  }
}

export async function setOccurrenceDone(taskId, occDate) {
  const task = await store.getTask(taskId);
  if (!task) return;
  if (task.repeat) await store.setCompletion('task', task.id, occDate, 1);
  else if (!task.done) await store.saveTask({ ...task, done: true, doneAt: new Date().toISOString() });
}

export async function snoozeOccurrence(taskId, occDate, target) {
  const task = await store.getTask(taskId);
  if (!task) return;
  await store.saveTask(applySnooze(task, occDate, target));
  const when = target.date === todayISO() ? target.time : `${shortDM(target.date)}, ${target.time}`;
  toast(`Відкладено на ${when}`);
}

export async function askSnooze(taskId, occDate) {
  const target = await snoozePicker();
  if (target) await snoozeOccurrence(taskId, occDate, target);
}

async function moveToToday(keys) {
  const today = todayISO();
  for (const k of keys) {
    const [id, occDate] = k.split('|');
    const t = await store.getTask(id);
    if (t) await store.saveTask(moveOccurrence(t, occDate, today));
  }
  toast(keys.length > 1 ? `Перенесено на сьогодні: ${keys.length}` : 'Перенесено на сьогодні');
}

/* ------------------------------ Рядок ------------------------------ */

function taskRow(occ, { showDate = false, overdue = false, draggable = true } = {}) {
  const t = occ.task;
  const pr = PRIORITIES.find((p) => p.v === (t.priority || 2)) || PRIORITIES[1];
  const meta = [];
  if (showDate && occ.date) meta.push(`<span class="${overdue ? 'warn' : ''}">${esc(shortDM(occ.date))}</span>`);
  if (occ.time) meta.push(`<span class="meta-time">${esc(occ.time)}</span>`);
  if (t.repeat) meta.push(`<span title="Повторюється">${icon('repeat', 'ic-xs')}${esc(REPEAT_LABEL[t.repeat.type] || '')}</span>`);
  if (occ.time && (occ.snoozed || (t.reminders || []).length)) meta.push(`<span title="Нагадування" aria-label="з нагадуванням">${icon('bell', 'ic-xs')}</span>`);
  if (occ.snoozed) meta.push('<span class="muted">відкладено</span>');
  if (t.note) meta.push(`<span title="Є нотатка" aria-label="з нотаткою">${icon('note', 'ic-xs')}</span>`);
  if (t.sample) meta.push('<span class="tag">приклад</span>');
  const title = esc(t.title);
  return `<li class="task ${occ.done ? 'is-done' : ''}" data-flip="${esc(occ.key)}" data-key="${esc(occ.key)}"
      data-focus-key="task:${esc(occ.key)}" tabindex="0" ${draggable && !occ.done ? 'data-draggable' : ''}
      aria-label="${title}${occ.time ? ', ' + occ.time : ''}${occ.done ? ', виконано' : ''}">
    <button type="button" class="check ${pr.cls}" data-action="toggle" aria-pressed="${occ.done}"
      aria-label="${occ.done ? 'Повернути у невиконані' : 'Відмітити виконаним'}: ${title}" title="Пріоритет: ${pr.label}">
      <span class="box">${icon('check')}</span></button>
    <button type="button" class="task-main" data-action="open" aria-label="Відкрити: ${title}">
      <span class="task-title">${title}</span>
      ${meta.length ? `<span class="task-meta">${meta.join('')}</span>` : ''}
    </button>
    ${overdue ? `<button type="button" class="btn btn-sm" data-action="move-today">На сьогодні</button>` : ''}
    ${!occ.done && !overdue ? `<button type="button" class="icon-btn subtle" data-action="snooze" aria-label="Відкласти: ${title}" title="Відкласти">${icon('snooze')}</button>` : ''}
  </li>`;
}

function doneBlock(items, listId) {
  if (!items.length) return '';
  const collapsed = ui.doneCollapsed;
  return `<section class="done-block ${collapsed ? 'collapsed' : ''}" data-flip="done-${listId}">
    <button type="button" class="done-head" data-action="toggle-done-block" aria-expanded="${!collapsed}" aria-controls="done-${listId}">
      ${icon('down', 'chev')}<span>Виконано</span><span class="count">${items.length}</span></button>
    <ul class="task-list done-list" id="done-${listId}" ${collapsed ? 'hidden' : ''}>${items.map((o) => taskRow(o, { draggable: false })).join('')}</ul>
  </section>`;
}

function sampleBanner(tasks) {
  if (!tasks.some((t) => t.sample)) return '';
  return `<div class="banner" data-flip="samples"><span>Це приклади, щоб було з чого почати.</span>
    <button type="button" class="btn btn-sm" data-action="delete-samples">Видалити приклади</button></div>`;
}

export async function deleteSamples() {
  const [tasks, habits] = await Promise.all([store.getTasks(), store.getHabits()]);
  for (const t of tasks.filter((x) => x.sample)) await store.deleteTask(t.id);
  for (const h of habits.filter((x) => x.sample)) await store.deleteHabit(h.id);
  toast('Приклади видалено');
}

function tabs(active) {
  const t = (id, href, label) =>
    `<a href="${href}" class="seg ${active === id ? 'active' : ''}" ${active === id ? 'aria-current="page"' : ''}>${label}</a>`;
  return `<nav class="segmented" aria-label="Розділи завдань">${t('today', '#/today', 'Сьогодні')}${t('week', '#/week', 'Тиждень')}${t('nodate', '#/nodate', 'Без дати')}</nav>`;
}

function quickAdd(placeholder) {
  return `<form class="quick-add" data-action="quick-add" autocomplete="off">
    <label class="sr-only" for="quick-input">Нове завдання</label>
    <input id="quick-input" name="title" type="text" placeholder="${esc(placeholder)}" maxlength="200" enterkeyhint="done">
    <button type="submit" class="btn btn-primary">${icon('plus')}<span>Додати</span></button>
  </form>`;
}

/* ------------------------------ День ------------------------------- */

export async function renderDay(root, ctx) {
  const today = todayISO();
  const sel = state.selectedDate;
  const { tasks, doneSet } = await loadTaskData();
  const occ = occurrencesForDay(tasks, doneSet, sel);
  const order = (await store.getMeta('order:day:' + sel)) || [];
  const open = sortOpen(occ.filter((o) => !o.done), order);
  const done = occ.filter((o) => o.done).sort((a, b) => String(b.task.doneAt || '').localeCompare(String(a.task.doneAt || '')));
  const overdue = sel === today ? overdueItems(tasks, doneSet, today) : [];

  // стрічка дат: 6 тижнів навколо вибраного дня
  const stripStart = addDays(startOfWeek(sel), -14);
  const stripDays = Array.from({ length: 42 }, (_, i) => addDays(stripStart, i));
  const busy = new Set(stripDays.filter((d) => occurrencesForDay(tasks, doneSet, d).some((o) => !o.done)));

  root.innerHTML = `
    <header class="view-head">${tabs('today')}</header>
    <section class="day-nav" aria-label="Вибір дня">
      <button type="button" class="icon-btn" data-action="day-prev" aria-label="Попередній день">${icon('left')}</button>
      <div class="date-strip" role="group" aria-label="Дні">
        ${stripDays
          .map(
            (d) => `<button type="button" class="date-chip ${d === sel ? 'selected' : ''} ${d === today ? 'is-today' : ''} ${weekday(d) === 1 ? 'week-start' : ''}"
              data-action="pick-day" data-date="${d}" aria-pressed="${d === sel}" aria-label="${esc(prettyDate(d, today))}">
              <span class="dc-wd">${esc(weekdayShort(d))}</span><span class="dc-n">${Number(d.slice(8))}</span>
              <span class="dc-dot ${busy.has(d) ? 'on' : ''}"></span></button>`
          )
          .join('')}
      </div>
      <button type="button" class="icon-btn" data-action="day-next" aria-label="Наступний день">${icon('right')}</button>
      <button type="button" class="btn btn-sm today-btn" data-action="go-today" ${sel === today ? 'disabled' : ''}>Сьогодні</button>
    </section>
    <h1 class="day-title">${esc(relativeDayLabel(sel, today))}<span class="muted">, ${esc(dayMonth(sel))}</span></h1>
    ${quickAdd(sel === today ? 'Нове завдання на сьогодні… (можна з часом: 15:30)' : `Нове завдання на ${dayMonth(sel)}…`)}
    ${sampleBanner(tasks)}
    ${
      overdue.length
        ? `<section class="overdue-block" data-flip="overdue" aria-labelledby="overdue-h">
        <div class="block-head"><h2 id="overdue-h" class="block-title warn">Прострочено <span class="count">${overdue.length}</span></h2>
          ${overdue.length > 1 ? `<button type="button" class="btn btn-sm" data-action="move-all-today">Перенести всі на сьогодні</button>` : ''}</div>
        <ul class="task-list">${overdue.map((o) => taskRow(o, { showDate: true, overdue: true, draggable: false })).join('')}</ul>
      </section>`
        : ''
    }
    <ul class="task-list open-list" data-list="day:${sel}" aria-label="Невиконані завдання">${open.map((o) => taskRow(o)).join('')}</ul>
    ${
      !open.length
        ? `<div class="empty" data-flip="empty">${done.length ? '<p><strong>Усе виконано!</strong></p><p class="muted">Чудовий день.</p>' : `<p class="muted">На цей день завдань немає.</p>`}
           <button type="button" class="btn" data-action="new-task">${icon('plus')} Додати завдання</button></div>`
        : ''
    }
    ${doneBlock(done, 'day')}
  `;

  bindTaskList(root, ctx, { defaults: { date: sel } });
  root.querySelectorAll('[data-list]').forEach((ul) =>
    enableDrag(ul, async (keys) => {
      await store.setMeta('order:' + ul.dataset.list, keys);
      ctx.refresh();
    })
  );
  // після вставки в сторінку: прокручуємо стрічку так, щоб вибраний день був по центру
  return () => {
    const strip = root.querySelector('.date-strip');
    const chip = strip?.querySelector('.selected');
    if (chip) strip.scrollLeft = chip.offsetLeft - strip.clientWidth / 2 + chip.clientWidth / 2;
  };
}

/* ----------------------------- Тиждень ----------------------------- */

export async function renderWeek(root, ctx) {
  const today = todayISO();
  const ws = state.weekStart;
  const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
  const { tasks, doneSet } = await loadTaskData();
  const weekTasks = tasks.filter((t) => !t.date && t.weekOf === ws && !t.repeat);
  const wOrder = (await store.getMeta('order:week:' + ws)) || [];
  const wOcc = weekTasks.map((t) => ({ key: occKey(t.id, 'w' + ws), task: t, occDate: null, date: null, time: null, done: !!t.done, recurring: false }));
  const wOpen = sortOpen(wOcc.filter((o) => !o.done), wOrder);
  const wDone = wOcc.filter((o) => o.done);

  const blocks = [];
  for (const d of days) {
    const occ = occurrencesForDay(tasks, doneSet, d);
    const order = (await store.getMeta('order:day:' + d)) || [];
    const open = sortOpen(occ.filter((o) => !o.done), order);
    const done = occ.filter((o) => o.done);
    const collapsed = state.weekCollapsed[d] ?? (d < today);
    blocks.push(`<section class="week-day ${d === today ? 'is-today' : ''} ${collapsed ? 'collapsed' : ''}" data-date="${d}">
      <div class="week-day-head">
        <button type="button" class="wd-toggle" data-action="toggle-weekday" data-date="${d}" aria-expanded="${!collapsed}">
          ${icon('down', 'chev')}<span class="wd-name">${esc(cap(weekdayShort(d)))}</span><span class="wd-date">${esc(shortDM(d))}</span>
          <span class="count" aria-label="${open.length} невиконаних">${open.length || ''}</span></button>
        <a class="wd-open" href="#/today" data-action="open-day" data-date="${d}" aria-label="Відкрити день ${esc(dayMonth(d))}">${icon('right')}</a>
      </div>
      <div class="week-day-body">
        <ul class="task-list compact" data-list="day:${d}">${open.map((o) => taskRow(o)).join('')}</ul>
        ${done.length ? `<ul class="task-list compact done-list">${done.map((o) => taskRow(o, { draggable: false })).join('')}</ul>` : ''}
        <button type="button" class="add-inline" data-action="new-task" data-date="${d}">${icon('plus', 'ic-sm')} Додати</button>
      </div>
    </section>`);
  }
  const end = addDays(ws, 6);
  const isThis = ws === startOfWeek(today);
  root.innerHTML = `
    <header class="view-head">${tabs('week')}</header>
    <section class="week-nav" aria-label="Вибір тижня">
      <button type="button" class="icon-btn" data-action="week-prev" aria-label="Попередній тиждень">${icon('left')}</button>
      <h1 class="week-title">${Number(ws.slice(8))} ${ws.slice(5, 7) !== end.slice(5, 7) ? esc(shortDM(ws).split(' ')[1]) + ' ' : ''}– ${esc(shortDM(end))}</h1>
      <button type="button" class="icon-btn" data-action="week-next" aria-label="Наступний тиждень">${icon('right')}</button>
      <button type="button" class="btn btn-sm" data-action="week-this" ${isThis ? 'disabled' : ''}>Цей тиждень</button>
    </section>
    ${sampleBanner(tasks)}
    <section class="week-tasks" aria-labelledby="wt-h">
      <div class="block-head"><h2 id="wt-h" class="block-title">Завдання на тиждень</h2>
        <button type="button" class="btn btn-sm" data-action="new-task" data-week="${ws}">${icon('plus', 'ic-sm')} Додати</button></div>
      ${wOpen.length || wDone.length ? '' : '<p class="muted small">Справи, які треба зробити цього тижня, але не в конкретний день.</p>'}
      <ul class="task-list compact" data-list="week:${ws}">${wOpen.map((o) => taskRow(o)).join('')}</ul>
      ${wDone.length ? `<ul class="task-list compact done-list">${wDone.map((o) => taskRow(o, { draggable: false })).join('')}</ul>` : ''}
    </section>
    <div class="week-grid">${blocks.join('')}</div>`;

  bindTaskList(root, ctx, { defaults: {} });
  root.querySelectorAll('[data-list]').forEach((ul) =>
    enableDrag(ul, async (keys) => {
      await store.setMeta('order:' + ul.dataset.list, keys);
      ctx.refresh();
    })
  );
}

/* ---------------------------- Без дати ----------------------------- */

export async function renderNoDate(root, ctx) {
  const { tasks } = await loadTaskData();
  const list = tasks.filter((t) => !t.date && !t.weekOf);
  const occ = list.map((t) => ({ key: occKey(t.id, 'none'), task: t, occDate: null, date: null, time: null, done: !!t.done, recurring: false }));
  const order = (await store.getMeta('order:nodate')) || [];
  const open = sortOpen(occ.filter((o) => !o.done), order);
  const done = occ.filter((o) => o.done);
  root.innerHTML = `
    <header class="view-head">${tabs('nodate')}</header>
    <h1 class="day-title">Без дати</h1>
    ${quickAdd('Нове завдання без дати…')}
    <ul class="task-list open-list" data-list="nodate" aria-label="Завдання без дати">${open.map((o) => taskRow(o)).join('')}</ul>
    ${!open.length ? `<div class="empty" data-flip="empty"><p class="muted">Тут живуть ідеї та справи «колись».</p>
      <button type="button" class="btn" data-action="new-task">${icon('plus')} Додати завдання</button></div>` : ''}
    ${doneBlock(done, 'nodate')}`;
  bindTaskList(root, ctx, { defaults: { date: null } });
  root.querySelectorAll('[data-list]').forEach((ul) =>
    enableDrag(ul, async (keys) => {
      await store.setMeta('order:' + ul.dataset.list, keys);
      ctx.refresh();
    })
  );
}

/* --------------------------- Обробники ----------------------------- */

function keyOf(el) {
  const li = el.closest('[data-key]');
  if (!li) return null;
  const [id, occ] = li.dataset.key.split('|');
  return { id, occDate: /^\d{4}-\d{2}-\d{2}$/.test(occ) ? occ : null, li };
}

function bindTaskList(root, ctx, { defaults }) {
  root.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-action]');
    if (!a || !root.contains(a)) return;
    if (a.closest('[data-drag-suppress]')) return;
    const act = a.dataset.action;
    switch (act) {
      case 'toggle': {
        const k = keyOf(a);
        await animateToggle(k.li);
        await toggleOccurrence(k.id, k.occDate);
        break;
      }
      case 'open': {
        const k = keyOf(a);
        const task = await store.getTask(k.id);
        if (task) openTaskForm(task, { occDate: k.occDate });
        break;
      }
      case 'snooze': {
        const k = keyOf(a);
        await askSnooze(k.id, k.occDate);
        break;
      }
      case 'move-today':
        await moveToToday([keyOf(a).li.dataset.key]);
        break;
      case 'move-all-today':
        await moveToToday([...root.querySelectorAll('.overdue-block [data-key]')].map((li) => li.dataset.key));
        break;
      case 'toggle-done-block':
        saveUI({ doneCollapsed: !ui.doneCollapsed });
        ctx.refresh();
        break;
      case 'new-task': {
        const d = { ...defaults };
        if (a.dataset.date) d.date = a.dataset.date;
        if (a.dataset.week) {
          d.date = null;
          d.weekOf = a.dataset.week;
        }
        openTaskForm(null, { defaults: d });
        break;
      }
      case 'delete-samples':
        await deleteSamples();
        break;
      case 'pick-day':
        state.selectedDate = a.dataset.date;
        ctx.refresh();
        break;
      case 'day-prev':
        state.selectedDate = addDays(state.selectedDate, -1);
        ctx.refresh();
        break;
      case 'day-next':
        state.selectedDate = addDays(state.selectedDate, 1);
        ctx.refresh();
        break;
      case 'go-today':
        state.selectedDate = todayISO();
        ctx.refresh();
        break;
      case 'week-prev':
        state.weekStart = addDays(state.weekStart, -7);
        ctx.refresh();
        break;
      case 'week-next':
        state.weekStart = addDays(state.weekStart, 7);
        ctx.refresh();
        break;
      case 'week-this':
        state.weekStart = startOfWeek(todayISO());
        ctx.refresh();
        break;
      case 'toggle-weekday': {
        const d = a.dataset.date;
        const cur = state.weekCollapsed[d] ?? d < todayISO();
        state.weekCollapsed[d] = !cur;
        ctx.refresh();
        break;
      }
      case 'open-day':
        e.preventDefault();
        state.selectedDate = a.dataset.date;
        ctx.navigate('#/today');
        break;
    }
  });
  root.addEventListener('submit', async (e) => {
    const f = e.target.closest('[data-action="quick-add"]');
    if (!f) return;
    e.preventDefault();
    const input = f.querySelector('input');
    const text = input.value.trim();
    if (!text) return;
    const q = parseQuickAdd(text);
    const settings = await store.getSettings();
    await store.saveTask({
      title: q.title,
      time: q.time,
      priority: q.priority || 2,
      date: 'date' in defaults ? defaults.date : state.selectedDate,
      reminders: settings.defaultReminder === null ? [] : [settings.defaultReminder],
    });
    input.value = '';
    setTimeout(() => document.getElementById('quick-input')?.focus(), 50);
  });
  // свайп по стрічці днів на телефоні — нативний горизонтальний скрол;
  // свайп по самому списку вліво/вправо — перемикає день
  const list = root.querySelector('.open-list[data-list^="day:"]');
  if (list) attachDaySwipe(root.querySelector('.day-title'), ctx);
}

function attachDaySwipe(el, ctx) {
  if (!el) return;
  let x0 = null;
  let y0 = null;
  el.addEventListener('touchstart', (e) => {
    x0 = e.touches[0].clientX;
    y0 = e.touches[0].clientY;
  }, { passive: true });
  el.addEventListener('touchend', (e) => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0;
    const dy = e.changedTouches[0].clientY - y0;
    x0 = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      state.selectedDate = addDays(state.selectedDate, dx < 0 ? 1 : -1);
      ctx.refresh();
    }
  });
}

/** Коротка анімація галочки перед переїздом рядка вниз */
function animateToggle(li) {
  if (!li || matchMedia('(prefers-reduced-motion: reduce)').matches) return Promise.resolve();
  li.classList.add('toggling');
  return new Promise((r) => setTimeout(r, 140));
}

/* ------------------------------ Форма ------------------------------ */

export async function openTaskForm(task, { occDate = null, defaults = {} } = {}) {
  const settings = await store.getSettings();
  const isNew = !task;
  const t = task || {
    title: '',
    note: '',
    date: todayISO(),
    time: null,
    weekOf: null,
    priority: 2,
    repeat: null,
    reminders: settings.defaultReminder === null ? [] : [settings.defaultReminder],
    ...defaults,
  };
  const when = t.date ? 'day' : t.weekOf ? 'week' : 'none';
  const rep = t.repeat?.type || 'none';
  const repDays = t.repeat?.days?.length ? t.repeat.days : t.date ? [weekday(t.date)] : [1];

  return openModal({
    title: isNew ? 'Нове завдання' : 'Завдання',
    className: 'modal-form',
    render(el, close) {
      el.innerHTML = `<form class="task-form" novalidate>
        <label class="field"><span>Назва</span>
          <input name="title" type="text" required maxlength="200" value="${esc(t.title)}" placeholder="Що потрібно зробити?" ${isNew ? 'autofocus' : ''}></label>
        <label class="field"><span>Нотатка <span class="muted">(необов'язково)</span></span>
          <textarea name="note" rows="2" maxlength="2000">${esc(t.note || '')}</textarea></label>
        <fieldset class="field"><legend>Коли</legend>
          <div class="seg-radio">
            ${[['day', 'День'], ['week', 'На тиждень'], ['none', 'Без дати']]
              .map(([v, l]) => `<label><input type="radio" name="when" value="${v}" ${when === v ? 'checked' : ''}><span>${l}</span></label>`)
              .join('')}
          </div></fieldset>
        <div class="row2 when-day when-week">
          <label class="field"><span class="lbl-date">${when === 'week' ? 'Будь-який день тижня' : 'Дата'}</span>
            <input name="date" type="date" value="${esc(t.date || t.weekOf || todayISO())}"></label>
          <label class="field when-day"><span>Час <span class="muted">(необов'язково)</span></span>
            <span class="input-with-btn"><input name="time" type="time" value="${esc(t.time || '')}">
            <button type="button" class="icon-btn subtle" data-clear-time aria-label="Прибрати час">${icon('x', 'ic-sm')}</button></span></label>
        </div>
        <fieldset class="field"><legend>Пріоритет</legend>
          <div class="seg-radio">${PRIORITIES.map(
            (p) => `<label><input type="radio" name="priority" value="${p.v}" ${(t.priority || 2) === p.v ? 'checked' : ''}><span><i class="pdot ${p.cls}" aria-hidden="true"></i>${p.label}</span></label>`
          ).join('')}</div></fieldset>
        <div class="when-day">
          <label class="field"><span>Повторення</span>
            <select name="repeat">
              ${[['none', 'Не повторювати'], ['daily', 'Щодня'], ['weekdays', 'По буднях (пн–пт)'], ['weekly', 'Щотижня в обрані дні'], ['monthly', 'Щомісяця']]
                .map(([v, l]) => `<option value="${v}" ${rep === v ? 'selected' : ''}>${l}</option>`)
                .join('')}
            </select></label>
          <fieldset class="field repeat-days" ${rep === 'weekly' ? '' : 'hidden'}><legend>Дні тижня</legend>
            <div class="chips">${WEEKDAYS_SHORT.map(
              (l, i) => `<label class="chip"><input type="checkbox" name="rdays" value="${i + 1}" ${repDays.includes(i + 1) ? 'checked' : ''}><span>${l}</span></label>`
            ).join('')}</div></fieldset>
          <p class="hint monthly-hint" ${rep === 'monthly' ? '' : 'hidden'}>Якщо в місяці немає цього числа (29–31), завдання буде в останній день місяця.</p>
          <fieldset class="field"><legend>Нагадування</legend>
            <div class="chips">${REMINDER_OPTIONS.map(
              (r) => `<label class="chip"><input type="checkbox" name="rem" value="${r.v}" ${(t.reminders || []).includes(r.v) ? 'checked' : ''}><span>${r.label}</span></label>`
            ).join('')}</div>
            <p class="hint rem-hint">Нагадування спрацьовують для завдань із часом.</p></fieldset>
        </div>
        ${!isNew && t.repeat ? '<p class="hint">Зміни застосуються до всіх повторень. «Відкласти» змінює тільки цей випадок.</p>' : ''}
        <div class="modal-actions spread">
          ${!isNew ? `<div class="left-actions">
              <button type="button" class="btn btn-ghost-danger" data-del>${icon('trash', 'ic-sm')} Видалити</button>
              <button type="button" class="btn" data-snooze>${icon('snooze', 'ic-sm')} Відкласти</button></div>` : '<span></span>'}
          <button type="submit" class="btn btn-primary">${isNew ? 'Додати' : 'Зберегти'}</button>
        </div>
      </form>`;
      const f = el.querySelector('form');
      const sync = () => {
        const w = f.when.value;
        el.querySelectorAll('.when-day').forEach((n) => (n.hidden = w !== 'day'));
        el.querySelector('.row2').hidden = w === 'none';
        el.querySelector('.lbl-date').textContent = w === 'week' ? 'Будь-який день тижня' : 'Дата';
        const r = f.repeat.value;
        el.querySelector('.repeat-days').hidden = r !== 'weekly';
        el.querySelector('.monthly-hint').hidden = r !== 'monthly';
        el.querySelector('.rem-hint').classList.toggle('warn', !f.time.value && f.querySelectorAll('[name=rem]:checked').length > 0);
      };
      f.addEventListener('change', sync);
      f.addEventListener('input', sync);
      sync();
      el.querySelector('[data-clear-time]').addEventListener('click', () => {
        f.time.value = '';
        sync();
      });
      el.querySelector('[data-del]')?.addEventListener('click', async () => {
        const ok = await confirmDialog({
          title: 'Видалити завдання?',
          text: t.repeat ? 'Буде видалено завдання з усіма повтореннями.' : `«${t.title}» буде видалено.`,
          ok: 'Видалити',
          danger: true,
        });
        if (!ok) return;
        await store.deleteTask(t.id);
        close('deleted');
        toast('Завдання видалено', {
          action: 'Скасувати',
          onAction: async () => store.saveTask({ ...t, deletedAt: null }),
        });
      });
      el.querySelector('[data-snooze]')?.addEventListener('click', async () => {
        const target = await snoozePicker();
        if (!target) return;
        close('snoozed');
        await snoozeOccurrence(t.id, occDate || t.date, target);
      });
      f.addEventListener('submit', async (e) => {
        e.preventDefault();
        const title = f.title.value.trim();
        if (!title) {
          f.title.setCustomValidity('Введіть назву');
          f.title.reportValidity();
          f.title.addEventListener('input', () => f.title.setCustomValidity(''), { once: true });
          return;
        }
        const w = f.when.value;
        const dateVal = f.date.value || todayISO();
        const time = w === 'day' && f.time.value ? f.time.value : null;
        const r = f.repeat.value;
        let repeat = null;
        if (w === 'day' && r !== 'none') {
          repeat = { type: r };
          if (r === 'weekly') {
            const ds = [...f.querySelectorAll('[name=rdays]:checked')].map((x) => Number(x.value));
            repeat.days = ds.length ? ds : [weekday(dateVal)];
          }
        }
        const next = {
          ...t,
          title,
          note: f.note.value.trim(),
          date: w === 'day' ? dateVal : null,
          weekOf: w === 'week' ? startOfWeek(dateVal) : null,
          time,
          priority: Number(f.priority.value),
          repeat,
          reminders: [...f.querySelectorAll('[name=rem]:checked')].map((x) => Number(x.value)).sort((a, b) => a - b),
        };
        if (!isNew && (next.date !== t.date || next.time !== t.time)) next.snoozed = false;
        if (!repeat) next.exceptions = {};
        await store.saveTask(next);
        close('saved');
        if (isNew) toast('Завдання додано');
      });
    },
  });
}

/** Шторка завдання після натискання на сповіщення: Виконано / Відкласти */
export async function openReminderSheet(taskId, occDate) {
  const task = await store.getTask(taskId);
  if (!task) return;
  const when = occDate ? prettyDate(occDate) : '';
  return openModal({
    title: 'Нагадування',
    className: 'modal-small',
    render(el, close) {
      el.innerHTML = `<p class="reminder-title">${esc(task.title)}</p>
        <p class="muted">${esc(when)}${task.time ? ', ' + esc(task.time) : ''}</p>
        ${task.note ? `<p class="small">${esc(task.note)}</p>` : ''}
        <div class="modal-actions">
          <button type="button" class="btn" data-a="snooze">${icon('snooze', 'ic-sm')} Відкласти</button>
          <button type="button" class="btn btn-primary" data-a="done" autofocus>${icon('check', 'ic-sm')} Виконано</button>
        </div>`;
      el.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-a]');
        if (!b) return;
        if (b.dataset.a === 'done') {
          await setOccurrenceDone(taskId, occDate);
          close();
          toast('Позначено виконаним');
        } else {
          const target = await snoozePicker();
          if (target) {
            close();
            await snoozeOccurrence(taskId, occDate, target);
          }
        }
      });
    },
  });
}

/** Список пропущених нагадувань після відкриття додатку */
export function openMissedSheet(events) {
  return openModal({
    title: `Пропущені нагадування (${events.length})`,
    render(el, close) {
      const draw = () => {
        el.innerHTML = `<ul class="missed-list">${events
          .map(
            (ev, i) => `<li class="missed ${ev.handled ? 'handled' : ''}">
            <div><div class="task-title">${esc(ev.title)}</div>
            <div class="muted small">${esc(prettyDate(ev.date))}${ev.time ? ', ' + esc(ev.time) : ''}</div></div>
            ${ev.handled ? `<span class="muted small">${esc(ev.handled)}</span>` : ev.taskId ? `<div class="row-actions">
              <button type="button" class="btn btn-sm" data-i="${i}" data-a="snooze">Відкласти</button>
              <button type="button" class="btn btn-sm btn-primary" data-i="${i}" data-a="done">Виконано</button></div>` : ''}
          </li>`
          )
          .join('')}</ul>
          <div class="modal-actions"><button type="button" class="btn" data-close>Закрити</button></div>`;
      };
      draw();
      el.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-a]');
        if (!b) return;
        const ev = events[Number(b.dataset.i)];
        if (b.dataset.a === 'done') {
          await setOccurrenceDone(ev.taskId, ev.occDate);
          ev.handled = 'виконано';
        } else {
          const target = await snoozePicker();
          if (!target) return;
          await snoozeOccurrence(ev.taskId, ev.occDate, target);
          ev.handled = 'відкладено';
        }
        draw();
      });
    },
  });
}

export { localDateTime, plural };
