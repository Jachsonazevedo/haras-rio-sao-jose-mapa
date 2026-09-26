/* =====================================================================
   Haras Rio São José — cena3d.js
   Constrói a PLANTA HUMANIZADA EM 3D a partir de data/lotes.json.
   Usada pelo mapa interativo (js/mapa3d.js) e pelo gerador de imagens
   (render.html → js/render3d.js).

   Convenções
   - Coordenadas do JSON em metros, x para a direita (leste), y para baixo
     (sul). Na cena: X = x, Z = y, Y = altura. Norte = -Z.
   - Camadas planas (chão, áreas, vias, lotes) não gravam profundidade e são
     desenhadas em ordem (renderOrder): não há "briga" de profundidade entre
     elas em nenhuma distância. Árvores, prédios e postes são 3D normais.
   - Só o que o contrato v4 prevê: vias cascalhadas, cerca no perímetro,
     rede elétrica (postes), marcação das frações (piquetes), guarita,
     salão, piscina, 3 quiosques, 2 banheiros, quadra de areia, 5 baias e
     redondel, fazendinha e o lago natural. Sem deck, sem píer, sem parque
     infantil, sem estacionamento e sem cerca individual nos lotes.
   ===================================================================== */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ---------------------------------------------------------------- Paleta
export const PALETA = {
  // cores de status legíveis, mas com a textura da grama por baixo (aspecto de terreno, não de planilha)
  lote: {
    disponivel: '#48B063',
    vendido: '#C94A36',
    reservado: '#4A84CC',
    reserva_tecnica: '#8FA0B2',
  },
  loteApagado: '#D2CCAE',
  loteBorda: '#FAF4E4',
  // tons tirados das fotos aéreas: capim seco claro, mato verde-oliva, estradas de terra avermelhada
  chaoImovel: '#BDBE86',
  chaoFora: ['#BBB47C', '#D0C797', '#6C8543', '#9AA35F'], // pasto claro, pasto seco, mato, capim
  mata: '#58743A',
  gramado: '#8AB65A',
  jardim: '#97BF62',
  cascalho: '#CF9A6E',
  cascalhoBorda: '#BE9068',
  terra: '#C7AE84',
  agua: '#3F9FC0',
  margem: '#D9C79A',
  selo: '#F4EEDC',
  dourado: '#C8A86B',
  folhas: ['#3F6F2B', '#4E7F32', '#5B8A38', '#355F26', '#668F3E', '#72843F', '#48752F'],
  tronco: '#6B4A32',
};

const RAD = Math.PI / 180;

// ---------------------------------------------------------------- Utilidades
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function ruido(seed = 7) {
  const perm = new Uint8Array(512);
  const r = rng(seed);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const val = (ix, iy) => perm[(perm[ix & 255] + iy) & 511] / 255;
  const suave = (t) => t * t * (3 - 2 * t);
  const n = (x, y) => {
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const a = val(ix, iy), b = val(ix + 1, iy), c = val(ix, iy + 1), d = val(ix + 1, iy + 1);
    const u = suave(fx), v = suave(fy);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  return (x, y, oitavas = 3) => {
    let s = 0, amp = 1, f = 1, tot = 0;
    for (let o = 0; o < oitavas; o++) { s += n(x * f, y * f) * amp; tot += amp; amp *= 0.5; f *= 2; }
    return s / tot;
  };
}

export function dentro(pt, poly) {
  let d = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) d = !d;
  }
  return d;
}

function distSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L2 = dx * dx + dy * dy || 1e-9;
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2;
  t = Math.max(0, Math.min(1, t));
  const x = a[0] + t * dx - p[0], y = a[1] + t * dy - p[1];
  return Math.sqrt(x * x + y * y);
}

function projSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L2 = dx * dx + dy * dy || 1e-9;
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2;
  return { t, q: [a[0] + t * dx, a[1] + t * dy] };
}

function limparPoly(poly) {
  const p = poly.filter((q) => Array.isArray(q) && Number.isFinite(q[0]) && Number.isFinite(q[1]));
  if (p.length > 2) {
    const a = p[0], b = p[p.length - 1];
    if (Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6) p.pop();
  }
  return p;
}

export function centroide(poly) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const f = poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
    a += f; cx += (poly[j][0] + poly[i][0]) * f; cy += (poly[j][1] + poly[i][1]) * f;
  }
  if (Math.abs(a) < 1e-9) {
    const n = poly.length || 1;
    return [poly.reduce((s, q) => s + q[0], 0) / n, poly.reduce((s, q) => s + q[1], 0) / n];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

function comprimento(pts) { let s = 0; for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return s; }

export function pontoAoLongo(pts, frac) {
  const total = comprimento(pts); let alvo = total * frac;
  for (let i = 1; i < pts.length; i++) {
    const L = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (alvo <= L) { const t = L ? alvo / L : 0; return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t]; }
    alvo -= L;
  }
  return pts[pts.length - 1];
}

// A planta traz "dentes" de poucos metros no eixo das avenidas (desvios em volta dos selos das glebas):
// num traçado 3D eles viram quebras feias. Remove o vértice quando os dois trechos vizinhos são curtos.
function suavizarVia(pts) {
  let p = pts.map((q) => [q[0], q[1]]);
  let mudou = true;
  while (mudou && p.length > 2) {
    mudou = false;
    for (let i = 1; i < p.length - 1; i++) {
      const a = Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
      const b = Math.hypot(p[i + 1][0] - p[i][0], p[i + 1][1] - p[i][1]);
      if (a < 22 && b < 22) { p.splice(i, 1); mudou = true; break; }
    }
  }
  return p;
}

// Casca convexa (Andrew) — base da maquete
function cascaConvexa(pts) {
  const P = pts.map((q) => [q[0], q[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cruz = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const baixo = [], cima = [];
  for (const p of P) { while (baixo.length >= 2 && cruz(baixo[baixo.length - 2], baixo[baixo.length - 1], p) <= 0) baixo.pop(); baixo.push(p); }
  for (let i = P.length - 1; i >= 0; i--) { const p = P[i]; while (cima.length >= 2 && cruz(cima[cima.length - 2], cima[cima.length - 1], p) <= 0) cima.pop(); cima.push(p); }
  cima.pop(); baixo.pop();
  return baixo.concat(cima); // anti-horário no plano x/y matemático
}

// Afasta um polígono convexo de m metros, com cantos arredondados
function afastarConvexo(poly, m, passoAng = 0.18) {
  const n = poly.length, out = [];
  const normal = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1; return [dy / L, -dx / L]; };
  // garante normais para fora (confere com o centroide)
  const c = [poly.reduce((s, q) => s + q[0], 0) / n, poly.reduce((s, q) => s + q[1], 0) / n];
  let sinal = 1;
  { const n0 = normal(poly[0], poly[1]); const mid = [(poly[0][0] + poly[1][0]) / 2, (poly[0][1] + poly[1][1]) / 2]; if ((mid[0] - c[0]) * n0[0] + (mid[1] - c[1]) * n0[1] < 0) sinal = -1; }
  for (let i = 0; i < n; i++) {
    const a = poly[(i - 1 + n) % n], b = poly[i], d = poly[(i + 1) % n];
    const n1 = normal(a, b).map((v) => v * sinal), n2 = normal(b, d).map((v) => v * sinal);
    let a1 = Math.atan2(n1[1], n1[0]), a2 = Math.atan2(n2[1], n2[0]);
    let da = a2 - a1; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
    const passos = Math.max(1, Math.ceil(Math.abs(da) / passoAng));
    for (let k = 0; k <= passos; k++) { const t = a1 + da * (k / passos); out.push([b[0] + Math.cos(t) * m, b[1] + Math.sin(t) * m]); }
  }
  return out;
}

// Afasta um polígono qualquer (simples) de m metros: arco nos cantos convexos, meia-esquadria limitada nos côncavos
function afastarPoligono(poly, m, passoAng = 0.2) {
  const n = poly.length;
  let area = 0; for (let i = 0, j = n - 1; i < n; j = i++) area += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
  const orient = area > 0 ? 1 : -1;
  const normalFora = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1; return [orient * dy / L, -orient * dx / L]; };
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = poly[(i - 1 + n) % n], b = poly[i], d = poly[(i + 1) % n];
    const n1 = normalFora(a, b), n2 = normalFora(b, d);
    const cruz = (b[0] - a[0]) * (d[1] - b[1]) - (b[1] - a[1]) * (d[0] - b[0]);
    const convexo = cruz * orient > 0;
    if (convexo) {
      const a1 = Math.atan2(n1[1], n1[0]); let da = Math.atan2(n2[1], n2[0]) - a1;
      while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
      const passos = Math.max(1, Math.ceil(Math.abs(da) / passoAng));
      for (let k = 0; k <= passos; k++) { const t = a1 + da * (k / passos); out.push([b[0] + Math.cos(t) * m, b[1] + Math.sin(t) * m]); }
    } else {
      const bx = n1[0] + n2[0], by = n1[1] + n2[1], L = Math.hypot(bx, by) || 1;
      const cosMeio = Math.max(0.35, (n1[0] * bx + n1[1] * by) / L);
      out.push([b[0] + bx / L * m / cosMeio, b[1] + by / L * m / cosMeio]);
    }
  }
  return out;
}

// Recuo para dentro (meia-esquadria limitada): usado no contorno colorido de cada lote
function recuar(poly, d) {
  const n = poly.length;
  let area = 0; for (let i = 0, j = n - 1; i < n; j = i++) area += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
  const o = area > 0 ? 1 : -1;
  const nd = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1; return [-o * dy / L, o * dx / L]; }; // normal para dentro
  return poly.map((b, i) => {
    const a = poly[(i - 1 + n) % n], c = poly[(i + 1) % n];
    const n1 = nd(a, b), n2 = nd(b, c);
    const bx = n1[0] + n2[0], by = n1[1] + n2[1], L = Math.hypot(bx, by) || 1;
    const cosMeio = Math.max(0.4, (n1[0] * bx + n1[1] * by) / L);
    return [b[0] + bx / L * d / cosMeio, b[1] + by / L * d / cosMeio];
  });
}

// Corta uma polilinha no ponto em que ela sai do polígono: [parte de dentro, parte de fora]
function cortarNaSaida(pts, poly) {
  if (pts.length < 2) return [pts, []];
  for (let i = 1; i < pts.length; i++) {
    if (!dentro(pts[i], poly)) {
      let a = pts[i - 1], b = pts[i];
      for (let k = 0; k < 30; k++) { const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; if (dentro(m, poly)) a = m; else b = m; }
      return [pts.slice(0, i).concat([a]), [a].concat(pts.slice(i))];
    }
  }
  return [pts, []];
}

// Remove vértices quase alinhados (a planta às vezes traz um ponto no meio de um lado reto)
export function simplificarPoly(poly, graus = 9) {
  let p = poly.slice();
  let mudou = true;
  while (mudou && p.length > 3) {
    mudou = false;
    for (let i = 0; i < p.length; i++) {
      const a = p[(i - 1 + p.length) % p.length], b = p[i], c = p[(i + 1) % p.length];
      const v1 = [b[0] - a[0], b[1] - a[1]], v2 = [c[0] - b[0], c[1] - b[1]];
      const ang = Math.abs(Math.atan2(v1[0] * v2[1] - v1[1] * v2[0], v1[0] * v2[0] + v1[1] * v2[1])) * 180 / Math.PI;
      if (ang < graus || Math.hypot(...v1) < 1.5) { p.splice(i, 1); mudou = true; break; }
    }
  }
  return p;
}

// ---------------------------------------------------------------- Texturas procedurais (sem arquivos externos)
function textura(tam, desenhar, { repetir = true, srgb = true } = {}) {
  const c = document.createElement('canvas'); c.width = c.height = tam;
  const g = c.getContext('2d');
  desenhar(g, tam);
  const t = new THREE.CanvasTexture(c);
  if (repetir) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

function manchas(g, tam, r, qtd, cores, alfa, [rmin, rmax]) {
  for (let i = 0; i < qtd; i++) {
    const x = r() * tam, y = r() * tam, rad = rmin + r() * (rmax - rmin);
    g.fillStyle = cores[Math.floor(r() * cores.length)];
    g.globalAlpha = alfa * (0.4 + r() * 0.6);
    g.beginPath(); g.ellipse(x, y, rad, rad * (0.5 + r() * 0.8), r() * Math.PI, 0, Math.PI * 2); g.fill();
    // repete nas bordas para o ladrilho não mostrar emenda
    for (const [dx, dy] of [[tam, 0], [-tam, 0], [0, tam], [0, -tam]]) {
      if (x + dx > -rad && x + dx < tam + rad && y + dy > -rad && y + dy < tam + rad) {
        g.beginPath(); g.ellipse(x + dx, y + dy, rad, rad * 0.8, 0, 0, Math.PI * 2); g.fill();
      }
    }
  }
  g.globalAlpha = 1;
}

function criarTexturas() {
  const r = rng(11);
  const T = {};
  // Grama clara, quase branca: a cor vem do material/vértice (multiplica)
  T.grama = textura(256, (g, s) => {
    g.fillStyle = '#EEF1E4'; g.fillRect(0, 0, s, s);
    manchas(g, s, r, 260, ['#DDE6CB', '#F7F7EE', '#D2DDBC', '#E8E2CC'], 0.55, [4, 18]);
    g.lineWidth = 1;
    for (let i = 0; i < 2600; i++) {
      const x = r() * s, y = r() * s, L = 2 + r() * 4;
      g.strokeStyle = r() < 0.5 ? 'rgba(120,140,90,.16)' : 'rgba(255,255,245,.35)';
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 2, y - L); g.stroke();
    }
  });
  // Cascalho: base clara com pedriscos; u = largura da via, v = comprimento → trilhas de roda em u≈0,3 e 0,7
  T.cascalho = textura(256, (g, s) => {
    g.fillStyle = '#F2EBDD'; g.fillRect(0, 0, s, s);
    manchas(g, s, r, 120, ['#E5DAC3', '#F8F3EA', '#DCCDB0'], 0.6, [6, 20]);
    for (let i = 0; i < 5200; i++) {
      const x = r() * s, y = r() * s;
      g.fillStyle = ['#C9B994', '#FFFFFF', '#B5A27C', '#E9DFC9'][Math.floor(r() * 4)];
      g.globalAlpha = 0.5 + r() * 0.5;
      g.fillRect(x, y, 1 + r() * 1.8, 1 + r() * 1.8);
    }
    g.globalAlpha = 1;
    for (const u of [0.3, 0.7]) {
      const grd = g.createLinearGradient((u - 0.07) * s, 0, (u + 0.07) * s, 0);
      grd.addColorStop(0, 'rgba(150,125,85,0)'); grd.addColorStop(0.5, 'rgba(150,125,85,.22)'); grd.addColorStop(1, 'rgba(150,125,85,0)');
      g.fillStyle = grd; g.fillRect((u - 0.07) * s, 0, 0.14 * s, s);
    }
  });
  T.areia = textura(128, (g, s) => {
    g.fillStyle = '#F4EAD2'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 1800; i++) { g.fillStyle = r() < 0.5 ? 'rgba(190,160,110,.28)' : 'rgba(255,255,255,.5)'; g.fillRect(r() * s, r() * s, 1, 1); }
  });
  T.pedra = textura(128, (g, s) => {
    g.fillStyle = '#EDE6D8'; g.fillRect(0, 0, s, s);
    g.strokeStyle = 'rgba(150,135,110,.45)'; g.lineWidth = 1.2;
    for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(0, i * s / 4); g.lineTo(s, i * s / 4); g.stroke(); g.beginPath(); g.moveTo(i * s / 4, 0); g.lineTo(i * s / 4, s); g.stroke(); }
    manchas(g, s, r, 30, ['#E2D9C6', '#F6F1E6'], 0.5, [6, 14]);
  });
  T.telha = textura(128, (g, s) => {
    g.fillStyle = '#B5582F'; g.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 16) {
      g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(0, y + 13, s, 3);
      for (let x = (y / 16) % 2 ? 8 : 0; x < s; x += 16) { g.fillStyle = 'rgba(255,220,180,.10)'; g.fillRect(x + 2, y + 2, 10, 9); }
    }
  });
  T.paver = textura(128, (g, s) => {
    g.fillStyle = '#CFC6B6'; g.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 16) for (let x = ((y / 16) % 2) * 16; x < s + 32; x += 32) {
      g.fillStyle = ['#C9BFAE', '#D6CDBE', '#BFB5A4', '#D1C8B8'][(x + y) % 4 === 0 ? 0 : Math.floor(r() * 4)];
      g.fillRect(x - 32 + 1, y + 1, 30, 14);
    }
  });
  T.paver.repeat.set(26, 32);
  T.azulejo = textura(128, (g, s) => {
    g.fillStyle = '#7FD0E6'; g.fillRect(0, 0, s, s);
    g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 2;
    for (let i = 0; i <= 8; i++) { g.beginPath(); g.moveTo(0, i * s / 8); g.lineTo(s, i * s / 8); g.stroke(); g.beginPath(); g.moveTo(i * s / 8, 0); g.lineTo(i * s / 8, s); g.stroke(); }
  });
  T.azulejo.repeat.set(5, 5);
  T.madeira = textura(128, (g, s) => {
    g.fillStyle = '#9A6A43'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 90; i++) { g.strokeStyle = `rgba(60,35,20,${0.08 + r() * 0.12})`; g.beginPath(); const y = r() * s; g.moveTo(0, y); g.bezierCurveTo(s * 0.3, y + 3, s * 0.6, y - 3, s, y); g.stroke(); }
  });
  // Sombra suave (mancha radial) para árvores e prédios
  T.sombra = textura(128, (g, s) => {
    const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grd.addColorStop(0, 'rgba(20,30,10,.55)'); grd.addColorStop(0.55, 'rgba(20,30,10,.32)'); grd.addColorStop(1, 'rgba(20,30,10,0)');
    g.fillStyle = grd; g.fillRect(0, 0, s, s);
  }, { repetir: false });
  return T;
}

