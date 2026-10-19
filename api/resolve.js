// POST /api/resolve { name, artist }
// Procura uma prévia tocável (Deezer/Spotify/Apple) para faixas que vêm do
// YouTube ou do modo demonstração — dentro da Atividade do Discord o site
// toca a prévia de áudio no lugar do player embutido.
const { call, fromPublic } = require('./_musicapi');

// mantém letras/números de qualquer idioma (incl. japonês); remove pontuação
const norm = s => String(s || '')
  .toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .replace(/\s+/g, ' ').trim();

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'use POST' });
  try {
    const name = String((req.body && req.body.name) || '').trim().slice(0, 200);
    const artist = String((req.body && req.body.artist) || '').trim().slice(0, 200);
    if (!name) return res.status(400).json({ error: 'name obrigatório' });

    const wantedName = norm(name);
    const wantedArtist = norm(artist);
    if (!wantedName) return res.status(404).json({ error: 'sem prévia equivalente' });

    const query = artist ? `${name} ${artist}` : name;
    const data = await call('/public/search', {
      type: 'track',
      track: query,
      sources: ['deezer', 'spotify', 'appleMusic']
    });

    const matches = [];
    for (const h of (data.tracks || [])
      .filter(t => t.status === 'success' && t.data && t.data.previewUrl)
      .map(t => fromPublic(t.source, t.data))) {
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

    // prefere a gravação com título exato; só usa correspondência parcial se não houver
    const best = matches.find(m => m.exact) || matches[0];
    if (!best) return res.status(404).json({ error: 'sem prévia equivalente' });
    const hit = best.hit;
    res.status(200).json({
      name: hit.name,
      artist: hit.artist,
      previewUrl: hit.previewUrl,
      imageUrl: hit.imageUrl
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message, detail: e.detail || null });
  }
};
