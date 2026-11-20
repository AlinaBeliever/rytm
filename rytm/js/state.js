// Стан інтерфейсу (не дані). Дрібні налаштування інтерфейсу — у localStorage.
import { todayISO, startOfWeek } from './logic.js';

const LS_KEY = 'rytm.ui';

function loadUI() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY)) || {};
  } catch {
    return {};
  }
}

export const ui = {
  doneCollapsed: false,
  theme: 'auto', // auto | light | dark
  progressRange: 7,
  iosHintDismissed: false,
  ...loadUI(),
};

export function saveUI(patch) {
  Object.assign(ui, patch);
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(ui));
  } catch {
    /* приватний режим — не страшно */
  }
}

export const state = {
  selectedDate: todayISO(),
  weekStart: startOfWeek(todayISO()),
  habitDate: todayISO(),
  weekCollapsed: {}, // iso -> bool (телефон)
};