function placaTexto(texto, { larg = 1024, alt = 160, fundo = '#6B4A32', cor = '#F5E7C8', fonte = 'bold 78px Georgia, serif' } = {}) {
  const c = document.createElement('canvas'); c.width = larg; c.height = alt;
  const g = c.getContext('2d');
  g.fillStyle = fundo; g.fillRect(0, 0, larg, alt);
  g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 8; g.strokeRect(6, 6, larg - 12, alt - 12);
  g.fillStyle = cor; g.font = fonte; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(texto, larg / 2, alt / 2 + 4);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

// ---------------------------------------------------------------- Geometrias planas
const cor = new THREE.Color();

// Levar o polígono do plano XY (y para baixo) para o chão XZ inverte o sentido dos triângulos:
// aqui cada triângulo é conferido e virado para cima (normal +Y), senão a luz o trata como "de costas".
function paraCima(g) {
  const p = g.attributes.position.array;
  const virar = (a, b, c) => {
    const ax = p[b * 3] - p[a * 3], az = p[b * 3 + 2] - p[a * 3 + 2];
    const bx = p[c * 3] - p[a * 3], bz = p[c * 3 + 2] - p[a * 3 + 2];
    return az * bx - ax * bz < 0; // componente Y da normal (e1 × e2) negativa
  };
  if (g.index) {
    const ix = g.index.array;
    for (let i = 0; i < ix.length; i += 3) if (virar(ix[i], ix[i + 1], ix[i + 2])) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
    g.index.needsUpdate = true;
  }
  return g;
}

function malhaPoligonos(polys, { y = 0, uv = 20, cores = null, corUnica = '#ffffff' } = {}) {
  const pos = [], nor = [], uvs = [], col = [], idx = [];
  const faixas = [];
  polys.forEach((poly, k) => {
    const p = limparPoly(poly);
    if (p.length < 3) { faixas.push(null); return; }
    const tri = THREE.ShapeUtils.triangulateShape(p.map((q) => new THREE.Vector2(q[0], q[1])), []);
    const base = pos.length / 3;
    cor.set(cores ? cores[k] : corUnica);
    for (const q of p) {
      pos.push(q[0], y, q[1]); nor.push(0, 1, 0); uvs.push(q[0] / uv, q[1] / uv);
      col.push(cor.r, cor.g, cor.b);
    }
    for (const t of tri) idx.push(base + t[0], base + t[1], base + t[2]);
    faixas.push({ inicio: base, qtd: p.length });
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  paraCima(g);
  return { geom: g, faixas };
}

function bordas(polys, y, fechar = true) {
  const pos = [];
  for (const poly of polys) {
    const p = limparPoly(poly);
    const n = p.length;
    for (let i = 0; i < (fechar ? n : n - 1); i++) {
      const a = p[i], b = p[(i + 1) % n];
      pos.push(a[0], y, a[1], b[0], y, b[1]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

// Fita (faixa) ao longo de uma polilinha, com junções em meia-esquadria. u = largura (0→1), v = metros / vRep.
function fita(pts, largura, { y = 0, vRep = 12, fechar = false } = {}) {
  const P = pts;
  const n = P.length;
  const pos = [], nor = [], uv = [], idx = [];
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const prev = P[fechar ? (i - 1 + n) % n : Math.max(0, i - 1)];
    const next = P[fechar ? (i + 1) % n : Math.min(n - 1, i + 1)];
    const cur = P[i];
    let d1 = [cur[0] - prev[0], cur[1] - prev[1]], d2 = [next[0] - cur[0], next[1] - cur[1]];
    const l1 = Math.hypot(...d1) || 1, l2 = Math.hypot(...d2) || 1;
    d1 = [d1[0] / l1, d1[1] / l1]; d2 = [d2[0] / l2, d2[1] / l2];
    if (i === 0 && !fechar) d1 = d2;
    if (i === n - 1 && !fechar) d2 = d1;
    let t = [d1[0] + d2[0], d1[1] + d2[1]]; const lt = Math.hypot(...t) || 1; t = [t[0] / lt, t[1] / lt];
    const nrm = [-t[1], t[0]];
    const dot = Math.max(0.35, nrm[0] * -d1[1] + nrm[1] * d1[0]);
    const m = (largura / 2) / dot;
    pos.push(cur[0] + nrm[0] * m, y, cur[1] + nrm[1] * m, cur[0] - nrm[0] * m, y, cur[1] - nrm[1] * m);
    nor.push(0, 1, 0, 0, 1, 0);
    uv.push(0, acc / vRep, 1, acc / vRep);
    if (i < n - 1 || fechar) acc += Math.hypot(next[0] - cur[0], next[1] - cur[1]);
  }
  const segs = fechar ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = 2 * i, b = 2 * ((i + 1) % n);
    idx.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return paraCima(g);
}

function disco(cx, cz, raio, y = 0, seg = 32) {
  const g = new THREE.CircleGeometry(raio, seg);
  g.rotateX(-Math.PI / 2); g.translate(cx, y, cz);
  return g;
}

// ---------------------------------------------------------------- Materiais
function matPlano(opts) {
  // DoubleSide: a triangulação vem do plano XY e, levada para XZ, pode sair "de costas" para a câmera
  const m = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, ...opts });
  m.depthWrite = false;
  return m;
}

function planos(mesh, ordem) { mesh.renderOrder = ordem; mesh.receiveShadow = true; mesh.frustumCulled = false; return mesh; }

// ---------------------------------------------------------------- Construtor principal
/**
 * @param {object} dados  conteúdo de data/lotes.json
 * @param {object} op     { qualidade: 'movel' | 'desktop' | 'render' }
 */
export function construirCena(dados, op = {}) {
  const qualidade = op.qualidade || 'desktop';
  const Q = {
    movel: { arv: 0.5, detalhe: 0, fora: 0.45, piquetes: false },
    desktop: { arv: 1, detalhe: 1, fora: 1, piquetes: true },
    render: { arv: 1.35, detalhe: 1, fora: 1.3, piquetes: true },
  }[qualidade] || { arv: 1, detalhe: 1, fora: 1, piquetes: true };

  const T = criarTexturas();
  const scene = new THREE.Scene();
  const r = rng(2026);
  const nz = ruido(5);

  // ---- Limites
  const imovel = dados.areas.find((a) => a.tipo === 'imovel');
  const polyImovel = limparPoly(imovel ? imovel.poly : []);
  const bb = { minx: Infinity, maxx: -Infinity, minz: Infinity, maxz: -Infinity };
  for (const q of polyImovel) { bb.minx = Math.min(bb.minx, q[0]); bb.maxx = Math.max(bb.maxx, q[0]); bb.minz = Math.min(bb.minz, q[1]); bb.maxz = Math.max(bb.maxz, q[1]); }
  const centro = new THREE.Vector3((bb.minx + bb.maxx) / 2, 0, (bb.minz + bb.maxz) / 2);

  const areas = {};
  for (const a of dados.areas) if (a && a.poly) areas[a.tipo] = limparPoly(a.poly);

  // ---- Vias: suavizadas; as ruas encostam no eixo da avenida mais próxima (a planta deixa uma folga)
  const avenidas = dados.vias.filter((v) => v.tipo === 'avenida').map((v) => ({ ...v, pts: suavizarVia(v.pts) }));
  const vias = dados.vias.map((v) => {
    if (v.tipo === 'avenida') return avenidas.find((a) => a.nome === v.nome);
    const pts = v.pts.map((q) => [q[0], q[1]]);
    if (v.tipo === 'rua') {
      for (const k of [0, pts.length - 1]) {
        let melhor = null;
        for (const av of avenidas) for (let i = 1; i < av.pts.length; i++) {
          const { t, q } = projSeg(pts[k], av.pts[i - 1], av.pts[i]);
          if (t < -0.02 || t > 1.02) continue;
          const d = Math.hypot(q[0] - pts[k][0], q[1] - pts[k][1]);
          if (d < 26 && (!melhor || d < melhor.d)) melhor = { d, q };
        }
        if (melhor) pts[k] = melhor.q;
      }
    }
    return { ...v, pts };
  });
  const LARG = { avenida: 14, rua: 9, acesso: 10 };
  const segVias = [];
  for (const v of vias) for (let i = 1; i < v.pts.length; i++) segVias.push({ a: v.pts[i - 1], b: v.pts[i], w: LARG[v.tipo] || 9 });

  // Estrada de Duas Vendas: da portaria rumo ao norte (Poções), estendida para fora da cena
  let estrada = (dados.decor && dados.decor.estrada) ? dados.decor.estrada.map((q) => [q[0], q[1]]) : [];
  if (estrada.length > 1) {
    const f = estrada[estrada.length - 1];
    estrada = estrada.concat([[f[0] + 30, f[1] - 500], [f[0] + 10, f[1] - 1100], [f[0] - 60, f[1] - 2400], [f[0] - 150, f[1] - 4200]]);
    for (let i = 1; i < estrada.length; i++) segVias.push({ a: estrada[i - 1], b: estrada[i], w: 8 });
  }

  const pertoDeVia = (p, folga) => segVias.some((s) => distSeg(p, s.a, s.b) < s.w / 2 + folga);
  const distVia = (p) => segVias.reduce((m, s) => Math.min(m, distSeg(p, s.a, s.b)), Infinity);

  // ---- Maquete: base = contorno do imóvel + faixa de 65 m de gramado (cantos arredondados); a estrada é cortada na borda
  const base = afastarPoligono(simplificarPoly(polyImovel, 4), 65);
  const naBase = (x, z) => dentro([x, z], base);
  const [estradaBase, estradaFora] = cortarNaSaida(estrada, base);

  // ---- Grade espacial dos lotes (clique e plantio)
  const lotes = [];
  for (const l of dados.lotes) {
    const poly = limparPoly(l.poly || []);
    if (poly.length < 3) continue;
    const xs = poly.map((q) => q[0]), zs = poly.map((q) => q[1]);
    lotes.push({ id: String(l.id), gleba: l.gleba, status: l.status, poly, c: Array.isArray(l.c) ? l.c : centroide(poly), area: l.area,
      bb: [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)] });
  }
  const CEL = 60;
  const grade = new Map();
  const chave = (i, j) => i * 100003 + j;
  lotes.forEach((l, k) => {
    for (let i = Math.floor(l.bb[0] / CEL); i <= Math.floor(l.bb[2] / CEL); i++)
      for (let j = Math.floor(l.bb[1] / CEL); j <= Math.floor(l.bb[3] / CEL); j++) {
        const c = chave(i, j); if (!grade.has(c)) grade.set(c, []); grade.get(c).push(k);
      }
  });
  function loteEm(x, z) {
    const lista = grade.get(chave(Math.floor(x / CEL), Math.floor(z / CEL)));
    if (!lista) return null;
    for (const k of lista) { const l = lotes[k]; if (x >= l.bb[0] && x <= l.bb[2] && z >= l.bb[1] && z <= l.bb[3] && dentro([x, z], l.poly)) return l; }
    return null;
  }

  // ================================================================ 1) Céu, luz e neblina
  const ceuCores = { topo: new THREE.Color('#4F8FD6'), meio: new THREE.Color('#9CC3EA'), horiz: new THREE.Color('#CFDDE8') };
  const ceuGeo = new THREE.SphereGeometry(40000, 32, 16);
  const ceuCol = [];
  const pp = ceuGeo.attributes.position;
  for (let i = 0; i < pp.count; i++) {
    const h = pp.getY(i) / 40000;
    const c = h > 0.25 ? ceuCores.meio.clone().lerp(ceuCores.topo, Math.min(1, (h - 0.25) / 0.6)) : ceuCores.horiz.clone().lerp(ceuCores.meio, Math.max(0, h / 0.25));
    ceuCol.push(c.r, c.g, c.b);
  }
  ceuGeo.setAttribute('color', new THREE.Float32BufferAttribute(ceuCol, 3));
  const ceu = new THREE.Mesh(ceuGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  ceu.renderOrder = -10; ceu.frustumCulled = false;
  const entorno = new THREE.Group(); entorno.name = 'entorno'; scene.add(entorno);
  const maquete = new THREE.Group(); maquete.name = 'maquete'; scene.add(maquete);
  entorno.add(ceu);
  const neblina = new THREE.Fog(ceuCores.horiz.getHex(), 4000, 16000);
  scene.fog = neblina;

  const hemi = new THREE.HemisphereLight('#E4EEFF', '#7A6848', 1.25);
  scene.add(hemi);
  const sol = new THREE.DirectionalLight('#FFF0D8', 2.6);
  const dirSol = new THREE.Vector3(-0.55, 0.9, -0.62).normalize(); // tarde, sol a noroeste (hemisfério sul: norte = -Z)
  sol.position.copy(centro).addScaledVector(dirSol, 3000);
  sol.target.position.copy(centro);
  scene.add(sol, sol.target);

  // ================================================================ 2) Terreno de fora (caatinga, morros ao longe)
  // Plano até ~1,1 km do imóvel (onde ficam a caatinga e as árvores de fora) e ao longo da estrada; depois, morros suaves.
  const margem = 950;
  const segEstrada = [];
  const altFora = (x, z) => {
    const dx = Math.max(bb.minx - margem - x, 0, x - bb.maxx - margem);
    const dz = Math.max(bb.minz - margem - z, 0, z - bb.maxz - margem);
    const d = Math.hypot(dx, dz);
    if (d <= 0) return -0.8;
    let fe = 1;
    for (const s of segEstrada) fe = Math.min(fe, Math.max(0, (distSeg([x, z], s.a, s.b) - 40) / 320));
    if (fe <= 0) return -0.8;
    const s = Math.min(1, d / 2200); const suave = s * s * (3 - 2 * s);
    return -0.8 + fe * (suave * (35 + 190 * nz(x / 2000, z / 2000, 3)) + Math.max(0, d - 3400) * 0.05 * nz(x / 900 + 3, z / 900, 2));
  };
  for (let i = 1; i < estrada.length; i++) segEstrada.push({ a: estrada[i - 1], b: estrada[i] });
  const TAM_X = 20000, TAM_Z = 16000;
  const chao = new THREE.PlaneGeometry(TAM_X, TAM_Z, 200, 160);
  chao.rotateX(-Math.PI / 2);
  chao.translate(centro.x, 0, centro.z);
  const cp = chao.attributes.position; const cc = [];
  const coresFora = PALETA.chaoFora.map((h) => new THREE.Color(h));
  for (let i = 0; i < cp.count; i++) {
    const x = cp.getX(i), z = cp.getZ(i);
    cp.setY(i, altFora(x, z));
    const n1 = nz(x / 420, z / 420, 3), n2 = nz(x / 120 + 9, z / 120, 2);
    // mosaico: manchas de mato (n1 alto) sobre pasto claro, com capim e pasto seco variando (n2)
    const mato = THREE.MathUtils.smoothstep(n1, 0.47, 0.58);
    const c = coresFora[0].clone().lerp(coresFora[3], Math.max(0, Math.min(1, (n2 - 0.42) * 1.8)))
      .lerp(coresFora[1], Math.max(0, Math.min(1, (0.36 - n2) * 3)) * 0.6 * (1 - mato))
      .lerp(coresFora[2], mato * 0.92);
    cc.push(c.r, c.g, c.b);
  }
  chao.setAttribute('color', new THREE.Float32BufferAttribute(cc, 3));
  chao.computeVertexNormals();
  chao.attributes.uv.array.forEach((_, i, a) => { a[i] *= 520; });
  const matChaoFora = new THREE.MeshLambertMaterial({ vertexColors: true, map: T.grama });
  const chaoFora = new THREE.Mesh(chao, matChaoFora);
  chaoFora.renderOrder = 0; chaoFora.receiveShadow = true; chaoFora.frustumCulled = false;
  entorno.add(chaoFora);

  // ---- Maquete: topo da base (pasto em volta), laterais em terra e sombra sobre o "papel"
  const ALT_BASE = 24;
  {
    const topo = planos(new THREE.Mesh(malhaPoligonos([base], { uv: 20 }).geom, matPlano({ color: '#B9C47F', map: T.grama })), 0.5);
    maquete.add(topo);
    // laterais: faixa de grama no alto e camadas de terra descendo
    const pos = [], nor = [], col = [];
    const cG = new THREE.Color('#86A553'), cT1 = new THREE.Color('#B48B62'), cT2 = new THREE.Color('#8A6546'), cT3 = new THREE.Color('#6A4C35');
    const cx = base.reduce((a, q) => a + q[0], 0) / base.length, cz = base.reduce((a, q) => a + q[1], 0) / base.length;
    const faixas = [[0, cG], [-1.4, cG], [-1.45, cT1], [-ALT_BASE * 0.55, cT2], [-ALT_BASE, cT3]];
    for (let i = 0; i < base.length; i++) {
      const a = base[i], b = base[(i + 1) % base.length];
      let nx = b[1] - a[1], nz2 = -(b[0] - a[0]); const L = Math.hypot(nx, nz2) || 1; nx /= L; nz2 /= L;
      const mx = (a[0] + b[0]) / 2 - cx, mz = (a[1] + b[1]) / 2 - cz;
      const fora = mx * nx + mz * nz2 >= 0;
      const [p1, p2] = fora ? [a, b] : [b, a]; // sentido que deixa a face voltada para fora (normal = (dz, 0, -dx))
      if (!fora) { nx = -nx; nz2 = -nz2; }
      for (let k = 0; k < faixas.length - 1; k++) {
        const [y0, c0] = faixas[k], [y1, c1] = faixas[k + 1];
        const v = [[p1, y0, c0], [p2, y0, c0], [p2, y1, c1], [p1, y0, c0], [p2, y1, c1], [p1, y1, c1]];
        for (const [q, y, c] of v) { pos.push(q[0], y, q[1]); nor.push(nx, 0, nz2); col.push(c.r, c.g, c.b); }
      }
    }
    const gl = new THREE.BufferGeometry();
    gl.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    gl.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    gl.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const laterais = new THREE.Mesh(gl, new THREE.MeshLambertMaterial({ vertexColors: true }));
    laterais.renderOrder = 20; laterais.frustumCulled = false;
    maquete.add(laterais);
    // "papel" e sombra da maquete (mancha desfocada no formato da base, deslocada para longe do sol)
    const xs = base.map((q) => q[0]), zs = base.map((q) => q[1]);
    const x0 = Math.min(...xs) - 400, x1 = Math.max(...xs) + 400, z0 = Math.min(...zs) - 400, z1 = Math.max(...zs) + 400;
    const papel = new THREE.Mesh(new THREE.PlaneGeometry(60000, 60000).rotateX(-Math.PI / 2).translate(centro.x, -ALT_BASE - 0.6, centro.z),
      new THREE.MeshBasicMaterial({ color: '#EFE9DA', fog: false, depthWrite: false }));
    papel.renderOrder = -3; papel.frustumCulled = false;
    maquete.add(papel);
    const W = 1024, H = Math.round(W * (z1 - z0) / (x1 - x0));
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g2 = cv.getContext('2d');
    g2.filter = 'blur(22px)';
    g2.fillStyle = 'rgba(60,45,25,.55)';
    g2.beginPath(); base.forEach((q, i) => { const X = (q[0] - x0) / (x1 - x0) * W, Y = (q[1] - z0) / (z1 - z0) * H; if (i) g2.lineTo(X, Y); else g2.moveTo(X, Y); }); g2.closePath(); g2.fill();
    const texS = new THREE.CanvasTexture(cv); texS.colorSpace = THREE.SRGBColorSpace;
    const off = new THREE.Vector3(-dirSol.x, 0, -dirSol.z).normalize().multiplyScalar(ALT_BASE * 2.2);
    const sombraBase = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0).rotateX(-Math.PI / 2).translate((x0 + x1) / 2 + off.x, -ALT_BASE - 0.5, (z0 + z1) / 2 + off.z),
      new THREE.MeshBasicMaterial({ map: texS, transparent: true, depthWrite: false, fog: false }));
    sombraBase.renderOrder = -2; sombraBase.frustumCulled = false;
    maquete.add(sombraBase);
  }

  // ================================================================ 3) Chão do imóvel e áreas
  const grupoPlano = new THREE.Group(); grupoPlano.name = 'planos'; scene.add(grupoPlano);
  const texGrama = T.grama;

  // variação suave de cor dentro do imóvel (vértices extras numa grade de 40 m ficariam caros): usa a textura + cor
  const imovelMesh = planos(new THREE.Mesh(malhaPoligonos([polyImovel], { uv: 22 }).geom, matPlano({ color: PALETA.chaoImovel, map: texGrama })), 1);
  grupoPlano.add(imovelMesh);

  if (areas.reserva) grupoPlano.add(planos(new THREE.Mesh(malhaPoligonos([areas.reserva], { uv: 14 }).geom, matPlano({ color: PALETA.mata, map: texGrama })), 2));
  if (areas.clube) grupoPlano.add(planos(new THREE.Mesh(malhaPoligonos([areas.clube], { uv: 9 }).geom, matPlano({ color: PALETA.gramado, map: texGrama })), 2));
  if (areas.area_comum) grupoPlano.add(planos(new THREE.Mesh(malhaPoligonos([areas.area_comum], { uv: 9 }).geom, matPlano({ color: PALETA.jardim, map: texGrama })), 2));

  // ================================================================ 4) Vias cascalhadas (com acostamento mais escuro)
  const matVia = matPlano({ color: PALETA.cascalho, map: T.cascalho });
  const matViaBorda = matPlano({ color: PALETA.cascalhoBorda, map: T.cascalho });
  const geoPista = [], geoBorda = [];
  for (const v of vias) {
    const w = LARG[v.tipo] || 9;
    geoBorda.push(fita(v.pts, w + 3.2, { vRep: 14 }));
    geoPista.push(fita(v.pts, w, { vRep: 14 }));
    // "cotovelo" arredondado nas pontas e nas quinas
    for (const q of v.pts) { geoBorda.push(disco(q[0], q[1], (w + 3.2) / 2, 0, 20)); geoPista.push(disco(q[0], q[1], w / 2, 0, 20)); }
  }
  if (estradaBase.length > 1) {
    geoBorda.push(fita(estradaBase, 11, { vRep: 14 }));
    geoPista.push(fita(estradaBase, 8, { vRep: 14 }));
    for (const q of estradaBase.slice(0, -1)) { geoBorda.push(disco(q[0], q[1], 5.5, 0, 20)); geoPista.push(disco(q[0], q[1], 4, 0, 20)); }
  }
  const soPlano = (g) => { const n = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'uv'].includes(k)) n.deleteAttribute(k); return n; };
  if (estradaFora.length > 1) {
    const gb = [fita(estradaFora, 11, { vRep: 14 })], gp = [fita(estradaFora, 8, { vRep: 14 })];
    for (const q of estradaFora) { gb.push(disco(q[0], q[1], 5.5, 0, 20)); gp.push(disco(q[0], q[1], 4, 0, 20)); }
    entorno.add(planos(new THREE.Mesh(mergeGeometries(gb.map(soPlano)), matViaBorda), 3));
    entorno.add(planos(new THREE.Mesh(mergeGeometries(gp.map(soPlano)), matVia), 4));
  }
  grupoPlano.add(planos(new THREE.Mesh(mergeGeometries(geoBorda.map(soPlano)), matViaBorda), 3));
  grupoPlano.add(planos(new THREE.Mesh(mergeGeometries(geoPista.map(soPlano)), matVia), 4));

  // ================================================================ 5) Lotes (uma malha só, cor por vértice = status)
  const coresStatus = {};
  for (const [k, h] of Object.entries(PALETA.lote)) coresStatus[k] = new THREE.Color(h);
  const corApagada = new THREE.Color(PALETA.loteApagado);
  // semStatus: imagens de apresentação (renders e planta-guia) não mostram disponibilidade, que muda todo dia
  const neutro = new THREE.Color('#B9C77F');
  const loteCores = lotes.map((l) => {
    // soDisponiveis (esferas 360° do tour): só as unidades à venda ganham cor; as demais ficam em tom de terreno
    const c = (op.semStatus ? neutro : op.soDisponiveis ? (l.status === 'disponivel' ? new THREE.Color('#12D05A') : neutro) : (coresStatus[l.status] || coresStatus.reservado)).clone();
    const hsl = {}; c.getHSL(hsl);
    c.setHSL(hsl.h, hsl.s, hsl.l * (0.94 + r() * 0.1)); // leve variação: aspecto natural, não "planilha"
    return c;
  });
  // (a) terreno natural de cada lote: pasto verde, capim e pasto seco (varia de lote para lote)
  const pastos = ['#A7BE68', '#B5BD74', '#9DB862', '#C0BD7C', '#AFC16F'];
  const malhaNat = malhaPoligonos(lotes.map((l) => l.poly), { uv: 13, cores: lotes.map(() => pastos[Math.floor(r() * pastos.length)]) });
  grupoPlano.add(planos(new THREE.Mesh(malhaNat.geom, matPlano({ vertexColors: true, map: texGrama })), 5.8));
  // (b) véu da situação: forte de longe (leitura de mapa), suave de perto (aparece o terreno)
  const malhaLotes = malhaPoligonos(lotes.map((l) => l.poly), { uv: 16, cores: loteCores.map((c) => '#' + c.getHexString()) });
  const matLotes = matPlano({ vertexColors: true, map: texGrama, transparent: true, opacity: 0.9 });
  const loteMesh = planos(new THREE.Mesh(malhaLotes.geom, matLotes), 6);
  loteMesh.name = 'lotes';
  grupoPlano.add(loteMesh);
  // esferas 360° do tour: as unidades à venda ganham uma camada verde viva, sem luz (aparece de longe e com céu)
  if (op.soDisponiveis) {
    const disp = lotes.filter((l) => l.status === 'disponivel').map((l) => l.poly);
    if (disp.length) {
      const mDisp = planos(new THREE.Mesh(malhaPoligonos(disp, { y: 0.6 }).geom, matPlano({ color: '#39C96C', emissive: '#1FA650', emissiveIntensity: 0.55, depthTest: false })), 6.3);
      mDisp.renderOrder = 6.9; mDisp.name = 'disponiveis'; grupoPlano.add(mDisp);   // sem teste de profundidade: quem chama põe árvores/prédios depois
    }
  }
  // (c) contorno colorido por dentro de cada lote (1,6 m), sempre nítido
  const contornos = [], faixaCont = new Map();
  let vtx = 0;
  lotes.forEach((l, k) => {
    const pp = simplificarPoly(l.poly, 3);
    if (pp.length < 3) return;
    const g = fita(recuar(pp, 1.1), 1.6, { fechar: true });
    const n = g.attributes.position.count;
    const cor2 = loteCores[k];
    const cols = new Float32Array(n * 3); for (let i = 0; i < n; i++) { cols[i * 3] = cor2.r; cols[i * 3 + 1] = cor2.g; cols[i * 3 + 2] = cor2.b; }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    const gn = g.toNonIndexed();
    faixaCont.set(l.id, { inicio: vtx, qtd: gn.attributes.position.count });
    vtx += gn.attributes.position.count;
    contornos.push(gn);
  });
  const geoCont = mergeGeometries(contornos);
  const contMesh = planos(new THREE.Mesh(geoCont, matPlano({ vertexColors: true })), 7.5);
  grupoPlano.add(contMesh);
  const loteFaixa = new Map(); lotes.forEach((l, k) => loteFaixa.set(l.id, { ...malhaLotes.faixas[k], cor: loteCores[k], lote: l }));

  const linhasLotes = new THREE.LineSegments(bordas(lotes.map((l) => l.poly), 0), new THREE.LineBasicMaterial({ color: PALETA.loteBorda, transparent: true, opacity: op.semStatus ? 0.5 : 0.7, depthWrite: false }));
  linhasLotes.renderOrder = 7; linhasLotes.frustumCulled = false;
  grupoPlano.add(linhasLotes);
  const linhasGlebas = new THREE.LineSegments(bordas(dados.glebas.map((g) => g.poly), 0), new THREE.LineBasicMaterial({ color: '#2E5A3A', transparent: true, opacity: 0.55, depthWrite: false }));
  linhasGlebas.renderOrder = 7; linhasGlebas.frustumCulled = false;
  grupoPlano.add(linhasGlebas);

  // Selo de cada gleba (a planta abre um círculo no número): pracinha clara com o número (rótulo HTML por cima)
  const geoSelos = [];
  for (const g of dados.glebas) if (Array.isArray(g.label)) geoSelos.push(disco(g.label[0], g.label[1], 11.5, 0, 28));
  if (geoSelos.length && !op.semStatus) grupoPlano.add(planos(new THREE.Mesh(mergeGeometries(geoSelos.map(soPlano)), matPlano({ color: '#ABBE6B', map: texGrama })), 5.9));

  function pintarLote(id, c) {
    const f = loteFaixa.get(String(id)); if (!f) return;
    const at = malhaLotes.geom.attributes.color;
    for (let i = 0; i < f.qtd; i++) at.setXYZ(f.inicio + i, c.r, c.g, c.b);
    at.needsUpdate = true;
    const fc = faixaCont.get(String(id));
    if (fc) { const ac = geoCont.attributes.color; for (let i = 0; i < fc.qtd; i++) ac.setXYZ(fc.inicio + i, c.r, c.g, c.b); ac.needsUpdate = true; }
  }
  // opacidade do véu conforme a distância da câmera: 0,9 de longe → 0,32 de perto
  function ajustarDistancia(d) {
    const t = THREE.MathUtils.clamp((d - 220) / (1900 - 220), 0, 1);
    matLotes.opacity = 0.32 + (0.9 - 0.32) * t;
    linhasLotes.material.opacity = 0.35 + 0.35 * (1 - t);
  }
  function corBase(id) { const f = loteFaixa.get(String(id)); return f ? f.cor : null; }

  // ---- Destaque do lote selecionado: contorno dourado + véu claro
  const destaque = new THREE.Group(); destaque.visible = false; grupoPlano.add(destaque);
  const matVeu = new THREE.MeshBasicMaterial({ color: '#FFF6D6', transparent: true, opacity: 0.35, depthWrite: false, fog: false, side: THREE.DoubleSide });
  const matContorno = new THREE.MeshBasicMaterial({ color: PALETA.dourado, depthWrite: false, fog: false, side: THREE.DoubleSide });
  function mostrarDestaque(id) {
    const f = loteFaixa.get(String(id));
    destaque.clear();
    if (!f) { destaque.visible = false; return; }
    const veu = new THREE.Mesh(malhaPoligonos([f.lote.poly]).geom, matVeu); veu.renderOrder = 9;
    const cont = new THREE.Mesh(fita(f.lote.poly, 1.8, { fechar: true }), matContorno); cont.renderOrder = 10;
    destaque.add(veu, cont); destaque.visible = true;
  }
  function esconderDestaque() { destaque.visible = false; destaque.clear(); }

  // ================================================================ 6) Lago natural (sem píer e sem deck)
  if (areas.lago) {
    const cl = centroide(areas.lago);
    const margemPoly = areas.lago.map((q) => { const dx = q[0] - cl[0], dz = q[1] - cl[1], L = Math.hypot(dx, dz) || 1; return [q[0] + dx / L * 4.5, q[1] + dz / L * 4.5]; });
    grupoPlano.add(planos(new THREE.Mesh(malhaPoligonos([margemPoly], { uv: 6 }).geom, matPlano({ color: PALETA.margem, map: T.areia })), 5));
    const matAgua = new THREE.MeshStandardMaterial({ color: PALETA.agua, roughness: 0.08, metalness: 0.0, transparent: false, side: THREE.DoubleSide });
    const agua = new THREE.Mesh(malhaPoligonos([areas.lago]).geom, matAgua);
    agua.renderOrder = 6; agua.material.depthWrite = false; agua.name = 'agua';
    grupoPlano.add(agua);
  }

  // ================================================================ 7) Vegetação (instanciada: poucas chamadas de desenho)
  const itens = {};
  for (const it of (dados.decor && dados.decor.lazer) || []) itens[it.id] = it.c;
  const entrada = Array.isArray(dados.meta.entrada) ? dados.meta.entrada : null;
  // pegadas das construções (raio em m): nenhuma árvore nasce dentro delas
  const RAIO_ITEM = { salao: 17, piscina: 18, quiosques: 24, banheiros: 11, quadra: 15, baias: 24, fazendinha: 17 };
  const pegadas = Object.entries(itens).map(([k, c]) => ({ c, r: RAIO_ITEM[k] || 14 }));
  if (entrada) pegadas.push({ c: entrada, r: 22 });
  const ocupado = (x, z) => pegadas.some((g) => Math.hypot(g.c[0] - x, g.c[1] - z) < g.r);
  // eixo da parte baixa da faixa (clube): u desce rumo ao lago, v atravessa (dados.decor.eixo_clube)
  const eixoC = (dados.decor && dados.decor.eixo_clube) || { o: centroide(areas.clube || polyImovel), u: [-0.747, 0.665], v: [0.665, 0.747] };
  const uE = eixoC.u, vE = eixoC.v, OC = eixoC.o;
  const noClube = (s2, t2) => [OC[0] + uE[0] * s2 + vE[0] * t2, OC[1] + uE[1] * s2 + vE[1] * t2];
  const angU = Math.atan2(-uE[1], uE[0]); // x local ao longo da faixa
  const angV = Math.atan2(-vE[1], vE[0]); // x local atravessado (z local aponta para o lago)
  // caminhos internos do clube: um eixo central e um ramal até cada construção
  const caminhos = [];
  if (Object.keys(itens).length) {
    caminhos.push([noClube(-82, -5), noClube(-40, -4), noClube(10, -3), noClube(80, -5)]);
    for (const c of Object.values(itens)) {
      const s2 = (c[0] - OC[0]) * uE[0] + (c[1] - OC[1]) * uE[1];
      caminhos.push([noClube(s2, -3.5), c]);
    }
    for (const cm of caminhos) for (let i = 1; i < cm.length; i++) segVias.push({ a: cm[i - 1], b: cm[i], w: 3 });
  }
  const arvores = []; // [x, z, altura, raio, tipo(0 copa redonda | 1 guarda-chuva | 2 palmeira), corIdx]
  const livre = (x, z, folgaVia = 3) => {
    if (ocupado(x, z)) return false;
    if (loteEm(x, z)) return false;
    if (pertoDeVia([x, z], folgaVia)) return false;
    if (areas.lago && dentro([x, z], areas.lago)) return false;
    return true;
  };
  const plantar = (x, z, esc = 1, tipo = r() < 0.35 ? 1 : 0, longe = false) => {
    const h = (5 + r() * 6) * esc;
    arvores.push([x, z, h, (tipo === 1 ? 3.6 + r() * 2.4 : 2.4 + r() * 1.8) * esc, tipo, Math.floor(r() * PALETA.folhas.length), longe]);
  };

  // (a) mata da reserva: bem densa
  if (areas.reserva) {
    const passo = 8.5 / Math.sqrt(Q.arv);
    const [x0, z0, x1, z1] = [Math.min(...areas.reserva.map((q) => q[0])), Math.min(...areas.reserva.map((q) => q[1])), Math.max(...areas.reserva.map((q) => q[0])), Math.max(...areas.reserva.map((q) => q[1]))];
    for (let x = x0; x < x1; x += passo) for (let z = z0; z < z1; z += passo) {
      const px = x + (r() - 0.5) * passo * 0.9, pz = z + (r() - 0.5) * passo * 0.9;
      if (!dentro([px, pz], areas.reserva) || !livre(px, pz, 2)) continue;
      if (r() < 0.12) continue;
      // borda irregular: perto do limite a mata fica mais rala e mais baixa (não parece um bloco recortado)
      let dBorda = Infinity;
      for (let i = 0; i < areas.reserva.length; i++) dBorda = Math.min(dBorda, distSeg([px, pz], areas.reserva[i], areas.reserva[(i + 1) % areas.reserva.length]));
      const borda = Math.max(0, 1 - dBorda / 40);
      if (r() < borda * (0.35 + 0.5 * nz(px / 60, pz / 60, 2))) continue;
      plantar(px, pz, (1.05 + r() * 0.35) * (1 - borda * 0.3), r() < 0.25 ? 1 : 0, true);
    }
  }
  // (b) árvores já existentes que o pipeline 2D posicionou (margens, entrada, faixas)
  if (dados.decor && Array.isArray(dados.decor.arvores)) {
    for (const a of dados.decor.arvores) if (Array.isArray(a) && livre(a[0], a[1], 2)) plantar(a[0], a[1], (a[3] || 1) * 0.95);
  }
  // (c) árvores nativas espalhadas dentro do imóvel (fora dos lotes e das vias) e alguns pés dentro dos lotes
  {
    const passo = 34 / Math.sqrt(Q.arv);
    for (let x = bb.minx; x < bb.maxx; x += passo) for (let z = bb.minz; z < bb.maxz; z += passo) {
      const px = x + (r() - 0.5) * passo, pz = z + (r() - 0.5) * passo;
      if (!dentro([px, pz], polyImovel) || ocupado(px, pz)) continue;
      if (areas.reserva && dentro([px, pz], areas.reserva)) continue;
      const lt = loteEm(px, pz);
      if (lt) { if (r() < 0.14 && !pertoDeVia([px, pz], 6)) plantar(px, pz, 0.8 + r() * 0.3, r() < 0.6 ? 1 : 0); continue; }
      if (pertoDeVia([px, pz], 3) || (areas.lago && dentro([px, pz], areas.lago))) continue;
      if (r() < 0.55) plantar(px, pz, 0.9 + r() * 0.3);
    }
  }
  // (d) alinhamento ao longo da cerca do perímetro (lado de dentro)
  {
    const passo = 22 / Math.sqrt(Q.arv);
    for (let i = 0; i < polyImovel.length; i++) {
      const a = polyImovel[i], b = polyImovel[(i + 1) % polyImovel.length];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (let s = passo / 2; s < L; s += passo) {
        const t = s / L; const x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
        const ox = (r() - 0.5) * 16, oz = (r() - 0.5) * 16;
        if (livre(x + ox, z + oz, 3) && r() < 0.7) plantar(x + ox, z + oz, 0.9 + r() * 0.3);
      }
    }
  }
  // (e) caatinga em volta do imóvel (fora da cerca), em manchas
  {
    const passo = 22 / Math.sqrt(Q.arv * Q.fora);
    const ext = qualidade === 'render' ? 1500 : 900;
    for (let x = bb.minx - ext; x < bb.maxx + ext; x += passo) for (let z = bb.minz - ext; z < bb.maxz + ext; z += passo) {
      const px = x + (r() - 0.5) * passo, pz = z + (r() - 0.5) * passo;
      if (dentro([px, pz], polyImovel)) continue;
      if (pertoDeVia([px, pz], 4)) continue;
      const mato = THREE.MathUtils.smoothstep(nz(px / 420, pz / 420, 3), 0.46, 0.6);
      if (r() > mato * 0.85 + 0.02) continue;
      plantar(px, pz, 0.85 + r() * 0.35, r() < 0.5 ? 1 : 0, true);
      arvores[arvores.length - 1].foraBase = !naBase(px, pz);
    }
  }

  // ================================================================ 8) Área de lazer, portaria e detalhes humanizados
  const humanizado = new THREE.Group(); humanizado.name = 'humanizado';
  const M = criarMateriais(T);
  const pessoas = [];

  // clube na parte baixa da faixa (implantação do projeto): construções alinhadas ao eixo; o salão abre para a piscina
  const angSalao = itens.salao && itens.piscina ? Math.atan2(itens.piscina[0] - itens.salao[0], itens.piscina[1] - itens.salao[1]) : angU;
  if (itens.salao) humanizado.add(salao(M, itens.salao, angSalao));
  if (itens.piscina) humanizado.add(piscina(M, itens.piscina, angV, r, pessoas));
  if (itens.quiosques) humanizado.add(quiosques(M, itens.quiosques, angV, pessoas, r));
  if (itens.banheiros) humanizado.add(banheiros(M, itens.banheiros, angU));
  if (itens.quadra) humanizado.add(quadra(M, itens.quadra, angU, pessoas));
  if (itens.baias) humanizado.add(baias(M, itens.baias, angU, r));
  if (itens.fazendinha) humanizado.add(fazendinha(M, itens.fazendinha, angU, r));
  // caminhos de pedrisco (eixo + ramais)
  if (caminhos.length) {
    const gc = caminhos.map((cm, i) => fita(cm, i ? 2.2 : 3.2, { vRep: 6 }));
    for (const cm of caminhos) for (const q of cm) gc.push(disco(q[0], q[1], 1.6, 0, 14));
    grupoPlano.add(planos(new THREE.Mesh(mergeGeometries(gc.map((g) => { const n = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'uv'].includes(k)) n.deleteAttribute(k); return n; })), matPlano({ color: '#E6D7B2', map: T.areia })), 5));
  }
  // pessoas espalhadas pelo gramado do clube
  for (let i = 0, k = 0; i < 12 && k < 200 && areas.clube; k++) {
    const q = noClube(-40 + r() * 110, -40 + r() * 80);
    if (!dentro(q, areas.clube) || ocupado(q[0], q[1]) || (areas.lago && dentro(q, areas.lago))) continue;
    pessoas.push(q); i++;
  }

  // Portaria (guarita 15 m², duas entradas e uma saída) na entrada
  if (entrada) {
    const alvo = estrada.length > 1 ? estrada[1] : [entrada[0] - 1, entrada[1]];
    const angEntrada = Math.atan2(-(alvo[1] - entrada[1]), alvo[0] - entrada[0]);
    humanizado.add(portaria(M, entrada, angEntrada, T));
    humanizado.add(carro(M, [entrada[0] + 30, entrada[1] - 2], 0, '#F4F4F2'));
    humanizado.add(carro(M, [entrada[0] - 38, entrada[1] - 26], angEntrada, '#9FA7AE'));
    pessoas.push([entrada[0] + 6, entrada[1] + 9], [entrada[0] + 7.5, entrada[1] + 9.5]);
  }
  // palmeiras em volta da piscina
  if (itens.piscina) {
    const [px, pz] = itens.piscina;
    for (const [lx, lz] of [[-15, -9], [15, -9], [-15, 9.5], [16, 9]]) arvores.push([px + lx * vE[0] + lz * uE[0], pz + lx * vE[1] + lz * uE[1], 7.5 + r() * 2, 3, 2, 0]);
  }
  // árvores de sombra no gramado e em volta do lago
  if (areas.clube) {
    for (let i = 0; i < 90 * Q.arv; i++) {
      const x = -150 + r() * 400, z = 650 + r() * 430;
      if (!dentro([x, z], areas.clube)) continue;
      if (ocupado(x, z) || pertoDeVia([x, z], 3) || (areas.lago && dentro([x, z], areas.lago))) continue;
      plantar(x, z, 0.9 + r() * 0.3, r() < 0.4 ? 1 : 0);
    }
  }
  if (areas.lago) {
    const cl = centroide(areas.lago);
    for (let i = 0; i < 26; i++) {
      const a = r() * Math.PI * 2, d = 48 + r() * 22;
      const x = cl[0] + Math.cos(a) * d, z = cl[1] + Math.sin(a) * d;
      if (!ocupado(x, z) && !pertoDeVia([x, z], 3)) plantar(x, z, 1 + r() * 0.25, 0);
    }
  }
  // pessoas: poucas, só para dar escala (sem nomes nem rostos)
  humanizado.add(gente(pessoas, r));

  otimizar(humanizado);
  scene.add(humanizado);

  // ---- Cerca do perímetro (executada): mourões + 3 fios
  const cerca = cercaPerimetro(polyImovel, M, entrada);
  scene.add(cerca);

  // ---- Rede elétrica (executada): postes ao longo das vias, fios e transformadores
  const rede = redeEletrica(vias, M, r);
  scene.add(rede);

  // ---- Piquetes da marcação das frações (executada) — só aparecem de perto
  if (Q.piquetes) scene.add(piquetes(lotes, M));

  // ---- Árvores instanciadas + sombras suaves
  const veg = vegetacao(arvores.filter((a) => !a.foraBase), M, T, Q.detalhe, qualidade === 'render' ? 1 : 0, dirSol);
  scene.add(veg.grupo);
  const vegLonge = vegetacao(arvores.filter((a) => a.foraBase), M, T, 0, qualidade === 'render' ? 1 : 0, dirSol);
  entorno.add(vegLonge.grupo);

  // ================================================================ 9) Âncoras dos rótulos (HTML sobre o canvas)
  const ancoras = { glebas: [], vias: [], marcadores: [], lotes: [], lazer: [] };
  for (const g of dados.glebas) {
    const c = Array.isArray(g.label) ? g.label : centroide(limparPoly(g.poly));
    ancoras.glebas.push({ id: String(g.id), p: new THREE.Vector3(c[0], 1.5, c[1]) });
  }
  const nomesAv = (dados.meta && dados.meta.avenidas) || ['Avenida Pau Ferro', 'Avenida Umbuzeiro'];
  for (const v of vias) {
    if (!v.nome || v.tipo === 'acesso') continue;
    if (v.tipo === 'avenida') {
      const volta = nomesAv[1] === v.nome;
      const nome = v.nome.replace(/^Avenida\s+/i, 'Av. ').toUpperCase();
      for (const fr of [0.16, 0.5, 0.84]) {
        const q = pontoAoLongo(v.pts, fr);
        ancoras.vias.push({ texto: volta ? `← ${nome}` : `${nome} →`, tipo: 'avenida', p: new THREE.Vector3(q[0], 3, q[1]), principal: fr === 0.5 });
      }
    } else {
      const topo = v.pts.reduce((a, b) => (b[1] < a[1] ? b : a));
      const base = v.pts.reduce((a, b) => (b[1] > a[1] ? b : a));
      ancoras.vias.push({ texto: v.nome.toUpperCase(), tipo: 'rua', p: new THREE.Vector3(topo[0], 3, topo[1] - 4), principal: true }); // sobre a Av. Pau Ferro, como no mapa ilustrado
      ancoras.vias.push({ texto: v.nome.toUpperCase(), tipo: 'rua', p: new THREE.Vector3(base[0], 3, base[1] - 24), principal: false });
    }
  }
  if (estradaBase.length > 1) {
    const meio = pontoAoLongo(estradaBase, 0.55);
    ancoras.vias.push({ texto: 'ESTRADA DE DUAS VENDAS', tipo: 'estrada', p: new THREE.Vector3(meio[0], 3, meio[1]), principal: true });
    const fim = estradaBase[estradaBase.length - 1];
    ancoras.vias.push({ texto: 'POÇÕES ↑', tipo: 'destino', p: new THREE.Vector3(fim[0], 3, fim[1]), principal: true });
  }
  for (const l of lotes) ancoras.lotes.push({ id: l.id, status: l.status, p: new THREE.Vector3(l.c[0], 0.5, l.c[1]) });
  for (const it of (dados.decor && dados.decor.lazer) || []) ancoras.lazer.push({ id: it.id, nome: it.nome, p: new THREE.Vector3(it.c[0], 6, it.c[1]) });
  if (areas.lago) { const c = centroide(areas.lago); ancoras.marcadores.push({ id: 'lago', nome: 'Lago', tipo: 'lago', p: new THREE.Vector3(c[0], 2, c[1]) }); }
  if (areas.reserva) {
    const pr = (dados.pontos || []).find((p) => p.tipo === 'reserva' && Array.isArray(p.c));
    const c = pr ? pr.c : centroide(areas.reserva);
    ancoras.marcadores.push({ id: 'reserva', nome: 'Área de preservação ambiental', tipo: 'reserva', p: new THREE.Vector3(c[0], 14, c[1]) });
  }

  // ================================================================ API
  return {
    scene, sol, hemi, dirSol, centro, bb, polyImovel, texturas: T,
    lotes, loteEm, pintarLote, corBase, coresStatus, corApagada, ajustarDistancia,
    mostrarDestaque, esconderDestaque,
    ancoras, arvoresQtd: arvores.length,
    sombrasBlob: { set visible(v) { veg.sombras.visible = v; vegLonge.sombras.visible = v; }, get visible() { return veg.sombras.visible; } },
    clareira: (a, b, raio) => { veg.clareira(a, b, raio); vegLonge.clareira(a, b, raio); },
    fecharClareira: () => { veg.restaurar(); vegLonge.restaurar(); },
    distVia, base, ALT_BASE,
    modo: 'entorno',
    // 'maquete': base com laterais de terra sobre fundo claro (padrão do mapa) · 'entorno': paisagem com céu e morros
    definirModo(modo, renderer) {
      this.modo = modo === 'maquete' ? 'maquete' : 'entorno';
      const mq = this.modo === 'maquete';
      maquete.visible = mq; entorno.visible = !mq;
      scene.background = mq ? new THREE.Color('#F1ECDF') : null;
      scene.fog = mq ? null : neblina;
      // maquete: cores fiéis (verde/vermelho/azul vivos, como no mapa ilustrado); entorno: aspecto fotográfico
      sol.intensity = mq ? 3.9 : 2.6;
      hemi.intensity = mq ? 1.95 : 0.75;
      if (renderer) {
        renderer.toneMapping = mq ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = mq ? 1 : 0.97;
        scene.traverse((o) => { if (o.isMesh && o.material) o.material.needsUpdate = true; });
      }
    },
    // sombra real de árvores, prédios e postes sobre o terreno inteiro; calculada uma vez (a cena não se mexe)
    sombraGlobal(renderer, ligar, tam = 4096) {
      renderer.shadowMap.enabled = !!ligar;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.shadowMap.autoUpdate = false;
      sol.castShadow = !!ligar;
      if (ligar) {
        sol.target.position.copy(centro);
        sol.position.copy(centro).addScaledVector(dirSol, 4000);
        sol.updateMatrixWorld(); sol.target.updateMatrixWorld();
        const vista = new THREE.Matrix4().lookAt(sol.position, sol.target.position, new THREE.Vector3(0, 1, 0));
        const inv = vista.clone().invert();
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (const q of base) for (const h of [0, 30]) {
          const v = new THREE.Vector3(q[0], h, q[1]).sub(sol.position).applyMatrix4(inv.clone().setPosition(0, 0, 0));
          x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
        }
        const cam = sol.shadow.camera;
        cam.left = x0 - 20; cam.right = x1 + 20; cam.bottom = y0 - 20; cam.top = y1 + 20; cam.near = 100; cam.far = 9000;
        cam.updateProjectionMatrix();
        sol.shadow.mapSize.set(tam, tam);
        sol.shadow.bias = -0.0006; sol.shadow.normalBias = 0.9; sol.shadow.radius = 2;
        if (sol.shadow.map) { sol.shadow.map.dispose(); sol.shadow.map = null; }
        renderer.shadowMap.needsUpdate = true;
      }
      veg.sombras.visible = !ligar; vegLonge.sombras.visible = !ligar;
      scene.traverse((o) => { if (o.isMesh && o.material) o.material.needsUpdate = true; });
    },
    alturaChao: (x, z) => (dentro([x, z], polyImovel) ? 0 : Math.max(0, altFora(x, z))),
    ligarSombrasReais(renderer, ligar, alvo, raio = 250) {
      renderer.shadowMap.enabled = !!ligar;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.shadowMap.autoUpdate = true;
      sol.castShadow = !!ligar;
      if (ligar) {
        const c = alvo || centro;
        sol.target.position.set(c.x, 0, c.z);
        sol.position.set(c.x, 0, c.z).addScaledVector(dirSol, raio * 3);
        const cam = sol.shadow.camera;
        cam.left = -raio; cam.right = raio; cam.top = raio; cam.bottom = -raio; cam.near = 1; cam.far = raio * 7;
        cam.updateProjectionMatrix();
        sol.shadow.mapSize.set(4096, 4096);
        sol.shadow.bias = -0.0004; sol.shadow.normalBias = 0.6;
        if (sol.shadow.map) { sol.shadow.map.dispose(); sol.shadow.map = null; }
      }
      scene.traverse((o) => { if (o.isMesh && o.material && o.material.needsUpdate !== undefined) o.material.needsUpdate = true; });
    },
  };
}

