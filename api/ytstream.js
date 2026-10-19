// GET /api/ytstream?u=... -> transmite o áudio COMPLETO do YouTube pelo MESMO domínio.
// Dentro da Atividade do Discord o CSP bloqueia o googlevideo.com; este proxy serve
// o áudio pela própria origem (que passa pelo proxy do Discord), com suporte a
// Range para procurar dentro da faixa. Cada resposta é limitada a um bloco
// (4 MB) — o navegador pede os blocos seguintes à medida que toca.
const CHUNK = 4 * 1024 * 1024; // 4 MB por resposta
const TIMEOUT_MS = parseInt(process.env.PROXY_TIMEOUT_MS || '20000', 10);

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'use GET' });
  const ctrl = new AbortController();
  // o tempo começa ANTES do pedido: cabeçalhos ou corpo presos não deixam o pedido pendurado
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const raw = String(req.query.u || '');
    let u; try { u = new URL(raw); } catch { return res.status(400).json({ error: 'url inválida' }); }
    if (u.protocol !== 'https:') return res.status(400).json({ error: 'use https' });
    if (!(u.hostname === 'googlevideo.com' || u.hostname.endsWith('.googlevideo.com'))) {
      return res.status(403).json({ error: 'domínio não permitido' });
    }

    // Range do cliente; sem Range serve-se o primeiro bloco.
    // Ranges abertos (bytes=N-) são limitados a CHUNK para cada resposta ficar pequena.
    let range = req.headers && req.headers.range;
    if (range) {
      const m = /^bytes=(\d+)-$/.exec(range.trim());
      if (m) range = `bytes=${m[1]}-${Number(m[1]) + CHUNK - 1}`;
    } else {
      range = `bytes=0-${CHUNK - 1}`;
    }

    // redirect:'manual' — redirecionamentos não são seguidos, para não contornar a lista de domínios
    let r = await fetch(u.toString(), {
      redirect: 'manual',
      headers: { 'user-agent': 'Mozilla/5.0 (MikuMusic)', accept: '*/*', range },
      signal: ctrl.signal
    });
    if (r.status >= 300 && r.status < 400) return res.status(403).json({ error: 'redirecionamento não permitido' });
    if (r.status !== 200 && r.status !== 206) return res.status(502).json({ error: 'origem respondeu ' + r.status });

    const type = (r.headers.get('content-type') || 'audio/mp4').split(';')[0];
    if (!/^audio\//.test(type) && !/^video\//.test(type) && !/^application\/octet-stream$/.test(type)) {
      return res.status(415).json({ error: 'conteúdo não é áudio' });
    }

    // ler o corpo em fluxo, limitado ao tamanho do bloco (tempo já ativo)
    const buf = await (async () => {
      if (r.body && typeof r.body.getReader === 'function') {
        const reader = r.body.getReader();
        const chunks = []; let total = 0; let over = false;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > CHUNK) { over = true; break; }
            chunks.push(Buffer.from(value));
          }
        } catch (e) {
          return { err: e };
        }
        if (over) { try { reader.cancel(); } catch (e) {} return { tooBig: true }; }
        return { buf: Buffer.concat(chunks) };
      }
      const b = Buffer.from(await r.arrayBuffer());
      return { buf: b.length > CHUNK ? null : b, tooBig: b.length > CHUNK };
    })();
    if (buf.err) return res.status(buf.err.name === 'AbortError' ? 504 : 502).json({ error: 'leitura interrompida' });
    if (buf.tooBig || !buf.buf) return res.status(502).json({ error: 'bloco demasiado grande' });

    const contentRange = r.headers.get('content-range');
    const partial = r.status === 206 || !!contentRange;
    res.setHeader('Content-Type', type);
    res.setHeader('Content-Length', buf.buf.length);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, no-store'); // as URLs do googlevideo expiram
    if (contentRange) res.setHeader('Content-Range', contentRange);
    res.status(partial ? 206 : 200);
    res.end(buf.buf);
  } catch (e) {
    res.status(e && e.name === 'AbortError' ? 504 : 500).json({ error: e.message });
  } finally {
    clearTimeout(timer);
    ctrl.abort(); // garante que nenhum pedido fica pendente
  }
};
