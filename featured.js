// GET /api/featured  -> faixas de uma playlist pública para a tela inicial
const { call, fromTrack } = require('./_musicapi');

module.exports = async (req, res) => {
  try {
    const serviceId = process.env.FEATURED_SERVICE || 'spotify';
    const playlistId = process.env.FEATURED_PLAYLIST_ID || '37i9dQZF1DXcBWIGoYBM5M';
    const data = await call('/public/inspect/playlistItems', { playlistId, serviceId });
    const items = (data.data && data.data.results) || [];
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
    res.status(200).json({ results: items.slice(0, 24).map(t => fromTrack(serviceId, t)) });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message, detail: e.detail || null });
  }
};
