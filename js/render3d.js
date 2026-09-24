/* =====================================================================
   Haras Rio São José — render3d.js
   Gera as IMAGENS 3D ("Como vai ficar") e a PLANTA HUMANIZADA (mapa-guia)
   a partir da mesma cena do mapa interativo (js/cena3d.js).
   Uso local: python scripts/servidor_render.py 8766 → http://localhost:8766/render.html
   Cada imagem é renderizada em tamanho maior e reduzida (antisserrilhado),
   com sombras reais nas vistas de perto, e enviada ao servidor local.
   ===================================================================== */
import * as THREE from 'three';
import { construirCena, centroide, enquadrarPontos } from './cena3d.js?v=20260924c';

const $ = (s) => document.querySelector(s);
const log = (t) => { $('#log').textContent += t + '\n'; };

const dados = await (await fetch('data/lotes.json', { cache: 'no-store' })).json();
const cena = construirCena(dados, { qualidade: 'render', semStatus: true });
const { scene } = cena;
const itens = Object.fromEntries((dados.decor.lazer || []).map((it) => [it.id, it.c]));
const entrada = dados.meta.entrada;

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.98;
$('#palco').appendChild(renderer.domElement);

// reflexos do céu
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  const ceu = new THREE.Scene();
  const g = new THREE.SphereGeometry(10, 24, 12); const cols = [];
  const topo = new THREE.Color('#6FA6DC'), horiz = new THREE.Color('#EAE7DA'), chao = new THREE.Color('#8C8A5E');
  for (let i = 0; i < g.attributes.position.count; i++) {
    const h = g.attributes.position.getY(i) / 10;
    const c = h >= 0 ? horiz.clone().lerp(topo, Math.min(1, h * 1.4)) : horiz.clone().lerp(chao, Math.min(1, -h * 3));
    cols.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  ceu.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  scene.environment = pmrem.fromScene(ceu, 0.02).texture;
  cena.definirModo('entorno', renderer); // imagens de "Como vai ficar": paisagem com céu e morros
}

const camera = new THREE.PerspectiveCamera(38, 16 / 9, 1, 90000);
const esf = new THREE.Spherical();
function posicionar(alvo, dist, polar, azim) {
  esf.set(dist, polar, azim);
  camera.position.setFromSpherical(esf).add(alvo);
  camera.lookAt(alvo);
  camera.updateMatrixWorld(); camera.updateProjectionMatrix();
}

const enquadrar = (pts, polar, azim, m) => enquadrarPontos(camera, pts, polar, azim, m);

