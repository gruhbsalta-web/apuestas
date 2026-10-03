const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const LEAGUE_URL = process.argv[2] || 'https://www.promiedos.com.ar/league/primera-nacional/ebj';
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'matches.json');

function emptyStats(){
  return {
    goles:{l:0,v:0}, tarjetas:{l:0,v:0}, corners:{l:0,v:0},
    tirosArco:{l:0,v:0}, atajadas:{l:0,v:0}
  };
}

function normalizeTeam(team){
  return team.replace(/\s+/g, ' ').trim();
}

function parseMatchText(text){
  const cleaned = text.replace(/\s+/g, ' ').trim();
  let parts = cleaned.split(' - ');
  if(parts.length === 1) parts = cleaned.split(' vs ');
  if(parts.length === 1) parts = cleaned.split(' – ');
  if(parts.length === 1) parts = cleaned.split(' — ');
  if(parts.length !== 2) return null;
  const local = normalizeTeam(parts[0]);
  const visitante = normalizeTeam(parts[1]);
  if(!local || !visitante) return null;
  return { local, visitante };
}

(async ()=>{
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });

  console.log('Navigating to', LEAGUE_URL);
  await page.goto(LEAGUE_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(4000);

  const anchors = await page.$$eval('a[href*="/game/"]', els =>
    els.map(el => ({
      text: el.textContent || '',
      html: el.innerHTML || '',
      nearest: (el.closest('div, article, section')?.textContent || '').replace(/\s+/g,' ').trim()
    }))
  );
  console.log('Found game anchors:', anchors.length);

  const matches = [];
  const seen = new Set();
  anchors.forEach(item => {
    let text = item.text.replace(/\s+/g,' ').trim();
    if(!text) text = item.nearest;
    const parsed = parseMatchText(text);
    if(!parsed) return;
    const key = `${parsed.local.toLowerCase()}|${parsed.visitante.toLowerCase()}`;
    if(seen.has(key)) return;
    seen.add(key);
    const timeMatch = item.nearest.match(/(\d{1,2}:\d{2})/);
    const dateMatch = item.nearest.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})/);
    const fechaHora = dateMatch && timeMatch ? `${dateMatch[0]} ${timeMatch[1]}` : null;
    matches.push({
      id: 'auto_' + Buffer.from(key).toString('base64').slice(0,12),
      local: parsed.local,
      visitante: parsed.visitante,
      fechaHora,
      finPrimerTiempo:false,
      finPartido:false,
      stats: emptyStats()
    });
  });

  if(matches.length === 0){
    console.log('No direct matches found; trying fallback schedule scan.');
    const allText = await page.textContent('body');
    const lines = allText.split(/\n/).map(l => l.replace(/\s+/g,' ').trim()).filter(Boolean);
    for(let i = 0; i < lines.length - 1; i++){
      const timeMatch = lines[i].match(/^(\d{1,2}:\d{2})$/);
      if(!timeMatch) continue;
      const parsed = parseMatchText(lines[i+1]);
      if(!parsed) continue;
      const key = `${parsed.local.toLowerCase()}|${parsed.visitante.toLowerCase()}`;
      if(seen.has(key)) continue;
      seen.add(key);
      matches.push({
        id: 'auto_' + Buffer.from(key).toString('base64').slice(0,12),
        local: parsed.local,
        visitante: parsed.visitante,
        fechaHora: null,
        finPrimerTiempo:false,
        finPartido:false,
        stats: emptyStats()
      });
    }
  }

  await browser.close();

  const out = { matches, bets: [], capitalInicial: 0 };
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(out, null, 2), 'utf8');
  console.log(`Wrote ${OUTPUT_PATH} with ${matches.length} matches.`);
  if(matches.length > 0){
    matches.forEach(m => console.log(`${m.local} vs ${m.visitante} ${m.fechaHora || ''}`));
  }
})();