// =====================================================================
// Peças humanizadas (low-poly, material por tipo; tudo é fundido em poucas malhas no fim)
// =====================================================================
function criarMateriais(T) {
  const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, ...o });
  const telha = T.telha.clone(); telha.needsUpdate = true; telha.repeat.set(0.35, 0.35);
  const madeira = T.madeira.clone(); madeira.needsUpdate = true; madeira.repeat.set(0.5, 0.5);
  return {
    parede: std({ color: '#F3EEE3' }),
    paredeCreme: std({ color: '#EADCBE' }),
    telha: std({ color: '#FFFFFF', map: telha, roughness: 0.75 }),
    madeira: std({ color: '#FFFFFF', map: madeira }),
    madeiraEscura: std({ color: '#5E3F2A' }),
    vidro: std({ color: '#7FA9BE', roughness: 0.08, metalness: 0.25 }),
    pedra: std({ color: '#E2D5BD', map: T.pedra, roughness: 0.9 }),
    pedraClara: std({ color: '#E6DABE', map: T.pedra, roughness: 0.95 }),
    areiaSuave: std({ color: '#E4D2B0', roughness: 0.9 }),
    brancoGelo: std({ color: '#EFEAE0', roughness: 0.85 }),
    imbuia: std({ color: '#5A3A24', roughness: 0.7 }),
    pretoFosco: std({ color: '#1C1C1C', roughness: 0.6, metalness: 0.3 }),
    paver: std({ color: '#CFC3B0', map: T.paver, roughness: 0.95 }),
    cimento: std({ color: '#CBC2B2', roughness: 0.95 }),
    granito: std({ color: '#2B2A28', roughness: 0.35, metalness: 0.1 }),
    azulejo: std({ color: '#FFFFFF', map: T.azulejo, roughness: 0.4, side: THREE.BackSide }),
    aguaClara: new THREE.MeshStandardMaterial({ color: '#2FB2D6', roughness: 0.04, metalness: 0.05, transparent: true, opacity: 0.58, depthWrite: false }),
    bronze: std({ color: '#4A3A2E', roughness: 0.5, metalness: 0.4 }),
    tecido: std({ color: '#E9E0CF', roughness: 0.95 }),
    boia: std({ color: '#2F5FD0', roughness: 0.5 }),
    agave: std({ color: '#5F8F6A', roughness: 0.8 }),
    folhagem: std({ color: '#3E7F3A', roughness: 0.85 }),
    bordo: std({ color: '#6E1F24', roughness: 0.6 }),
    pilar: std({ color: '#D8CBB2' }),
    agua: std({ color: '#35B7D4', roughness: 0.04, metalness: 0.05 }),
    aguaRasa: std({ color: '#68D0E2', roughness: 0.05, metalness: 0.05 }),
    borda: std({ color: '#F7F4EC' }),
    areia: std({ color: '#E3CD98', map: T.areia }),
    branco: std({ color: '#FAFAF7' }),
    rede: new THREE.MeshStandardMaterial({ color: '#FFFFFF', transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }),
    ferro: std({ color: '#3A3F42', roughness: 0.5, metalness: 0.5 }),
    verdePorta: std({ color: '#24513A' }),
    terracota: std({ color: '#A74726' }),
    lona: std({ color: '#F3E7C9' }),
    lonaVerde: std({ color: '#2F6B4A' }),
    cavalo1: std({ color: '#9A5B34' }),
    cavalo2: std({ color: '#2E2118' }),
    cavalo3: std({ color: '#C79A6B' }),
    galinha: std({ color: '#FBF7EE' }),
    cabra: std({ color: '#C9A77C' }),
    pneu: std({ color: '#1E1F21', roughness: 0.9 }),
    placa: null, // criada na portaria
    poste: std({ color: '#B9B3A6' }),
    transformador: std({ color: '#7D858A', metalness: 0.4, roughness: 0.5 }),
    mourao: std({ color: '#7A5B40' }),
    fio: new THREE.LineBasicMaterial({ color: '#4A4A44', transparent: true, opacity: 0.55 }),
    piquete: std({ color: '#F2EFE6' }),
    flor1: std({ color: '#D8434E' }), flor2: std({ color: '#F2C641' }), flor3: std({ color: '#E77FB0' }), arbusto: std({ color: '#3F7A32' }), terra: std({ color: '#5E4230', roughness: 1 }),
  };
}

