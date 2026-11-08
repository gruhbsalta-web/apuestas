// Exploración (temporal): qué ofrece Promiedos para temporadas anteriores de una liga.
const fetch = global.fetch || require('node-fetch');
const SITE = 'https://www.promiedos.com.ar';
const API = 'https://api.promiedos.com.ar';
const H = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', 'X-VER': '1.11.7.3' };
const get = async (u) => { const r = await fetch(u, { headers: H }); const t = await r.text(); return { status: r.status, t }; };
const resumen = (o, prof = 0, max = 3) => {
  if (o === null || typeof o !== 'object') return JSON.stringify(o)?.slice(0, 80);
  if (Array.isArray(o)) return `[${o.length}] ` + (o.length ? resumen(o[0], prof + 1, max) : '');
  if (prof >= max) return '{' + Object.keys(o).join(',') + '}';
  return '{' + Object.entries(o).map(([k, v]) => `${k}: ${resumen(v, prof + 1, max)}`).join(', ') + '}';
};
(async () => {
  const html = (await get(`${SITE}/league/premier-league/h`)).t;
  const buildId = (html.match(/"buildId":"([^"]+)"/) || [])[1];
  console.log('buildId', buildId);
  for (const [slug, id] of [['premier-league', 'h'], ['laliga', 'bb']]) {
    const p = await get(`${SITE}/_next/data/${buildId}/league/${slug}/${id}.json`);
    console.log('PAGINA', id, p.status);
    try {
      const j = JSON.parse(p.t);
      const d = j.pageProps?.data || {};
      console.log('data keys:', Object.keys(d));
      console.log('league:', resumen(d.league, 0, 2));
      for (const k of Object.keys(d)) if (/season|temporada|edition|year/i.test(k + JSON.stringify(d[k]).slice(0, 2000))) console.log('POSIBLE', k, JSON.stringify(d[k]).slice(0, 1500));
      console.log('filters:', JSON.stringify(d.games?.filters || []).slice(0, 1500));
      const s = JSON.stringify(j); const ms = s.match(/.{0,120}(season|temporada|2025)[^"]{0,40}.{0,120}/gi) || [];
      console.log('menciones:', ms.slice(0, 15).join('\n   '));
    } catch (e) { console.log('no json', p.t.slice(0, 300)); }
  }
  for (const u of [`${API}/league/seasons/h`, `${API}/league/h/seasons`, `${API}/league/games/h/latest`, `${API}/league/tables_and_fixtures/h`, `${API}/league/h`]) {
    const r = await get(u); console.log('API', u, r.status, r.t.slice(0, 600).replace(/\s+/g, ' '));
  }
})();
