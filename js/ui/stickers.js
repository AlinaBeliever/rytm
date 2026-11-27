// Стікери — спільні для завдань і звичок: стандартний набір емодзі за категоріями.
import { EMOJI_CATEGORIES } from './emoji-data.js';

const CATEGORIES = EMOJI_CATEGORIES.map((c) => ({ ...c, list: c.list.split(' ') }));

/** Категорія, у якій лежить стікер (щоб відкрити саме її) */
function categoryOf(emoji) {
  return CATEGORIES.find((c) => c.list.includes(emoji)) || CATEGORIES[0];
}

function gridHtml(cat, current) {
  return cat.list
    .map((e) => `<button type="button" class="emoji-btn ${e === current ? 'sel' : ''}" data-sticker="${e}" aria-label="Стікер ${e}">${e}</button>`)
    .join('');
}

/** HTML вибору стікера: вкладки категорій + прокручувана сітка. Значення — у прихованому input[name=emoji]. */
export function stickerPickerHtml(current, esc) {
  const cat = categoryOf(current);
  return `<fieldset class="field sticker-field"><legend>Стікер <span class="muted">(необов'язково)</span></legend>
    <input type="hidden" name="emoji" value="${esc(current || '')}">
    <div class="sticker-bar">
      <button type="button" class="sticker-tab sticker-none ${current ? '' : 'sel'}" data-sticker="" aria-label="Без стікера" title="Без стікера">∅</button>
      <div class="sticker-tabs" role="group" aria-label="Категорії стікерів">
        ${CATEGORIES.map((c) => `<button type="button" class="sticker-tab ${c === cat ? 'active' : ''}" data-cat="${c.id}" aria-pressed="${c === cat}" aria-label="${c.label}" title="${c.label}">${c.icon}</button>`).join('')}
      </div>
    </div>
    <p class="sticker-cat muted small">${cat.label}</p>
    <div class="sticker-grid" role="group" aria-label="Вибір стікера">${gridHtml(cat, current)}</div></fieldset>`;
}

export function bindStickerPicker(form) {
  const input = form.elements.emoji;
  const field = form.querySelector('.sticker-field');
  const grid = field.querySelector('.sticker-grid');
  field.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-cat]');
    if (tab) {
      const cat = CATEGORIES.find((c) => c.id === tab.dataset.cat);
      grid.innerHTML = gridHtml(cat, input.value);
      grid.scrollTop = 0;
      field.querySelector('.sticker-cat').textContent = cat.label;
      field.querySelectorAll('[data-cat]').forEach((x) => {
        x.classList.toggle('active', x === tab);
        x.setAttribute('aria-pressed', x === tab);
      });
      return;
    }
    const b = e.target.closest('[data-sticker]');
    if (!b) return;
    input.value = b.dataset.sticker;
    field.querySelectorAll('[data-sticker]').forEach((x) => x.classList.toggle('sel', x === b));
  });
}
