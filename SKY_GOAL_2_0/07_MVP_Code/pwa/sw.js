/* SKY GOAL 2.0 — 오프라인 캐시 */
const CACHE = 'sky-goal-1.0.0';
const FILES = ['./', './index.html', './manifest.webmanifest',
               './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// 캐시 우선 — 게임이 통째로 한 파일이라 오프라인에서 완전히 동작한다.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request)));
});
