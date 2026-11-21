// Estadisticas de equipo de una ficha de Promiedos, en el formato que usa la app
// (stats.{goles,tarjetas,corners,tirosArco,atajadas}.{l,v}). Compartido entre
// fetch_promiedos.js (partidos) y fetch_players.js (fichas de toda la temporada).

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
  // Promiedos no publica atajadas: se estiman como remates al arco del rival
  // menos goles del rival (ej. 0-0 con 2 remates al arco del local = 2 atajadas
  // del arquero visitante). Nunca negativo (un gol en contra no es remate).
  stats.atajadas = {
    l: Math.max(0, shotsV - (Number(goles?.v) || 0)),
    v: Math.max(0, shotsL - (Number(goles?.l) || 0))
  };
  stats.corners = { l: cornersL, v: cornersV };
  stats.tarjetas = { l: yellowL + redL, v: yellowV + redV };
  return stats;
}

module.exports = { emptyStats, statsFromStatistics };

// ---------- Tiempo reglamentario (para resolver apuestas) ----------
// Las apuestas se resuelven con los 90' (+ agregado). Si el partido va al alargue,
// Promiedos sigue sumando goles, tarjetas y corners en sus estadísticas, así que se
// guarda aparte match.stats90:
// - goles y tarjetas: exactos (totales menos lo que pasó en el alargue, según el minuto a minuto)
// - corners, tiros al arco y atajadas: Promiedos no da el minuto de cada uno; se toman
//   de la última foto antes del alargue (match.foto2T, se guarda en cada vuelta del 2do tiempo).
//   Si la foto no llega al 90' esos valores son un piso y van en stats90.aprox; la app
//   usa el total final como techo.
const minutoDe = (t) => { const m = String(t ?? '').match(/^(\d+)/); return m ? Number(m[1]) : null; };
const minutoAlargue = (t) => !/\+/.test(String(t ?? '')) && (minutoDe(t) || 0) > 90;

function etapasSinPenales(game) {
  return (Array.isArray(game?.events) ? game.events : []).filter((st) => !st?.is_penalties_stage);
}

function huboAlargue(game, statusShort, minuto) {
  const etapas = etapasSinPenales(game);
  if (etapas.length > 2) return true;
  if (minutoAlargue(minuto)) return true;
  const sh = String(statusShort || '');
  if (sh !== 'ET' && /alarg|suplem|extra|\bAET\b|^[12]°?\s*A\b|^[12]\s*TS/i.test(sh)) return true;
  return etapas.some((st) => (st.rows || []).some((r) => (r.events || []).some((e) => minutoAlargue(e?.time))));
}

// Goles y tarjetas por equipo que ocurrieron en el alargue.
function eventosAlargue(game) {
  const scores = (Array.isArray(game?.scores) ? game.scores : []).map(Number);
  const lista = [];
  etapasSinPenales(game).forEach((st, i) => (st.rows || []).forEach((r) => (r.events || []).forEach((e) => {
    lista.push({ e, et: i >= 2 || minutoAlargue(e?.time) });
  })));
  // gol en contra (tipo 2): puede venir con el equipo que lo hizo o el que se beneficia;
  // se elige la lectura que cierra con el marcador
  const leer = (invertir) => lista.filter(({ e }) => [1, 2, 3].includes(e?.type))
    .map(({ e, et }) => ({ team: e.type === 2 && invertir ? (e.team === 1 ? 2 : 1) : e.team, et }));
  const cierra = (gs) => [1, 2].every((t, k) => gs.filter((g) => g.team === t).length === (scores[k] || 0));
  const goles = cierra(leer(true)) && !cierra(leer(false)) ? leer(true) : leer(false);
  const out = { goles: { l: 0, v: 0 }, tarjetas: { l: 0, v: 0 } };
  goles.filter((g) => g.et).forEach((g) => { out.goles[g.team === 2 ? 'v' : 'l']++; });
  lista.filter(({ e, et }) => et && (e?.type === 4 || e?.type === 7)).forEach(({ e }) => { out.tarjetas[e.team === 2 ? 'v' : 'l']++; });
  return out;
}

// Completa match.source.alargue, match.foto2T y match.stats90. previo = el partido guardado antes.
function tiempoReglamentario(match, game, previo) {
  const src = match.source || {};
  const alargue = huboAlargue(game, src.statusShort, src.minuto);
  src.alargue = alargue;
  const foto = (m) => ({
    minuto: m.source?.minuto || '',
    enPausa: m.source?.statusShort !== '2°',
    corners: Object.assign({}, m.stats.corners),
    tirosArco: Object.assign({}, m.stats.tirosArco),
    atajadas: Object.assign({}, m.stats.atajadas)
  });
  if (!alargue) {
    delete match.stats90;
    // en juego, 2do tiempo (o la pausa antes del alargue): se guarda la foto
    if (src.statusEnum === 2 && match.finPrimerTiempo && src.statusShort !== 'ET') match.foto2T = foto(match);
    else if (previo?.foto2T && !match.finPartido) match.foto2T = previo.foto2T;
    return match;
  }
  const f = previo?.foto2T || null;
  if (f) match.foto2T = f;
  const et = eventosAlargue(game);
  const menos = (a, b) => ({ l: Math.max(0, (a?.l || 0) - (b?.l || 0)), v: Math.max(0, (a?.v || 0) - (b?.v || 0)) });
  const exacta = f && (f.enPausa || (minutoDe(f.minuto) || 0) >= 90);
  match.stats90 = {
    goles: menos(match.stats.goles, et.goles),
    tarjetas: menos(match.stats.tarjetas, et.tarjetas),
    corners: f ? f.corners : { l: 0, v: 0 },
    tirosArco: f ? f.tirosArco : { l: 0, v: 0 },
    atajadas: f ? f.atajadas : { l: 0, v: 0 },
    foto: f ? f.minuto : null,
    aprox: exacta ? [] : ['corners', 'tirosArco', 'atajadas']
  };
  return match;
}

module.exports.tiempoReglamentario = tiempoReglamentario;