function peca(grupo, geom, mat, x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0) {
  const m = new THREE.Mesh(geom, mat);
  m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
  m.castShadow = true; m.receiveShadow = true;
  grupo.add(m); return m;
}
const caixa = (w, h, d) => new THREE.BoxGeometry(w, h, d);

// Telhado de duas águas: cumeeira ao longo de X (comprimento L), vão em Z (largura W), altura H
function telhadoDuasAguas(L, W, H) {
  const s = new THREE.Shape();
  s.moveTo(-W / 2, 0); s.lineTo(W / 2, 0); s.lineTo(0, H); s.lineTo(-W / 2, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: L, bevelEnabled: false });
  g.translate(0, 0, -L / 2); g.rotateY(Math.PI / 2);
  return g;
}
// Telhado de duas águas aberto (empena vazada, como no projeto da guarita e nos quiosques): cumeeira ao longo de x
function telhadoAberto(g, M, x, y, z, L, W, H) {
  const meia = W / 2, rampa = Math.hypot(meia, H), a = Math.atan2(H, meia);
  for (const lado of [-1, 1]) {
    peca(g, caixa(L, 0.16, rampa), M.telha, x, y + H / 2 + 0.08, z + lado * meia / 2, 0, lado * a);
    peca(g, caixa(L, 0.06, rampa), M.imbuia, x, y + H / 2 - 0.04, z + lado * meia / 2, 0, lado * a); // forro de madeira
    for (const ex of [-L / 2 + 0.1, L / 2 - 0.1]) peca(g, caixa(0.14, 0.24, rampa), M.imbuia, x + ex, y + H / 2, z + lado * meia / 2, 0, lado * a); // caibros das empenas
  }
  peca(g, caixa(L + 0.2, 0.2, 0.2), M.imbuia, x, y + H + 0.05, z);   // cumeeira
  for (const ex of [-L / 2 + 0.1, L / 2 - 0.1]) peca(g, caixa(0.14, 0.18, W), M.imbuia, x + ex, y + 0.1, z); // linha (tirante)
}
function telhadoQuatroAguas(L, W, H) {
  const g = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1); g.rotateY(Math.PI / 4);
  g.translate(0, 0.5, 0); g.scale(L, H, W);
  return g;
}

