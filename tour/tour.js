// Experiência virtual — Haras Rio São José
// Photo Sphere Viewer 5 (CDN, sem build). Cenas em cenas.json (geradas por scripts/preparar_tour.py).
// Cenas principais: esferas 360° vistas do alto (a maquete do Haras na geometria real da planta), giradas com o dedo.
// Toque num lote: contorno dourado na esfera + cartão com área, medidas e WhatsApp. Fotos reais do drone na galeria.
// Cenas sem "esfera" (recorte de foto) continuam suportadas, com o olhar limitado à área da foto.
import { Viewer } from '@photo-sphere-viewer/core';
import { MarkersPlugin } from '@photo-sphere-viewer/markers-plugin';

const $ = (s) => document.querySelector(s);
const RAD = Math.PI / 180;
const MOVEL = window.matchMedia('(max-width: 720px)').matches;
const MENOS_MOVIMENTO = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const el = {
  abertura: $('#abertura'), iniciar: $('#ab-iniciar'), tour: $('#tour'), viewer: $('#viewer'),
  passo: $('#cena-passo'), titulo: $('#cena-titulo'),
  cartao: $('#cartao'), cSobre: $('#cartao-sobre'), cTitulo: $('#cartao-titulo'), cTexto: $('#cartao-texto'), cSelo: $('#cartao-selo'), cFechar: $('#cartao-fechar'),
  ponto: $('#ponto'), pFoto: $('#ponto-foto'), pTitulo: $('#ponto-titulo'), pTexto: $('#ponto-texto'), pIr: $('#ponto-ir'), pFechar: $('#ponto-fechar'),
  ant: $('#bt-ant'), prox: $('#bt-prox'), info: $('#bt-info'), passeio: $('#bt-passeio'), cheia: $('#bt-cheia'),
  minis: $('#miniaturas'), carregando: $('#carregando'), giro: $('#bt-giro'), dica: $('#dica-arraste'), dicaTexto: $('#dica-texto'),
  pExtra: $('#ponto-extra'), fotos: $('#bt-fotos'),
};

const ICONE_INFO = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 10.5v6.5M12 7v.6" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>';

const ICONE_IR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICONE_FOTO = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="13" rx="2.5" fill="none" stroke="currentColor" stroke-width="2.2"/><circle cx="12" cy="12.5" r="3.4" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M8 6l1.5-2h5L16 6" fill="none" stroke="currentColor" stroke-width="2.2"/></svg>';
const WHATS = '5511991468192';
let dados = null, viewer = null, markers = null, atual = -1, trocando = false;
const passeio = { ativo: false, dir: 1, t: 0, parado: 0, raf: 0 };
let lotesDados = null, loteSel = null;

// ---------------------------------------------------------------- utilidades
const norm = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const clamp = (v, a, b) => (a > b ? (a + b) / 2 : Math.min(b, Math.max(a, v)));
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function cenaDoHash() {
  const id = decodeURIComponent(location.hash.replace('#', ''));
  const i = dados.cenas.findIndex((c) => c.id === id);
  return i >= 0 ? i : 0;
}

// ---------------------------------------------------------------- limites do olhar (fotos parciais)
function limites() {
  const c = dados.cenas[atual];
  if (!c || c.esfera || !viewer) return null;
  return c.limites;
}
function ajustarFovMaximo() {
  const L = limites();
  if (!L) { viewer.setOptions({ maxFov: 120, minFov: 12 }); return; }
  const altura = L.pitchMax - L.pitchMin, largura = L.yawMax - L.yawMin;
  const porLargura = viewer.dataHelper.hFovToVFov(largura);
  const maxV = Math.max(20, Math.min(altura, porLargura) * 0.98);
  const z = viewer.getZoomLevel();
  viewer.setOptions({ maxFov: maxV, minFov: Math.min(24, maxV * 0.6) });
  // o PSV só recalcula o campo de visão quando o nível de zoom muda
  viewer.zoom(z > 0.5 ? z - 0.5 : z + 0.5); viewer.zoom(z);
}
let corrigindo = false;
function prender() {
  const L = limites();
  if (!L || corrigindo) return;
  const pos = viewer.getPosition();
  const hH = viewer.state.hFov / 2, hV = viewer.state.vFov / 2;
  const yaw = norm(pos.yaw) / RAD, pitch = pos.pitch / RAD;
  const y2 = clamp(yaw, L.yawMin + hH, L.yawMax - hH);
  const p2 = clamp(pitch, L.pitchMin + hV, L.pitchMax - hV);
  if (Math.abs(y2 - yaw) > 0.01 || Math.abs(p2 - pitch) > 0.01) {
    corrigindo = true;
    viewer.rotate({ yaw: y2 * RAD, pitch: p2 * RAD });
    corrigindo = false;
  }
}

