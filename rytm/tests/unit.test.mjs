// Модульні тести логіки (Node 18+). Запуск: node --test tests/unit.test.mjs
// Корисно запускати в різних часових поясах:  TZ=Europe/Kyiv node --test …  /  TZ=America/New_York node --test …
import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../js/logic.js';
import { validateImport, SCHEMA_VERSION } from '../js/storage.js';

const T = (o) => ({ id: o.id || 't' + Math.random(), title: 'x', priority: 2, reminders: [], createdAt: '2026-01-01T00:00:00Z', ...o });

test('дати: тиждень з понеділка, додавання днів через перехід на літній час', () => {
  assert.equal(L.weekday('2026-11-16'), 1); // понеділок
  assert.equal(L.weekday('2026-11-22'), 7); // неділя
  assert.equal(L.startOfWeek('2026-11-22'), '2026-11-16');
  assert.equal(L.startOfWeek('2026-11-16'), '2026-11-16');
  assert.equal(L.addDays('2026-03-28', 1), '2026-03-29');
  assert.equal(L.addDays('2026-03-29', 1), '2026-03-30');
  assert.equal(L.addDays('2026-10-24', 2), '2026-10-26');
  assert.equal(L.daysBetween('2026-03-25', '2026-04-05'), 11);
});

test('повторення: щодня, по буднях, щотижня в обрані дні', () => {
  const d = T({ date: '2026-11-18', repeat: { type: 'daily' } });
  assert.equal(L.occursOn(d, '2026-11-17'), false, 'не раніше дати початку');
  assert.equal(L.occursOn(d, '2026-11-18'), true);
  assert.equal(L.occursOn(d, '2027-02-01'), true);
  const wd = T({ date: '2026-11-16', repeat: { type: 'weekdays' } });
  assert.deepEqual(L.rangeDays('2026-11-16', '2026-11-22').map((x) => L.occursOn(wd, x)), [true, true, true, true, true, false, false]);
  const w = T({ date: '2026-11-16', repeat: { type: 'weekly', days: [2, 4] } });
  assert.deepEqual(L.rangeDays('2026-11-16', '2026-11-22').filter((x) => L.occursOn(w, x)), ['2026-11-17', '2026-11-19']);
});

test('повторення щомісяця: 31 число → останній день коротшого місяця', () => {
  const m = T({ date: '2026-01-31', repeat: { type: 'monthly' } });
  assert.equal(L.occursOn(m, '2026-02-28'), true);
  assert.equal(L.occursOn(m, '2026-02-27'), false);
  assert.equal(L.occursOn(m, '2026-04-30'), true);
  assert.equal(L.occursOn(m, '2026-05-31'), true);
  assert.equal(L.occursOn(m, '2026-05-30'), false);
  const m29 = T({ date: '2027-01-29', repeat: { type: 'monthly' } });
  assert.equal(L.occursOn(m29, '2027-02-28'), true);
  assert.equal(L.occursOn(m29, '2028-02-29'), true, 'високосний рік');
  assert.equal(L.occursOn(m29, '2028-02-28'), false);
});

test('випадки дня: виконання й «Відкласти» одного випадку повторюваного завдання', () => {
  const t = T({ id: 'r', date: '2026-11-01', time: '09:00', repeat: { type: 'daily' } });
  const snoozed = L.applySnooze(t, '2026-11-20', { date: '2026-11-21', time: '10:00' });
  assert.equal(snoozed.repeat.type, 'daily', 'правило не змінилось');
  const done = new Set();
  assert.equal(L.occurrencesForDay([snoozed], done, '2026-11-20').length, 0, 'випадок 20-го переїхав');
  const d21 = L.occurrencesForDay([snoozed], done, '2026-11-21');
  assert.equal(d21.length, 2, '21-го: власний випадок + перенесений');
  const moved = d21.find((o) => o.occDate === '2026-11-20');
  assert.equal(moved.time, '10:00');
  assert.equal(moved.snoozed, true);
  assert.equal(L.occurrencesForDay([snoozed], done, '2026-11-22').length, 1, 'інші дні без змін');
  done.add(L.occKey('r', '2026-11-20'));
  assert.equal(L.occurrencesForDay([snoozed], done, '2026-11-21').find((o) => o.occDate === '2026-11-20').done, true);
});

test('прострочені: тільки невиконані разові з минулих днів', () => {
  const tasks = [
    T({ id: 'a', date: '2026-11-18' }),
    T({ id: 'b', date: '2026-11-18', done: true }),
    T({ id: 'c', date: '2026-11-20' }),
    T({ id: 'd', date: '2026-11-01', repeat: { type: 'daily' } }),
  ];
  assert.deepEqual(L.overdueItems(tasks, new Set(), '2026-11-20').map((o) => o.task.id), ['a']);
  const moved = L.moveOccurrence(tasks[0], '2026-11-18', '2026-11-20');
  assert.equal(moved.date, '2026-11-20');
});

