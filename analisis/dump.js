// Temporal: tipos de evento de gol. Compara el marcador de cada partido con los eventos.
const fs = require('fs');
const SITE = 'https://www.promiedos.com.ar';
const H = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const html = await (await fetch(`${SITE}/league/primera-nacional/ebj`, { headers: H })).text();
  const buildId = html.match(/"buildId":"([^"]+)"/)[1];
  const pl = JSON.parse(fs.readFileSync('data/players.json', 'utf8'));
  const tipos = {}; const ejemplos = {}; const descuadres = []; const gyt = [];
  for (const [gid, p] of Object.entries(pl.partidos)) {
    let g;
    try { g = (await (await fetch(`${SITE}/_next/data/${buildId}/game/x/${gid}.json`, { headers: H })).json())?.pageProps?.initialData?.game; } catch (e) { continue; }
    if (!g) continue;
    const evs = [];
    (g.events || []).forEach((st) => { if (st.is_penalties_stage) return; (st.rows || []).forEach((r) => (r.events || []).forEach((e) => evs.push(e))); });
    evs.forEach((e) => { tipos[e.type] = (tipos[e.type] || 0) + 1; (ejemplos[e.type] = ejemplos[e.type] || []).length < 4 && ejemplos[e.type].push(e); });
    const goles1 = [0, 0]; evs.filter((e) => e.type === 1).forEach((e) => goles1[e.team - 1]++);
    const sc = (g.scores || []).map(Number);
    if (goles1[0] !== sc[0] || goles1[1] !== sc[1]) descuadres.push({ partido: `${p.local} vs ${p.visitante}`, fecha: p.fecha, marcador: sc, eventosGol1: goles1, otros: evs.filter((e) => ![1, 4, 5, 7, 9, 15].includes(e.type)), teamGoals: (g.teams || []).map((t) => t.goals) });
    if ([p.local, p.visitante].includes('Gimnasia y Tiro')) evs.filter((e) => /gordillo/i.test(JSON.stringify(e.texts))).forEach((e) => gyt.push({ fecha: p.fecha, partido: `${p.local} vs ${p.visitante}`, e }));
    await sleep(250);
  }
  fs.writeFileSync('analisis/auditoria.json', JSON.stringify({ tipos, ejemplos, descuadres, gordillo: gyt }, null, 1));
  console.log(JSON.stringify({ tipos, descuadres: descuadres.length }));
})().catch((e) => { console.error(e); process.exit(1); });
