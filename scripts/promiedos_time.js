// Promiedos devuelve los horarios en la hora local de quien hace el pedido
// (geolocaliza la IP). El cron corre en servidores de GitHub en Estados Unidos,
// asi que los horarios llegaban corridos (ej. 12:45 en vez de 14:45).
// Cada pagina de Promiedos trae countryId/regionId de esa geolocalizacion:
// con eso sabemos la zona horaria de origen y convertimos a Argentina.

const AR_TZ = 'America/Argentina/Buenos_Aires';

// Estados de EE.UU. por zona horaria (los runners de GitHub/Azure estan en EE.UU.)
const US_TZ = {
  'America/New_York': ['CT', 'DC', 'DE', 'FL', 'GA', 'IN', 'MA', 'MD', 'ME', 'MI', 'NC', 'NH', 'NJ', 'NY', 'OH', 'PA', 'RI', 'SC', 'VA', 'VT', 'WV', 'KY'],
  'America/Chicago': ['AL', 'AR', 'IA', 'IL', 'KS', 'LA', 'MN', 'MO', 'MS', 'ND', 'NE', 'OK', 'SD', 'TN', 'TX', 'WI'],
  'America/Denver': ['CO', 'ID', 'MT', 'NM', 'UT', 'WY'],
  'America/Phoenix': ['AZ'],
  'America/Los_Angeles': ['CA', 'NV', 'OR', 'WA'],
  'America/Anchorage': ['AK'],
  'Pacific/Honolulu': ['HI']
};
const COUNTRY_TZ = {
  AR: AR_TZ, UY: 'America/Montevideo', CL: 'America/Santiago', BR: 'America/Sao_Paulo',
  PY: 'America/Asuncion', IE: 'Europe/Dublin', GB: 'Europe/London', NL: 'Europe/Amsterdam',
  DE: 'Europe/Berlin', FR: 'Europe/Paris', ES: 'Europe/Madrid', IT: 'Europe/Rome',
  SG: 'Asia/Singapore', JP: 'Asia/Tokyo', AU: 'Australia/Sydney', IN: 'Asia/Kolkata', CA: 'America/Toronto'
};

function sourceTimezone(countryId, regionId) {
  const c = String(countryId || '').toUpperCase();
  const r = String(regionId || '').toUpperCase();
  if (c === 'US') {
    for (const [tz, states] of Object.entries(US_TZ)) if (states.includes(r)) return tz;
    return 'America/Chicago';
  }
  return COUNTRY_TZ[c] || null;
}

// Offset (minutos) de una zona horaria en un instante UTC dado.
function tzOffsetMinutes(tz, utcMs) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(new Date(utcMs)).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return (asUtc - utcMs) / 60000;
}

// "YYYY-MM-DDTHH:mm" en la zona `fromTz` -> mismo formato en hora argentina.
function toArgentina(fechaHora, fromTz) {
  if (!fechaHora || !fromTz || fromTz === AR_TZ) return fechaHora;
  const m = fechaHora.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) return fechaHora;
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  let utc = wall - tzOffsetMinutes(fromTz, wall) * 60000;
  utc = wall - tzOffsetMinutes(fromTz, utc) * 60000; // segunda pasada por cambios de horario
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: AR_TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  }).formatToParts(new Date(utc)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

// Lee countryId/regionId de cualquier respuesta de _next/data de Promiedos.
function timezoneFromNextData(json) {
  return sourceTimezone(json?.countryId, json?.regionId);
}

module.exports = { toArgentina, sourceTimezone, timezoneFromNextData, AR_TZ };
