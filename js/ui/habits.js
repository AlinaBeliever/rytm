// Звички: щоденний список, форма, статистика звички, екран «Прогрес».
import * as store from '../storage.js';
import {
  todayISO, addDays, weekday, startOfWeek, habitTarget, isHabitScheduled, habitCounts, habitStats, weeklyBars, habitMark, isHabitCounted, weeklyGoalMetHidden, applyHabitSnooze,
} from '../logic.js';
import { icon } from './icons.js';
import { stickerPickerHtml, bindStickerPicker } from './stickers.js';
import { kindSwitchHtml, bindKindSwitch, esc, openModal, confirmDialog, toast, prettyDate, relativeDayLabel, dayMonth, WEEKDAYS_SHORT, plural, monthYear, weekdayShort, shortDM } from './components.js';
import { ring, heatmap, weekBars, monthCalendar } from './charts.js';
import { state, ui, saveUI } from '../state.js';

export const HABIT_COLORS = ['#2f7d6d', '#3b6fd1', '#8a56c9', '#c2477a', '#cc5a32', '#a87a14', '#4a8a35', '#5f6b7a'];

function freqLabel(h) {
  const f = h.freq || { type: 'daily' };
  if (f.type === 'weekly') return `${f.times} ${plural(f.times, 'раз', 'рази', 'разів')} на тиждень`;
  if (f.type === 'days') return (f.days || []).map((d) => WEEKDAYS_SHORT[d - 1]).join(', ');
  return 'щодня';
}
function goalLabel(h) {
  return h.goal?.type === 'count' ? `${h.goal.target} ${h.goal.unit || ''}`.trim() : '';
}
function streakLabel(s) {
  if (!s.current) return '';
  return s.unit === 'weeks'
    ? `🔥 ${s.current} ${plural(s.current, 'тиждень', 'тижні', 'тижнів')}`
    : `🔥 ${s.current} ${plural(s.current, 'день', 'дні', 'днів')}`;
}

/* --------------------------- Дії відмітки -------------------------- */

async function setMark(h, date, mark) {
  const dayMarks = { ...(h.dayMarks || {}) };
  if (mark) dayMarks[date] = mark;
  else delete dayMarks[date];
  await store.saveHabit({ ...h, dayMarks });
}

export async function habitAct(habitId, date, act) {
  let h = await store.getHabit(habitId);
  if (!h) return;
  if (act === 'skip' || act === 'miss' || act === 'unmark') {
    const cur = (await store.getCompletions({ kind: 'habit', refId: h.id, from: date, to: date }))[0]?.count || 0;
    if (act !== 'unmark' && cur > 0) await store.setCompletion('habit', h.id, date, 0);
    await setMark(h, date, act === 'unmark' ? null : act);
    return;
  }
  if (habitMark(h, date)) await setMark(h, date, null);
  const target = habitTarget(h);
  if (h.goal?.type === 'count') {
    if (act === 'inc') await store.incrementCompletion('habit', h.id, date, 1);
    else if (act === 'dec') {
      const cur = (await store.getCompletions({ kind: 'habit', refId: h.id, from: date, to: date }))[0]?.count || 0;
      if (cur > 0) await store.setCompletion('habit', h.id, date, cur - 1);
    } else if (act === 'toggle') {
      const cur = (await store.getCompletions({ kind: 'habit', refId: h.id, from: date, to: date }))[0]?.count || 0;
      await store.setCompletion('habit', h.id, date, cur >= target ? 0 : target);
    }
  } else {
    await store.toggleCompletion('habit', h.id, date);
  }
}

/** «Виконано» зі сповіщення: зараховує день повністю */
export async function completeHabit(habitId, date) {
  const h = await store.getHabit(habitId);
  if (!h) return;
  if (habitMark(h, date)) await setMark(h, date, null);
  await store.setCompletion('habit', h.id, date, habitTarget(h));
  toast('Позначено виконаним');
}

