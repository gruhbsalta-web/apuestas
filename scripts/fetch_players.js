// Arma data/players.json con estadisticas por jugador a partir de las fichas
// de partido de Promiedos (alineaciones + minuto a minuto).
//
// Alcance (pedido 25/10/2026):
// - Liga Profesional: torneo en curso (Clausura 2026, desde julio).
// - Primera Nacional: desde la Fecha 1.
// - Copa Argentina: sin estadisticas de jugadores.
// En cada liga se toman todas las fechas desde el inicio de la etapa en curso
// (la que Promiedos marca como seleccionada) en adelante, asi que si despues
// vienen playoffs/reducido tambien entran.
//
// Cada corrida es incremental: solo baja las fichas de partidos terminados que
// todavia no estan en data/players.json. Ademas guarda los ausentes
// (lesionados/suspendidos) de los partidos de los proximos dias.
//
// Uso: node scripts/fetch_players.js   (PLAYERS_OUTPUT=ruta para escribir en otro lado)

const fs = require('fs');
const path = require('path');
const { playerLinesFromGame, missingFromGame, coachesFromGame, normName } = require('./players_lib');
const { statsFromStatistics } = require('./promiedos_stats');

const SITE = 'https://www.promiedos.com.ar';
const API = 'https://api.promiedos.com.ar';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'X-VER': '1.11.7.3'
};
const LEAGUES = [
  { id: 'hc', slug: 'liga-profesional', nombre: 'Liga Profesional' },
  { id: 'ebj', slug: 'primera-nacional', nombre: 'Primera Nacional' }
];
const OUTPUT_PATH = process.env.PLAYERS_OUTPUT || path.join(__dirname, '..', 'data', 'players.json');
// Cada partido procesado se guarda tambien en matches.json (formato de la app),
// asi la pestaña Terminados y los promedios por equipo cubren toda la temporada.
const MATCHES_PATH = process.env.MATCHES_OUTPUT || path.join(__dirname, '..', 'data', 'matches.json');

function matchRecord(ficha, league, country, fechaHora) {
  const scores = Array.isArray(ficha.scores) ? ficha.scores : [0, 0];
  return {
    id: `promiedos_${ficha.id}`,
    local: ficha?.teams?.[0]?.name || 'Desconocido',
    visitante: ficha?.teams?.[1]?.name || 'Desconocido',
    fechaHora,
    finPrimerTiempo: true,
    finPartido: true,
    stats: statsFromStatistics(ficha.statistics, { l: Number(scores[0]) || 0, v: Number(scores[1]) || 0 }),
    source: {
      provider: 'promiedos',
      leagueId: league.id,
      leagueName: league.nombre,
      country,
      gameUrlName: ficha.url_name,
      statusShort: ficha?.status?.short_name || 'Final'
    }
  };
}
const DELAY_MS = Number(process.env.PROMIEDOS_DELAY_MS || 300);
const DAYS_AHEAD = Number(process.env.PROMIEDOS_DAYS_AHEAD || 2);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getText(url, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { headers: HEADERS });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.text();
    } catch (err) {
      if (i >= tries) throw new Error(`${url}: ${err.message}`);
      await sleep(1000 * i);
    }
  }
}
const getJson = async (url) => JSON.parse(await getText(url));

