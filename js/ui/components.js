// Спільні елементи інтерфейсу: екранування, модальні вікна, тости, форматування дат.
import { icon } from './icons.js';
import { parseISODate, todayISO, addDays, SNOOZE_OPTIONS, snoozeTarget, toISODate, toHHMM } from '../logic.js';

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/* ------------------------------ Дати ------------------------------- */
const fmtWeekdayShort = new Intl.DateTimeFormat('uk-UA', { weekday: 'short' });
const fmtWeekdayLong = new Intl.DateTimeFormat('uk-UA', { weekday: 'long' });
const fmtDayMonth = new Intl.DateTimeFormat('uk-UA', { day: 'numeric', month: 'long' });
const fmtMonthYear = new Intl.DateTimeFormat('uk-UA', { month: 'long', year: 'numeric' });
const fmtShortDM = new Intl.DateTimeFormat('uk-UA', { day: 'numeric', month: 'short' });

export const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
export const weekdayShort = (iso) => fmtWeekdayShort.format(parseISODate(iso)).replace('.', '');
export const weekdayLong = (iso) => fmtWeekdayLong.format(parseISODate(iso));
export const dayMonth = (iso) => fmtDayMonth.format(parseISODate(iso));
export const shortDM = (iso) => fmtShortDM.format(parseISODate(iso)).replace('.', '');
export const monthYear = (d) => cap(fmtMonthYear.format(d));
export const WEEKDAYS_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];

export function relativeDayLabel(iso, today = todayISO()) {
  if (iso === today) return 'Сьогодні';
  if (iso === addDays(today, 1)) return 'Завтра';
  if (iso === addDays(today, -1)) return 'Вчора';
  return cap(weekdayLong(iso));
}
export function prettyDate(iso, today = todayISO()) {
  const rel = relativeDayLabel(iso, today);
  return ['Сьогодні', 'Завтра', 'Вчора'].includes(rel) ? `${rel}, ${dayMonth(iso)}` : `${rel}, ${dayMonth(iso)}`;
}

export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

/* ---------------------------- Модальні ----------------------------- */

/**
 * Відкриває модальне вікно (на телефоні — шторка знизу).
 * render(el, close) заповнює вміст; повертає Promise зі значенням, переданим у close(value).
 */
export function openModal({ title, label, render, className = '' }) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = `modal ${className}`;
    dlg.setAttribute('aria-label', label || title || 'Діалог');
    dlg.innerHTML = `
      <div class="modal-inner">
        ${title ? `<header class="modal-head"><h2 class="modal-title">${esc(title)}</h2>
          <button type="button" class="icon-btn" data-close aria-label="Закрити">${icon('x')}</button></header>` : ''}
        <div class="modal-body"></div>
      </div>`;
    document.body.appendChild(dlg);
    let result;
    let closed = false;
    const close = (value) => {
      if (closed) return;
      closed = true;
      result = value;
      dlg.classList.add('closing');
      const done = () => {
        if (dlg.open) dlg.close();
        dlg.remove();
        resolve(result);
      };
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) done();
      else setTimeout(done, 160);
    };
    dlg.addEventListener('cancel', (e) => {
      e.preventDefault();
      close(undefined);
    });
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg) close(undefined); // клік по затемненню
      if (e.target.closest('[data-close]')) close(undefined);
    });
    render(dlg.querySelector('.modal-body'), close, dlg);
    dlg.showModal();
    const first = dlg.querySelector('[autofocus]') || dlg.querySelector('.modal-body input, .modal-body button, .modal-body select');
    // на телефоні не відкриваємо клавіатуру автоматично — вона зсуває форму
    const touch = matchMedia('(pointer: coarse)').matches;
    if (first && !(touch && first.matches('input, textarea, select'))) first.focus();
  });
}

export function confirmDialog({ title, text, ok = 'Так', cancel = 'Скасувати', danger = false }) {
  return openModal({
    title,
    className: 'modal-small',
    render(el, close) {
      el.innerHTML = `<p class="muted">${esc(text)}</p>
        <div class="modal-actions">
          <button type="button" class="btn" data-v="0">${esc(cancel)}</button>
          <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-v="1" autofocus>${esc(ok)}</button>
        </div>`;
      el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-v]');
        if (b) close(b.dataset.v === '1');
      });
    },
  });
}

/** Вибір «Відкласти». Повертає {date, time} або undefined */
export function snoozePicker({ now = new Date(), title = 'Відкласти' } = {}) {
  return openModal({
    title,
    className: 'modal-small',
    render(el, close) {
      const opts = SNOOZE_OPTIONS.filter((o) => !(o.id === 'evening' && now.getHours() >= 20));
      const later = new Date(now.getTime() + 60 * 60000);
      el.innerHTML = `<div class="snooze-list" role="list">
        ${opts
          .map(
            (o) => `<button type="button" role="listitem" class="snooze-opt" data-opt="${o.id}">
              <span>${esc(o.label)}</span><span class="muted small">${o.id === 'custom' ? '' : esc(describeTarget(snoozeTarget(o.id, now), now))}</span></button>`
          )
          .join('')}
        </div>
        <form class="snooze-custom" hidden>
          <div class="row2">
            <label class="field"><span>Дата</span><input type="date" name="date" required value="${toISODate(later)}"></label>
            <label class="field"><span>Час</span><input type="time" name="time" required value="${toHHMM(later)}"></label>
          </div>
          <div class="modal-actions"><button class="btn btn-primary" type="submit">Відкласти</button></div>
        </form>`;
      el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-opt]');
        if (!b) return;
        if (b.dataset.opt === 'custom') {
          const f = el.querySelector('.snooze-custom');
          f.hidden = false;
          f.querySelector('input').focus();
          return;
        }
        close(snoozeTarget(b.dataset.opt, new Date()));
      });
      el.querySelector('form').addEventListener('submit', (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        close(snoozeTarget('custom', new Date(), { date: fd.get('date'), time: fd.get('time') }));
      });
    },
  });
}

function describeTarget(t, now) {
  const today = toISODate(now);
  if (t.date === today) return t.time;
  if (t.date === addDays(today, 1)) return `завтра ${t.time}`;
  return `${shortDM(t.date)}, ${t.time}`;
}

/* ------------------------------ Тости ------------------------------ */

export function toast(message, { action, onAction, timeout = 4000 } = {}) {
  const region = document.getElementById('toast-region');
  if (!region) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.innerHTML = `<span>${esc(message)}</span>${action ? `<button type="button" class="toast-btn">${esc(action)}</button>` : ''}`;
  region.appendChild(el);
  const remove = () => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 200);
  };
  if (action)
    el.querySelector('button').addEventListener('click', () => {
      onAction?.();
      remove();
    });
  setTimeout(remove, timeout);
}

/** Перемикач «Завдання / Звичка» зверху форм додавання. onPick(kind) викликається при виборі іншого типу. */
export function kindSwitchHtml(active) {
  return `<div class="seg-radio kind-switch" role="radiogroup" aria-label="Що додати">
    <label><input type="radio" name="kind" value="task" ${active === 'task' ? 'checked' : ''}><span>Завдання</span></label>
    <label><input type="radio" name="kind" value="habit" ${active === 'habit' ? 'checked' : ''}><span>Звичка</span></label>
  </div>`;
}
export function bindKindSwitch(form, active, onPick) {
  form.querySelectorAll('[name="kind"]').forEach((r) =>
    r.addEventListener('change', () => {
      if (r.checked && r.value !== active) onPick(r.value);
    })
  );
}