/** Перенести нагадування звички на пізніший час того самого дня */
export async function snoozeHabit(habitId, date, target) {
  const h = await store.getHabit(habitId);
  if (!h) return;
  if (target.date !== date) {
    toast('Звичку можна перенести тільки в межах цього дня');
    return;
  }
  await store.saveHabit(applyHabitSnooze(h, date, target.time));
  toast(`Нагадаю о ${target.time}`);
}

/* ------------------------------ Список ----------------------------- */

/** Рядок звички (однаково виглядає на екранах «Звички», «Сьогодні» і «Тиждень»). readonly — майбутній день: без відмітки. */
export function habitItem(h, counts, date, today, { readonly = false } = {}) {
  const c = counts.get(h.id) || new Map();
  const cnt = c.get(date) || 0;
  const target = habitTarget(h);
  const done = cnt >= target;
  const st = habitStats(h, c, today);
  let sub = [freqLabel(h)];
  if (h.freq?.type === 'weekly') {
    const ws = startOfWeek(date);
    let n = 0;
    for (let i = 0; i < 7; i++) if ((c.get(addDays(ws, i)) || 0) >= target) n++;
    sub = [`${n} з ${h.freq.times} цього тижня`];
  }
  if (goalLabel(h)) sub.push(goalLabel(h));
  const sl = streakLabel(st);
  const name = esc(h.name);
  const control =
    h.goal?.type === 'count'
      ? `<div class="habit-count">
          ${cnt > 0 && !readonly ? `<button type="button" class="icon-btn subtle" data-action="habit-dec" aria-label="Мінус один: ${name}">${icon('minus', 'ic-sm')}</button>` : ''}
          ${ring(cnt, target, h.color, 44)}
          <button type="button" class="habit-plus ${done ? 'is-done' : ''}" data-action="habit-inc" ${readonly ? 'disabled' : ''} aria-label="Плюс один: ${name} (${cnt} з ${target})">+1</button>
        </div>`
      : `<button type="button" class="habit-check ${done ? 'is-done' : ''}" data-action="habit-toggle" aria-pressed="${done}" ${readonly ? 'disabled' : ''}
          aria-label="${done ? 'Зняти відмітку' : 'Відмітити'}: ${name}">${icon('check')}</button>`;
  const mark = habitMark(h, date);
  const marks = readonly || done
    ? ''
    : mark
      ? `<div class="habit-marks"><span class="mark-badge is-${mark}">${mark === 'skip' ? '⏭ Пропущено' : '✕ Не виконано'}</span>
          <button type="button" class="btn btn-sm" data-action="habit-unmark">Скасувати</button></div>`
      : `<div class="habit-marks"><button type="button" class="btn btn-sm" data-action="habit-skip">Пропустити</button>
          <button type="button" class="btn btn-sm" data-action="habit-miss">Не виконано</button></div>`;
  return `<li class="habit ${done ? 'is-done' : ''} ${mark ? 'is-' + mark : ''}" data-habit="${h.id}" style="--hc:${esc(h.color)}" data-flip="habit-${h.id}-${date}">
    <a class="habit-info" href="#/habit/${h.id}" aria-label="Статистика: ${name}">
      <span class="habit-emoji" aria-hidden="true">${esc(h.emoji || '✅')}</span>
      <span class="habit-text"><span class="habit-name">${name}${h.sample ? ' <span class="tag">приклад</span>' : ''}</span>
        <span class="habit-sub">${esc(sub.join(' · '))}${sl ? ` <span class="streak">${sl}</span>` : ''}</span></span>
    </a>
    ${control}
    ${marks}
  </li>`;
}

