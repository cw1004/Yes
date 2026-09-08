/** 앱 셸 캐싱 — 오프라인에서도 촬영/분석 화면까지는 열린다. */
const CACHE = 'skinlab-v4';
const SHELL = ['/', '/index.html', '/styles.css', '/js/app.js', '/js/api.js',
  '/js/ui/camera.js', '/js/ui/render.js', '/js/engine/metrics.js', '/js/engine/color.js',
  '/js/engine/skinmask.js', '/js/engine/quality.js', '/js/engine/diagnose.js', '/js/engine/ranking.js',
  '/js/engine/consult.js', '/js/engine/intake.js', '/js/storage.js',
  '/js/ui/doctor.js', '/js/ui/compare.js',
  '/js/sim/faces.js', '/js/sim/personas.js',
  '/manifest.webmanifest', '/assets/icon.svg', '/assets/icon-180.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api/')) return; // API는 항상 네트워크
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request)));
});
