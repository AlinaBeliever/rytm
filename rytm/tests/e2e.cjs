// Наскрізні тести в справжньому браузері (Chromium через Playwright).
// Запуск: 1) python3 -m http.server 8123   2) node tests/e2e.cjs
// Перевіряє «Критерії готовності» у двох розмірах: телефон 390×844 і ноутбук 1440×900.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE_URL || 'http://localhost:8123/';
const SHOTS = path.join(__dirname, 'screens');
fs.mkdirSync(SHOTS, { recursive: true });

const START = new Date('2026-11-20T10:00:00+02:00'); // пт, 20 листопада 2026, 10:00 за Києвом
const results = [];
function check(vp, name, ok, info = '') {
  results.push({ vp, name, ok: !!ok, info });
  console.log(`${ok ? '✅' : '❌'} [${vp}] ${name}${info ? ' — ' + info : ''}`);
}

const INIT = () => {
  window.__notifs = [];
  window.__sounds = [];
  window.__reminders = [];
  const orig = ServiceWorkerRegistration.prototype.showNotification;
  ServiceWorkerRegistration.prototype.showNotification = function (title, opts) {
    window.__notifs.push({ title, body: opts && opts.body, actions: (opts && opts.actions || []).map((a) => a.action) });
    return orig.call(this, title, opts).catch(() => {});
  };
  window.addEventListener('rytm:sound', (e) => window.__sounds.push(e.detail));
  window.addEventListener('rytm:reminder', (e) => window.__reminders.push(e.detail));
};

async function openNewTaskForm(page) {
  const fab = page.locator('#fab');
  if (await fab.isVisible()) await fab.click();
  else {
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.keyboard.press('n');
  }
  await page.locator('dialog .task-form').waitFor();
}

async function setChip(cb, want) {
  if ((await cb.isChecked()) !== want) await cb.click();
}

async function addTask(page, { title, date, time, repeat, days, reminders, when }) {
  await openNewTaskForm(page);
  const f = page.locator('dialog .task-form');
  await f.locator('[name=title]').fill(title);
  if (when) await f.locator(`[name=when][value=${when}]`).click();
  if (date) await f.locator('[name=date]').fill(date);
  if (time) await f.locator('[name=time]').fill(time);
  if (repeat) await f.locator('[name=repeat]').selectOption(repeat);
  if (days) {
    for (const cb of await f.locator('[name=rdays]').all()) await setChip(cb, days.includes(Number(await cb.getAttribute('value'))));
  }
  if (reminders) {
    for (const cb of await f.locator('[name=rem]').all()) await setChip(cb, reminders.includes(Number(await cb.getAttribute('value'))));
  }
  await f.locator('button[type=submit]').click();
  await page.locator('dialog').waitFor({ state: 'detached' });
  await page.waitForTimeout(250);
}

const taskRow = (page, title) => page.locator('li.task', { hasText: title });

