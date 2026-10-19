// POST /api/ytaudio { videoId }
// Extrai a faixa de áudio COMPLETA de um vídeo do YouTube (só áudio, sem vídeo).
// Dentro da Atividade do Discord o player do YouTube não pode ser embutido (CSP),
// então o site toca o áudio completo através de /api/ytstream.
const YTDL_PATH = process.env.YTDL_MODULE || '@distube/ytdl-core';

let ytdlCache = null;
function getYtdl() {
  if (ytdlCache !== null) return ytdlCache;
  try { ytdlCache = require(YTDL_PATH); } catch { ytdlCache = false; }
  return ytdlCache;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'use POST' });
  const ytdl = getYtdl();
  if (!ytdl) return res.status(503).json({ error: 'extrator de áudio indisponível — instala a dependência @distube/ytdl-core (npm install) antes do deploy' });
  try {
    const videoId = String((req.body && req.body.videoId) || '').trim();
    if (!/^[\w-]{11}$/.test(videoId)) return res.status(400).json({ error: 'videoId inválido' });

    const info = await ytdl.getInfo(videoId);
    const formats = (info.formats || []).filter(f => f.mimeType && /^audio\//.test(f.mimeType) && f.url);
    if (!formats.length) return res.status(404).json({ error: 'este vídeo não tem formato só de áudio' });

    // prefere AAC/mp4 (compatibilidade máxima, inclusive no webview do Discord), depois a melhor qualidade
    const bitrate = f => f.bitrate || f.audioBitrate || 0;
    const mp4 = formats.filter(f => f.mimeType.startsWith('audio/mp4')).sort((a, b) => bitrate(b) - bitrate(a));
    const best = mp4[0] || formats.sort((a, b) => bitrate(b) - bitrate(a))[0];

    res.status(200).json({
      url: best.url,
      duration: Number(info.videoDetails && info.videoDetails.lengthSeconds) || null,
      title: (info.videoDetails && info.videoDetails.title) || null
    });
  } catch (e) {
    res.status(502).json({ error: 'não consegui extrair o áudio deste vídeo (o YouTube pode estar a bloquear este vídeo — vai tocar a prévia de 30s se existir)', detail: String(e.message || e).slice(0, 200) });
  }
};