// ---------------------------------------------------------------- passeio automático
function lacoPasseio(t) {
  passeio.raf = requestAnimationFrame(lacoPasseio);
  if (!passeio.ativo || trocando || !viewer || document.hidden) { passeio.t = t; return; }
  const dt = Math.min(0.05, (t - (passeio.t || t)) / 1000); passeio.t = t;
  if (t < passeio.parado) return;
  const c = dados.cenas[atual];
  const pos = viewer.getPosition();
  const vel = 2.2 * RAD; // graus por segundo
  if (c.esfera) { viewer.rotate({ yaw: pos.yaw + vel * 1.4 * dt, pitch: pos.pitch }); return; }
  const L = c.limites, hH = viewer.state.hFov / 2;
  const min = (L.yawMin + hH) * RAD, max = (L.yawMax - hH) * RAD;
  let yaw = norm(pos.yaw) + passeio.dir * vel * dt;
  if (max - min < 2 * RAD) {
    // foto quase do tamanho da tela: não há para onde girar; fica ~10 s e segue
    passeio.fim = (passeio.fim || 0) + dt;
    if (passeio.fim > 10) irPara((atual + 1) % dados.cenas.length);
    return;
  }
  if (yaw >= max) { yaw = max; passeio.dir = -1; passeio.voltas = (passeio.voltas || 0) + 1; }
  if (yaw <= min) { yaw = min; passeio.dir = 1; passeio.voltas = (passeio.voltas || 0) + 1; }
  corrigindo = true; viewer.rotate({ yaw, pitch: pos.pitch }); corrigindo = false;
  // depois de ida e volta (ou ~14 s numa cena estreita), segue para a próxima cena
  if ((passeio.voltas || 0) >= 2) irPara((atual + 1) % dados.cenas.length);
}
function definirPasseio(sim) {
  passeio.ativo = sim;
  el.passeio.setAttribute('aria-pressed', String(sim));
  el.passeio.title = sim ? 'Pausar o passeio automático' : 'Passeio automático';
}
function interagiu() { if (passeio.ativo) definirPasseio(false); esconderDica(); }

// ---------------------------------------------------------------- dica de arrastar (primeira visita)
let dicaT = 0;
function mostrarDica() {
  let vista = false; try { vista = localStorage.getItem('haras-tour-dica') === '1'; } catch (_) {}
  if (vista || MENOS_MOVIMENTO) return;
  const emPe = window.innerHeight > window.innerWidth;
  const cn = dados.cenas[atual];
  el.dicaTexto.textContent = cn && cn.esfera
    ? (MOVEL ? 'Gire com o dedo para olhar em volta. Toque num lote verde para ver área e medidas.' : 'Arraste para girar em 360°. Clique num lote verde para ver área e medidas.')
    : (MOVEL ? (emPe ? 'Arraste para olhar em volta. Deite o celular para ver mais, ou use o botão do celular e mova o aparelho.' : 'Arraste para olhar em volta, ou use o botão do celular e mova o aparelho.') : 'Arraste para olhar em volta');
  el.dica.classList.add('is-visivel');
  dicaT = setTimeout(esconderDica, 7000);
}
function esconderDica() {
  if (!el.dica.classList.contains('is-visivel')) return;
  clearTimeout(dicaT); el.dica.classList.remove('is-visivel');
  try { localStorage.setItem('haras-tour-dica', '1'); } catch (_) {}
}

