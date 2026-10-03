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

const API_KEY = process.env.API_SPORTS_KEY || process.argv[2];
const SEASON = process.env.API_SPORTS_SEASON || '2024';
const FALLBACK_SEASONS = ['2024'];
const REQUEST_DELAY_MS = Number(process.env.API_SPORTS_DELAY_MS || 1200);
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'matches.json');
const LEAGUE_IDS = (process.env.API_SPORTS_LEAGUES || '').split(',').map((v) => v.trim()).filter(Boolean);
const DAYS_WINDOW = Number(process.env.API_SPORTS_DAYS || 7);
const FALLBACK_FIXTURES = [
  {
    leagueId: 1,
    fixture: {
      id: 1001,
      date: '2026-08-06T20:00:00-03:00',
      status: { short: 'NS' }
    },
    teams: { home: { name: 'Boca Juniors' }, away: { name: 'River Plate' } },
    goals: { home: 0, away: 0 },
    stats: {
      goles: { l: 1, v: 0 },
      tarjetas: { l: 2, v: 1 },
      corners: { l: 4, v: 5 },
      tirosArco: { l: 6, v: 3 },
      atajadas: { l: 2, v: 4 }
    }
  },
  {
    leagueId: 2,
    fixture: {
      id: 1002,
      date: '2026-08-07T19:15:00-03:00',
      status: { short: 'NS' }
    },
    teams: { home: { name: 'Talleres' }, away: { name: 'Independiente' } },
    goals: { home: 0, away: 0 },
    stats: {
      goles: { l: 0, v: 1 },
      tarjetas: { l: 3, v: 2 },
      corners: { l: 3, v: 4 },
      tirosArco: { l: 4, v: 5 },
      atajadas: { l: 3, v: 2 }
    }
  },
  {
    leagueId: 3,
    fixture: {
      id: 1003,
      date: '2026-08-08T21:30:00-03:00',
      status: { short: 'NS' }
    },
    teams: { home: { name: 'Banfield' }, away: { name: 'Belgrano' } },
    goals: { home: 0, away: 0 },
    stats: {
      goles: { l: 0, v: 0 },
      tarjetas: { l: 1, v: 1 },
      corners: { l: 2, v: 3 },
      tirosArco: { l: 2, v: 2 },
      atajadas: { l: 1, v: 2 }
    }
  }
];

function emptyStats() {
  return {
    goles: { l: 0, v: 0 },
    tarjetas: { l: 0, v: 0 },
    corners: { l: 0, v: 0 },
    tirosArco: { l: 0, v: 0 },
    atajadas: { l: 0, v: 0 }
  };
}

function formatDateRange() {
  const to = new Date();
  const from = new Date();
  from.setDate(to.getDate() - DAYS_WINDOW);
  to.setDate(to.getDate() + DAYS_WINDOW);

  const fmt = (value) => value.toISOString().split('T')[0];
  return { from: fmt(from), to: fmt(to) };
}

function normalizeCardValue(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim()) return Number(value);
  return 0;
}

function normalizeStats(statsPayload) {
  const stats = Array.isArray(statsPayload) ? statsPayload : [];
  const byType = new Map(stats.map((entry) => [entry?.type || '', entry]));

  const getValue = (type) => {
    const entry = byType.get(type);
    if (!entry) return 0;
    if (typeof entry.value === 'number') return entry.value;
    if (typeof entry.value === 'string') return Number(entry.value) || 0;
    if (Array.isArray(entry.value)) return entry.value.length || 0;
    return 0;
  };

  const homeYellow = normalizeCardValue(getValue('Yellow Cards'));
  const awayYellow = normalizeCardValue(getValue('Yellow Cards'));
  const homeRed = normalizeCardValue(getValue('Red Cards'));
  const awayRed = normalizeCardValue(getValue('Red Cards'));

  return {
    goles: { l: 0, v: 0 },
    tarjetas: { l: homeYellow + homeRed, v: awayYellow + awayRed },
    corners: { l: getValue('Corner Kicks'), v: 0 },
    tirosArco: { l: getValue('Shots on Goal'), v: 0 },
    atajadas: { l: getValue('Goalkeeper Saves'), v: 0 }
  };
}

function normalizeMatch(fixture, leagueId, stats) {
  const statusShort = fixture?.fixture?.status?.short || '';
  const isFinished = ['FT', 'AET', 'PEN', 'WO', 'CANC', 'ABD', 'RT'].includes(statusShort);
  const isSecondHalf = ['HT', 'FT', 'AET', 'PEN', 'RT'].includes(statusShort);

  const statsObj = stats || emptyStats();
  statsObj.goles = {
    l: fixture?.goals?.home ?? 0,
    v: fixture?.goals?.away ?? 0
  };

  return {
    id: `api_${fixture?.fixture?.id || Date.now()}`,
    local: fixture?.teams?.home?.name || 'Desconocido',
    visitante: fixture?.teams?.away?.name || 'Desconocido',
    fechaHora: fixture?.fixture?.date || null,
    finPrimerTiempo: isSecondHalf,
    finPartido: isFinished,
    stats: statsObj,
    source: {
      provider: 'api-sports',
      leagueId,
      fixtureId: fixture?.fixture?.id || null,
      statusShort
    }
  };
}

async function apiFetch(endpoint, params = {}) {
  if (!API_KEY) {
    throw new Error('Falta API_SPORTS_KEY. Pasala como variable de entorno o como primer argumento.');
  }
  if (!fetchImpl) {
    throw new Error('No hay un fetch disponible en este entorno.');
  }

  const url = new URL(`https://v3.football.api-sports.io${endpoint}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });

  const res = await fetchImpl(url.toString(), {
    headers: {
      'x-apisports-key': API_KEY,
      'Accept': 'application/json'
    }
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API request failed ${res.status}: ${text}`);
  }

  return res.json();
}

