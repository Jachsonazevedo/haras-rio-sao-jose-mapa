/* =====================================================================
   Haras Rio São José — render360.js (uso interno)
   Gera ESFERAS 360° (equirretangulares 2:1) da maquete do Haras vistas do alto,
   uma por ponto de vista de tour/pontos360.json (calculado por scripts/preparar_tour.py).
   Cena = a mesma do mapa (js/cena3d.js), com céu e entorno; só as unidades à venda em verde.
   Uso: python scripts/servidor_render.py 8766 → http://localhost:8766/render360.html
        no console: await __r360.gerarTodas()
   ===================================================================== */
import * as THREE from 'three';
import { construirCena } from './cena3d.js?v=r360g';

const $ = (s) => document.querySelector(s);
const log = (t) => { $('#log').textContent += t + '\n'; };

const dados = await (await fetch('data/lotes.json', { cache: 'no-store' })).json();
const pontos = await (await fetch('tour/pontos360.json', { cache: 'no-store' })).json();
const cena = construirCena(dados, { qualidade: 'render', soDisponiveis: true });
const { scene } = cena;
await new Promise((ok) => { window.addEventListener('haras:textura', ok, { once: true }); setTimeout(ok, 5000); });
// a camada verde das unidades à venda é desenhada sem teste de profundidade: tudo o que fica acima do chão
// (árvores, construções, postes, cercas) vem depois, para continuar por cima dela
{
  const planos = scene.getObjectByName('planos'), entorno = scene.getObjectByName('entorno'), maquete = scene.getObjectByName('maquete');
  scene.traverse((o) => {
    let p = o; while (p && p !== planos && p !== entorno && p !== maquete) p = p.parent;   // chão, céu e terreno ficam como estão
    if (!p && (o.isMesh || o.isLine || o.isPoints || o.isInstancedMesh) && o.renderOrder < 50) o.renderOrder = 50;
  });
}

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
$('#palco').appendChild(renderer.domElement);
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
  cena.definirModo('entorno', renderer);
}

// cubo → equirretangular (yaw 0 = direção -Z; yaw cresce para +X, igual ao Photo Sphere Viewer)
const FACE = 2048;
const alvoCubo = new THREE.WebGLCubeRenderTarget(FACE, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
const camCubo = new THREE.CubeCamera(1.5, 120000, alvoCubo);
scene.add(camCubo);
const matEqui = new THREE.ShaderMaterial({
  uniforms: { env: { value: alvoCubo.texture } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: `uniform samplerCube env; varying vec2 vUv;
    void main(){
      float lon = (vUv.x - 0.5) * 6.28318530718;
      float lat = (vUv.y - 0.5) * 3.14159265359;
      vec3 d = vec3(cos(lat) * sin(lon), sin(lat), -cos(lat) * cos(lon));
      gl_FragColor = textureCube(env, d);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
  depthTest: false, depthWrite: false, toneMapped: true,
});
const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), matEqui);
const cenaQuad = new THREE.Scene(); cenaQuad.add(quad);
const camQuad = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

async function salvar(canvas, nome) {
  const blob = await new Promise((ok) => canvas.toBlob(ok, 'image/jpeg', 0.88));
  const r = await fetch(`/salvar?nome=${encodeURIComponent(nome)}&pasta=tour`, { method: 'POST', body: blob });
  if (!r.ok) throw new Error(`falha ao salvar ${nome}: ${r.status}`);
  log(`salvo tour/img/${nome} (${Math.round(blob.size / 1024)} KB)`);
}

async function gerar(p, { largura = 6144 } = {}) {
  const alvo = new THREE.Vector3(p.x, p.alt, p.z);
  camCubo.position.copy(alvo);
  camCubo.updateMatrixWorld(true);
  cena.ajustarDistancia(3000);   // cor dos lotes no máximo (leitura de mapa)
  cena.ligarSombrasReais && cena.ligarSombrasReais(renderer, false, new THREE.Vector3(p.x, 0, p.z), 400);
  const tm = renderer.toneMapping; renderer.toneMapping = THREE.NoToneMapping;  // a cena vai linear para o cubo
  camCubo.update(renderer, scene); camCubo.update(renderer, scene);             // 2x: o 1º quadro pode sair sem texturas
  renderer.toneMapping = tm;
  renderer.setSize(largura, largura / 2, false);
  renderer.setRenderTarget(null);
  renderer.render(cenaQuad, camQuad);
  await salvar(renderer.domElement, `esfera-${p.id}.jpg`);
  // miniatura 384×216 olhando para o ponto inicial
  const mini = document.createElement('canvas'); mini.width = 384; mini.height = 216;
  const W = renderer.domElement.width, H = renderer.domElement.height;
  const cx = ((p.yaw0 || 0) / 360 + 0.5) * W, cy = (0.5 - (p.pitch0 || -30) / 180) * H;
  const sw = W * 0.2, sh = sw * 216 / 384;
  mini.getContext('2d').drawImage(renderer.domElement, cx - sw / 2, cy - sh / 2, sw, sh, 0, 0, 384, 216);
  await salvar(mini, `esfera-${p.id}-mini.jpg`);
}

async function gerarTodas() {
  for (const p of pontos) { log(`gerando ${p.id}…`); await gerar(p); await new Promise((r) => setTimeout(r, 50)); }
  log('pronto.');
  return pontos.map((p) => p.id);
}

window.__r360 = { gerar, gerarTodas, pontos, cena, renderer };
log(`pronto para gerar ${pontos.length} esferas: ${pontos.map((p) => p.id).join(', ')}`);