// ---------------------------------------------------------------- mover o celular (giroscópio), sem sair da foto
const giro = { ativo: false, ref: null };
function anguloTela() { return (screen.orientation && screen.orientation.angle) || window.orientation || 0; }
function aoOrientar(e) {
  if (!giro.ativo || !viewer || trocando || e.alpha == null) return;
  const ang = anguloTela();
  const incl = ang === 90 ? -e.gamma : ang === -90 || ang === 270 ? e.gamma : e.beta;   // inclinar para frente/trás
  if (!giro.ref) { const p = viewer.getPosition(); giro.ref = { a: e.alpha, i: incl, yaw: p.yaw, pitch: p.pitch }; return; }
  let da = e.alpha - giro.ref.a; while (da > 180) da -= 360; while (da < -180) da += 360;
  const alvo = { yaw: giro.ref.yaw - da * RAD, pitch: giro.ref.pitch + (incl - giro.ref.i) * RAD };
  viewer.rotate(alvo);
  prender();
  // bateu na borda da foto: reancora, para voltar a mexer assim que o celular volta
  const p = viewer.getPosition();
  if (Math.abs(norm(p.yaw - alvo.yaw)) > 0.002 || Math.abs(p.pitch - alvo.pitch) > 0.002) giro.ref = { a: e.alpha, i: incl, yaw: p.yaw, pitch: p.pitch };
}
async function alternarGiro() {
  if (!giro.ativo) {
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        const r = await DeviceOrientationEvent.requestPermission();   // iPhone pede autorização
        if (r !== 'granted') return;
      }
    } catch (_) { return; }
    interagiu();
    giro.ativo = true; giro.ref = null;
    window.addEventListener('deviceorientation', aoOrientar);
  } else {
    giro.ativo = false;
    window.removeEventListener('deviceorientation', aoOrientar);
  }
  el.giro.setAttribute('aria-pressed', String(giro.ativo));
}

// ---------------------------------------------------------------- cenas
function marcadores(c) {
  return (c.pontos || []).map((p) => {
    const pos = { yaw: p.yaw * RAD, pitch: p.pitch * RAD };
    if (p.tipo === 'gleba') return { id: p.id, position: pos, html: `<span class="hs-gleba">${esc(p.titulo.replace('Gleba ', ''))}</span>`, anchor: 'center center', data: p };
    const ic = p.tipo === 'cena' ? ICONE_IR : p.foto ? ICONE_FOTO : ICONE_INFO;
    const rot = p.tipo === 'cena' ? `Ir: ${p.titulo}` : p.titulo;
    return {
      id: p.id, position: pos, anchor: 'center left', data: p,
      html: `<span class="hs${p.tipo === 'cena' ? ' hs--ir' : ''}" role="button" tabindex="0" aria-label="${esc(rot)}"><span class="hs__alvo">${ic}</span><span class="hs__rot">${esc(rot)}</span></span>`,
    };
  });
}