export async function renderHabits(root, ctx) {
  const today = todayISO();
  const date = state.habitDate;
  const [habits, completions] = await Promise.all([store.getHabits(), store.getCompletions({ kind: 'habit' })]);
  const counts = habitCounts(completions);
  const active = habits.filter((h) => !h.archived);
  const visible = active.filter((h) => !weeklyGoalMetHidden(h, counts.get(h.id), date));
  const sched = visible.filter((h) => isHabitScheduled(h, date));
  const other = visible.filter((h) => !isHabitScheduled(h, date));

  const item = (h) => habitItem(h, counts, date, today);

  root.innerHTML = `
    <header class="view-head between"><h1 class="view-title">Звички</h1>
      <button type="button" class="btn btn-primary" data-action="new-habit">${icon('plus')} <span>Нова звичка</span></button></header>
    <section class="day-switch" aria-label="Вибір дня для відміток">
      <button type="button" class="icon-btn" data-action="hd-prev" aria-label="Попередній день">${icon('left')}</button>
      <div class="day-switch-label"><strong>${esc(relativeDayLabel(date, today))}</strong> <span class="muted">${esc(dayMonth(date))}</span></div>
      <button type="button" class="icon-btn" data-action="hd-next" aria-label="Наступний день" ${date >= today ? 'disabled' : ''}>${icon('right')}</button>
      ${date !== today ? `<button type="button" class="btn btn-sm" data-action="hd-today">Сьогодні</button>` : ''}
    </section>
    ${date !== today ? '<p class="hint">Ви відмічаєте звички заднім числом — статистика перерахується автоматично.</p>' : ''}
    ${habits.some((h) => h.sample) ? `<div class="banner"><span>Це приклади звичок.</span><button type="button" class="btn btn-sm" data-action="delete-samples">Видалити приклади</button></div>` : ''}
    ${
      active.length
        ? `<ul class="habit-list">${sched.map(item).join('')}</ul>
           ${other.length ? `<h2 class="block-title muted">Не за розкладом цього дня</h2><ul class="habit-list dim">${other.map(item).join('')}</ul>` : ''}`
        : `<div class="empty"><p class="muted">Звичок поки немає. Почніть з однієї маленької — наприклад, «склянка води зранку».</p>
           <button type="button" class="btn" data-action="new-habit">${icon('plus')} Додати звичку</button></div>`
    }`;

  root.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-action]');
    if (!a) return;
    const hid = a.closest('[data-habit]')?.dataset.habit;
    switch (a.dataset.action) {
      case 'habit-toggle':
        await habitAct(hid, date, 'toggle');
        break;
      case 'habit-inc':
        await habitAct(hid, date, 'inc');
        break;
      case 'habit-dec':
        await habitAct(hid, date, 'dec');
        break;
      case 'habit-skip':
      case 'habit-miss':
      case 'habit-unmark':
        await habitAct(hid, date, a.dataset.action.slice(6));
        break;
      case 'new-habit':
        openHabitForm(null);
        break;
      case 'hd-prev':
        state.habitDate = addDays(date, -1);
        ctx.refresh();
        break;
      case 'hd-next':
        if (date < today) state.habitDate = addDays(date, 1);
        ctx.refresh();
        break;
      case 'hd-today':
        state.habitDate = today;
        ctx.refresh();
        break;
      case 'delete-samples': {
        const { deleteSamples } = await import('./tasks.js');
        await deleteSamples();
        break;
      }
    }
  });
}

/* ------------------------------ Форма ------------------------------ */