function noLugar(grupo, c, ang) { grupo.position.set(c[0], 0, c[1]); grupo.rotation.y = ang; return grupo; }

function salao(M, c, ang) {
  const g = new THREE.Group();
  peca(g, caixa(19, 0.35, 14), M.pedra, 0, 0.175, 0);
  peca(g, caixa(15, 3.8, 10), M.areiaSuave, 0, 0.35 + 1.9, -0.5);
  // portas de vidro na frente (voltada para a piscina) e janelas laterais
  for (const x of [-4.6, 0, 4.6]) peca(g, caixa(2.6, 2.7, 0.12), M.vidro, x, 0.35 + 1.35, 4.52);
  for (const x of [-5, 5]) peca(g, caixa(2.2, 1.3, 0.12), M.vidro, x, 2.6, -5.56);
  for (const z of [-2.5, 2]) { peca(g, caixa(0.12, 1.3, 2), M.vidro, 7.56, 2.6, z); peca(g, caixa(0.12, 1.3, 2), M.vidro, -7.56, 2.6, z); }
  peca(g, telhadoQuatroAguas(17.6, 12.6, 2.6), M.telha, 0, 0.35 + 3.8, -0.5);
  // varanda com pergolado de madeira
  for (const x of [-7, -3.5, 0, 3.5, 7]) peca(g, caixa(0.25, 3, 0.25), M.madeira, x, 1.85, 6.6);
  for (const x of [-6.5, -4.5, -2.5, -0.5, 1.5, 3.5, 5.5]) peca(g, caixa(0.18, 0.22, 3.2), M.madeira, x + 0.5, 3.45, 5.9);
  peca(g, caixa(14.6, 0.25, 0.3), M.madeira, 0, 3.3, 6.6);
  return noLugar(g, c, ang);
}

