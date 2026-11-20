// sw.js — service worker «Ритму»: офлайн-робота, сповіщення, підготовка до Web Push.
// Після змін у файлах додатку збільште VERSION — тоді всі пристрої отримають оновлення.
const VERSION = 'rytm-v1.0.0';
const ASSETS = [
  './',
  'index.html',
  'manifest.json',
  'css/styles.css',
  'js/app.js',
  'js/logic.js',
  'js/storage.js',
  'js/state.js',
  'js/theme.js',
  'js/sounds.js',
  'js/samples.js',
  'js/notifications.js',
  'js/ui/icons.js',
  'js/ui/components.js',
  'js/ui/tasks.js',
  'js/ui/drag.js',
  'js/ui/habits.js',
  'js/ui/charts.js',
  'js/ui/settings.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'icons/favicon-32.png',
  'icons/favicon.ico',
  'icons/badge-96.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Стратегія: віддаємо з кешу миттєво (працює офлайн) і тихо оновлюємо кеш з мережі.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const isNav = req.mode === 'navigate';
  event.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const cached = await cache.match(isNav ? 'index.html' : req, { ignoreSearch: isNav });
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok && res.type === 'basic') cache.put(isNav ? 'index.html' : req, res.clone());
          return res;
        })
        .catch(() => null);
      if (cached) {
        event.waitUntil(network);
        return cached;
      }
      const res = await network;
      return res || (isNav ? cache.match('index.html') : new Response('', { status: 504, statusText: 'Offline' }));
    })
  );
});

/* ---------------------------- Сповіщення ---------------------------- */

async function sendToClient(message, openUrl) {
  const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const client = all.find((c) => c.visibilityState === 'visible') || all[0];
  if (client) {
    client.postMessage(message);
    if (message.action === 'open' && 'focus' in client) await client.focus();
    return;
  }
  if (self.clients.openWindow) await self.clients.openWindow(openUrl);
}

self.addEventListener('notificationclick', (event) => {
  const n = event.notification;
  const data = n.data || {};
  n.close();
  const action = event.action === 'done' ? 'done' : event.action === 'snooze15' ? 'snooze15' : 'open';
  if (data.kind !== 'task') {
    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((all) => {
        if (all[0]) return all[0].focus();
        return self.clients.openWindow(data.url || './');
      })
    );
    return;
  }
  const url = `./?task=${encodeURIComponent(data.taskId)}&occ=${encodeURIComponent(data.occDate || '')}&action=${action}#/today`;
  event.waitUntil(sendToClient({ type: 'notification-action', action, taskId: data.taskId, occDate: data.occDate }, url));
});

// Web Push із сервера (Supabase Edge Function). Очікуваний формат:
// { "title": "...", "body": "...", "tag": "...", "data": { "kind": "task", "taskId": "...", "occDate": "YYYY-MM-DD" } }
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: 'Ритм', body: event.data ? event.data.text() : '' };
  }
  const data = payload.data || {};
  const actions = data.kind === 'task'
    ? [{ action: 'done', title: 'Виконано' }, { action: 'snooze15', title: 'Відкласти на 15 хв' }]
    : [];
  event.waitUntil(
    self.registration.showNotification(payload.title || 'Ритм', {
      body: payload.body || '',
      tag: payload.tag,
      data,
      icon: 'icons/icon-192.png',
      badge: 'icons/badge-96.png',
      actions,
    })
  );
});