// ---------------------------------------------------------------- toque num lote (esferas 360°)
async function carregarLotes() {
  if (lotesDados) return lotesDados;
  const r = await fetch('../data/lotes.json', { cache: 'no-cache' });
  lotesDados = (await r.json()).lotes; return lotesDados;
}
function dentro(P, x, z) {
  let d = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [xi, zi] = P[i], [xj, zj] = P[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) d = !d;
  }
  return d;
}
function chaoDe(cam, yaw, pitch) {           // (yaw, pitch) da esfera → ponto do chão em metros da planta
  if (pitch >= -0.002) return null;
  const t = cam.alt / -Math.sin(pitch);
  return [cam.x + Math.cos(pitch) * Math.sin(yaw) * t, cam.z - Math.cos(pitch) * Math.cos(yaw) * t];
}
function naEsfera(cam, x, z) {                // ponto do chão → [yaw, pitch] da esfera, em radianos
  const dx = x - cam.x, dz = z - cam.z;
  return [Math.atan2(dx, -dz), Math.atan2(-cam.alt, Math.hypot(dx, dz))];
}
const fmt = (n, d = 2) => Number(n).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
const SITUACAO = { disponivel: ['Disponível', 'sit--disp'], vendido: ['Vendido', 'sit--vend'], reservado: ['Reservado', 'sit--res'], reserva_tecnica: ['Reservado', 'sit--res'] };
async function tocarLote(yaw, pitch) {
  const c = dados.cenas[atual];
  if (!c || !c.esfera || !c.camera) return false;
  const q = chaoDe(c.camera, yaw, pitch); if (!q) return false;
  const lotes = await carregarLotes();
  const l = lotes.find((k) => dentro(k.poly, q[0], q[1]));
  if (!l) return false;
  interagiu();
  try { markers.removeMarker('lote-sel'); } catch (_) {}
  try {
    markers.addMarker({ id: 'lote-sel', polygon: l.poly.map(([x, z]) => naEsfera(c.camera, x, z)),
      svgStyle: { fill: 'rgba(230,207,156,.38)', stroke: '#E6CF9C', strokeWidth: '3px' }, data: { tipo: 'lote' } });
  } catch (e) { console.warn('[tour] contorno do lote', e); }
  loteSel = l;
  const [sit, cls] = SITUACAO[l.status] || SITUACAO.reservado;
  el.pFoto.hidden = true; el.pIr.hidden = true;
  el.pTitulo.textContent = `Lote ${Number(l.id)} · Gleba ${Number(l.gleba)}`;
  el.pTexto.innerHTML = `<span class="sit ${cls}">${sit}</span>`;
  const med = [['Área', l.area ? `${fmt(l.area)} m²` : '—'], ['Frente', l.frente ? `${fmt(l.frente)} m` : '—'], ['Fundo', l.fundo ? `${fmt(l.fundo)} m` : '—'],
    ['Lateral esq.', l.esq ? `${fmt(l.esq)} m` : '—'], ['Lateral dir.', l.dir ? `${fmt(l.dir)} m` : '—']];
  const msg = encodeURIComponent(`Olá! Vi o lote ${Number(l.id)} (gleba ${Number(l.gleba)}) no passeio virtual do Haras Rio São José e quero saber mais.`);
  el.pExtra.innerHTML = `<dl class="medidas">${med.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
    <div class="ponto__acoes">
      ${l.status === 'disponivel' ? `<a class="bt bt--whats" href="https://wa.me/${WHATS}?text=${msg}" target="_blank" rel="noopener">Quero este lote</a>` : ''}
      <a class="bt bt--verde" href="../?lote=${encodeURIComponent(l.id)}#mapa">Ver no mapa</a>
    </div>
    <p class="ponto__nota">Medidas conforme memorial descritivo. Disponibilidade sujeita a confirmação.</p>`;
  el.pExtra.hidden = false;
  el.ponto.hidden = false;
  if (MOVEL) cartaoAberto(false);
  return true;
}

function mostrarCena(c, i) {
  const n = dados.cenas.length;
  el.passo.textContent = `${c.sobre} · ${i + 1} de ${n}`;
  el.titulo.textContent = c.titulo;
  el.cSobre.textContent = c.sobre;
  el.cTitulo.textContent = c.titulo;
  el.cTexto.textContent = c.texto;
  el.cSelo.hidden = !!c.esfera;
  el.cSelo.textContent = c.esfera ? '' : 'Foto real de drone · arraste para olhar em volta';
  document.title = `${c.titulo} — Experiência virtual Haras Rio São José`;
  el.minis.querySelectorAll('.mini[data-i]').forEach((b) => {
    const ativa = Number(b.dataset.i) === i;
    b.classList.toggle('is-ativa', ativa);
    b.setAttribute('aria-current', ativa ? 'true' : 'false');
    if (ativa) b.scrollIntoView({ block: 'nearest', inline: 'center', behavior: MENOS_MOVIMENTO ? 'auto' : 'smooth' });
  });
  fecharPonto();
  history.replaceState(null, '', `#${c.id}`);
}