export function openHabitForm(habit, { prefillName = '' } = {}) {
  const isNew = !habit;
  const h = habit || {
    name: prefillName,
    emoji: '💧',
    color: HABIT_COLORS[0],
    freq: { type: 'daily' },
    goal: { type: 'bool' },
    reminderTime: null,
  };
  const f0 = h.freq || { type: 'daily' };
  return openModal({
    title: isNew ? 'Нова звичка' : 'Редагувати звичку',
    className: 'modal-form',
    render(el, close) {
      el.innerHTML = `<form class="habit-form" novalidate>
        ${isNew ? kindSwitchHtml('habit') : ''}
        <label class="field"><span>Назва</span><input name="name" type="text" maxlength="80" required value="${esc(h.name)}" placeholder="Наприклад: Пити воду" ${isNew ? 'autofocus' : ''}></label>
        ${stickerPickerHtml(h.emoji, esc)}
        <fieldset class="field"><legend>Колір</legend><div class="colors">${HABIT_COLORS.map(
          (c, i) => `<label class="color-opt"><input type="radio" name="color" value="${c}" ${h.color === c ? 'checked' : ''} aria-label="Колір ${i + 1}"><span style="background:${c}"></span></label>`
        ).join('')}</div></fieldset>
        <label class="field"><span>Частота</span>
          <select name="freq">
            <option value="daily" ${f0.type === 'daily' ? 'selected' : ''}>Щодня</option>
            <option value="weekly" ${f0.type === 'weekly' ? 'selected' : ''}>N разів на тиждень</option>
            <option value="days" ${f0.type === 'days' ? 'selected' : ''}>В обрані дні</option>
          </select></label>
        <label class="field f-weekly"><span>Скільки разів на тиждень</span><input name="times" type="number" min="1" max="7" value="${f0.times || 3}"></label>
        <fieldset class="field f-days"><legend>Дні</legend><div class="chips">${WEEKDAYS_SHORT.map(
          (l, i) => `<label class="chip"><input type="checkbox" name="days" value="${i + 1}" ${(f0.days || [1, 3, 5]).includes(i + 1) ? 'checked' : ''}><span>${l}</span></label>`
        ).join('')}</div></fieldset>
        <fieldset class="field"><legend>Ціль</legend>
          <div class="seg-radio">
            <label><input type="radio" name="goal" value="bool" ${h.goal?.type !== 'count' ? 'checked' : ''}><span>Так / ні</span></label>
            <label><input type="radio" name="goal" value="count" ${h.goal?.type === 'count' ? 'checked' : ''}><span>Кількість</span></label>
          </div></fieldset>
        <div class="row2 g-count">
          <label class="field"><span>Скільки за день</span><input name="target" type="number" min="1" max="999" value="${h.goal?.target || 8}"></label>
          <label class="field"><span>Одиниця</span><input name="unit" type="text" maxlength="20" value="${esc(h.goal?.unit || 'склянок')}" placeholder="склянок, хв…"></label>
        </div>
        <div class="row2">
          <label class="field"><span>Початок</span><input name="startDate" type="date" value="${esc(h.startDate || '')}"></label>
          <label class="field"><span>Кінець</span><input name="endDate" type="date" value="${esc(h.endDate || '')}" ${h.endDate ? '' : 'disabled'}></label>
        </div>
        <label class="chip no-end"><input type="checkbox" name="noEnd" ${h.endDate ? '' : 'checked'}><span>Без кінця</span></label>
        <label class="field"><span>Нагадування <span class="muted">(необов'язково)</span></span>
          <input name="reminderTime" type="time" value="${esc(h.reminderTime || '')}"></label>
        <div class="modal-actions spread">
          ${!isNew ? `<button type="button" class="btn btn-ghost-danger" data-del>${icon('trash', 'ic-sm')} Видалити</button>` : '<span></span>'}
          <button type="submit" class="btn btn-primary">${isNew ? 'Додати' : 'Зберегти'}</button>
        </div>
      </form>`;
      const f = el.querySelector('form');
      bindKindSwitch(f, 'habit', async () => {
        const title = f.name.value.trim();
        close();
        const { openTaskForm } = await import('./tasks.js');
        openTaskForm(null, { defaults: { title, date: state.selectedDate } });
      });
      const sync = () => {
        el.querySelector('.f-weekly').hidden = f.freq.value !== 'weekly';
        el.querySelector('.f-days').hidden = f.freq.value !== 'days';
        el.querySelector('.g-count').hidden = f.goal.value !== 'count';
        f.endDate.disabled = f.noEnd.checked;
        if (f.noEnd.checked) f.endDate.value = '';
        else if (!f.endDate.value) f.endDate.value = f.startDate.value || todayISO();
      };
      f.addEventListener('change', sync);
      sync();
      bindStickerPicker(f);
      el.querySelector('[data-del]')?.addEventListener('click', async () => {
        const ok = await confirmDialog({ title: 'Видалити звичку?', text: `«${h.name}» і вся її статистика будуть видалені.`, ok: 'Видалити', danger: true });
        if (!ok) return;
        await store.deleteHabit(h.id);
        close('deleted');
        location.hash = '#/habits';
        toast('Звичку видалено', { action: 'Скасувати', onAction: () => store.saveHabit({ ...h, deletedAt: null }) });
      });
      f.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = f.name.value.trim();
        if (!name) {
          f.name.setCustomValidity('Введіть назву');
          f.name.reportValidity();
          f.name.addEventListener('input', () => f.name.setCustomValidity(''), { once: true });
          return;
        }
        const ft = f.freq.value;
        const freq = { type: ft };
        if (ft === 'weekly') freq.times = Math.max(1, Math.min(7, Number(f.times.value) || 3));
        if (ft === 'days') {
          const ds = [...f.querySelectorAll('[name=days]:checked')].map((x) => Number(x.value));
          freq.days = ds.length ? ds : [weekday(todayISO())];
        }
        const goal = f.goal.value === 'count' ? { type: 'count', target: Math.max(1, Number(f.target.value) || 1), unit: f.unit.value.trim() } : { type: 'bool' };
        const startDate = f.startDate.value || null;
        const endDate = f.noEnd.checked ? null : f.endDate.value || null;
        if (startDate && endDate && endDate < startDate) {
          f.endDate.setCustomValidity('Кінець раніше початку');
          f.endDate.reportValidity();
          f.endDate.addEventListener('input', () => f.endDate.setCustomValidity(''), { once: true });
          return;
        }
        const habits = await store.getHabits();
        await store.saveHabit({
          ...h,
          name,
          emoji: f.elements.emoji.value || '✅',
          color: f.color.value || HABIT_COLORS[0],
          freq,
          goal,
          reminderTime: f.reminderTime.value || null,
          startDate,
          endDate,
          order: h.order ?? habits.length,
        });
        close('saved');
        if (isNew) toast('Звичку додано');
      });
    },
  });
}

