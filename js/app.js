/* =====================================================================
   Mapa do Haras Rio São José — app.js
   JavaScript puro, sem dependências. Responsabilidades:
     1. Carregar data/lotes.json (estados de carregamento e erro)
     2. Desenhar o mapa em SVG (áreas, glebas, vias, lotes, rótulos)
     3. Pan e zoom (mouse, roda, toque, pinça, botões) num único <g> raiz
     4. Seleção de lote → painel lateral / bottom sheet + destaque + ?lote=
     5. Busca por número, filtro "Só disponíveis", legenda, rodapé
     6. WhatsApp, Compartilhar (Web Share API com fallback de copiar)
   Convenções: coordenadas do JSON em metros, y para baixo (igual ao SVG).
   ===================================================================== */
(() => {
  'use strict';

  // ---------------------------------------------------------------- Constantes
  const DATA_URL = 'data/lotes.json';
  const SVG_NS = 'http://www.w3.org/2000/svg';

  const STATUS = { disponivel: 'Disponível', vendido: 'Vendido', reservado: 'Reservado' };
  const STATUS_VALIDOS = new Set(Object.keys(STATUS));

  const ROTULO_MIN_PX = 9;      // rótulo do lote só aparece quando tiver pelo menos 9 px
  const ROTULO_FONTE_M = 8;     // tamanho base do rótulo do lote, em metros (unidade do mundo)
  const GLEBA_FONTE_PX = 16;    // rótulo da gleba tem tamanho fixo em pixels (independe do zoom)
  const ZOOM_MAX = 20;          // pixels por metro
  const ZOOM_MIN_FATOR = 0.6;   // zoom mínimo relativo ao "Ver tudo"
  const LOTE_ALVO_PX = 180;     // ao focar um lote, ele ocupa ~180 px
  const CLIQUE_TOLERANCIA = 6;  // px de movimento até virar arrasto
  const ANIM_MS = 380;

  const DESKTOP = window.matchMedia('(min-width: 900px)');
  const MENOS_MOVIMENTO = window.matchMedia('(prefers-reduced-motion: reduce)');

  // ---------------------------------------------------------------- Elementos
  const $ = (sel) => document.querySelector(sel);
  const el = {
    topo: $('#topo'), mapa: $('#mapa'), svg: $('#svg'), mundo: $('#mundo'),
    gAreas: $('#g-areas'), gGlebas: $('#g-glebas'), gVias: $('#g-vias'), gLotes: $('#g-lotes'),
    gDestaque: $('#g-destaque'), halo: $('#halo'), contorno: $('#contorno'),
    gRotulos: $('#g-rotulos'), gRotulosAreas: $('#g-rotulos-areas'), gRotulosGlebas: $('#g-rotulos-glebas'),
    zoomMais: $('#zoom-mais'), zoomMenos: $('#zoom-menos'), verTudo: $('#ver-tudo'),
    busca: $('#busca'), buscaInput: $('#busca-input'),
    soDisponiveis: $('#so-disponiveis'),
    nDisponivel: $('#n-disponivel'), nVendido: $('#n-vendido'), nReservado: $('#n-reservado'),
    toast: $('#toast'),
    painel: $('#painel'), painelAlca: $('#painel-alca'), painelFechar: $('#painel-fechar'), painelTitulo: $('#painel-titulo'),
    pLote: $('#p-lote'), pGleba: $('#p-gleba'), pStatus: $('#p-status'), pArea: $('#p-area'),
    pFrente: $('#p-frente'), pFundo: $('#p-fundo'), pEsq: $('#p-esq'), pDir: $('#p-dir'),
    pValor: $('#p-valor'), pValorNum: $('#p-valor-num'), pWhats: $('#p-whats'), pShare: $('#p-share'),
    estado: $('#estado'), estadoTitulo: $('#estado-titulo'), estadoTexto: $('#estado-texto'), estadoTentar: $('#estado-tentar'),
    rAtualizado: $('#r-atualizado'), rFonte: $('#r-fonte'),
    videoQuadro: $('#video-quadro'), video: $('#video-drone'),
  };

  // ---------------------------------------------------------------- Estado
  const state = {
    data: null,
    bbox: [0, 0, 1, 1],
    lotes: new Map(),        // id → { ...lote, el, centro, bbox }
    porNumero: new Map(),    // Number(id) → lote (para buscar "12", "012", "lote 12")
    contagem: { disponivel: 0, vendido: 0, reservado: 0 },
    selecionado: null,
    rotulosVisiveis: true,
    glebaLarguraSoma: 0, glebaQtd: 0, glebasVisiveis: true,
  };

  // Vista atual: tela = mundo * k + (tx, ty)
  const vista = { k: 1, tx: 0, ty: 0, kAjuste: 1, mexeu: false };

  // ---------------------------------------------------------------- Formatação (pt-BR)
  const fmtNum = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const fmtArea = (v) => Number.isFinite(v) ? `${fmtNum.format(v)} m²` : '—';
  const fmtMetro = (v) => Number.isFinite(v) ? `${fmtNum.format(v)} m` : '—';
  function fmtData(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    const data = d.toLocaleDateString('pt-BR');
    const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    return `${data} às ${hora}`;
  }

  // ---------------------------------------------------------------- Geometria
  const pontos = (poly) => poly.map((p) => `${p[0]},${p[1]}`).join(' ');

  function centroide(poly) {
    let a = 0, cx = 0, cy = 0;
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i];
      const [x2, y2] = poly[(i + 1) % poly.length];
      const cr = x1 * y2 - x2 * y1;
      a += cr; cx += (x1 + x2) * cr; cy += (y1 + y2) * cr;
    }
    a *= 0.5;
    if (Math.abs(a) < 1e-9) { // polígono degenerado: média simples
      const n = poly.length || 1;
      return [poly.reduce((s, p) => s + p[0], 0) / n, poly.reduce((s, p) => s + p[1], 0) / n];
    }
    return [cx / (6 * a), cy / (6 * a)];
  }

  function bboxDe(poly) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of poly) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
    return [x0, y0, x1, y1];
  }

  function criar(nome, attrs) {
    const e = document.createElementNS(SVG_NS, nome);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  const limitar = (v, a, b) => Math.min(b, Math.max(a, v));
  const limitarK = (k) => limitar(k, vista.kAjuste * ZOOM_MIN_FATOR, ZOOM_MAX);

  // ---------------------------------------------------------------- Toast
  let toastTimer = 0;
  function toast(msg, erro = false) {
    el.toast.textContent = msg;
    el.toast.classList.toggle('toast--erro', erro);
    el.toast.classList.add('is-visivel');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('is-visivel'), erro ? 4200 : 2800);
  }

  // ---------------------------------------------------------------- Estado de carregamento / erro
  function mostrarEstado(tipo, detalhe) {
    if (!tipo) { el.estado.hidden = true; return; }
    el.estado.hidden = false;
    const erro = tipo === 'erro';
    el.estado.classList.toggle('estado--erro', erro);
    el.estadoTitulo.textContent = erro ? 'Não foi possível carregar o mapa' : 'Carregando o mapa…';
    el.estadoTexto.textContent = erro
      ? `Verifique a conexão e tente novamente. ${detalhe ? `(${detalhe})` : ''}`.trim()
      : 'Preparando as unidades e glebas.';
    el.estadoTentar.hidden = !erro;
  }

  // ---------------------------------------------------------------- Construção do mapa
  function limpar(g) { while (g.firstChild) g.removeChild(g.firstChild); }

  function validar(data) {
    if (!data || typeof data !== 'object') throw new Error('JSON inválido');
    if (!Array.isArray(data.lotes)) throw new Error('campo "lotes" ausente');
    data.meta = data.meta || {};
    data.glebas = Array.isArray(data.glebas) ? data.glebas : [];
    data.vias = Array.isArray(data.vias) ? data.vias : [];
    data.areas = Array.isArray(data.areas) ? data.areas : [];
  }

  function construirMapa(data) {
    [el.gAreas, el.gGlebas, el.gVias, el.gLotes, el.gRotulos, el.gRotulosAreas, el.gRotulosGlebas].forEach(limpar);
    state.lotes.clear(); state.porNumero.clear();
    state.contagem = { disponivel: 0, vendido: 0, reservado: 0 };

    const NSS = 'non-scaling-stroke';

    // Áreas (reserva, área comum, lazer…): hachura leve + nome
    for (const a of data.areas) {
      if (!Array.isArray(a.poly) || a.poly.length < 3) continue;
      const tipo = String(a.tipo || 'area_comum').replace(/[^a-z_]/gi, '');
      el.gAreas.appendChild(criar('polygon', { class: `area area--${tipo}`, points: pontos(a.poly), 'vector-effect': NSS }));
      if (a.nome) {
        const c = centroide(a.poly);
        const t = criar('text', { class: 'rotulo-area', x: c[0], y: c[1] });
        t.textContent = a.nome;
        el.gRotulosAreas.appendChild(t);
      }
    }

    // Glebas: contorno fino + rótulo sempre visível
    for (const g of data.glebas) {
      if (!Array.isArray(g.poly) || g.poly.length < 3) continue;
      el.gGlebas.appendChild(criar('polygon', { class: 'gleba', points: pontos(g.poly), 'vector-effect': NSS }));
      const c = Array.isArray(g.label) ? g.label : centroide(g.poly);
      const t = criar('text', { class: 'rotulo-gleba', x: c[0], y: c[1] });
      t.textContent = String(g.id);            // só o número, como na planta
      el.gRotulosGlebas.appendChild(t);
      const bb = bboxDe(g.poly);
      state.glebaLarguraSoma += (bb[2] - bb[0]); state.glebaQtd++;
    }

    // Vias: polilinhas em traço neutro
    for (const v of data.vias) {
      if (!Array.isArray(v) || v.length < 2) continue;
      el.gVias.appendChild(criar('polyline', { class: 'via', points: pontos(v), 'vector-effect': NSS }));
    }

    // Lotes: polígono preenchido por status + rótulo com o número
    const fragLotes = document.createDocumentFragment();
    const fragRotulos = document.createDocumentFragment();
    for (const l of data.lotes) {
      if (!l || !Array.isArray(l.poly) || l.poly.length < 3 || l.id == null) continue;
      const id = String(l.id);
      // Status desconhecido NUNCA vira "disponível": cai em reservado, por segurança comercial.
      const status = STATUS_VALIDOS.has(l.status) ? l.status : 'reservado';
      const centro = Array.isArray(l.c) ? l.c : centroide(l.poly);

      const p = criar('polygon', { class: `lote lote--${status}`, points: pontos(l.poly), 'vector-effect': NSS, 'data-id': id });
      fragLotes.appendChild(p);

      // Tamanho do rótulo proporcional ao lote (em metros), limitado ao tamanho base
      const fonte = limitar(Math.sqrt(Math.max(l.area || 0, 1)) / 6, 3.5, ROTULO_FONTE_M);
      const t = criar('text', { class: `rotulo rotulo--${status}`, x: centro[0], y: centro[1], 'font-size': fonte });
      t.textContent = id;
      fragRotulos.appendChild(t);

      const lote = { ...l, id, status, el: p, centro, bbox: bboxDe(l.poly) };
      state.lotes.set(id, lote);
      const n = parseInt(id, 10);
      if (!Number.isNaN(n) && !state.porNumero.has(n)) state.porNumero.set(n, lote);
      state.contagem[status]++;
    }
    el.gLotes.appendChild(fragLotes);
    el.gRotulos.appendChild(fragRotulos);

    // Caixa do mundo: meta.bbox ou calculada a partir de tudo que foi desenhado
    state.bbox = bboxValido(data.meta.bbox) ? data.meta.bbox : calcularBbox(data);
  }

  const bboxValido = (b) => Array.isArray(b) && b.length === 4 && b.every(Number.isFinite) && b[2] > b[0] && b[3] > b[1];

  function calcularBbox(data) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const acum = (poly) => { const b = bboxDe(poly); x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3]); };
    data.lotes.forEach((l) => Array.isArray(l.poly) && acum(l.poly));
    data.glebas.forEach((g) => Array.isArray(g.poly) && acum(g.poly));
    data.areas.forEach((a) => Array.isArray(a.poly) && acum(a.poly));
    data.vias.forEach((v) => Array.isArray(v) && acum(v));
    return Number.isFinite(x0) ? [x0, y0, x1, y1] : [0, 0, 100, 100];
  }

  // Legenda: mostra a contagem real do array e avisa no console se o meta divergir
  function preencherLegenda() {
    const m = state.data.meta;
    const doMeta = { disponivel: m.disponiveis, vendido: m.vendidos, reservado: m.reservados };
    for (const s of Object.keys(STATUS)) {
      const real = state.contagem[s];
      if (Number.isFinite(doMeta[s]) && doMeta[s] !== real) {
        console.warn(`[lotes.json] meta informa ${doMeta[s]} ${s}, mas o array tem ${real}. Exibindo a contagem real.`);
      }
    }
    if (Number.isFinite(m.total) && m.total !== state.lotes.size) {
      console.warn(`[lotes.json] meta.total=${m.total}, mas o array tem ${state.lotes.size} lotes.`);
    }
    el.nDisponivel.textContent = state.contagem.disponivel;
    el.nReservado.textContent = state.contagem.reservado;
    el.nVendido.textContent = state.contagem.vendido;
  }

  function preencherRodape() {
    const m = state.data.meta;
    el.rAtualizado.textContent = fmtData(m.gerado_em);
    el.rFonte.textContent = m.fonte || '—';
  }

  // ---------------------------------------------------------------- Transformação (pan/zoom)
  let rafPendente = false;
  function agendar() {
    if (rafPendente) return;
    rafPendente = true;
    requestAnimationFrame(() => { rafPendente = false; aplicarTransform(); });
  }

  function aplicarTransform() {
    el.mundo.setAttribute('transform', `translate(${vista.tx} ${vista.ty}) scale(${vista.k})`);
    // Rótulos de gleba/área mantêm tamanho constante em px
    el.svg.style.setProperty('--gleba-fs', `${GLEBA_FONTE_PX / vista.k}px`);
    // Rótulos de gleba e de área só aparecem quando a gleba média tem largura legível na tela
    const largMedia = state.glebaQtd ? state.glebaLarguraSoma / state.glebaQtd : 120;
    const mostrarGlebas = largMedia * vista.k >= 44;
    if (mostrarGlebas !== state.glebasVisiveis) {
      state.glebasVisiveis = mostrarGlebas;
      el.gRotulosGlebas.style.display = mostrarGlebas ? '' : 'none';
      el.gRotulosAreas.style.display = mostrarGlebas ? '' : 'none';
    }
    // Rótulos dos lotes só aparecem quando legíveis
    const mostrar = ROTULO_FONTE_M * vista.k >= ROTULO_MIN_PX;
    if (mostrar !== state.rotulosVisiveis) {
      state.rotulosVisiveis = mostrar;
      el.gRotulos.style.display = mostrar ? '' : 'none';
    }
  }

  function tamanhoSvg() {
    const r = el.svg.getBoundingClientRect();
    return { w: Math.max(r.width, 1), h: Math.max(r.height, 1), left: r.left, top: r.top };
  }

  // Enquadra o bbox inteiro na tela
  function verTudo(animar = true) {
    const { w, h } = tamanhoSvg();
    const [x0, y0, x1, y1] = state.bbox;
    const pad = 28;
    const k = Math.min((w - 2 * pad) / (x1 - x0), (h - 2 * pad) / (y1 - y0));
    vista.kAjuste = k;
    irPara(k, (w - (x1 - x0) * k) / 2 - x0 * k, (h - (y1 - y0) * k) / 2 - y0 * k, animar);
  }

  // Zoom mantendo o ponto (px, py) da tela parado
  function zoomEm(px, py, fator) {
    const nk = limitarK(vista.k * fator);
    const f = nk / vista.k;
    if (f === 1) return;
    vista.tx = px - (px - vista.tx) * f;
    vista.ty = py - (py - vista.ty) * f;
    vista.k = nk;
    vista.mexeu = true;
    agendar();
  }

  // Animação suave: interpola o centro do mundo e o log do zoom
  let anim = 0;
  function irPara(k, tx, ty, animar = true) {
    if (anim) { cancelAnimationFrame(anim); anim = 0; }
    k = limitarK(k);
    if (!animar || MENOS_MOVIMENTO.matches) {
      vista.k = k; vista.tx = tx; vista.ty = ty; aplicarTransform(); return;
    }
    const { w, h } = tamanhoSvg();
    const de = { k: vista.k, cx: (w / 2 - vista.tx) / vista.k, cy: (h / 2 - vista.ty) / vista.k };
    const para = { k, cx: (w / 2 - tx) / k, cy: (h / 2 - ty) / k };
    const t0 = performance.now();
    const passo = (t) => {
      const p = Math.min(1, (t - t0) / ANIM_MS);
      const e = 1 - Math.pow(1 - p, 3); // ease-out cúbico
      const kk = de.k * Math.pow(para.k / de.k, e);
      const cx = de.cx + (para.cx - de.cx) * e;
      const cy = de.cy + (para.cy - de.cy) * e;
      vista.k = kk; vista.tx = w / 2 - cx * kk; vista.ty = h / 2 - cy * kk;
      aplicarTransform();
      anim = p < 1 ? requestAnimationFrame(passo) : 0;
    };
    anim = requestAnimationFrame(passo);
  }

  // Ponto da tela onde um lote focado deve ficar (fora da área coberta pelo painel)
  function pontoVisivel() {
    const { w, h } = tamanhoSvg();
    if (DESKTOP.matches) {
      const pw = el.painel.classList.contains('is-aberto') ? el.painel.offsetWidth + 32 : 0;
      return { x: Math.max(w * 0.25, (w - pw) / 2), y: h / 2 };
    }
    const ph = el.painel.classList.contains('is-aberto') ? el.painel.offsetHeight : 0;
    return { x: w / 2, y: Math.max(h * 0.2, (h - ph) / 2) };
  }

  function centralizarLote(lote, comZoom) {
    const [bx0, by0, bx1, by1] = lote.bbox;
    const maior = Math.max(bx1 - bx0, by1 - by0, 1);
    let k = vista.k;
    if (comZoom) k = limitarK(Math.max(vista.k, LOTE_ALVO_PX / maior));
    const alvo = pontoVisivel();
    vista.mexeu = true;
    irPara(k, alvo.x - lote.centro[0] * k, alvo.y - lote.centro[1] * k, true);
  }

  // ---------------------------------------------------------------- Gestos (pointer events, delegação no <svg>)
  const ponteiros = new Map(); // pointerId → {x, y}
  let gesto = null;            // {tipo:'pan'|'pinca', ...}
  let origem = { left: 0, top: 0 };

  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const meio = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

  function iniciarPan(p, alvo) {
    gesto = { tipo: 'pan', x0: p.x, y0: p.y, tx0: vista.tx, ty0: vista.ty, moveu: false, alvo };
  }
  function iniciarPinca() {
    const [a, b] = [...ponteiros.values()];
    gesto = { tipo: 'pinca', d0: Math.max(dist(a, b), 1), k0: vista.k, m0: meio(a, b), tx0: vista.tx, ty0: vista.ty, moveu: true };
  }

  function onPointerDown(e) {
    if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;
    if (anim) { cancelAnimationFrame(anim); anim = 0; }
    origem = tamanhoSvg();
    el.svg.setPointerCapture(e.pointerId);
    ponteiros.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ponteiros.size === 1) iniciarPan({ x: e.clientX, y: e.clientY }, e.target);
    else if (ponteiros.size === 2) iniciarPinca();
    el.svg.classList.add('is-arrastando');
  }

  function onPointerMove(e) {
    if (!ponteiros.has(e.pointerId) || !gesto) return;
    ponteiros.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (gesto.tipo === 'pan') {
      const dx = e.clientX - gesto.x0, dy = e.clientY - gesto.y0;
      if (!gesto.moveu && Math.hypot(dx, dy) > CLIQUE_TOLERANCIA) gesto.moveu = true;
      if (!gesto.moveu) return;
      vista.tx = gesto.tx0 + dx; vista.ty = gesto.ty0 + dy; vista.mexeu = true;
      agendar();
    } else if (gesto.tipo === 'pinca' && ponteiros.size >= 2) {
      const [a, b] = [...ponteiros.values()];
      const nk = limitarK(gesto.k0 * (dist(a, b) / gesto.d0));
      const f = nk / gesto.k0;
      const m = meio(a, b);
      // O ponto do mundo que estava sob o centro inicial da pinça segue o centro atual
      const s0x = gesto.m0.x - origem.left, s0y = gesto.m0.y - origem.top;
      const sx = m.x - origem.left, sy = m.y - origem.top;
      vista.tx = sx - (s0x - gesto.tx0) * f;
      vista.ty = sy - (s0y - gesto.ty0) * f;
      vista.k = nk; vista.mexeu = true;
      agendar();
    }
  }

  function onPointerUp(e) {
    if (!ponteiros.has(e.pointerId)) return;
    ponteiros.delete(e.pointerId);
    try { el.svg.releasePointerCapture(e.pointerId); } catch (_) { /* já liberado */ }

    if (gesto && gesto.tipo === 'pan' && !gesto.moveu && e.type === 'pointerup') {
      // Toque/clique simples: seleciona o lote ou fecha o painel se clicou no vazio.
      // Usa o alvo guardado no pointerdown: com pointer capture, o e.target do
      // pointerup é sempre o <svg>, não o polígono.
      const alvo = gesto.alvo && gesto.alvo.closest ? gesto.alvo.closest('.lote') : null;
      if (alvo) selecionarLote(alvo.getAttribute('data-id'), { centralizar: true, zoom: false });
      else if (state.selecionado) fecharPainel();
    }

    if (ponteiros.size === 1) {
      const [p] = [...ponteiros.values()];
      iniciarPan(p, null); gesto.moveu = true; // continua o pan com o dedo restante
    } else if (ponteiros.size === 0) {
      gesto = null;
      el.svg.classList.remove('is-arrastando');
    }
  }

  function onWheel(e) {
    e.preventDefault();
    const { left, top } = tamanhoSvg();
    const passo = e.deltaMode === 1 ? 0.05 : 0.0016; // linhas vs pixels
    const fator = Math.exp(-e.deltaY * passo);
    zoomEm(e.clientX - left, e.clientY - top, fator);
  }

  function onDblClick(e) {
    const { left, top } = tamanhoSvg();
    const px = e.clientX - left, py = e.clientY - top;
    const nk = limitarK(vista.k * 2);
    const f = nk / vista.k;
    irPara(nk, px - (px - vista.tx) * f, py - (py - vista.ty) * f, true);
    vista.mexeu = true;
  }

  // ---------------------------------------------------------------- Seleção e painel
  function selecionarLote(id, { centralizar = true, zoom = true, url = true } = {}) {
    const lote = state.lotes.get(String(id));
    if (!lote) return false;

    if (state.selecionado && state.selecionado !== lote) state.selecionado.el.classList.remove('is-selecionado');
    state.selecionado = lote;
    lote.el.classList.add('is-selecionado');

    const pts = lote.el.getAttribute('points');
    el.halo.setAttribute('points', pts);
    el.contorno.setAttribute('points', pts);
    el.gDestaque.style.display = '';

    preencherPainel(lote);
    abrirPainel();
    if (centralizar) centralizarLote(lote, zoom);
    if (url) atualizarUrl(lote.id);
    return true;
  }

  function preencherPainel(lote) {
    const m = state.data.meta;
    el.pLote.textContent = lote.id;
    el.pGleba.textContent = lote.gleba != null ? String(lote.gleba) : '—';
    el.pStatus.textContent = STATUS[lote.status];
    el.pStatus.className = `status status--${lote.status}`;
    el.pArea.textContent = fmtArea(lote.area);
    el.pFrente.textContent = fmtMetro(lote.frente);
    el.pFundo.textContent = fmtMetro(lote.fundo);
    el.pEsq.textContent = fmtMetro(lote.esq);
    el.pDir.textContent = fmtMetro(lote.dir);

    // Valor de referência: só quando preco_m2 é número e há área
    const preco = typeof m.preco_m2 === 'number' && Number.isFinite(m.preco_m2) ? m.preco_m2 : null;
    if (preco !== null && Number.isFinite(lote.area) && lote.status === 'disponivel') {
      el.pValorNum.textContent = fmtBRL.format(lote.area * preco);
      el.pValor.hidden = false;
    } else {
      el.pValor.hidden = true;
    }

    // WhatsApp: número E.164 sem "+"; sem número, o botão some
    const numero = m.whatsapp ? String(m.whatsapp).replace(/\D/g, '') : '';
    if (numero) {
      const msg = `Olá! Tenho interesse no lote ${lote.id} (Gleba ${lote.gleba ?? '—'}) do Haras Rio São José.`;
      el.pWhats.href = `https://wa.me/${numero}?text=${encodeURIComponent(msg)}`;
      el.pWhats.hidden = false;
    } else {
      el.pWhats.hidden = true;
    }
  }

  function abrirPainel() {
    const jaAberto = el.painel.classList.contains('is-aberto');
    el.painel.classList.add('is-aberto');
    el.mapa.classList.add('is-painel-aberto');
    el.painel.setAttribute('aria-hidden', 'false');
    el.painel.style.transform = '';
    if (!jaAberto) {
      // Leva o foco ao título sem rolar a página (bom para leitores de tela e para o Esc)
      try { el.painelTitulo.focus({ preventScroll: true }); } catch (_) { /* navegadores antigos */ }
    }
  }

  function fecharPainel() {
    el.painel.classList.remove('is-aberto');
    el.mapa.classList.remove('is-painel-aberto');
    el.painel.setAttribute('aria-hidden', 'true');
    el.painel.style.transform = '';
    if (state.selecionado) {
      state.selecionado.el.classList.remove('is-selecionado');
      state.selecionado = null;
    }
    el.gDestaque.style.display = 'none';
    atualizarUrl(null);
  }

  // Bottom sheet arrastável (mobile): puxar para baixo fecha
  function ligarArrasteDoPainel() {
    let y0 = 0, dy = 0, ativo = false;
    el.painelAlca.addEventListener('pointerdown', (e) => {
      ativo = true; y0 = e.clientY; dy = 0;
      el.painelAlca.setPointerCapture(e.pointerId);
      el.painel.classList.add('is-arrastando');
    });
    el.painelAlca.addEventListener('pointermove', (e) => {
      if (!ativo) return;
      dy = Math.max(0, e.clientY - y0);
      el.painel.style.transform = `translateY(${dy}px)`;
    });
    const soltar = () => {
      if (!ativo) return;
      ativo = false;
      el.painel.classList.remove('is-arrastando');
      if (dy > 110) fecharPainel();
      else el.painel.style.transform = '';
    };
    el.painelAlca.addEventListener('pointerup', soltar);
    el.painelAlca.addEventListener('pointercancel', soltar);
  }

  // ---------------------------------------------------------------- URL (deep link ?lote=123)
  function atualizarUrl(id) {
    try {
      const u = new URL(location.href);
      if (id) u.searchParams.set('lote', id); else u.searchParams.delete('lote');
      history.replaceState(null, '', u);
    } catch (_) { /* file:// ou ambiente sem history */ }
  }

  function urlDoLote(id) {
    const u = new URL(location.href);
    u.searchParams.set('lote', id);
    u.hash = '';
    return u.toString();
  }

  function abrirDeepLink() {
    const param = new URLSearchParams(location.search).get('lote');
    if (!param) return;
    const lote = localizar(param);
    if (lote) {
      // Espera o layout assentar para medir o painel e centralizar corretamente
      requestAnimationFrame(() => selecionarLote(lote.id, { centralizar: true, zoom: true, url: false }));
    } else {
      toast(`Lote "${param}" não encontrado.`, true);
      atualizarUrl(null);
    }
  }

  // ---------------------------------------------------------------- Busca
  // Aceita "12", "012", "lote 12", "Lote nº 12"; ids não numéricos também funcionam pelo texto exato
  function localizar(texto) {
    const t = String(texto || '').trim();
    if (!t) return null;
    if (state.lotes.has(t)) return state.lotes.get(t);
    const m = t.match(/\d+/);
    if (m) {
      const lote = state.porNumero.get(parseInt(m[0], 10));
      if (lote) return lote;
    }
    const tUpper = t.toUpperCase();
    for (const [id, lote] of state.lotes) if (id.toUpperCase() === tUpper) return lote;
    return null;
  }

  function buscar(texto) {
    const t = String(texto || '').trim();
    if (!t) { toast('Digite o número do lote.', true); return; }
    const lote = localizar(t);
    if (!lote) { toast(`Lote "${t}" não encontrado. Confira o número e tente de novo.`, true); return; }
    el.buscaInput.blur(); // recolhe o teclado no celular
    selecionarLote(lote.id, { centralizar: true, zoom: true });
  }

  // ---------------------------------------------------------------- Compartilhar
  async function compartilhar() {
    const lote = state.selecionado;
    if (!lote) return;
    const url = urlDoLote(lote.id);
    const dados = {
      title: `Lote ${lote.id} — Haras Rio São José`,
      text: `Lote ${lote.id} (Gleba ${lote.gleba ?? '—'}) · ${fmtArea(lote.area)} · ${STATUS[lote.status]}`,
      url,
    };
    if (navigator.share) {
      try { await navigator.share(dados); return; }
      catch (e) { if (e && e.name === 'AbortError') return; /* senão, cai no fallback */ }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast('Link do lote copiado.');
    } catch (_) {
      // Último recurso: seleciona o texto em um campo temporário
      const ta = document.createElement('textarea');
      ta.value = url; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (__) { ok = false; }
      document.body.removeChild(ta);
      toast(ok ? 'Link do lote copiado.' : 'Não foi possível copiar. Use o endereço da barra do navegador.', !ok);
    }
  }

  // ---------------------------------------------------------------- Cabeçalho / layout
  function medirTopo() {
    document.documentElement.style.setProperty('--header-h', `${el.topo.offsetHeight}px`);
  }

  // ---------------------------------------------------------------- Eventos
  function ligarEventos() {
    // Mapa
    el.svg.addEventListener('pointerdown', onPointerDown);
    el.svg.addEventListener('pointermove', onPointerMove);
    el.svg.addEventListener('pointerup', onPointerUp);
    el.svg.addEventListener('pointercancel', onPointerUp);
    el.svg.addEventListener('wheel', onWheel, { passive: false });
    el.svg.addEventListener('dblclick', onDblClick);
    el.svg.addEventListener('contextmenu', (e) => e.preventDefault());

    // Controles
    const zoomCentro = (fator) => { const p = pontoVisivel(); zoomEm(p.x, p.y, fator); };
    el.zoomMais.addEventListener('click', () => zoomCentro(1.6));
    el.zoomMenos.addEventListener('click', () => zoomCentro(1 / 1.6));
    el.verTudo.addEventListener('click', () => verTudo(true));

    // Busca
    el.busca.addEventListener('submit', (e) => { e.preventDefault(); buscar(el.buscaInput.value); });

    // Filtro
    el.soDisponiveis.addEventListener('change', () => {
      el.svg.classList.toggle('so-disponiveis', el.soDisponiveis.checked);
      el.soDisponiveis.setAttribute('aria-checked', String(el.soDisponiveis.checked));
    });

    // Painel
    el.painelFechar.addEventListener('click', fecharPainel);
    el.pShare.addEventListener('click', compartilhar);
    ligarArrasteDoPainel();

    // Teclado: Esc fecha o painel
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && state.selecionado) { fecharPainel(); el.buscaInput.blur(); }
    });

    // Erro
    el.estadoTentar.addEventListener('click', carregar);

    // Layout: altura do cabeçalho e redimensionamento do mapa
    if ('ResizeObserver' in window) {
      new ResizeObserver(medirTopo).observe(el.topo);
      new ResizeObserver(() => { if (!vista.mexeu && state.data) verTudo(false); }).observe(el.mapa);
    } else {
      window.addEventListener('resize', () => { medirTopo(); if (!vista.mexeu && state.data) verTudo(false); });
    }

    // Vídeo: se assets/drone.mp4 não existir, mostra aviso sem quebrar o layout
    if (el.video) {
      el.video.addEventListener('error', () => el.videoQuadro.classList.add('is-erro'));
      // Se o erro já tiver ocorrido antes do script rodar (script defer), confere o estado
      if (el.video.error) el.videoQuadro.classList.add('is-erro');
    }
  }

  // ---------------------------------------------------------------- Carga
  async function carregar() {
    mostrarEstado('carregando');
    try {
      const resp = await fetch(DATA_URL, { cache: 'no-cache' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      validar(data);
      state.data = data;
      construirMapa(data);
      preencherLegenda();
      preencherRodape();
      mostrarEstado(null);
      vista.mexeu = false;
      verTudo(false);
      abrirDeepLink();
    } catch (e) {
      console.error('[mapa] falha ao carregar', e);
      mostrarEstado('erro', e && e.message ? e.message : '');
    }
  }

  function iniciar() {
    medirTopo();
    ligarEventos();
    carregar();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
