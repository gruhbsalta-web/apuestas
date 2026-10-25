const CACHE_NAME = "apuestas-futbol-v6";
const ASSETS = ["./", "./index.html", "./manifest.json", "./icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Cache-first con actualización en segundo plano: sirve rápido y offline,
// pero deja la red renovar la copia guardada para la próxima vez.
// Las requests de otros dominios (ej. el CDN de Tesseract.js para OCR, que
// baja archivos pesados de WASM/paquete de idioma) se dejan pasar directo a
// la red sin pasar por este cache: cachearlas acá no aporta nada y suma
// trabajo/memoria de mas justo en el momento en que el telefono ya esta
// ocupado corriendo el OCR.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  // Los datos de partidos y jugadores van siempre primero a la red (si no, la app mostraba
  // el matches.json del dia anterior); el cache queda solo como respaldo offline.
  if (url.pathname.endsWith("/data/matches.json") || url.pathname.endsWith("/data/players.json")) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(url.pathname, clone));
          }
          return response;
        })
        .catch(() => caches.match(url.pathname))
    );
    return;
  }
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request)
        .then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
