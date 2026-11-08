// Exploración (temporal): ¿la API devuelve temporadas anteriores cambiando el número de temporada?
const fetch = global.fetch || require('node-fetch');
const SITE = 'https://www.promiedos.com.ar';
const API = 'https://api.promiedos.com.ar';
const H = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', 'X-VER': '1.11.7.3' };
const getJ = async (u) => { const r = await fetch(u, { headers: H }); try { return { s: r.status, j: JSON.parse(await r.text()) }; } catch (e) { return { s: r.status, j: null }; } };
(async () => {
  const html = await (await fetch(`${SITE}/league/premier-league/h`, { headers: H })).text();
  const buildId = (html.match(/"buildId":"([^"]+)"/) || [])[1];
  for (const [slug, id] of [['premier-league', 'h'], ['laliga', 'bb'], ['serie-a', 'bh']]) {
    const p = await getJ(`${SITE}/_next/data/${buildId}/league/${slug}/${id}.json`);
    const f = (p.j?.pageProps?.data?.games?.filters || []).filter((x) => /^\d+_\d+_\d+_\d+$/.test(x.key || ''));
    console.log('LIGA', id, p.s, 'claves', f.length, f[0]?.key, '..', f[f.length - 1]?.key);
    if (!f.length) continue;
    const [a, temp, etapa] = f[0].key.split('_').map(Number);
    for (let t = temp; t >= temp - 3; t--) {
      for (const ronda of [1, 38]) {
        const k = `${a}_${t}_${etapa}_${ronda}`;
        const r = await getJ(`${API}/league/games/${id}/${k}`);
        const g = r.j?.games || [];
        console.log(' ', k, r.s, g.length, 'partidos', g[0] ? `${g[0].start_time} ${g[0].teams?.[0]?.name}-${g[0].teams?.[1]?.name} ${g[0].status?.short_name} ${g[0].stage_round_name}` : '');
      }
    }
  }
})();
