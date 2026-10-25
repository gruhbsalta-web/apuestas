// Temporal: genera data/players.json y completa data/matches.json con la temporada.
const { execSync } = require('child_process');
const fs = require('fs');
let log = '';
try {
  log = execSync('node scripts/fetch_players.js', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
} catch (e) {
  log = (e.stdout || '') + '\nERROR:\n' + (e.stderr || e.message);
}
fs.writeFileSync('analisis/players_log.txt', log);
console.log(log.slice(-3000));