async function irPara(i, primeira = false) {
  if (!dados || trocando || (i === atual && !primeira)) return;
  const c = dados.cenas[i];
  trocando = true; passeio.voltas = 0; passeio.fim = 0; passeio.dir = 1; giro.ref = null;
  el.carregando.classList.add('is-ativo');
  atual = i;
  mostrarCena(c, i);
  const inicio = posInicial(c);
  try {
    markers.clearMarkers();
    // já entra com o campo de visão que cabe na foto nova (sem "pular" depois da transição)
    ajustarFovMaximo();
    if (!primeira) await viewer.setPanorama(c.imagem, {
      panoData: c.esfera ? undefined : c.pano,
      position: inicio, zoom: 0, showLoader: false,
      transition: MENOS_MOVIMENTO ? false : { speed: 1100, rotation: false, effect: 'fade' },
    });
    ajustarFovMaximo();
    viewer.zoom(zoomInicial(c));
    if (primeira || c.inicio?.pitch <= -80) viewer.rotate(inicio);
    // no computador o cartão da cena fecha sozinho depois de alguns segundos (não cobre o mapa)
    clearTimeout(irPara.tCartao);
    if (!MOVEL) irPara.tCartao = setTimeout(() => cartaoAberto(false), 9000);
    // começa pelo lado esquerdo da foto, para o passeio correr até a direita
    if (!c.esfera && passeio.ativo) {
      const L = c.limites; const hH = viewer.state.hFov / 2;
      viewer.rotate({ yaw: (L.yawMin + hH) * RAD, pitch: inicio.pitch });
    }
    prender();
    markers.setMarkers(marcadores(c));
    precarregar(i + 1);
  } catch (e) {
    console.error('[tour] falha ao abrir a cena', c.id, e);
  } finally {
    trocando = false;
    el.carregando.classList.remove('is-ativo');
    passeio.parado = performance.now() + 1200;
  }
}

// vista de cima (olhando para baixo): com o celular em pé a faixa do Haras fica na vertical (portaria embaixo);
// com a tela deitada, na horizontal (portaria à esquerda)
function posInicial(c) {
  const p = c.inicio?.pitch || 0;
  if (p <= -80) return { yaw: (innerHeight > innerWidth ? 90 : 0) * RAD, pitch: p * RAD };
  return { yaw: (c.inicio?.yaw || 0) * RAD, pitch: p * RAD };
}
// zoom de abertura da vista de cima: o Haras (≈3,6 km de ponta a ponta) ocupa ~90% do lado maior da tela
function zoomInicial(c) {
  if (!c || !c.camera || (c.inicio?.pitch || 0) > -80) return 0;
  const emPe = innerHeight > innerWidth;
  const cheio = (2 * Math.atan((emPe ? 2250 : 1900) / c.camera.alt)) / RAD;   // comprimento do Haras + margem (em pé, sobra para as barras)
  const vFov = emPe ? cheio : viewer.dataHelper.hFovToVFov(cheio);
  const { maxFov, minFov } = viewer.config;
  const f = Math.min(maxFov, Math.max(minFov, vFov));
  return Math.max(0, Math.min(100, ((maxFov - f) / (maxFov - minFov)) * 100));
}
function verTudo() {
  const c = dados.cenas[atual]; if (!c) return;
  interagiu();
  viewer.animate({ ...posInicial(c), zoom: zoomInicial(c), speed: '8rpm' }).catch?.(() => {});
}

function precarregar(i) {
  const c = dados.cenas[i % dados.cenas.length];
  if (c) { const im = new Image(); im.decoding = 'async'; im.src = c.imagem; }
}

// ---------------------------------------------------------------- ponto de interesse
function abrirPonto(p) {
  if (!p || p.tipo === 'gleba' || p.tipo === 'lote') return;
  if (p.tipo === 'cena') { interagiu(); irPara(dados.cenas.findIndex((c) => c.id === p.cena)); return; }
  interagiu();
  el.pExtra.hidden = true; el.pExtra.innerHTML = '';
  el.pTitulo.textContent = p.titulo;
  el.pTexto.textContent = p.texto;
  el.pFoto.hidden = !p.foto;
  if (p.foto) { el.pFoto.src = p.foto; el.pFoto.alt = p.titulo; }
  el.pIr.hidden = !p.cena;
  el.pIr.textContent = 'Ver desta vista em 360°';
  el.pIr.onclick = p.cena ? () => irPara(dados.cenas.findIndex((c) => c.id === p.cena)) : null;
  el.ponto.hidden = false;
  if (MOVEL) cartaoAberto(false);
}
function fecharPonto() { el.ponto.hidden = true; if (loteSel) { loteSel = null; try { markers.removeMarker('lote-sel'); } catch (_) {} } }

