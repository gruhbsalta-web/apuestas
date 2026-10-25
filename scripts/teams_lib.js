// Colores de cada club (los trae Promiedos en cada partido) para que la app
// pinte escudos y barras con los colores del equipo. Se acumulan en
// data/teams.json: { "<nombre>": { id, color, texto } }.

const fs = require('fs');
const path = require('path');

const TEAMS_PATH = process.env.TEAMS_OUTPUT || path.join(__dirname, '..', 'data', 'teams.json');

function collectTeams(games, acc = {}) {
  (games || []).forEach((g) => (g?.teams || []).forEach((t) => {
    if (!t?.name) return;
    acc[t.name] = {
      id: t.id || null,
      corto: t.short_name || t.name,
      color: t?.colors?.color || null,
      texto: t?.colors?.text_color || null
    };
  }));
  return acc;
}

// Mezcla con lo que ya habia y solo escribe si cambio algo.
function saveTeams(nuevos) {
  const prev = fs.existsSync(TEAMS_PATH) ? JSON.parse(fs.readFileSync(TEAMS_PATH, 'utf8')) : {};
  const merged = { ...prev, ...nuevos };
  const ordered = Object.fromEntries(Object.keys(merged).sort((a, b) => a.localeCompare(b, 'es')).map((k) => [k, merged[k]]));
  const txt = JSON.stringify(ordered);
  if (fs.existsSync(TEAMS_PATH) && fs.readFileSync(TEAMS_PATH, 'utf8') === txt) return 0;
  fs.mkdirSync(path.dirname(TEAMS_PATH), { recursive: true });
  fs.writeFileSync(TEAMS_PATH, txt, 'utf8');
  return Object.keys(ordered).length;
}

module.exports = { collectTeams, saveTeams };