/* --------------------------- Статистика ---------------------------- */

const calMonth = {}; // habitId -> {y, m}

export async function renderHabitStats(root, ctx, id) {
  const h = await store.getHabit(id);
  if (!h) {
    root.innerHTML = `<div class="empty"><p>Звичку не знайдено.</p><a class="btn" href="#/habits">До звичок</a></div>`;
    return;
  }
  const today = todayISO();
  const counts = habitCounts(await store.getCompletions({ kind: 'habit', refId: id })).get(id) || new Map();
  const st = habitStats(h, counts, today);
  const target = habitTarget(h);
  const now = new Date();
  const cm = calMonth[id] || { y: now.getFullYear(), m: now.getMonth() };
  const pct = (v) => (v === null ? '—' : `${v}%`);
  const unitL = (n) => (st.unit === 'weeks' ? plural(n, 'тиждень', 'тижні', 'тижнів') : plural(n, 'день', 'дні', 'днів'));
  const isCurMonth = cm.y === now.getFullYear() && cm.m === now.getMonth();

  root.innerHTML = `
    <header class="view-head between">
      <a class="icon-btn" href="#/habits" aria-label="Назад до звичок">${icon('left')}</a>
      <h1 class="view-title habit-title" style="--hc:${esc(h.color)}"><span aria-hidden="true">${esc(h.emoji)}</span> ${esc(h.name)}</h1>
      <button type="button" class="icon-btn" data-action="edit-habit" aria-label="Редагувати звичку">${icon('edit')}</button>
    </header>
    <p class="muted">${esc(freqLabel(h))}${h.startDate ? ' · з ' + esc(shortDM(h.startDate)) : ''}${h.endDate ? ' до ' + esc(shortDM(h.endDate)) : ''}${goalLabel(h) ? ' · ціль: ' + esc(goalLabel(h)) : ''}${h.reminderTime ? ' · нагадування о ' + esc(h.reminderTime) : ''}</p>
    <section class="stat-cards" aria-label="Показники">
      <div class="stat"><div class="stat-v">${st.current}</div><div class="stat-l">поточна серія, ${unitL(st.current)}</div></div>
      <div class="stat"><div class="stat-v">${st.longest}</div><div class="stat-l">найдовша серія, ${unitL(st.longest)}</div></div>
      <div class="stat"><div class="stat-v">${pct(st.week)}</div><div class="stat-l">за тиждень</div></div>
      <div class="stat"><div class="stat-v">${pct(st.month)}</div><div class="stat-l">за місяць</div></div>
      <div class="stat"><div class="stat-v">${pct(st.year)}</div><div class="stat-l">за рік</div></div>
    </section>
    <section class="card">
      <h2 class="card-title">Рік</h2>
      <div class="hscroll heatmap-wrap" tabindex="0" aria-label="Теплова карта, можна прокрутити">${heatmap({ counts, target, color: h.color, today, start: st.start })}</div>
    </section>
    <div class="two-col">
      <section class="card">
        <div class="card-head">
          <button type="button" class="icon-btn" data-action="cal-prev" aria-label="Попередній місяць">${icon('left')}</button>
          <h2 class="card-title">${esc(monthYear(new Date(cm.y, cm.m, 1)))}</h2>
          <button type="button" class="icon-btn" data-action="cal-next" aria-label="Наступний місяць" ${isCurMonth ? 'disabled' : ''}>${icon('right')}</button>
        </div>
        ${monthCalendar({ year: cm.y, month: cm.m, counts, target, color: h.color, today, isScheduled: (d) => isHabitScheduled(h, d) })}
        <p class="hint">Натисніть на день, щоб поставити або зняти відмітку — також додаткові дні понад норму.</p>
      </section>
      <section class="card">
        <h2 class="card-title">По тижнях</h2>
        ${weekBars(weeklyBars(h, st.doneSet, today, 12), h.color)}
        <p class="hint">Пунктир — ціль на тиждень.</p>
      </section>
    </div>`;

  // прокрутити теплову карту до сьогодні
  const wrap = root.querySelector('.heatmap-wrap');

  root.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-action]');
    if (!a) return;
    switch (a.dataset.action) {
      case 'edit-habit':
        openHabitForm(h);
        break;
      case 'cal-prev':
      case 'cal-next': {
        const d = new Date(cm.y, cm.m + (a.dataset.action === 'cal-prev' ? -1 : 1), 1);
        calMonth[id] = { y: d.getFullYear(), m: d.getMonth() };
        ctx.refresh();
        break;
      }
      case 'cal-day': {
        const date = a.dataset.date;
        if (h.goal?.type === 'count') await countDialog(h, date, counts.get(date) || 0);
        else await habitAct(id, date, 'toggle');
        break;
      }
    }
  });
  return () => {
    if (wrap) wrap.scrollLeft = wrap.scrollWidth;
  };
}

