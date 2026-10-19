// Testes das rotas /api/* com fetch simulado (sem rede).
// Executar: node tests.js
process.env.MUSICAPI_CLIENT_ID = 'id';
process.env.MUSICAPI_CLIENT_SECRET = 'secret';
process.env.PROXY_TIMEOUT_MS = '300'; // tempo curto para testar pedidos presos

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log('PASS', name); }
  else { failed++; console.log('FAIL', name, extra !== undefined ? JSON.stringify(extra) : ''); }
}

function makeRes() {
  const r = { headers: {}, code: 0 };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; };
  r.status = c => { r.code = c; return r; };
  r.json = o => { r.body = o; return r; };
  r.send = b => { r.body = b; return r; };
  r.end = b => { r.body = b; return r; };
  return r;
}
function invoke(handler, req) {
  const res = makeRes();
  const p = handler(req, res);
  return Promise.resolve(p).then(() => res);
}

(async () => {
  const realFetch = global.fetch;
  const preview = require('./api/preview.js');
  const image = require('./api/image.js');

  // mock de fetch configurável por teste
  let mockImpl = null;
  global.fetch = (url, opts) => mockImpl ? mockImpl(url, opts) : realFetch(url, opts);

  // 1. domínio não permitido
  let res = await invoke(preview, { method: 'GET', query: { url: 'https://evil-dzcdn.net/x.mp3' } });
  check('preview rejeita domínio parecido (attacker-dzcdn.net)', res.code === 403, res.body);

  res = await invoke(preview, { method: 'GET', query: { url: 'https://example.com/x.mp3' } });
  check('preview rejeita domínio externo', res.code === 403, res.body);

  // 2. http simples rejeitado
  res = await invoke(preview, { method: 'GET', query: { url: 'http://cdns-preview-2.dzcdn.net/x.mp3' } });
  check('preview exige https', res.code === 400, res.body);

  // 3. redirecionamento rejeitado
  mockImpl = () => Promise.resolve({ ok: false, status: 302, headers: new Map([['content-type', 'audio/mpeg']]) });
  res = await invoke(preview, { method: 'GET', query: { url: 'https://cdns-preview-2.dzcdn.net/x.mp3' } });
  check('preview rejeita redirecionamento', res.code === 403, res.body);

  // 4. encaminhamento binário de áudio
  const fakeMp3 = Buffer.from(Uint8Array.from([0x49, 0x44, 0x33, 4, 5, 6]).buffer); // "ID3..."
  mockImpl = () => Promise.resolve({
    ok: true, status: 200,
    headers: new Map([['content-type', 'audio/mpeg'], ['content-length', String(fakeMp3.length)]]),
    arrayBuffer: () => Promise.resolve(fakeMp3.buffer.slice(0, fakeMp3.byteLength))
  });
  res = await invoke(preview, { method: 'GET', query: { url: 'https://cdns-preview-2.dzcdn.net/stream/c-abc-3.mp3' } });
  check('preview encaminha áudio', res.code === 200 && Buffer.compare(res.body, fakeMp3) === 0, { code: res.code });
  check('preview define content-type', res.headers['content-type'] === 'audio/mpeg');

  // 5. conteúdo não-áudio rejeitado
  mockImpl = () => Promise.resolve({
    ok: true, status: 200,
    headers: new Map([['content-type', 'text/html']]),
    arrayBuffer: () => Promise.resolve(new TextEncoder().encode('<html>').buffer)
  });
  res = await invoke(preview, { method: 'GET', query: { url: 'https://cdns-preview-2.dzcdn.net/x.mp3' } });
  check('preview rejeita conteúdo não-áudio', res.code === 415, res.body);

  // 6. imagem: conteúdo não-imagem rejeitado
  res = await invoke(image, { method: 'GET', query: { url: 'https://i.scdn.co/image/abc' } });
  check('image rejeita conteúdo não-imagem', res.code === 415, res.body);

  // 7. imagem válida encaminhada
  const fakeJpg = Buffer.from(Uint8Array.from([0xFF, 0xD8, 0xFF, 0xE0]).buffer);
  mockImpl = () => Promise.resolve({
    ok: true, status: 200,
    headers: new Map([['content-type', 'image/jpeg'], ['content-length', String(fakeJpg.length)]]),
    arrayBuffer: () => Promise.resolve(fakeJpg.buffer.slice(0, fakeJpg.byteLength))
  });
  res = await invoke(image, { method: 'GET', query: { url: 'https://i.scdn.co/image/abc' } });
  check('image encaminha imagem', res.code === 200 && Buffer.compare(res.body, fakeJpg) === 0, { code: res.code });

  // 7b. leitura em fluxo (body.getReader) com vários blocos
  const chunkA = Uint8Array.from([1, 2, 3]), chunkB = Uint8Array.from([4, 5]);
  mockImpl = () => Promise.resolve({
    ok: true, status: 200,
    headers: new Map([['content-type', 'image/jpeg']]),
    body: { getReader: () => {
      let i = 0;
      const chunks = [chunkA, chunkB];
      return { read: () => i < chunks.length ? Promise.resolve({ done: false, value: chunks[i++] }) : Promise.resolve({ done: true }) };
    } }
  });
  res = await invoke(image, { method: 'GET', query: { url: 'https://i.scdn.co/image/abc' } });
  check('image lê o corpo em fluxo (vários blocos)', res.code === 200 && Buffer.compare(res.body, Buffer.from([1, 2, 3, 4, 5])) === 0, { code: res.code });

  // 7c. corpo demasiado grande sem Content-Length -> 413 durante a leitura
  const bigChunk = new Uint8Array(1024 * 1024); // 1 MB por bloco; limite da imagem = 3 MB
  mockImpl = () => Promise.resolve({
    ok: true, status: 200,
    headers: new Map([['content-type', 'image/jpeg']]),
    body: { getReader: () => ({ read: () => Promise.resolve({ done: false, value: bigChunk }) }) }
  });
  res = await invoke(image, { method: 'GET', query: { url: 'https://i.scdn.co/image/abc' } });
  check('image rejeita corpo demasiado grande (sem content-length)', res.code === 413, { code: res.code });

  // 8. resolve: escolhe a faixa com nome correspondente e não a primeira qualquer
  const api = require('./api/_musicapi.js');
  const origCall = api.call;
  const makeCall = (tracks) => (path, body) => Promise.resolve({
    tracks: tracks.map(t => ({ source: 'deezer', status: 'success', data: t }))
  });
  api.call = makeCall([
    { externalId: '1', name: 'Coisa Completamente Diferente', artistNames: ['Outra Pessoa'], previewUrl: 'https://cdns-preview-2.dzcdn.net/a.mp3' },
    { externalId: '2', name: 'World Is Mine', artistNames: ['Hatsune Miku'], previewUrl: 'https://cdns-preview-2.dzcdn.net/b.mp3' }
  ]);
  const resolve = require('./api/resolve.js');
  res = await invoke(resolve, { method: 'POST', body: { name: 'World Is Mine', artist: 'Hatsune Miku' } });
  check('resolve escolhe a faixa correspondente', res.code === 200 && res.body.previewUrl.endsWith('b.mp3'), res.body);

  // 9. resolve: sem correspondência -> 404 (nova instância com mock trocado antes do require)
  api.call = makeCall([
    { externalId: '1', name: 'Nada a Ver', artistNames: ['X'], previewUrl: 'https://cdns-preview-2.dzcdn.net/a.mp3' }
  ]);
  delete require.cache[require.resolve('./api/resolve.js')];
  const resolve2 = require('./api/resolve.js');
  res = await invoke(resolve2, { method: 'POST', body: { name: 'World Is Mine', artist: 'Hatsune Miku' } });
  check('resolve devolve 404 sem correspondência', res.code === 404, res.body);

  // 9b. resolve: título em japonês preservado
  api.call = makeCall([
    { externalId: '3', name: '千本桜', artistNames: ['Hatsune Miku'], previewUrl: 'https://cdns-preview-2.dzcdn.net/jp.mp3' }
  ]);
  delete require.cache[require.resolve('./api/resolve.js')];
  const resolve3 = require('./api/resolve.js');
  res = await invoke(resolve3, { method: 'POST', body: { name: '千本桜', artist: 'Hatsune Miku' } });
  check('resolve preserva título japonês', res.code === 200 && res.body.previewUrl.endsWith('jp.mp3'), res.body);

  // 9c. resolve: mesmo título, artista diferente -> 404
  api.call = makeCall([
    { externalId: '4', name: 'World Is Mine', artistNames: ['Outra Banda'], previewUrl: 'https://cdns-preview-2.dzcdn.net/x.mp3' }
  ]);
  delete require.cache[require.resolve('./api/resolve.js')];
  const resolve4 = require('./api/resolve.js');
  res = await invoke(resolve4, { method: 'POST', body: { name: 'World Is Mine', artist: 'Hatsune Miku' } });
  check('resolve rejeita artista diferente', res.code === 404, res.body);

  // 9d. resolve: nome que normaliza para vazio -> 404
  api.call = makeCall([
    { externalId: '5', name: '!!!', artistNames: ['X'], previewUrl: 'https://cdns-preview-2.dzcdn.net/y.mp3' }
  ]);
  delete require.cache[require.resolve('./api/resolve.js')];
  const resolve5 = require('./api/resolve.js');
  res = await invoke(resolve5, { method: 'POST', body: { name: '!!!', artist: 'X' } });
  check('resolve rejeita nome vazio após normalização', res.code === 404, res.body);

  // 9e. resolve: prefere o título exato à correspondência parcial
  api.call = makeCall([
    { externalId: '6', name: 'Song (Live)', artistNames: ['Artista'], previewUrl: 'https://cdns-preview-2.dzcdn.net/live.mp3' },
    { externalId: '7', name: 'Song', artistNames: ['Artista'], previewUrl: 'https://cdns-preview-2.dzcdn.net/exact.mp3' }
  ]);
  delete require.cache[require.resolve('./api/resolve.js')];
  const resolve6 = require('./api/resolve.js');
  res = await invoke(resolve6, { method: 'POST', body: { name: 'Song', artist: 'Artista' } });
  check('resolve prefere o título exato', res.code === 200 && res.body.previewUrl.endsWith('exact.mp3'), res.body);
  api.call = origCall;

  // 12. tempo esgotado: cabeçalhos que nunca chegam -> 504
  mockImpl = (url, opts) => new Promise((res2, rej) =>
    opts.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))
  );
  res = await invoke(preview, { method: 'GET', query: { url: 'https://cdns-preview-2.dzcdn.net/slow.mp3' } });
  check('preview devolve 504 se os cabeçalhos nunca chegam', res.code === 504, { code: res.code, body: res.body });

  // 13. tempo esgotado: corpo preso a meio da leitura -> 504
  mockImpl = (url, opts) => Promise.resolve({
    ok: true, status: 200,
    headers: new Map([['content-type', 'image/jpeg']]),
    body: { getReader: () => ({
      read: () => new Promise((res2, rej) =>
        opts.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))
      )
    }) }
  });
  res = await invoke(image, { method: 'GET', query: { url: 'https://i.scdn.co/image/slow' } });
  check('image devolve 504 se o corpo ficar preso', res.code === 504, { code: res.code, body: res.body });

  // 10. escape HTML do app.js
  const fs = require('fs');
  const src = fs.readFileSync('app.js', 'utf8');
  const escSrc = src.match(/const esc =[\s\S]*?\}\[c\]\)\);/)[0];
  const esc = eval('(' + escSrc.replace(/^const esc =/, '').replace(/;$/, '') + ')');
  const amp = String.fromCharCode(38);
  const esperado = amp + 'lt;img src=x onerror=' + amp + 'quot;a' + amp + 'quot;' + amp + 'gt;' + amp + 'amp;' + amp + '#39;';
  check('esc escapa < > & " \'', esc('<img src=x onerror="a">&\'') === esperado, esc('<img src=x onerror="a">&\''));
  check('esc preserva texto normal', esc('World Is Mine') === 'World Is Mine');

  // 11. EMBEDDED só para discordsays.com
  const emb = /const EMBEDDED = ([^;]+);/.exec(src)[1];
  check('EMBEDDED usa apenas o domínio do Discord', !emb.includes('window.self') && emb.includes('discordsays'));


  // ===== ytaudio =====
  const fs2 = require('fs');
  const fakeYtdl = `module.exports = { getInfo: async (id) => {
    if (id === 'semformato1') return { formats: [{ mimeType: 'video/mp4', url: 'https://rr1---sn-x.googlevideo.com/v' }], videoDetails: {} };
    if (id === 'falhaaaaaaa') throw new Error('video unavailable');
    return {
      formats: [
        { mimeType: 'audio/webm; codecs=opus', bitrate: 160000, url: 'https://rr1---sn-x.googlevideo.com/videoplayback?webm' },
        { mimeType: 'audio/mp4; codecs=mp4a', bitrate: 128000, url: 'https://rr1---sn-x.googlevideo.com/videoplayback?m4a' }
      ],
      videoDetails: { lengthSeconds: '213', title: 'Tema QA' }
    };
  } };`;
  fs2.writeFileSync('/tmp/fake-ytdl.js', fakeYtdl);
  process.env.YTDL_MODULE = '/tmp/fake-ytdl.js';
  delete require.cache[require.resolve('./api/ytaudio.js')];
  const ytaudio = require('./api/ytaudio.js');

  res = await invoke(ytaudio, { method: 'POST', body: { videoId: 'invalido' } });
  check('ytaudio rejeita videoId inválido', res.code === 400, { code: res.code, body: res.body });

  res = await invoke(ytaudio, { method: 'POST', body: { videoId: 'vid11111111' } });
  check('ytaudio prefere AAC/mp4 (compatibilidade)', res.code === 200 && res.body.url.endsWith('m4a') && res.body.duration === 213, { code: res.code, body: res.body });

  res = await invoke(ytaudio, { method: 'POST', body: { videoId: 'semformato1' } });
  check('ytaudio devolve 404 sem formatos de áudio', res.code === 404, { code: res.code });

  res = await invoke(ytaudio, { method: 'POST', body: { videoId: 'falhaaaaaaa' } });
  check('ytaudio devolve 502 quando o YouTube falha', res.code === 502, { code: res.code });

  process.env.YTDL_MODULE = '/tmp/modulo-que-nao-existe.js';
  delete require.cache[require.resolve('./api/ytaudio.js')];
  const ytaudio2 = require('./api/ytaudio.js');
  res = await invoke(ytaudio2, { method: 'POST', body: { videoId: 'vid11111111' } });
  check('ytaudio devolve 503 sem a dependência instalada', res.code === 503, { code: res.code, body: res.body });
  process.env.YTDL_MODULE = '/tmp/fake-ytdl.js';
  delete require.cache[require.resolve('./api/ytaudio.js')];

  // ===== ytstream =====
  const ytstream = require('./api/ytstream.js');
  let capturedRange = null;

  res = await invoke(ytstream, { method: 'GET', query: { u: 'https://evil.googlevideo.com.evil.com/x' } });
  check('ytstream rejeita domínio não googlevideo', res.code === 403, { code: res.code });

  res = await invoke(ytstream, { method: 'GET', query: { u: 'http://rr1---sn-x.googlevideo.com/videoplayback?x' } });
  check('ytstream exige https', res.code === 400, { code: res.code });

  // range do cliente retransmitido + 206/content-range devolvidos
  const wavPart = Buffer.from(Uint8Array.from([1, 2, 3, 4]).buffer);
  mockImpl = (url, opts) => {
    capturedRange = opts.headers.range;
    return Promise.resolve({
      ok: true, status: 206,
      headers: new Map([['content-type', 'audio/mp4'], ['content-range', 'bytes 100-103/1000']]),
      body: { getReader: () => {
        let reads = 0;
        return { read: () => ++reads === 1 ? Promise.resolve({ done: false, value: wavPart }) : Promise.resolve({ done: true }) };
      } }
    });
  };
  res = await invoke(ytstream, { method: 'GET', query: { u: 'https://rr1---sn-x.googlevideo.com/videoplayback?x' }, headers: { range: 'bytes=100-' } });
  check('ytstream limita range aberto a 4MB', capturedRange === 'bytes=100-4194403', { capturedRange });
  check('ytstream devolve 206 com content-range', res.code === 206 && res.headers['content-range'] === 'bytes 100-103/1000', { code: res.code, headers: res.headers });

  // sem range do cliente -> primeiro bloco
  res = await invoke(ytstream, { method: 'GET', query: { u: 'https://rr1---sn-x.googlevideo.com/videoplayback?x' } });
  check('ytstream sem range pede o primeiro bloco', capturedRange === 'bytes=0-4194303', { capturedRange });

  // range fechado retransmitido tal como está
  res = await invoke(ytstream, { method: 'GET', query: { u: 'https://rr1---sn-x.googlevideo.com/videoplayback?x' }, headers: { range: 'bytes=50-99' } });
  check('ytstream retransmite range fechado', capturedRange === 'bytes=50-99', { capturedRange });

  // redirecionamento
  mockImpl = () => Promise.resolve({ ok: false, status: 302, headers: new Map([['content-type', 'audio/mp4']]) });
  res = await invoke(ytstream, { method: 'GET', query: { u: 'https://rr1---sn-x.googlevideo.com/videoplayback?x' } });
  check('ytstream rejeita redirecionamento', res.code === 403, { code: res.code });

  // conteúdo não-áudio
  mockImpl = () => Promise.resolve({ ok: true, status: 200, headers: new Map([['content-type', 'text/html']]), body: null });
  res = await invoke(ytstream, { method: 'GET', query: { u: 'https://rr1---sn-x.googlevideo.com/videoplayback?x' } });
  check('ytstream rejeita conteúdo não-áudio', res.code === 415, { code: res.code });

  // ===== resolve devolve videoId (YouTube Music) =====
  const makeCallYT = (tracks) => (path, body) => Promise.resolve({
    tracks: tracks.map(t => ({ source: 'youtubeMusic', status: 'success', data: t }))
  });
  api.call = makeCallYT([
    { externalId: 'ytvid12345', name: 'Tema YouTube', artistNames: ['QA Artista'], previewUrl: null, url: 'https://music.youtube.com/watch?v=ytvid12345' }
  ]);
  delete require.cache[require.resolve('./api/resolve.js')];
  const resolve7 = require('./api/resolve.js');
  res = await invoke(resolve7, { method: 'POST', body: { name: 'Tema YouTube', artist: 'QA Artista' } });
  check('resolve devolve videoId do YouTube Music', res.code === 200 && res.body.videoId === 'ytvid12345', { code: res.code, body: res.body });
  api.call = origCall;

  // ===== resolve devolve várias versões (candidates) =====
  api.call = makeCallYT([
    { externalId: 'ytvid123456', name: 'Tema YouTube', artistNames: ['QA Artista'], previewUrl: null, url: 'https://music.youtube.com/watch?v=ytvid123456' },
    { externalId: 'cand2', name: 'Tema YouTube', artistNames: ['QA Artista'], previewUrl: 'https://cdns-preview-2.dzcdn.net/stream/c-cand2-3.mp3', url: null }
  ]);
  delete require.cache[require.resolve('./api/resolve.js')];
  const resolve8 = require('./api/resolve.js');
  res = await invoke(resolve8, { method: 'POST', body: { name: 'Tema YouTube', artist: 'QA Artista' } });
  check('resolve devolve candidatos ordenados (completa primeiro)',
    res.code === 200 && Array.isArray(res.body.candidates) && res.body.candidates.length === 2 &&
    !!res.body.candidates[0].videoId && !!res.body.candidates[1].previewUrl,
    { code: res.code, body: res.body });
  api.call = origCall;

  // ===== resolve: título do YouTube "Artista - Música" (caso real do utilizador) =====
  // a MusicAPI só encontra a faixa no Deezer quando a consulta é dividida
  const makeCallReal = (body) => (path, reqBody) => {
    const q = norm2(reqBody.track || '');
    if (q.includes('lucas a r t')) {
      // consulta com o título completo: só o resultado do YouTube (sem prévia)
      return Promise.resolve({ tracks: [
        { source: 'youtube', status: 'success', data: { externalId: 'ICpw2v83Eiw', name: 'Lucas A.R.T. - RADIOATIVO', artistNames: ['7 Minutoz'], albumName: '', imageUrl: null, previewUrl: null, url: 'https://youtu.be/ICpw2v83Eiw' } }
      ] });
    }
    if (q.includes('radioativo')) {
      // consulta com o título dividido: a faixa do Deezer com prévia
      return Promise.resolve({ tracks: [
        { source: 'deezer', status: 'success', data: { externalId: 'dz1', name: 'RADIOATIVO', artistNames: ['7 Minutoz'], albumName: 'X', imageUrl: null, previewUrl: 'https://cdnt-preview.dzcdn.net/api/1/1/radioativo.mp3', url: null } }
      ] });
    }
    return Promise.resolve({ tracks: [] });
  };
  function norm2(s){ return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^\p{L}\p{N}]+/gu,' ').replace(/\s+/g,' ').trim(); }
  api.call = makeCallReal();
  delete require.cache[require.resolve('./api/resolve.js')];
  const resolve9 = require('./api/resolve.js');
  res = await invoke(resolve9, { method: 'POST', body: { name: 'Lucas A.R.T. - RADIOATIVO', artist: '7 Minutoz' } });
  check('resolve divide título "Artista - Música" e encontra a faixa',
    res.code === 200 &&
    res.body.candidates[0].videoId === 'ICpw2v83Eiw' &&
    res.body.candidates.some(c => c.previewUrl && c.previewUrl.includes('radioativo')),
    { code: res.code, body: res.body });
  // também funciona com o nome simples
  res = await invoke(resolve9, { method: 'POST', body: { name: 'RADIOATIVO', artist: '7 Minutoz' } });
  check('resolve com nome simples continua a funcionar', res.code === 200 && !!res.body.previewUrl, { code: res.code });
  api.call = origCall;

  console.log(`\n${passed} passaram, ${failed} falharam`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('ERRO DOS TESTES:', e); process.exit(1); });