const V = (x, z) => new THREE.Vector3(x, 0, z);
const meio = (a, b) => V((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
const direcao = (de, para) => Math.atan2(para[0] - de[0], para[1] - de[1]); // azimute da câmera olhando de "para" até "de"

// ---------------------------------------------------------------- Vistas
// azim = direção (a partir do alvo) em que fica a câmera: 0 = sul, -π/2 = oeste, π/2 = leste, π = norte
const PRESETS = [
  { nome: '3d-vista-geral', titulo: 'Vista geral do chacreamento', w: 1920, h: 1080,
    cam: () => enquadrar(cena.polyImovel, 1.26, -0.72, { x: 0.01, topo: 0.3, base: 0.03 }) },
  { nome: '3d-portaria', titulo: 'Portaria e guarita', w: 1920, h: 1080, sombras: 110,
    cam: () => ({ alvo: V(entrada[0] + 4, entrada[1]), dist: 58, polar: 1.3, azim: -2.07 }) },
  { nome: '3d-salao-piscina', titulo: 'Salão de festas e piscina', w: 1920, h: 1080, sombras: 110,
    cam: () => ({ alvo: meio(itens.salao, itens.piscina), dist: 70, polar: 1.1, azim: direcao(itens.salao, itens.piscina) - 1.45 }) }, // de lado: salão e piscina no mesmo quadro
  { nome: '3d-quiosques-quadra', titulo: 'Quiosques, quadra de areia e fazendinha', w: 1920, h: 1080, sombras: 130,
    cam: () => ({ alvo: V(128, 836), dist: 105, polar: 1.12, azim: 0.35 }) },
  { nome: '3d-baias-redondel', titulo: 'Baias e redondel', w: 1920, h: 1080, sombras: 90,
    cam: () => ({ alvo: V(itens.baias[0] + 2, itens.baias[1] + 4), dist: 62, polar: 1.16, azim: 0.55 }) },
  { nome: '3d-avenida', titulo: 'Avenida Pau Ferro, rede elétrica e lotes demarcados', w: 1920, h: 1080, sombras: 260,
    cam: () => ({ alvo: V(1150, 132), dist: 190, polar: 1.3, azim: -1.62 }) },
  { nome: '3d-lago', titulo: 'Lago natural e área verde', w: 1920, h: 1080, sombras: 160,
    cam: () => { const c = centroide(dados.areas.find((a) => a.tipo === 'lago').poly); return { alvo: V(c[0] + 10, c[1] - 10), dist: 150, polar: 1.18, azim: 2.5 }; } },
  { nome: '3d-reserva', titulo: 'Área de preservação ambiental', w: 1920, h: 1080,
    cam: () => ({ alvo: V(2700, 470), dist: 1050, polar: 1.18, azim: -1.25 }) },
];

// ---------------------------------------------------------------- Render de uma vista
async function renderizar(pr, { escala = 2, previa = false } = {}) {
  const W = previa ? Math.round(pr.w / 2) : pr.w * escala, H = previa ? Math.round(pr.h / 2) : pr.h * escala;
  renderer.setSize(W, H, false);
  camera.aspect = pr.w / pr.h; camera.fov = pr.fov || 38; camera.updateProjectionMatrix();
  const v = pr.cam();
  posicionar(v.alvo, v.dist, v.polar, v.azim);
  // clareira: tira as árvores do caminho entre a câmera e o assunto (só nas vistas de perto)
  cena.fecharClareira();
  if (v.dist < 700) {
    const a = [camera.position.x, camera.position.z], t = [v.alvo.x, v.alvo.z];
    cena.clareira(a, [a[0] + (t[0] - a[0]) * 0.7, a[1] + (t[1] - a[1]) * 0.7], Math.min(34, Math.max(12, v.dist * 0.22)));
  }
  if (scene.fog) { scene.fog.near = Math.max(900, v.dist * 1.6); scene.fog.far = Math.max(7000, v.dist * 7); }
  cena.ligarSombrasReais(renderer, !!pr.sombras && !previa, v.alvo, pr.sombras || 200);
  cena.sombrasBlob.visible = !(pr.sombras && !previa);
  renderer.compile(scene, camera);
  renderer.render(scene, camera);           // quadro de aquecimento (o 1º após carregar ou trocar sombras pode sair preto)
  await new Promise((ok) => setTimeout(ok, 30));
  renderer.render(scene, camera);
  await new Promise((ok) => setTimeout(ok, 0)); // não usa requestAnimationFrame: ele para com a aba oculta
  return { canvas: renderer.domElement, W, H, v };
}

function reduzir(src, w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, w, h);
  return c;
}

function tarja(c, texto) {
  const g = c.getContext('2d');
  const s = c.width / 1920;
  g.font = `600 ${Math.round(22 * s)}px Inter, system-ui, sans-serif`;
  const tw = g.measureText(texto).width;
  const pad = 14 * s, hh = 40 * s;
  g.fillStyle = 'rgba(24,56,39,.78)';
  g.beginPath(); g.roundRect(24 * s, c.height - hh - 24 * s, tw + pad * 2, hh, 8 * s); g.fill();
  g.fillStyle = '#FDFAF2'; g.textBaseline = 'middle';
  g.fillText(texto, 24 * s + pad, c.height - 24 * s - hh / 2 + 1);
}

async function salvar(canvas, nome, pasta = 'fotos', tipo = 'image/jpeg', q = 0.9) {
  const blob = await new Promise((ok) => canvas.toBlob(ok, tipo, q));
  const r = await fetch(`/salvar?nome=${encodeURIComponent(nome)}&pasta=${pasta}`, { method: 'POST', body: blob });
  const j = await r.json().catch(() => ({ ok: false }));
  log(`${j.ok ? '✔' : '✖'} ${nome} — ${j.bytes ? Math.round(j.bytes / 1024) + ' KB' : r.status}`);
  return j;
}

async function gerarFoto(pr) {
  const { canvas } = await renderizar(pr, { escala: 2 });
  const c = reduzir(canvas, pr.w, pr.h);
  tarja(c, 'Imagem ilustrativa');
  $('#previa').src = c.toDataURL('image/jpeg', 0.8);
  await salvar(reduzir(c, 960, Math.round(960 * pr.h / pr.w)), `${pr.nome}-960.jpg`, 'fotos', 'image/jpeg', 0.84);
  return salvar(c, `${pr.nome}.jpg`, 'fotos', 'image/jpeg', 0.86);
}

// ================================================================ PLANTA HUMANIZADA (mapa-guia)
const LEGENDA_LAZER = [
  ['salao', 'Salão de festas'], ['piscina', 'Piscina'], ['quiosques', 'Quiosques'], ['banheiros', 'Banheiros coletivos'],
  ['quadra', 'Quadra de areia'], ['baias', 'Baias e redondel'], ['fazendinha', 'Fazendinha'],
];

function pilula(g, x, y, texto, { fundo, cor, borda, fonte, padX, alt, raio }) {
  g.font = fonte;
  const w = g.measureText(texto).width + padX * 2;
  g.fillStyle = fundo; g.beginPath(); g.roundRect(x - w / 2, y - alt / 2, w, alt, raio); g.fill();
  if (borda) { g.strokeStyle = borda; g.lineWidth = Math.max(1.5, alt / 14); g.stroke(); }
  g.fillStyle = cor; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(texto, x, y + 1);
  return w;
}
function selo(g, x, y, texto, r, { fundo = '#FDFAF2', cor = '#183827', borda = '#183827', fonte }) {
  g.fillStyle = 'rgba(24,56,39,.25)'; g.beginPath(); g.arc(x + r * 0.08, y + r * 0.14, r, 0, Math.PI * 2); g.fill();
  g.fillStyle = fundo; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  g.strokeStyle = borda; g.lineWidth = Math.max(1.5, r / 7); g.stroke();
  g.fillStyle = cor; g.font = fonte; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(texto, x, y + 1);
}
function projetar(p, W, H) {
  const v = p.clone().project(camera);
  return { x: (v.x + 1) / 2 * W, y: (1 - v.y) / 2 * H, ok: v.z < 1 };
}

async function gerarPlanta() {
  await Promise.all(['700 42px "Playfair Display"', '600 20px Inter', '700 16px Inter', 'italic 400 16px Inter'].map((f) => document.fonts.load(f).catch(() => null)));
  const W = 2400, HM = 960, HL = 372, H = HM + HL; // mapa + faixa de legenda
  const k = 1.5;                                     // supersampling
  // quase de cima (o imóvel é uma faixa longa: 3,5 km × 1 km) — cabe inteiro com pouco entorno
  const pr = { w: W, h: HM, cam: () => enquadrar(cena.polyImovel, 0.5, -0.1, { x: 0.035, topo: 0.17, base: 0.07 }) };
  cena.definirModo('maquete', renderer);           // planta-guia no visual de maquete (mesmo do mapa interativo)
  const { canvas } = await renderizar(pr, { escala: k });
  const out = document.createElement('canvas'); out.width = W; out.height = H;
  const g = out.getContext('2d');
  g.fillStyle = '#FBF8EF'; g.fillRect(0, 0, W, H);
  g.drawImage(reduzir(canvas, W, HM), 0, 0);
  const P = (p) => projetar(p, W, HM);

  // véu claro fora do imóvel: o olho vai para o empreendimento (o entorno continua visível)
  g.save();
  g.beginPath(); g.rect(0, 0, W, HM);
  cena.polyImovel.forEach((q, i) => { const s2 = P(new THREE.Vector3(q[0], 0, q[1])); if (i) g.lineTo(s2.x, s2.y); else g.moveTo(s2.x, s2.y); });
  g.closePath();
  g.fillStyle = 'rgba(251,248,239,0)'; g.fill('evenodd');
  g.restore();

  // colisão simples entre rótulos (caixas em px)
  const caixas = [];
  const livre = (x, y, w, h) => !caixas.some((c) => Math.abs(c.x - x) < (c.w + w) / 2 + 4 && Math.abs(c.y - y) < (c.h + h) / 2 + 3);
  const ocupar = (x, y, w, h) => caixas.push({ x, y, w, h });
  const medir = (t, fonte, padX) => { g.font = fonte; return g.measureText(t).width + padX * 2; };

  // 1) glebas (prioridade: são a referência de quem procura o lote)
  for (const a of cena.ancoras.glebas) { const s2 = P(a.p); if (!s2.ok) continue; selo(g, s2.x, s2.y, a.id, 15, { fonte: '700 14px Inter, sans-serif' }); ocupar(s2.x, s2.y, 32, 32); }
  // 2) marcadores
  const marca = (p, texto, cor = '#C8A86B') => {
    const s2 = P(p); if (!s2.ok) return;
    const fonte = '700 20px Inter, sans-serif', w = medir(texto, fonte, 16);
    let dy = 48; for (const t of [48, 78, 108]) { if (livre(s2.x, s2.y - t, w, 40)) { dy = t; break; } }
    g.strokeStyle = cor; g.lineWidth = 3; g.beginPath(); g.moveTo(s2.x, s2.y); g.lineTo(s2.x, s2.y - dy + 20); g.stroke();
    pilula(g, s2.x, s2.y - dy, texto, { fundo: '#FDFAF2', cor: '#183827', borda: cor, fonte, padX: 16, alt: 40, raio: 20 });
    ocupar(s2.x, s2.y - dy, w, 40);
  };
  marca(new THREE.Vector3(entrada[0], 0, entrada[1]), 'Portaria');
  const nIt = Object.values(itens).length || 1;
  const cl = Object.values(itens).reduce((a, c) => [a[0] + c[0] / nIt, a[1] + c[1] / nIt], [0, 0]);
  marca(new THREE.Vector3(cl[0], 0, cl[1]), 'Área de lazer (detalhe abaixo)');
  for (const m of cena.ancoras.marcadores) marca(m.p, m.nome, m.tipo === 'lago' ? '#8FB6C9' : '#8FB08A');
  // 3) vias: avenidas fora do miolo (Pau Ferro acima, Umbuzeiro abaixo), ruas na ponta de cima
  for (const a of cena.ancoras.vias) {
    const s2 = P(a.p); if (!s2.ok) continue;
    if (a.tipo === 'avenida') {
      const fonte = '700 17px Inter, sans-serif', w = medir(a.texto, fonte, 12);
      const volta = a.texto.startsWith('\u2190');
      const tent = volta ? [34, 58, 82] : [-44, -68, -92];
      const dy = tent.find((t) => livre(s2.x, s2.y + t, w, 32));
      if (dy === undefined) continue;
      pilula(g, s2.x, s2.y + dy, a.texto, { fundo: '#183827', cor: '#fff', borda: 'rgba(255,255,255,.6)', fonte, padX: 12, alt: 32, raio: 6 });
      ocupar(s2.x, s2.y + dy, w, 32);
    } else if (a.tipo === 'rua' && a.principal) {
      const fonte = '700 13px Inter, sans-serif', w = medir(a.texto, fonte, 8);
      const dy = [-22, -46, 18].find((t) => livre(s2.x, s2.y + t, w, 24));
      if (dy === undefined) continue;
      pilula(g, s2.x, s2.y + dy, a.texto, { fundo: '#fff', cor: '#183827', borda: 'rgba(24,56,39,.4)', fonte, padX: 8, alt: 24, raio: 5 });
      ocupar(s2.x, s2.y + dy, w, 24);
    } else if (a.tipo === 'estrada') {
      const fonte = '700 14px Inter, sans-serif', w = medir(a.texto, fonte, 10);
      const dx = [-w / 2 - 14, w / 2 + 14].find((t) => livre(s2.x + t, s2.y, w, 26)) ?? 0;
      pilula(g, s2.x + dx, s2.y, a.texto, { fundo: '#FDFAF2', cor: '#6A3C25', borda: '#C9B58C', fonte, padX: 10, alt: 26, raio: 5 });
      ocupar(s2.x + dx, s2.y, w, 26);
    } else if (a.tipo === 'destino') {
      const fonte = '700 16px Inter, sans-serif', w = medir(a.texto, fonte, 12);
      const dy = [-34, -62, -90, 34].find((t) => livre(s2.x, s2.y + t, w, 30)) ?? -34;
      pilula(g, s2.x, Math.max(24, s2.y + dy), a.texto, { fundo: '#2F5C8F', cor: '#fff', fonte, padX: 12, alt: 30, raio: 6 });
      ocupar(s2.x, s2.y + dy, w, 30);
    }
  }

  // título (caixa do tamanho do texto) e bússola
  const tTit = 'Planta humanizada do Haras Rio São José', tSub = 'CHACREAMENTO · POÇÕES – BA · 57 GLEBAS · LOTES A PARTIR DE 2.000 m²';
  const wTit = Math.max(medir(tTit, '700 42px "Playfair Display", Georgia, serif', 0), medir(tSub, '600 17px Inter, sans-serif', 0)) + 48;
  g.fillStyle = 'rgba(251,248,239,.93)'; g.beginPath(); g.roundRect(28, 22, wTit, 110, 14); g.fill();
  g.fillStyle = '#183827'; g.font = '700 42px "Playfair Display", Georgia, serif'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  g.fillText(tTit, 52, 76);
  g.fillStyle = '#8A6A45'; g.font = '600 17px Inter, sans-serif';
  g.fillText(tSub, 53, 110);
  { // bússola (norte = para cima nesta vista)
    const x = W - 80, y = 82, r = 40;
    g.fillStyle = 'rgba(251,248,239,.95)'; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#C8A86B'; g.lineWidth = 2; g.stroke();
    g.fillStyle = '#A74726'; g.beginPath(); g.moveTo(x, y - 30); g.lineTo(x + 9, y); g.lineTo(x - 9, y); g.fill();
    g.fillStyle = '#183827'; g.beginPath(); g.moveTo(x, y + 30); g.lineTo(x + 9, y); g.lineTo(x - 9, y); g.fill();
    g.fillStyle = '#183827'; g.font = '700 16px Inter'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('N', x, y - r - 12);
  }

  cena.definirModo('entorno', renderer);
  // detalhe da área de lazer (segunda renderização)
  const prD = { w: 900, h: 560, sombras: 150, cam: () => enquadrar(Object.values(itens).concat([[itens.salao[0] + 20, itens.salao[1] - 20]]), 0.95, 0.25, { x: 0.06, topo: 0.12, base: 0.08 }) };
  const det = await renderizar(prD, { escala: 2 });
  const dc = reduzir(det.canvas, prD.w, prD.h);
  const dg = dc.getContext('2d');
  LEGENDA_LAZER.forEach(([id], i) => {
    if (!itens[id]) return;
    const s = projetar(new THREE.Vector3(itens[id][0], 6, itens[id][1]), prD.w, prD.h);
    dg.strokeStyle = '#C8A86B'; dg.lineWidth = 2.5; dg.beginPath(); dg.moveTo(s.x, s.y); dg.lineTo(s.x, s.y - 24); dg.stroke();
    selo(dg, s.x, s.y - 38, String(i + 1), 16, { fundo: '#C8A86B', borda: '#FDFAF2', fonte: '800 16px Inter, sans-serif' });
  });
  // faixa inferior: detalhe + legenda
  const y0 = HM;
  g.fillStyle = '#FBF8EF'; g.fillRect(0, y0, W, HL);
  g.strokeStyle = 'rgba(24,56,39,.12)'; g.beginPath(); g.moveTo(0, y0 + 0.5); g.lineTo(W, y0 + 0.5); g.stroke();
  const dW = 520, dH = Math.round(520 * prD.h / prD.w);
  g.save(); g.beginPath(); g.roundRect(28, y0 + 18, dW, dH, 14); g.clip(); g.drawImage(dc, 28, y0 + 18, dW, dH); g.restore();
  g.strokeStyle = '#C8A86B'; g.lineWidth = 2; g.beginPath(); g.roundRect(28, y0 + 18, dW, dH, 14); g.stroke();
  pilula(g, 28 + 118, y0 + 42, 'ÁREA DE LAZER · DETALHE', { fundo: '#183827', cor: '#fff', fonte: '700 14px Inter, sans-serif', padX: 12, alt: 28, raio: 14 });
  // legenda numerada
  g.textAlign = 'left'; g.textBaseline = 'middle';
  g.fillStyle = '#183827'; g.font = '700 28px "Playfair Display", Georgia, serif'; g.fillText('Áreas comuns e pontos de referência', 590, y0 + 48);
  const lista = [...LEGENDA_LAZER.map(([, n]) => n)];
  lista.forEach((n, i) => {
    const col = i < 4 ? 0 : 1, lin = i < 4 ? i : i - 4;
    const x = 600 + col * 380, y = y0 + 100 + lin * 52;
    selo(g, x, y, String(i + 1), 16, { fundo: '#C8A86B', borda: '#FDFAF2', fonte: '800 16px Inter, sans-serif' });
    g.fillStyle = '#183827'; g.font = '600 20px Inter, sans-serif'; g.textAlign = 'left'; g.fillText(n, x + 28, y + 1);
  });
  const extras = [['Portaria e guarita', 'na entrada, pela Estrada de Duas Vendas'], ['Avenidas Pau Ferro e Umbuzeiro', 'ida e volta · Ruas 1 a 12'], ['Lago natural', 'na ponta da área de lazer'], ['Área de preservação ambiental', 'Reserva Legal e APP']];
  extras.forEach(([t, s2], i) => {
    const x = 1380, y = y0 + 100 + i * 52;
    g.fillStyle = '#8FB08A'; g.beginPath(); g.arc(x, y, 7, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#183827'; g.font = '600 20px Inter, sans-serif'; g.fillText(t, x + 20, y - 8);
    g.fillStyle = '#6F7B72'; g.font = '400 16px Inter, sans-serif'; g.fillText(s2, x + 20, y + 14);
  });
  g.fillStyle = '#6F7B72'; g.font = 'italic 400 16px Inter, sans-serif'; g.textAlign = 'right';
  g.fillText('Imagem ilustrativa baseada na planta do empreendimento. Infraestrutura conforme contrato.', W - 30, H - 22);

  $('#previa').src = out.toDataURL('image/jpeg', 0.8);
  await salvar(out, 'planta-humanizada.jpg', 'assets', 'image/jpeg', 0.9);
  // versão leve para o celular
  const leve = reduzir(out, 1600, Math.round(1600 * H / W));
  await salvar(leve, 'planta-humanizada-1600.jpg', 'assets', 'image/jpeg', 0.86);
}

// ---------------------------------------------------------------- Interface
const lista = $('#lista');
for (const pr of PRESETS) {
  const li = document.createElement('li');
  li.innerHTML = `<button type="button">Prévia</button> <button type="button">Gerar</button> <span>${pr.nome} — ${pr.titulo}</span>`;
  const [bP, bG] = li.querySelectorAll('button');
  bP.onclick = async () => { const { canvas } = await renderizar(pr, { previa: true }); $('#previa').src = canvas.toDataURL('image/jpeg', 0.8); };
  bG.onclick = () => gerarFoto(pr);
  lista.appendChild(li);
}
$('#tudo').onclick = async () => { for (const pr of PRESETS) await gerarFoto(pr); await gerarPlanta(); log('— pronto —'); };
$('#planta').onclick = () => gerarPlanta();
window.__render = { PRESETS, renderizar, gerarFoto, gerarPlanta, cena, camera, enquadrar };
log(`cena pronta: ${cena.lotes.length} lotes, ${cena.arvoresQtd} árvores`);