// "24-10-2026 19:30" -> "2026-10-24T19:30"
function parseFechaHora(s) {
  const m = String(s || '').match(/^(\d{2})-(\d{2})-(\d{4}) (\d{2}):(\d{2})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}` : null;
}

function todayInArgentina() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

// Fechas de la etapa en curso en adelante, segun los filtros de la pagina de la liga.
function roundKeysFromLeaguePage(pageJson) {
  const filters = pageJson?.pageProps?.data?.games?.filters || [];
  const rounds = filters.filter((f) => f.key && f.key !== 'latest' && /^\d+_\d+_\d+_-?\d+$/.test(f.key));
  const selected = rounds.find((f) => f.selected) || rounds[rounds.length - 1];
  if (!selected) return [];
  const stagePrefix = selected.key.split('_').slice(0, 3).join('_') + '_';
  const firstIdx = rounds.findIndex((f) => f.key.startsWith(stagePrefix));
  return rounds.slice(firstIdx).map((f) => ({ key: f.key, nombre: f.name }));
}

function emptyOutput() {
  return { actualizado: null, partidos: {}, jugadores: {}, entrenadores: {}, ausentes: {} };
}

// Efectividad = puntos obtenidos / puntos posibles (3 por partido), se calcula en la app.
function addCoaches(out, league, coaches) {
  if (!out.entrenadores) out.entrenadores = {};
  coaches.forEach((c) => {
    const key = `${c.equipoId}|${normName(c.nombre)}`;
    const e = out.entrenadores[key] || (out.entrenadores[key] = {
      nombre: c.nombre, equipo: c.equipo, equipoId: c.equipoId, liga: league.id, edad: c.edad,
      pj: 0, g: 0, e: 0, p: 0, gf: 0, gc: 0
    });
    e.pj += 1;
    if (c.resultado === 'G') e.g += 1;
    else if (c.resultado === 'E') e.e += 1;
    else e.p += 1;
    e.gf += c.gf;
    e.gc += c.gc;
    e.equipo = c.equipo || e.equipo;
    if (c.edad != null) e.edad = c.edad;
  });
}

function addLines(out, league, lines) {
  lines.forEach((l) => {
    const key = `${l.equipoId}|${normName(l.nombre)}`;
    const p = out.jugadores[key] || (out.jugadores[key] = {
      nombre: l.nombre, equipo: l.equipo, equipoId: l.equipoId, liga: league.id,
      posicion: l.posicion, numero: l.numero, edad: l.edad,
      pj: 0, tit: 0, min: 0, goles: 0, asist: 0, amarillas: 0, rojas: 0
    });
    p.pj += 1;
    if (l.titular) p.tit += 1;
    p.min += l.minutos;
    p.goles += l.goles;
    p.asist += l.asist;
    p.amarillas += l.amarillas;
    p.rojas += l.rojas;
    // datos de ficha: nos quedamos con los del ultimo partido
    p.equipo = l.equipo || p.equipo;
    if (l.posicion) p.posicion = l.posicion;
    if (l.numero != null) p.numero = l.numero;
    if (l.edad != null) p.edad = l.edad;
  });
}

// Algunas fichas traen el nombre completo y otras no ("Carlos Mayor" /
// "Carlos Alberto Mayor"). Dentro del mismo equipo, si coinciden nombre y
// apellido y uno contiene al otro, se suman en la entrada con más partidos.
function sameNameVariant(a, b) {
  const ta = normName(a).split(' ');
  const tb = normName(b).split(' ');
  if (ta.join(' ') === tb.join(' ') || ta.length < 2 || tb.length < 2) return false;
  const [corto, largo] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  return corto[0] === largo[0] && corto[corto.length - 1] === largo[largo.length - 1] && corto.every((t) => largo.includes(t));
}

function mergeVariants(map, sumFields) {
  const keys = Object.keys(map);
  const byTeam = new Map();
  keys.forEach((k) => {
    const t = map[k].equipoId;
    if (!byTeam.has(t)) byTeam.set(t, []);
    byTeam.get(t).push(k);
  });
  let unidos = 0;
  byTeam.forEach((ks) => {
    ks.sort((a, b) => map[b].pj - map[a].pj);
    for (let i = 0; i < ks.length; i++) {
      const base = map[ks[i]];
      if (!base) continue;
      for (let j = i + 1; j < ks.length; j++) {
        const other = map[ks[j]];
        if (!other || !sameNameVariant(base.nombre, other.nombre)) continue;
        sumFields.forEach((f) => { base[f] = (base[f] || 0) + (other[f] || 0); });
        delete map[ks[j]];
        unidos++;
      }
    }
  });
  return unidos;
}

async function run() {
  const out = fs.existsSync(OUTPUT_PATH) ? JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8')) : emptyOutput();
  const html = await getText(`${SITE}/league/primera-nacional/ebj`);
  const buildId = (html.match(/"buildId":"([^"]+)"/) || [])[1];
  if (!buildId) throw new Error('No se pudo resolver el buildId de Promiedos');

  const today = todayInArgentina();
  const ausentesNuevos = {};
  const matchesOut = fs.existsSync(MATCHES_PATH)
    ? JSON.parse(fs.readFileSync(MATCHES_PATH, 'utf8'))
    : { matches: [], bets: [], capitalInicial: 0 };
  const matchById = new Map((matchesOut.matches || []).map((m) => [m.id, m]));
  let partidosHistoricos = 0;
  let procesados = 0;
  let errores = 0;

  for (const league of LEAGUES) {
    const page = await getJson(`${SITE}/_next/data/${buildId}/league/${league.slug}/${league.id}.json`);
    const rounds = roundKeysFromLeaguePage(page);
    if (!rounds.length) throw new Error(`Sin fechas para ${league.nombre}: cambio el formato de Promiedos?`);
    console.log(`${league.nombre}: ${rounds.length} fechas (${rounds[0].nombre} .. ${rounds[rounds.length - 1].nombre})`);

    for (const round of rounds) {
      const data = await getJson(`${API}/league/games/${league.id}/${encodeURIComponent(round.key)}`);
      const games = Array.isArray(data?.games) ? data.games : [];
      await sleep(DELAY_MS);

      for (const game of games) {
        const fechaHora = parseFechaHora(game.start_time);
        const terminado = game?.status?.enum === 3;
        const diffDays = fechaHora
          ? Math.round((new Date(`${fechaHora.slice(0, 10)}T00:00:00Z`) - new Date(`${today}T00:00:00Z`)) / 86400000)
          : null;
        const proximo = !terminado && diffDays != null && diffDays >= 0 && diffDays <= DAYS_AHEAD;
        if (terminado && out.partidos[game.id]) continue;
        if (!terminado && !proximo) continue;

        const url = `${SITE}/_next/data/${buildId}/game/${encodeURIComponent(game.url_name)}/${game.id}.json`;
        let ficha;
        try {
          ficha = (await getJson(url))?.pageProps?.initialData?.game;
        } catch (err) {
          console.warn(`No se pudo bajar la ficha ${game.id}: ${err.message}`);
          errores++;
          continue;
        } finally {
          await sleep(DELAY_MS);
        }
        if (!ficha) { errores++; continue; }

        if (proximo) {
          ausentesNuevos[`promiedos_${game.id}`] = missingFromGame(ficha);
          continue;
        }
        const lines = playerLinesFromGame(ficha);
        if (!lines.length) {
          // sin alineacion cargada todavia: se reintenta en la proxima corrida
          console.warn(`Partido ${game.id} (${game.url_name}) sin alineacion, se reintenta despues`);
          continue;
        }
        addLines(out, league, lines);
        addCoaches(out, league, coachesFromGame(ficha));
        const rec = matchRecord(ficha, league, 'Argentina', fechaHora);
        if (!matchById.has(rec.id)) partidosHistoricos++;
        matchById.set(rec.id, rec);
        out.partidos[game.id] = {
          liga: league.id, fecha: round.nombre, fechaHora,
          local: game?.teams?.[0]?.name, visitante: game?.teams?.[1]?.name
        };
        procesados++;
      }
    }
  }

  matchesOut.matches = [...matchById.values()];
  fs.mkdirSync(path.dirname(MATCHES_PATH), { recursive: true });
  fs.writeFileSync(MATCHES_PATH, JSON.stringify(matchesOut, null, 2), 'utf8');
  console.log(`matches.json: ${partidosHistoricos} partidos terminados agregados (total ${matchesOut.matches.length}).`);

  const unidosJ = mergeVariants(out.jugadores, ['pj', 'tit', 'min', 'goles', 'asist', 'amarillas', 'rojas']);
  const unidosE = mergeVariants(out.entrenadores || {}, ['pj', 'g', 'e', 'p', 'gf', 'gc']);
  if (unidosJ || unidosE) console.log(`Nombres unificados: ${unidosJ} jugadores, ${unidosE} entrenadores.`);

  out.ausentes = ausentesNuevos;
  out.actualizado = new Date().toISOString();
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(out), 'utf8');
  console.log(`Partidos nuevos procesados: ${procesados}. Total: ${Object.keys(out.partidos).length} partidos, ${Object.keys(out.jugadores).length} jugadores, ${Object.keys(out.entrenadores || {}).length} entrenadores. Errores: ${errores}.`);
  if (procesados === 0 && Object.keys(out.partidos).length === 0) {
    throw new Error('No se proceso ningun partido: revisar si cambio la API de Promiedos');
  }
}

run().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
