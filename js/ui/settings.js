// Налаштування: тема, нагадування, звук, тихі години, ранкове зведення, експорт/імпорт, iPhone.
import * as store from '../storage.js';
import * as notif from '../notifications.js';
import * as sync from '../sync.js';
import { SOUNDS, playSound } from '../sounds.js';
import { icon } from './icons.js';
import { esc, openModal, confirmDialog, toast } from './components.js';
import { ui, saveUI } from '../state.js';
import { applyTheme } from '../theme.js';
import { deleteSamples } from './tasks.js';
import { todayISO } from '../logic.js';

let deferredInstall = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstall = e;
  document.documentElement.classList.add('can-install');
});
window.addEventListener('appinstalled', () => {
  deferredInstall = null;
  document.documentElement.classList.remove('can-install');
  toast('Додаток встановлено');
});
export async function promptInstall() {
  if (deferredInstall) {
    deferredInstall.prompt();
    await deferredInstall.userChoice.catch(() => {});
    deferredInstall = null;
    document.documentElement.classList.remove('can-install');
  } else if (notif.isIOS()) {
    openIOSGuide();
  } else {
    toast('Відкрийте меню браузера → «Встановити додаток» або «Додати на головний екран»', { timeout: 6000 });
  }
}

function notifStatus(settings, p) {
  if (p === 'unsupported') return { text: 'Цей браузер не підтримує системні сповіщення. Нагадування буде видно в додатку зі звуком.', on: false };
  if (p === 'denied') return { text: 'Сповіщення заблоковані в налаштуваннях браузера. Дозвольте їх для цього сайту, щоб отримувати нагадування.', on: false };
  if (p === 'granted' && settings.notificationsEnabled) {
    return { text: sync.pushActive() ? 'Нагадування увімкнені. Цей пристрій отримує їх із сервера, навіть коли додаток закритий.' : 'Нагадування увімкнені.', on: true };
  }
  return { text: sync.isSignedIn()
    ? 'Сповіщення приходитимуть на цей пристрій, навіть коли додаток закритий. Дозвіл попросимо тільки після натискання кнопки.'
    : 'Додаток покаже сповіщення в потрібний час, поки він відкритий або згорнутий. Увійдіть в акаунт, щоб вони приходили й на закритий додаток. Дозвіл попросимо тільки після натискання кнопки.', on: false };
}

const SYNC_TEXT = { idle: 'Синхронізовано', syncing: 'Синхронізація…', error: 'Помилка синхронізації', offline: 'Немає інтернету — синхронізую, коли з’явиться' };

function accountCard() {
  const user = sync.getUser();
  if (user) {
    const st = sync.status;
    const when = st.lastSync ? ` · ${new Date(st.lastSync).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })}` : '';
    return `<section class="card settings-card" aria-labelledby="s-acc">
      <h2 class="card-title" id="s-acc">Акаунт</h2>
      <p class="small"><strong>${esc(user.email)}</strong></p>
      <p class="muted small" role="status">${esc(SYNC_TEXT[st.state] || '')}${st.state === 'idle' ? esc(when) : ''}${st.error && st.state === 'error' ? `<br><span class="warn">${esc(st.error)}</span>` : ''}</p>
      <p class="muted small">Завдання й звички синхронізуються між усіма пристроями, де ви увійшли в цей акаунт.</p>
      <div class="btn-row">
        <button type="button" class="btn" data-action="sync-now">Синхронізувати зараз</button>
        <button type="button" class="btn" data-action="sign-out">Вийти</button>
      </div>
    </section>`;
  }
  return `<section class="card settings-card" aria-labelledby="s-acc">
    <h2 class="card-title" id="s-acc">Акаунт</h2>
    <p class="muted small">Увійдіть, щоб дані були на всіх пристроях і нагадування приходили навіть коли додаток закритий. Без входу все працює тільки на цьому пристрої.</p>
    <form class="auth-form" data-action="auth-form" novalidate>
      <label class="field"><span>Пошта</span><input name="email" type="email" autocomplete="email" inputmode="email" required></label>
      <label class="field"><span>Пароль</span><input name="password" type="password" autocomplete="current-password" minlength="6" required></label>
      <p class="hint warn auth-msg" role="alert" hidden></p>
      <div class="btn-row">
        <button type="submit" class="btn btn-primary" data-mode="in">Увійти</button>
        <button type="submit" class="btn" data-mode="up">Створити акаунт</button>
        <button type="button" class="link-btn" data-action="forgot">Забули пароль?</button>
      </div>
    </form>
  </section>`;
}

