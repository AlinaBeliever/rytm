// Приклади при першому запуску. Позначені sample: true — видаляються однією кнопкою.
import * as store from './storage.js';
import { todayISO, addDays, startOfWeek } from './logic.js';

export async function seedSamplesIfFirstRun() {
  if (await store.getMeta('seeded')) return false;
  const [tasks, habits] = await Promise.all([store.getTasks({ includeDeleted: true }), store.getHabits({ includeDeleted: true })]);
  await store.setMeta('seeded', true);
  if (tasks.length || habits.length) return false;

  const today = todayISO();
  const s = { sample: true };
  await store.saveTask({ ...s, title: 'Подивитися, як працює Ритм 👋', note: 'Натисніть на коло ліворуч, щоб відмітити завдання. Ще раз — щоб повернути.', date: today, priority: 1, reminders: [] });
  await store.saveTask({ ...s, title: 'Зателефонувати клієнту', date: today, time: '15:00', priority: 1, reminders: [10] });
  await store.saveTask({ ...s, title: 'Ранкова зарядка', date: addDays(today, -3), time: '07:30', priority: 2, repeat: { type: 'daily' }, reminders: [0] });
  await store.saveTask({ ...s, title: 'Відповісти на листи', date: addDays(today, -1), priority: 2, reminders: [] });
  await store.saveTask({ ...s, title: 'Купити продукти', date: addDays(today, 1), priority: 3, reminders: [] });
  await store.saveTask({ ...s, title: 'Оновити портфоліо', date: null, weekOf: startOfWeek(today), priority: 2, reminders: [] });
  await store.saveTask({ ...s, title: 'Ідеї для відпустки', date: null, priority: 3, reminders: [] });

  const water = await store.saveHabit({ ...s, name: 'Пити воду', emoji: '💧', color: '#3b6fd1', freq: { type: 'daily' }, goal: { type: 'count', target: 8, unit: 'склянок' }, order: 0 });
  const read = await store.saveHabit({ ...s, name: 'Читати 20 хв', emoji: '📖', color: '#2f7d6d', freq: { type: 'daily' }, goal: { type: 'bool' }, order: 1 });
  const sport = await store.saveHabit({ ...s, name: 'Спорт', emoji: '🏃', color: '#cc5a32', freq: { type: 'weekly', times: 3 }, goal: { type: 'bool' }, order: 2 });

  // трохи історії, щоб статистика не була порожньою
  const pattern = [1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1, 0, 1, 1, 1, 1, 1];
  for (let i = 1; i <= pattern.length; i++) {
    const d = addDays(today, -i);
    if (pattern[i - 1]) await store.setCompletion('habit', read.id, d, 1);
    await store.setCompletion('habit', water.id, d, 4 + ((i * 3) % 5));
    if (i % 2 === 0 && i < 15) await store.setCompletion('habit', sport.id, d, 1);
  }
  await store.setCompletion('habit', water.id, today, 3);
  return true;
}
