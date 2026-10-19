// GET /api/image?url=...  -> transmite a imagem da capa pelo MESMO domínio.
// Dentro das Atividades do Discord as imagens de CDNs externos são bloqueadas
// pela CSP; servindo-as pela própria origem elas passam pelo proxy do Discord.
const ALLOWED_HOSTS = [
  'dzcdn.net',
  'scdn.co',
  'mzstatic.com',
  'ytimg.com',
  'akamaized.net',
  'sndcdn.com',
  'fbcdn.net'
];
const MAX_BYTES = 3 * 1024 * 1024; // 3 MB
const TIMEOUT_MS = parseInt(process.env.PROXY_TIMEOUT_MS || '10000', 10);

function hostAllowed(hostname) {
  return ALLOWED_HOSTS.some(base => hostname === base || hostname.endsWith('.' + base));
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'use GET' });
  const ctrl = new AbortController();
  // o tempo começa ANTES do pedido: cabeçalhos ou corpo presos não deixam o pedido pendurado
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const raw = String(req.query.url || '');
    let u; try { u = new URL(raw); } catch { return res.status(400).json({ error: 'url inválida' }); }
    if (u.protocol !== 'https:') return res.status(400).json({ error: 'use https' });
    if (!hostAllowed(u.hostname)) return res.status(403).json({ error: 'domínio não permitido' });

    // redirect:'manual' — redirecionamentos não são seguidos, para não contornar a lista de domínios
    let r = await fetch(u.toString(), {
      redirect: 'manual',
      headers: { 'user-agent': 'Mozilla/5.0 (MikuMusic)', accept: 'image/*' },
      signal: ctrl.signal
    });
    if (r.status >= 300 && r.status < 400) return res.status(403).json({ error: 'redirecionamento não permitido' });
    if (!r.ok) return res.status(502).json({ error: 'origem respondeu ' + r.status });

    const type = (r.headers.get('content-type') || 'image/jpeg').split(';')[0];
    if (!/^image\//.test(type)) return res.status(415).json({ error: 'conteúdo não é imagem' });
    const len = parseInt(r.headers.get('content-length') || '0', 10);
    if (len > MAX_BYTES) return res.status(413).json({ error: 'ficheiro demasiado grande' });

    // ler o corpo em fluxo: limite de tamanho aplicado DURANTE a leitura (tempo já ativo)
    let buf;
    if (r.body && typeof r.body.getReader === 'function') {
      const reader = r.body.getReader();
      const chunks = []; let total = 0; let over = false;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > MAX_BYTES) { over = true; break; }
          chunks.push(Buffer.from(value));
        }
      } catch (e) {
        return res.status(e.name === 'AbortError' ? 504 : 502).json({ error: 'leitura interrompida' });
      }
      if (over) { try { reader.cancel(); } catch (e) {} return res.status(413).json({ error: 'ficheiro demasiado grande' }); }
      buf = Buffer.concat(chunks);
    } else {
      buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > MAX_BYTES) return res.status(413).json({ error: 'ficheiro demasiado grande' });
    }

    res.setHeader('Content-Type', type);
    res.setHeader('Content-Length', buf.length);
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
    res.status(200).send(buf);
  } catch (e) {
    res.status(e.name === 'AbortError' ? 504 : 500).json({ error: e.message });
  } finally {
    clearTimeout(timer);
    ctrl.abort(); // garante que nenhum pedido fica pendente
  }
};
