// logic.js — чисті функції без DOM і без сховища.
// Дати, повторення, сортування, «Відкласти», нагадування, тихі години, статистика звичок.
// Цей модуль можна тестувати в Node (див. tests/unit.test.mjs).

/* ---------------------------- Дати ---------------------------- */

export const pad = (n) => String(n).padStart(2, '0');

/** Date → 'YYYY-MM-DD' у місцевому часі пристрою */
export function toISODate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
/** 'YYYY-MM-DD' → Date (місцева північ) */
export function parseISODate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function toHHMM(d) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function todayISO(now = new Date()) {
  return toISODate(now);
}
export function addDays(iso, n) {
  const d = parseISODate(iso);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}
/** 1 = понеділок … 7 = неділя */
export function weekday(iso) {
  const d = parseISODate(iso).getDay();
  return d === 0 ? 7 : d;
}
export function startOfWeek(iso) {
  return addDays(iso, 1 - weekday(iso));
}
export function daysBetween(a, b) {
  return Math.round((parseISODate(b) - parseISODate(a)) / 86400000);
}
export function daysInMonth(year, month1) {
  return new Date(year, month1, 0).getDate();
}
export function timeToMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}
/** «Місцева дата + місцевий час» → Date у поточному часовому поясі пристрою */
export function localDateTime(iso, hhmm = '00:00') {
  const d = parseISODate(iso);
  const [h, m] = hhmm.split(':').map(Number);
  d.setHours(h, m, 0, 0);
  return d;
}
export function rangeDays(fromIso, toIso) {
  const out = [];
  for (let d = fromIso; d <= toIso; d = addDays(d, 1)) out.push(d);
  return out;
}

/* ------------------------- Повторення ------------------------- */

/** Чи припадає правило повторення завдання на дату iso (без урахування винятків) */
export function occursOn(task, iso) {
  const r = task.repeat;
  if (!r) return task.date === iso;
  if (!task.date || iso < task.date) return false;
  if (r.until && iso > r.until) return false;
  switch (r.type) {
    case 'daily':
      return true;
    case 'weekdays':
      return weekday(iso) <= 5;
    case 'weekly': {
      const days = r.days && r.days.length ? r.days : [weekday(task.date)];
      return days.includes(weekday(iso));
    }
    case 'monthly': {
      // 29–31 число: у коротших місяцях — останній день місяця
      const want = parseISODate(task.date).getDate();
      const d = parseISODate(iso);
      const dim = daysInMonth(d.getFullYear(), d.getMonth() + 1);
      return d.getDate() === Math.min(want, dim);
    }
    default:
      return false;
  }
}

export const occKey = (taskId, occDate) => `${taskId}|${occDate}`;

/** Множина виконаних випадків повторюваних завдань: 'taskId|YYYY-MM-DD' */
export function taskDoneSet(completions) {
  const s = new Set();
  for (const c of completions) if (c.kind === 'task' && c.count > 0) s.add(occKey(c.refId, c.date));
  return s;
}

/**
 * Випадки (occurrences) завдань на конкретний день.
 * Повертає [{key, task, occDate, date, time, done, snoozed, recurring}]
 * occDate — «рідна» дата випадку за правилом (за нею зберігається виконання),
 * date/time — де випадок фактично стоїть (після «Відкласти»).
 */
export function occurrencesForDay(tasks, doneSet, iso) {
  const out = [];
  for (const task of tasks) {
    if (task.deletedAt) continue;
    if (!task.repeat) {
      if (task.date === iso) {
        out.push({ key: occKey(task.id, iso), task, occDate: iso, date: iso, time: task.time || null,
          done: !!task.done, snoozed: !!task.snoozed, recurring: false });
      }
      continue;
    }
    const ex = task.exceptions || {};
    if (occursOn(task, iso) && !ex[iso]) {
      out.push({ key: occKey(task.id, iso), task, occDate: iso, date: iso, time: task.time || null,
        done: doneSet.has(occKey(task.id, iso)), snoozed: false, recurring: true });
    }
    for (const [orig, e] of Object.entries(ex)) {
      if (e && !e.skip && e.date === iso) {
        out.push({ key: occKey(task.id, orig), task, occDate: orig, date: iso, time: e.time ?? task.time ?? null,
          done: doneSet.has(occKey(task.id, orig)), snoozed: !!e.snoozed, recurring: true });
      }
    }
  }
  return out;
}

