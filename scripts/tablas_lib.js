// Tablas de posiciones de cada liga desde la pagina de la liga en Promiedos
// (_next/data/<buildId>/league/<slug>/<id>.json -> pageProps.data.tables_groups).
// Se guardan en data/tablas.json con un formato simple para la app.

const fs = require('fs');
const path = require('path');

const TABLAS_PATH = process.env.TABLAS_OUTPUT || path.join(__dirname, '..', 'data', 'tablas.json');

// Ligas con tabla (Copa Argentina es eliminacion directa: no tiene)
const LIGAS_TABLA = [
  { id: 'hc', slug: 'liga-profesional', nombre: 'Liga Profesional', pais: 'Argentina' },
  { id: 'ebj', slug: 'primera-nacional', nombre: 'Primera Nacional', pais: 'Argentina' },
  { id: 'bb', slug: 'laliga', nombre: 'La Liga', pais: 'España' },
  { id: 'h', slug: 'premier-league', nombre: 'Premier League', pais: 'Inglaterra' },
  { id: 'bh', slug: 'serie-a', nombre: 'Serie A', pais: 'Italia' }
];

// "Promedios - Relegation" -> "Promedios"; "Tabla Anual - Tabla Anual" -> "Tabla Anual"
function limpiarNombre(s) {
  const t = String(s || '').trim();
  const partes = t.split(' - ').map((x) => x.trim()).filter(Boolean);
  if (partes.length === 2 && (partes[0] === partes[1] || /relegation/i.test(partes[1]))) return partes[0];
  return t;
}

function normalizarTabla(t) {
  const tabla = t?.table || {};
  const columnas = (tabla.columns || []).map((c) => ({ key: c.key, titulo: c.title, tipo: c.type, negrita: !!c.is_bold }));
  const destinos = (tabla.destinations || []).map((d) => ({ color: d.color, nombre: d.name }));
  const filas = (tabla.rows || []).map((r) => {
    const valores = {};
    (r.values || []).forEach((v) => { valores[v.key] = v.value; });
    const eq = r?.entity?.object || {};
    return {
      pos: r.num,
      equipo: eq.name || '',
      equipoId: eq.id || null,
      color: r.destination_color || null,
      valores
    };
  });
  return { nombre: limpiarNombre(t?.name), vivo: !!tabla.is_live, columnas, destinos, filas };
}

function tablasDeLiga(pageJson) {
  const groups = pageJson?.pageProps?.data?.tables_groups || [];
  return groups.map((g) => ({
    nombre: limpiarNombre(g.name) || null,
    tablas: (g.tables || []).map(normalizarTabla)
  })).filter((g) => g.tablas.length);
}

// Equipos que aparecen en las tablas (para sumar sus colores a teams.json)
function equiposDeLiga(pageJson) {
  const out = [];
  (pageJson?.pageProps?.data?.tables_groups || []).forEach((g) => (g.tables || []).forEach((t) =>
    (t?.table?.rows || []).forEach((r) => { if (r?.entity?.object) out.push(r.entity.object); })));
  return out;
}

// Baja las tablas de todas las ligas y escribe data/tablas.json si cambio algo.
// slugs: { <id>: <url_name> } tomados del menu de Promiedos (los de LIGAS_TABLA quedan de respaldo)
async function actualizarTablas(getJson, site, buildId, collectTeams, equiposAcc, slugs = {}, sleepMs = 300) {
  const prev = fs.existsSync(TABLAS_PATH) ? JSON.parse(fs.readFileSync(TABLAS_PATH, 'utf8')) : { ligas: {} };
  const ligas = { ...(prev.ligas || {}) };
  for (const l of LIGAS_TABLA) {
    try {
      const slug = slugs[l.id] || l.slug;
      const page = await getJson(`${site}/_next/data/${buildId}/league/${encodeURIComponent(slug)}/${l.id}.json`);
      const grupos = tablasDeLiga(page);
      if (grupos.length) ligas[l.id] = { nombre: l.nombre, pais: l.pais, grupos };
      if (collectTeams && equiposAcc) collectTeams([{ teams: equiposDeLiga(page) }], equiposAcc);
    } catch (err) {
      console.warn(`No se pudo bajar la tabla de ${l.nombre}: ${err.message || err}`);
    }
    await new Promise((r) => setTimeout(r, sleepMs));
  }
  const nuevo = JSON.stringify({ ligas });
  const viejo = JSON.stringify({ ligas: prev.ligas || {} });
  if (nuevo === viejo && fs.existsSync(TABLAS_PATH)) return false;
  fs.mkdirSync(path.dirname(TABLAS_PATH), { recursive: true });
  fs.writeFileSync(TABLAS_PATH, JSON.stringify({ actualizado: new Date().toISOString(), ligas }), 'utf8');
  return true;
}

module.exports = { actualizarTablas, tablasDeLiga, LIGAS_TABLA };