function espreguicadeira(g, M, x, z, ry) {
  const e = new THREE.Group();
  for (const dx of [-0.34, 0.34]) peca(e, caixa(0.05, 0.05, 1.5), M.bronze, dx, 0.34, 0.15);
  for (const [dx, dz] of [[-0.34, 0.85], [0.34, 0.85], [-0.34, -0.55], [0.34, -0.55]]) peca(e, caixa(0.05, 0.34, 0.05), M.bronze, dx, 0.17, dz);
  peca(e, caixa(0.66, 0.06, 1.4), M.tecido, 0, 0.38, 0.2);
  peca(e, caixa(0.66, 0.06, 0.75), M.tecido, 0, 0.66, -0.62, 0, -0.85);
  e.position.set(x, 0.25, z); e.rotation.y = ry; g.add(e);
}
function guardaSol(g, M, x, z, mat) {
  peca(g, new THREE.CylinderGeometry(0.05, 0.05, 2.5, 6), M.ferro, x, 1.5, z);
  peca(g, new THREE.ConeGeometry(1.5, 0.6, 8), mat, x, 2.75, z);
}

function piscina(M, c, ang, r, pessoas) {
  // 120 m² (adulto 16 × 6 m + infantil 6 × 4 m), rebaixada: borda de pedra com o recorte, azulejo e água translúcida
  const g = new THREE.Group();
  // a forma é desenhada em (x, -z): depois de girar para o chão, o y da forma vira -z
  const F = (x, z) => [x, -z];
  const forma = new THREE.Shape();
  forma.moveTo(...F(-13, -7.5)); forma.lineTo(...F(13, -7.5)); forma.lineTo(...F(13, 7.5)); forma.lineTo(...F(-13, 7.5)); forma.lineTo(...F(-13, -7.5));
  const furo = new THREE.Path();
  furo.moveTo(...F(-10, -4.5)); furo.lineTo(...F(-10, 1.5)); furo.lineTo(...F(12, 1.5)); furo.lineTo(...F(12, -2.5)); furo.lineTo(...F(6, -2.5)); furo.lineTo(...F(6, -4.5)); furo.lineTo(...F(-10, -4.5));
  forma.holes.push(furo);
  const borda = new THREE.ExtrudeGeometry(forma, { depth: 0.25, bevelEnabled: false });
  borda.rotateX(-Math.PI / 2); // extrusão para cima
  peca(g, borda, M.pedra, 0, 0, 0);
  // bacias (caixa vista por dentro): adulto e infantil
  peca(g, caixa(16, 1.6, 6), M.azulejo, -2, 0.25 - 0.8, -1.5);
  peca(g, caixa(6, 0.8, 4), M.azulejo, 9, 0.25 - 0.4, -0.5);
  // água
  const agua1 = peca(g, caixa(16, 0.02, 6), M.aguaClara, -2, 0.17, -1.5); agua1.castShadow = false;
  const agua2 = peca(g, caixa(6, 0.02, 4), M.aguaClara, 9, 0.17, -0.5); agua2.castShadow = false;
  // boias e espreguiçadeiras (estrutura bronze, tecido claro) no lado do lago; guarda-sóis brancos
  peca(g, caixa(1.8, 0.14, 0.7), M.boia, -5, 0.2, -2.2, 0.3); peca(g, caixa(1.8, 0.14, 0.7), M.boia, -2.5, 0.2, -0.8, -0.2);
  for (let i = 0; i < 7; i++) espreguicadeira(g, M, -10.5 + i * 2.8, 4.8, Math.PI);
  guardaSol(g, M, -8.9, 5.2, M.lona); guardaSol(g, M, -3.3, 5.2, M.lona); guardaSol(g, M, 2.3, 5.2, M.lona);
  const n = noLugar(g, c, ang);
  const cs = Math.cos(ang), sn = Math.sin(ang);
  const loc = (x, z) => [c[0] + x * cs + z * sn, c[1] - x * sn + z * cs];
  pessoas.push(loc(-6, -2), loc(0, -1), loc(9, -0.5), loc(-9.5, 3.8), loc(4.5, 5.8), loc(-3.5, 6.2));
  return n;
}

function cadeira(g, M, x, z, ry) {
  const c = new THREE.Group();
  peca(c, caixa(0.46, 0.05, 0.46), M.madeira, 0, 0.46, 0);
  peca(c, caixa(0.46, 0.5, 0.05), M.madeira, 0, 0.72, -0.21);
  for (const [dx, dz] of [[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]]) peca(c, caixa(0.04, 0.46, 0.04), M.madeira, dx, 0.23, dz);
  c.position.set(x, 0, z); c.rotation.y = ry; g.add(c);
}
function quiosque(g, M, x, z) {
  // como no render do projeto: telhado de duas águas em madeira, parede de pedra aparente e bancada, mesas com cadeiras
  // (sem churrasqueira: não consta do contrato v4)
  peca(g, caixa(6.6, 0.2, 5.4), M.cimento, x, 0.1, z);
  for (const [dx, dz] of [[-3.1, -2.5], [3.1, -2.5], [-3.1, 2.5], [3.1, 2.5]]) peca(g, caixa(0.22, 2.9, 0.22), M.madeira, x + dx, 1.55, z + dz);
  peca(g, caixa(0.45, 2.9, 2.6), M.pedraClara, x - 2.8, 1.55, z);            // parede de pedra
  peca(g, caixa(0.7, 0.9, 2.4), M.pedraClara, x - 2.25, 0.65, z);            // bancada
  peca(g, caixa(0.76, 0.05, 2.5), M.granito, x - 2.25, 1.12, z);
  telhadoAberto(g, M, x, 2.95, z, 7.4, 6.4, 1.8);
  for (const dz of [-1.3, 1.3]) {
    peca(g, caixa(0.9, 0.05, 0.9), M.madeira, x + 0.6, 0.78, z + dz);
    peca(g, new THREE.CylinderGeometry(0.06, 0.06, 0.76, 6), M.madeira, x + 0.6, 0.39, z + dz);
    cadeira(g, M, x + 0.6, z + dz - 0.7, 0); cadeira(g, M, x + 0.6, z + dz + 0.7, Math.PI);
    cadeira(g, M, x - 0.1, z + dz, Math.PI / 2); cadeira(g, M, x + 1.3, z + dz, -Math.PI / 2);
  }
}
function quiosques(M, c, ang, pessoas, r) {
  const g = new THREE.Group();
  for (const x of [-13, 0, 13]) quiosque(g, M, x, 0);
  const n = noLugar(g, c, ang);
  const cs = Math.cos(ang), sn = Math.sin(ang);
  for (const x of [-13, 0, 13]) for (let k = 0; k < 2; k++) {
    const lx = x + (r() - 0.5) * 2, lz = (k ? 1.4 : -1.4);
    pessoas.push([c[0] + lx * cs + lz * sn, c[1] - lx * sn + lz * cs]);
  }
  return n;
}

function banheiros(M, c, ang) {
  const g = new THREE.Group();
  peca(g, caixa(10, 0.25, 7), M.pedra, 0, 0.125, 0);
  peca(g, caixa(8.5, 3, 5), M.parede, 0, 1.75, 0);
  peca(g, telhadoQuatroAguas(9.6, 6.2, 1.6), M.telha, 0, 3.25, 0);
  peca(g, caixa(1, 2.1, 0.1), M.verdePorta, -2.2, 1.3, 2.52);
  peca(g, caixa(1, 2.1, 0.1), M.terracota, 2.2, 1.3, 2.52);
  return noLugar(g, c, ang);
}

function quadra(M, c, ang, pessoas) {
  const g = new THREE.Group();
  peca(g, caixa(20, 0.12, 12), M.areia, 0, 0.06, 0);
  // linhas 16 × 8 m
  for (const [w, d, x, z] of [[16, 0.08, 0, -4], [16, 0.08, 0, 4], [0.08, 8, -8, 0], [0.08, 8, 8, 0], [0.08, 8, 0, 0]]) peca(g, caixa(w, 0.02, d), M.branco, x, 0.13, z);
  peca(g, new THREE.CylinderGeometry(0.06, 0.06, 2.6, 6), M.ferro, 0, 1.3, -4.6);
  peca(g, new THREE.CylinderGeometry(0.06, 0.06, 2.6, 6), M.ferro, 0, 1.3, 4.6);
  peca(g, caixa(0.03, 1, 9.2), M.rede, 0, 1.95, 0);
  const n = noLugar(g, c, ang);
  const cs = Math.cos(ang), sn = Math.sin(ang);
  for (const [x, z] of [[-4, -2], [-5, 2], [4.5, -1.5], [3.5, 2.5]]) pessoas.push([c[0] + x * cs + z * sn, c[1] - x * sn + z * cs]);
  return n;
}

function cavalo(g, M, mat, x, z, ry) {
  const h = new THREE.Group();
  const corpo = new THREE.CapsuleGeometry(0.36, 1.2, 4, 12); corpo.rotateZ(Math.PI / 2);
  peca(h, corpo, mat, 0, 1.38, 0);
  const pescoco = new THREE.CapsuleGeometry(0.2, 0.7, 4, 10); peca(h, pescoco, mat, 0.82, 1.82, 0, 0, 0, -0.62);
  const cabeca = new THREE.CapsuleGeometry(0.14, 0.42, 4, 10); peca(h, cabeca, mat, 1.2, 2.1, 0, 0, 0, -1.25);
  for (const dz of [-0.08, 0.08]) peca(h, new THREE.ConeGeometry(0.04, 0.14, 5), mat, 1.02, 2.38, dz);
  for (const [dx, dz] of [[-0.62, -0.17], [-0.62, 0.17], [0.6, -0.17], [0.6, 0.17]]) {
    peca(h, new THREE.CylinderGeometry(0.075, 0.06, 1.05, 7), mat, dx, 0.55, dz);
    peca(h, new THREE.CylinderGeometry(0.07, 0.08, 0.08, 7), M.cavalo2, dx, 0.04, dz);
  }
  peca(h, new THREE.CylinderGeometry(0.04, 0.11, 0.8, 6), M.cavalo2, -1.02, 1.12, 0, 0, 0, 0.45);
  peca(h, caixa(0.5, 0.18, 0.06), M.cavalo2, 0.9, 2.0, 0, 0, 0, -0.62); // crina
  h.position.set(x, 0, z); h.rotation.y = ry; g.add(h);
}

