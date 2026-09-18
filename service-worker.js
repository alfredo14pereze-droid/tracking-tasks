// Service worker de Flowday — solo cachea el "app shell" estático para que
// la app abra en modo offline básico. Nunca toca las llamadas a Supabase
// (son cross-origin y/o no-GET, así que se excluyen explícitamente abajo).

const CACHE_NAME = 'flowday-cache-v2';
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png?v=2',
  './icons/icon-512.png?v=2'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .catch(err => console.warn('SW precache falló (no crítico):', err))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  // Deja pasar tal cual: cualquier request que no sea GET (POST/PATCH/DELETE a
  // Supabase) y cualquier cosa que no sea del mismo origen (Supabase, Google Fonts).
  // Así los datos de tareas/objetivos/recordatorios/notas siempre van directo a la red.
  if (req.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  // Same-origin (index.html, manifest, íconos): red primero, y si no hay
  // conexión, cae al cache — así siempre ves la versión más reciente cuando
  // hay internet, y algo funcional cuando no la hay.
  event.respondWith(
    fetch(req)
      .then(res => {
        const resClone = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(req, resClone));
        return res;
      })
      .catch(() =>
        caches.match(req).then(cached => cached || caches.match('./index.html'))
      )
  );
});
