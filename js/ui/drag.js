// Перетягування рядків у списку (миша — одразу, телефон — після довгого натискання).
// Клавіатура: Alt + ↑/↓ переміщує виділене завдання.

let suppressClickUntil = 0;
window.addEventListener(
  'click',
  (e) => {
    if (Date.now() < suppressClickUntil) {
      e.stopPropagation();
      e.preventDefault();
    }
  },
  true
);

export function enableDrag(list, onReorder) {
  let start = null;
  let timer = null;
  let drag = null;

  const items = () => [...list.querySelectorAll(':scope > li[data-draggable]')];

  list.addEventListener('contextmenu', (e) => {
    if (e.target.closest('li[data-draggable]')) e.preventDefault();
  });

  list.addEventListener('pointerdown', (e) => {
    const li = e.target.closest('li[data-draggable]');
    if (!li || !list.contains(li) || e.button !== 0) return;
    if (e.target.closest('.check, [data-action="snooze"], [data-action="move-today"]')) return;
    if (items().length < 2) return;
    start = { x: e.clientX, y: e.clientY, li, type: e.pointerType };
    if (e.pointerType !== 'mouse') {
      timer = setTimeout(() => begin(start.y), 450);
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  });

  // під час перетягування на телефоні блокуємо прокручування сторінки
  const blockTouch = (e) => {
    if (drag) e.preventDefault();
  };
  list.addEventListener('touchmove', blockTouch, { passive: false });

  function begin(y) {
    if (!start) return;
    const all = items();
    const idx = all.indexOf(start.li);
    if (idx < 0) return;
    const rects = all.map((el) => el.getBoundingClientRect());
    drag = { all, idx, rects, startY: y, newIdx: idx, h: rects[idx].height + 6 };
    start.li.classList.add('dragging');
    list.classList.add('drag-active');
    if (navigator.vibrate) {
      try {
        navigator.vibrate(12);
      } catch {
        /* ignore */
      }
    }
  }

  function onMove(e) {
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (!drag) {
      if (start.type === 'mouse') {
        if (Math.abs(dy) > 6 && Math.abs(dy) > Math.abs(dx)) begin(start.y);
      } else if (Math.hypot(dx, dy) > 10) {
        cleanup(); // це був скрол, а не довге натискання
      }
      return;
    }
    e.preventDefault();
    const { all, idx, rects, h } = drag;
    const offset = e.clientY - drag.startY;
    start.li.style.transform = `translateY(${offset}px)`;
    const center = rects[idx].top + rects[idx].height / 2 + offset;
    let newIdx = idx;
    all.forEach((el, i) => {
      if (i === idx) return;
      const mid = rects[i].top + rects[i].height / 2;
      let shift = 0;
      if (i > idx && center > mid) {
        shift = -h;
        newIdx = Math.max(newIdx, i);
      } else if (i < idx && center < mid) {
        shift = h;
        newIdx = Math.min(newIdx, i);
      }
      el.style.transform = shift ? `translateY(${shift}px)` : '';
    });
    drag.newIdx = newIdx;
  }

  function onUp(e) {
    if (drag) {
      if (e && typeof e.clientY === 'number') onMove(e); // остання позиція пальця/миші
      suppressClickUntil = Date.now() + 350;
      const { all, idx, newIdx } = drag;
      const keys = all.map((el) => el.dataset.key);
      cleanup();
      if (newIdx !== idx) {
        const [k] = keys.splice(idx, 1);
        keys.splice(newIdx, 0, k);
        onReorder(keys);
      }
      return;
    }
    cleanup();
  }
  function onCancel() {
    cleanup();
  }
  function cleanup() {
    clearTimeout(timer);
    timer = null;
    if (drag) {
      drag.all.forEach((el) => (el.style.transform = ''));
      list.classList.remove('drag-active');
      start?.li.classList.remove('dragging');
    }
    drag = null;
    start = null;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
  }

  list.addEventListener('keydown', (e) => {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    const li = e.target.closest('li[data-draggable]');
    if (!li) return;
    e.preventDefault();
    const keys = items().map((el) => el.dataset.key);
    const i = keys.indexOf(li.dataset.key);
    const j = e.key === 'ArrowUp' ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= keys.length) return;
    [keys[i], keys[j]] = [keys[j], keys[i]];
    onReorder(keys);
  });
}