// ---------------------------------------------------------------- galeria de fotos reais do drone
function abrirFotos() {
  const fs = dados.fotos || []; if (!fs.length) return;
  interagiu();
  const caixa = document.createElement('section');
  caixa.className = 'galeria'; caixa.setAttribute('aria-label', 'Fotos reais do drone');
  caixa.innerHTML = `<header class="galeria__topo"><div><p>Fotos reais · drone · set/2026</p><h3>O Haras hoje</h3></div>
      <button class="ic" type="button" aria-label="Fechar as fotos"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg></button></header>
    <div class="galeria__faixa">${fs.map((f) => `<figure><img src="${esc(f.imagem)}" alt="${esc(f.titulo)}" loading="lazy" decoding="async"><figcaption><b>${esc(f.titulo)}</b><span>${esc(f.texto)}</span></figcaption></figure>`).join('')}</div>`;
  document.body.appendChild(caixa);
  const fechar = () => { caixa.remove(); document.removeEventListener('keydown', tecla); };
  const tecla = (e) => { if (e.key === 'Escape') fechar(); };
  caixa.querySelector('.galeria__topo .ic').addEventListener('click', fechar);
  document.addEventListener('keydown', tecla);
}
function cartaoAberto(sim) {
  el.cartao.classList.toggle('is-fechado', !sim);
  el.info.setAttribute('aria-pressed', String(sim));
}

// ---------------------------------------------------------------- som ambiente (pássaros, água, música suave)
// Arquivo gerado por scripts/gerar_som_ambiente.py: laço perfeito de 96 s entre 0,5 s e 96,5 s.
const SOM = { url: 'audio/ambiente.mp3?v=1', inicio: 0.5, fim: 96.5, volume: 0.6 };
const som = { ctx: null, ganho: null, fonte: null, buffer: null, carregando: null, ligado: true, voo: false };
try { if (localStorage.getItem('haras-tour-som') === 'off') som.ligado = false; } catch (_) {}

function volumeSom(seg = 1.5) {
  if (!som.ctx || !som.ganho) return;
  const alvo = som.ligado && !som.voo && !document.hidden ? SOM.volume : 0;
  const g = som.ganho.gain, t = som.ctx.currentTime;
  g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(alvo, t + seg);
}

// precisa ser chamado dentro de um toque/clique (regra dos navegadores para tocar som)
async function ligarSom() {
  if (!som.ctx) {
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (_) {}  // iPhone: toca mesmo no modo silencioso
    som.ctx = new AC();
    som.ganho = som.ctx.createGain(); som.ganho.gain.value = 0; som.ganho.connect(som.ctx.destination);
  }
  if (som.ctx.state !== 'running') som.ctx.resume().catch(() => {});
  if (!som.carregando) {
    som.carregando = fetch(SOM.url).then((r) => r.arrayBuffer())
      .then((b) => new Promise((ok, erro) => som.ctx.decodeAudioData(b, ok, erro)))
      .then((buf) => { som.buffer = buf; });
  }
  try { await som.carregando; } catch (e) { console.warn('[tour] som ambiente não carregou', e); som.carregando = null; return; }
  if (!som.fonte) {
    const f = som.ctx.createBufferSource();
    f.buffer = som.buffer; f.loop = true; f.loopStart = SOM.inicio; f.loopEnd = SOM.fim;
    f.connect(som.ganho); f.start(0, SOM.inicio); som.fonte = f;
  }
  volumeSom(3);
}

function alternarSom() {
  som.ligado = !som.ligado;
  try { localStorage.setItem('haras-tour-som', som.ligado ? 'on' : 'off'); } catch (_) {}
  botaoSom();
  if (som.ligado) ligarSom(); else volumeSom(0.6);
}

function botaoSom() {
  const b = $('#bt-som'); if (!b) return;
  b.setAttribute('aria-pressed', String(som.ligado));
  b.setAttribute('aria-label', som.ligado ? 'Desligar o som ambiente' : 'Ligar o som ambiente');
}

// o voo tem som próprio: o ambiente abaixa enquanto ele toca
function somDoVoo(ativo) { som.voo = ativo; volumeSom(ativo ? 0.6 : 2); }

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && som.fonte && som.ctx.state !== 'running') som.ctx.resume().catch(() => {});
  volumeSom(document.hidden ? 0.3 : 1.5);
});

