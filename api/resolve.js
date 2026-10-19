// POST /api/resolve { name, artist }
// Procura uma versão tocável para faixas sem fonte: um vídeo do YouTube Music
// (faixa completa) ou uma prévia de 30s (Deezer/Spotify/Apple). Dentro da
// Atividade do Discord o site toca o áudio completo quando há videoId.
//
// Títulos vindos do YouTube são frequentemente "Artista - Música (Clipe
// Oficial)" — a busca com o título completo nem sempre encontra a faixa nas
// outras plataformas. Por isso tentamos várias variantes da consulta.
const { call, fromPublic } = require('./_musicapi');

// mantém letras/números de qualquer idioma (incl. japonês); remove pontuação
const norm = s => String(s || '')
  .toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .replace(/\s+/g, ' ').trim();

// variantes da consulta: título limpo, título dividido em "Artista - Música"
function queryVariants(name, artist) {
  const clean = s => String(s || '')
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')   // remove "(Clipe Oficial)" etc.
    .replace(/\s+/g, ' ').trim();
  const cleaned = clean(name) || name;
  const variants = [{ name: cleaned, artist }];
  const m = /^(.*?)\s*[-–:]\s*(.+)$/.exec(cleaned);
  if (m && m[1] && m[2]) {
    // "Artista - Música" -> tenta também "Música" com o artista do título
    variants.push({ name: m[2], artist: artist || m[1] });
    if (artist) variants.push({ name: m[2], artist: `${artist} ${m[1]}` });
  }
  const seen = new Set();
  return variants.filter(v => {
    if (!v.name) return false;
    const k = `${norm(v.name)}|${norm(v.artist)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// uma ronda de busca + correspondência para uma variante
async function findMatches(variant) {
  const wantedName = norm(variant.name);
  const wantedArtist = norm(variant.artist);
  if (!wantedName) return [];
  const query = variant.artist ? `${variant.name} ${variant.artist}` : variant.name;
  const data = await call('/public/search', {
    type: 'track',
    track: query,
    sources: ['youtubeMusic', 'deezer', 'spotify', 'appleMusic']
  });
  const matches = [];
  for (const h of (data.tracks || [])
    .filter(t => t.status === 'success' && t.data)
    .map(t => fromPublic(t.source, t.data))) {
    if (!(h.previewUrl || h.videoId)) continue; // precisa de ser tocável: prévia ou vídeo
    const hn = norm(h.name), ha = norm(h.artist);
    if (!hn) continue;
    const nameMatch = hn === wantedName || hn.includes(wantedName) || wantedName.includes(hn);
    if (!nameMatch) continue;
    // se foi dado um artista, a gravação tem de corresponder também
    if (wantedArtist) {
      if (!ha) continue;
      if (!(ha.includes(wantedArtist) || wantedArtist.includes(ha))) continue;
    }
    matches.push({ hit: h, exact: hn === wantedName });
  }
  return matches;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'use POST' });
  try {
    const name = String((req.body && req.body.name) || '').trim().slice(0, 200);
    const artist = String((req.body && req.body.artist) || '').trim().slice(0, 200);
    if (!name) return res.status(400).json({ error: 'name obrigatório' });

    // percorre TODAS as variantes e junta os resultados: a 1.ª pode devolver
    // só o próprio vídeo do YouTube; as outras encontram versões alternativas
    const all = [];
    const seen = new Set();
    for (const variant of queryVariants(name, artist)) {
      let matches = [];
      try { matches = await findMatches(variant); } catch (e) { continue; }
      for (const m of matches) {
        const key = `${norm(m.hit.name)}|${norm(m.hit.artist)}|${m.hit.previewUrl || m.hit.videoId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        all.push(m);
      }
    }

    // prefere a gravação com título exato; só usa correspondência parcial se não houver
    all.sort((a, b) => (b.exact ? 1 : 0) - (a.exact ? 1 : 0));
    if (!all.length) return res.status(404).json({ error: 'sem versão tocável' });
    const hit = all[0].hit;
    res.status(200).json({
      videoId: hit.videoId || null,
      name: hit.name,
      artist: hit.artist,
      previewUrl: hit.previewUrl,
      imageUrl: hit.imageUrl,
      // várias versões: o site tenta a primeira que tocar (completa primeiro, prévia depois)
      candidates: all.slice(0, 5).map(m => ({
        videoId: m.hit.videoId || null,
        name: m.hit.name,
        artist: m.hit.artist,
        previewUrl: m.hit.previewUrl,
        imageUrl: m.hit.imageUrl
      }))
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message, detail: e.detail || null });
  }
};