function baias(M, c, ang, r) {
  const g = new THREE.Group();
  // 5 baias de 3,5 m + beiral
  peca(g, caixa(20, 0.25, 8), M.pedra, 0, 0.125, -6);
  peca(g, caixa(17.5, 2.9, 4.2), M.paredeCreme, 0, 1.7, -6);
  for (let i = 0; i < 5; i++) peca(g, caixa(1.6, 2, 0.12), M.madeira, -7 + i * 3.5, 1.25, -3.85);
  peca(g, telhadoQuatroAguas(21, 9.2, 2.1), M.telha, 0, 3.15, -5.0);
  for (let i = 0; i < 6; i++) peca(g, caixa(0.22, 2.9, 0.22), M.madeira, -8.75 + i * 3.5, 1.7, -1.3);
  // redondel: cerca circular de 16 m com piso de areia
  const R = 8;
  const piso = new THREE.CylinderGeometry(R, R, 0.1, 40); peca(g, piso, M.areia, 0, 0.05, 7);
  for (let i = 0; i < 32; i++) { const a = (i / 32) * Math.PI * 2; peca(g, new THREE.CylinderGeometry(0.09, 0.1, 1.7, 5), M.madeira, Math.cos(a) * R, 0.85, 7 + Math.sin(a) * R); }
  for (const y of [0.6, 1.05, 1.5]) { const t = new THREE.TorusGeometry(R, 0.05, 4, 48); t.rotateX(Math.PI / 2); peca(g, t, M.madeira, 0, y, 7); }
  // três cavalos soltos no redondel (como no render do projeto)
  cavalo(g, M, M.cavalo1, 1.8, 8.2, 0.6);
  cavalo(g, M, M.cavalo3, -3.2, 5.4, 2.4);
  cavalo(g, M, M.cavalo2, -1.0, 10.6, -0.9);
  return noLugar(g, c, ang);
}

function fazendinha(M, c, ang, r) {
  const g = new THREE.Group();
  const W = 22, D = 16;
  peca(g, caixa(W, 0.06, D), M.areia, 0, 0.03, 0);
  for (let x = -W / 2; x <= W / 2 + 0.01; x += 2) { peca(g, caixa(0.12, 1.2, 0.12), M.madeira, x, 0.6, -D / 2); peca(g, caixa(0.12, 1.2, 0.12), M.madeira, x, 0.6, D / 2); }
  for (let z = -D / 2 + 2; z < D / 2; z += 2) { peca(g, caixa(0.12, 1.2, 0.12), M.madeira, -W / 2, 0.6, z); peca(g, caixa(0.12, 1.2, 0.12), M.madeira, W / 2, 0.6, z); }
  for (const y of [0.5, 1.05]) {
    peca(g, caixa(W, 0.08, 0.06), M.madeira, 0, y, -D / 2); peca(g, caixa(W, 0.08, 0.06), M.madeira, 0, y, D / 2);
    peca(g, caixa(0.06, 0.08, D), M.madeira, -W / 2, y, 0); peca(g, caixa(0.06, 0.08, D), M.madeira, W / 2, y, 0);
  }
  // abrigo
  peca(g, caixa(4.5, 2.2, 3), M.madeira, -7, 1.1, -5);
  peca(g, caixa(5.2, 0.15, 3.8), M.telha, -7, 2.35, -5, 0, 0.12);
  // aves e cabras
  for (let i = 0; i < 16; i++) peca(g, new THREE.SphereGeometry(0.22, 6, 4), M.galinha, (r() - 0.5) * (W - 3), 0.22, (r() - 0.5) * (D - 3));
  for (let i = 0; i < 3; i++) { const x = 3 + r() * 6, z = (r() - 0.5) * 8; peca(g, caixa(0.9, 0.45, 0.35), M.cabra, x, 0.65, z); peca(g, caixa(0.3, 0.3, 0.25), M.cabra, x + 0.55, 0.95, z); }
  return noLugar(g, c, ang);
}

function portaria(M, c, ang, T) {
  // Projeto de revitalização da guarita e acessos (maio/2026): guarita 4,00 × 6,40 m em "areia suave", pilares e muros
  // em "branco gelo", madeira imbuia, portões pretos de 3,50 m, telhado cerâmico colonial, canteiro redondo com
  // luminárias de piso e a NOVA LOGO na fachada. Frente de 26,60 m = 7,80 + 13,20 (coberto) + 5,60.
  // Referencial: x ao longo da via (+x = lado de fora, de quem chega), z atravessado.
  const g = new THREE.Group();
  peca(g, caixa(22, 0.06, 28), M.paver, 3, 0.03, -1);                 // piso intertravado da praça de acesso
  peca(g, caixa(6.4, 3.3, 4.0), M.areiaSuave, 0, 1.68, 0);             // guarita
  for (const z of [-1.62, 1.62]) { peca(g, caixa(0.1, 0.5, 0.42), M.vidro, 3.21, 2.05, z); peca(g, caixa(0.12, 0.62, 0.54), M.imbuia, 3.2, 2.05, z); }
  for (const x of [-1.6, 1.6]) peca(g, caixa(1.2, 1.0, 0.1), M.vidro, x, 2.1, 2.01);
  peca(g, caixa(0.12, 0.2, 0.2), M.pretoFosco, 3.25, 3.0, 0);          // arandela acima da logo
  // telhado de duas águas (cumeeira ao longo da via) cobrindo guarita e portões — 13,20 m atravessado
  telhadoAberto(g, M, 0, 3.3, 0, 8.6, 14.4, 2.4);
  for (const z of [-7.1, 7.1]) peca(g, caixa(8.6, 0.28, 0.12), M.imbuia, 0, 3.3, z); // testeiras
  for (const x of [-3.9, 3.9]) for (const z of [-6.6, 6.6]) peca(g, caixa(0.45, 3.3, 0.45), M.brancoGelo, x, 1.65, z);
  // portões metálicos pretos (3,50 × 2,20 m): entrada e saída de veículos
  const portao = (z0, z1, x) => {
    const L = Math.abs(z1 - z0), zc = (z0 + z1) / 2;
    peca(g, caixa(0.07, 0.07, L), M.pretoFosco, x, 2.2, zc); peca(g, caixa(0.07, 0.07, L), M.pretoFosco, x, 0.22, zc);
    for (let z = Math.min(z0, z1); z <= Math.max(z0, z1) + 0.01; z += 0.14) peca(g, caixa(0.04, 2.0, 0.04), M.pretoFosco, x, 1.2, z);
  };
  portao(-6.2, -2.4, 3.6); portao(2.4, 6.2, 3.6);
  // muros laterais em branco gelo (7,80 m e 5,60 m), com pilares e rufo
  const muro = (z0, z1) => {
    const L = Math.abs(z1 - z0), zc = (z0 + z1) / 2;
    peca(g, caixa(0.28, 2.2, L), M.brancoGelo, 3.6, 1.1, zc);
    peca(g, caixa(0.4, 0.08, L), M.brancoGelo, 3.6, 2.24, zc);
    peca(g, caixa(0.42, 2.45, 0.42), M.brancoGelo, 3.6, 1.22, z1);
    // canteiro em frente ao muro: agaves e folhagens
    peca(g, caixa(1.0, 0.18, L - 0.6), M.terra, 4.4, 0.09, zc);
    for (let z = Math.min(z0, z1) + 0.6; z < Math.max(z0, z1) - 0.4; z += 0.9) planta(g, M, 4.4, z, (z * 7) % 3);
  };
  muro(-6.85, -14.65); muro(6.85, 12.45);
  // canteiro redondo diante da guarita, com luminárias de piso
  const R = 2.8;
  const meiofio = new THREE.TorusGeometry(R, 0.12, 6, 40); meiofio.rotateX(Math.PI / 2);
  peca(g, meiofio, M.brancoGelo, 6.6, 0.14, 0);
  const terra = new THREE.CylinderGeometry(R, R, 0.2, 40); peca(g, terra, M.terra, 6.6, 0.1, 0);
  for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2; planta(g, M, 6.6 + Math.cos(a) * 1.8, Math.sin(a) * 1.8, i % 3); }
  planta(g, M, 6.6, 0, 0, 1.6);
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + 0.3; peca(g, new THREE.CylinderGeometry(0.06, 0.06, 0.45, 8), M.pretoFosco, 6.6 + Math.cos(a) * (R + 0.4), 0.23, Math.sin(a) * (R + 0.4)); }
  // placa com a nova logo (dourado sobre verde), na fachada voltada para quem chega
  const texLogo = new THREE.TextureLoader().load('assets/logo-placa.jpg', () => { if (typeof window !== 'undefined') window.dispatchEvent(new Event('haras:textura')); });
  texLogo.colorSpace = THREE.SRGBColorSpace; texLogo.anisotropy = 8;
  const placa = new THREE.Mesh(new THREE.PlaneGeometry(2.7, 1.8), new THREE.MeshStandardMaterial({ map: texLogo, roughness: 0.6 }));
  placa.position.set(3.215, 2.15, 0); placa.rotation.y = Math.PI / 2; placa.castShadow = false; g.add(placa);
  const n = noLugar(g, c, ang);
  n.userData.naoFundir = [placa];
  return n;
}

// agave (0), lírio-da-paz/moreia (1) ou ráfis (2), em tamanho de paisagismo
function planta(g, M, x, z, tipo = 0, esc = 1) {
  if (tipo === 0) {
    const f = new THREE.ConeGeometry(0.09, 0.9, 4); f.translate(0, 0.45, 0);
    for (let k = 0; k < 7; k++) { const m = peca(g, f, M.agave, x, 0.15, z, (k / 7) * Math.PI * 2, 0, 0.6 + (k % 2) * 0.25); m.scale.setScalar(esc); }
  } else if (tipo === 1) {
    const m = peca(g, new THREE.SphereGeometry(0.42, 8, 6), M.folhagem, x, 0.4, z); m.scale.set(esc, 0.8 * esc, esc);
  } else {
    for (let k = 0; k < 5; k++) { const m = peca(g, new THREE.ConeGeometry(0.16, 1.4, 5), M.folhagem, x + Math.cos(k) * 0.15, 0.85, z + Math.sin(k) * 0.15, k, 0.15, 0.2); m.scale.setScalar(esc); }
  }
}

function canteiros(M, c, ang, r) {
  const g = new THREE.Group();
  const flor = new THREE.SphereGeometry(0.2, 6, 4);
  const moita = new THREE.SphereGeometry(0.55, 7, 5);
  const flores = [M.flor1, M.flor2, M.flor3];
  // quatro canteiros de 9 x 2,6 m, dos dois lados das faixas, antes e depois do pórtico
  for (const [cx, cz] of [[-9, -15], [-9, 15], [10, -15], [10, 15]]) {
    const fora = Math.sign(cz); // lado de fora do canteiro (longe da via): cerca-viva
    peca(g, caixa(9.2, 0.16, 2.6), M.terra, cx, 0.08, cz);
    for (const dz of [-1.35, 1.35]) peca(g, caixa(9.4, 0.22, 0.14), M.pilar, cx, 0.11, cz + dz);
    for (let i = 0; i < 12; i++) { const m = peca(g, moita, M.arbusto, cx - 4.1 + i * 0.75, 0.42, cz + fora * 0.75); m.scale.set(1, 0.85, 1); }
    for (let i = 0; i < 60; i++) {
      const x = cx - 4.2 + r() * 8.4, z = cz - fora * (0.2 + r() * 0.9);
      peca(g, flor, flores[Math.floor(r() * 3)], x, 0.3, z).scale.setScalar(0.8 + r() * 0.6);
    }
  }
  return noLugar(g, c, ang);
}

function carro(M, c, ang, corHex) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: corHex, roughness: 0.35, metalness: 0.4 });
  peca(g, caixa(5.2, 0.9, 1.9), mat, 0, 0.85, 0);
  peca(g, caixa(2.4, 0.8, 1.8), mat, 0.6, 1.65, 0);
  peca(g, caixa(2.2, 0.62, 1.84), M.vidro, 0.6, 1.66, 0);
  for (const [x, z] of [[-1.7, -0.95], [-1.7, 0.95], [1.7, -0.95], [1.7, 0.95]]) peca(g, new THREE.CylinderGeometry(0.4, 0.4, 0.28, 12), M.pneu, x, 0.4, z, 0, Math.PI / 2);
  return noLugar(g, c, ang);
}

function gente(lista, r) {
  const g = new THREE.Group();
  const camisas = ['#C8A86B', '#2F6B4A', '#D9534F', '#3B6EA8', '#F2F2F2', '#E0A33A', '#7A4F9A', '#2B2B2B'];
  const pele = ['#8D5A3B', '#C68B59', '#E0B48A', '#6B4226', '#F1C9A5'];
  const tronco = new THREE.CylinderGeometry(0.2, 0.17, 0.72, 7);
  const pernas = new THREE.CylinderGeometry(0.15, 0.12, 0.85, 6);
  const cabeca = new THREE.SphereGeometry(0.13, 8, 6);
  const mats = {};
  const mat = (h) => (mats[h] ||= new THREE.MeshStandardMaterial({ color: h, roughness: 0.9 }));
  for (const [x, z] of lista) {
    const e = 0.9 + r() * 0.2;
    const p = new THREE.Group();
    peca(p, pernas, mat(['#2E3A4A', '#3F3A33', '#6B6B6B', '#1F2A36'][Math.floor(r() * 4)]), 0, 0.43, 0);
    peca(p, tronco, mat(camisas[Math.floor(r() * camisas.length)]), 0, 1.2, 0);
    peca(p, cabeca, mat(pele[Math.floor(r() * pele.length)]), 0, 1.72, 0);
    p.position.set(x, 0, z); p.scale.setScalar(e); p.rotation.y = r() * Math.PI * 2;
    g.add(p);
  }
  return g;
}

// Funde as peças por material (poucas chamadas de desenho) e mantém à parte o que precisa de material próprio
function otimizar(grupo) {
  grupo.updateMatrixWorld(true);
  const porMat = new Map();
  const manter = [];
  grupo.traverse((o) => {
    if (o.userData && o.userData.naoFundir) manter.push(...o.userData.naoFundir);
  });
  grupo.traverse((o) => {
    if (!o.isMesh || manter.includes(o)) return;
    let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.applyMatrix4(o.matrixWorld);
    if (!porMat.has(o.material)) porMat.set(o.material, []);
    porMat.get(o.material).push(g);
  });
  const soltos = manter.map((m) => { m.updateMatrixWorld(true); const c = m.clone(); c.matrix.copy(m.matrixWorld); c.matrix.decompose(c.position, c.quaternion, c.scale); return c; });
  grupo.clear(); grupo.position.set(0, 0, 0); grupo.rotation.set(0, 0, 0);
  for (const [mat, lista] of porMat) {
    const m = new THREE.Mesh(mergeGeometries(lista), mat);
    m.castShadow = true; m.receiveShadow = true; m.renderOrder = 20;
    grupo.add(m);
  }
  for (const s of soltos) grupo.add(s);
}

