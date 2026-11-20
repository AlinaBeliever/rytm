// Графіки на SVG вручну, без бібліотек.
import { addDays, startOfWeek, weekday, parseISODate } from '../logic.js';
import { esc, shortDM } from './components.js';

const MONTHS_SHORT = ['січ', 'лют', 'бер', 'кві', 'тра', 'чер', 'лип', 'сер', 'вер', 'жов', 'лис', 'гру'];

/** Кільце прогресу для кількісних звичок */
export function ring(value, target, color, size = 44) {
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, target ? value / target : 0));
  return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${value} з ${target}">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--ring-track)" stroke-width="4"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${esc(color)}" stroke-width="4" stroke-linecap="round"
      stroke-dasharray="${(c * p).toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 ${size / 2} ${size / 2})" class="ring-val"/>
    <text x="50%" y="50%" dominant-baseline="central" text-anchor="middle" class="ring-text">${value}</text>
  </svg>`;
}

/** Теплова карта за рік (як у GitHub): колонки — тижні, рядки — дні (пн…нд) */
export function heatmap({ counts, target, color, today, start }) {
  const cell = 12;
  const gap = 3;
  const step = cell + gap;
  const lastWeek = startOfWeek(today);
  const firstWeek = addDays(lastWeek, -52 * 7);
  const left = 26;
  const top = 18;
  const width = left + 53 * step;
  const height = top + 7 * step;
  let rects = '';
  let labels = '';
  let prevMonth = -1;
  for (let w = 0; w < 53; w++) {
    const ws = addDays(firstWeek, w * 7);
    const m = parseISODate(ws).getMonth();
    if (m !== prevMonth && w < 51) {
      labels += `<text x="${left + w * step}" y="11" class="hm-label">${MONTHS_SHORT[m]}</text>`;
      prevMonth = m;
    }
    for (let d = 0; d < 7; d++) {
      const iso = addDays(ws, d);
      if (iso > today) continue;
      const c = counts.get(iso) || 0;
      const p = Math.min(1, c / target);
      const before = start && iso < start;
      const fill = c > 0 ? color : 'var(--cell-empty)';
      const op = c > 0 ? (0.35 + 0.65 * p).toFixed(2) : before ? 0.5 : 1;
      rects += `<rect x="${left + w * step}" y="${top + d * step}" width="${cell}" height="${cell}" rx="3" fill="${esc(fill)}" fill-opacity="${op}"><title>${esc(shortDM(iso))}: ${c > 0 ? (target > 1 ? `${c} з ${target}` : 'виконано') : 'не виконано'}</title></rect>`;
    }
  }
  ['Пн', '', 'Ср', '', 'Пт', '', ''].forEach((l, i) => {
    if (l) labels += `<text x="0" y="${top + i * step + 10}" class="hm-label">${l}</text>`;
  });
  return `<svg class="heatmap" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Теплова карта виконання за рік">${labels}${rects}</svg>`;
}

/** Стовпчиковий графік по тижнях */
export function weekBars(data, color) {
  const w = 360;
  const h = 150;
  const padL = 22;
  const padB = 22;
  const padT = 10;
  const max = Math.max(7, ...data.map((d) => d.done));
  const bw = (w - padL) / data.length;
  const y = (v) => padT + (h - padT - padB) * (1 - v / max);
  let bars = '';
  data.forEach((d, i) => {
    const x = padL + i * bw + bw * 0.18;
    const bh = h - padB - y(d.done);
    const met = d.done >= d.goal;
    bars += `<rect x="${x.toFixed(1)}" y="${y(d.done).toFixed(1)}" width="${(bw * 0.64).toFixed(1)}" height="${Math.max(0, bh).toFixed(1)}" rx="3"
      fill="${esc(color)}" fill-opacity="${met ? 1 : 0.55}"><title>Тиждень з ${esc(shortDM(d.weekStart))}: ${d.done} з ${d.goal}</title></rect>`;
    if (i % 2 === (data.length - 1) % 2)
      bars += `<text x="${(padL + i * bw + bw / 2).toFixed(1)}" y="${h - 6}" text-anchor="middle" class="bar-label">${esc(shortDM(d.weekStart).replace(/\s.*/, ''))}.${String(parseISODate(d.weekStart).getMonth() + 1).padStart(2, '0')}</text>`;
  });
  const goal = data[0]?.goal || 7;
  const gy = y(goal).toFixed(1);
  const grid = [0, Math.round(max / 2), max]
    .map((v) => `<line x1="${padL}" x2="${w}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="grid-line"/><text x="0" y="${(y(v) + 4).toFixed(1)}" class="bar-label">${v}</text>`)
    .join('');
  return `<svg class="bars" viewBox="0 0 ${w} ${h}" role="img" aria-label="Виконані дні по тижнях за останні ${data.length} тижнів">
    ${grid}<line x1="${padL}" x2="${w}" y1="${gy}" y2="${gy}" class="goal-line"><title>Ціль: ${goal} на тиждень</title></line>${bars}</svg>`;
}

/** Календар місяця (HTML-кнопки, щоб можна було відмічати заднім числом) */
export function monthCalendar({ year, month, counts, target, color, today, isScheduled }) {
  const first = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const dim = new Date(year, month + 1, 0).getDate();
  const lead = weekday(first) - 1;
  let cells = '';
  for (let i = 0; i < lead; i++) cells += '<span class="cal-cell empty" aria-hidden="true"></span>';
  for (let d = 1; d <= dim; d++) {
    const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const c = counts.get(iso) || 0;
    const done = c >= target;
    const partial = c > 0 && !done;
    const future = iso > today;
    const sched = isScheduled(iso);
    cells += `<button type="button" class="cal-cell ${done ? 'done' : ''} ${partial ? 'partial' : ''} ${iso === today ? 'is-today' : ''} ${sched ? '' : 'unsched'}"
      data-action="cal-day" data-date="${iso}" ${future ? 'disabled' : ''} style="--hc:${esc(color)}"
      aria-pressed="${done}" aria-label="${esc(shortDM(iso))}: ${done ? 'виконано' : partial ? `${c} з ${target}` : 'не виконано'}">${d}</button>`;
  }
  return `<div class="cal-grid" role="group" aria-label="Календар місяця">
    ${['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'].map((d) => `<span class="cal-wd" aria-hidden="true">${d}</span>`).join('')}
    ${cells}</div>`;
}
