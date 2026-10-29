// Archivo de temporadas de Argentina: resultados, planteles y tablas.
// Se va completando en cada vuelta completa del bucle, así siempre está al día;
// cuando empieza el año nuevo, la carpeta del año anterior deja de cambiar y queda
// como archivo de esa temporada.
//   data/archivo/argentina/<año>/partidos.json   resultados y estadísticas (Liga Profesional, Primera Nacional, Copa Argentina)
//   data/archivo/argentina/<año>/planteles.json  jugadores (con arqueros) y DT (Liga Profesional y Primera Nacional)
//   data/archivo/argentina/<año>/tablas.json     posiciones
//   data/archivo/argentina/indice.json           temporadas guardadas
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'data');
const BASE = path.join(DATA, 'archivo', 'argentina');
const LIGAS = ['hc', 'ebj', 'gea'];

const leer = (f) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); } catch (e) { return null; } };

// Escribe solo si cambió el contenido (sin contar la fecha de actualización)
function guardar(archivo, datos) {
  const sinFecha = (d) => JSON.stringify({ ...d, actualizado: null });
  try {
    const prev = JSON.parse(fs.readFileSync(archivo, 'utf8'));
    if (sinFecha(prev) === sinFecha(datos)) return false;
  } catch (e) { /* no existía */ }
  fs.mkdirSync(path.dirname(archivo), { recursive: true });
  fs.writeFileSync(archivo, JSON.stringify(datos), 'utf8');
  return true;
}

const ahora = new Date().toISOString();
let cambios = 0;
const anios = new Set();

// Resultados: partidos argentinos terminados, por año
const matches = leer('matches.json');
const porAnio = {};
for (const m of (matches && matches.matches) || []) {
  if (!m.finPartido || !LIGAS.includes(m?.source?.leagueId) || !m.fechaHora) continue;
  const anio = m.fechaHora.slice(0, 4);
  (porAnio[anio] = porAnio[anio] || []).push({
    id: m.id,
    liga: m.source.leagueId,
    ligaNombre: m.source.leagueName,
    ronda: m.source.ronda || '',
    fechaHora: m.fechaHora,
    local: m.local,
    visitante: m.visitante,
    stats: m.stats
  });
}
for (const [anio, partidos] of Object.entries(porAnio)) {
  partidos.sort((a, b) => a.fechaHora.localeCompare(b.fechaHora));
  // se suman a lo ya archivado (matches.json podría limpiar partidos viejos algún día)
  let previos = [];
  try { previos = JSON.parse(fs.readFileSync(path.join(BASE, anio, 'partidos.json'), 'utf8')).partidos || []; } catch (e) { /* nuevo */ }
  const porId = new Map(previos.map((p) => [p.id, p]));
  partidos.forEach((p) => porId.set(p.id, p));
  const lista = [...porId.values()].sort((a, b) => a.fechaHora.localeCompare(b.fechaHora));
  if (guardar(path.join(BASE, anio, 'partidos.json'), { temporada: Number(anio), actualizado: ahora, partidos: lista })) cambios++;
  anios.add(anio);
}

// Planteles: la temporada en curso de players.json
const players = leer('players.json');
if (players && players.temporada && Object.keys(players.jugadores || {}).length) {
  const anio = String(players.temporada);
  const datos = { temporada: players.temporada, actualizado: ahora, jugadores: players.jugadores, entrenadores: players.entrenadores || {} };
  if (guardar(path.join(BASE, anio, 'planteles.json'), datos)) cambios++;
  anios.add(anio);
}

// Tablas: posiciones de las ligas argentinas (la del año en curso)
const tablas = leer('tablas.json');
// (en enero, antes de que arranque la temporada nueva, Promiedos puede mostrar ya las
// tablas nuevas en cero: no se pisan las posiciones finales del año anterior)
const anioHoy = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric' }).format(new Date()));
if (tablas && tablas.ligas && (!players?.temporada || players.temporada === anioHoy)) {
  const anio = String(players?.temporada || anioHoy);
  const ligas = Object.fromEntries(Object.entries(tablas.ligas).filter(([id]) => LIGAS.includes(id)));
  if (Object.keys(ligas).length && guardar(path.join(BASE, anio, 'tablas.json'), { temporada: Number(anio), actualizado: ahora, ligas })) cambios++;
  anios.add(anio);
}

// Índice de temporadas guardadas
let previasIdx = [];
try { previasIdx = JSON.parse(fs.readFileSync(path.join(BASE, 'indice.json'), 'utf8')).temporadas || []; } catch (e) { /* nuevo */ }
const todas = [...new Set([...previasIdx.map(String), ...anios])].sort().map(Number);
if (guardar(path.join(BASE, 'indice.json'), { actualizado: ahora, temporadas: todas })) cambios++;

console.log(`Archivo Argentina: ${cambios ? cambios + ' archivo(s) actualizado(s)' : 'sin cambios'} (temporadas ${todas.join(', ')}).`);
