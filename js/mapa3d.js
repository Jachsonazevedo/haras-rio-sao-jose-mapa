/* =====================================================================
   Haras Rio São José — mapa3d.js
   Planta humanizada em 3D, interativa, sobre o mesmo painel, busca,
   filtro e link por lote do app.js (ponte: window.HarasMapa).

   Desempenho
   - Desenha só quando a câmera muda (sem laço contínuo).
   - Lotes numa única malha (cor por vértice); árvores, postes, mourões e
     piquetes instanciados; área de lazer fundida por material.
   - Clique resolvido por matemática (raio × chão + ponto no polígono),
     sem "picking" na GPU.
   - Celular: menos árvores, geometria mais simples e pixel ratio ≤ 1,5.
   Se o WebGL ou o CDN falharem, o mapa SVG do app.js continua valendo.
   ===================================================================== */
import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { construirCena, enquadrarPontos, simplificarPoly } from './cena3d.js?v=20260924c';

const ponte = window.HarasMapa;
const quadro = document.getElementById('mapa-quadro');
const MOVEL = window.matchMedia('(pointer: coarse)').matches && Math.min(window.innerWidth, window.innerHeight) < 900;
const MENOS_MOVIMENTO = window.matchMedia('(prefers-reduced-motion: reduce)');
const DESKTOP = window.matchMedia('(min-width: 900px)');

function falhar(motivo) {
  console.warn('[mapa 3D] usando o mapa 2D:', motivo);
  window.dispatchEvent(new CustomEvent('haras:3d-falhou', { detail: String(motivo) }));
}

const esperarDados = () => new Promise((ok) => {
  if (ponte && ponte.dados) return ok(ponte.dados);
  window.addEventListener('haras:dados', () => ok(ponte.dados), { once: true });
});

// Ícones (mesmo traço do app.js)
const ICONE = {
  guarita: 'M3 21V10l9-6 9 6v11H3zM9 21v-7h6v7M3 14h18',
  lazer: 'M3 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0M3 19c2-2 4-2 6 0s4 2 6 0 4-2 6 0M8 14V6a2 2 0 0 1 4 0M14 14V6a2 2 0 0 1 4 0',
  reserva: 'M12 3l6 8h-3l4 6h-5v4h-4v-4H5l4-6H6zM12 21v-4',
  lago: 'M12 3s-6 6.5-6 11a6 6 0 0 0 12 0c0-4.5-6-11-6-11z',
};
const svgIcone = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

