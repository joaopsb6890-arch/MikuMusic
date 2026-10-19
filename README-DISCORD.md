# MikuMusic — áudio completo do YouTube dentro da Atividade do Discord e player completo no navegador normal

## O que estava a falhar

Quando abres o site pela atividade do bot numa call, o Discord carrega-o num iframe atrás de um proxy (`https://<id-da-app>.discordsays.com`) com uma Content Security Policy muito restrita (documentado em [How Activities Work](https://docs.discord.com/developers/activities/how-activities-work) e no [guia de networking](https://docs.discord.com/developers/activities/development-guides/networking)):

1. **Pedidos a domínios externos falham com `blocked:csp`.** Segundo a documentação, "tudo o que a Atividade carrega resolve sob `https://{clientId}.discordsays.com`" — o player do YouTube (`youtube.com/iframe_api`), as prévias de áudio dos CDNs (Deezer/Spotify) e as imagens das capas vinham de domínios externos.
2. **Relatos de programadores** ([Chips of Fury](https://chipsoffury.com/blog/discord-activity/)) indicam que a CSP também bloqueia scripts inline — e todo o JavaScript deste site estava dentro de um `<script>` no próprio `index.html`.

Isto explica o sintoma que viste: o site abre (o HTML passa pelo proxy), mas a música não toca.

## O que foi alterado

- **`index.html`** — o CSS e o JavaScript saíram do ficheiro para `styles.css` e `app.js` (ficheiros externos do mesmo domínio).
- **`app.js`** — deteta quando corre dentro da Atividade do Discord (domínio `*.discordsays.com`) e, apenas nesse caso:
  - toca as faixas do YouTube com o **áudio completo** (extraído no servidor pelo novo `/api/ytaudio` e transmitido pelo `/api/ytstream`), com suporte a procurar dentro da faixa;
  - serve o **áudio das prévias** e as **capas** através das rotas `/api/preview` e `/api/image` (mesmo domínio → passa pelo proxy do Discord);
  - se a extração do YouTube falhar, cai automaticamente para a **prévia de 30s** (se existir);
  - se uma faixa não tem vídeo nem prévia, o `/api/resolve` (agora com YouTube Music) procura uma versão tocável — primeiro faixa completa, depois prévia — validando que nome e artista correspondem;
  - inclui proteção contra trocas rápidas de faixa (pedidos antigos são ignorados) e mensagens claras quando o autoplay é recusado ("Prévia pronta — toca novamente em Reproduzir").
- **`api/preview.js`** (novo) — transmite a prévia de áudio pelo mesmo domínio; só aceita HTTPS, rejeita redirecionamentos, limita tamanho/tempo e só permite CDNs de música conhecidos.
- **`api/image.js`** (novo) — o mesmo para as imagens das capas.
- **`api/ytaudio.js`** (novo) — recebe o `videoId` e devolve a URL do formato só de áudio (prefere AAC/mp4 pela compatibilidade com o webview do Discord).
- **`api/ytstream.js`** (novo) — transmite o áudio do `googlevideo.com` pelo mesmo domínio, com suporte a Range (procurar na faixa) e respostas limitadas a blocos de 4 MB.
- **`api/resolve.js`** (novo) — recebe nome + artista e devolve a melhor versão tocável: vídeo do YouTube Music (faixa completa) ou prévia de 30s (devolve 404 se não houver correspondência razoável). Tenta várias variantes da consulta — títulos do YouTube vêm como "Artista - Música (Clipe Oficial)" e a busca com o título completo nem sempre encontra a faixa nas outras plataformas, por isso divide o título e tenta de novo (caso real testado: "Lucas A.R.T. - RADIOATIVO" só encontra a prévia no Deezer com o título dividido).
- **`package.json`** (novo) — adiciona a dependência `@distube/ytdl-core` ^4.16.12 (a Vercel instala-a automaticamente no deploy; requer Node 20.18.1+, já suportado pela Vercel).
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

- Dentro do Discord, as faixas do YouTube tocam com **áudio completo** (sem vídeo). Segundo a [documentação do Discord](https://docs.discord.com/developers/activities/how-activities-work), os pedidos a domínios externos falham com `blocked:csp` na Atividade, por isso o player embutido do YouTube não é usado nesse contexto — não foi verificado se o Discord permite exceções para embeds do YouTube. No navegador normal, o player do YouTube continua completo.
- **Aviso importante sobre a extração real:** a dependência instala sem problemas (testado no registo do npm: `@distube/ytdl-core` 4.16.12, requer Node 20.18.1+), mas uma extração real a partir de um IP de datacenter (como este ambiente e possivelmente a Vercel) foi bloqueada pelo YouTube com "Sign in to confirm you're not a bot" — testado com os clientes android, ios e tv, todos bloqueados. O mesmo pode acontecer no teu alojamento; nesses casos o site cai automaticamente para a prévia de 30s e continua utilizável. Só um teste no teu deployment confirma se o áudio completo passa aí.
- Outros vídeos podem ser bloqueados por restrições de idade/país — nesses casos o site cai automaticamente para a prévia de 30s, e se nem isso existir mostra uma mensagem clara.
- A extração depende da biblioteca `@distube/ytdl-core` (no `package.json`); se o YouTube mudar as regras dela, a extração pode falhar até atualizares a dependência — o fallback para prévia mantém o site utilizável.
- Os testes feitos (`node tests.js`, 39/39) cobrem as rotas novas com rede simulada, e o site foi testado num navegador real em modo "Discord" (faixa completa do YouTube, procura dentro da faixa, resolução por nome, corridas de troca de faixa, recusa de autoplay). Não foi possível testar contra o YouTube real nem dentro de uma sessão real do Discord a partir deste ambiente — o comportamento real da extração só se confirma depois do deploy na Vercel (verifica-se a versão da dependência no registo do npm, mas não foi possível testar uma extração contra o YouTube real a partir deste ambiente).
- Se algo não soar dentro da call, abre os DevTools do Discord (Ctrl+Shift+I na app) e vê os erros na consola — se aparecer `blocked:csp`, falta um mapeamento no portal; se o `/api/ytaudio` devolver erro, é o YouTube a bloquear esse vídeo (vai tocar a prévia).