// ---------------------------------------------------------------- voo guiado (vídeo com capítulos)
function abrirVoo() {
  const v = dados.voo; if (!v) return;
  interagiu();
  const caixa = document.createElement('section');
  caixa.className = 'voo'; caixa.setAttribute('aria-label', 'Voo guiado pelo Haras');
  caixa.innerHTML = `
    <video class="voo__video" playsinline controls autoplay preload="auto" poster="${esc(v.capa || '')}">
      <source src="${esc(MOVEL && v.video_movel ? v.video_movel : v.video)}" type="video/mp4">
    </video>
    <div class="voo__legenda" aria-live="polite"><b></b><small></small></div>
    <nav class="voo__capitulos" aria-label="Capítulos do voo"></nav>
    <button class="ic voo__fechar" type="button" aria-label="Fechar o voo">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>
    </button>`;
  document.body.appendChild(caixa);
  // no celular o voo abre em tela cheia e deitado (Android; no iPhone o próprio player assume)
  if (MOVEL && caixa.requestFullscreen) {
    caixa.requestFullscreen({ navigationUI: 'hide' }).then(() => screen.orientation?.lock?.('landscape')).catch(() => {});
  }
  const video = caixa.querySelector('video'), leg = caixa.querySelector('.voo__legenda'), nav = caixa.querySelector('.voo__capitulos');
  const caps = v.capitulos.map((c, i) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'cap'; b.textContent = c.titulo;
    b.addEventListener('click', () => { video.currentTime = c.t + 0.05; video.play().catch(() => {}); });
    nav.appendChild(b); return b;
  });
  let ativo = -1;
  const atualizar = () => {
    let k = 0; for (let i = 0; i < v.capitulos.length; i++) if (video.currentTime >= v.capitulos[i].t) k = i;
    if (k === ativo) return; ativo = k;
    const c = v.capitulos[k];
    leg.querySelector('b').textContent = c.titulo; leg.querySelector('small').textContent = c.texto || '';
    caps.forEach((b, i) => b.classList.toggle('is-ativo', i === k));
    caps[k].scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  };
  video.addEventListener('timeupdate', atualizar); atualizar();
  somDoVoo(true);
  const fechar = () => {
    somDoVoo(false);
    video.pause(); caixa.remove(); document.removeEventListener('keydown', tecla);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    try { screen.orientation?.unlock?.(); } catch (_) {}
  };
  const tecla = (e) => { if (e.key === 'Escape') fechar(); };
  caixa.querySelector('.voo__fechar').addEventListener('click', fechar);
  video.addEventListener('ended', fechar);
  document.addEventListener('keydown', tecla);
}

// ---------------------------------------------------------------- interface
function montarMiniaturas() {
  if (dados.voo) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'mini mini--voo';
    b.innerHTML = `<img src="${esc(dados.voo.capa)}" alt="" decoding="async"><span>Voo pelo Haras</span>`;
    b.addEventListener('click', abrirVoo); el.minis.appendChild(b);
  }
  dados.cenas.forEach((c, i) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'mini'; b.dataset.i = i;
    b.innerHTML = `<img src="${esc(c.mini)}" alt="" decoding="async"><span>${esc(c.titulo)}</span>`;
    b.setAttribute('aria-label', `Ir para: ${c.titulo}`);
    b.addEventListener('click', () => { interagiu(); irPara(i); });
    el.minis.appendChild(b);
  });
}

