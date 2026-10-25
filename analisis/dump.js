// Temporal: baja el JSON crudo de algunos partidos para analizar su estructura.
const fs = require('fs');
const SITE = 'https://www.promiedos.com.ar';
const H = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' };
const PICK = [["rosario-central-vs-huracan", "egddcdc"], ["san-lorenzo-vs-newell's-old-boys", "egddcea"], ["ciudad-de-bolivar-vs-colon", "eifeigf"], ["colegiales-vs-atletico-rafaela", "eifeihf"], ["platense-vs-estudiantes-de-la-plata", "eichiab"], ["racing-club-vs-boca-juniors", "eiefbdg"]];
(async () => {
  const html = await (await fetch(SITE + '/league/primera-nacional/ebj', { headers: H })).text();
  const buildId = html.match(/"buildId":"([^"]+)"/)[1];
  for (const [slug, id] of PICK) {
    const url = SITE + '/_next/data/' + buildId + '/game/' + encodeURIComponent(slug) + '/' + id + '.json';
    const r = await fetch(url, { headers: H });
    const txt = await r.text();
    fs.writeFileSync('analisis/game_' + id + '.json', txt);
    console.log(r.status, id, txt.length);
    await new Promise(s => setTimeout(s, 400));
  }
  // y una pagina de equipo, para comparar
  const t = await fetch(SITE + '/_next/data/' + buildId + '/team/belgrano/fhid.json', { headers: H });
  fs.writeFileSync('analisis/team_belgrano.json', await t.text());
  console.log('team', t.status);
})().catch(e => { console.error(e); process.exit(1); });