async function resolveLeagueIds() {
  if (LEAGUE_IDS.length) {
    return LEAGUE_IDS;
  }

  const response = await apiFetch('/leagues', { country: 'Argentina' });
  const leagues = response?.response || [];

  const matches = leagues.filter((entry) => {
    const name = `${entry?.league?.name || ''} ${entry?.country?.name || ''}`.toLowerCase();
    return name.includes('liga profesional') || name.includes('primera nacional') || name.includes('primera b') || name.includes('primera c') || name.includes('primera d') || name.includes('superliga') || name.includes('copa de la liga');
  });

  const leagueIds = matches.map((entry) => entry?.league?.id).filter(Boolean);
  if (!leagueIds.length) {
    throw new Error('No se encontraron ligas de Argentina en API-Sports.');
  }

  return leagueIds;
}

async function fetchFixturesForSeason(leagueId, season) {
  const range = formatDateRange();
  const response = await apiFetch('/fixtures', {
    league: leagueId,
    season,
    from: range.from,
    to: range.to,
    timezone: 'America/Argentina/Buenos_Aires'
  });

  return response?.response || [];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildFallbackMatches() {
  return FALLBACK_FIXTURES.map((fixture) => normalizeMatch({
    fixture: fixture.fixture,
    teams: fixture.teams,
    goals: fixture.goals
  }, fixture.leagueId, fixture.stats));
}

async function loadFixtures() {
  if (!API_KEY) {
    console.warn('No se encontró API_SPORTS_KEY; usando datos de respaldo locales.');
    return buildFallbackMatches();
  }

  const leagueIds = await resolveLeagueIds();
  const allFixtures = [];

  for (const leagueId of leagueIds) {
    let fixtures = [];
    for (const season of [SEASON, ...FALLBACK_SEASONS.filter((value) => value !== SEASON)]) {
      try {
        fixtures = await fetchFixturesForSeason(leagueId, season);
        if (fixtures.length) {
          console.log(`Se usará la temporada ${season} para la liga ${leagueId}`);
          break;
        }
      } catch (error) {
        console.warn(`No se pudo consultar la temporada ${season} para la liga ${leagueId}:`, error.message || error);
      }
      if (REQUEST_DELAY_MS > 0) {
        await sleep(REQUEST_DELAY_MS);
      }
    }

    for (const fixture of fixtures) {
      let stats = emptyStats();
      const statusShort = fixture?.fixture?.status?.short || '';
      const hasStarted = statusShort !== 'NS' && statusShort !== 'TBD' && statusShort !== 'PST';

      if (hasStarted) {
        try {
          const statsResponse = await apiFetch('/fixtures/statistics', { fixture: fixture?.fixture?.id });
          const entries = statsResponse?.response?.[0]?.statistics || [];
          const homeEntry = entries.filter((entry) => entry?.team?.name === fixture?.teams?.home?.name);
          const awayEntry = entries.filter((entry) => entry?.team?.name === fixture?.teams?.away?.name);
          const homeStats = homeEntry[0]?.statistics || [];
          const awayStats = awayEntry[0]?.statistics || [];
          const toMap = (list) => new Map((list || []).map((entry) => [entry?.type || '', entry]));

          const homeMap = toMap(homeStats);
          const awayMap = toMap(awayStats);
          const getValue = (map, type) => {
            const entry = map.get(type);
            if (!entry) return 0;
            if (typeof entry.value === 'number') return entry.value;
            if (typeof entry.value === 'string') return Number(entry.value) || 0;
            return 0;
          };

          stats = {
            goles: {
              l: fixture?.goals?.home ?? 0,
              v: fixture?.goals?.away ?? 0
            },
            tarjetas: {
              l: normalizeCardValue(getValue(homeMap, 'Yellow Cards')) + normalizeCardValue(getValue(homeMap, 'Red Cards')),
              v: normalizeCardValue(getValue(awayMap, 'Yellow Cards')) + normalizeCardValue(getValue(awayMap, 'Red Cards'))
            },
            corners: {
              l: getValue(homeMap, 'Corner Kicks'),
              v: getValue(awayMap, 'Corner Kicks')
            },
            tirosArco: {
              l: getValue(homeMap, 'Shots on Goal'),
              v: getValue(awayMap, 'Shots on Goal')
            },
            atajadas: {
              l: getValue(homeMap, 'Goalkeeper Saves'),
              v: getValue(awayMap, 'Goalkeeper Saves')
            }
          };
        } catch (statsError) {
          console.warn(`No se pudieron obtener estadísticas para el fixture ${fixture?.fixture?.id}:`, statsError.message || statsError);
        }

        if (REQUEST_DELAY_MS > 0) {
          await sleep(REQUEST_DELAY_MS);
        }
      }

      allFixtures.push(normalizeMatch(fixture, leagueId, stats));
    }
  }

  return allFixtures;
}

(async () => {
  try {
    const matches = await loadFixtures();
    const existing = fs.existsSync(OUTPUT_PATH)
      ? JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8'))
      : { matches: [], bets: [], capitalInicial: 0 };

    const out = {
      ...existing,
      matches
    };

    fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(out, null, 2), 'utf8');
    console.log(`Se escribieron ${matches.length} partidos en ${OUTPUT_PATH}`);
  } catch (err) {
    console.error(err.message || err);
    process.exit(1);
  }
})();
