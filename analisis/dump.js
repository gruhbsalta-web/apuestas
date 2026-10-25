// Temporal: corrida completa de prueba de scripts/fetch_players.js
const { execSync } = require('child_process');
const fs = require('fs');
let log = '';
try {
  log = execSync('node scripts/fetch_players.js', { env: { ...process.env, PLAYERS_OUTPUT: 'analisis/players.json' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
} catch (e) {
  log = (e.stdout || '') + '\nERROR:\n' + (e.stderr || e.message);
}
fs.writeFileSync('analisis/players_log.txt', log);
console.log(log.slice(-3000));