async function run(vpName, viewport) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport, locale: 'uk-UA', timezoneId: 'Europe/Kyiv', acceptDownloads: true });
  await context.grantPermissions(['notifications'], { origin: new URL(BASE).origin });
  const page = await context.newPage();
  const errors = [];
  const warnings = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
    if (m.type() === 'warning') warnings.push(m.text());
  });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.addInitScript(INIT);
  await page.clock.install({ time: START });
  await page.goto(BASE);
  await page.waitForSelector('html.ready');
  await page.waitForTimeout(400);

  // 0. Приклади при першому запуску
  const sampleCount = await page.locator('li.task .tag', { hasText: 'приклад' }).count();
  check(vpName, 'Приклади показані при першому запуску', sampleCount >= 3, `${sampleCount} завдань-прикладів`);
  await page.screenshot({ path: `${SHOTS}/${vpName}-light-today-samples.png` });
  await page.locator('[data-action=delete-samples]').first().click();
  await page.waitForTimeout(400);
  check(vpName, 'Приклади видаляються одним кліком', (await page.locator('li.task').count()) === 0);

  // 1. Додавання й галочка
  const quick = page.locator('#quick-input');
  if (await quick.isVisible()) {
    await quick.fill('Купити каву 16:00');
    await quick.press('Enter');
    await page.waitForTimeout(300);
    check(vpName, 'Швидке додавання з часом (ноутбук)', (await taskRow(page, 'Купити каву').textContent()).includes('16:00'));
    await addTask(page, { title: 'Прочитати розділ' });
    await addTask(page, { title: 'Написати клієнту', time: '12:00', reminders: [] });
  } else {
    check(vpName, 'Плаваюча кнопка «+» на телефоні', await page.locator('#fab').isVisible());
    await addTask(page, { title: 'Купити каву', time: '16:00', reminders: [] });
    await addTask(page, { title: 'Прочитати розділ' });
    await addTask(page, { title: 'Написати клієнту', time: '12:00', reminders: [] });
  }
  const order = await page.locator('.open-list li.task .task-title').allTextContents();
  check(vpName, 'Порядок: спершу з часом (за часом), потім без часу', order.join('|') === 'Написати клієнту|Купити каву|Прочитати розділ', order.join(' | '));

  await taskRow(page, 'Написати клієнту').locator('[data-action=toggle]').click();
  await page.waitForTimeout(700);
  const inDone = await page.locator('.done-list li.task', { hasText: 'Написати клієнту' }).count();
  const visible = await page.locator('.done-list li.task', { hasText: 'Написати клієнту' }).isVisible();
  const lastOpen = await page.locator('.done-list li.task').last().locator('.task-title').evaluate((el) => getComputedStyle(el).textDecorationLine);
  check(vpName, 'Відмічене завдання опускається в «Виконано», видиме й закреслене', inDone === 1 && visible && lastOpen.includes('line-through'));
  await page.locator('.done-list li.task', { hasText: 'Написати клієнту' }).locator('[data-action=toggle]').click();
  await page.waitForTimeout(700);
  check(vpName, 'Повторний клік повертає завдання вгору', (await page.locator('.open-list li.task', { hasText: 'Написати клієнту' }).count()) === 1);

  // згортання «Виконано» запам'ятовується
  await taskRow(page, 'Прочитати розділ').locator('[data-action=toggle]').click();
  await page.waitForTimeout(600);
  await page.locator('.done-head').click();
  await page.waitForTimeout(200);
  await page.reload();
  await page.waitForSelector('html.ready');
  await page.waitForTimeout(300);
  const collapsed = await page.locator('.done-block.collapsed').count();
  check(vpName, 'Дані зберігаються після перезавантаження', (await page.locator('li.task', { hasText: 'Купити каву' }).count()) === 1);
  check(vpName, 'Стан «Виконано згорнуто» запам\'ятовується', collapsed === 1);
  await page.locator('.done-head').click();

  // 2. Навігація по днях
  await addTask(page, { title: 'Завтрашня справа', date: '2026-11-21' });
  await addTask(page, { title: 'Минула справа', date: '2026-11-18' });
  check(vpName, 'Завдання на інший день не з\'являється сьогодні', (await taskRow(page, 'Завтрашня справа').count()) === 0);
  check(vpName, 'Невиконане з минулого дня — у блоці «Прострочено»', (await page.locator('.overdue-block li.task', { hasText: 'Минула справа' }).count()) === 1);
  if (viewport.width >= 900) {
    await page.locator('[data-action=day-next]').click();
  } else {
    await page.locator('.date-chip[data-date="2026-11-21"]').click();
  }
  await page.waitForTimeout(300);
  check(vpName, 'Перехід на наступний день показує його завдання', (await taskRow(page, 'Завтрашня справа').count()) === 1);
  await page.locator('.date-chip[data-date="2026-11-18"]').click();
  await page.waitForTimeout(300);
  check(vpName, 'Перегляд минулого дня', (await taskRow(page, 'Минула справа').count()) === 1);
  await page.locator('[data-action=go-today]').click();
  await page.waitForTimeout(300);
  await page.locator('.overdue-block li.task', { hasText: 'Минула справа' }).locator('[data-action=move-today]').click();
  await page.waitForTimeout(400);
  check(vpName, '«Перенести на сьогодні» працює', (await page.locator('.open-list li.task', { hasText: 'Минула справа' }).count()) === 1);

  // 3. Повторювані завдання: щотижня пн і ср, з 20.11 (пт)
  await addTask(page, { title: 'Йога', date: '2026-11-20', repeat: 'weekly', days: [1, 3], reminders: [] });
  await addTask(page, { title: 'Вітаміни', date: '2026-11-20', repeat: 'daily', reminders: [] });
  await page.goto(BASE + '#/week');
  await page.waitForTimeout(400);
  await page.locator('[data-action=week-next]').click();
  await page.waitForTimeout(400);
  const yogaDays = await page.locator('.week-day').evaluateAll((els) =>
    els.filter((el) => [...el.querySelectorAll('.task-title')].some((t) => t.textContent === 'Йога')).map((el) => el.dataset.date)
  );
  check(vpName, 'Повторюване «щотижня пн, ср» — у правильні дні', yogaDays.join(',') === '2026-11-23,2026-11-25', yogaDays.join(', '));
  const vitDays = await page.locator('.week-day').evaluateAll((els) =>
    els.filter((el) => [...el.querySelectorAll('.task-title')].some((t) => t.textContent === 'Вітаміни')).length
  );
  check(vpName, 'Повторюване «щодня» — у всі 7 днів наступного тижня', vitDays === 7, String(vitDays));
  const cols = await page.locator('.week-day').count();
  check(vpName, 'Тиждень: 7 днів + блок «Завдання на тиждень»', cols === 7 && (await page.locator('.week-tasks').count()) === 1);
  await page.locator('[data-action=week-this]').click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/${vpName}-light-week.png`, fullPage: viewport.width < 900 });

  // виконання повторюваного сьогодні не впливає на завтра
  await page.goto(BASE + '#/today');
  await page.waitForTimeout(400);
  await taskRow(page, 'Вітаміни').locator('[data-action=toggle]').click();
  await page.waitForTimeout(600);
  await page.locator('.date-chip[data-date="2026-11-21"]').click();
  await page.waitForTimeout(300);
  check(vpName, 'Виконання повторюваного сьогодні не відмічає завтрашній випадок', (await page.locator('.open-list li.task', { hasText: 'Вітаміни' }).count()) === 1);
  await page.locator('[data-action=go-today]').click();
  await page.waitForTimeout(300);

  // 4. Нагадування: увімкнути, створити завдання на 10:05 з нагадуванням «у момент»
  await page.goto(BASE + '#/settings');
  await page.waitForTimeout(300);
  await page.locator('[data-action=notif-on]').click();
  await page.waitForTimeout(500);
  check(vpName, 'Кнопка «Увімкнути нагадування» вмикає сповіщення', (await page.locator('[data-action=notif-off]').count()) === 1);
  await page.screenshot({ path: `${SHOTS}/${vpName}-light-settings.png`, fullPage: true });
  await page.goto(BASE + '#/today');
  await page.waitForTimeout(300);
  await addTask(page, { title: 'Дзвінок лікарю', time: '10:05', reminders: [0] });
  await page.evaluate(() => { window.__notifs.length = 0; window.__sounds.length = 0; });
  await page.clock.fastForward('05:30');
  await page.waitForTimeout(1500);
  let st = await page.evaluate(() => ({ n: window.__notifs, s: window.__sounds.length }));
  const n1 = st.n.find((x) => x.title === 'Дзвінок лікарю');
  check(vpName, 'Нагадування в заданий час: системне сповіщення', !!n1, n1 ? n1.body : JSON.stringify(st.n));
  check(vpName, 'Нагадування зі звуком', st.s >= 1);
  check(vpName, 'У сповіщенні дії «Виконано» і «Відкласти на 15 хв»', n1 && n1.actions.join() === 'done,snooze15');
  const sheet = page.locator('dialog', { hasText: 'Дзвінок лікарю' });
  check(vpName, 'У відкритому додатку з\'являється шторка нагадування', await sheet.isVisible());
  await page.screenshot({ path: `${SHOTS}/${vpName}-light-reminder.png` });

  // 5. «Відкласти на 1 год» із шторки нагадування
  await sheet.locator('[data-a=snooze]').click();
  await page.locator('[data-opt="1h"]').click();
  await page.waitForTimeout(600);
  const meta = await taskRow(page, 'Дзвінок лікарю').textContent();
  check(vpName, '«Відкласти на 1 год» переносить завдання', meta.includes('11:05') && meta.includes('відкладено'), meta.replace(/\s+/g, ' ').trim());
  await page.evaluate(() => { window.__notifs.length = 0; });
  await page.clock.fastForward('30:00');
  await page.waitForTimeout(1200);
  st = await page.evaluate(() => window.__notifs.filter((x) => x.title === 'Дзвінок лікарю').length);
  check(vpName, 'Після «Відкласти» старе нагадування не дублюється', st === 0);
  await page.clock.fastForward('30:10');
  await page.waitForTimeout(1500);
  st = await page.evaluate(() => window.__notifs.filter((x) => x.title === 'Дзвінок лікарю').length);
  check(vpName, '«Відкласти на 1 год» переплановує нагадування', st === 1);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // 5a. Ранкове зведення (вмикаємо на найближчу хвилину)
  await page.evaluate(async () => {
    const s = await import('./js/storage.js');
    const d = new Date(Date.now() + 60000);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    await s.saveSettings({ morningSummary: { enabled: true, time: `${hh}:${mm}` } });
    window.__notifs.length = 0;
  });
  await page.clock.fastForward('02:00');
  await page.waitForTimeout(1500);
  const summary = await page.evaluate(() => window.__notifs.find((x) => x.title === 'Доброго ранку!'));
  check(vpName, 'Ранкове зведення приходить у вибраний час', !!summary, summary ? summary.body : '');
  await page.evaluate(async () => (await import('./js/storage.js')).saveSettings({ morningSummary: { enabled: false, time: '08:00' } }));

  // 5b. Пропущені нагадування після відкриття (додаток «закритий» під час нагадування)
  await addTask(page, { title: 'Пропущена зустріч', time: '12:30', reminders: [0] });
  // імітуємо закриття: ставимо час останньої перевірки на 12:00 і перезавантажуємо після 12:30+5хв
  await page.clock.setSystemTime(new Date('2026-11-20T12:50:00+02:00'));
  await page.evaluate(async () => {
    const s = await import('./js/storage.js');
    await s.setMeta('lastReminderCheck', new Date('2026-11-20T12:00:00+02:00').getTime());
  });
  await page.reload();
  await page.waitForSelector('html.ready');
  await page.waitForTimeout(1200);
  check(vpName, 'Пропущені нагадування показуються після відкриття', await page.locator('dialog', { hasText: 'Пропущені нагадування' }).isVisible());
  await page.locator('dialog', { hasText: 'Пропущені нагадування' }).locator('[data-a=done]').first().click();
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  check(vpName, '«Виконано» зі списку пропущених відмічає завдання', (await page.locator('.done-list li.task', { hasText: 'Пропущена зустріч' }).count()) === 1);

  // 6. Звички і статистика
  await page.goto(BASE + '#/habits');
  await page.waitForTimeout(300);
  await page.locator('[data-action=delete-samples]').first().click().catch(() => {});
  await page.waitForTimeout(300);
  const newHabit = async (name, count) => {
    await page.locator('.view-head [data-action=new-habit]').click();
    const f = page.locator('dialog .habit-form');
    await f.locator('[name=name]').fill(name);
    if (count) {
      await f.locator('[name=goal][value=count]').click();
      await f.locator('[name=target]').fill(String(count));
    }
    await f.locator('button[type=submit]').click();
    await page.locator('dialog').waitFor({ state: 'detached' });
    await page.waitForTimeout(250);
  };
  await newHabit('Вода', 3);
  await newHabit('Читання');
  const water = page.locator('li.habit', { hasText: 'Вода' });
  for (let i = 0; i < 3; i++) {
    await water.locator('[data-action=habit-inc]').click();
    await page.waitForTimeout(200);
  }
  check(vpName, 'Кількісна звичка: «+1» і кільце прогресу', (await water.locator('.habit-plus.is-done').count()) === 1 && (await water.locator('.ring-text').textContent()) === '3');
  await page.locator('li.habit', { hasText: 'Читання' }).locator('[data-action=habit-toggle]').click();
  await page.waitForTimeout(300);
  check(vpName, 'Звичка так/ні: відмітка великою кнопкою', (await page.locator('li.habit', { hasText: 'Читання' }).locator('.habit-check.is-done').count()) === 1);
  await page.screenshot({ path: `${SHOTS}/${vpName}-light-habits.png` });
  await page.locator('li.habit', { hasText: 'Читання' }).locator('.habit-info').click();
  await page.waitForTimeout(400);
  const cur0 = await page.locator('.stat-v').first().textContent();
  for (const d of ['2026-11-19', '2026-11-18', '2026-11-17']) {
    await page.locator(`.cal-cell[data-date="${d}"]`).click();
    await page.waitForTimeout(300);
  }
  const cur1 = await page.locator('.stat-v').first().textContent();
  check(vpName, 'Статистика перераховується після відміток заднім числом', cur0 === '1' && cur1 === '4', `серія ${cur0} → ${cur1}`);
  await page.locator('.cal-cell[data-date="2026-11-18"]').click();
  await page.waitForTimeout(300);
  const cur2 = await page.locator('.stat-v').first().textContent();
  const longest = await page.locator('.stat-v').nth(1).textContent();
  check(vpName, 'Зняття відмітки заднім числом обриває серію', cur2 === '2' && longest === '2', `поточна ${cur2}, найдовша ${longest}`);
  check(vpName, 'Теплова карта, календар і графік по тижнях на місці', (await page.locator('svg.heatmap rect').count()) > 300 && (await page.locator('svg.bars rect').count()) === 12);
  await page.screenshot({ path: `${SHOTS}/${vpName}-light-habit-stats.png`, fullPage: true });

  await page.goto(BASE + '#/progress');
  await page.waitForTimeout(300);
  check(vpName, 'Екран «Прогрес»: сітка 7 днів', (await page.locator('.pg-table tbody tr').count()) === 2 && (await page.locator('.pg-table thead th').count()) === 9);
  await page.locator('[data-action=range][data-r="30"]').click();
  await page.waitForTimeout(300);
  check(vpName, 'Екран «Прогрес»: сітка 30 днів', (await page.locator('.pg-table thead th').count()) === 32);
  await page.screenshot({ path: `${SHOTS}/${vpName}-light-progress.png` });

  // 7. Експорт / імпорт
  await page.goto(BASE + '#/settings');
  await page.waitForTimeout(300);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('[data-action=export]').click()]);
  const file = path.join(SHOTS, `${vpName}-export.json`);
  await dl.saveAs(file);
  const exported = JSON.parse(fs.readFileSync(file, 'utf8'));
  check(vpName, 'Експорт JSON з номером версії схеми', exported.schemaVersion === 1 && exported.data.tasks.some((t) => t.title === 'Йога'), `${exported.data.tasks.length} завдань, ${exported.data.habits.length} звичок`);
  await page.locator('[data-action=wipe]').click();
  await page.locator('dialog [data-v="1"]').click();
  await page.waitForTimeout(400);
  await page.goto(BASE + '#/today');
  await page.waitForTimeout(300);
  const afterWipe = await page.locator('li.task').count();
  await page.goto(BASE + '#/settings');
  await page.waitForTimeout(300);
  const bad = path.join(SHOTS, 'bad.json');
  fs.writeFileSync(bad, JSON.stringify({ app: 'other', data: {} }));
  await page.locator('#import-file').setInputFiles(bad);
  await page.waitForTimeout(400);
  check(vpName, 'Імпорт перевіряє файл і відхиляє чужий', await page.locator('dialog', { hasText: 'Файл не підходить' }).isVisible());
  await page.locator('dialog [data-close]').last().click();
  await page.waitForTimeout(300);
  await page.locator('#import-file').setInputFiles(file);
  await page.locator('dialog [data-m=merge]').click();
  await page.waitForTimeout(600);
  await page.goto(BASE + '#/today');
  await page.waitForTimeout(400);
  check(vpName, 'Імпорт JSON відновлює дані', afterWipe === 0 && (await taskRow(page, 'Купити каву').count()) === 1);

  // 8. Гарячі клавіші (ноутбук)
  if (viewport.width >= 900) {
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(300);
    const t1 = await page.locator('.day-title').textContent();
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(300);
    check(vpName, 'Клавіші ←/→ перемикають дні', t1.startsWith('Завтра'));
    await page.locator('#quick-input').focus();
    await page.keyboard.press('n');
    await page.waitForTimeout(200);
    check(vpName, 'Гарячі клавіші не спрацьовують у полі введення', (await page.locator('dialog').count()) === 0 && (await page.locator('#quick-input').inputValue()) === 'n');
    await page.locator('#quick-input').fill('');
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('n');
    await page.waitForTimeout(300);
    check(vpName, 'Клавіша N відкриває нове завдання', (await page.locator('dialog .task-form').count()) === 1);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await page.locator('.open-list li.task').first().focus();
    const firstTitle = await page.locator('.open-list li.task').first().locator('.task-title').textContent();
    await page.keyboard.press(' ');
    await page.waitForTimeout(700);
    check(vpName, 'Пробіл відмічає виділене завдання', (await page.locator('.done-list li.task', { hasText: firstTitle }).count()) >= 1, firstTitle);
    await page.keyboard.press(' ');
    await page.waitForTimeout(700);

    // перетягування мишею
    const before = await page.locator('.open-list li.task .task-title').allTextContents();
    const a = await page.locator('.open-list li.task').nth(0).locator('.task-main').boundingBox();
    const b = await page.locator('.open-list li.task').nth(2).locator('.task-main').boundingBox();
    await page.mouse.move(a.x + 40, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x + 40, a.y + a.height / 2 + 10, { steps: 3 });
    await page.mouse.move(b.x + 40, b.y + b.height / 2 + 8, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(500);
    const after = await page.locator('.open-list li.task .task-title').allTextContents();
    check(vpName, 'Порядок змінюється перетягуванням', after[2] === before[0] && after[0] === before[1], `${before.slice(0, 3).join(', ')} → ${after.slice(0, 3).join(', ')}`);
    await page.reload();
    await page.waitForSelector('html.ready');
    await page.waitForTimeout(300);
    const persisted = await page.locator('.open-list li.task .task-title').allTextContents();
    check(vpName, 'Ручний порядок зберігається', persisted.join() === after.join());
  } else {
    // довге натискання на телефоні
    await page.close();
    const tctx = await browser.newContext({ viewport, locale: 'uk-UA', timezoneId: 'Europe/Kyiv', hasTouch: true, isMobile: true });
    const tp = await tctx.newPage();
    tp.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    await tp.goto(BASE);
    await tp.waitForSelector('html.ready');
    await tp.waitForTimeout(500);
    const titles0 = await tp.locator('.open-list li.task .task-title').allTextContents();
    const box0 = await tp.locator('.open-list li.task').nth(0).locator('.task-main').boundingBox();
    const box2 = await tp.locator('.open-list li.task').nth(2).locator('.task-main').boundingBox();
    const cdp = await tctx.newCDPSession(tp);
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    const x = box0.x + 60;
    await touch('touchStart', x, box0.y + box0.height / 2);
    await tp.waitForTimeout(650);
    for (let i = 1; i <= 10; i++) await touch('touchMove', x, box0.y + box0.height / 2 + ((box2.y + box2.height - box0.y - box0.height / 2 - 4) * i) / 10);
    await touch('touchEnd', x, 0);
    await tp.waitForTimeout(500);
    const titles1 = await tp.locator('.open-list li.task .task-title').allTextContents();
    check(vpName, 'Перетягування після довгого натискання (телефон)', titles1[2] === titles0[0], `${titles0.slice(0, 3).join(', ')} → ${titles1.slice(0, 3).join(', ')}`);
    await tctx.close();
  }

  // 9. Темна тема — скриншоти
  const p2 = await context.newPage();
  p2.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  p2.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await p2.emulateMedia({ colorScheme: 'dark' });
  for (const r of ['today', 'week', 'habits', 'progress']) {
    await p2.goto(BASE + '#/' + r);
    await p2.waitForSelector('html.ready');
    await p2.waitForTimeout(400);
    await p2.screenshot({ path: `${SHOTS}/${vpName}-dark-${r}.png` });
  }
  // жодної горизонтальної прокрутки сторінки на жодному екрані
  await p2.goto(BASE + '#/habits');
  await p2.waitForTimeout(300);
  const hid = await p2.locator('.habit-info').first().getAttribute('href');
  const overflow = [];
  for (const r of ['#/today', '#/week', '#/nodate', '#/habits', hid, '#/progress', '#/settings']) {
    await p2.goto(BASE + r);
    await p2.waitForTimeout(350);
    const w = await p2.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (w > 0) overflow.push(`${r}: +${w}px`);
  }
  await p2.goto(BASE + hid);
  await p2.waitForTimeout(350);
  await p2.screenshot({ path: `${SHOTS}/${vpName}-dark-habit-stats.png`, fullPage: true });
  check(vpName, 'Немає горизонтальної прокрутки на жодному екрані', overflow.length === 0, overflow.join(', '));
  const bg = await p2.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check(vpName, 'Темна тема за системними налаштуваннями', bg === 'rgb(22, 22, 24)', bg);

  // 10. PWA: service worker, маніфест, офлайн
  const swOk = await p2.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return !!reg.active;
  });
  const manifest = await p2.evaluate(async () => (await fetch('manifest.json')).json());
  check(vpName, 'Service worker активний, маніфест з іконками 192/512/maskable', swOk && manifest.icons.length === 3 && manifest.icons.some((i) => i.purpose === 'maskable'));
  await p2.goto(BASE + '#/today');
  await p2.waitForSelector('html.ready');
  await p2.waitForTimeout(500);
  await context.setOffline(true);
  await p2.reload();
  const offlineOk = await p2.waitForSelector('html.ready', { timeout: 8000 }).then(() => true).catch(() => false);
  const offlineTasks = await p2.locator('li.task').count();
  check(vpName, 'Додаток відкривається без інтернету', offlineOk && offlineTasks > 0, `${offlineTasks} завдань офлайн`);
  await context.setOffline(false);

  check(vpName, 'Немає помилок у консолі', errors.length === 0, errors.slice(0, 5).join(' || '));
  if (warnings.length) console.log(`   (попередження консолі: ${warnings.length}) ${warnings.slice(0, 3).join(' || ')}`);
  await browser.close();
}

(async () => {
  await run('phone', { width: 390, height: 844 });
  await run('laptop', { width: 1440, height: 900 });
  const failed = results.filter((r) => !r.ok);
  console.log(`\nРезультат: ${results.length - failed.length}/${results.length} перевірок пройдено`);
  fs.writeFileSync(path.join(SHOTS, 'results.json'), JSON.stringify(results, null, 2));
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