test('сортування: з часом за часом, потім без часу за пріоритетом; ручний порядок', () => {
  const mk = (id, time, priority) => ({ key: id, time, task: T({ id, priority }) });
  const items = [mk('a', null, 3), mk('b', '15:00', 2), mk('c', null, 1), mk('d', '09:00', 3)];
  assert.deepEqual(L.sortOpen(items).map((x) => x.key), ['d', 'b', 'c', 'a']);
  assert.deepEqual(L.sortOpen(items, ['a', 'd', 'b', 'c']).map((x) => x.key), ['a', 'd', 'b', 'c']);
  // нове завдання без ручної позиції стоїть на місці за правилом
  assert.deepEqual(L.sortOpen([...items, mk('e', '08:00', 2)], ['a', 'd', 'b', 'c']).map((x) => x.key), ['e', 'a', 'd', 'b', 'c']);
});

test('«Відкласти»: усі варіанти', () => {
  const now = new Date(2026, 10, 20, 23, 30); // пт 20.11, 23:30
  assert.deepEqual(L.snoozeTarget('10m', now), { date: '2026-11-20', time: '23:40' });
  assert.deepEqual(L.snoozeTarget('1h', now), { date: '2026-11-21', time: '00:30' }, 'через північ');
  assert.deepEqual(L.snoozeTarget('3h', now), { date: '2026-11-21', time: '02:30' });
  assert.deepEqual(L.snoozeTarget('evening', now), { date: '2026-11-21', time: '20:00' }, 'після 20:00 — завтра ввечері');
  assert.deepEqual(L.snoozeTarget('evening', new Date(2026, 10, 20, 12, 0)), { date: '2026-11-20', time: '20:00' });
  assert.deepEqual(L.snoozeTarget('tomorrow', now), { date: '2026-11-21', time: '09:00' });
  assert.deepEqual(L.snoozeTarget('monday', now), { date: '2026-11-23', time: '09:00' });
  assert.deepEqual(L.snoozeTarget('monday', new Date(2026, 10, 23, 8, 0)), { date: '2026-11-30', time: '09:00' }, 'з понеділка — на наступний');
  assert.deepEqual(L.snoozeTarget('custom', now, { date: '2026-12-01', time: '07:15' }), { date: '2026-12-01', time: '07:15' });
  const one = L.applySnooze(T({ date: '2026-11-20', time: '10:00', reminders: [10] }), '2026-11-20', { date: '2026-11-20', time: '11:00' });
  assert.equal(one.time, '11:00');
  assert.equal(one.snoozed, true);
});

test('нагадування: зсуви, відкладене — рівно в новий час, виконані пропускаються', () => {
  const t = T({ id: 'x', date: '2026-11-20', time: '10:00', reminders: [0, 10] });
  const from = new Date(2026, 10, 20, 9, 0).getTime();
  const to = new Date(2026, 10, 20, 11, 0).getTime();
  const ev = L.reminderEvents([t], new Set(), from, to);
  assert.equal(ev.length, 2);
  assert.equal(new Date(ev[0].at).getHours() * 60 + new Date(ev[0].at).getMinutes(), 9 * 60 + 50);
  assert.equal(new Date(ev[1].at).getHours(), 10);
  const sn = L.applySnooze(t, '2026-11-20', { date: '2026-11-20', time: '11:00' });
  const ev2 = L.reminderEvents([sn], new Set(), from, new Date(2026, 10, 20, 12, 0).getTime());
  assert.equal(ev2.length, 1, 'відкладене нагадує один раз');
  assert.equal(new Date(ev2[0].at).getHours(), 11);
  assert.equal(L.reminderEvents([{ ...t, done: true }], new Set(), from, to).length, 0);
  // за 1 день: нагадування у вікні попереднього дня
  const tomorrowTask = T({ id: 'y', date: '2026-11-21', time: '09:00', reminders: [1440] });
  assert.equal(L.reminderEvents([tomorrowTask], new Set(), new Date(2026, 10, 20, 8, 0).getTime(), new Date(2026, 10, 20, 10, 0).getTime()).length, 1);
});

test('нагадування в місцевому часі: 9:00 лишається 9:00 у будь-якому поясі', () => {
  const t = T({ id: 'z', date: '2026-07-01', time: '09:00', reminders: [0] });
  const ev = L.reminderEvents([t], new Set(), new Date(2026, 6, 1, 0, 0).getTime(), new Date(2026, 6, 1, 23, 59).getTime());
  assert.equal(ev.length, 1);
  assert.equal(new Date(ev[0].at).getHours(), 9, `TZ=${process.env.TZ || 'system'}`);
});