function countDialog(h, date, current) {
  return openModal({
    title: `${h.emoji} ${prettyDate(date)}`,
    className: 'modal-small',
    render(el, close) {
      let v = current;
      const draw = () => {
        el.innerHTML = `<div class="stepper">
          <button type="button" class="icon-btn big" data-d="-1" aria-label="Мінус один">${icon('minus')}</button>
          <output class="stepper-v" aria-live="polite">${v}</output>
          <button type="button" class="icon-btn big" data-d="1" aria-label="Плюс один">${icon('plus')}</button></div>
          <p class="muted center">ціль: ${h.goal.target} ${esc(h.goal.unit || '')}</p>
          <div class="modal-actions"><button type="button" class="btn btn-primary" data-save>Зберегти</button></div>`;
      };
      draw();
      el.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-d]');
        if (b) {
          v = Math.max(0, v + Number(b.dataset.d));
          el.querySelector('.stepper-v').textContent = v;
        }
        if (e.target.closest('[data-save]')) {
          await store.setCompletion('habit', h.id, date, v);
          close();
        }
      });
    },
  });
}

/* ----------------------------- Прогрес ----------------------------- */

export async function renderProgress(root, ctx) {
  const today = todayISO();
  const range = ui.progressRange === 30 ? 30 : 7;
  const [habits, completions] = await Promise.all([store.getHabits(), store.getCompletions({ kind: 'habit' })]);
  const counts = habitCounts(completions);
  const active = habits.filter((h) => !h.archived);
  const days = Array.from({ length: range }, (_, i) => addDays(today, -(range - 1 - i)));

  const rows = active
    .map((h) => {
      const c = counts.get(h.id) || new Map();
      const target = habitTarget(h);
      let done = 0;
      let expected = 0;
      const cells = days
        .map((d) => {
          const cnt = c.get(d) || 0;
          const sched = isHabitScheduled(h, d);
          const isDone = cnt >= target;
          if (sched) expected++;
          if (isDone) done++;
          const p = Math.min(1, cnt / target);
          return `<td><button type="button" class="pg-cell ${isDone ? 'done' : cnt ? 'partial' : ''} ${sched ? '' : 'unsched'}" data-action="pg-toggle" data-habit="${h.id}" data-date="${d}"
            style="--hc:${esc(h.color)};--p:${p.toFixed(2)}" aria-pressed="${isDone}" aria-label="${esc(h.name)}, ${esc(shortDM(d))}: ${isDone ? 'виконано' : cnt ? `${cnt} з ${target}` : 'не виконано'}"></button></td>`;
        })
        .join('');
      const f = h.freq || {};
      if (f.type === 'weekly') expected = Math.round((f.times * range) / 7);
      const pct = expected ? Math.round(Math.min(1, done / expected) * 100) : 0;
      return `<tr><th scope="row" class="pg-name"><a href="#/habit/${h.id}"><span aria-hidden="true">${esc(h.emoji)}</span> ${esc(h.name)}</a></th>${cells}<td class="pg-pct">${pct}%</td></tr>`;
    })
    .join('');

  root.innerHTML = `
    <header class="view-head between"><h1 class="view-title">Прогрес</h1>
      <div class="segmented small" role="group" aria-label="Період">
        <button type="button" class="seg ${range === 7 ? 'active' : ''}" data-action="range" data-r="7" aria-pressed="${range === 7}">7 днів</button>
        <button type="button" class="seg ${range === 30 ? 'active' : ''}" data-action="range" data-r="30" aria-pressed="${range === 30}">30 днів</button>
      </div></header>
    ${
      active.length
        ? `<div class="card pg-card"><div class="hscroll pg-scroll" tabindex="0" aria-label="Сітка звичок, можна прокрутити">
        <table class="pg-table r${range}">
          <thead><tr><th scope="col" class="pg-name"><span class="sr-only">Звичка</span></th>${days
            .map((d) => `<th scope="col" class="${d === today ? 'is-today' : ''}"><span class="pg-wd">${esc(weekdayShort(d))}</span><span class="pg-d">${Number(d.slice(8))}</span></th>`)
            .join('')}<th scope="col" class="pg-pct">%</th></tr></thead>
          <tbody>${rows}</tbody></table></div></div>
          <p class="hint">Натисніть клітинку, щоб відмітити або зняти. Бліді клітинки — дні не за розкладом звички.</p>`
        : `<div class="empty"><p class="muted">Додайте звички, щоб бачити прогрес.</p><a class="btn" href="#/habits">До звичок</a></div>`
    }`;

  root.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-action]');
    if (!a) return;
    if (a.dataset.action === 'range') {
      saveUI({ progressRange: Number(a.dataset.r) });
      ctx.refresh();
    } else if (a.dataset.action === 'pg-toggle') {
      await habitAct(a.dataset.habit, a.dataset.date, 'toggle');
    }
  });
  return () => {
    const s = root.querySelector('.pg-scroll');
    if (s) s.scrollLeft = s.scrollWidth;
  };
}
