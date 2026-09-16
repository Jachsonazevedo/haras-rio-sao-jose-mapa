/* =====================================================================
   Mapa do Haras Rio São José — app.js
   JavaScript puro, sem dependências. Responsabilidades:
     1. Carregar data/lotes.json (estados de carregamento e erro)
     2. Desenhar o mapa ilustrado em SVG: imóvel (base com sombra), áreas
        (reserva, lago, clube, área comum), vias como faixas com nome ao
        longo do traçado, lotes coloridos por status, glebas, rótulos e
        marcadores numerados das áreas comuns
     3. Pan e zoom (mouse, roda, toque, pinça, botões) num único <g> raiz
     4. Seleção de lote → painel lateral / bottom sheet + destaque + ?lote=
     5. Áreas comuns → legenda numerada + mini-painel (popover) no mapa
     6. Mini-mapa de orientação (gerado de meta.avenidas / meta.ruas)
     7. Busca, filtro "Só disponíveis", legenda, números do hero, rodapé,
        rosa dos ventos e escala em metros
     8. WhatsApp, Compartilhar (Web Share API com fallback de copiar)
   Convenções: coordenadas do JSON em metros, y para baixo (igual ao SVG).
   ===================================================================== */
(() => {
  'use strict';

  // ---------------------------------------------------------------- Constantes
  const DATA_URL = 'data/lotes.json';
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const XLINK_NS = 'http://www.w3.org/1999/xlink';

  const STATUS = { disponivel: 'Disponível', vendido: 'Vendido', reservado: 'Reservado', reserva_tecnica: 'Reserva técnica' };
  const STATUS_VALIDOS = new Set(Object.keys(STATUS));

  const ROTULO_MIN_PX = 9;      // rótulo do lote só aparece quando tiver pelo menos 9 px
  const ROTULO_FONTE_M = 8;     // tamanho base do rótulo do lote, em metros (unidade do mundo)
  const GLEBA_FONTE_PX = 16;    // rótulo da gleba tem tamanho fixo em pixels (independe do zoom)
  const GLEBA_MIN_PX = 36;      // largura média de gleba na tela a partir da qual os números aparecem
  const NOME_VIA_MIN_PX = 8;    // nome de rua só aparece quando a fonte tiver pelo menos 8 px
  const ZOOM_MAX = 20;          // pixels por metro
  const ZOOM_MIN_FATOR = 0.6;   // zoom mínimo relativo ao "Ver tudo"
  const LOTE_ALVO_PX = 180;     // ao focar um lote, ele ocupa ~180 px
  const PONTO_ZOOM_FATOR = 2.6; // ao focar uma área comum a partir da legenda, zoom mínimo = kAjuste × fator
  const CLIQUE_TOLERANCIA = 6;  // px de movimento até virar arrasto
  const ANIM_MS = 380;
  const SH = 0.26, YF = 0.74;   // projeção 2,5D: x' = x + SH·y, y' = YF·y (mesma matriz do <g id="mundo-3d">)
  const proj = (p) => [p[0] + SH * p[1], YF * p[1]];
  const projBbox = (b) => [b[0] + SH * b[1], YF * b[1], b[2] + SH * b[3], YF * b[3]];
  const LAZER_MIN_PX = 200;     // largura da área de lazer na tela a partir da qual os ícones aparecem

  // Largura das vias em METROS (escala com o zoom, como no mundo real)
  const VIA_LARGURA = { avenida: 14, rua: 9, acesso: 10 };
  const VIA_FONTE_M = { avenida: 9.5, rua: 5.5, acesso: 5.5 };
  const VIA_BORDA_M = 1.6;

  const AVENIDAS_PADRAO = ['Avenida Pau Ferro', 'Avenida Umbuzeiro'];
  const SITUACAO = { pronto: 'pronto', em_obra: 'em obra', previsto: 'previsto' };

  const DESKTOP = window.matchMedia('(min-width: 900px)');
  const MENOS_MOVIMENTO = window.matchMedia('(prefers-reduced-motion: reduce)');

  // ---------------------------------------------------------------- Ícones das áreas comuns (SVG inline, 24×24, traço)
  const ICONES = {
    guarita: 'M3 21V10l9-6 9 6v11H3zM9 21v-7h6v7M3 14h18',
    salao: 'M4 21V9l8-5 8 5v12H4zM10 21v-6h4v6M8 12h.01M16 12h.01M12 4v2',
    piscina: 'M3 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0M3 19c2-2 4-2 6 0s4 2 6 0 4-2 6 0M8 14V6a2 2 0 0 1 4 0M14 14V6a2 2 0 0 1 4 0',
    quiosque: 'M3 11a9 9 0 0 1 18 0H3zM12 11v10M8 21h8M12 2v2',
    banheiro: 'M12 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4M8 21v-7a4 4 0 0 1 8 0v7M8 15h8',
    quadra: 'M4 6h16v12H4zM12 6v12M4 12h16M9 12a3 3 0 0 0 6 0 3 3 0 0 0-6 0',
    baias: 'M6 21v-9a6 6 0 0 1 12 0v9M4 21h4M16 21h4M6 15h12',
    fazendinha: 'M3 21V11l9-7 9 7v10H3zM9 21v-7h6v7M9 11h6M3 16h18',
    agua: 'M12 3s-6 6.5-6 11a6 6 0 0 0 12 0c0-4.5-6-11-6-11zM9.5 14a2.5 2.5 0 0 0 2.5 2.5',
    reserva: 'M12 3l6 8h-3l4 6h-5v4h-4v-4H5l4-6H6zM12 21v-4',
    estacionamento: 'M4 4h16v16H4zM9 17V8h4a2.5 2.5 0 0 1 0 5H9',
    padrao: 'M12 22s7-6.6 7-12a7 7 0 0 0-14 0c0 5.4 7 12 7 12zM12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  };

  // ---------------------------------------------------------------- Elementos
  const $ = (sel) => document.querySelector(sel);
  const el = {
    topo: $('#topo'), mapa: $('#mapa-quadro'), svg: $('#svg'), mundo: $('#mundo'),
    gImovel: $('#g-imovel'), gAreas: $('#g-areas'), gVias: $('#g-vias'), gLotes: $('#g-lotes'), gGlebas: $('#g-glebas'),
    gDestaque: $('#g-destaque'), halo: $('#halo'), contorno: $('#contorno'),
    gRotulos: $('#g-rotulos'), gNomesVias: $('#g-nomes-vias'), gRotulosAreas: $('#g-rotulos-areas'), gRotulosGlebas: $('#g-rotulos-glebas'),
    gPontos: $('#g-pontos'), gRelevo: $('#g-relevo'), gEstrada: $('#g-estrada'), gArvores: $('#g-arvores'), gLazer: $('#g-lazer'),
    comunsBarra: $('#comuns-barra'), comunsChips: $('#comuns-chips'),
    rosa: $('#rosa'), escala: $('#escala'), escalaFundo: $('#escala-fundo'), escalaLinha: $('#escala-linha'), escalaTexto: $('#escala-texto'),
    controles: $('.controles'),
    zoomMais: $('#zoom-mais'), zoomMenos: $('#zoom-menos'), verTudo: $('#ver-tudo'),
    busca: $('#busca'), buscaInput: $('#busca-input'),
    soDisponiveis: $('#so-disponiveis'),
    toast: $('#toast'),
    popover: $('#popover'), popFechar: $('#pop-fechar'), popIcone: $('#pop-icone'),
    popNome: $('#pop-nome'), popDesc: $('#pop-desc'),
    painel: $('#painel'), painelAlca: $('#painel-alca'), painelFechar: $('#painel-fechar'), painelTitulo: $('#painel-titulo'),
    pLote: $('#p-lote'), pGleba: $('#p-gleba'), pStatus: $('#p-status'), pArea: $('#p-area'),
    pFrente: $('#p-frente'), pFundo: $('#p-fundo'), pEsq: $('#p-esq'), pDir: $('#p-dir'),
    pValor: $('#p-valor'), pValorNum: $('#p-valor-num'), pWhats: $('#p-whats'), pShare: $('#p-share'),
    estado: $('#estado'), estadoTitulo: $('#estado-titulo'), estadoTexto: $('#estado-texto'), estadoTentar: $('#estado-tentar'),
    hGlebas: $('#h-glebas'), hArea: $('#h-area'),
    chegarWhats: $('#chegar-whats'),
    rAtualizado: $('#r-atualizado'), rFonte: $('#r-fonte'),
  };

  // ---------------------------------------------------------------- Estado
  const state = {
    data: null,
    bbox: [0, 0, 1, 1],
    lotes: new Map(),        // id → { ...lote, el, centro, bbox }
    porNumero: new Map(),    // Number(id) → lote (para buscar "12", "012", "lote 12")
    contagem: { disponivel: 0, vendido: 0, reservado: 0, reserva_tecnica: 0 },
    selecionado: null,
    rotulosVisiveis: true,
    glebaLarguraSoma: 0, glebaQtd: 0, glebasVisiveis: true,
    placas: [],              // { el, c, tipo, principal } — placas das vias (tamanho fixo em px)
    espRuaM: 160, avLenM: 1900,
    pontos: [],              // { ...ponto, pc (projetado), el, item }
    lazerVisivel: null, clubeLargM: 100,
    pontoAtivo: null,
    faixaStroke: '',         // último ajuste de espessura (evita reescrever a cada frame)
  };

  // Vista atual: tela = mundo * k + (tx, ty)
  const vista = { k: 1, tx: 0, ty: 0, kAjuste: 1, mexeu: false };

  // ---------------------------------------------------------------- Formatação (pt-BR)
  const fmtNum = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtInt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
  const fmtHa = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
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
  const pontoValido = (p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);
  const polyValido = (poly, min = 3) => Array.isArray(poly) && poly.length >= min && poly.every(pontoValido);
  const pontos = (poly) => poly.map((p) => `${p[0]},${p[1]}`).join(' ');
  const caminho = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join(' ');

  function areaPoly(poly) {
    let a = 0;
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i];
      const [x2, y2] = poly[(i + 1) % poly.length];
      a += x1 * y2 - x2 * y1;
    }
    return Math.abs(a) / 2;
  }

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

  function comprimento(pts) {
    let s = 0;
    for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    return s;
  }

  function criar(nome, attrs, texto) {
    const e = document.createElementNS(SVG_NS, nome);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (texto != null) e.textContent = texto;
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

  // ---------------------------------------------------------------- Validação / normalização do JSON
  function limpar(g) { while (g.firstChild) g.removeChild(g.firstChild); }

  // Vias: aceita o formato novo ({nome, tipo, pts}) e o antigo (array de pontos puro)
  function normalizarVia(v) {
    if (Array.isArray(v)) return polyValido(v, 2) ? { nome: '', tipo: 'rua', pts: v } : null;
    if (!v || typeof v !== 'object' || !polyValido(v.pts, 2)) return null;
    const tipo = VIA_LARGURA[v.tipo] ? v.tipo : 'rua';
    return { nome: v.nome ? String(v.nome).trim() : '', tipo, pts: v.pts };
  }

  // Ponto sem coordenada (c: null) continua na legenda, só não ganha marcador no mapa
  function normalizarPonto(p, i) {
    if (!p || typeof p !== 'object') return null;
    const n = Number.isFinite(p.n) ? p.n : i + 1;
    const tipo = String(p.tipo || 'padrao').replace(/[^a-z_]/gi, '') || 'padrao';
    const situacao = SITUACAO[p.situacao] ? p.situacao : 'previsto';
    return {
      n, id: String(p.id || `ponto-${n}`), nome: String(p.nome || `Área comum ${n}`), tipo,
      c: pontoValido(p.c) ? p.c : null, situacao, prazo: p.prazo ? String(p.prazo) : null, desc: p.desc ? String(p.desc) : '',
    };
  }

  function validar(data) {
    if (!data || typeof data !== 'object') throw new Error('JSON inválido');
    if (!Array.isArray(data.lotes)) throw new Error('campo "lotes" ausente');
    data.meta = data.meta && typeof data.meta === 'object' ? data.meta : {};
    data.glebas = Array.isArray(data.glebas) ? data.glebas : [];
    data.areas = Array.isArray(data.areas) ? data.areas : [];
    data.vias = (Array.isArray(data.vias) ? data.vias : []).map(normalizarVia).filter(Boolean);
    data.pontos = (Array.isArray(data.pontos) ? data.pontos : []).map(normalizarPonto).filter(Boolean)
      .sort((a, b) => a.n - b.n);
    const m = data.meta;
    m.avenidas = Array.isArray(m.avenidas) && m.avenidas.length >= 2 ? m.avenidas.slice(0, 2).map(String) : AVENIDAS_PADRAO;
    m.ruas = Number.isInteger(m.ruas) && m.ruas > 0 ? m.ruas : 0;
  }

  // ---------------------------------------------------------------- Construção do mapa
  function construirMapa(data) {
    [el.gImovel, el.gAreas, el.gVias, el.gLotes, el.gGlebas, el.gRotulos, el.gNomesVias, el.gRotulosAreas, el.gRotulosGlebas, el.gPontos, el.gRelevo, el.gEstrada, el.gArvores, el.gLazer].forEach(limpar);
    state.lotes.clear(); state.porNumero.clear();
    state.contagem = { disponivel: 0, vendido: 0, reservado: 0, reserva_tecnica: 0 };
    state.glebaLarguraSoma = 0; state.glebaQtd = 0;
    state.placas = []; state.espRuaM = 160; state.avLenM = 1900; state.pontos = []; state.pontoAtivo = null;

    const NSS = 'non-scaling-stroke';

    // 1) Chão em relevo: sombra e lado (extrusão) na camada plana, já projetados; o topo fica na camada 2,5D
    for (const a of data.areas) {
      if (a && a.tipo === 'imovel' && polyValido(a.poly)) {
        const pp = pontos(a.poly.map(proj));
        el.gRelevo.appendChild(criar('polygon', { class: 'relevo-sombra', points: pp, transform: 'translate(16 44)' }));
        el.gRelevo.appendChild(criar('polygon', { class: 'relevo-lado', points: pp, transform: 'translate(0 28)' }));
        el.gImovel.appendChild(criar('polygon', { class: 'imovel', points: pontos(a.poly), 'vector-effect': NSS }));
      }
    }
    // Estrada de Duas Vendas, fora do imóvel: sai da portaria rumo ao norte, onde fica Poções
    if (data.decor && Array.isArray(data.decor.estrada) && data.decor.estrada.length > 1) {
      const pe = pontos(data.decor.estrada.map(proj));
      el.gEstrada.appendChild(criar('polyline', { class: 'estrada estrada--borda', points: pe }));
      el.gEstrada.appendChild(criar('polyline', { class: 'estrada estrada--pista', points: pe }));
      el.gEstrada.appendChild(criar('polyline', { class: 'estrada estrada--eixo', points: pe }));
      const fim = data.decor.estrada[data.decor.estrada.length - 1];
      criarPlaca({ texto: 'POÇÕES \u2191', tipo: 'destino', c: proj(fim), dy: -6, principal: true, sempre: true });
      criarPlaca({ texto: 'ESTRADA DE DUAS VENDAS', tipo: 'rua', c: proj(pontoAoLongo(data.decor.estrada, 0.5)), dy: 0, principal: true, sempre: true });
    }

    // 2) Áreas: reserva (mata), lago, clube (lazer), área comum + nome
    for (const a of data.areas) {
      if (!a || a.tipo === 'imovel' || !polyValido(a.poly)) continue;
      const tipo = String(a.tipo || 'area_comum').replace(/[^a-z_]/gi, '') || 'area_comum';
      el.gAreas.appendChild(criar('polygon', { class: `area area--${tipo}`, points: pontos(a.poly), 'vector-effect': NSS }));
      if (a.nome && tipo !== 'clube' && tipo !== 'area_comum') {
        const c = proj(Array.isArray(a.label) && pontoValido(a.label) ? a.label : centroide(a.poly));
        el.gRotulosAreas.appendChild(criar('text', { class: `rotulo-area rotulo-area--${tipo}`, x: c[0], y: c[1] }, String(a.nome)));
      }
    }

    // 3) Vias: faixas (borda + pista) em metros; avenidas ganham eixo tracejado; nomes ao longo do traçado
    const fragBordas = document.createDocumentFragment();
    const fragPistas = document.createDocumentFragment();
    data.vias.forEach((v, i) => {
      const w = VIA_LARGURA[v.tipo];
      const pts = pontos(v.pts);
      fragBordas.appendChild(criar('polyline', { class: `via via--borda via--${v.tipo}`, points: pts, 'stroke-width': w + 2 * VIA_BORDA_M }));
      fragPistas.appendChild(criar('polyline', { class: `via via--pista via--${v.tipo}`, points: pts, 'stroke-width': w }));
      if (v.tipo === 'avenida') fragPistas.appendChild(criar('polyline', { class: 'via via--eixo', points: pts, 'stroke-width': 0.5 }));

      if (v.nome && v.tipo !== 'acesso') {
        if (v.tipo === 'avenida') {
          const volta = (data.meta.avenidas || AVENIDAS_PADRAO)[1] === v.nome;
          const nome = v.nome.replace(/^Avenida\s+/i, 'Av. ').toUpperCase();
          const texto = volta ? `\u2190 ${nome}` : `${nome} \u2192`;
          for (const fr of [0.18, 0.5, 0.82]) {
            criarPlaca({ texto, tipo: 'avenida', c: proj(pontoAoLongo(v.pts, fr)), dy: volta ? 46 : -46, principal: fr === 0.5 });
          }
        } else {
          const topo = v.pts.reduce((a, b) => (b[1] < a[1] ? b : a));
          const base = v.pts.reduce((a, b) => (b[1] > a[1] ? b : a));
          criarPlaca({ texto: v.nome.toUpperCase(), tipo: 'rua', c: proj(topo), dy: -13, principal: true });
          criarPlaca({ texto: v.nome.toUpperCase(), tipo: 'rua', c: proj(base), dy: 14, principal: false });
        }
      }
    });
    // Espaçamento médio entre ruas e comprimento das avenidas (em m): decidem quando as placas aparecem
    const ruasX = data.vias.filter((v) => v.tipo === 'rua').map((v) => v.pts[0][0]).sort((a, b) => a - b);
    if (ruasX.length > 1) state.espRuaM = (ruasX[ruasX.length - 1] - ruasX[0]) / (ruasX.length - 1);
    const avs = data.vias.filter((v) => v.tipo === 'avenida');
    if (avs.length) state.avLenM = avs.reduce((s, v) => s + comprimento(v.pts), 0) / avs.length;
    el.gVias.appendChild(fragBordas);
    el.gVias.appendChild(fragPistas);

    // 4) Lotes: polígono preenchido por status + rótulo com o número
    const fragLotes = document.createDocumentFragment();
    const fragRotulos = document.createDocumentFragment();
    for (const l of data.lotes) {
      if (!l || !polyValido(l.poly) || l.id == null) continue;
      const id = String(l.id);
      // Status desconhecido NUNCA vira "disponível": cai em reservado, por segurança comercial.
      const status = STATUS_VALIDOS.has(l.status) ? l.status : 'reservado';
      const centro = pontoValido(l.c) ? l.c : centroide(l.poly);

      const p = criar('polygon', { class: `lote lote--${status}`, points: pontos(l.poly), 'vector-effect': NSS, 'data-id': id });
      fragLotes.appendChild(p);

      // Tamanho do rótulo proporcional ao lote (em metros), limitado ao tamanho base
      const fonte = limitar(Math.sqrt(Math.max(l.area || 0, 1)) / 6, 3.5, ROTULO_FONTE_M);
      const pc = proj(centro);
      fragRotulos.appendChild(criar('text', { class: `rotulo rotulo--${status}`, x: pc[0], y: pc[1], 'font-size': fonte }, id));

      const lote = { ...l, id, status, el: p, centro, pc, bbox: bboxDe(l.poly), bboxP: bboxDe(l.poly.map(proj)) };
      state.lotes.set(id, lote);
      const n = parseInt(id, 10);
      if (!Number.isNaN(n) && !state.porNumero.has(n)) state.porNumero.set(n, lote);
      state.contagem[status]++;
    }
    el.gLotes.appendChild(fragLotes);
    el.gRotulos.appendChild(fragRotulos);

    // 5) Glebas: contorno verde-escuro + número (tamanho constante em px)
    for (const g of data.glebas) {
      if (!g || !polyValido(g.poly)) continue;
      el.gGlebas.appendChild(criar('polygon', { class: 'gleba', points: pontos(g.poly), 'vector-effect': NSS }));
      // Selo da gleba: cobre o círculo que a planta CAD abre entre os lotes no ponto do número (camada 2,5D, em metros)
      const cw = pontoValido(g.label) ? g.label : centroide(g.poly);
      el.gGlebas.appendChild(criar('circle', { class: 'gleba-selo', cx: cw[0], cy: cw[1], r: 11.5, 'vector-effect': NSS }));
      const c = proj(cw);
      el.gRotulosGlebas.appendChild(criar('text', { class: 'rotulo-gleba', x: c[0], y: c[1] }, String(g.id)));
      const bb = bboxDe(g.poly);
      state.glebaLarguraSoma += (bb[2] - bb[0]); state.glebaQtd++;
    }

    // 6) Marcadores com nome: portaria e área de lazer (os itens do clube viram um único marcador, com a lista no mini-painel)
    const clube = data.areas.find((a) => a && a.tipo === 'clube' && polyValido(a.poly));
    const grupo = [];
    const marcadores = [];
    if (clube) { const bc = bboxDe(clube.poly); state.clubeLargM = Math.max(bc[2] - bc[0], 1); }
    for (const p of data.pontos) {
      if (!p.c) continue;
      if (p.tipo === 'reserva') { state.pontos.push({ ...p, pc: proj(p.c), el: null, item: null, dx: 0 }); continue; } // sem marcador: o nome já está sobre a mata
      if (clube && dentroDePoligono(p.c, clube.poly)) { grupo.push(p); continue; }
      marcadores.push({ ...p, rotulo: p.tipo === 'guarita' ? 'Portaria' : p.nome });
    }
    if (grupo.length) {
      const itensDecor = data.decor && Array.isArray(data.decor.lazer) ? data.decor.lazer.filter((it) => it && pontoValido(it.c)) : [];
      const cLazer = itensDecor.length ? [itensDecor.reduce((s, it) => s + it.c[0], 0) / itensDecor.length, itensDecor.reduce((s, it) => s + it.c[1], 0) / itensDecor.length] : centroide(clube.poly);
      marcadores.push({ id: 'lazer', n: 0, nome: 'Área de lazer', tipo: 'lazer', rotulo: 'Área de lazer', c: cLazer, desc: grupo.map((p) => p.nome).join(' · '), itens: grupo });
    }
    for (const p of marcadores) {
      const g = criar('g', { class: `ponto ponto--${p.tipo}`, 'data-id': p.id, role: 'button', tabindex: '0', 'aria-label': p.nome });
      const w = Math.round(p.rotulo.length * 7.1 + 46);
      g.appendChild(criar('ellipse', { class: 'ponto__pe', cx: 0, cy: 0, rx: 5.5, ry: 2.6 }));
      g.appendChild(criar('line', { class: 'ponto__haste', x1: 0, y1: -1, x2: 0, y2: -14 }));
      g.appendChild(criar('rect', { class: 'ponto__anel', x: -w / 2 - 4, y: -44, width: w + 8, height: 36, rx: 18 }));
      g.appendChild(criar('rect', { class: 'ponto__pill', x: -w / 2, y: -40, width: w, height: 28, rx: 14 }));
      const ic = criar('g', { class: 'ponto__icone', transform: `translate(${-w / 2 + 9} -36) scale(.83)` });
      ic.appendChild(criar('path', { d: ICONES[iconeDe(p)] || ICONES.padrao, fill: 'none', stroke: 'currentColor', 'stroke-width': '1.9', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
      g.appendChild(ic);
      g.appendChild(criar('text', { class: 'ponto__rotulo', x: -w / 2 + 34, y: -26 }, p.rotulo));
      el.gPontos.appendChild(g);
      state.pontos.push({ ...p, pc: proj(p.c), el: g, item: null, dx: 0 });
    }

    // 7) Árvores (camada plana; tamanho em metros, escalam com o zoom)
    if (data.decor && Array.isArray(data.decor.arvores)) {
      const frag = document.createDocumentFragment();
      for (const a of data.decor.arvores) {
        if (!Array.isArray(a) || a.length < 2 || !Number.isFinite(a[0]) || !Number.isFinite(a[1])) continue;
        const [px, py] = proj(a);
        frag.appendChild(usar(`#arv${[1, 2, 3].includes(a[2]) ? a[2] : 1}`, { transform: `translate(${px.toFixed(1)} ${py.toFixed(1)}) scale(${((a[3] || 1) * 0.95).toFixed(2)})` }));
      }
      el.gArvores.appendChild(frag);
    }

    // 8) Área de lazer: ícones ilustrados (aparecem quando o zoom permite; clique abre o mini-painel) + portaria na entrada
    const itensLazer = data.decor && Array.isArray(data.decor.lazer) ? data.decor.lazer : [];
    for (const it of itensLazer) {
      if (!it || !pontoValido(it.c) || !it.id) continue;
      const pc = proj(it.c);
      const g = criar('g', { class: `lazer lazer--${it.tipo}`, 'data-id': String(it.id), role: 'button', tabindex: '0', 'aria-label': String(it.nome || ''), transform: `translate(${pc[0]} ${pc[1]})` });
      g.appendChild(usar(`#ico-${String(it.tipo).replace(/[^a-z_]/gi, '')}`, { transform: 'scale(.8)' }));
      g.appendChild(criar('text', { class: 'lazer__nome', x: 0, y: 10 }, String(it.nome || '')));
      el.gLazer.appendChild(g);
      state.pontos.push({ id: String(it.id), n: 0, nome: String(it.nome || ''), tipo: String(it.tipo || 'padrao'), desc: it.desc || '', c: it.c, pc, el: g, item: null, dx: 0, lazer: true });
    }
    if (pontoValido(data.meta.entrada)) {
      const pc = proj(data.meta.entrada);
      el.gArvores.appendChild(usar('#ico-guarita', { class: 'portal', transform: `translate(${pc[0]} ${pc[1]}) scale(.62)` }));
    }

    // Caixa do mundo: meta.bbox ou calculada a partir de tudo que foi desenhado
    state.bbox = projBbox(bboxValido(data.meta.bbox) ? data.meta.bbox : calcularBbox(data));
  }

  function iconeDe(p) { return p.tipo === 'lazer' ? 'piscina' : p.tipo; }

  function usar(ref, attrs) {
    const u = criar('use', attrs);
    u.setAttribute('href', ref);
    u.setAttributeNS(XLINK_NS, 'xlink:href', ref);
    return u;
  }

  // Ponto (mundo) a uma fração do comprimento de uma polilinha
  function pontoAoLongo(pl, frac) {
    const total = comprimento(pl);
    let alvo = frac * total;
    for (let i = 0; i < pl.length - 1; i++) {
      const d = Math.hypot(pl[i + 1][0] - pl[i][0], pl[i + 1][1] - pl[i][1]);
      if (alvo <= d || i === pl.length - 2) {
        const t = d ? Math.min(alvo / d, 1) : 0;
        return [pl[i][0] + (pl[i + 1][0] - pl[i][0]) * t, pl[i][1] + (pl[i + 1][1] - pl[i][1]) * t];
      }
      alvo -= d;
    }
    return pl[pl.length - 1];
  }

  function dentroDePoligono(pt, poly) {
    let dentro = false;
    for (let i = 0, k = poly.length - 1; i < poly.length; k = i++) {
      const [xi, yi] = poly[i], [xk, yk] = poly[k];
      if ((yi > pt[1]) !== (yk > pt[1]) && pt[0] < ((xk - xi) * (pt[1] - yi)) / (yk - yi) + xi) dentro = !dentro;
    }
    return dentro;
  }

  // Placa de via: tamanho fixo em px (o transform aplica scale(1/k)); geometria em px em torno do ponto da via
  function criarPlaca({ texto, tipo, c, dy, principal, sempre = false }) {
    const fonte = tipo === 'avenida' ? 11 : 9;
    const w = Math.round(texto.length * fonte * 0.68 + 16);
    const h = tipo === 'avenida' ? 22 : 17;
    const g = criar('g', { class: `placa placa--${tipo}${principal ? ' placa--principal' : ''}` });
    if (tipo === 'avenida') g.appendChild(criar('line', { class: 'placa__haste', x1: 0, y1: 0, x2: 0, y2: dy }));
    const corpo = criar('g', { transform: `translate(0 ${dy})` });
    corpo.appendChild(criar('rect', { class: 'placa__fundo', x: -w / 2, y: -h / 2, width: w, height: h, rx: tipo === 'avenida' ? 5 : 3.5 }));
    corpo.appendChild(criar('text', { class: 'placa__texto', x: 0, y: 0, 'font-size': fonte }, texto));
    g.appendChild(corpo);
    el.gNomesVias.appendChild(g);
    state.placas.push({ el: g, c, tipo, principal, sempre, visivel: null });
  }

  const bboxValido = (b) => Array.isArray(b) && b.length === 4 && b.every(Number.isFinite) && b[2] > b[0] && b[3] > b[1];

  function calcularBbox(data) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const acum = (poly) => { const b = bboxDe(poly); x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3]); };
    data.lotes.forEach((l) => l && polyValido(l.poly) && acum(l.poly));
    data.glebas.forEach((g) => g && polyValido(g.poly) && acum(g.poly));
    data.areas.forEach((a) => a && polyValido(a.poly) && acum(a.poly));
    data.vias.forEach((v) => acum(v.pts));
    data.pontos.forEach((p) => p.c && acum([p.c]));
    return Number.isFinite(x0) && x1 > x0 && y1 > y0 ? [x0, y0, x1, y1] : [0, 0, 100, 100];
  }

  // ---------------------------------------------------------------- Legenda, hero, rodapé
  // Legenda: mostra a contagem real do array e avisa no console se o meta divergir
  function preencherLegenda() {
    // A página é do cliente: a legenda mostra só a simbologia. As contagens ficam no console, para o gestor.
    const m = state.data.meta || {};
    console.info('[lotes] contagem real:', { ...state.contagem }, '| meta:', { disponiveis: m.disponiveis, vendidos: m.vendidos, reservados: m.reservados, reserva_tecnica: m.reserva_tecnica });
  }

  function areaTotalM2(data) {
    const m = data.meta;
    if (Number.isFinite(m.area_total_m2) && m.area_total_m2 > 0) return m.area_total_m2;
    const imovel = data.areas.find((a) => a && a.tipo === 'imovel' && polyValido(a.poly));
    if (imovel) return areaPoly(imovel.poly);
    const glebas = data.glebas.reduce((s, g) => s + (g && polyValido(g.poly) ? areaPoly(g.poly) : 0), 0);
    if (glebas > 0) return glebas;
    return data.lotes.reduce((s, l) => s + (l && Number.isFinite(l.area) ? l.area : 0), 0);
  }

  function preencherHero() {
    const data = state.data;
    if (el.hGlebas) el.hGlebas.textContent = fmtInt.format(state.glebaQtd || data.glebas.length);
    const ha = Number.isFinite(data.meta.area_total_ha) ? data.meta.area_total_ha : areaTotalM2(data) / 10000;
    if (el.hArea) el.hArea.textContent = ha > 0 ? `${fmtInt.format(Math.round(ha))} ha` : '—';
  }

  function numeroWhats() {
    const m = state.data.meta;
    return m.whatsapp ? String(m.whatsapp).replace(/\D/g, '') : '';
  }

  function preencherRodape() {
    const m = state.data.meta;
    el.rAtualizado.textContent = fmtData(m.gerado_em);
    el.rFonte.textContent = m.fonte || '—';
    const numero = numeroWhats();
    if (numero && el.chegarWhats) {
      const msg = 'Olá! Quero saber mais sobre as unidades do Haras Rio São José.';
      el.chegarWhats.href = `https://wa.me/${numero}?text=${encodeURIComponent(msg)}`;
      el.chegarWhats.hidden = false;
    } else if (el.chegarWhats) {
      el.chegarWhats.hidden = true;
    }
  }

  // ---------------------------------------------------------------- Áreas comuns: ícones, chips, legenda numerada, popover
  function iconeSvg(tipo) {
    const d = ICONES[tipo] || ICONES.padrao;
    const s = criar('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' });
    s.appendChild(criar('path', { d, fill: 'none', stroke: 'currentColor', 'stroke-width': '1.7', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    return s;
  }

  function pontoPorId(id) { return state.pontos.find((p) => p.id === id) || null; }

  // Barra de áreas comuns sob o mapa: um chip por item; clique leva até ele no mapa
  function construirChips() {
    if (!el.comunsChips || !el.comunsBarra) return;
    limpar(el.comunsChips);
    const itens = state.pontos.filter((p) => p.tipo !== 'lazer' && pontoValido(p.c));
    el.comunsBarra.hidden = itens.length === 0;
    for (const p of itens) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'chip-comum'; b.dataset.id = p.id;
      b.appendChild(iconeSvg(iconeDe(p)));
      b.append(p.tipo === 'guarita' ? 'Portaria' : p.nome);
      b.addEventListener('click', () => focarPonto(p));
      el.comunsChips.appendChild(b);
      p.item = b;
    }
  }

  function ativarPonto(p) {
    if (state.pontoAtivo && state.pontoAtivo !== p) {
      if (state.pontoAtivo.el) state.pontoAtivo.el.classList.remove('is-ativo');
      if (state.pontoAtivo.item) state.pontoAtivo.item.classList.remove('is-ativo');
    }
    state.pontoAtivo = p;
    if (!p) return;
    if (p.item) p.item.classList.add('is-ativo');
    if (p.el) {
      p.el.classList.add('is-ativo');
      el.gPontos.appendChild(p.el); // marcador ativo por cima dos demais
    }
  }

  function abrirPopover(p) {
    if (!p.c) return;
    ativarPonto(p);
    limpar(el.popIcone); el.popIcone.appendChild(iconeSvg(iconeDe(p)));
    el.popNome.textContent = p.nome;
    el.popDesc.textContent = p.desc || '';
    el.popDesc.hidden = !p.desc;
    el.popover.hidden = false;
    posicionarPopover();
  }

  function fecharPopover() {
    el.popover.hidden = true;
    ativarPonto(null);
  }

  function posicionarPopover() {
    const p = state.pontoAtivo;
    if (!p || !p.c || el.popover.hidden) return;
    const { w, h } = tamanhoSvg();
    const sx = p.pc[0] * vista.k + vista.tx + (p.dx || 0);
    const sy = p.pc[1] * vista.k + vista.ty;
    const pw = el.popover.offsetWidth || 280, ph = el.popover.offsetHeight || 120;
    const abaixo = sy - 40 - ph < 8 && sy + 16 + ph < h;
    el.popover.classList.toggle('is-abaixo', abaixo);
    el.popover.style.left = `${limitar(sx, pw / 2 + 8, Math.max(pw / 2 + 8, w - pw / 2 - 8))}px`;
    el.popover.style.top = `${sy}px`;
  }

  // Clique na legenda: centraliza o marcador no mapa (com zoom mínimo confortável) e abre o mini-painel
  function focarPonto(p) {
    if (!p || !p.c) return;
    if (state.selecionado) fecharPainel();
    const kLazer = (LAZER_MIN_PX + 320) / state.clubeLargM; // zoom em que os ícones da área de lazer aparecem
    const k = limitarK(Math.max(vista.k, (p.lazer || p.tipo === 'lazer') ? kLazer : vista.kAjuste * PONTO_ZOOM_FATOR));
    const alvo = pontoVisivel();
    vista.mexeu = true;
    irPara(k, alvo.x - p.pc[0] * k - (p.dx || 0), alvo.y - p.pc[1] * k, true);
    abrirPopover(p);
    if (!DESKTOP.matches) {
      try { el.mapa.scrollIntoView({ behavior: MENOS_MOVIMENTO.matches ? 'auto' : 'smooth', block: 'center' }); } catch (_) { /* sem suporte */ }
    }
  }

  // ---------------------------------------------------------------- Transformação (pan/zoom)
  let rafPendente = false;
  function agendar() {
    if (rafPendente) return;
    rafPendente = true;
    requestAnimationFrame(() => { rafPendente = false; aplicarTransform(); });
  }

  function aplicarTransform() {
    const k = vista.k;
    el.mundo.setAttribute('transform', `translate(${vista.tx} ${vista.ty}) scale(${k})`);

    // Rótulos de gleba/área mantêm tamanho constante em px
    el.svg.style.setProperty('--gleba-fs', `${GLEBA_FONTE_PX / k}px`);

    // Contornos mais finos na visão geral, para os lotes aparecerem como massa de cor
    const faixa = k < 0.16 ? 'fina' : k < 0.3 ? 'media' : 'normal';
    if (faixa !== state.faixaStroke) {
      state.faixaStroke = faixa;
      el.svg.style.setProperty('--lote-sw', faixa === 'fina' ? '.3px' : faixa === 'media' ? '.45px' : '.6px');
      el.svg.style.setProperty('--gleba-sw', faixa === 'fina' ? '.9px' : faixa === 'media' ? '1.2px' : '1.6px');
    }

    // Rótulos de gleba e de área só aparecem quando a gleba média tem largura legível na tela
    const largMedia = state.glebaQtd ? state.glebaLarguraSoma / state.glebaQtd : 120;
    const mostrarGlebas = largMedia * k >= GLEBA_MIN_PX;
    if (mostrarGlebas !== state.glebasVisiveis) {
      state.glebasVisiveis = mostrarGlebas;
      el.gRotulosGlebas.style.display = mostrarGlebas ? '' : 'none';
      el.gRotulosAreas.style.display = mostrarGlebas ? '' : 'none';
      el.svg.classList.toggle('glebas-ocultas', !mostrarGlebas);
    }
    // Rótulos dos lotes só aparecem quando legíveis
    const mostrar = ROTULO_FONTE_M * k >= ROTULO_MIN_PX;
    if (mostrar !== state.rotulosVisiveis) {
      state.rotulosVisiveis = mostrar;
      el.gRotulos.style.display = mostrar ? '' : 'none';
    }
    // Placas das vias: tamanho fixo em px; ruas só quando o espaçamento na tela permite; avenidas 1 ou 3 placas
    const inv = 1 / k;
    const espRua = state.espRuaM * k;
    const mostrarRuas = espRua >= 40;
    const mostrarRuasBase = espRua >= 120;
    const tresPlacas = state.avLenM * k >= 460;
    for (const p of state.placas) {
      const vis = p.sempre || (p.tipo === 'rua' ? (mostrarRuas && (p.principal || mostrarRuasBase)) : (p.principal || tresPlacas));
      if (vis !== p.visivel) { p.visivel = vis; p.el.style.display = vis ? '' : 'none'; }
      if (vis) p.el.setAttribute('transform', `translate(${p.c[0]} ${p.c[1]}) scale(${inv})`);
    }
    // Ícones da área de lazer só quando ela ocupa largura suficiente na tela; nessa hora o marcador "Área de lazer" sai
    const mostrarLazer = state.clubeLargM * k >= LAZER_MIN_PX;
    if (mostrarLazer !== state.lazerVisivel) {
      state.lazerVisivel = mostrarLazer;
      el.gLazer.style.display = mostrarLazer ? '' : 'none';
      for (const p of state.pontos) if (p.el && p.tipo === 'lazer') p.el.style.display = mostrarLazer ? 'none' : '';
    }
    // Marcadores: posição no mundo (projetada), tamanho constante em px
    for (const p of state.pontos) if (p.el && !p.lazer) p.el.setAttribute('transform', `translate(${p.pc[0]} ${p.pc[1]}) scale(${inv})`);

    posicionarPopover();
    atualizarEscala();
  }

  function tamanhoSvg() {
    const r = el.svg.getBoundingClientRect();
    return { w: Math.max(r.width, 1), h: Math.max(r.height, 1), left: r.left, top: r.top };
  }

  // Rosa dos ventos e escala em metros: canto inferior direito, acima da legenda;
  // no desktop, deslocam-se para a esquerda quando o painel do lote está aberto.
  function atualizarEscala() {
    const { w, h, left, top } = tamanhoSvg();
    const margem = DESKTOP.matches ? 16 : 12;
    let direita = w - margem;
    if (DESKTOP.matches && el.painel.classList.contains('is-aberto')) direita = w - el.painel.offsetWidth - margem - 16;
    let base = h - margem;
    const legenda = $('#legenda');
    if (legenda) {
      const r = legenda.getBoundingClientRect();
      // Só sobe acima da legenda se ela avançar sobre a coluna da escala
      if (r.height && r.right - left > direita - 160) base = r.top - top - 10;
    }

    // Escala: comprimento "redondo" em metros que caiba em até 140 px
    const bruto = 110 / vista.k;
    const pot = Math.pow(10, Math.floor(Math.log10(Math.max(bruto, 1e-6))));
    let metros = pot;
    for (const f of [1, 2, 2.5, 5, 10]) { if (f * pot * vista.k <= 140) metros = f * pot; }
    const px = Math.max(metros * vista.k, 1);
    const larg = Math.max(px, 64) + 20;
    const y0 = base - 30;
    el.escalaFundo.setAttribute('x', direita - larg); el.escalaFundo.setAttribute('y', y0);
    el.escalaFundo.setAttribute('width', larg); el.escalaFundo.setAttribute('height', 30);
    el.escalaLinha.setAttribute('x1', direita - 10 - px); el.escalaLinha.setAttribute('x2', direita - 10);
    el.escalaLinha.setAttribute('y1', y0 + 23); el.escalaLinha.setAttribute('y2', y0 + 23);
    el.escalaTexto.setAttribute('x', direita - 10 - px / 2); el.escalaTexto.setAttribute('y', y0 + 15);
    el.escalaTexto.setAttribute('text-anchor', 'middle');
    el.escalaTexto.textContent = metros >= 1000 ? `${fmtHa.format(metros / 1000)} km` : `${fmtInt.format(metros)} m`;

    // Rosa dos ventos logo acima da escala
    el.rosa.setAttribute('transform', `translate(${direita - 21} ${y0 - 12 - 21})`);
  }

  // Enquadra o bbox inteiro na tela
  function verTudo(animar = true) {
    const { w, h } = tamanhoSvg();
    const [x0, y0, x1, y1] = state.bbox;
    const pad = DESKTOP.matches ? 28 : 18;
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
    const [bx0, by0, bx1, by1] = lote.bboxP;
    const maior = Math.max(bx1 - bx0, by1 - by0, 1);
    let k = vista.k;
    if (comZoom) k = limitarK(Math.max(vista.k, LOTE_ALVO_PX / maior));
    const alvo = pontoVisivel();
    vista.mexeu = true;
    irPara(k, alvo.x - lote.pc[0] * k, alvo.y - lote.pc[1] * k, true);
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
      // Toque/clique simples: seleciona o lote, abre a área comum ou fecha o que estiver aberto.
      // Usa o alvo guardado no pointerdown: com pointer capture, o e.target do
      // pointerup é sempre o <svg>, não o polígono.
      const alvo = gesto.alvo && gesto.alvo.closest ? gesto.alvo : null;
      const lote = alvo ? alvo.closest('.lote') : null;
      const ponto = alvo ? alvo.closest('.ponto, .lazer') : null;
      if (ponto) {
        const p = pontoPorId(ponto.getAttribute('data-id'));
        if (p) { if (state.selecionado) fecharPainel(); abrirPopover(p); }
      } else if (lote) {
        selecionarLote(lote.getAttribute('data-id'), { centralizar: true, zoom: false });
      } else {
        if (state.selecionado) fecharPainel();
        if (state.pontoAtivo) fecharPopover();
      }
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

  // Teclado sobre os marcadores (são focáveis): Enter/Espaço abre o mini-painel
  function onSvgKeydown(e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const ponto = e.target && e.target.closest ? e.target.closest('.ponto') : null;
    if (!ponto) return;
    e.preventDefault();
    const p = pontoPorId(ponto.getAttribute('data-id'));
    if (p) focarPonto(p);
  }

  // ---------------------------------------------------------------- Seleção e painel
  function selecionarLote(id, { centralizar = true, zoom = true, url = true } = {}) {
    const lote = state.lotes.get(String(id));
    if (!lote) return false;

    if (state.pontoAtivo) fecharPopover();
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

    // Valor de referência: só quando preco_m2 é número, há área e o lote está disponível
    const preco = typeof m.preco_m2 === 'number' && Number.isFinite(m.preco_m2) ? m.preco_m2 : null;
    if (preco !== null && Number.isFinite(lote.area) && lote.status === 'disponivel') {
      el.pValorNum.textContent = fmtBRL.format(lote.area * preco);
      el.pValor.hidden = false;
    } else {
      el.pValor.hidden = true;
    }

    // WhatsApp: número E.164 sem "+"; sem número, o botão some
    const numero = numeroWhats();
    if (numero) {
      const msg = `Olá! Tenho interesse no lote ${lote.id} (Gleba ${lote.gleba ?? '—'}) do Haras Rio São José.`;
      el.pWhats.href = `https://wa.me/${numero}?text=${encodeURIComponent(msg)}`;
      el.pWhats.hidden = false;
    } else {
      el.pWhats.hidden = true;
    }
    el.painel.classList.toggle('painel--sem-whats', !numero);
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
    agendar(); // reposiciona escala/rosa quando os controles se deslocam
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
    agendar();
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
    el.svg.addEventListener('keydown', onSvgKeydown);
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

    // Painel do lote
    el.painelFechar.addEventListener('click', fecharPainel);
    el.pShare.addEventListener('click', compartilhar);
    ligarArrasteDoPainel();

    // Mini-painel das áreas comuns
    el.popFechar.addEventListener('click', fecharPopover);

    // Teclado: Esc fecha painel e mini-painel
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (state.pontoAtivo) fecharPopover();
      if (state.selecionado) { fecharPainel(); el.buscaInput.blur(); }
    });

    // Erro
    el.estadoTentar.addEventListener('click', carregar);

    // Layout: altura do cabeçalho e redimensionamento do mapa
    if ('ResizeObserver' in window) {
      new ResizeObserver(medirTopo).observe(el.topo);
      new ResizeObserver(() => { if (!state.data) return; if (!vista.mexeu) verTudo(false); else agendar(); }).observe(el.mapa);
    } else {
      window.addEventListener('resize', () => { medirTopo(); if (!state.data) return; if (!vista.mexeu) verTudo(false); else agendar(); });
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
      construirChips();
      preencherLegenda();
      preencherHero();
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

  // Vídeo 360°: a capa com botão inicia o player; telas pequenas recebem a versão 720p (menor)
  function ligarVideo() {
    const v = document.getElementById('video-360');
    const b = document.getElementById('video-play');
    const quadro = document.getElementById('video-quadro');
    if (!v || !b || !quadro) return;
    if (window.innerWidth <= 720) {
      const s = v.querySelector('source');
      if (s) { s.src = 'assets/video-360-720.mp4'; v.load(); }
    }
    b.addEventListener('click', () => { quadro.classList.add('is-tocando'); v.play().catch(() => {}); });
    v.addEventListener('play', () => quadro.classList.add('is-tocando'));
    v.addEventListener('ended', () => quadro.classList.remove('is-tocando'));
  }

  function iniciar() {
    ligarVideo();
    medirTopo();
    // Destaque do lote selecionado com espessura constante em px
    el.halo.setAttribute('vector-effect', 'non-scaling-stroke');
    el.contorno.setAttribute('vector-effect', 'non-scaling-stroke');
    ligarEventos();
    carregar();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
