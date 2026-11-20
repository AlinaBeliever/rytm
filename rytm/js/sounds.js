// sounds.js — звуки нагадувань, синтезовані через Web Audio API (без аудіофайлів).

export const SOUNDS = [
  { id: 'bell', label: 'Дзвіночок' },
  { id: 'marimba', label: 'Маримба' },
  { id: 'chime', label: 'Два тони' },
  { id: 'drops', label: 'Краплі' },
];

let ctx = null;

function getCtx() {
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  return ctx;
}

/** Браузери дозволяють звук лише після дії користувача — «розблоковуємо» при першому дотику/кліку. */
export function unlockAudioOnGesture() {
  const unlock = () => {
    const c = getCtx();
    if (c && c.state === 'suspended') c.resume().catch(() => {});
    // беззвучний короткий буфер для iOS
    if (c) {
      const b = c.createBuffer(1, 1, 22050);
      const s = c.createBufferSource();
      s.buffer = b;
      s.connect(c.destination);
      s.start(0);
    }
    window.removeEventListener('pointerdown', unlock, true);
    window.removeEventListener('keydown', unlock, true);
  };
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);
}

function tone(c, out, { freq, start, dur, type = 'sine', gain = 0.5, attack = 0.005 }) {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, start);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(gain, start + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  o.connect(g).connect(out);
  o.start(start);
  o.stop(start + dur + 0.05);
}

const RECIPES = {
  bell(c, out, t) {
    [880, 1760, 2640].forEach((f, i) => tone(c, out, { freq: f, start: t, dur: 1.4 - i * 0.3, gain: 0.5 / (i + 1) }));
    [880, 1760].forEach((f, i) => tone(c, out, { freq: f, start: t + 0.45, dur: 1.2 - i * 0.3, gain: 0.35 / (i + 1) }));
  },
  marimba(c, out, t) {
    [523.25, 659.25, 783.99].forEach((f, i) => {
      tone(c, out, { freq: f, start: t + i * 0.14, dur: 0.45, gain: 0.55 });
      tone(c, out, { freq: f * 4, start: t + i * 0.14, dur: 0.08, gain: 0.12 });
    });
  },
  chime(c, out, t) {
    tone(c, out, { freq: 659.25, start: t, dur: 0.7, type: 'triangle', gain: 0.5 });
    tone(c, out, { freq: 987.77, start: t + 0.28, dur: 0.9, type: 'triangle', gain: 0.5 });
  },
  drops(c, out, t) {
    [0, 0.16, 0.36].forEach((dt, i) => {
      const o = c.createOscillator();
      const g = c.createGain();
      const s = t + dt;
      o.type = 'sine';
      o.frequency.setValueAtTime(1400 - i * 200, s);
      o.frequency.exponentialRampToValueAtTime(500 - i * 60, s + 0.12);
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(0.6, s + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.18);
      o.connect(g).connect(out);
      o.start(s);
      o.stop(s + 0.2);
    });
  },
};

/** Програє звук. Повертає true, якщо звук було запущено. */
export function playSound(id = 'bell', volume = 0.7) {
  try {
    window.dispatchEvent(new CustomEvent('rytm:sound', { detail: { id, volume } }));
    const c = getCtx();
    if (!c) return false;
    if (c.state === 'suspended') c.resume().catch(() => {});
    const master = c.createGain();
    master.gain.value = Math.max(0, Math.min(1, volume));
    master.connect(c.destination);
    (RECIPES[id] || RECIPES.bell)(c, master, c.currentTime + 0.02);
    return true;
  } catch (e) {
    console.warn('Звук не відтворено', e);
    return false;
  }
}
