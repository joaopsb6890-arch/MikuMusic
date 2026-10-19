// MikuMusic - servidor proxy (Node.js 18 ou superior, sem dependências)
// Ele guarda suas credenciais da MusicAPI e entrega o site.
//
// Como usar:
//   MUSICAPI_CLIENT_ID=seu_id MUSICAPI_CLIENT_SECRET=seu_secret MUSICAPI_USER_UUID=uuid node server.js
// Depois abra http://localhost:3000

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const CLIENT_ID = process.env.MUSICAPI_CLIENT_ID;
const CLIENT_SECRET = process.env.MUSICAPI_CLIENT_SECRET;
const USER_UUID = process.env.MUSICAPI_USER_UUID; // integrationUserUUID do usuário conectado

if (!CLIENT_ID || !CLIENT_SECRET || !USER_UUID) {
  console.warn('Faltam variáveis: MUSICAPI_CLIENT_ID, MUSICAPI_CLIENT_SECRET e MUSICAPI_USER_UUID.');
}

const auth = 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/api/search') {
    let raw = '';
    req.on('data', c => { raw += c; if (raw.length > 10000) req.destroy(); });
    req.on('end', async () => {
      try {
        const { query } = JSON.parse(raw || '{}');
        if (!query || typeof query !== 'string') return send(res, 400, { error: 'query obrigatória' });

        const r = await fetch(`https://api.musicapi.com/api/${USER_UUID}/search?limitParam=24`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: auth },
          body: JSON.stringify({ type: 'track', track: query.slice(0, 200) })
        });
        const text = await r.text();
        send(res, r.status, text);
      } catch (e) {
        send(res, 502, { error: 'Falha ao consultar a MusicAPI' });
      }
    });
    return;
  }

  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    return send(res, 200, fs.readFileSync(path.join(__dirname, 'index.html')), 'text/html; charset=utf-8');
  }
  send(res, 404, { error: 'não encontrado' });
});

server.listen(PORT, () => console.log(`MikuMusic rodando em http://localhost:${PORT}`));
