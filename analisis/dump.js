// Temporal: diagnostico de zona horaria de Promiedos.
const fs = require('fs');
const SITE = 'https://www.promiedos.com.ar';
const API = 'https://api.promiedos.com.ar';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const out = [];
const log = (...a) => { const s = a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '); console.log(s); out.push(s); };
async function apiTime(headers, qs = '') {
  const r = await fetch(`${API}/league/games/hc/latest${qs}`, { headers: { 'User-Agent': UA, 'X-VER': '1.11.7.3', ...headers } });
  const d = await r.json();
  const g = (d.games || []).find(x => /aldosivi/.test(x.url_name) && /belgrano/.test(x.url_name));
  return g ? g.start_time : `no encontrado (status ${r.status})`;
}
(async () => {
  log('Runner TZ:', Intl.DateTimeFormat().resolvedOptions().timeZone, 'UTC now:', new Date().toISOString());
  const html = await (await fetch(`${SITE}/league/liga-profesional/hc`, { headers: { 'User-Agent': UA } })).text();
  const buildId = html.match(/"buildId":"([^"]+)"/)[1];
  for (let i = 0; i < 3; i++) {
    const p = await (await fetch(`${SITE}/_next/data/${buildId}/league/liga-profesional/hc.json`, { headers: { 'User-Agent': UA } })).json();
    const g = JSON.stringify(p).match(/"url_name":"aldosivi-vs-belgrano[^"]*"[^}]*?"start_time":"([^"]+)"/);
    log('pagina liga', i, p.countryId, p.regionId, 'Aldosivi-Belgrano:', g ? g[1] : '?');
  }
  log('API sin headers extra:', await apiTime({}));
  const tries = [
    [{ 'X-TZ': 'America/Argentina/Buenos_Aires' }],
    [{ 'X-Timezone': 'America/Argentina/Buenos_Aires' }],
    [{ 'Timezone': 'America/Argentina/Buenos_Aires' }],
    [{ 'TZ': 'America/Argentina/Buenos_Aires' }],
    [{ 'X-UTC-Offset': '-180' }],
    [{ 'X-Offset': '-180' }],
    [{ 'X-Country': 'AR' }],
    [{ 'CF-IPCountry': 'AR' }],
    [{ 'X-Forwarded-For': '181.46.0.1' }],
    [{ 'X-Real-IP': '181.46.0.1' }],
    [{}, '?tz=America/Argentina/Buenos_Aires'],
    [{}, '?timezone=America/Argentina/Buenos_Aires'],
    [{}, '?utc_offset=-180'],
    [{}, '?offset=-3'],
    [{ 'Accept-Language': 'es-AR' }]
  ];
  for (const [h, qs] of tries) log('API', JSON.stringify(h), qs || '', '->', await apiTime(h, qs));
  fs.writeFileSync('analisis/tz_log.txt', out.join('\n'));
})().catch(e => { console.error(e); fs.writeFileSync('analisis/tz_log.txt', out.join('\n') + '\nERROR ' + e.message); });
