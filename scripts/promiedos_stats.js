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
  stats.corners = { l: cornersL, v: cornersV };
  stats.tarjetas = { l: yellowL + redL, v: yellowV + redV };
  return stats;
}

module.exports = { emptyStats, statsFromStatistics };
