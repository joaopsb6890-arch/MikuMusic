/* ================= CONFIGURAÇÃO ================= */
// Vazio = usa as funções /api/* do mesmo domínio (Vercel).
// NUNCA coloque o Client ID / Secret da MusicAPI neste arquivo.
const API_BASE = '';

/* Dentro de uma Atividade do Discord o site corre num iframe em *.discordsays.com,
   atrás do proxy do Discord com uma CSP que bloqueia CDNs externos (YouTube,
   Deezer...) e scripts dinâmicos. Nesse caso, áudio e imagens são servidos pelas
   rotas /api/preview e /api/image do mesmo domínio, e as faixas do YouTube
   tocam como prévia de áudio. Um iframe genérico (noutro site) não é afetado. */
const EMBEDDED = /(^|\.)discordsays\.com$/i.test(location.hostname);
const proxyUrl = (kind, url) => (EMBEDDED && url) ? `${API_BASE}/api/${kind}?url=${encodeURIComponent(url)}` : url;
const imgProxy = url => proxyUrl('image', url);
const audioProxy = url => proxyUrl('preview', url);
const EMBEDDED_NOTE = 'A correr dentro do Discord: as faixas tocam como prévia de áudio (a reprodução completa do YouTube não foi verificada dentro da Atividade).';

/* ================= DADOS DE DEMONSTRAÇÃO ================= */
const DEMO = [
  ['World Is Mine','Hatsune Miku'],['Tell Your World','livetune feat. Hatsune Miku'],
  ['Senbonzakura','Hatsune Miku'],['Ievan Polkka','Hatsune Miku'],
  ['Melt','Hatsune Miku'],['The Disappearance of Hatsune Miku','Hatsune Miku'],
  ['Ghost Rule','DECO*27 feat. Hatsune Miku'],['Love is War','Hatsune Miku'],
  ['Rolling Girl','Hatsune Miku'],['Sing & Smile','Hatsune Miku'],
  ['Blue Star','Hatsune Miku'],['Weekender Girl','Hatsune Miku']
].map(([name,artist],i)=>({id:'demo'+i,name,artist,album:'Demonstração',imageUrl:null,previewUrl:null}));

/* ================= ESTADO ================= */
const $ = s => document.querySelector(s);
const audio = new Audio();
audio.volume = .8;
const SERVICES = {spotify:'Spotify',deezer:'Deezer',appleMusic:'Apple Music',youtube:'YouTube',youtubeMusic:'YouTube Music',soundCloud:'SoundCloud',tidal:'Tidal',amazonMusic:'Amazon Music',napster:'Napster',pandora:'Pandora',qobuz:'Qobuz'};
let list = [], view = 'discover', current = -1, favs = [];

try{ favs = JSON.parse(localStorage.getItem('mikumusic:favs') || '[]'); }catch(e){ favs = []; }
const saveFavs = () => { try{ localStorage.setItem('mikumusic:favs', JSON.stringify(favs)); }catch(e){} $('#favCount').textContent = favs.length ? `(${favs.length})` : ''; };

/* ================= UTILIDADES ================= */
const fmt = s => isFinite(s) ? Math.floor(s/60)+':'+String(Math.floor(s%60)).padStart(2,'0') : '0:00';
const hue = str => { let h=0; for(const c of str) h=(h*31+c.charCodeAt(0))%360; return h; };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({
  '&': String.fromCharCode(38) + 'amp;',
  '<': String.fromCharCode(38) + 'lt;',
  '>': String.fromCharCode(38) + 'gt;',
  '"': String.fromCharCode(38) + 'quot;',
  "'": String.fromCharCode(38) + '#39;'
}[c]));
function toast(msg){ const t=$('#toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(toast.t); toast.t=setTimeout(()=>t.classList.remove('show'),2400); }
function coverHTML(t){
  if(t.imageUrl) return `<img src="${esc(imgProxy(t.imageUrl))}" alt="" loading="lazy">`;
  const h = hue(t.name+t.artist);
  return `<div class="ph" style="background:linear-gradient(135deg,hsl(${h} 70% 55%),hsl(${(h+60)%360} 75% 65%))">${esc((t.name||'?')[0])}</div>`;
}

/* ================= API ================= */
function normalize(data){ return data.results || []; }
async function searchAPI(q){
  const ctrl = new AbortController(); const to = setTimeout(()=>ctrl.abort(), 12000);
  try{
    const res = await fetch(`${API_BASE}/api/search`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ query:q }), signal: ctrl.signal
    });
    if(!res.ok) throw new Error('HTTP '+res.status);
    return normalize(await res.json());
  } finally { clearTimeout(to); }
}
// procura uma prévia tocável (Deezer/Spotify/Apple) para faixas sem previewUrl
async function resolvePreview(t){
  const ctrl = new AbortController(); const to = setTimeout(()=>ctrl.abort(), 12000);
  try{
    const res = await fetch(`${API_BASE}/api/resolve`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ name:t.name, artist:t.artist }), signal: ctrl.signal
    });
    if(!res.ok) return null;
    const d = await res.json();
    return d.previewUrl ? d : null;
  }catch(e){ return null; }
  finally { clearTimeout(to); }
}

