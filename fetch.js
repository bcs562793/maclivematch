const fetch  = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY,
);

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
];

function getMacDate(date) {
  const d = date || new Date();
  // TR saatine çevir (UTC+3)
  const tr = new Date(d.getTime() + 3 * 60 * 60 * 1000);
  const day   = String(tr.getUTCDate()).padStart(2, '0');
  const month = String(tr.getUTCMonth() + 1).padStart(2, '0');
  const year  = tr.getUTCFullYear();
  return `${day}/${month}/${year}`;
}

function getUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

async function fetchMackolikDate(macDate) {
  const url = `https://vd.mackolik.com/livedata?date=${encodeURIComponent(macDate)}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent':      getUA(),
      'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept-Encoding': 'gzip, deflate',
      'Connection':      'keep-alive',
      'Cache-Control':   'no-cache',
      'Referer':         'https://arsiv.mackolik.com/Canli-Sonuclar',
    },
    timeout: 15000,
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} — ${macDate}`);
  }

  const data = await res.json();
  const raw  = data.m || [];
  console.log(`   📦 ${macDate}: ${raw.length} toplam satır`);

  const matches = [];
  for (const m of raw) {
    if (!Array.isArray(m) || m.length < 37) continue;
    const li        = Array.isArray(m[36]) ? m[36] : [];
    const sportType = parseInt(li[11] ?? '1') || 1;
    if (sportType !== 1) continue; // Sadece futbol

    const matchId = parseInt(m[0]) || 0;
    if (matchId === 0) continue;

    matches.push({
      mackolikId:      matchId,
      homeTeam:        String(m[2] ?? '').trim(),
      awayTeam:        String(m[4] ?? '').trim(),
      homeTeamMacId:   parseInt(m[1]) || 0,
      awayTeamMacId:   parseInt(m[3]) || 0,
      statusCode:      parseInt(m[5]) || 0,
      leagueId:        parseInt(li[2] ?? '0') || 0,
      leagueName:      String(li[3] ?? ''),
    });
  }

  console.log(`   ✅ ${macDate}: ${matches.length} futbol maçı`);
  return matches;
}

async function main() {
  console.log('═══════════════════════════════════════');
  console.log('  📡 Mackolik Cache Fetcher');
  console.log(`  🕐 ${new Date().toISOString()}`);
  console.log('═══════════════════════════════════════');

  const now       = new Date();
  const trNow     = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  const trHour    = trNow.getUTCHours();
  const todayDate = getMacDate(now);
  const allMatches = [];

  // Gece 00:00–06:00 arası dünü de çek
  if (trHour < 6) {
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const yDate     = getMacDate(yesterday);
    console.log(`🌙 Gece modu: dün (${yDate}) + bugün (${todayDate})`);
    try {
      const yMatches = await fetchMackolikDate(yDate);
      allMatches.push(...yMatches);
    } catch (e) {
      console.error(`   ⚠️ Dün fetch hatası: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 1000));
  } else {
    console.log(`☀️ Bugün (${todayDate})`);
  }

  try {
    const todayMatches = await fetchMackolikDate(todayDate);
    allMatches.push(...todayMatches);
  } catch (e) {
    console.error(`   ⚠️ Bugün fetch hatası: ${e.message}`);
    process.exit(1);
  }

  // Tekrar eden mackolikId'leri temizle
  const unique = [...new Map(allMatches.map(m => [m.mackolikId, m])).values()];
  console.log(`\n📊 Toplam: ${unique.length} tekil maç`);

  // Supabase'e kaydet
  const { error } = await sb
    .from('mackolik_cache')
    .upsert({
      id:         1,
      data:       unique,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' });

  if (error) {
    console.error('❌ Supabase kayıt hatası:', error.message);
    process.exit(1);
  }

  console.log(`✅ Supabase güncellendi: ${unique.length} maç`);
  console.log('═══════════════════════════════════════');
}

main().catch(e => {
  console.error('❌ Fatal:', e);
  process.exit(1);
});
