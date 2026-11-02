const CACHE_NAME = "apuestas-futbol-v55";
const ASSETS = ["./", "./index.html", "./manifest.json", "./icon.svg", "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME && k !== "la-fija-compartido").map((k) => caches.delete(k)))
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
  // "Compartir → La Fija" desde BetWarrior o la galería: se guardan las capturas y se
  // abre la app, que las lee y muestra la apuesta lista para confirmar.
  if (event.request.method === "POST" && new URL(event.request.url).pathname.endsWith("/compartir")) {
    event.respondWith((async () => {
      try {
        const datos = await event.request.formData();
        const cache = await caches.open("la-fija-compartido");
        const archivos = datos.getAll("capturas").filter((f) => f && f.size);
        await Promise.all(archivos.map((f, i) => cache.put(`./compartido/${Date.now()}-${i}`, new Response(f, { headers: { "Content-Type": f.type || "image/png" } }))));
      } catch (e) { /* sin archivos */ }
      return Response.redirect("./index.html?compartido=1", 303);
    })());
    return;
  }
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  // Los datos de partidos y jugadores van siempre primero a la red (si no, la app mostraba
  // el matches.json del dia anterior); el cache queda solo como respaldo offline.
  if (/\/data\/(matches|players|teams|estado|tablas|fixture)\.json$/.test(url.pathname)) {
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

// Tocar un aviso de apuesta abre (o trae al frente) la app
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((lista) => {
      const abierta = lista.find((c) => "focus" in c);
      if (abierta) return abierta.focus();
      return self.clients.openWindow("./");
    })
  );
});