/* ================= RENDER ================= */
function render(){
  const grid = $('#grid');
  if(!list.length){
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><strong>${view==='favs'?'Sua lista está vazia':'Nenhum resultado'}</strong>${view==='favs'?'Toque no coração de uma faixa para salvá-la aqui.':'Tente outro nome de música ou artista.'}</div>`;
    $('#count').textContent=''; return;
  }
  $('#count').textContent = list.length + (list.length===1?' faixa':' faixas');
  grid.innerHTML = list.map((t,i)=>`
    <article class="card ${i===current?'playing':''}" data-i="${i}">
      <div class="cover">${coverHTML(t)}
        <button class="play" data-act="play" aria-label="Tocar ${esc(t.name)}"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></button>
      </div>
      <button class="fav" data-act="fav" aria-pressed="${favs.some(f=>f.id===t.id)}" aria-label="Salvar na minha lista"><svg viewBox="0 0 24 24"><path d="M12 21s-7-4.6-9.3-9.1C1.2 8.8 3 5 6.6 5c2 0 3.4 1.1 5.4 3 2-1.9 3.4-3 5.4-3 3.600 0 5.400 3.800 3.900 6.900C19 16.400 12 21 12 21z"/></svg></button>
      <h3 title="${esc(t.name)}">${esc(t.name)}</h3>
      <p title="${esc(t.artist)}">${esc(t.artist)}</p>
      ${t.source?`<p class="src">${t.url?`<a href="${esc(t.url)}" target="_blank" rel="noopener">Abrir no ${esc(SERVICES[t.source]||t.source)}</a>`:esc(SERVICES[t.source]||t.source)}</p>`:''}
    </article>`).join('');
}
function skeletons(){ $('#grid').innerHTML = Array(8).fill('<div class="skeleton"></div>').join(''); }
function setBanner(msg){ const b=$('#banner'); b.hidden=!msg; b.textContent=msg||''; }
const defaultBanner = () => EMBEDDED ? EMBEDDED_NOTE : '';

/* ================= PLAYER ================= */
let mode = 'audio', yt = null, ytReady = null, curVol = .8;
let playToken = 0; // invalida reproduções desatualizadas quando se troca de faixa a meio
let playIntent = null; // { token, wantPlay } — permite pausar enquanto a prévia é procurada
let resolveState = null; // 'pending' | 'failed' | null — estado da procura de prévia da faixa atual

// para e limpa o áudio atual (para o áudio da faixa anterior não continuar a tocar)
function stopAudio(){
  try{ audio.pause(); audio.removeAttribute('src'); audio.load(); }catch(e){}
}

// play() devolve uma promessa; ao trocar de faixa ela pode ser interrompida (AbortError), o que é normal.
function safePlay(){
  const p = audio.play();
  if(p && p.catch) p.catch(e=>{
    if(e.name === 'NotAllowedError'){
      // a ativação do clique expirou (ex.: a prévia demorou a chegar) — o áudio está pronto
      setIcon(false);
      toast('Prévia pronta — toca novamente em Reproduzir');
    } else if(e.name !== 'AbortError') toast('Não foi possível tocar esta prévia');
  });
}
function setIcon(playing){
  $('#icoPlay').innerHTML = playing ? '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>' : '<path d="M8 5v14l11-7z"/>';
}

/* --- YouTube (player oficial incorporado; só fora do Discord) --- */
function ensureYT(){
  if(ytReady) return ytReady;
  ytReady = new Promise((resolve,reject)=>{
    window.onYouTubeIframeAPIReady = ()=>{
      yt = new YT.Player('ytPlayer',{
        width:'100%', height:'100%', playerVars:{playsinline:1, rel:0, modestbranding:1},
        events:{
          onReady:()=>{ yt.setVolume(curVol*100); resolve(yt); },
          onStateChange:e=>{
            if(mode!=='yt') return;
            if(e.data===1) setIcon(true);
            else if(e.data===2) setIcon(false);
            else if(e.data===0){ setIcon(false); step(1); }
          },
          onError:()=>{ setIcon(false); toast('Este vídeo não pode ser tocado aqui. Use o link "Abrir no YouTube".'); }
        }
      });
    };
    const sc = document.createElement('script');
    sc.src = 'https://www.youtube.com/iframe_api';
    sc.onerror = ()=>reject(new Error('yt'));
    document.head.appendChild(sc);
  });
  ytReady.catch(()=>{ ytReady = null; });
  return ytReady;
}
setInterval(()=>{
  if(mode!=='yt' || !yt || !yt.getDuration) return;
  const d = yt.getDuration(), c = yt.getCurrentTime();
  if(d>0){ $('#cur').textContent=fmt(c); $('#dur').textContent=fmt(d); $('#seek').value=(c/d)*100; }
}, 500);

/* --- áudio de prévia (Deezer, Spotify etc.) --- */
audio.addEventListener('play',()=>{ if(mode==='audio') setIcon(true); });
audio.addEventListener('pause',()=>{ if(mode==='audio') setIcon(false); });
audio.addEventListener('ended',()=>{ if(mode==='audio') step(1); });
audio.addEventListener('loadedmetadata',()=>{ if(mode==='audio') $('#dur').textContent=fmt(audio.duration); });
audio.addEventListener('timeupdate',()=>{
  if(mode!=='audio') return;
  $('#cur').textContent = fmt(audio.currentTime);
  if(audio.duration) $('#seek').value = (audio.currentTime/audio.duration)*100;
});

async function play(i){
  const t = list[i]; if(!t) return;
  const my = ++playToken; // trocar de faixa rapidamente invalida pedidos anteriores
  playIntent = { token: my, wantPlay: true };
  resolveState = null;
  current = i;
  $('#npTitle').textContent = t.name; $('#npArtist').textContent = t.artist;
  $('#npThumb').innerHTML = coverHTML(t);
  $('#seek').value = 0; $('#cur').textContent = '0:00'; $('#dur').textContent = '0:00';
  render();
  stopAudio(); // a faixa anterior para imediatamente

  // Player do YouTube só no navegador normal: dentro da Atividade do Discord o CSP bloqueia.
  if(t.videoId && !EMBEDDED){
    mode = 'yt'; audio.pause();
    $('#ytBox').classList.add('show');
    try{
      const p = await ensureYT();
      if(my === playToken && current===i) p.loadVideoById(t.videoId);
    }catch(e){ toast('Não consegui carregar o player do YouTube'); }
    return;
  }

  mode = 'audio';
  if(yt && yt.pauseVideo) yt.pauseVideo();
  $('#ytBox').classList.remove('show');

  let src = t.previewUrl ? audioProxy(t.previewUrl) : null;
  if(!src){
    // faixa do YouTube/demo dentro do Discord (ou sem prévia): procura uma prévia tocável
    resolveState = 'pending';
    toast('Procurando uma prévia…');
    const hit = await resolvePreview(t);
    if(my !== playToken) return; // o utilizador já escolheu outra faixa
    if(hit){
      resolveState = null;
      t.previewUrl = hit.previewUrl;
      if(!t.imageUrl && hit.imageUrl){ t.imageUrl = hit.imageUrl; render(); }
      // mostra o que vai tocar de verdade (pode ser outra gravação equivalente)
      $('#npTitle').textContent = hit.name; $('#npArtist').textContent = hit.artist;
      toast(`Tocando a prévia de: ${hit.name} — ${hit.artist}`);
      src = audioProxy(hit.previewUrl);
    } else {
      resolveState = 'failed';
    }
  }
  if(my !== playToken) return;
  if(!src){
    audio.pause(); setIcon(false);
    toast(EMBEDDED
      ? 'Não achei uma prévia tocável para esta faixa dentro do Discord'
      : 'Esta faixa não tem prévia. Use o link "Abrir no …".');
    return;
  }
  audio.src = src;
  // se o utilizador pausou enquanto a prévia era procurada, não tocar sozinho
  if(playIntent && playIntent.token === my && playIntent.wantPlay) safePlay();
  else setIcon(false);
}
function step(d){ if(!list.length) return; play((current + d + list.length) % list.length); }

$('#toggle').onclick = ()=>{
  if(current<0){ play(0); return; }
  if(mode==='yt'){ if(yt) (yt.getPlayerState()===1 ? yt.pauseVideo() : yt.playVideo()); return; }
  // procura de prévia a decorrer para a faixa atual: o botão alterna a intenção
  if(playIntent && playIntent.token === playToken && resolveState === 'pending'){
    playIntent.wantPlay = !playIntent.wantPlay;
    setIcon(false);
    toast(playIntent.wantPlay ? 'Vai tocar assim que a prévia for encontrada' : 'Pausado — não vai tocar sozinho');
    return;
  }
  // a procura falhou: não prometer reprodução — tocar de novo na faixa volta a tentar
  if(resolveState === 'failed'){
    toast('Esta faixa não tem prévia disponível. Toca de novo no cartão para tentar outra vez, ou escolhe outra faixa.');
    return;
  }
  audio.paused ? safePlay() : audio.pause();
};
$('#prev').onclick = ()=>step(-1);
$('#next').onclick = ()=>step(1);
$('#seek').oninput = e=>{
  const pct = e.target.value/100;
  if(mode==='yt'){ if(yt && yt.getDuration) yt.seekTo(pct*yt.getDuration(), true); }
  else if(audio.duration) audio.currentTime = pct*audio.duration;
};
$('#vol').oninput = e=>{
  curVol = +e.target.value; audio.volume = curVol;
  if(yt && yt.setVolume) yt.setVolume(curVol*100);
};

/* ================= AÇÕES ================= */
async function doSearch(q){
  q = q.trim(); if(!q) return;
  view='discover'; setTabs();
  $('#title').textContent = `Resultados para “${q}”`;
  skeletons();
  try{
    list = await searchAPI(q); current=-1; setBanner(defaultBanner());
  }catch(err){
    list = DEMO.filter(t=>(t.name+t.artist).toLowerCase().includes(q.toLowerCase()));
    if(!list.length) list = DEMO; current=-1;
    setBanner('Modo demonstração: a busca da MusicAPI não respondeu. Confira as variáveis de ambiente na Vercel e os logs da função /api/search.');
  }
  render();
  document.querySelector('main').scrollIntoView({behavior:'smooth'});
}
function setTabs(){
  $('#tab-discover').setAttribute('aria-selected', view==='discover');
  $('#tab-favs').setAttribute('aria-selected', view==='favs');
}
function showFavs(){
  view='favs'; setTabs(); setBanner(defaultBanner()); current=-1;
  $('#title').textContent='Minha lista'; list = favs.slice(); render();
}
async function showHome(){
  view='discover'; setTabs(); current=-1;
  $('#title').textContent='Em destaque'; skeletons();
  try{
    const r = await fetch(`${API_BASE}/api/featured`);
    if(!r.ok) throw new Error('HTTP '+r.status);
    list = (await r.json()).results || []; setBanner(defaultBanner());
    if(!list.length) throw new Error('vazio');
  }catch(e){
    list = DEMO.slice();
    setBanner('Mostrando exemplos. Configure as variáveis da MusicAPI na Vercel para ver músicas reais.');
  }
  render();
}

$('#searchForm').addEventListener('submit',e=>{ e.preventDefault(); doSearch($('#q').value); });
$('#tab-discover').onclick = showHome;
$('#tab-favs').onclick = showFavs;
$('#grid').addEventListener('click',e=>{
  const card = e.target.closest('.card'); if(!card) return;
  const i = +card.dataset.i, act = e.target.closest('[data-act]')?.dataset.act;
  if(act==='fav'){
    const t = list[i], idx = favs.findIndex(f=>f.id===t.id);
    if(idx>-1){ favs.splice(idx,1); toast('Removida da sua lista'); } else { favs.push(t); toast('Salva na sua lista'); }
    saveFavs();
    if(view==='favs'){ list = favs.slice(); current=-1; }
    render();
  } else if(act==='play' || e.target.closest('.cover')) play(i);
});

/* ================= INICIO ================= */
const bars = $('#bars');
for(let i=0;i<56;i++){ const s=document.createElement('span'); s.style.animationDelay=(-Math.random()*1.6)+'s'; s.style.animationDuration=(1+Math.random()*1.2)+'s'; bars.appendChild(s); }
['Hatsune Miku','Vocaloid','J-Pop','Anime','Lo-fi','Eletrônica'].forEach(g=>{
  const b=document.createElement('button'); b.className='chip'; b.type='button'; b.textContent=g;
  b.onclick=()=>{ $('#q').value=g; doSearch(g); }; $('#chips').appendChild(b);
});

saveFavs(); showHome();
