// POST /api/search  { "query": "hatsune miku" }
const { call, fromPublic } = require('./_musicapi');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'use POST' });
  try {
    const query = String((req.body && req.body.query) || '').trim().slice(0, 200);
    if (!query) return res.status(400).json({ error: 'query obrigatória' });

    // serviços consultados; troque na Vercel com MUSICAPI_SOURCES=deezer,spotify,...
    const sources = (process.env.MUSICAPI_SOURCES || 'deezer,spotify,appleMusic,YouTube')
      .split(',').map(s => s.trim()).filter(Boolean);

    const data = await call('/public/search', { type: 'track', track: query, sources });
    const results = (data.tracks || [])
      .filter(t => t.status === 'success' && t.data)
      .map(t => fromPublic(t.source, t.data));

    res.status(200).json({ results });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message, detail: e.detail || null });
  }
};
