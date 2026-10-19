# MikuMusic — atualizado para a Atividade do Discord (prévias de áudio) e para o navegador normal (YouTube completo)

## O que estava a falhar

Quando abres o site pela atividade do bot numa call, o Discord carrega-o num iframe atrás de um proxy (`https://<id-da-app>.discordsays.com`) com uma Content Security Policy muito restrita (documentado em [How Activities Work](https://docs.discord.com/developers/activities/how-activities-work) e no [guia de networking](https://docs.discord.com/developers/activities/development-guides/networking)):

1. **Pedidos a domínios externos falham com `blocked:csp`.** Segundo a documentação, "tudo o que a Atividade carrega resolve sob `https://{clientId}.discordsays.com`" — o player do YouTube (`youtube.com/iframe_api`), as prévias de áudio dos CDNs (Deezer/Spotify) e as imagens das capas vinham de domínios externos.
2. **Relatos de programadores** ([Chips of Fury](https://chipsoffury.com/blog/discord-activity/)) indicam que a CSP também bloqueia scripts inline — e todo o JavaScript deste site estava dentro de um `<script>` no próprio `index.html`.

Isto explica o sintoma que viste: o site abre (o HTML passa pelo proxy), mas a música não toca.

## O que foi alterado

- **`index.html`** — o CSS e o JavaScript saíram do ficheiro para `styles.css` e `app.js` (ficheiros externos do mesmo domínio).
- **`app.js`** — deteta quando corre dentro da Atividade do Discord (domínio `*.discordsays.com`) e, apenas nesse caso:
  - serve o **áudio das prévias** e as **capas** através das novas rotas `/api/preview` e `/api/image` (mesmo domínio → passa pelo proxy do Discord);
  - toca as faixas do YouTube como **prévia de áudio** em vez do player embutido;
  - se uma faixa não tem prévia (resultados do YouTube ou modo demonstração), pede ao novo endpoint `/api/resolve` para procurar uma prévia equivalente no Deezer/Spotify/Apple Music — validando que o nome corresponde.
  - inclui proteção contra trocas rápidas de faixa (pedidos antigos são ignorados).
- **`api/preview.js`** (novo) — transmite a prévia de áudio pelo mesmo domínio; só aceita HTTPS, rejeita redirecionamentos, limita tamanho/tempo e só permite CDNs de música conhecidos.
- **`api/image.js`** (novo) — o mesmo para as imagens das capas.
- **`api/resolve.js`** (novo) — recebe nome + artista e devolve a prévia tocável com melhor correspondência (devolve 404 se não houver correspondência razoável).
- **`tests.js`** (novo) — testes das rotas com rede simulada (`node tests.js`; 22 testes, todos a passar).
- No navegador normal nada muda: o player do YouTube completo continua a funcionar como antes.

## Como pôr a funcionar

### 1. Variáveis na Vercel (Settings → Environment Variables)

- `MUSICAPI_CLIENT_ID` e `MUSICAPI_CLIENT_SECRET` — sem elas, a busca cai no modo demonstração e `/api/resolve` não consegue achar prévias.
- Opcional: `FEATURED_PLAYLIST_ID`, `FEATURED_SERVICE`, `MUSICAPI_SOURCES`.

### 2. URL Mappings no Discord Developer Portal

No [Developer Portal](https://discord.com/developers/applications) → a tua app → **Activities → URL Mappings**, garante que existe um mapeamento a apontar para o teu domínio da Vercel, por exemplo:

| Prefixo | Destino |
|---|---|
| `/` | `mikumusic.vercel.app` |

Com o mapeamento raiz, os pedidos a `/api/search`, `/api/featured`, `/api/preview`, `/api/image` e `/api/resolve` também são encaminhados para a Vercel. Se tiveres mapeamentos mais específicos, prefixos mais longos têm de vir antes dos mais curtos (regra oficial em [URL Mappings](https://docs.discord.com/developers/activities/development-guides/local-development#url-mapping)).

### 3. Publicar

Faz deploy do projeto atualizado para a Vercel (arrasta a pasta ou usa `vercel --prod`) e volta a abrir a Atividade no Discord.

## Limitações e notas honestas

- Este patch usa **prévia de áudio** dentro do Discord; a reprodução completa do YouTube aí **não foi verificada** — os pedidos a domínios externos são bloqueados pela CSP da Atividade, por isso o player embutido não é usado nesse contexto. No navegador normal, o player do YouTube continua completo.
- Os testes feitos (`node tests.js`, 22/22) cobrem as rotas novas com rede simulada, e o site foi testado num navegador real (renderização, busca, favoritos, player, degradação graciosa sem backend). Não foi possível testar dentro de uma sessão real do Discord a partir deste ambiente.
- Se algo não soar dentro da call, abre os DevTools do Discord (Ctrl+Shift+I na app) e vê os erros na consola — se aparecer `blocked:csp`, falta um mapeamento no portal.
