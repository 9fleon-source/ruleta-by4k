const CACHE_NAME = 'ruleta-by4k-vip-v5.0.2';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './jsqr.min.js',
  './challenges_data.js',
  './app.js',
  '../logo.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './audio/victory.wav',
  './audio/buzzer.wav',
  './audio/spin_classic.wav',
  './audio/spin_tictac.wav',
  './audio/spin_drums.wav',
  './audio/spin_scifi.wav',
  './audio/spin_bells.wav',
  './audio/spin_engine.wav',
  './audio/spin_percussion.wav',
  './audio/spin_maracas.wav'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Nunca cachear llamadas dinámicas a Google Apps Script ni síntesis neuronal externa
  if (
    event.request.method !== 'GET' ||
    url.hostname.includes('script.google.com') ||
    url.hostname.includes('googleusercontent.com') ||
    url.hostname.includes('ottsy.weilbyte.dev')
  ) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request)
        .then((networkRes) => {
          if (networkRes && networkRes.status === 200 && url.origin === self.location.origin) {
            const clone = networkRes.clone();
            caches.open(CACHE_NAME).then((c) => c.put(event.request, clone));
          }
          return networkRes;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
