// Ajuda compartilhada pelas funções da Vercel. O arquivo começa com "_" para não virar uma rota.
const BASE = 'https://api.musicapi.com';

function authHeader() {
  const id = process.env.MUSICAPI_CLIENT_ID;
  const secret = process.env.MUSICAPI_CLIENT_SECRET;
  if (!id || !secret) throw new Error('MUSICAPI_CLIENT_ID e MUSICAPI_CLIENT_SECRET não configurados na Vercel');
  return 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64');
}

async function call(path, body) {
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: authHeader() },
    body: JSON.stringify(body)
  });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!r.ok) { const e = new Error('MusicAPI respondeu ' + r.status); e.status = r.status; e.detail = json; throw e; }
  return json;
}

const isYT = s => /^youtube/i.test(s);
const ID11 = /^[\w-]{11}$/;

// formato único que o site entende
function fromPublic(source, d) {
  let videoId = null;
  if (isYT(source)) {
    try { videoId = new URL(d.url).searchParams.get('v'); } catch {}
    if (!videoId && ID11.test(d.externalId || '')) videoId = d.externalId;
  }
  return {
    videoId,
    id: `${source}:${d.externalId}`,
    name: d.name,
    artist: (d.artistNames || []).join(', ') || 'Artista desconhecido',
    album: d.albumName || '',
    imageUrl: d.imageUrl || null,
    previewUrl: d.previewUrl || null,
    url: d.url || null,
    source
  };
}
function fromTrack(source, t) {
  const videoId = isYT(source) && ID11.test(t.id || '') ? t.id : null;
  return {
    videoId,
    id: `${source}:${t.id}`,
    name: t.name,
    artist: (t.artists || []).map(a => a.name).join(', ') || 'Artista desconhecido',
    album: t.album ? t.album.name : '',
    imageUrl: t.imageUrl || null,
    previewUrl: t.previewUrl || null,
    url: null,
    source
  };
}

module.exports = { call, fromPublic, fromTrack };