/** Прострочені: разові невиконані завдання з минулих днів (+ відкладені випадки повторюваних) */
export function overdueItems(tasks, doneSet, today) {
  const out = [];
  for (const task of tasks) {
    if (task.deletedAt) continue;
    if (!task.repeat) {
      if (task.date && task.date < today && !task.done) {
        out.push({ key: occKey(task.id, task.date), task, occDate: task.date, date: task.date,
          time: task.time || null, done: false, snoozed: !!task.snoozed, recurring: false });
      }
    } else {
      for (const [orig, e] of Object.entries(task.exceptions || {})) {
        if (e && !e.skip && e.date < today && !doneSet.has(occKey(task.id, orig))) {
          out.push({ key: occKey(task.id, orig), task, occDate: orig, date: e.date, time: e.time ?? task.time ?? null,
            done: false, snoozed: !!e.snoozed, recurring: true });
        }
      }
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || (a.task.priority || 2) - (b.task.priority || 2));
}

/**
 * Порядок невиконаних: спершу з часом (за часом), потім без часу (за пріоритетом).
 * manualOrder — масив ключів після перетягування: ручні позиції займають «слоти»
 * своїх елементів, а нові елементи стоять на місцях за правилом за замовчуванням.
 */
export function sortOpen(items, manualOrder = []) {
  const def = [...items].sort((a, b) => {
    if (a.time && b.time) return a.time.localeCompare(b.time) || (a.task.priority || 2) - (b.task.priority || 2);
    if (a.time) return -1;
    if (b.time) return 1;
    return (a.task.priority || 2) - (b.task.priority || 2) || String(a.task.createdAt).localeCompare(String(b.task.createdAt));
  });
  if (!manualOrder || !manualOrder.length) return def;
  const idx = new Map(manualOrder.map((k, i) => [k, i]));
  const listed = def.filter((x) => idx.has(x.key)).sort((a, b) => idx.get(a.key) - idx.get(b.key));
  let j = 0;
  return def.map((x) => (idx.has(x.key) ? listed[j++] : x));
}

/* -------------------------- Відкласти ------------------------- */

export const SNOOZE_OPTIONS = [
  { id: '10m', label: '10 хв' },
  { id: '30m', label: '30 хв' },
  { id: '1h', label: '1 год' },
  { id: '3h', label: '3 год' },
  { id: 'evening', label: 'Сьогодні ввечері (20:00)' },
  { id: 'tomorrow', label: 'Завтра (9:00)' },
  { id: 'monday', label: 'Наступний понеділок (9:00)' },
  { id: 'custom', label: 'Свій час…' },
];

/** Обчислює нову місцеву дату й час для варіанта «Відкласти» */
export function snoozeTarget(option, now = new Date(), custom = null) {
  const plus = (min) => {
    const d = new Date(now.getTime() + min * 60000);
    d.setSeconds(0, 0);
    return { date: toISODate(d), time: toHHMM(d) };
  };
  const today = toISODate(now);
  switch (option) {
    case '10m': return plus(10);
    case '15m': return plus(15);
    case '30m': return plus(30);
    case '1h': return plus(60);
    case '3h': return plus(180);
    case 'evening':
      return now.getHours() < 20 ? { date: today, time: '20:00' } : { date: addDays(today, 1), time: '20:00' };
    case 'tomorrow':
      return { date: addDays(today, 1), time: '09:00' };
    case 'monday': {
      const wd = weekday(today);
      return { date: addDays(today, 8 - wd), time: '09:00' };
    }
    case 'custom':
      if (!custom || !custom.date || !custom.time) throw new Error('custom snooze needs date and time');
      return { date: custom.date, time: custom.time };
    default:
      throw new Error('unknown snooze option ' + option);
  }
}

/** Застосовує «Відкласти» до одного випадку. Для повторюваного — тільки цей випадок (виняток). */
export function applySnooze(task, occDate, target) {
  const t = JSON.parse(JSON.stringify(task));
  if (!t.repeat) {
    t.date = target.date;
    t.time = target.time;
    t.weekOf = null;
    t.snoozed = true;
  } else {
    t.exceptions = { ...(t.exceptions || {}), [occDate]: { date: target.date, time: target.time, snoozed: true } };
  }
  return t;
}

/** Перенести на іншу дату (наприклад, «Перенести на сьогодні») без зміни часу */
export function moveOccurrence(task, occDate, newDate) {
  const t = JSON.parse(JSON.stringify(task));
  if (!t.repeat) {
    t.date = newDate;
    t.weekOf = null;
  } else {
    const prev = (t.exceptions || {})[occDate] || {};
    t.exceptions = { ...(t.exceptions || {}), [occDate]: { ...prev, date: newDate, time: prev.time ?? t.time ?? null } };
  }
  return t;
}

/* ------------------------- Нагадування ------------------------ */

/** Чи момент date потрапляє у тихі години {enabled, from:'23:00', to:'08:00'} */
export function inQuietHours(date, qh) {
  if (!qh || !qh.enabled) return false;
  const m = date.getHours() * 60 + date.getMinutes();
  const s = timeToMinutes(qh.from);
  const e = timeToMinutes(qh.to);
  if (s === e) return false;
  return s < e ? m >= s && m < e : m >= s || m < e;
}

/**
 * Події нагадувань у проміжку (fromMs, toMs].
 * Відкладений випадок нагадує рівно в новий час (одне нагадування).
 * Час рахується з «місцева дата + місцевий час» у ПОТОЧНОМУ поясі пристрою,
 * тому після зміни поясу 9:00 лишається 9:00.
 */
export function reminderEvents(tasks, doneSet, fromMs, toMs) {
  const events = [];
  const fromDay = toISODate(new Date(fromMs));
  const toDay = addDays(toISODate(new Date(toMs)), 2); // нагадування може бути до 1 доби раніше
  for (const iso of rangeDays(fromDay, toDay)) {
    for (const occ of occurrencesForDay(tasks, doneSet, iso)) {
      if (!occ.time || occ.done) continue;
      const offsets = occ.snoozed ? [0] : occ.task.reminders || [];
      const base = localDateTime(occ.date, occ.time).getTime();
      for (const off of offsets) {
        const at = base - off * 60000;
        if (at > fromMs && at <= toMs) {
          events.push({ id: `${occ.key}|${occ.date}T${occ.time}|${off}`, at, offset: off, occ });
        }
      }
    }
  }
  return events.sort((a, b) => a.at - b.at);
}

/** Події нагадувань звичок (час нагадування звички в дні за розкладом, якщо ще не виконано) */
export function habitReminderEvents(habits, countsByHabit, fromMs, toMs) {
  const events = [];
  const fromDay = toISODate(new Date(fromMs));
  const toDay = toISODate(new Date(toMs));
  for (const iso of rangeDays(fromDay, toDay)) {
    for (const h of habits) {
      if (h.deletedAt || h.archived || !h.reminderTime) continue;
      if (!isHabitScheduled(h, iso)) continue;
      const cnt = countsByHabit.get(h.id)?.get(iso) || 0;
      if (cnt >= habitTarget(h)) continue;
      const at = localDateTime(iso, h.reminderTime).getTime();
      if (at > fromMs && at <= toMs) events.push({ id: `habit|${h.id}|${iso}T${h.reminderTime}`, at, habit: h, date: iso });
    }
  }
  return events;
}

/* ---------------------------- Звички -------------------------- */

export function habitTarget(h) {
  return h.goal && h.goal.type === 'count' ? Math.max(1, Number(h.goal.target) || 1) : 1;
}

/** Чи день потрапляє в період звички (початок і кінець необов'язкові) */
export function habitInRange(h, iso) {
  if (h.startDate && iso < h.startDate) return false;
  if (h.endDate && iso > h.endDate) return false;
  return true;
}

/** Чи звичка запланована на цей день. «N разів на тиждень» — будь-який день. */
export function isHabitScheduled(h, iso) {
  if (!habitInRange(h, iso)) return false;
  const f = h.freq || { type: 'daily' };
  if (f.type === 'days') return (f.days || []).includes(weekday(iso));
  return true;
}

/** «N разів на тиждень»: норму тижня виконано, а цей день ще не відмічений — його можна не показувати */
export function weeklyGoalMetHidden(h, countsByDate, iso) {
  const f = h.freq;
  if (!f || f.type !== 'weekly') return false;
  const target = habitTarget(h);
  const c = countsByDate || new Map();
  if ((c.get(iso) || 0) >= target) return false;
  const ws = startOfWeek(iso);
  let n = 0;
  for (let i = 0; i < 7; i++) if ((c.get(addDays(ws, i)) || 0) >= target) n++;
  return n >= Math.max(1, Math.min(7, Number(f.times) || 1));
}

/** Ручна позначка дня: 'skip' (пропущено, не рахується) або 'miss' (свідомо не виконано) */
export function habitMark(h, iso) {
  return (h.dayMarks && h.dayMarks[iso]) || null;
}

/** Запланований день, який рахується в серії та статистиці (пропущені дні — ні) */
export function isHabitCounted(h, iso) {
  return isHabitScheduled(h, iso) && habitMark(h, iso) !== 'skip';
}

/** Map<habitId, Map<date, count>> з масиву completions */
export function habitCounts(completions) {
  const m = new Map();
  for (const c of completions) {
    if (c.kind !== 'habit' || !(c.count > 0)) continue;
    if (!m.has(c.refId)) m.set(c.refId, new Map());
    m.get(c.refId).set(c.date, c.count);
  }
  return m;
}

/** Скільки днів у тижні (з понеділка weekStart) звичку виконано повністю */
function weekDoneCount(doneSet, weekStart, upto = null) {
  let n = 0;
  for (let i = 0; i < 7; i++) {
    const d = addDays(weekStart, i);
    if (upto && d > upto) break;
    if (doneSet.has(d)) n++;
  }
  return n;
}

/**
 * Статистика звички.
 * Серії:
 *  - «щодня»: днів поспіль; сьогоднішній невиконаний день серію ще не обриває;
 *  - «обрані дні»: поспіль виконаних запланованих днів, незаплановані дні пропускаються;
 *  - «N разів на тиждень»: тижнів поспіль, у яких виконано ≥ N днів; поточний тиждень,
 *    де норму ще не набрано, серію не обриває.
 */
export function habitStats(h, counts /* Map date->count */, today) {
  const target = habitTarget(h);
  const doneSet = new Set();
  for (const [d, c] of counts || []) if (c >= target && d <= today) doneSet.add(d);
  const doneDates = [...doneSet].sort();
  const created = h.createdAt ? toISODate(new Date(h.createdAt)) : today;
  let start = doneDates.length && doneDates[0] < created ? doneDates[0] : created;
  if (h.startDate && start < h.startDate) start = h.startDate;
  const f = h.freq || { type: 'daily' };
  const unit = f.type === 'weekly' ? 'weeks' : 'days';

  let current = 0;
  let longest = 0;

  if (f.type === 'weekly') {
    const n = Math.max(1, Math.min(7, Number(f.times) || 1));
    const thisWeek = startOfWeek(today);
    let w = thisWeek;
    if (weekDoneCount(doneSet, w, today) >= n) current++;
    w = addDays(w, -7);
    const firstWeek = startOfWeek(start);
    while (w >= firstWeek && weekDoneCount(doneSet, w) >= n) {
      current++;
      w = addDays(w, -7);
    }
    let run = 0;
    for (let wk = firstWeek; wk <= thisWeek; wk = addDays(wk, 7)) {
      if (weekDoneCount(doneSet, wk, today) >= n) {
        run++;
        longest = Math.max(longest, run);
      } else if (wk !== thisWeek) run = 0;
    }
  } else {
    const sched = (d) => isHabitCounted(h, d);
    let d = today;
    if (sched(d) && !doneSet.has(d)) d = addDays(d, -1);
    let guard = 0;
    while (d >= start && guard++ < 4000) {
      if (sched(d)) {
        if (doneSet.has(d)) current++;
        else break;
      }
      d = addDays(d, -1);
    }
    let run = 0;
    for (let x = start; x <= today; x = addDays(x, 1)) {
      if (!sched(x)) continue;
      if (doneSet.has(x)) {
        run++;
        longest = Math.max(longest, run);
      } else if (x !== today) run = 0;
    }
  }
  longest = Math.max(longest, current);

  const rate = (days) => completionRate(h, doneSet, today, days, start);
  return {
    target,
    current,
    longest,
    unit,
    totalDone: doneDates.length,
    week: rate(7),
    month: rate(30),
    year: rate(365),
    doneSet,
    start,
  };
}

/** Відсоток виконання за останні N днів (до сьогодні включно), не раніше початку звички */
export function completionRate(h, doneSet, today, days, start) {
  let from = addDays(today, -(days - 1));
  if (start && from < start) from = start;
  if (from > today) return null;
  const f = h.freq || { type: 'daily' };
  let expected = 0;
  let done = 0;
  if (f.type === 'weekly') {
    const n = Math.max(1, Math.min(7, Number(f.times) || 1));
    const span = daysBetween(from, today) + 1;
    expected = (n * span) / 7;
    // сума по тижнях: не більше N зарахованих днів на тиждень
    const perWeek = new Map();
    for (let d = from; d <= today; d = addDays(d, 1)) {
      if (doneSet.has(d)) {
        const w = startOfWeek(d);
        perWeek.set(w, Math.min(n, (perWeek.get(w) || 0) + 1));
      }
    }
    for (const v of perWeek.values()) done += v;
  } else {
    for (let d = from; d <= today; d = addDays(d, 1)) {
      if (!isHabitCounted(h, d)) continue;
      expected++;
      if (doneSet.has(d)) done++;
    }
  }
  if (expected <= 0) return null;
  return Math.round(Math.min(1, done / expected) * 100);
}

/** Стовпчики по тижнях: [{weekStart, done, goal}] за останні `weeks` тижнів */
export function weeklyBars(h, doneSet, today, weeks = 12) {
  const f = h.freq || { type: 'daily' };
  const goal = f.type === 'weekly' ? Number(f.times) || 1 : f.type === 'days' ? (f.days || []).length : 7;
  const out = [];
  const cur = startOfWeek(today);
  for (let i = weeks - 1; i >= 0; i--) {
    const ws = addDays(cur, -7 * i);
    out.push({ weekStart: ws, done: weekDoneCount(doneSet, ws, today), goal });
  }
  return out;
}

/* --------------------------- Різне ---------------------------- */

/** Розбір швидкого додавання: «Зателефонувати 15:30» → {title, time} */
export function parseQuickAdd(text) {
  let title = text.trim();
  let time = null;
  const m = title.match(/(?:^|\s)(?:о\s)?([01]?\d|2[0-3])[:.]([0-5]\d)(?=\s|$)/);
  if (m) {
    time = `${pad(Number(m[1]))}:${m[2]}`;
    title = (title.slice(0, m.index) + ' ' + title.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim();
  }
  let priority = null;
  if (/(^|\s)!(\s|$)/.test(title)) {
    priority = 1;
    title = title.replace(/(^|\s)!(\s|$)/, ' ').trim();
  }
  return { title: title || text.trim(), time, priority };
}

export function uuid() {
  if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
