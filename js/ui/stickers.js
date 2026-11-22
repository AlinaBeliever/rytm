// Стікери для завдань: усі різні, згруповані за темою.
export const STICKERS = [
  // робота й навчання
  '💼', '📞', '📧', '💻', '📝', '📚', '🎓', '🧾', '📊', '📅', '🗂️', '🖨️', '✏️', '🔬', '🧮', '🗣️',
  // дім
  '🏠', '🧹', '🧺', '🍳', '🛒', '🔧', '🪴', '🛏️', '🚿', '🗑️', '🔑', '💡', '📦', '🧼', '🐶', '🐱',
  // здоров'я й спорт
  '💊', '🩺', '🦷', '🏋️', '🏃', '🚴', '🏊', '🧘', '🥗', '💧', '😴', '🩹', '👓', '💇', '💅', '🛁',
  // гроші й справи
  '💳', '💰', '🏦', '📮', '📑', '🪪', '🚗', '⛽', '✈️', '🚆', '🧳', '🗺️', '🏨', '🎟️', '🛍️', '🎁',
  // дозвілля
  '🎬', '🎮', '🎧', '🎸', '🎨', '📷', '📖', '🧩', '🎲', '🎤', '🍿', '☕', '🍷', '🎂', '🎉', '🥳',
  // люди й емоції
  '👨‍👩‍👧', '👫', '💌', '❤️', '🤝', '🙏', '🌟', '🔥', '🚀', '🎯', '🏆', '⏰', '⚡', '🌈', '🌻', '🍀',
  // їжа
  '🍎', '🥑', '🍕', '🍔', '🥐', '🍜', '🍣', '🍰', '🍫', '🥤', '🍳', '🥕',
  // природа й погода
  '☀️', '🌙', '⭐', '🌧️', '❄️', '🌊', '🌲', '🏔️', '🏖️', '🐝', '🦋', '🐢',
].filter((e, i, a) => a.indexOf(e) === i);

/** HTML вибору стікера: поточний + прокручувана сітка. Значення — у прихованому input[name=emoji]. */
export function stickerPickerHtml(current, esc) {
  return `<fieldset class="field sticker-field"><legend>Стікер <span class="muted">(необов'язково)</span></legend>
    <input type="hidden" name="emoji" value="${esc(current || '')}">
    <div class="sticker-grid" role="group" aria-label="Вибір стікера">
      <button type="button" class="emoji-btn sticker-none ${current ? '' : 'sel'}" data-sticker="" aria-label="Без стікера">∅</button>
      ${STICKERS.map((e) => `<button type="button" class="emoji-btn ${e === current ? 'sel' : ''}" data-sticker="${e}" aria-label="Стікер ${e}">${e}</button>`).join('')}
    </div></fieldset>`;
}

export function bindStickerPicker(form) {
  const input = form.elements.emoji;
  form.querySelector('.sticker-grid').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sticker]');
    if (!b) return;
    input.value = b.dataset.sticker;
    form.querySelectorAll('.sticker-grid .emoji-btn').forEach((x) => x.classList.toggle('sel', x === b));
  });
}
