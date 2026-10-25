// Temporal: descubre como pedir el fixture completo por fecha de cada liga.
const fs = require('fs');
const SITE = 'https://www.promiedos.com.ar';
const API = 'https://api.promiedos.com.ar';
const H = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', 'X-VER': '1.11.7.3' };
async function get(url) { const r = await fetch(url, { headers: H }); const t = await r.text(); console.log(r.status, url, t.length); return t; }
(async () => {
  const html = await get(SITE + '/league/primera-nacional/ebj');
  const buildId = html.match(/"buildId":"([^"]+)"/)[1];
  for (const [slug, id] of [['primera-nacional', 'ebj'], ['liga-profesional', 'hc']]) {
    fs.writeFileSync(`analisis/league_${id}.json`, await get(`${SITE}/_next/data/${buildId}/league/${slug}/${id}.json`));
    fs.writeFileSync(`analisis/api_latest_${id}.json`, await get(`${API}/league/games/${id}/latest`));
  }
  // Busca claves de fecha/filtro en el JSON de la liga y prueba pedirlas a la API
  const lg = JSON.parse(fs.readFileSync('analisis/league_ebj.json', 'utf8'));
  const keys = new Set();
  JSON.stringify(lg, (k, v) => { if ((k === 'key' || k === 'filter_key' || k === 'stage_round_key') && typeof v === 'string') keys.add(v); return v; });
  const apiLatest = JSON.parse(fs.readFileSync('analisis/api_latest_ebj.json', 'utf8'));
  JSON.stringify(apiLatest, (k, v) => { if ((k === 'key' || k === 'filter_key') && typeof v === 'string') keys.add(v); return v; });
  const sample = [...keys].slice(0, 6);
  console.log('claves encontradas:', [...keys].length, sample);
  const probes = {};
  for (const k of sample) {
    const t = await get(`${API}/league/games/ebj/${encodeURIComponent(k)}`);
    probes[k] = t.slice(0, 3000);
    await new Promise(s => setTimeout(s, 300));
  }
  fs.writeFileSync('analisis/probes_ebj.json', JSON.stringify({ keys: [...keys], probes }, null, 1));
})().catch(e => { console.error(e); process.exit(1); });
