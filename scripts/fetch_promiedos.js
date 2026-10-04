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
const DELAY_MS = Number(process.env.PROMIEDOS_DELAY_MS || 300);
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'matches.json');
const LEAGUE_OVERRIDE = (process.env.PROMIEDOS_LEAGUES || '').split(',').map((v) => v.trim()).filter(Boolean);
// Paises/categorias del menu de Promiedos que queremos cubrir. El resto
// (Alemania, Portugal, Francia, Brasil, Uruguay, Paraguay, Colombia, Chile,
// Mexico, EEUU, Selecciones) queda afuera a proposito.
const COUNTRY_WHITELIST = ['Argentina', 'Inglaterra', 'España', 'Italia', 'Internacional'];
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
  const res = await fetchImpl(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`);
  return res.text();
}

async function getJson(url) {
  const text = await getText(url);
  return JSON.parse(text);
}

function emptyStats() {
  return {
    goles: { l: 0, v: 0 },
    tarjetas: { l: 0, v: 0 },
    corners: { l: 0, v: 0 },
    tirosArco: { l: 0, v: 0 },
    atajadas: { l: 0, v: 0 }
  };
}

// Promiedos no reporta atajadas de arquero en ningun lado de su API publica;
// esa categoria queda siempre en 0 y es editable a mano en la app, igual que
// cualquier otro dato que el usuario quiera corregir.
function statsFromStatistics(statistics, goles) {
  const stats = emptyStats();
  stats.goles = goles;
  if (!Array.isArray(statistics)) return stats;

  const byName = new Map(statistics.map((entry) => [entry?.name || '', entry]));
  const getPair = (name) => {
    const entry = byName.get(name);
    const values = entry?.values;
    if (!Array.isArray(values) || values.length < 2) return [0, 0];
    return [Number(values[0]) || 0, Number(values[1]) || 0];
  };

  const [shotsL, shotsV] = getPair('Remates al arco');
  const [cornersL, cornersV] = getPair('Saques de Esquina');
  const [yellowL, yellowV] = getPair('Tarjetas Amarillas');
  const [redL, redV] = getPair('Tarjetas Rojas');

  stats.tirosArco = { l: shotsL, v: shotsV };
  stats.corners = { l: cornersL, v: cornersV };
  stats.tarjetas = { l: yellowL + redL, v: yellowV + redV };
  return stats;
}

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
      if (!leagues.has(id)) {
        leagues.set(id, { id, url_name: decodeURIComponent(urlName), name, country: category.name });
      }
    });
  });

  return [...leagues.values()];
}

function normalizeMatch(game, league) {
  const scores = Array.isArray(game.scores) ? game.scores : [0, 0];
  const goles = { l: scores[0] || 0, v: scores[1] || 0 };
  const statusEnum = game?.status?.enum;
  const finPartido = statusEnum === 3;
  const finPrimerTiempo = statusEnum >= 2;

  return {
    id: `promiedos_${game.id}`,
    local: game?.teams?.[0]?.name || 'Desconocido',
    visitante: game?.teams?.[1]?.name || 'Desconocido',
    fechaHora: parseFechaHora(game.start_time),
    finPrimerTiempo,
    finPartido,
    stats: emptyStats(),
    source: {
      provider: 'promiedos',
      leagueId: league.id,
      leagueName: league.name || league.id,
      gameUrlName: game.url_name,
      statusShort: game?.status?.short_name || ''
    },
    _needsDetail: finPartido || finPrimerTiempo,
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
    const matches = games.map((game) => normalizeMatch(game, league));
    const relevant = matches.filter((m) => isRelevantForToday(m, today));
    console.log(`Liga ${league.name || league.id} (${league.id}): ${games.length} partidos en 'latest', ${relevant.length} relevantes (terminados o de hoy)`);
    return relevant;
  } catch (error) {
    console.warn(`No se pudo traer partidos de la liga ${league.id}:`, error.message || error);
    return [];
  }
}

async function enrichWithDetail(match, buildId) {
  if (!match._needsDetail || !match._gameUrlName) {
    match.stats.goles = match._goles;
    delete match._needsDetail;
    delete match._goles;
    delete match._gameUrlName;
    return match;
  }
  const gameId = match.id.replace(/^promiedos_/, '');
  const url = `${SITE}/_next/data/${buildId}/game/${encodeURIComponent(match._gameUrlName)}/${gameId}.json`;
  try {
    const data = await getJson(url);
    const statistics = data?.pageProps?.initialData?.game?.statistics;
    match.stats = statsFromStatistics(statistics, match._goles);
  } catch (error) {
    console.warn(`No se pudieron traer estadisticas del partido ${match.id}:`, error.message || error);
    match.stats.goles = match._goles;
  }
  delete match._needsDetail;
  delete match._goles;
  delete match._gameUrlName;
  return match;
}

async function run() {
  const buildId = await resolveBuildId();
  console.log('buildId:', buildId);

  const leagues = await resolveLeagues(buildId);
  console.log(`Ligas a recorrer: ${leagues.length}`);

  const today = todayInArgentina();
  console.log('Fecha de hoy (Argentina):', today);

  const allMatches = [];
  for (const league of leagues) {
    const matches = await fetchLeagueGames(league, today);
    for (const match of matches) {
      await enrichWithDetail(match, buildId);
      allMatches.push(match);
      if (DELAY_MS > 0) await sleep(DELAY_MS);
    }
    if (DELAY_MS > 0) await sleep(DELAY_MS);
  }

  const existing = fs.existsSync(OUTPUT_PATH)
    ? JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8'))
    : { matches: [], bets: [], capitalInicial: 0 };

  // Limpieza de corridas anteriores: partidos programados que quedaron
  // guardados (ej. la proxima ronda de una copa, meses adelante) y hoy ya
  // no son relevantes, mas partidos de ligas que ya no cubrimos. Los
  // terminados de ligas vigentes se conservan siempre.
  const keptExisting = (existing.matches || [])
    .filter((m) => !LEAGUE_ID_EXCLUDE.has(m?.source?.leagueId))
    .filter((m) => isRelevantForToday(m, today));
  const dropped = (existing.matches || []).length - keptExisting.length;
  if (dropped > 0) console.log(`Se limpiaron ${dropped} partidos programados viejos que ya no son de hoy.`);

  const byId = new Map(keptExisting.map((m) => [m.id, m]));
  allMatches.forEach((m) => byId.set(m.id, m));

  const out = {
    ...existing,
    matches: [...byId.values()]
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(out, null, 2), 'utf8');
  console.log(`Se escribieron ${out.matches.length} partidos en total (${allMatches.length} traidos en esta corrida) en ${OUTPUT_PATH}`);
}

run().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
