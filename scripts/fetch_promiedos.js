const fetch = require('node-fetch');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const LEAGUE_URL = process.argv[2] || 'https://www.promiedos.com.ar/league/primera-nacional/ebj';

function emptyStats(){
  return {
    goles:{l:0,v:0}, tarjetas:{l:0,v:0}, corners:{l:0,v:0},
    tirosArco:{l:0,v:0}, atajadas:{l:0,v:0}
  };
}

(async ()=>{
  try{
    console.log('Fetching', LEAGUE_URL);
    const res = await fetch(LEAGUE_URL, {headers:{'User-Agent':'Mozilla/5.0'}});
    if(!res.ok) throw new Error('Fetch failed '+res.status);
    const html = await res.text();
    const $ = cheerio.load(html);

    const found = [];
    const anchors = $('a[href*="/game/"]');
    console.log('anchors with /game/ found:', anchors.length);
    anchors.each((i, el)=>{
      const text = $(el).text().replace(/\s+/g,' ').trim();
      if(!text) return;
      // try split by ' - ' or ' vs '
      let parts = text.split(' - ');
      if(parts.length === 1) parts = text.split(' vs ');
      if(parts.length === 1) return;
      const local = parts[0].trim();
      const visitante = parts[1].trim();
      // look for a nearby time like 15:00
      let time = null;
      const parentText = $(el).closest('div,li,section').text();
      const timeMatch = parentText.match(/(\d{1,2}:\d{2})/);
      if(timeMatch) time = timeMatch[1];
      found.push({local, visitante, time});
    });

    // If anchor parsing found nothing, try a looser regex scan for lines like "TeamName 15:00"
    if(found.length === 0){
      console.log('No anchors parsed; falling back to regex scan');
      const lines = html.split(/\n/).map(l=>l.replace(/<[^>]+>/g,'').trim()).filter(Boolean);
      const timeRe = /(\d{1,2}:\d{2})/;
      for(let i=0;i<lines.length-1;i++){
        const l = lines[i];
        const m = lines[i+1];
        if(timeRe.test(l) && /[A-Za-z]/.test(m)){
          // e.g. '15:00' then 'Almagro - Gimnasia y Tiro'
          const tm = l.match(timeRe)[1];
          const teams = m.split(/ - | vs |–/);
          if(teams.length===2){ found.push({local:teams[0].trim(), visitante:teams[1].trim(), time:tm}); }
        }
      }
    }

    // deduplicate by pair
    const uniq = {};
    found.forEach(f=>{
      const key = f.local.toLowerCase() + '|' + f.visitante.toLowerCase();
      if(!uniq[key]) uniq[key] = f;
    });
    const pairs = Object.values(uniq);

    const matches = pairs.map((p, idx)=>({
      id: 'auto_'+Date.now().toString(36)+'_'+idx,
      local: p.local,
      visitante: p.visitante,
      fechaHora: null, // time detection is heuristic; keep null for manual review
      finPrimerTiempo:false,
      finPartido:false,
      stats: emptyStats()
    }));

    const out = { matches, bets: [], capitalInicial: 0 };
    const outPath = path.join(__dirname, '..', 'data', 'matches.json');
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
    console.log('Wrote', outPath, 'with', matches.length, 'matches');
  }catch(err){
    console.error(err);
    process.exit(1);
  }
})();
