const CACHE_NAME = "apuestas-futbol-v1";
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
  if (new URL(event.request.url).origin !== self.location.origin) return;
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
