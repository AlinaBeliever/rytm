// Тема: автоматично за системою або вручну (зберігається в localStorage).
import { ui } from './state.js';

export function applyTheme() {
  const root = document.documentElement;
  if (ui.theme === 'light' || ui.theme === 'dark') root.dataset.theme = ui.theme;
  else delete root.dataset.theme;
  const dark = ui.theme === 'dark' || (ui.theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  let meta = document.querySelector('meta[name="theme-color"]:not([media])');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  meta.content = dark ? '#161618' : '#f6f6f3';
}

matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);
