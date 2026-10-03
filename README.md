# Tracker de Apuestas - Fútbol Argentino

App móvil (PWA) para registrar partidos de Primera División y Primera Nacional, cargar apuestas sobre esos partidos, y hacer seguimiento de resultado, capital y efectividad. Sin backend: todo corre en el navegador y los datos se guardan en `localStorage`.

## Stack

- HTML + CSS + JavaScript vanilla, sin frameworks ni build step.
- Todo el markup, estilos y lógica viven en `index.html` (un solo archivo, ~930 líneas).
- PWA: `manifest.json` + `sw.js` (service worker) + `icon.svg` para que sea instalable y funcione offline.
- Persistencia: `localStorage`, clave `futbolTrackerData_v1`.

## Archivos

| Archivo | Qué es |
|---|---|
| `index.html` | Toda la app: markup, CSS y JS inline |
| `manifest.json` | Metadata de instalación PWA (nombre, ícono, `display: standalone`) |
| `sw.js` | Service worker (cache-first con revalidación) para que funcione offline una vez instalada |
| `icon.svg` | Ícono de la app (usado en manifest, favicon y apple-touch-icon) |

## Fuentes de datos

- Actual: scraping de Promiedos (frágil, depende del HTML del sitio).
- Recomendada para automatizar: API-Sports / API-Football, usando la clave gratuita del plan básico.
- El script nuevo en [scripts/fetch_api_sports.js](scripts/fetch_api_sports.js) toma partidos y estado de fixtures de Argentina y los escribe en [data/matches.json](data/matches.json).

### Uso con API-Sports

1. Pedí una clave gratuita en API-Sports.
2. En la terminal, define la variable de entorno:
   ```powershell
   $env:API_SPORTS_KEY="tu_clave"
   ```
3. Ejecuta:
   ```powershell
   npm run fetch:api-sports
   ```

El script carga los partidos de Argentina y escribe en [data/matches.json](data/matches.json) lo siguiente por partido:
- fecha y hora del fixture,
- goles del local y visitante,
- tiros al arco (shots on goal),
- corners,
- tarjetas amarillas/rojas sumadas,
- atajadas de arquero.

> Esta opción es mejor para actualizar partidos, horarios y estado del fixture. No reemplaza automáticamente el flujo de apuestas ni las cuotas, que siguen siendo un problema aparte.

## Cómo levantarlo en VS Code

El service worker y el manifest **no funcionan bien si abrís `index.html` directo con doble click** (protocolo `file://`). Necesitás servirlo por `http://localhost`:

- **Opción rápida**: extensión "Live Server" de VS Code → click derecho sobre `index.html` → "Open with Live Server".
- **Alternativa sin extensión**: en la terminal, parado en esta carpeta:
  ```
  python -m http.server 8080
  ```
  y abrís `http://localhost:8080` en el navegador.

No hace falta `npm install` ni ningún build: es HTML/CSS/JS plano.

## Modelo de datos (`state`, persistido en localStorage)

```js
{
  matches: [
    {
      id, local, visitante,          // nombres de club (ver listas PRIMERA_DIVISION / NACIONAL_ZONA_A / NACIONAL_ZONA_B en el JS)
      fechaHora,                      // string datetime-local, ej "2026-08-01T18:00"
      finPrimerTiempo, finPartido,    // booleanos, controlan el estado del partido
      stats: {
        goles: {l, v}, tarjetas: {l, v}, corners: {l, v},
        tirosArco: {l, v}, atajadas: {l, v}   // l=local, v=visitante
      }
    }
  ],
  bets: [
    { id, matchId, tipo, comparador, linea, monto, cuota }
    // tipo: goles|tarjetas|corners|tirosArco|atajadas
    // comparador: "mas" | "menos"
  ],
  capitalInicial: number
}
```

## Lógica clave (todas las funciones viven en el `<script>` de `index.html`)

- **`evalBet(bet)`**: decide si una apuesta está Ganada/Perdida/Pendiente. Como las estadísticas sólo pueden crecer durante el partido, una apuesta "más de X" se marca Ganada apenas se supera X (sin esperar el final); "menos de X" se marca Perdida apenas se alcanza X. Si no se puede decidir todavía, queda Pendiente hasta que `finPartido` sea `true`.
- **`matchStatus(m)`**: calcula en qué minuto/estado está el partido (`Programado`, `1T ~N'`, `Entretiempo`, `2T ~N'`, `Finalizado`) usando `fechaHora` + los checkboxes de fin de tiempo, comparado contra la hora real (`Date.now()`).
- **`estimateProb(bet, m)`**: para apuestas pendientes, proyecta el acumulado actual a los 90' según el tiempo jugado y da una etiqueta cualitativa (Muy probable / Probable / Ajustada / Poco probable).
- **`teamAverages(teamName)`**: promedio histórico de cada categoría (total local+visitante) en los partidos **terminados** donde jugó ese equipo. Se muestra en la pestaña Apuestas al elegir el partido, para decidir la línea antes de cargar la apuesta.
- **`renderFooter()`**: calcula el capital real de la cuenta — se descuenta el monto apenas se carga cada apuesta, se acredita `monto*cuota` cuando gana, no pasa nada extra si pierde (ya estaba descontado).
- **`renderAll()`**: re-renderiza todo (se llama después de cualquier cambio de estado, y cada 60s via `setInterval` para refrescar el minuto de juego).

## Pestañas de la UI

1. **Partidos**: alta de partidos (selección de club con datalist agrupado por Primera División / Nacional Zona A / Zona B), carga de estadísticas en vivo, checkboxes de fin de 1er tiempo / fin de partido, botón eliminar partido.
2. **Apuestas**: alta de apuestas sobre un partido activo, con el panel de promedios históricos por equipo antes de cargar.
3. **Terminados**: partidos con `finPartido = true`, filtrables por día, con estadística de apostado/ganancia/récord de ese filtro.
4. **Resumen**: efectividad general y desglose de aciertos por categoría (goles/tarjetas/corners/tiros al arco/atajadas). También vive acá el backup (exportar/importar JSON completo del `state`).

## Estado de git

Repo local inicializado en esta carpeta (`git init`, sin remote todavía). Un commit: *"Tracker de apuestas de futbol argentino - PWA inicial"*.

## Deploy pendiente (GitHub Pages)

Para que sea instalable de verdad en el celular (Chrome/Safari sólo ofrecen "Instalar app" sobre `https://`, no sobre archivos locales):

1. Crear un repo público en GitHub (ej. `apuestas-futbol`).
2. Subir estos 4 archivos (`index.html`, `manifest.json`, `sw.js`, `icon.svg`) — o, si preferís usar este repo local: `git remote add origin <url-del-repo>` y `git push -u origin master`.
3. Settings → Pages → Deploy from a branch → `main` / `(root)`.
4. Abrir la URL resultante (`https://usuario.github.io/apuestas-futbol/`) desde el celular para instalarla.

Los datos (partidos, apuestas, capital) **no se suben nunca a GitHub** — viven sólo en el `localStorage` del navegador de cada dispositivo. Por eso existe el backup exportar/importar (pestaña Resumen) para pasar datos entre PC y celular.
