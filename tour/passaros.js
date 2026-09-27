/* Pássaros em 3D voando sobre o "Voo pelo Haras".
   Araras-vermelhas (pares, batida lenta e funda), maritacas (bandos verdes, asa rápida) e
   canários-da-terra (amarelos, voo em "pulos": rajada de batidas e asa fechada).
   Modelos feitos aqui (Three.js, sem arquivos externos): corpo afinado com cabeça, asas curvas
   com penas desenhadas nas cores reais (arara: coberteiras vermelhas, faixa amarela, rêmiges
   azuis) e pontas recortadas; vistos um pouco de cima, como o drone os veria.
   Tudo é função do tempo do vídeo: pausar congela os pássaros; pular de capítulo leva à
   posição certa. A agenda é fixa (sorteio com semente) — igual em toda visita.

   Uso: const parar = iniciarPassaros(video, caixa); … parar();
*/
import * as THREE from 'three';

const FOV = 50;
const INCL = 0.3;   // a câmera olha um pouco para baixo: vemos os pássaros de cima, como o drone

// ---------------------------------------------------------------- utilidades
function semente(s) { return () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const lerp = (a, b, k) => a + (b - a) * k;
function interp(pts, v) {   // pts = [[v, a, b, …], …] ordenado por v
  for (let i = 1; i < pts.length; i++) if (v <= pts[i][0]) {
    const [v0, ...a] = pts[i - 1], [v1, ...b] = pts[i], k = (v - v0) / (v1 - v0 || 1);
    return a.map((x, j) => lerp(x, b[j], k));
  }
  return pts[pts.length - 1].slice(1);
}

function textura(desenhar, w = 256, h = 256) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  desenhar(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
const material = (map, rug = 0.75) => new THREE.MeshStandardMaterial({ map, roughness: rug, metalness: 0, side: THREE.DoubleSide, alphaTest: 0.5, transparent: false });
const liso = (cor, rug = 0.5) => new THREE.MeshStandardMaterial({ color: cor, roughness: rug, metalness: 0 });

/* textura de asa: x = u (0 bordo de fuga … 1 bordo de ataque), y = v (0 raiz … 1 ponta)
   faixas = [[u0, u1, cor], …]; rem = até onde vão as rêmiges (penas de voo); n = nº de penas */
function texAsa({ faixas, rem = 0.45, n = 10, linha = 'rgba(0,0,0,.35)', brilho = 'rgba(255,255,255,.12)', ponta = false }) {
  return textura((g, W, H) => {
    for (const [u0, u1, cor] of faixas) { g.fillStyle = cor; g.fillRect(u0 * W, 0, (u1 - u0) * W + 1, H); }
    // rêmiges: uma pena por faixa de v, com haste clara e divisões escuras
    for (let i = 0; i <= n; i++) {
      const y = (i / n) * H;
      g.strokeStyle = linha; g.lineWidth = 2.2; g.beginPath(); g.moveTo(0, y); g.lineTo(rem * W, y + 4); g.stroke();
      g.strokeStyle = brilho; g.lineWidth = 1; g.beginPath(); g.moveTo(0, y + H / n / 2); g.lineTo(rem * W * 0.95, y + H / n / 2 + 3); g.stroke();
    }
    // coberteiras: fileiras de escamas
    g.strokeStyle = linha; g.lineWidth = 1.2;
    for (let fu = rem; fu < 1; fu += 0.09) for (let j = 0; j < 14; j++) {
      const x = fu * W, y = (j + (Math.round(fu * 11) % 2) * 0.5) / 14 * H;
      g.beginPath(); g.arc(x, y, H / 28, Math.PI * 0.5, Math.PI * 1.5, false); g.stroke();
    }
    // pontas das penas recortadas (transparência)
    g.globalCompositeOperation = 'destination-out';
    const funda = ponta ? 0.16 : 0.07;
    for (let i = 0; i <= n; i++) {
      const y = (i / n) * H;
      g.beginPath(); g.moveTo(0, y - H / n * 0.28); g.lineTo(funda * W * (ponta ? 0.4 + 0.6 * i / n : 1), y); g.lineTo(0, y + H / n * 0.28); g.fill();
    }
    g.globalCompositeOperation = 'source-over';
  });
}

/* textura de corpo (torno): x = volta (0 lado esq., .25 barriga, .5 lado dir., .75 dorso), y = comprimento (0 cauda … 1 bico)
   zonas = [[y0, y1, cor], …]; manchas = [[x, y, rx, ry, cor], …] */
function texCorpo({ zonas, manchas = [], escama = 'rgba(0,0,0,.18)' }) {
  return textura((g, W, H) => {
    // a textura sobe invertida (flipY): y da tela = 1 - comprimento
    for (const [y0, y1, cor] of zonas) { g.fillStyle = cor; g.fillRect(0, (1 - y1) * H, W, (y1 - y0) * H + 1); }
    g.strokeStyle = escama; g.lineWidth = 1;
    for (let j = 0; j < 22; j++) for (let i = 0; i < 18; i++) {
      g.beginPath(); g.arc((i + (j % 2) * 0.5) / 18 * W, j / 22 * H, W / 40, 0, Math.PI, false); g.stroke();
    }
    for (const [x, y, rx, ry, cor] of manchas) for (const dx of [0, W]) {
      g.fillStyle = cor; g.beginPath(); g.ellipse(x * W + dx - (x > 0.5 ? W : 0), (1 - y) * H, rx * W, ry * H, 0, 0, Math.PI * 2); g.fill();
    }
  }, 256, 256);
}

// ---------------------------------------------------------------- geometrias
/** lâmina de asa: perfil = [[v, bordoAtaque, bordoFuga], …] em x; vão em z; arqueada (camber) */
function lamina(vao, perfil, lado, camber, mat) {
  const nu = 6, nv = 10, pos = [], uv = [], idx = [];
  for (let j = 0; j <= nv; j++) {
    const v = j / nv, [xl, xt] = interp(perfil, v);
    for (let i = 0; i <= nu; i++) {
      const u = i / nu, x = lerp(xt, xl, u);
      pos.push(x, camber * (xl - xt) * Math.sin(Math.PI * u) * (1 - 0.5 * v), v * vao * lado);
      uv.push(u, v);
    }
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return new THREE.Mesh(g, mat);
}

/** cauda: comprimento em -x, largura em z, penas ao longo do comprimento */
function cauda(comp, perfil, mat) {
  const nu = 6, ns = 8, pos = [], uv = [], idx = [];
  for (let j = 0; j <= ns; j++) {
    const s = j / ns, [meia] = interp(perfil, s);
    for (let i = 0; i <= nu; i++) { const u = i / nu; pos.push(-s * comp, 0.004 * Math.sin(Math.PI * u), (u * 2 - 1) * meia); uv.push(s, u); }
  }
  for (let j = 0; j < ns; j++) for (let i = 0; i < nu; i++) {
    const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1; idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return new THREE.Mesh(g, mat);
}

/** corpo de torno: perfil = [[t (0 cauda … 1 bico), raio], …] ao longo de x (comprimento L) */
function corpoTorno(L, perfil, mat, achatar = 0.85) {
  const pts = [];
  for (let k = 0; k <= 24; k++) { const t = k / 24, [r] = interp(perfil, t); pts.push(new THREE.Vector2(Math.max(r, 0.0005), (t - 0.5) * L)); }
  const g = new THREE.LatheGeometry(pts, 18);
  g.rotateZ(-Math.PI / 2);          // eixo do torno (y) → comprimento (x)
  g.scale(1, achatar, 1);
  return new THREE.Mesh(g, mat);
}

function bico(g, x, comp, raio, corCima, corBaixo, curva) {
  const cima = new THREE.Mesh(new THREE.ConeGeometry(raio, comp, 12), liso(corCima, 0.35));
  cima.rotation.z = -Math.PI / 2 - curva; cima.position.set(x + comp * 0.4, -comp * curva * 0.25, 0); g.add(cima);
  if (corBaixo) {
    const baixo = new THREE.Mesh(new THREE.ConeGeometry(raio * 0.75, comp * 0.55, 10), liso(corBaixo, 0.35));
    baixo.rotation.z = -Math.PI / 2 + 0.25; baixo.position.set(x + comp * 0.2, -raio * 0.7, 0); g.add(baixo);
  }
}

function olhos(g, x, y, lado, raio) {
  for (const s of [1, -1]) { const o = new THREE.Mesh(new THREE.SphereGeometry(raio, 8, 6), liso(0x111111, 0.2)); o.position.set(x, y, s * lado); g.add(o); }
}

/** par de asas (interna + externa articulada) */
function asas(g, d) {
  const lados = [];
  for (const lado of [1, -1]) {
    const piv = new THREE.Group(); piv.position.set(d.ombro, 0.01, lado * d.largura);
    piv.add(lamina(d.vi, d.pInt, lado, d.camber, d.mInt));
    const ext = new THREE.Group(); ext.position.z = lado * d.vi;
    ext.add(lamina(d.vo, d.pExt, lado, d.camber * 0.7, d.mExt));
    piv.add(ext); piv.userData.ext = ext;
    g.add(piv); lados.push(piv);
  }
  return lados;
}

// ---------------------------------------------------------------- espécies
const ESPECIES = {
  arara: {
    bate: 2.4, amp: 0.7, fixo: 0.1,
    montar() {
      const g = new THREE.Group();
      const R = '#c3211a', A = '#f4c21f', Z = '#2459b3';
      g.add(corpoTorno(0.44, [[0, 0.012], [0.12, 0.045], [0.45, 0.07], [0.72, 0.058], [0.8, 0.05], [0.9, 0.056], [1, 0.03]],
        material(texCorpo({ zonas: [[0, 1, R]], manchas: [[0, 0.9, 0.08, 0.05, '#f1ece2'], [0.5, 0.9, 0.08, 0.05, '#f1ece2']] }))));
      bico(g, 0.2, 0.09, 0.034, 0xe9dfcc, 0x1b1b1b, 0.55);
      olhos(g, 0.19, 0.018, 0.045, 0.008);
      const tex = { R, A, Z };
      const mInt = material(texAsa({ faixas: [[0, 0.4, Z], [0.4, 0.62, A], [0.62, 1, R]], rem: 0.4, n: 9 }));
      const mExt = material(texAsa({ faixas: [[0, 0.82, Z], [0.82, 1, R]], rem: 0.82, n: 8, ponta: true }));
      const ld = asas(g, { ombro: 0.05, largura: 0.04, vi: 0.2, vo: 0.3, camber: 0.12, mInt, mExt,
        pInt: [[0, 0.07, -0.12], [1, 0.065, -0.14]], pExt: [[0, 0.065, -0.14], [0.6, 0.04, -0.12], [0.9, 0.0, -0.08], [1, -0.03, -0.05]] });
      const c = cauda(0.5, [[0, 0.045], [0.5, 0.035], [0.85, 0.02], [1, 0.004]],
        material(textura((q, W, H) => { q.fillStyle = tex.R; q.fillRect(0, 0, W, H); q.fillStyle = tex.Z; q.fillRect(W * 0.62, 0, W * 0.38, H); q.fillRect(0, 0, W, H * 0.12); q.fillRect(0, H * 0.88, W, H * 0.12);
          q.strokeStyle = 'rgba(0,0,0,.3)'; for (let i = 1; i < 6; i++) { q.beginPath(); q.moveTo(0, i * H / 6); q.lineTo(W, i * H / 6); q.stroke(); } })));
      c.position.set(-0.19, 0.0, 0); g.add(c);
      return { g, e: ld };
    },
  },
  maritaca: {
    bate: 8, amp: 0.5, fixo: 0.05,
    montar() {
      const g = new THREE.Group();
      const V = '#3f9d3b', E = '#2a6c52', C = '#6cbf4e';
      g.add(corpoTorno(0.17, [[0, 0.006], [0.15, 0.02], [0.45, 0.03], [0.75, 0.025], [0.9, 0.024], [1, 0.012]],
        material(texCorpo({ zonas: [[0, 0.7, V], [0.7, 1, C]], manchas: [[0, 0.9, 0.05, 0.04, '#f2efe6'], [0.5, 0.9, 0.05, 0.04, '#f2efe6']] }))));
      bico(g, 0.075, 0.03, 0.012, 0xeadfc6, 0xd8c8a8, 0.5);
      olhos(g, 0.072, 0.008, 0.018, 0.004);
      const mInt = material(texAsa({ faixas: [[0, 0.5, E], [0.5, 1, V]], rem: 0.5, n: 8 }));
      const mExt = material(texAsa({ faixas: [[0, 0.85, E], [0.85, 1, V]], rem: 0.85, n: 7, ponta: true }));
      const ld = asas(g, { ombro: 0.015, largura: 0.016, vi: 0.08, vo: 0.13, camber: 0.1, mInt, mExt,
        pInt: [[0, 0.03, -0.05], [1, 0.028, -0.055]], pExt: [[0, 0.028, -0.055], [0.7, 0.012, -0.035], [1, -0.015, -0.02]] });
      const c = cauda(0.15, [[0, 0.018], [0.6, 0.014], [1, 0.002]], material(texAsa({ faixas: [[0, 1, V]], rem: 1, n: 4 })));
      c.position.set(-0.075, 0, 0); g.add(c);
      return { g, e: ld };
    },
  },
  canario: {
    bate: 13, amp: 0.6, fixo: 0.05, pulos: true,
    montar() {
      const g = new THREE.Group();
      const Y = '#f3cd1c', O = '#f08c13', L = '#b9a62c', M = '#5b4a1f';
      g.add(corpoTorno(0.1, [[0, 0.004], [0.2, 0.017], [0.5, 0.025], [0.75, 0.021], [0.9, 0.02], [1, 0.008]],
        material(texCorpo({ zonas: [[0, 0.75, Y], [0.75, 1, O]], escama: 'rgba(90,60,0,.15)' }))));
      bico(g, 0.045, 0.016, 0.007, 0xd9c7a2, null, 0.1);
      olhos(g, 0.04, 0.007, 0.014, 0.003);
      const mInt = material(texAsa({ faixas: [[0, 0.5, M], [0.5, 1, L]], rem: 0.5, n: 7, brilho: 'rgba(255,230,120,.35)' }));
      const mExt = material(texAsa({ faixas: [[0, 0.9, M], [0.9, 1, L]], rem: 0.9, n: 6, brilho: 'rgba(255,230,120,.35)', ponta: true }));
      const ld = asas(g, { ombro: 0.008, largura: 0.012, vi: 0.04, vo: 0.06, camber: 0.1, mInt, mExt,
        pInt: [[0, 0.018, -0.03], [1, 0.016, -0.032]], pExt: [[0, 0.016, -0.032], [0.7, 0.006, -0.022], [1, -0.008, -0.012]] });
      const c = cauda(0.05, [[0, 0.012], [1, 0.014]], material(texAsa({ faixas: [[0, 1, L]], rem: 1, n: 4 })));
      c.position.set(-0.045, 0, 0); g.add(c);
      return { g, e: ld };
    },
  },
};

// ---------------------------------------------------------------- agenda (uma vez ou outra)
function agenda(dur) {
  const r = semente(2609), ev = [], ordem = ['canario', 'arara', 'maritaca', 'canario', 'maritaca', 'arara'];
  let t = 5, k = 0;
  while (t < dur - 6) {
    const tipo = ordem[k++ % ordem.length];
    const dir = r() < 0.5 ? 1 : -1;
    const base = {
      arara: { n: r() < 0.25 ? 1 : 2, z: 4.5 + r() * 3.5, dura: 6.5 + r() * 2, alt: -0.35 + r() * 0.6 },
      maritaca: { n: 5 + Math.floor(r() * 4), z: 4 + r() * 3, dura: 4.2 + r() * 1.2, alt: -0.4 + r() * 0.7 },
      canario: { n: 3 + Math.floor(r() * 4), z: 2 + r() * 1.2, dura: 2.6 + r() * 0.8, alt: -0.4 + r() * 0.6 },
    }[tipo];
    const membros = Array.from({ length: base.n }, (_, i) => ({
      atraso: i * (tipo === 'arara' ? 0.3 : 0.12) + r() * 0.25,
      dx: (r() - 0.5) * 0.4, dy: (r() - 0.5) * (tipo === 'arara' ? 0.25 : 0.5), dz: (r() - 0.5) * (tipo === 'arara' ? 0.7 : 1.4),
      fase: r() * 10, vel: 0.92 + r() * 0.16,
    }));
    ev.push({ t0: t, tipo, dir, ...base, sobe: (r() - 0.5) * 0.2, aproxima: (r() - 0.5) * base.z * 0.35, membros });
    t += 11 + r() * 12;
  }
  return ev;
}

// ---------------------------------------------------------------- cena
export function iniciarPassaros(video, caixa, opcoes = {}) {
  const canvas = document.createElement('canvas');
  canvas.className = 'voo__passaros'; canvas.setAttribute('aria-hidden', 'true');
  caixa.appendChild(canvas);
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' }); }
  catch (e) { canvas.remove(); return () => {}; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  const cena = new THREE.Scene();
  cena.add(new THREE.HemisphereLight(0xeef2f6, 0x8a7652, 1.35));        // céu nublado + reflexo da terra
  const sol = new THREE.DirectionalLight(0xfff6ea, 1.9); sol.position.set(3, 8, 4); cena.add(sol);
  const cam = new THREE.PerspectiveCamera(opcoes.fov || FOV, 16 / 9, 0.05, 120);
  cam.rotation.x = -INCL;

  const eventos = agenda(video.duration || 216);
  const vivos = new Map();
  const montar = (ev) => ev.membros.map(() => { const p = ESPECIES[ev.tipo].montar(); p.g.visible = false; cena.add(p.g); return p; });
  const descartar = (partes) => partes.forEach((p) => { cena.remove(p.g); p.g.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) { o.material.map?.dispose(); o.material.dispose(); } }); });

  let largura = 0, altura = 0;
  function encaixar() {   // o canvas cobre só a imagem do vídeo (sem as faixas pretas)
    const r = video.getBoundingClientRect(), vw = video.videoWidth || 16, vh = video.videoHeight || 9, rc = caixa.getBoundingClientRect();
    const s = Math.min(r.width / vw, r.height / vh), w = vw * s, h = vh * s;
    Object.assign(canvas.style, { left: `${r.left - rc.left + (r.width - w) / 2}px`, top: `${r.top - rc.top + (r.height - h) / 2}px`, width: `${w}px`, height: `${h}px` });
    if (Math.round(w) !== largura || Math.round(h) !== altura) {
      largura = Math.round(w); altura = Math.round(h);
      renderer.setSize(largura, altura, false); cam.aspect = w / h; cam.updateProjectionMatrix();
    }
  }

  const tanV = Math.tan(THREE.MathUtils.degToRad(FOV / 2)), tanI = Math.tan(INCL);
  function posicao(ev, m, tt) {
    const p = (tt - m.atraso) / ev.dura * m.vel;
    const dist = ev.z + m.dz + ev.aproxima * p;
    const X = dist * tanV * cam.aspect + 0.8;
    const x = ev.dir * (-X + 2 * X * p) + m.dx;
    let y = -tanI * dist + (ev.alt + ev.sobe * p) * dist * tanV + m.dy + Math.sin(Math.PI * p) * 0.12 * dist / 5;
    if (ESPECIES[ev.tipo].pulos) {   // canário: sobe batendo, desce de asa fechada
      const c = ((tt * 1.6 + m.fase) % 1);
      y += (c < 0.55 ? c / 0.55 : 1 - (c - 0.55) / 0.45) * 0.08;
    }
    return { p, v: new THREE.Vector3(x, y, -dist) };
  }

  function pose(ev, m, parte, tt) {
    const e = ESPECIES[ev.tipo];
    const a = posicao(ev, m, tt), b = posicao(ev, m, tt + 0.04);
    const g = parte.g;
    g.visible = a.p > -0.05 && a.p < 1.05;
    if (!g.visible) return;
    g.position.copy(a.v);
    const d = b.v.clone().sub(a.v);
    g.rotation.order = 'YZX';
    g.rotation.y = Math.atan2(-d.z, d.x);
    g.rotation.z = Math.atan2(d.y, Math.hypot(d.x, d.z)) * 0.8;
    g.rotation.x = Math.sin(tt * 1.3 + m.fase) * 0.1;
    let bat = Math.sin((tt + m.fase) * e.bate * Math.PI * 2);
    let abre = 1;
    if (e.pulos) { const c = ((tt * 1.6 + m.fase) % 1); if (c >= 0.55) { bat = -0.3; abre = 0.25; } }
    const ang = e.amp * bat + e.fixo;
    const [ae, ad] = parte.e;
    ae.rotation.x = -ang; ad.rotation.x = ang;
    ae.scale.z = ad.scale.z = abre;
    const dobra = e.amp * 0.6 * Math.sin((tt + m.fase) * e.bate * Math.PI * 2 - 0.9);
    ae.userData.ext.rotation.x = -dobra; ad.userData.ext.rotation.x = dobra;
    g.position.y += -bat * 0.01 * (ev.tipo === 'arara' ? 3 : 1);
  }

  let raf = 0, ativo = true, limpo = false;
  function quadro() {
    if (!ativo) return;
    raf = requestAnimationFrame(quadro);
    const tv = video.currentTime;
    const agora = eventos.filter((ev) => tv >= ev.t0 - 0.2 && tv <= ev.t0 + ev.dura + 1.4);
    for (const [ev, partes] of vivos) if (!agora.includes(ev)) { descartar(partes); vivos.delete(ev); }
    if (!agora.length) { if (!limpo) { renderer.clear(); limpo = true; } return; }
    encaixar();
    for (const ev of agora) {
      if (!vivos.has(ev)) vivos.set(ev, montar(ev));
      const partes = vivos.get(ev);
      ev.membros.forEach((m, i) => pose(ev, m, partes[i], tv - ev.t0));
    }
    renderer.render(cena, cam); limpo = false;
  }
  const aoRedimensionar = () => { largura = 0; };
  window.addEventListener('resize', aoRedimensionar);
  quadro();
  window.__passaros = { eventos, quadro, cena, renderer, cam };

  return () => {
    ativo = false; cancelAnimationFrame(raf);
    window.removeEventListener('resize', aoRedimensionar);
    for (const partes of vivos.values()) descartar(partes);
    renderer.dispose(); canvas.remove();
  };
}