export async function renderSettings(root, ctx) {
  const s = await store.getSettings();
  const perm = await notif.getPermission();
  const st = notifStatus(s, perm);
  const ios = notif.isIOS();
  const [tasks, habits] = await Promise.all([store.getTasks(), store.getHabits()]);
  const hasSamples = tasks.some((t) => t.sample) || habits.some((h) => h.sample);

  root.innerHTML = `
    <header class="view-head"><h1 class="view-title">Налаштування</h1></header>

    ${accountCard()}

    <section class="card settings-card" aria-labelledby="s-look">
      <h2 class="card-title" id="s-look">Вигляд</h2>
      <fieldset class="field"><legend>Тема</legend>
        <div class="seg-radio">
          ${[['auto', 'Як у системі'], ['light', 'Світла'], ['dark', 'Темна']]
            .map(([v, l]) => `<label><input type="radio" name="theme" value="${v}" ${ui.theme === v ? 'checked' : ''}><span>${l}</span></label>`)
            .join('')}
        </div></fieldset>
    </section>

    <section class="card settings-card" aria-labelledby="s-notif">
      <h2 class="card-title" id="s-notif">Нагадування</h2>
      <p class="muted small" id="notif-status">${esc(st.text)}</p>
      ${ios && !notif.isStandalone() ? `<p class="hint warn">На iPhone сповіщення працюють тільки з додатку, встановленого на головний екран. <button type="button" class="link-btn" data-action="ios-guide">Як встановити?</button></p>` : ''}
      <div class="btn-row">
        ${st.on
          ? `<button type="button" class="btn" data-action="notif-off">Вимкнути нагадування</button>
             <button type="button" class="btn" data-action="notif-test">${icon('bell', 'ic-sm')} Тестове сповіщення</button>`
          : `<button type="button" class="btn btn-primary" data-action="notif-on" ${perm === 'unsupported' ? 'disabled' : ''}>${icon('bell', 'ic-sm')} Увімкнути нагадування</button>`}
      </div>
      <label class="field"><span>Нагадування для нових завдань</span>
        <select name="defaultReminder">
          <option value="10" ${s.defaultReminder === 10 ? 'selected' : ''}>За 10 хв</option>
          <option value="0" ${s.defaultReminder === 0 ? 'selected' : ''}>У момент</option>
          <option value="none" ${s.defaultReminder === null ? 'selected' : ''}>Без нагадування</option>
        </select></label>
      <div class="switch-row">
        <label class="switch"><input type="checkbox" name="qh-enabled" ${s.quietHours.enabled ? 'checked' : ''}><span class="switch-ui" aria-hidden="true"></span><span>Тихі години</span></label>
      </div>
      <div class="row2 qh-times" ${s.quietHours.enabled ? '' : 'hidden'}>
        <label class="field"><span>З</span><input type="time" name="qh-from" value="${esc(s.quietHours.from)}"></label>
        <label class="field"><span>До</span><input type="time" name="qh-to" value="${esc(s.quietHours.to)}"></label>
      </div>
      <p class="hint qh-times" ${s.quietHours.enabled ? '' : 'hidden'}>У тихі години сповіщень і звуків немає — ці нагадування з'являться у списку «Пропущені», коли ви відкриєте додаток.</p>
      <div class="switch-row">
        <label class="switch"><input type="checkbox" name="ms-enabled" ${s.morningSummary.enabled ? 'checked' : ''}><span class="switch-ui" aria-hidden="true"></span><span>Ранкове зведення</span></label>
      </div>
      <label class="field ms-time" ${s.morningSummary.enabled ? '' : 'hidden'}><span>О котрій</span><input type="time" name="ms-time" value="${esc(s.morningSummary.time)}"></label>
    </section>

    <section class="card settings-card" aria-labelledby="s-sound">
      <h2 class="card-title" id="s-sound">Звук</h2>
      <div class="switch-row">
        <label class="switch"><input type="checkbox" name="mute" ${s.mute ? 'checked' : ''}><span class="switch-ui" aria-hidden="true"></span><span>Без звуку</span></label>
      </div>
      <fieldset class="field"><legend>Мелодія</legend>
        <div class="sound-list">
          ${SOUNDS.map(
            (x) => `<div class="sound-opt"><label class="radio"><input type="radio" name="sound" value="${x.id}" ${s.sound === x.id ? 'checked' : ''}><span>${esc(x.label)}</span></label>
            <button type="button" class="icon-btn subtle" data-action="preview" data-sound="${x.id}" aria-label="Прослухати: ${esc(x.label)}">${icon('play', 'ic-sm')}</button></div>`
          ).join('')}
        </div></fieldset>
      <label class="field"><span>Гучність <output id="vol-out">${Math.round(s.volume * 100)}%</output></span>
        <input type="range" name="volume" min="0" max="1" step="0.05" value="${s.volume}"></label>
    </section>

    <section class="card settings-card" aria-labelledby="s-data">
      <h2 class="card-title" id="s-data">Дані</h2>
      <p class="muted small">${sync.isSignedIn() ? 'Дані зберігаються на пристрої й у вашому акаунті. Резервна копія в JSON — додатковий запас.' : 'Без входу в акаунт дані зберігаються тільки на цьому пристрої — час від часу робіть резервну копію.'}</p>
      <div class="btn-row">
        <button type="button" class="btn" data-action="export">${icon('download', 'ic-sm')} Експорт у JSON</button>
        <button type="button" class="btn" data-action="import">${icon('upload', 'ic-sm')} Імпорт з JSON</button>
        <input type="file" accept="application/json,.json" id="import-file" hidden>
      </div>
      ${hasSamples ? `<div class="btn-row"><button type="button" class="btn" data-action="delete-samples">Видалити приклади</button></div>` : ''}
      <div class="btn-row"><button type="button" class="btn btn-ghost-danger" data-action="wipe">${icon('trash', 'ic-sm')} Стерти всі дані</button></div>
    </section>

    <section class="card settings-card" aria-labelledby="s-app">
      <h2 class="card-title" id="s-app">Додаток</h2>
      <div class="btn-row">
        <button type="button" class="btn install-btn" data-action="install">${icon('download', 'ic-sm')} Встановити на пристрій</button>
        <button type="button" class="btn" data-action="ios-guide">Як встановити на iPhone</button>
      </div>
      <p class="muted small">Гарячі клавіші (на ноутбуці): <kbd>N</kbd> — нове завдання, <kbd>Пробіл</kbd> — відмітити виділене завдання, <kbd>←</kbd>/<kbd>→</kbd> — попередній/наступний день, <kbd>↑</kbd>/<kbd>↓</kbd> — рух між завданнями, <kbd>Alt</kbd>+<kbd>↑</kbd>/<kbd>↓</kbd> — перемістити завдання.</p>
      <p class="muted small">Ритм · версія 1.0 · працює без інтернету</p>
    </section>`;

  const save = async (patch) => {
    await store.saveSettings(patch);
  };

  root.addEventListener('change', async (e) => {
    const t = e.target;
    switch (t.name) {
      case 'theme':
        saveUI({ theme: t.value });
        applyTheme();
        break;
      case 'defaultReminder':
        await save({ defaultReminder: t.value === 'none' ? null : Number(t.value) });
        break;
      case 'qh-enabled':
        await save({ quietHours: { ...s.quietHours, enabled: t.checked } });
        root.querySelectorAll('.qh-times').forEach((n) => (n.hidden = !t.checked));
        s.quietHours.enabled = t.checked;
        break;
      case 'qh-from':
      case 'qh-to':
        if (t.value) {
          s.quietHours[t.name === 'qh-from' ? 'from' : 'to'] = t.value;
          await save({ quietHours: { ...s.quietHours } });
        }
        break;
      case 'ms-enabled':
        s.morningSummary.enabled = t.checked;
        await save({ morningSummary: { ...s.morningSummary } });
        root.querySelector('.ms-time').hidden = !t.checked;
        break;
      case 'ms-time':
        if (t.value) {
          s.morningSummary.time = t.value;
          await save({ morningSummary: { ...s.morningSummary } });
        }
        break;
      case 'mute':
        await save({ mute: t.checked });
        break;
      case 'sound':
        await save({ sound: t.value });
        playSound(t.value, s.volume);
        break;
      case 'volume':
        s.volume = Number(t.value);
        await save({ volume: s.volume });
        playSound(s.sound, s.volume);
        break;
    }
  });
  root.addEventListener('input', (e) => {
    if (e.target.name === 'volume') root.querySelector('#vol-out').textContent = `${Math.round(e.target.value * 100)}%`;
  });

  root.addEventListener('submit', async (e) => {
    const f = e.target.closest('[data-action="auth-form"]');
    if (!f) return;
    e.preventDefault();
    const mode = e.submitter?.dataset.mode || 'in';
    const email = f.email.value.trim();
    const password = f.password.value;
    const msg = f.querySelector('.auth-msg');
    const show = (t) => {
      msg.textContent = t;
      msg.hidden = !t;
    };
    if (!email || !password) return show('Введіть пошту й пароль.');
    f.querySelectorAll('button').forEach((b) => (b.disabled = true));
    show('');
    try {
      if (mode === 'up') {
        const r = await sync.signUp(email, password);
        if (r === 'confirm') {
          show('');
          toast('Перевірте пошту: натисніть посилання в листі, потім поверніться й натисніть «Увійти».', { timeout: 9000 });
          f.querySelectorAll('button').forEach((b) => (b.disabled = false));
          return;
        }
      } else await sync.signIn(email, password);
      toast('Ви увійшли. Дані синхронізовано.');
      if ((await store.getSettings()).notificationsEnabled) sync.registerPush().catch(() => {});
      ctx.refresh();
    } catch (err) {
      show(err.message);
      f.querySelectorAll('button').forEach((b) => (b.disabled = false));
    }
  });

  root.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-action]');
    if (!a) return;
    switch (a.dataset.action) {
      case 'sync-now':
        await sync.sync({ force: true });
        break;
      case 'sign-out':
        if (await confirmDialog({ title: 'Вийти з акаунта?', text: 'Дані залишаться на цьому пристрої, але перестануть синхронізуватися, а сповіщення на закритий додаток припиняться.', ok: 'Вийти' })) {
          await sync.signOut();
          ctx.refresh();
        }
        break;
      case 'forgot': {
        const email = root.querySelector('.auth-form [name="email"]').value.trim();
        if (!email) return toast('Спершу введіть пошту у відповідне поле');
        try {
          await sync.resetPassword(email);
          toast('Якщо така пошта є, ми надіслали лист для відновлення пароля.', { timeout: 7000 });
        } catch (err) {
          toast(err.message);
        }
        break;
      }
      case 'notif-on': {
        const p = await notif.requestPermission();
        if (p === 'granted') {
          await save({ notificationsEnabled: true });
          if (sync.isSignedIn()) {
            try {
              await sync.registerPush();
              toast('Нагадування увімкнено — вони приходитимуть і на закритий додаток');
            } catch (err) {
              console.warn(err);
              toast('Нагадування працюватимуть, поки додаток відкритий. Пуші з сервера підключити не вдалося.', { timeout: 7000 });
            }
          } else toast('Нагадування увімкнено');
        } else if (p === 'denied') {
          toast('Дозвіл не надано. Його можна змінити в налаштуваннях браузера.', { timeout: 6000 });
        }
        ctx.refresh();
        break;
      }
      case 'notif-off':
        await save({ notificationsEnabled: false });
        await sync.unregisterPush();
        ctx.refresh();
        break;
      case 'notif-test': {
        const ok = await notif.showSystemNotification({ title: 'Ритм', body: 'Так виглядатиме нагадування', tag: 'test', data: { url: './#/settings' } });
        if (!s.mute) playSound(s.sound, s.volume);
        if (!ok) toast('Не вдалося показати сповіщення');
        break;
      }
      case 'preview':
        playSound(a.dataset.sound, s.volume);
        break;
      case 'export':
        await doExport();
        break;
      case 'import':
        root.querySelector('#import-file').click();
        break;
      case 'delete-samples':
        await deleteSamples();
        ctx.refresh();
        break;
      case 'wipe': {
        const ok = await confirmDialog({ title: 'Стерти всі дані?', text: sync.isSignedIn() ? 'Дані на цьому пристрої буде стерто й знову завантажено з акаунта. Щоб прибрати завдання остаточно — видаліть їх у списках.' : 'Усі завдання, звички й статистика будуть видалені з цього пристрою. Спершу зробіть експорт, якщо дані потрібні.', ok: 'Стерти', danger: true });
        if (ok) {
          await store.clearAll();
          await store.setMeta('seeded', true);
          if (sync.isSignedIn()) {
            localStorage.removeItem('rytm.dirty');
            await sync.sync({ first: false, force: true });
          }
          toast('Дані стерто');
        }
        break;
      }
      case 'install':
        promptInstall();
        break;
      case 'ios-guide':
        openIOSGuide();
        break;
    }
  });

  root.querySelector('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) await doImport(file);
  });
}