test('тихі години: через північ і в межах дня', () => {
  const q = { enabled: true, from: '23:00', to: '08:00' };
  assert.equal(L.inQuietHours(new Date(2026, 0, 1, 23, 30), q), true);
  assert.equal(L.inQuietHours(new Date(2026, 0, 1, 7, 59), q), true);
  assert.equal(L.inQuietHours(new Date(2026, 0, 1, 8, 0), q), false);
  assert.equal(L.inQuietHours(new Date(2026, 0, 1, 12, 0), q), false);
  assert.equal(L.inQuietHours(new Date(2026, 0, 1, 13, 0), { enabled: true, from: '12:00', to: '14:00' }), true);
  assert.equal(L.inQuietHours(new Date(2026, 0, 1, 23, 30), { ...q, enabled: false }), false);
});

const counts = (dates, n = 1) => new Map(dates.map((d) => [d, n]));

test('звичка щодня: серія, сьогодні ще не обриває, відмітка заднім числом перераховує', () => {
  const h = { id: 'h', freq: { type: 'daily' }, goal: { type: 'bool' }, createdAt: '2026-11-01T10:00:00Z' };
  const c = counts(['2026-11-17', '2026-11-18', '2026-11-19']);
  let s = L.habitStats(h, c, '2026-11-20');
  assert.equal(s.current, 3);
  assert.equal(s.longest, 3);
  c.set('2026-11-15', 1);
  c.set('2026-11-14', 1);
  s = L.habitStats(h, c, '2026-11-20');
  assert.equal(s.current, 3, 'пропуск 16-го обриває');
  c.set('2026-11-16', 1); // заднім числом
  s = L.habitStats(h, c, '2026-11-20');
  assert.equal(s.current, 6);
  assert.equal(s.longest, 6);
  c.set('2026-11-20', 1);
  s = L.habitStats(h, c, '2026-11-20');
  assert.equal(s.current, 7);
  assert.equal(s.week, 100);
});

test('звичка в обрані дні: незаплановані дні серію не обривають', () => {
  const h = { id: 'h', freq: { type: 'days', days: [1, 3, 5] }, goal: { type: 'bool' }, createdAt: '2026-11-01T10:00:00Z' };
  // пн 9, ср 11, пт 13, пн 16, ср 18 — виконано; пт 20 (сьогодні) ще ні
  const c = counts(['2026-11-09', '2026-11-11', '2026-11-13', '2026-11-16', '2026-11-18']);
  const s = L.habitStats(h, c, '2026-11-20');
  assert.equal(s.current, 5);
  assert.equal(s.week, 67, 'за 7 днів: 2 з 3 запланованих');
});

test('звичка N разів на тиждень: серія в тижнях', () => {
  const h = { id: 'h', freq: { type: 'weekly', times: 2 }, goal: { type: 'bool' }, createdAt: '2026-10-20T10:00:00Z' };
  const c = counts(['2026-11-02', '2026-11-05', '2026-11-10', '2026-11-12', '2026-11-17']);
  const s = L.habitStats(h, c, '2026-11-20');
  assert.equal(s.unit, 'weeks');
  assert.equal(s.current, 2, 'тижні 02.11 і 09.11 виконані; поточний (1 з 2) ще триває');
  c.set('2026-11-19', 1);
  assert.equal(L.habitStats(h, c, '2026-11-20').current, 3);
});

test('кількісна звичка: день зараховано, коли досягнуто цілі', () => {
  const h = { id: 'w', freq: { type: 'daily' }, goal: { type: 'count', target: 8 }, createdAt: '2026-11-18T10:00:00Z' };
  const c = new Map([['2026-11-18', 8], ['2026-11-19', 5], ['2026-11-20', 9]]);
  const s = L.habitStats(h, c, '2026-11-20');
  assert.equal(s.current, 1);
  assert.equal(s.totalDone, 2);
  assert.equal(s.week, 67);
  const bars = L.weeklyBars(h, s.doneSet, '2026-11-20', 4);
  assert.equal(bars.length, 4);
  assert.equal(bars[3].done, 2);
});

test('швидке додавання: час і пріоритет з тексту', () => {
  assert.deepEqual(L.parseQuickAdd('Зателефонувати 15:30'), { title: 'Зателефонувати', time: '15:30', priority: null });
  assert.deepEqual(L.parseQuickAdd('о 9:05 зарядка !'), { title: 'зарядка', time: '09:05', priority: 1 });
  assert.deepEqual(L.parseQuickAdd('Купити хліб'), { title: 'Купити хліб', time: null, priority: null });
});

test('перевірка файлу імпорту', () => {
  const good = { app: 'rytm', schemaVersion: SCHEMA_VERSION, data: { tasks: [{ id: '1', title: 'a' }], habits: [], completions: [{ id: 'c', kind: 'habit', refId: 'h', date: '2026-11-20', count: 1 }], meta: [] } };
  assert.equal(validateImport(good).ok, true);
  assert.equal(validateImport(good).summary.tasks, 1);
  assert.equal(validateImport({ app: 'other' }).ok, false);
  assert.equal(validateImport({ ...good, schemaVersion: 99 }).ok, false);
  assert.equal(validateImport({ ...good, data: { ...good.data, tasks: [{ title: 'без id' }] } }).ok, false);
  assert.equal(validateImport(null).ok, false);
});
