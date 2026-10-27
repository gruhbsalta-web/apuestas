// Decide cuánto esperar hasta la próxima vuelta del bucle de actualización.
// - Partido en juego o por empezar (desde 1 h antes, cuando sale la formación,
//   hasta 2 h 30 después del inicio): cada 2 minutos.
// - Si no: sábados y domingos cada 10 min, lunes a viernes cada 30 min, pero
//   adelantando la vuelta para despertar 1 h antes del próximo partido.
// Imprime JSON: {"intervalo": segundos, "vivo": true|false}
const fs = require('fs');
const path = require('path');

const VIVO = 120;
const ANTES = 60 * 60 * 1000;
const DESPUES = 150 * 60 * 1000;

const ahora = Date.now();
const dia = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Argentina/Buenos_Aires', weekday: 'short' }).format(new Date());
const normal = (dia === 'Sat' || dia === 'Sun') ? 600 : 1800;

let partidos = [];
try {
  partidos = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'matches.json'), 'utf8')).matches || [];
} catch (e) { /* sin datos: ritmo normal */ }

let vivo = false;
let proximoInicio = Infinity;
for (const m of partidos) {
  if (m.finPartido || !m.fechaHora) continue;
  const inicio = new Date(`${m.fechaHora}:00-03:00`).getTime();
  if (Number.isNaN(inicio)) continue;
  if (m?.source?.statusEnum === 2 || (ahora >= inicio - ANTES && ahora <= inicio + DESPUES)) vivo = true;
  else if (inicio - ANTES > ahora) proximoInicio = Math.min(proximoInicio, inicio - ANTES);
}

let intervalo = vivo ? VIVO : normal;
if (!vivo && proximoInicio !== Infinity) {
  const hasta = Math.round((proximoInicio - ahora) / 1000);
  if (hasta < intervalo) intervalo = Math.max(hasta, VIVO);
}
process.stdout.write(JSON.stringify({ intervalo, vivo }));