async function iniciar() {
  if (!ponte || !quadro) return falhar('app.js ausente');
  if (!window.__haras3d) return; // sem WebGL ou ?2d=1: o app.js já mostrou o mapa SVG
  const dados = await esperarDados();

  // ---------------------------------------------------------------- Renderizador
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', logarithmicDepthBuffer: true });
  } catch (e) { return falhar(e); }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MOVEL ? 1.5 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.97;
  const canvas = renderer.domElement;
  canvas.className = 'mapa3d__canvas';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Planta humanizada em 3D do chacreamento. Arraste para mover, use dois dedos ou o botão direito do mouse para girar, e a busca para localizar um lote.');
  canvas.tabIndex = 0;

  let cena;
  try {
    cena = construirCena(dados, { qualidade: MOVEL ? 'movel' : 'desktop' });
  } catch (e) { console.error(e); return falhar(e); }
  const { scene } = cena;
  cena.definirModo('maquete', renderer);             // padrão: maquete sobre fundo claro (como o mapa ilustrado)
  if (!MOVEL) cena.sombraGlobal(renderer, true, 4096); // sombras reais de árvores, prédios e postes (calculadas uma vez)

  // Reflexos suaves do céu (água, vidro, telhados)
  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const ceuPeq = new THREE.Scene();
    const g = new THREE.SphereGeometry(10, 24, 12); const cols = [];
    const topo = new THREE.Color('#6FA6DC'), horiz = new THREE.Color('#EAE7DA'), chao = new THREE.Color('#8C8A5E');
    for (let i = 0; i < g.attributes.position.count; i++) {
      const h = g.attributes.position.getY(i) / 10;
      const c = h >= 0 ? horiz.clone().lerp(topo, Math.min(1, h * 1.4)) : horiz.clone().lerp(chao, Math.min(1, -h * 3));
      cols.push(c.r, c.g, c.b);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    ceuPeq.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
    scene.environment = pmrem.fromScene(ceuPeq, 0.02).texture;
  } catch (_) { /* sem reflexos: segue normal */ }

  const camera = new THREE.PerspectiveCamera(40, 1, 2, 90000);
  const controls = new MapControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.085;
  controls.screenSpacePanning = false;
  controls.zoomToCursor = true;
  controls.minDistance = 22;
  controls.maxDistance = 9000;
  controls.maxPolarAngle = 1.3;
  controls.minPolarAngle = 0;
  controls.rotateSpeed = 0.6;
  controls.zoomSpeed = 1.1;
  controls.keys = { LEFT: 'ArrowLeft', UP: 'ArrowUp', RIGHT: 'ArrowRight', BOTTOM: 'ArrowDown' };
  controls.listenToKeyEvents(canvas);

  // ---------------------------------------------------------------- Camadas HTML: canvas + rótulos
  const caixa = document.createElement('div');
  caixa.className = 'mapa3d';
  caixa.appendChild(canvas);
  const rot = document.createElement('div');
  rot.className = 'rotulos3d';
  caixa.appendChild(rot);
  quadro.insertBefore(caixa, quadro.firstChild);

  const vista = { w: 1, h: 1, mexeu: false, anim: null, pendente: false };

  // ---------------------------------------------------------------- Desenho sob demanda
  function pedir() { if (!vista.pendente) { vista.pendente = true; requestAnimationFrame(quadroAnim); } }
  function quadroAnim(t) {
    vista.pendente = false;
    let continuar = false;
    if (vista.anim) continuar = passoAnim(t) || continuar;
    if (controls.update()) continuar = true;
    limitarAlvo();
    desenhar();
    if (continuar) pedir();
  }
  controls.addEventListener('change', () => { pedir(); });
  controls.addEventListener('start', () => { vista.anim = null; vista.mexeu = true; quadro.classList.add('is-mexendo'); });
  controls.addEventListener('end', () => { quadro.classList.remove('is-mexendo'); });

  function limitarAlvo() {
    const b = cena.bb, m = 350, t = controls.target;
    const x = Math.min(b.maxx + m, Math.max(b.minx - m, t.x));
    const z = Math.min(b.maxz + m, Math.max(b.minz - (cena.modo === 'maquete' ? 450 : 1400), t.z)); // no entorno, deixa ir para o norte (Poções)
    if (x !== t.x || z !== t.z || t.y !== 0) {
      const dx = x - t.x, dz = z - t.z, dy = -t.y;
      t.set(x, 0, z); camera.position.x += dx; camera.position.z += dz; camera.position.y += dy;
    }
    if (camera.position.y < 12) camera.position.y = 12;
  }

  function desenhar() {
    const d = camera.position.distanceTo(controls.target);
    if (scene.fog) { scene.fog.near = Math.max(900, d * 1.25); scene.fog.far = Math.max(7000, d * 5.5); }
    cena.ajustarDistancia(d);
    renderer.render(scene, camera);
    atualizarRotulos(d);
    atualizarBussola();
    atualizarEscala();
    if (ponte.reposicionar) ponte.reposicionar();
  }

  // ---------------------------------------------------------------- Tamanho
  function redimensionar() {
    const r = quadro.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    if (w === vista.w && h === vista.h) return;
    vista.w = w; vista.h = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    if (!vista.mexeu) verTudo(false); else pedir();
  }
  if ('ResizeObserver' in window) new ResizeObserver(redimensionar).observe(quadro);
  else window.addEventListener('resize', redimensionar);

  // ---------------------------------------------------------------- Câmera: vistas e voos
  const esf = new THREE.Spherical();
  function posicaoDe(alvo, dist, polar, azim) {
    esf.set(dist, polar, azim);
    return new THREE.Vector3().setFromSpherical(esf).add(alvo);
  }
  function estadoAtual() {
    const off = camera.position.clone().sub(controls.target);
    esf.setFromVector3(off);
    return { dist: esf.radius, polar: esf.phi, azim: esf.theta };
  }

  // Vista inicial: no computador, de frente (sul → norte), mostrando o chacreamento inteiro;
  // no celular (tela em pé), da portaria para o fundo, ao longo do comprimento — o empreendimento ocupa a tela.
  function vistaInicial() {
    const asp = vista.w / vista.h;
    if (asp >= 1.05) return enquadrar(0.72, -0.18, { x: 0.02, topo: 0.13, base: 0.16 });
    return enquadrar(1.05, -Math.PI / 2 + 0.38, { x: 0.08, topo: 0.2, base: 0.16 });
  }

  // Enquadra o contorno do imóvel com as margens pedidas (vale para qualquer ângulo e formato de tela)
  function enquadrar(polar, azim, m) {
    const v = enquadrarPontos(camera, cena.polyImovel, polar, azim, m);
    v.dist = THREE.MathUtils.clamp(v.dist, controls.minDistance, controls.maxDistance);
    return v;
  }

  function voar(para, ms = 900) {
    const de = { alvo: controls.target.clone(), ...estadoAtual() };
    if (!ms || MENOS_MOVIMENTO.matches) {
      controls.target.copy(para.alvo);
      camera.position.copy(posicaoDe(para.alvo, para.dist, para.polar, para.azim));
      camera.lookAt(para.alvo);
      pedir(); return;
    }
    // menor caminho no azimute
    let dA = para.azim - de.azim; while (dA > Math.PI) dA -= 2 * Math.PI; while (dA < -Math.PI) dA += 2 * Math.PI;
    vista.anim = { de, para: { ...para, azim: de.azim + dA }, t0: performance.now(), ms };
    pedir();
  }
  function passoAnim(t) {
    const a = vista.anim; if (!a) return false;
    const p = Math.min(1, (t - a.t0) / a.ms);
    const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
    const alvo = a.de.alvo.clone().lerp(a.para.alvo, e);
    const dist = a.de.dist * Math.pow(a.para.dist / a.de.dist, e);
    const polar = a.de.polar + (a.para.polar - a.de.polar) * e;
    const azim = a.de.azim + (a.para.azim - a.de.azim) * e;
    controls.target.copy(alvo);
    camera.position.copy(posicaoDe(alvo, dist, polar, azim));
    camera.lookAt(alvo);
    if (p >= 1) { vista.anim = null; return false; }
    return true;
  }

  function verTudo(animar = true) {
    const v = vistaInicial();
    if (animar) voar(v, 900); else voar(v, 0);
  }

  // Coloca o ponto do chão no lugar da tela que o painel não cobre
  function pontoLivreTela() {
    const painel = document.getElementById('painel');
    const aberto = painel && painel.classList.contains('is-aberto');
    if (DESKTOP.matches) {
      const pw = aberto ? painel.offsetWidth + 32 : 0;
      return { x: Math.max(vista.w * 0.28, (vista.w - pw) / 2), y: vista.h * 0.52 };
    }
    const ph = aberto ? painel.offsetHeight : 0;
    return { x: vista.w / 2, y: Math.max(vista.h * 0.22, (vista.h - ph) * 0.52) };
  }
  const ray = new THREE.Raycaster(), plano = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), ndc = new THREE.Vector2(), pto = new THREE.Vector3();
  function chaoSobTela(x, y, cam = camera) {
    ndc.set((x / vista.w) * 2 - 1, -(y / vista.h) * 2 + 1);
    ray.setFromCamera(ndc, cam);
    return ray.ray.intersectPlane(plano, pto) ? pto.clone() : null;
  }

  function focarEm(c, { dist, polar } = {}) {
    const atual = estadoAtual();
    const alvo = new THREE.Vector3(c[0], 0, c[1]);
    const para = { alvo, dist: dist ?? atual.dist, polar: polar ?? Math.min(atual.polar, 0.95), azim: atual.azim };
    // corrige o alvo para o ponto cair na área livre da tela
    const cam = camera.clone();
    cam.position.copy(posicaoDe(alvo, para.dist, para.polar, para.azim)); cam.lookAt(alvo); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
    const livre = pontoLivreTela();
    const q = chaoSobTela(livre.x, livre.y, cam);
    if (q) { para.alvo = alvo.clone().add(alvo.clone().sub(q)); para.alvo.y = 0; }
    voar(para, 850);
  }

  // ---------------------------------------------------------------- Lotes: cor, filtro, destaque, passar o mouse
  let soDisponiveis = false;
  let hover = null;
  let selecionado = null;
  const clara = new THREE.Color();
  function corDoLote(id, status) {
    const base = cena.corBase(id);
    if (soDisponiveis && status !== 'disponivel') return cena.corApagada;
    return base;
  }
  function repintarTodos() { for (const l of cena.lotes) cena.pintarLote(l.id, corDoLote(l.id, l.status)); }
  function pintarHover(l, ligado) {
    if (!l) return;
    const c = corDoLote(l.id, l.status);
    if (ligado) { clara.copy(c).lerp(new THREE.Color('#FFFFFF'), 0.28); cena.pintarLote(l.id, clara); }
    else cena.pintarLote(l.id, c);
  }

  // ---------------------------------------------------------------- Rótulos
  const v3 = new THREE.Vector3();
  function tela(p) {
    v3.copy(p).project(camera);
    if (v3.z > 1 || v3.z < -1) return null;
    const x = (v3.x + 1) / 2 * vista.w, y = (1 - v3.y) / 2 * vista.h;
    if (x < -60 || x > vista.w + 60 || y < -40 || y > vista.h + 40) return null;
    return { x, y };
  }
  const pos = (el, x, y) => { el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`; };

  const glebas = cena.ancoras.glebas.map((g) => {
    const el = document.createElement('span'); el.className = 'r3 r3-gleba'; el.textContent = g.id; rot.appendChild(el);
    return { ...g, el };
  });
  const placas = cena.ancoras.vias.map((v) => {
    const el = document.createElement('span'); el.className = `r3 r3-via r3-via--${v.tipo}`; el.textContent = v.texto; rot.appendChild(el);
    return { ...v, el };
  });
  // marcadores clicáveis: portaria e área de lazer (mesmos ids do app.js), lago e reserva (só nome)
  const marcadores = [];
  const pontosApp = ponte.pontos || [];
  const addMarcador = (id, nome, tipo, p, clicavel) => {
    const el = document.createElement(clicavel ? 'button' : 'span');
    el.className = `r3 r3-marca r3-marca--${tipo}`;
    if (clicavel) { el.type = 'button'; el.setAttribute('aria-label', nome); el.addEventListener('click', (e) => { e.stopPropagation(); ponte.focarPonto(id); }); }
    el.innerHTML = `${ICONE[tipo] ? svgIcone(ICONE[tipo]) : ''}<span>${nome}</span>`;
    rot.appendChild(el);
    marcadores.push({ id, p, el });
  };
  for (const p of pontosApp) {
    if (!Array.isArray(p.c)) continue;
    if (p.tipo === 'guarita') addMarcador(p.id, 'Portaria', 'guarita', new THREE.Vector3(p.c[0], 12, p.c[1]), true);
    if (p.id === 'lazer') addMarcador('lazer', 'Área de lazer', 'lazer', new THREE.Vector3(p.c[0], 14, p.c[1]), true);
  }
  for (const m of cena.ancoras.marcadores) addMarcador(m.id, m.nome, m.tipo, m.p, m.id === 'reserva' && pontosApp.some((p) => p.id === 'reserva'));
  const itensLazer = cena.ancoras.lazer.map((it) => {
    const el = document.createElement('button'); el.type = 'button'; el.className = 'r3 r3-item'; el.textContent = it.nome;
    el.addEventListener('click', (e) => { e.stopPropagation(); ponte.focarPonto(it.id); });
    rot.appendChild(el); return { ...it, el };
  });
  const POOL = MOVEL ? 70 : 140;
  const poolLotes = Array.from({ length: POOL }, () => { const el = document.createElement('span'); el.className = 'r3 r3-lote'; rot.appendChild(el); return el; });
  const tagSel = document.createElement('span'); tagSel.className = 'r3 r3-sel'; rot.appendChild(tagSel);
  const tagsMedida = Array.from({ length: 4 }, () => { const el = document.createElement('span'); el.className = 'r3 r3-medida'; rot.appendChild(el); return el; });
  let medidas = []; // [{ p: Vector3, texto }]
  const fmtM = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // Frente = lado que encosta na via; fundo = oposto; esquerda/direita de quem olha o lote a partir da via
  function calcularMedidas(lote) {
    const l = cena.lotes.find((x) => x.id === String(lote.id));
    if (!l) return [];
    const p = simplificarPoly(l.poly);
    if (p.length !== 4) return [];
    const lados = p.map((a, i) => { const b = p[(i + 1) % 4]; return { a, b, m: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] }; });
    let iF = 0, melhor = Infinity;
    lados.forEach((ld, i) => { const d = cena.distVia(ld.m); if (d < melhor) { melhor = d; iF = i; } });
    const fr = lados[iF], fu = lados[(iF + 2) % 4], l1 = lados[(iF + 1) % 4], l2 = lados[(iF + 3) % 4];
    const c = l.c;
    const f = [c[0] - fr.m[0], c[1] - fr.m[1]]; // olhando da via para dentro do lote
    const esq = [f[1], -f[0]];               // "esquerda" com z para baixo (sul)
    const ladoEsq = ((l1.m[0] - fr.m[0]) * esq[0] + (l1.m[1] - fr.m[1]) * esq[1]) > 0 ? l1 : l2;
    const ladoDir = ladoEsq === l1 ? l2 : l1;
    const val = (v) => (Number.isFinite(v) ? `${fmtM.format(v)} m` : null);
    return [[fr, val(lote.frente)], [fu, val(lote.fundo)], [ladoEsq, val(lote.esq)], [ladoDir, val(lote.dir)]]
      .filter(([, t]) => t).map(([ld, t]) => ({ p: new THREE.Vector3(ld.m[0], 1, ld.m[1]), texto: t }));
  }

  const vis = (el, sim) => { if (el._vis !== sim) { el.style.display = sim ? '' : 'none'; el._vis = sim; } };
  const ocupados = [];
  const livreEm = (x, y, rx, ry) => {
    for (const o of ocupados) if (Math.abs(o.x - x) < (o.rx + rx) && Math.abs(o.y - y) < (o.ry + ry)) return false;
    ocupados.push({ x, y, rx, ry }); return true;
  };

  function atualizarRotulos(dAlvo) {
    ocupados.length = 0;
    const cam = camera.position;
    // 1) lote selecionado
    if (selecionado) {
      const s = tela(new THREE.Vector3(selecionado.c[0], 4, selecionado.c[1]));
      if (s) { tagSel.textContent = `Lote ${selecionado.id}`; pos(tagSel, s.x, s.y); vis(tagSel, true); livreEm(s.x, s.y - 34, 42, 16); } else vis(tagSel, false);
    } else vis(tagSel, false);
    // 1b) medidas do lote selecionado (de perto)
    tagsMedida.forEach((el, i) => {
      const md = medidas[i];
      const s2 = md && dAlvo < 900 ? tela(md.p) : null;
      if (s2) { if (el.textContent !== md.texto) el.textContent = md.texto; pos(el, s2.x, s2.y); vis(el, true); livreEm(s2.x, s2.y, 34, 10); } else vis(el, false);
    });
    // 2) marcadores (presos dentro da tela e longe da coluna de botões)
    for (const m of marcadores) {
      const s = tela(m.p);
      let ok = false;
      if (s) {
        const hw = m.el._hw || 60;
        const x = Math.min(Math.max(s.x, hw + 8), vista.w - hw - 64);
        ok = x > hw && livreEm(x, s.y - 16, hw, 16);
        if (ok) { vis(m.el, true); pos(m.el, x, s.y); if (!m.el._hw) m.el._hw = m.el.offsetWidth / 2 || 60; }
      }
      if (!ok) vis(m.el, false);
    }
    // 3) itens da área de lazer (de perto)
    for (const it of itensLazer) {
      const d = cam.distanceTo(it.p);
      const s = d < 560 ? tela(it.p) : null;
      const ok = s && livreEm(s.x, s.y, 48, 11);
      vis(it.el, !!ok); if (ok) pos(it.el, s.x, s.y);
    }
    // 4) glebas (prioridade: são a referência de quem procura o lote)
    const mostrarGlebas = dAlvo < 5200;
    for (const g of glebas) {
      let ok = false, s = null;
      if (mostrarGlebas && cam.distanceTo(g.p) < 5500) { s = tela(g.p); if (s) ok = livreEm(s.x, s.y, 13, 12); }
      vis(g.el, ok); if (ok) pos(g.el, s.x, s.y);
    }
    // 5) placas: avenidas saem para fora do miolo (Pau Ferro para cima, Umbuzeiro para baixo) até achar espaço; depois ruas
    const placa = (v) => {
      let ok = false, s = null, dy = 0;
      const d = cam.distanceTo(v.p);
      const limite = v.tipo === 'rua' ? 6000 : 8000;
      if (d < limite && (v.tipo !== 'rua' || v.principal || dAlvo < 900)) {
        s = tela(v.p);
        if (s) {
          const w = v.texto.length * 3.6 + 10;
          const tent = v.tipo === 'avenida' ? (v.texto.startsWith('←') ? [0, 22, 40, 58] : [0, -22, -40, -58]) : [0, -14, 14];
          for (const t of tent) { if (livreEm(s.x, s.y + t, w, 11)) { ok = true; dy = t; break; } }
        }
      }
      vis(v.el, ok); if (ok) pos(v.el, s.x, s.y + dy);
    };
    for (const v of placas) if (v.tipo !== 'rua') placa(v);
    for (const v of placas) if (v.tipo === 'rua') placa(v);
    // 6) números dos lotes (só de perto)
    let usados = 0;
    if (dAlvo < 760) {
      const cand = [];
      for (const a of cena.ancoras.lotes) {
        const d = cam.distanceTo(a.p);
        if (d > 950) continue;
        cand.push([d, a]);
      }
      cand.sort((x, y) => x[0] - y[0]);
      for (const [, a] of cand) {
        if (usados >= POOL) break;
        if (selecionado && a.id === selecionado.id) continue;
        const s = tela(a.p); if (!s) continue;
        if (!livreEm(s.x, s.y, 12, 8)) continue;
        const el = poolLotes[usados++];
        if (el.textContent !== a.id) el.textContent = a.id;
        const cls = `r3 r3-lote r3-lote--${a.status}${soDisponiveis && a.status !== 'disponivel' ? ' is-apagado' : ''}`;
        if (el.className !== cls) el.className = cls;
        pos(el, s.x, s.y); vis(el, true);
      }
    }
    for (let i = usados; i < POOL; i++) vis(poolLotes[i], false);
  }

  // ---------------------------------------------------------------- Escala gráfica (metros no centro da tela)
  const escala = document.createElement('div'); escala.className = 'escala3d'; escala.innerHTML = '<span class="escala3d__barra"></span><span class="escala3d__texto"></span>';
  quadro.appendChild(escala);
  const eBarra = escala.firstChild, eTexto = escala.lastChild;
  const REDONDOS = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000];
  function atualizarEscala() {
    const a = chaoSobTela(vista.w / 2 - 60, vista.h * 0.55), b = chaoSobTela(vista.w / 2 + 60, vista.h * 0.55);
    if (!a || !b) { escala.style.visibility = 'hidden'; return; }
    const mpp = a.distanceTo(b) / 120;
    const alvoM = mpp * 110;
    let m = REDONDOS[0]; for (const v of REDONDOS) if (v <= alvoM) m = v;
    eBarra.style.width = `${Math.round(m / mpp)}px`;
    eTexto.textContent = m >= 1000 ? `${(m / 1000).toLocaleString('pt-BR')} km` : `${m} m`;
    escala.style.visibility = '';
  }

  // ---------------------------------------------------------------- Bússola e alternância 3D / vista de cima
  const controles = quadro.querySelector('.controles');
  const bNorte = document.createElement('button');
  bNorte.className = 'ctrl ctrl--norte'; bNorte.type = 'button'; bNorte.title = 'Norte para cima'; bNorte.setAttribute('aria-label', 'Girar o mapa com o norte para cima');
  bNorte.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 3l4 9h-8z" fill="#A74726"/><path d="M12 21l-4-9h8z" fill="currentColor" opacity=".35"/><text x="12" y="10.4" text-anchor="middle" font-size="5.2" font-weight="700" fill="#fff" font-family="Inter, sans-serif">N</text></svg>';
  const bCima = document.createElement('button');
  bCima.className = 'ctrl ctrl--texto'; bCima.type = 'button'; bCima.title = 'Alternar entre 3D e vista de cima'; bCima.setAttribute('aria-label', 'Alternar entre vista 3D e vista de cima');
  bCima.textContent = '2D';
  const bEntorno = document.createElement('button');
  bEntorno.className = 'ctrl ctrl--entorno'; bEntorno.type = 'button'; bEntorno.title = 'Mostrar a paisagem em volta (entorno)';
  bEntorno.setAttribute('aria-pressed', 'false'); bEntorno.setAttribute('aria-label', 'Mostrar ou esconder a paisagem em volta do chacreamento');
  bEntorno.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M2 19l6-9 4 5 3-4 7 8z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/><circle cx="17" cy="6" r="2.2" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';
  bEntorno.addEventListener('click', () => {
    const entorno = cena.modo !== 'entorno';
    cena.definirModo(entorno ? 'entorno' : 'maquete', renderer);
    bEntorno.setAttribute('aria-pressed', String(entorno));
    quadro.classList.toggle('is-entorno', entorno);
    pedir();
  });
  if (controles) { controles.appendChild(bCima); controles.appendChild(bEntorno); controles.appendChild(bNorte); }
  const svgN = bNorte.querySelector('svg');
  function atualizarBussola() {
    const { azim, polar } = estadoAtual();
    svgN.style.transform = `rotate(${(azim * 180 / Math.PI).toFixed(1)}deg)`;
    const deCima = polar < 0.18;
    if (bCima._deCima !== deCima) { bCima._deCima = deCima; bCima.textContent = deCima ? '3D' : '2D'; }
  }
  bNorte.addEventListener('click', () => { const e = estadoAtual(); voar({ alvo: controls.target.clone(), dist: e.dist, polar: e.polar, azim: 0 }, 700); vista.mexeu = true; });
  bCima.addEventListener('click', () => {
    const e = estadoAtual();
    vista.mexeu = true;
    if (e.polar < 0.18) voar({ alvo: controls.target.clone(), dist: e.dist, polar: 0.86, azim: e.azim }, 800);
    else voar({ alvo: controls.target.clone(), dist: e.dist * 0.95, polar: 0.001, azim: 0 }, 800);
  });

  // ---------------------------------------------------------------- Clique, toque e mouse
  let baixo = null;
  canvas.addEventListener('pointerdown', (e) => { baixo = { x: e.clientX, y: e.clientY, t: performance.now(), b: e.button }; });
  canvas.addEventListener('pointerup', (e) => {
    if (!baixo) return;
    const moveu = Math.hypot(e.clientX - baixo.x, e.clientY - baixo.y) > 6;
    const botao = baixo.b; baixo = null;
    if (moveu || botao !== 0) return;
    const r = canvas.getBoundingClientRect();
    const q = chaoSobTela(e.clientX - r.left, e.clientY - r.top);
    const l = q ? cena.loteEm(q.x, q.z) : null;
    if (l) ponte.selecionarLote(l.id, { centralizar: true, zoom: false });
    else ponte.limpar();
  });
  canvas.addEventListener('dblclick', (e) => {
    const r = canvas.getBoundingClientRect();
    const q = chaoSobTela(e.clientX - r.left, e.clientY - r.top);
    if (!q) return;
    const est = estadoAtual();
    vista.mexeu = true;
    voar({ alvo: new THREE.Vector3(q.x, 0, q.z), dist: Math.max(controls.minDistance, est.dist / 2.2), polar: est.polar, azim: est.azim }, 600);
  });
  if (!MOVEL) {
    let pend = null, agendado = false;
    canvas.addEventListener('pointermove', (e) => {
      if (e.buttons) return;
      pend = e;
      if (agendado) return;
      agendado = true;
      requestAnimationFrame(() => {
        agendado = false;
        const ev = pend; pend = null;
        if (!ev) return;
        const r = canvas.getBoundingClientRect();
        const q = chaoSobTela(ev.clientX - r.left, ev.clientY - r.top);
        const l = q ? cena.loteEm(q.x, q.z) : null;
        if (l !== hover) { pintarHover(hover, false); hover = l; pintarHover(hover, true); canvas.style.cursor = l ? 'pointer' : ''; pedir(); }
      });
    });
    canvas.addEventListener('pointerleave', () => { if (hover) { pintarHover(hover, false); hover = null; canvas.style.cursor = ''; pedir(); } });
  }

  // ---------------------------------------------------------------- Motor (API usada pelo app.js)
  const motor = {
    destacar(lote) {
      selecionado = lote ? { id: String(lote.id), c: lote.centro || lote.c } : null;
      medidas = lote ? calcularMedidas(lote) : [];
      if (selecionado) cena.mostrarDestaque(selecionado.id); else cena.esconderDestaque();
      pedir();
    },
    focarLote(lote, { zoom = true } = {}) {
      const c = lote.centro || lote.c;
      const atual = estadoAtual();
      vista.mexeu = true;
      focarEm(c, { dist: zoom ? Math.min(atual.dist, MOVEL ? 330 : 280) : atual.dist, polar: zoom ? Math.min(atual.polar, 0.82) : atual.polar });
    },
    focarPonto(p) {
      if (!p || !Array.isArray(p.c)) return;
      vista.mexeu = true;
      const perto = p.lazer || p.tipo === 'lazer' ? (MOVEL ? 380 : 330) : p.tipo === 'reserva' ? 1500 : (MOVEL ? 300 : 260);
      focarEm(p.c, { dist: Math.min(estadoAtual().dist, perto), polar: Math.min(estadoAtual().polar, 0.9) });
    },
    verTudo: (animar) => { vista.mexeu = false; verTudo(animar); },
    zoom(f) {
      const e = estadoAtual(); vista.mexeu = true;
      voar({ alvo: controls.target.clone(), dist: THREE.MathUtils.clamp(e.dist / f, controls.minDistance, controls.maxDistance), polar: e.polar, azim: e.azim }, 380);
    },
    filtrar(sim) { soDisponiveis = !!sim; repintarTodos(); if (hover) pintarHover(hover, true); pedir(); },
    projetar(c) {
      const s = tela(new THREE.Vector3(c[0], 8, c[1]));
      return s ? { x: s.x, y: s.y, visivel: true } : { x: -9999, y: -9999, visivel: false };
    },
    desenhar: pedir,
  };

  // Primeiro quadro, depois assume o lugar do mapa 2D
  redimensionar();
  verTudo(false);
  quadroAnim(performance.now());
  console.info(`[mapa 3D] ${cena.lotes.length} lotes · ${cena.arvoresQtd} árvores · ${renderer.info.render.calls} chamadas · ${renderer.info.render.triangles.toLocaleString('pt-BR')} triângulos`);
  ponte.registrar(motor);
  window.__mapa3d = { renderer, scene, camera, controls, cena, motor, voar, estadoAtual, enquadrar, desenhar }; // inspeção pelo console
}

iniciar().catch((e) => { console.error(e); falhar(e); });
