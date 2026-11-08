// Exploración (temporal): qué trae una ficha de Promiedos por tiempo/minuto.
const fetch = global.fetch || require('node-fetch');
const SITE = 'https://www.promiedos.com.ar';
const H = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', 'X-VER': '1.11.7.3' };
const fs = require('fs');
(async () => {
  const html = await (await fetch(`${SITE}/league/premier-league/h`, { headers: H })).text();
  const buildId = (html.match(/"buildId":"([^"]+)"/) || [])[1];
  const m = JSON.parse(fs.readFileSync('data/matches.json', 'utf8')).matches;
  const pick = (liga) => m.filter((x) => x.finPartido && x.source.leagueId === liga).slice(-1)[0];
  for (const x of [pick('h'), pick('hc')]) {
    const id = x.id.replace('promiedos_', '');
    const d = await (await fetch(`${SITE}/_next/data/${buildId}/game/${x.source.gameUrlName}/${id}.json`, { headers: H })).json();
    const g = d.pageProps.initialData.game;
    console.log('=====', x.local, '-', x.visitante, 'claves:', Object.keys(g).join(','));
    console.log('STATISTICS:', JSON.stringify(g.statistics).slice(0, 3000));
    const tipos = {};
    (g.events || []).forEach((st) => (st.rows || []).forEach((r) => (r.events || []).forEach((e) => { tipos[e.type] = tipos[e.type] || []; if (tipos[e.type].length < 2) tipos[e.type].push(e); })));
    console.log('EVENT TYPES:', JSON.stringify(tipos).slice(0, 3000));
    for (const k of Object.keys(g)) if (/stat|period|half|timeline|moment|play|incident|pressure|momentum/i.test(k)) console.log('CLAVE', k, JSON.stringify(g[k]).slice(0, 1200));
  }
})();