function ligarEventos() {
  el.ant.addEventListener('click', () => { interagiu(); irPara((atual - 1 + dados.cenas.length) % dados.cenas.length); });
  el.prox.addEventListener('click', () => { interagiu(); irPara((atual + 1) % dados.cenas.length); });
  el.info.addEventListener('click', () => { cartaoAberto(el.cartao.classList.contains('is-fechado')); if (MOVEL) fecharPonto(); });
  el.cFechar.addEventListener('click', () => cartaoAberto(false));
  el.pFechar.addEventListener('click', fecharPonto);
  el.giro.hidden = !(MOVEL && 'DeviceOrientationEvent' in window);
  el.fotos.addEventListener('click', abrirFotos);
  $('#bt-som').addEventListener('click', alternarSom);
  $('#zoom-mais').addEventListener('click', () => { interagiu(); viewer.animate({ zoom: Math.min(100, viewer.getZoomLevel() + 20), speed: 600 }).catch?.(() => {}); });
  $('#zoom-menos').addEventListener('click', () => { interagiu(); viewer.animate({ zoom: Math.max(0, viewer.getZoomLevel() - 20), speed: 600 }).catch?.(() => {}); });
  $('#ver-tudo').addEventListener('click', verTudo);
  el.giro.addEventListener('click', alternarGiro);
  el.passeio.addEventListener('click', () => { definirPasseio(!passeio.ativo); passeio.parado = 0; });
  el.cheia.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else (document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }) || Promise.resolve()).catch(() => {});
  });
  // qualquer toque/arraste no viewer pausa o passeio
  el.viewer.addEventListener('pointerdown', interagiu, { passive: true });
  el.viewer.addEventListener('wheel', interagiu, { passive: true });
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea')) return;
    if (e.key === 'ArrowRight' && e.altKey) { interagiu(); irPara((atual + 1) % dados.cenas.length); }
    if (e.key === 'ArrowLeft' && e.altKey) { interagiu(); irPara((atual - 1 + dados.cenas.length) % dados.cenas.length); }
    if (e.key === 'Escape') fecharPonto();
  });
  window.addEventListener('hashchange', () => irPara(cenaDoHash()));
  cartaoAberto(!MOVEL);
}

async function iniciarTour() {
  if (som.ligado) ligarSom();
  el.abertura.classList.add('is-saindo');
  el.tour.hidden = false;
  setTimeout(() => { const v = $('#ab-video'); if (v) v.pause(); el.abertura.hidden = true; }, 750);
  if (viewer) return;
  const c0 = dados.cenas[cenaDoHash()];
  viewer = new Viewer({
    container: el.viewer,
    panorama: c0.imagem, panoData: c0.esfera ? undefined : c0.pano,
    defaultYaw: posInicial(c0).yaw, defaultPitch: posInicial(c0).pitch,
    navbar: false,
    loadingTxt: '', loadingImg: null,
    defaultZoomLvl: 0, maxFov: 120, minFov: 12, zoomSpeed: 1.6,
    mousewheelCtrlKey: false, touchmoveTwoFingers: false, moveInertia: true,
    plugins: [[MarkersPlugin, { markers: [] }]],
  });
  markers = viewer.getPlugin(MarkersPlugin);
  window.__tour = { viewer, markers, tocarLote, som, get cena() { return dados.cenas[atual]; } };
  markers.addEventListener('select-marker', ({ marker }) => abrirPonto(marker.data));
  // toque/clique fora dos marcadores: se cair num lote (esferas 360°), abre o lote
  viewer.addEventListener('click', ({ data }) => { if (!data.rightclick) tocarLote(data.yaw, data.pitch); });
  carregarLotes().catch(() => {});
  viewer.addEventListener('position-updated', prender);
  viewer.addEventListener('zoom-updated', prender);
  viewer.addEventListener('size-updated', () => { ajustarFovMaximo(); prender(); });
  viewer.addEventListener('ready', () => { irPara(dados.cenas.indexOf(c0), true); setTimeout(mostrarDica, 900); passeio.raf = requestAnimationFrame(lacoPasseio); }, { once: true });
  definirPasseio(passeio.ativo);
}

async function carregar() {
  const r = await fetch('cenas.json?v=4', { cache: 'no-cache' });
  dados = await r.json();
  montarMiniaturas();
  ligarEventos();
  el.iniciar.addEventListener('click', iniciarTour);
  botaoSom();
  // link direto pula a abertura (sem toque): o som começa no primeiro toque na tela
  const primeiroToque = () => { if (som.ligado && !som.fonte) ligarSom(); };
  document.addEventListener('click', primeiroToque, { once: true });
  document.addEventListener('touchend', primeiroToque, { once: true });
  if (location.hash.length > 1) iniciarTour();   // link direto para uma cena pula a abertura
}

carregar().catch((e) => {
  console.error('[tour] não carregou', e);
  el.abertura.querySelector('.abertura__dica').textContent = 'Não foi possível carregar a experiência. Atualize a página.';
});
