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

  console.log(`\n${passed} passaram, ${failed} falharam`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('ERRO DOS TESTES:', e); process.exit(1); });