async function doExport() {
  const data = await store.exportAll();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `rytm-backup-${todayISO()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Резервну копію збережено');
}

export async function doImport(file) {
  let obj;
  try {
    obj = JSON.parse(await file.text());
  } catch {
    toast('Це не схоже на файл JSON');
    return;
  }
  const v = store.validateImport(obj);
  if (!v.ok) {
    await openModal({
      title: 'Файл не підходить',
      className: 'modal-small',
      render(el) {
        el.innerHTML = `<ul class="error-list">${v.errors.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
          <p class="muted small">Поточні дані не змінено.</p>
          <div class="modal-actions"><button type="button" class="btn" data-close>Зрозуміло</button></div>`;
      },
    });
    return;
  }
  const mode = await openModal({
    title: 'Імпорт даних',
    className: 'modal-small',
    render(el, close) {
      el.innerHTML = `<p>У файлі: <strong>${v.summary.tasks}</strong> завдань, <strong>${v.summary.habits}</strong> звичок, <strong>${v.summary.completions}</strong> відміток.</p>
        <p class="muted small">«Об'єднати» — додає записи з файлу; якщо запис є і там, і тут, лишається новіша версія. «Замінити» — повністю замінює поточні дані.</p>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost-danger" data-m="replace">Замінити все</button>
          <button type="button" class="btn btn-primary" data-m="merge" autofocus>Об'єднати</button>
        </div>`;
      el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-m]');
        if (b) close(b.dataset.m);
      });
    },
  });
  if (!mode) return;
  try {
    await store.importAll(obj, { mode });
    toast('Дані імпортовано');
  } catch (e) {
    toast('Помилка імпорту: ' + e.message, { timeout: 6000 });
  }
}

export function openIOSGuide() {
  return openModal({
    title: 'Встановлення на iPhone',
    render(el) {
      el.innerHTML = `<ol class="steps">
        <li>Відкрийте цей сайт у <strong>Safari</strong>.</li>
        <li>Натисніть кнопку <strong>«Поділитися»</strong> ${icon('share', 'ic-sm')} внизу екрана.</li>
        <li>Прокрутіть і виберіть <strong>«На початковий екран»</strong> (Add to Home Screen).</li>
        <li>Натисніть <strong>«Додати»</strong>. Іконка «Ритм» з'явиться на головному екрані.</li>
        <li>Відкрийте додаток з іконки → <strong>Налаштування → Увімкнути нагадування</strong>.</li>
      </ol>
      <p class="hint warn">На iPhone (iOS 16.4 і новіші) сповіщення працюють <strong>тільки</strong> з додатку, встановленого на головний екран. У звичайній вкладці Safari їх не буде.</p>
      <div class="modal-actions"><button type="button" class="btn btn-primary" data-close>Зрозуміло</button></div>`;
    },
  });
}
