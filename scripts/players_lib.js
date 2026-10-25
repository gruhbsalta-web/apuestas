// Calculo de estadisticas por jugador a partir de la ficha de un partido de
// Promiedos (pageProps.initialData.game). Se usa desde fetch_players.js.
//
// Fuentes dentro de la ficha:
// - players.lineups.teams[i].starting / bench: quien jugo, titular o suplente,
//   numero, posicion, edad. bench[].substitution.type 1 = entro; starting[].substitution.type 2 = salio.
// - events[].rows[].events[]: fuente de verdad de goles, asistencias y tarjetas
//   (la alineacion a veces no marca la roja).
//     type 1  = gol      texts: [autor, asistente?]
//     type 4  = amarilla texts: [jugador]
//     type 7  = roja     texts: [jugador]
//     type 9  = gol anulado (se ignora)
//     type 15 = cambio   texts: [entra, sale]
// - players.missing_players: ausentes por equipo (lesionados, suspendidos).

const FULL_MATCH = 90;

// "45'+2" -> 45, "90'" -> 90, 78 -> 78
function minuteOf(t) {
  if (typeof t === 'number') return t;
  const m = String(t || '').match(/^(\d+)/);
  return m ? Number(m[1]) : null;
}

function normName(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function allEvents(game) {
  const out = [];
  (game.events || []).forEach((stage) => {
    if (stage.is_penalties_stage) return; // la tanda de penales no cuenta como gol
    (stage.rows || []).forEach((row) => (row.events || []).forEach((e) => out.push(e)));
  });
  return out;
}

// Devuelve las lineas de cada jugador que participo (titular o suplente que entro).
function playerLinesFromGame(game) {
  const lineups = game?.players?.lineups?.teams || [];
  const teams = game.teams || [];
  const events = allEvents(game);
  const lines = [];

  lineups.forEach((lu, idx) => {
    const teamNum = lu.team_num || idx + 1;
    const team = teams[teamNum - 1] || {};
    const byName = new Map();

    const add = (p, titular) => {
      const sub = p.substitution || {};
      let entra = null;
      let sale = null;
      if (titular) {
        entra = 0;
        sale = sub.type === 2 ? minuteOf(sub.time) : null;
      } else {
        if (sub.type !== 1) return; // suplente que no entro
        entra = minuteOf(sub.time);
      }
      const line = {
        nombre: p.name,
        corto: p.player_short_name || p.name,
        numero: p.jersey_num,
        posicion: p.position || '',
        edad: p.age ?? null,
        equipoId: team.id,
        equipo: team.name,
        titular,
        entra,
        sale,
        goles: 0,
        asist: 0,
        amarillas: 0,
        rojas: 0
      };
      lines.push(line);
      byName.set(normName(p.name), line);
    };

    (lu.starting || []).forEach((p) => add(p, true));
    (lu.bench || []).forEach((p) => add(p, false));

    // Para resolver eventos que traen solo el nombre corto o cambios de grafia
    const find = (name) => {
      const n = normName(name);
      if (!n) return null;
      if (byName.has(n)) return byName.get(n);
      for (const [k, v] of byName) {
        if (k.endsWith(' ' + n) || n.endsWith(' ' + k) || normName(v.corto) === n) return v;
      }
      return null;
    };

    events.filter((e) => e.team === teamNum).forEach((e) => {
      const t = e.texts || [];
      if (e.type === 1) {
        const autor = find(t[0]);
        if (autor) autor.goles += 1;
        const asist = t[1] ? find(t[1]) : null;
        if (asist) asist.asist += 1;
      } else if (e.type === 4) {
        const p = find(t[0]);
        if (p) p.amarillas += 1;
      } else if (e.type === 7) {
        const p = find(t[0]);
        if (p) {
          p.rojas += 1;
          const min = minuteOf(e.time);
          if (min != null && (p.sale == null || min < p.sale)) p.sale = min;
        }
      }
    });
  });

  lines.forEach((l) => {
    const desde = l.entra ?? 0;
    const hasta = l.sale ?? FULL_MATCH;
    l.minutos = Math.max(hasta - desde, l.titular ? 0 : 1);
  });
  return lines;
}

function missingFromGame(game) {
  const out = [];
  const teams = game.teams || [];
  (game?.players?.missing_players || []).forEach((list, idx) => {
    const team = teams[idx] || {};
    (list || []).forEach((p) => out.push({
      equipoId: team.id,
      equipo: team.name,
      nombre: p.name,
      posicion: p.position || '',
      motivo: p?.missing_details?.reason || ''
    }));
  });
  return out;
}

// DT de cada equipo en el partido (lineups.teams[i].staff, posicion "Dirección")
// con el resultado desde su lado. Solo para partidos terminados.
function coachesFromGame(game) {
  const out = [];
  const teams = game.teams || [];
  const scores = Array.isArray(game.scores) ? game.scores : null;
  if (!scores) return out;
  (game?.players?.lineups?.teams || []).forEach((lu, idx) => {
    const teamNum = lu.team_num || idx + 1;
    const team = teams[teamNum - 1] || {};
    const staff = lu.staff || [];
    const dt = staff.find((p) => /direcci|entrenador/i.test(`${p.position} ${p.formation_position}`)) || staff[0];
    if (!dt || !dt.name) return;
    const gf = Number(scores[teamNum - 1]) || 0;
    const gc = Number(scores[teamNum === 1 ? 1 : 0]) || 0;
    out.push({
      nombre: dt.name,
      edad: dt.age ?? null,
      equipoId: team.id,
      equipo: team.name,
      gf,
      gc,
      resultado: gf > gc ? 'G' : gf === gc ? 'E' : 'P'
    });
  });
  return out;
}

module.exports = { playerLinesFromGame, missingFromGame, coachesFromGame, minuteOf, normName };