function cercaPerimetro(poly, M, entrada) {
  const g = new THREE.Group(); g.name = 'cerca';
  const pos = [];
  const fios = [];
  const PASSO = 5;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let s = 0; s < L; s += PASSO) {
      const t = s / L; const x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
      if (entrada && Math.hypot(x - entrada[0], z - entrada[1]) < 16) continue; // vão da portaria
      pos.push([x, z]);
    }
  }
  const mourao = new THREE.InstancedMesh(new THREE.BoxGeometry(0.14, 1.5, 0.14), M.mourao, pos.length);
  const m4 = new THREE.Matrix4();
  pos.forEach(([x, z], i) => { m4.makeTranslation(x, 0.75, z); mourao.setMatrixAt(i, m4); });
  mourao.castShadow = true; mourao.renderOrder = 20;
  g.add(mourao);
  for (let i = 1; i < pos.length; i++) {
    const a = pos[i - 1], b = pos[i];
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) > PASSO * 1.6) continue;
    for (const y of [0.55, 0.95, 1.35]) fios.push(a[0], y, a[1], b[0], y, b[1]);
  }
  const gf = new THREE.BufferGeometry(); gf.setAttribute('position', new THREE.Float32BufferAttribute(fios, 3));
  const linhas = new THREE.LineSegments(gf, M.fio); linhas.renderOrder = 21;
  g.add(linhas);
  return g;
}

function redeEletrica(vias, M, r) {
  const g = new THREE.Group(); g.name = 'rede';
  const postes = [];
  const fios = [];
  const ESP = 45;
  for (const v of vias) {
    if (v.tipo === 'acesso') continue;
    const w = v.tipo === 'avenida' ? 14 : 9;
    const lado = v.tipo === 'avenida' ? 1 : -1;
    let anterior = null;
    const total = comprimento(v.pts);
    for (let s = 10; s < total - 5; s += ESP) {
      const q = pontoAoLongo(v.pts, s / total);
      const q2 = pontoAoLongo(v.pts, Math.min(1, (s + 1) / total));
      const dx = q2[0] - q[0], dz = q2[1] - q[1], L = Math.hypot(dx, dz) || 1;
      const nx = -dz / L * lado, nz2 = dx / L * lado;
      const p = [q[0] + nx * (w / 2 + 2.2), q[1] + nz2 * (w / 2 + 2.2), Math.atan2(-dz, dx)];
      postes.push(p);
      if (anterior) for (const dy of [-0.8, 0, 0.8]) {
        const ca = Math.cos(anterior[2]), sa = Math.sin(anterior[2]), cb = Math.cos(p[2]), sb = Math.sin(p[2]);
        fios.push(anterior[0] + sa * dy, 8.6, anterior[1] + ca * dy, p[0] + sb * dy, 8.6, p[1] + cb * dy);
      }
      anterior = p;
    }
  }
  const geoPoste = new THREE.CylinderGeometry(0.13, 0.2, 9, 6); geoPoste.translate(0, 4.5, 0);
  const geoCruz = new THREE.BoxGeometry(0.12, 0.12, 2.2); geoCruz.translate(0, 8.5, 0);
  const iP = new THREE.InstancedMesh(geoPoste, M.poste, postes.length);
  const iC = new THREE.InstancedMesh(geoCruz, M.madeiraEscura, postes.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  postes.forEach((p, i) => {
    q.setFromAxisAngle(up, p[2]);
    m4.compose(new THREE.Vector3(p[0], 0, p[1]), q, e);
    iP.setMatrixAt(i, m4); iC.setMatrixAt(i, m4);
  });
  // 13 transformadores distribuídos
  const passoT = Math.max(1, Math.floor(postes.length / 13));
  const trafos = postes.filter((_, i) => i % passoT === Math.floor(passoT / 2)).slice(0, 13);
  const geoT = new THREE.CylinderGeometry(0.45, 0.45, 1.1, 10); geoT.translate(0.45, 7.2, 0);
  const iT = new THREE.InstancedMesh(geoT, M.transformador, trafos.length);
  trafos.forEach((p, i) => { q.setFromAxisAngle(up, p[2]); m4.compose(new THREE.Vector3(p[0], 0, p[1]), q, e); iT.setMatrixAt(i, m4); });
  for (const im of [iP, iC, iT]) { im.castShadow = true; im.renderOrder = 20; g.add(im); }
  const gf = new THREE.BufferGeometry(); gf.setAttribute('position', new THREE.Float32BufferAttribute(fios, 3));
  const linhas = new THREE.LineSegments(gf, M.fio); linhas.renderOrder = 21;
  g.add(linhas);
  g.userData.postes = postes.length;
  return g;
}

function piquetes(lotes, M) {
  const vistos = new Set(); const pos = [];
  for (const l of lotes) for (const q of l.poly) {
    const k = `${Math.round(q[0] * 2)},${Math.round(q[1] * 2)}`;
    if (vistos.has(k)) continue; vistos.add(k); pos.push(q);
  }
  const im = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.7, 0.12).translate(0, 0.35, 0), M.piquete, pos.length);
  const m4 = new THREE.Matrix4();
  pos.forEach((q, i) => { m4.makeTranslation(q[0], 0, q[1]); im.setMatrixAt(i, m4); });
  im.renderOrder = 20;
  const g = new THREE.Group(); g.name = 'piquetes'; g.add(im);
  return g;
}

function vegetacao(arvores, M, T, detalhe, detalheLonge, dirSol) {
  const g = new THREE.Group(); g.name = 'vegetacao';
  arvores.forEach((a, i) => { a.gi = i; });
  const tronco = new THREE.CylinderGeometry(0.13, 0.2, 1, 5); tronco.translate(0, 0.5, 0);
  const copaR = [new THREE.IcosahedronGeometry(1, 0), new THREE.IcosahedronGeometry(1, 1)];
  const copaG = [new THREE.SphereGeometry(1, 6, 4).scale(1, 0.42, 1), new THREE.SphereGeometry(1, 9, 5).scale(1, 0.42, 1)];
  const matFolha = new THREE.MeshStandardMaterial({ color: '#FFFFFF', roughness: 0.95, flatShading: true });
  const matTronco = new THREE.MeshStandardMaterial({ color: PALETA.tronco, roughness: 1 });
  const cores = PALETA.folhas.map((h) => new THREE.Color(h));
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const rr = rng(99);
  const registros = []; // { a, meshes: [InstancedMesh], i }

  const criar = (lista, geoCopa, alturaCopa, achatado) => {
    if (!lista.length) return;
    const iCopa = new THREE.InstancedMesh(geoCopa, matFolha, lista.length);
    const iTronco = new THREE.InstancedMesh(tronco, matTronco, lista.length);
    lista.forEach((a, i) => {
      const [x, z, h, rad] = a;
      q.setFromAxisAngle(up, rr() * Math.PI * 2);
      const troncoH = h * 0.4;
      p.set(x, 0, z); s.set(1.5, troncoH, 1.5); m4.compose(p, q, s); iTronco.setMatrixAt(i, m4);
      p.set(x, troncoH + rad * alturaCopa * (achatado ? 0.35 : 0.55), z); s.set(rad, rad * alturaCopa, rad); m4.compose(p, q, s); iCopa.setMatrixAt(i, m4);
      const c = cores[a[5] % cores.length].clone().offsetHSL(0, (rr() - 0.5) * 0.06, (rr() - 0.5) * 0.08);
      iCopa.setColorAt(i, c);
      registros.push({ a, meshes: [iCopa, iTronco], i });
    });
    for (const im of [iCopa, iTronco]) { im.castShadow = true; im.receiveShadow = true; im.renderOrder = 20; g.add(im); }
  };
  // perto: copa com mais faces; longe (reserva e caatinga em volta): copa simples — mesmo desenho, bem menos triângulos
  for (const longe of [false, true]) {
    const det = longe ? detalheLonge : detalhe;
    criar(arvores.filter((a) => a[4] === 0 && !!a[6] === longe), copaR[det], 1.25, false);
    criar(arvores.filter((a) => a[4] === 1 && !!a[6] === longe), copaG[det], 1.2, true);
  }

  // palmeiras: tronco alto e fino + folhas em leque (cones achatados, levemente caídas)
  const palmas = arvores.filter((a) => a[4] === 2);
  if (palmas.length) {
    const tp = new THREE.CylinderGeometry(0.16, 0.24, 1, 6); tp.translate(0, 0.5, 0);
    // folha curva: faixa afilada ao longo de x, com nervura central e caimento parabólico
    const folha = (() => {
      const seg = 10, L = 4.2, pos = [], idx = [];
      for (let i = 0; i <= seg; i++) {
        const t = i / seg, x = t * L, w = 0.55 * Math.sin(Math.PI * Math.min(1, t * 1.15)) + 0.05, y = 0.9 * t - 1.6 * t * t;
        pos.push(x, y, -w, x, y + 0.12 * (1 - t), 0, x, y, w);
      }
      for (let i = 0; i < seg; i++) { const a = i * 3; idx.push(a, a + 3, a + 1, a + 1, a + 3, a + 4, a + 1, a + 4, a + 2, a + 2, a + 4, a + 5); }
      const gf = new THREE.BufferGeometry(); gf.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); gf.setIndex(idx); gf.computeVertexNormals();
      return gf;
    })();
    const N = 13;
    const iT = new THREE.InstancedMesh(tp, matTronco, palmas.length);
    const iF = new THREE.InstancedMesh(folha, new THREE.MeshStandardMaterial({ color: '#4A8436', roughness: 0.9, side: THREE.DoubleSide }), palmas.length * N);
    const eixoZ = new THREE.Vector3(0, 0, 1), inc = new THREE.Quaternion();
    palmas.forEach((a, i) => {
      const [x, z, h] = a;
      p.set(x, 0, z); s.set(1, h, 1); q.identity(); m4.compose(p, q, s); iT.setMatrixAt(i, m4);
      for (let k = 0; k < N; k++) {
        q.setFromAxisAngle(up, (k / N) * Math.PI * 2 + rr() * 0.4);
        inc.setFromAxisAngle(eixoZ, 0.25 + (rr() - 0.5) * 0.35 - (k % 2) * 0.3);
        q.multiply(inc);
        p.set(x, h - 0.15, z); s.set(1, 0.85 + rr() * 0.3, 1); m4.compose(p, q, s); iF.setMatrixAt(i * N + k, m4);
      }
    });
    for (const im of [iT, iF]) { im.castShadow = true; im.renderOrder = 20; g.add(im); }
  }

  // sombras suaves no chão (deslocadas para longe do sol)
  const geoS = new THREE.PlaneGeometry(1, 1); geoS.rotateX(-Math.PI / 2);
  const matS = new THREE.MeshBasicMaterial({ map: T.sombra, transparent: true, depthWrite: false, fog: false });
  const sombras = new THREE.InstancedMesh(geoS, matS, arvores.length);
  const off = new THREE.Vector3(-dirSol.x, 0, -dirSol.z).normalize();
  arvores.forEach((a, i) => {
    const [x, z, h, rad] = a;
    const d = h * 0.35;
    p.set(x + off.x * d, 0.05, z + off.z * d); q.identity(); s.set(rad * 2.6, 1, rad * 2.3);
    m4.compose(p, q, s); sombras.setMatrixAt(i, m4);
  });
  sombras.renderOrder = 11; sombras.frustumCulled = false;
  g.add(sombras);

  // Clareira: esconde as árvores num corredor (câmera → alvo) para a vista das imagens não ficar tapada
  const guardados = [];
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  function restaurar() {
    for (const { mesh, i, m } of guardados) { mesh.setMatrixAt(i, m); mesh.instanceMatrix.needsUpdate = true; }
    guardados.length = 0;
  }
  function clareira(a, b, raio) {
    restaurar();
    for (const rg of registros) {
      const [x, z] = rg.a;
      if (distSeg([x, z], a, b) > raio) continue;
      for (const mesh of rg.meshes) { const m = new THREE.Matrix4(); mesh.getMatrixAt(rg.i, m); guardados.push({ mesh, i: rg.i, m }); mesh.setMatrixAt(rg.i, zero); mesh.instanceMatrix.needsUpdate = true; }
      const m = new THREE.Matrix4(); sombras.getMatrixAt(rg.a.gi, m); guardados.push({ mesh: sombras, i: rg.a.gi, m }); sombras.setMatrixAt(rg.a.gi, zero); sombras.instanceMatrix.needsUpdate = true;
    }
  }
  return { grupo: g, sombras, clareira, restaurar };
}

// =====================================================================
// Enquadramento: acha alvo e distância para que os pontos do chão caibam na tela com as margens
// (fração da tela: x de cada lado, topo e base). Recentraliza pelos eixos do chão (direita / frente),
// com amortecimento — estável mesmo com a câmera baixa, perto do horizonte.
// =====================================================================
export function enquadrarPontos(cameraBase, pts, polar, azim, m) {
  const cam = cameraBase.clone();
  const P = pts.map((q) => new THREE.Vector3(q[0], 0, q[1]));
  const alvo = new THREE.Vector3(P.reduce((s, p) => s + p.x, 0) / P.length, 0, P.reduce((s, p) => s + p.z, 0) / P.length);
  const frente = new THREE.Vector3(-Math.sin(azim), 0, -Math.cos(azim));
  const direita = new THREE.Vector3(Math.cos(azim), 0, -Math.sin(azim));
  const esf = new THREE.Spherical(), v = new THREE.Vector3();
  const tan = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
  let dist = 4000;
  for (let it = 0; it < 90; it++) {
    esf.set(dist, polar, azim);
    cam.position.setFromSpherical(esf).add(alvo); cam.lookAt(alvo); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, atras = false;
    for (const p of P) {
      v.copy(p).applyMatrix4(cam.matrixWorldInverse);
      if (v.z > -1) { atras = true; break; }
      v.copy(p).project(cam);
      x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
    }
    if (atras) { dist *= 1.4; continue; }
    const esc = Math.max((x1 - x0) / (2 - 4 * m.x), (y1 - y0) / (2 - 2 * (m.topo + m.base)));
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2 - (m.base - m.topo);
    const meiaL = dist * tan * cam.aspect, meiaA = dist * tan * Math.min(4, 1 / Math.max(0.2, Math.cos(polar)));
    // passos pequenos e limitados: em perspectiva, zoom e recentralização interagem e oscilam se forem bruscos
    const passo = dist * 0.08;
    alvo.addScaledVector(direita, THREE.MathUtils.clamp(cx * meiaL * 0.3, -passo, passo));
    alvo.addScaledVector(frente, THREE.MathUtils.clamp(cy * meiaA * 0.3, -passo, passo));
    dist *= Math.pow(THREE.MathUtils.clamp(esc, 0.85, 1.2), 0.6);
  }
  return { alvo, dist, polar, azim };
}
