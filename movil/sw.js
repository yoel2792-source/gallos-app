/* Gallero PR móvil · service worker
   Guarda la app para que abra rápido y sin conexión. Los datos de Supabase no pasan por aquí. */
const VERSION = 'gallero-movil-v1';
const ARCHIVOS = ['./', './index.html', './app.js', './supabase.js', './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-180.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  // Primero la red (para recibir versiones nuevas); si no hay conexión, lo guardado.
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res && res.ok) { const copia = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copia)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('./index.html')))
  );
});
