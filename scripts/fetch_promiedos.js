let fetchImpl = globalThis.fetch;
if (!fetchImpl) {
  try {
    fetchImpl = require('node-fetch');
  } catch (error) {
    fetchImpl = null;
  }
}
const fs = require('fs');
const path = require('path');

const SITE = 'https://www.promiedos.com.ar';
const API = 'https://api.promiedos.com.ar';
const ANCHOR_LEAGUE_PATH = '/league/primera-nacional/ebj';
const DELAY_MS = Number(process.env.PROMIEDOS_DELAY_MS || 150);
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'matches.json');
const LEAGUE_OVERRIDE = (process.env.PROMIEDOS_LEAGUES || '').split(',').map((v) => v.trim()).filter(Boolean);
// Paises/categorias del menu de Promiedos que queremos cubrir. El resto
// (Alemania, Portugal, Francia, Brasil, Uruguay, Paraguay, Colombia, Chile,
// Mexico, EEUU, Selecciones) queda afuera a proposito.
const COUNTRY_WHITELIST = ['Argentina', 'Inglaterra', 'España', 'Italia', 'Internacional'];
// Ligas que se siguen, agrupadas por pais. Para sumar otra liga o pais basta
// con agregar su id de Promiedos aca (y el pais en COUNTRY_BY_LEAGUE).
// Argentina: Liga Profesional, Primera Nacional y Copa Argentina.
// Europa (solo partidos, sin planteles): Premier League, La Liga y Serie A.
// Internacional: Champions League.
const LEAGUE_ID_INCLUDE = new Set(['hc', 'ebj', 'gea', 'h', 'bb', 'bh', 'fhc']);
const COUNTRY_BY_LEAGUE = {
  hc: 'Argentina', ebj: 'Argentina', gea: 'Argentina',
  h: 'Inglaterra', bb: 'España', bh: 'Italia',
  fhc: 'Internacional'
};
// Ligas puntuales que no queremos aunque su pais/categoria este en la
// whitelist: reserva/amateur argentino (no estan en las listas de equipos
// de la app) y las copas domesticas de Inglaterra/España/Italia (de las
// ligas extranjeras solo interesa la liga top y las copas internacionales,
// no las copas locales tipo FA Cup/Copa del Rey/Coppa Italia).
const LEAGUE_ID_EXCLUDE = new Set([
  'iage', // Promocional Amateur (AR)
  'hhbc', // Liga Profesional - Reserva (AR)
  'hgee', // Copa de la Liga - Reserva (AR)
  'j', // Carabao Cup (ING)
  'i', // FA Cup (ING)
  'bd', // Copa del Rey (ESP)
  'bf', // Supercopa (ESP)
  'ca', // Coppa Italia (ITA)
  'cd' // Supercopa (ITA)
]);
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'X-VER': '1.11.7.3'
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getText(url) {
  if (!fetchImpl) throw new Error('No hay un fetch disponible en este entorno.');
  // tope de 20 s por pedido: si Promiedos no responde, se sigue (antes podía quedar colgado)
  const res = await fetchImpl(url, { headers: HEADERS, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`);
  return res.text();
}

async function getJson(url) {
  const text = await getText(url);
  return JSON.parse(text);
}

const { emptyStats, statsFromStatistics } = require('./promiedos_stats');
const { calibrarApi, fichaHoraArgentina } = require('./promiedos_time');
const { collectTeams, saveTeams } = require('./teams_lib');
const { actualizarTablas } = require('./tablas_lib');
const EQUIPOS = {};
// Conversor de horarios de la API a hora argentina (Promiedos responde en la zona
// de quien pide; se calibra en cada corrida contra la ficha de un partido).
let CONVERTIR = null;
let BUILD_ID = null;

// start_time llega como "DD-MM-YYYY HH:mm"; lo paso al formato que usa el
// <input type="datetime-local"> de la app: "YYYY-MM-DDTHH:mm".
function parseFechaHora(startTime) {
  if (!startTime) return null;
  const match = startTime.match(/^(\d{2})-(\d{2})-(\d{4}) (\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, dd, mm, yyyy, hh, min] = match;
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

async function resolveBuildId() {
  const html = await getText(`${SITE}${ANCHOR_LEAGUE_PATH}`);
  const match = html.match(/"buildId":"([^"]+)"/);
  if (!match) throw new Error('No se pudo resolver el buildId de Next.js desde Promiedos.');
  return match[1];
}

async function resolveLeagues(buildId) {
  if (LEAGUE_OVERRIDE.length) {
    return LEAGUE_OVERRIDE.map((id) => ({ id, url_name: null }));
  }

  const data = await getJson(`${SITE}/_next/data/${buildId}${ANCHOR_LEAGUE_PATH}.json`);
  const categories = data?.pageProps?.menuData?.categories || [];

  const leagues = new Map();
  categories.forEach((category) => {
    if (!COUNTRY_WHITELIST.includes(category?.name)) return;
    (category?.items || []).forEach((item) => {
      const link = item?.link || '';
      const name = item?.name || '';
      if (/femenin/i.test(name)) return;
      const leagueMatch = link.match(/\/league\/([^/]+)\/([^/]+)\/?$/);
      if (!leagueMatch) return;
      const [, urlName, id] = leagueMatch;
      if (LEAGUE_ID_EXCLUDE.has(id)) return;
      if (!LEAGUE_ID_INCLUDE.has(id)) return;
      if (!leagues.has(id)) {
        leagues.set(id, { id, url_name: decodeURIComponent(urlName), name, country: COUNTRY_BY_LEAGUE[id] || category.name });
      }
    });
  });

  return [...leagues.values()];
}

// Nombre de la jornada: "Clausura, Fecha 14" -> "Fecha 14"
function nombreRonda(s) {
  const t = String(s || '').trim();
  if (!t) return null;
  const partes = t.split(',').map((x) => x.trim()).filter(Boolean);
  return partes[partes.length - 1];
}

function normalizeMatch(game, league) {
  const scores = Array.isArray(game.scores) ? game.scores : [0, 0];
  const goles = { l: scores[0] || 0, v: scores[1] || 0 };
  // status.enum: 1 programado, 2 en juego, 3 finalizado.
  // En juego, short_name dice el tramo: "1°" primer tiempo, "ET" entretiempo, "2°" segundo.
  const statusEnum = game?.status?.enum;
  const short = game?.status?.short_name || '';
  const finPartido = statusEnum === 3;
  const enJuego = statusEnum === 2;
  const finPrimerTiempo = finPartido || (enJuego && !/^1/.test(short));
  const minuto = game?.game_time_to_display || (enJuego && game?.game_time > 0 ? `${game.game_time}'` : '');

  return {
    id: `promiedos_${game.id}`,
    local: game?.teams?.[0]?.name || 'Desconocido',
    visitante: game?.teams?.[1]?.name || 'Desconocido',
    fechaHora: CONVERTIR ? CONVERTIR(parseFechaHora(game.start_time)) : parseFechaHora(game.start_time),
    finPrimerTiempo,
    finPartido,
    stats: emptyStats(),
    source: {
      provider: 'promiedos',
      leagueId: league.id,
      leagueName: league.name || league.id,
      country: league.country || COUNTRY_BY_LEAGUE[league.id] || 'Argentina',
      gameUrlName: game.url_name,
      statusShort: short,
      statusEnum: statusEnum ?? null,
      minuto,
      ronda: nombreRonda(game.stage_round_name)
    },
    _needsDetail: finPartido || enJuego,
    _goles: goles,
    _gameUrlName: game.url_name
  };
}

function todayInArgentina() {
  // formato "YYYY-MM-DD", para comparar directo contra fechaHora (que ya
  // viene como "YYYY-MM-DDTHH:mm").
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
  return parts;
}

const DAYS_AHEAD = Number(process.env.PROMIEDOS_DAYS_AHEAD || 2);

// Las copas de eliminacion directa (Carabao Cup, FA Cup, Copa Argentina...)
// devuelven en 'latest' la proxima ronda programada, que puede estar meses
// adelante. Los partidos ya terminados se guardan siempre (sirven para los
// promedios historicos); los programados solo se guardan si caen dentro de
// los proximos DAYS_AHEAD dias (hoy inclusive), para seguir teniendo
// partidos para cargar aunque ya se haya jugado todo lo de hoy.
function isRelevantForToday(match, today) {
  if (match.finPartido || match.finPrimerTiempo) return true;
  if (!match.fechaHora) return false;
  const matchDate = new Date(`${match.fechaHora.slice(0, 10)}T00:00:00Z`);
  const todayDate = new Date(`${today}T00:00:00Z`);
  const diffDays = Math.round((matchDate - todayDate) / 86400000);
  return diffDays >= 0 && diffDays <= DAYS_AHEAD;
}

async function fetchLeagueGames(league, today) {
  const url = `${API}/league/games/${league.id}/latest`;
  try {
    const data = await getJson(url);
    const games = Array.isArray(data?.games) ? data.games : [];
    if (!CONVERTIR && games.length) {
      const cal = await calibrarApi(games[0], getJson, SITE, BUILD_ID, league.id);
      if (cal) {
        CONVERTIR = cal.convertir;
        console.log(`Horarios calibrados: zona ${cal.tz}, ajuste API ${cal.delta} min`);
      }
    }
    collectTeams(games, EQUIPOS);
    const matches = games.map((game) => normalizeMatch(game, league));
    const relevant = matches.filter((m) => isRelevantForToday(m, today));
    console.log(`Liga ${league.name || league.id} (${league.id}): ${games.length} partidos en 'latest', ${relevant.length} relevantes (terminados o de hoy)`);
    return relevant;
  } catch (error) {
    console.warn(`No se pudo traer partidos de la liga ${league.id}:`, error.message || error);
    return [];
  }
}

// Canal de TV (Argentina), estadio y árbitro: vienen en game_info de la ficha
function infoDeFicha(game) {
  const info = Array.isArray(game?.game_info) ? game.game_info : [];
  const val = (re) => (info.find((x) => re.test(String(x?.name || ''))) || {}).value || null;
  return { tv: val(/arg\s*tv/i) || val(/\btv\b/i), estadio: val(/estadio/i), arbitro: val(/rbitro/i) };
}
function ponerInfo(match, info) {
  match.source = Object.assign({}, match.source);
  if (info.tv) match.source.tv = info.tv;
  if (info.estadio) match.source.estadio = info.estadio;
  if (info.arbitro) match.source.arbitro = info.arbitro;
}

async function enrichWithDetail(match, buildId, previo, today) {
  if (!match._needsDetail || !match._gameUrlName) {
    match.stats.goles = match._goles;
    // Programados: la ficha se baja una vez por día para el canal de TV (cambia poco)
    if (previo && previo.source && previo.source.infoDia === today) {
      ['tv', 'estadio', 'arbitro'].forEach((k) => { if (previo.source[k]) match.source[k] = previo.source[k]; });
      match.source.infoDia = today;
    } else if (match._gameUrlName) {
      const gameId = match.id.replace(/^promiedos_/, '');
      try {
        const data = await getJson(`${SITE}/_next/data/${buildId}/game/${encodeURIComponent(match._gameUrlName)}/${gameId}.json`);
        ponerInfo(match, infoDeFicha(data?.pageProps?.initialData?.game));
        match.source.infoDia = today;
        const exacta = fichaHoraArgentina(data);
        if (exacta) match.fechaHora = exacta;
      } catch (error) {
        console.warn(`No se pudo traer la ficha del partido ${match.id}:`, error.message || error);
        if (previo && previo.source) ['tv', 'estadio', 'arbitro'].forEach((k) => { if (previo.source[k]) match.source[k] = previo.source[k]; });
      }
    }
    delete match._needsDetail;
    delete match._goles;
    delete match._gameUrlName;
    return match;
  }
  const gameId = match.id.replace(/^promiedos_/, '');
  const url = `${SITE}/_next/data/${buildId}/game/${encodeURIComponent(match._gameUrlName)}/${gameId}.json`;
  try {
    const data = await getJson(url);
    const exacta = fichaHoraArgentina(data);
    if (exacta) match.fechaHora = exacta; // la ficha trae hora y zona en la misma respuesta
    const statistics = data?.pageProps?.initialData?.game?.statistics;
    match.stats = statsFromStatistics(statistics, match._goles);
    ponerInfo(match, infoDeFicha(data?.pageProps?.initialData?.game));
  } catch (error) {
    console.warn(`No se pudieron traer estadisticas del partido ${match.id}:`, error.message || error);
    match.stats.goles = match._goles;
  }
  delete match._needsDetail;
  delete match._goles;
  delete match._gameUrlName;
  return match;
}


// ---------- Temporada completa de las ligas europeas (para los % de las apuestas) ----------
// La vuelta normal solo ve la fecha en curso ('latest'). Esto recorre todas las fechas
// de la temporada y agrega los partidos terminados que falten, con sus estadísticas.
// Corre en las vueltas completas, con tope de fichas por vuelta; cuando una liga queda
// completa no se vuelve a revisar hasta el día siguiente.
const HISTORICO_LIGAS = ['h', 'bb', 'bh', 'fhc'];
const HISTORICO_MAX = Number(process.env.HISTORICO_MAX || 120);
async function completarTemporada(leagues, buildId, byId, existing, today) {
  const estado = Object.assign({}, existing.historico || {});
  let fichas = 0;
  for (const league of leagues) {
    if (!HISTORICO_LIGAS.includes(league.id) || !league.url_name) continue;
    if (estado[league.id] === today) continue;
    if (fichas >= HISTORICO_MAX || sinTiempo()) break;
    let page;
    try {
      page = await getJson(`${SITE}/_next/data/${buildId}/league/${encodeURIComponent(league.url_name)}/${league.id}.json`);
    } catch (e) { console.warn(`Histórico ${league.id}: no se pudo leer la página de la liga`, e.message || e); continue; }
    const filtros = (page?.pageProps?.data?.games?.filters || []).filter((f) => f.key && f.key !== 'latest' && /^\d+_\d+_\d+_-?\d+$/.test(f.key));
    let faltan = 0, agregados = 0;
    for (const f of filtros) {
      if (fichas >= HISTORICO_MAX || sinTiempo()) { faltan++; continue; }
      let games;
      try { games = (await getJson(`${API}/league/games/${league.id}/${encodeURIComponent(f.key)}`))?.games || []; }
      catch (e) { faltan++; continue; }
      collectTeams(games, EQUIPOS);
      for (const g of games) {
        if (g?.status?.enum !== 3 || byId.has(`promiedos_${g.id}`)) continue;
        if (fichas >= HISTORICO_MAX || sinTiempo()) { faltan++; break; }
        const m = normalizeMatch(g, league);
        await enrichWithDetail(m, buildId, null, today);
        byId.set(m.id, m);
        fichas++; agregados++;
        if (DELAY_MS > 0) await sleep(DELAY_MS);
      }
      if (DELAY_MS > 0) await sleep(DELAY_MS);
    }
    if (!faltan && filtros.length) estado[league.id] = today;
    console.log(`Histórico ${league.name || league.id}: ${filtros.length} fechas, ${agregados} partidos agregados${faltan ? ' (sigue en la próxima vuelta)' : ' (completo)'}`);
  }
  return estado;
}

// ---------- Temporada anterior de Premier, La Liga y Serie A (solo para afinar los %) ----------
// Promiedos arma la clave de cada fecha como <torneo>_<temporada>_<etapa>_<fecha>; la temporada
// anterior es la misma clave con temporada - 1. Se guarda aparte, compacta, en
// data/temporada_anterior.json (la app no la muestra como partidos, solo la usa para el cálculo).
const ANTERIOR_LIGAS = ['h', 'bb', 'bh'];
const ANTERIOR_PATH = path.join(__dirname, '..', 'data', 'temporada_anterior.json');
const ANTERIOR_MAX = Number(process.env.ANTERIOR_MAX || 400);
// Tiempo máximo por vuelta para las cargas históricas (no deben frenar la actualización en vivo)
const HIST_SEGUNDOS = Number(process.env.HIST_SEGUNDOS || 75);
let HIST_FIN = 0;
const sinTiempo = () => Date.now() > HIST_FIN;
async function completarTemporadaAnterior(leagues, buildId) {
  const arch = fs.existsSync(ANTERIOR_PATH) ? JSON.parse(fs.readFileSync(ANTERIOR_PATH, 'utf8')) : { ligas: {}, partidos: [] };
  const ya = new Set(arch.partidos.map((p) => p.id));
  let fichas = 0, cambios = false;
  // en el orden de ANTERIOR_LIGAS (Premier primero)
  const orden = ANTERIOR_LIGAS.map((id) => leagues.find((l) => l.id === id)).filter(Boolean);
  for (const league of orden) {
    if (!league.url_name) continue;
    const info = arch.ligas[league.id] || {};
    if (info.completo) continue;
    if (fichas >= ANTERIOR_MAX || sinTiempo()) break;
    let filtros;
    try {
      const page = await getJson(`${SITE}/_next/data/${buildId}/league/${encodeURIComponent(league.url_name)}/${league.id}.json`);
      filtros = (page?.pageProps?.data?.games?.filters || []).filter((f) => /^\d+_\d+_\d+_\d+$/.test(f.key || ''));
    } catch (e) { console.warn(`Temporada anterior ${league.id}: no se pudo leer la liga`, e.message || e); continue; }
    if (!filtros.length) continue;
    const [torneo, temp, etapa] = filtros[0].key.split('_').map(Number);
    const tempAnt = temp - 1;
    let faltan = 0, agregados = 0, rondas = 0;
    for (let ronda = 1; ronda <= 38; ronda++) {
      if (fichas >= ANTERIOR_MAX || sinTiempo()) { faltan++; continue; }
      let games;
      try { games = (await getJson(`${API}/league/games/${league.id}/${torneo}_${tempAnt}_${etapa}_${ronda}`))?.games || []; }
      catch (e) { faltan++; continue; }
      if (games.length) rondas++;
      for (const g of games) {
        const id = `promiedos_${g.id}`;
        if (g?.status?.enum !== 3 || ya.has(id)) continue;
        if (fichas >= ANTERIOR_MAX || sinTiempo()) { faltan++; break; }
        const sc = Array.isArray(g.scores) ? g.scores : [0, 0];
        const goles = { l: sc[0] || 0, v: sc[1] || 0 };
        let stats;
        try {
          const data = await getJson(`${SITE}/_next/data/${buildId}/game/${encodeURIComponent(g.url_name)}/${g.id}.json`);
          stats = statsFromStatistics(data?.pageProps?.initialData?.game?.statistics, goles);
        } catch (e) { faltan++; continue; }
        const st = {};
        Object.keys(stats).forEach((k) => { st[k] = [stats[k].l || 0, stats[k].v || 0]; });
        arch.partidos.push({ id, liga: league.id, fecha: parseFechaHora(g.start_time), local: g?.teams?.[0]?.name, visitante: g?.teams?.[1]?.name, stats: st });
        ya.add(id); fichas++; agregados++; cambios = true;
        if (DELAY_MS > 0) await sleep(DELAY_MS);
      }
      if (DELAY_MS > 0) await sleep(DELAY_MS);
    }
    arch.ligas[league.id] = { temporada: tempAnt, completo: !faltan && rondas >= 38 };
    cambios = true;
    console.log(`Temporada anterior ${league.name || league.id}: ${agregados} partidos agregados${faltan ? ' (sigue en la próxima vuelta)' : ' (completa)'}`);
  }
  if (cambios) fs.writeFileSync(ANTERIOR_PATH, JSON.stringify(arch), 'utf8');
}

async function run() {
  const buildId = await resolveBuildId();
  BUILD_ID = buildId;
  console.log('buildId:', buildId);

  const leagues = await resolveLeagues(buildId);
  console.log(`Ligas a recorrer: ${leagues.length}`);

  const today = todayInArgentina();
  console.log('Fecha de hoy (Argentina):', today);

  const allMatches = [];
  const existing = fs.existsSync(OUTPUT_PATH)
    ? JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8'))
    : { matches: [], bets: [], capitalInicial: 0 };
  // Partidos ya terminados y guardados: no se vuelve a bajar su ficha (no cambian)
  const yaTerminados = new Map((existing.matches || []).filter((m) => m.finPartido).map((m) => [m.id, m]));
  const previos = new Map((existing.matches || []).map((m) => [m.id, m]));
  let fichas = 0, reusados = 0;

  for (const league of leagues) {
    const matches = await fetchLeagueGames(league, today);
    for (const match of matches) {
      const guardado = yaTerminados.get(match.id);
      if (match.finPartido && guardado) {
        allMatches.push(Object.assign(guardado, { source: Object.assign({}, guardado.source, { ronda: match.source.ronda || guardado.source?.ronda }) }));
        reusados++;
        continue;
      }
      await enrichWithDetail(match, buildId, previos.get(match.id), today);
      allMatches.push(match);
      fichas++;
      if (DELAY_MS > 0) await sleep(DELAY_MS);
    }
    if (DELAY_MS > 0) await sleep(DELAY_MS);
  }
  console.log(`Fichas bajadas: ${fichas} (en juego o recién terminados); reutilizados sin bajar: ${reusados}.`);

  // Limpieza de corridas anteriores: partidos programados que quedaron
  // guardados (ej. la proxima ronda de una copa, meses adelante) y hoy ya
  // no son relevantes, mas partidos de ligas que ya no cubrimos. Los
  // terminados de ligas vigentes se conservan siempre.
  const keptExisting = (existing.matches || [])
    .filter((m) => !LEAGUE_ID_EXCLUDE.has(m?.source?.leagueId))
    .filter((m) => LEAGUE_ID_INCLUDE.has(m?.source?.leagueId))
    .filter((m) => isRelevantForToday(m, today));
  const dropped = (existing.matches || []).length - keptExisting.length;
  if (dropped > 0) console.log(`Se limpiaron ${dropped} partidos programados viejos que ya no son de hoy.`);

  const byId = new Map(keptExisting.map((m) => [m.id, m]));
  allMatches.forEach((m) => byId.set(m.id, m));

  let historico = existing.historico;
  // las cargas históricas van solo en las vueltas completas del bucle (no en el pedido manual)
  HIST_FIN = Date.now() + HIST_SEGUNDOS * 1000;
  if (process.env.RAPIDO !== '1' && process.env.UNA_VEZ !== 'true') {
    try { await completarTemporadaAnterior(leagues, buildId); }
    catch (err) { console.warn('Falló la temporada anterior:', err.message || err); }
    try { historico = await completarTemporada(leagues, buildId, byId, existing, today); }
    catch (err) { console.warn('Falló el histórico de las ligas europeas:', err.message || err); }
  }

  const out = {
    ...existing,
    historico,
    matches: [...byId.values()]
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  // Tablas de posiciones (Liga Profesional, Primera Nacional y las ligas europeas)
  // En la vuelta rápida (partidos en juego) las tablas se dejan para la vuelta completa
  if (process.env.RAPIDO !== '1') try {
    const slugs = Object.fromEntries(leagues.filter((l) => l.url_name).map((l) => [l.id, l.url_name]));
    if (await actualizarTablas(getJson, SITE, buildId, collectTeams, EQUIPOS, slugs)) console.log('tablas.json actualizado.');
  } catch (err) {
    console.warn('No se pudieron actualizar las tablas:', err.message || err);
  }
  const nEquipos = saveTeams(EQUIPOS);
  if (nEquipos) console.log(`teams.json actualizado (${nEquipos} equipos).`);
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(out, null, 2), 'utf8');
  console.log(`Se escribieron ${out.matches.length} partidos en total (${allMatches.length} traidos en esta corrida) en ${OUTPUT_PATH}`);
}

run().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
