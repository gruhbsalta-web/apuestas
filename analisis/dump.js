// Temporal: genera los datos definitivos (partidos + jugadores) como el cron.
const { execSync } = require('child_process');
const fs = require('fs');
let log = '';
for (const cmd of ['node scripts/fetch_promiedos.js', 'node scripts/fetch_players.js']) {
  try {
    log += `\n$ ${cmd}\n` + execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    log += (e.stdout || '') + '\nERROR:\n' + (e.stderr || e.message);
  }
}
fs.writeFileSync('analisis/players_log.txt', log);
console.log(log.slice(-4000));
