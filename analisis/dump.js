// Temporal: auditoria de eventos (goles, asistencias, tarjetas) que no se asignan a ningun jugador.
const fs = require('fs');
const { normName } = require('../scripts/players_lib');
const SITE = 'https://www.promiedos.com.ar';
const H = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const html = await (await fetch(`${SITE}/league/primera-nacional/ebj`, { headers: H })).text();
  const buildId = html.match(/"buildId":"([^"]+)"/)[1];
  const pl = JSON.parse(fs.readFileSync('data/players.json', 'utf8'));
  const out = { sinAsignar: [], resumen: {} };
  let n = 0;
  for (const [gid, p] of Object.entries(pl.partidos)) {
    const url = `${SITE}/_next/data/${buildId}/game/x/${gid}.json`;
    let g;
    try { g = (await (await fetch(url, { headers: H })).json())?.pageProps?.initialData?.game; } catch (e) { continue; }
    if (!g) continue;
    n++;
    const lus = g?.players?.lineups?.teams || [];
    lus.forEach((lu, idx) => {
      const teamNum = lu.team_num || idx + 1;
      const nombres = [...(lu.starting || []), ...(lu.bench || [])].map((x) => ({ n: x.name, c: x.player_short_name }));
      const evs = [];
      (g.events || []).forEach((st) => { if (st.is_penalties_stage) return; (st.rows || []).forEach((r) => (r.events || []).forEach((e) => evs.push(e))); });
      evs.filter((e) => e.team === teamNum && [1, 4, 7].includes(e.type)).forEach((e) => {
        const textos = e.type === 1 ? e.texts.slice(0, 2) : e.texts.slice(0, 1);
        textos.forEach((t, i) => {
          if (!t) return;
          const tn = normName(t);
          const ok = nombres.some((x) => normName(x.n) === tn || normName(x.c) === tn || normName(x.n).endsWith(' ' + tn) || tn.endsWith(' ' + normName(x.n)));
          if (!ok) out.sinAsignar.push({ partido: `${p.local} vs ${p.visitante}`, fecha: p.fecha, equipo: g.teams?.[teamNum - 1]?.name, tipo: e.type === 1 ? (i === 0 ? 'gol' : 'asistencia') : e.type === 4 ? 'amarilla' : 'roja', texto: t, evento: e, alineacion: nombres.map((x) => x.n) });
        });
      });
    });
    await sleep(250);
  }
  out.resumen = { partidos: n, sinAsignar: out.sinAsignar.length };
  fs.writeFileSync('analisis/auditoria.json', JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out.resumen));
})().catch((e) => { console.error(e); process.exit(1); });
