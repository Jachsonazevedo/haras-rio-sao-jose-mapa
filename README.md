# Mapa de Unidades — Haras Rio São José

Página de vendas estática (HTML + CSS + JavaScript puro, sem build e sem dependências além das Google Fonts) com o **mapa ilustrado e interativo** das unidades do chacreamento **Haras Rio São José** (Poções/BA): 654 unidades em 57 glebas, coloridas por status (**verde = disponível**, **vermelho = vendido**, **azul = reservado**), ruas desenhadas com nome, áreas comuns numeradas, busca por número, painel com área/medidas/status, WhatsApp e link compartilhável por lote.

Feita para o corretor e para o cliente consultarem qualquer lote rapidamente — inclusive no celular.

## Estrutura

```
haras-mapa-app/
├── index.html               # página única: cabeçalho, hero, "Veja do alto", mapa, fotos, como chegar, rodapé
├── css/styles.css           # estilos (identidade visual, mobile-first)
├── js/app.js                # mapa SVG, pan/zoom, vias, marcadores, legenda numerada, mini-mapa, busca, painel, deep link
├── data/lotes.json          # DADOS reais (gerados pelo pipeline — não editar à mão)
├── data/lotes.exemplo.json  # exemplo pequeno com TODOS os campos do contrato (para testes)
├── assets/                  # logo.png, drone-poster.jpg, favicon.png, icon-512.png
├── assets/fotos/            # fotos reais e renders do projeto usados na seção "O que já está pronto"
├── scripts/gerar_dados.py   # pipeline que gera data/lotes.json
├── .nojekyll                # impede o GitHub Pages de processar a pasta com Jekyll
└── README.md
```

## Como publicar no GitHub Pages

1. Crie um repositório no GitHub (por exemplo `haras-mapa`) e envie o conteúdo desta pasta para a branch `main`
   (o `index.html` precisa ficar na raiz do repositório).
2. No GitHub: **Settings → Pages → Build and deployment → Source: "Deploy from a branch"**,
   branch `main`, pasta `/ (root)`. Salve.
3. Em 1–2 minutos o site fica no ar em `https://<usuario>.github.io/<repositorio>/`.
4. Para usar um domínio próprio, adicione um arquivo `CNAME` na raiz com o domínio e configure o DNS conforme a documentação do GitHub Pages.

O arquivo `.nojekyll` já está incluído e deve ser mantido.

> Para testar localmente basta abrir a pasta com qualquer servidor estático
> (por exemplo `python -m http.server` dentro da pasta, ou a extensão *Live Server* do VS Code).
> Abrir o `index.html` direto do disco (`file://`) não funciona porque o navegador bloqueia o `fetch` do JSON.
> Para testar com o exemplo pequeno, troque temporariamente `DATA_URL` no topo de `js/app.js` para `data/lotes.exemplo.json`.

## Planta humanizada em 3D (desde 24/09/2026)

O mapa interativo passou a ser uma **planta humanizada em 3D** (Three.js r160, carregado do CDN jsDelivr por *import map*, sem build).
O mapa SVG continua no `index.html` como **reserva**: aparece sozinho se o aparelho não tiver WebGL, se o CDN falhar ou com `?2d=1` no endereço.

| Arquivo | Papel |
|---|---|
| `js/cena3d.js` | Monta a cena a partir de `data/lotes.json`: terreno com morros ao longe, caatinga em manchas, vias de terra cascalhada, lotes (uma malha, cor por status), cerca do perímetro, rede elétrica (postes, fios e 13 transformadores), piquetes da marcação, portaria/guarita, salão, piscina, 3 quiosques, 2 banheiros, quadra de areia, 5 baias + redondel, fazendinha e lago. |
| `js/mapa3d.js` | Mapa interativo: câmera (arrastar, girar, pinça), clique no lote, rótulos HTML (glebas, avenidas, ruas, números dos lotes de perto), bússola, botão 2D/3D, voos até o lote e às áreas comuns. Conversa com o `app.js` pela ponte `window.HarasMapa`. |
| `render.html` + `js/render3d.js` | **Uso interno**: gera as imagens 3D de "Como vai ficar" (`assets/fotos/3d/`) e a planta humanizada (`assets/planta-humanizada.jpg`). |
| `scripts/servidor_render.py` | Servidor local do gerador (salva os JPG). `python scripts/servidor_render.py 8766` → `http://localhost:8766/render.html`. |

**Visual padrão = maquete humanizada** (desde a 2ª rodada de 24/09): o terreno sobre uma base com gramado em volta e laterais de terra, fundo claro, mesmo enquadramento e leitura do mapa ilustrado (glebas em serifa, placas das avenidas por fora do miolo, cores de situação). Lotes em três camadas: pasto natural + véu da situação (forte de longe, suave de perto) + contorno colorido. No computador, sombra real de árvores/prédios/postes (calculada uma vez). Lote selecionado mostra as medidas do memorial nas bordas (frente, fundo, esquerda, direita); escala gráfica em metros. O botão de montanha liga o **entorno** (céu, morros e caatinga). Construções no estilo dos renders do projeto (guarita de pedra com faixa bordô e telhado grande; salão e baias com telhado de quatro águas), respeitando o contrato (5 baias, sem piquete).

**3ª rodada (24/09/2026)**: a área de lazer fica na **parte baixa da faixa inferior esquerda, logo acima do lago** (conforme a implantação). As posições dos itens saem de `scripts/decorar.py` pelo eixo da faixa (`decor.eixo_clube` e `decor.lazer` no `data/lotes.json`); há a via "Acesso ao clube" desde a portaria. Guarita conforme o projeto de revitalização (maio/2026), com a nova logo na placa (`assets/logo-placa.jpg`). Galeria "Como vai ficar": vista geral, portaria, salão e piscina, **área de lazer (`3d-clube`)**, **quiosque (`3d-quiosque`)**, baias e redondel, avenida, lago e área de preservação. Versão contra cache: `?v=20260924d` em `index.html`, `js/mapa3d.js` e `js/render3d.js`; troque nos três lugares ao mudar JS/CSS.

Regras que a cena respeita (contrato v4): vias de terra cascalhada (não asfalto), cerca **só no perímetro** (cada comprador cerca o seu lote), sem deck, sem píer, sem parque infantil, sem estacionamento, sem churrasqueira, quadra **de areia**, 5 baias. As imagens de apresentação mostram os lotes em tom neutro (sem disponibilidade, que muda todo dia) e levam a tarja "Imagem ilustrativa".

Desempenho: desenho sob demanda (só quando a câmera mexe), lotes numa malha única, árvores/postes/mourões/piquetes instanciados, área de lazer fundida por material, árvores distantes com geometria simples; no celular, menos árvores e pixel ratio ≤ 1,5. Medido: ~5 ms por quadro na vista geral em desktop.

Depois de mudar a Planilha Mestre, o fluxo é o mesmo de sempre (`scripts/gerar_dados.py`): a planta 3D lê o mesmo `data/lotes.json`. Só é preciso regerar as imagens 3D se mudar a planta, as áreas comuns ou o visual.

## Formato dos dados (`data/lotes.json`)

O app lê um único JSON. Os campos abaixo são o contrato; os marcados como *opcional* podem faltar sem quebrar nada.

```json
{
  "meta": {
    "gerado_em": "2026-09-15T12:00:00",
    "fonte": "Planilha Mestre 01/09/2026",
    "unidade": "m",
    "bbox": [0, 0, 2100, 700],
    "total": 654, "disponiveis": 187, "vendidos": 464, "reservados": 3,
    "preco_m2": 27.5,
    "whatsapp": "5511991468192",
    "avenidas": ["Avenida Pau Ferro", "Avenida Umbuzeiro"],
    "ruas": 12,
    "area_total_m2": 1409864.55
  },
  "glebas": [ { "id": "01", "poly": [[x,y], ...], "label": [x,y], "lotes": ["001","002"] } ],
  "lotes":  [ { "id": "001", "gleba": "01", "poly": [[x,y], ...], "c": [x,y], "area": 3594.79,
                "frente": 82.37, "fundo": 4.62, "esq": 87.52, "dir": 97.63, "status": "disponivel" } ],
  "areas":  [ { "tipo": "imovel",  "nome": "Haras Rio São José", "poly": [[x,y], ...] },
              { "tipo": "reserva", "nome": "Área de preservação", "poly": [[x,y], ...] },
              { "tipo": "clube",   "nome": "Área de lazer", "poly": [[x,y], ...] },
              { "tipo": "lago",    "nome": "Lago", "poly": [[x,y], ...] },
              { "tipo": "area_comum", "nome": "Área verde", "poly": [[x,y], ...] } ],
  "vias":   [ { "nome": "Avenida Pau Ferro", "tipo": "avenida", "pts": [[x,y], ...] },
              { "nome": "Rua 1", "tipo": "rua", "pts": [[x,y], ...] },
              { "nome": "", "tipo": "acesso", "pts": [[x,y], ...] } ],
  "pontos": [ { "n": 1, "id": "guarita", "nome": "Portaria e guarita", "tipo": "guarita", "c": [x,y],
                "situacao": "pronto", "prazo": null, "desc": "Portaria construída na entrada." } ]
}
```

Regras:

- Coordenadas em **metros**, num plano local: `x` cresce para a direita, `y` cresce **para baixo** (como no SVG).
- `meta.bbox` = `[minx, miny, maxx, maxy]`. Se faltar ou for inválido, o app calcula a partir de tudo que é desenhado.
- `status` deve ser `"disponivel"`, `"vendido"` ou `"reservado"`. Reserva técnica e reserva estratégica entram como `"reservado"`.
  Qualquer valor desconhecido é tratado como **reservado** (nunca como disponível).
- `meta.preco_m2` pode ser `null`. Se for número, o painel mostra "Valor de referência" = área × preço **só em lotes disponíveis**, com a nota "sujeito a confirmação".
- `meta.whatsapp` no formato E.164 sem `+` (ex.: `5577999999999`). Se vier vazio/`null`, os botões de WhatsApp (painel e "Como chegar") não aparecem.
- `meta.avenidas` (2 nomes: ida e volta) e `meta.ruas` (quantidade) alimentam o mini-mapa "Como se orientar" e o texto ao lado; se faltarem, o app usa "Avenida Pau Ferro"/"Avenida Umbuzeiro" e não numera ruas.
- `meta.area_total_m2` alimenta o número "de área total" do hero (em hectares). Se faltar, o app usa a área do polígono `imovel`; sem ele, a soma das glebas; sem glebas, a soma dos lotes.
- A legenda e o hero exibem a contagem **real** do array `lotes`; se `meta.disponiveis/vendidos/reservados/total` divergirem, o app avisa no console do navegador (F12).
- `c` (centro do lote) e `label` (posição do rótulo da gleba/área) são opcionais — o app usa o centroide do polígono quando faltam.
- `areas.tipo`: `imovel` (contorno de todo o imóvel, desenhado por baixo de tudo com sombra), `reserva` (padrão de mata), `lago` (azul), `clube` (área de lazer) ou `area_comum` (verde suave). O `nome` vira rótulo; nome vazio não desenha rótulo.
- `vias`: objetos `{nome, tipo, pts}`. `tipo` define a largura em metros: `avenida` ≈ 14 m, `rua` ≈ 9 m, `acesso` ≈ 10 m. O nome é escrito ao longo do traçado e só aparece quando o zoom o deixa legível (e se couber no comprimento da via). **Compatibilidade**: um array de pontos puro (formato antigo) ainda funciona e é tratado como rua sem nome. `vias` vazio é aceito.
- `pontos` (áreas comuns): `n` é o número do marcador e da legenda; `tipo` escolhe o ícone (`guarita`, `salao`, `piscina`, `quiosque`, `banheiro`, `quadra`, `baias`, `fazendinha`, `agua`, `reserva`, `estacionamento`; qualquer outro usa um ícone genérico); `situacao` é `pronto`, `em_obra` ou `previsto` (com `prazo` no formato `dd/mm/aaaa` ou `null`). Se `c` for `null`, o item aparece na legenda mas sem marcador no mapa. Vários pontos na mesma coordenada abrem em leque. `pontos` ausente é aceito.
- **Nenhum dado pessoal** deve entrar no JSON (sem nomes de compradores).

Para conferir se o JSON está válido antes de publicar:

```
python -c "import json;json.load(open('data/lotes.json', encoding='utf-8'));print('ok')"
```

## Assets

| Arquivo | Uso | Observações |
|---|---|---|
| `assets/logo.png` | Logo no cabeçalho | PNG com fundo transparente, ~200×200 px |
| `assets/favicon.png`, `assets/icon-512.png` | Ícones do site | |
| `assets/drone-poster.jpg` | Fundo do hero e do quadro "Vídeo 360° em breve" | JPG 1600×900 px aprox. |
| `assets/fotos/aerea-1.jpg` … `aerea-5.jpg` | Vistas aéreas (seção "O que já está pronto") | 4:3 ou 16:9 |
| `assets/fotos/paineis-solares.jpg`, `reservatorio.jpg`, `obra-agua.jpg` | Sistema de água | `reservatorio.jpg` é vertical |
| `assets/fotos/projeto-salao-piscina.jpg`, `projeto-baias-redondel.jpg`, `projeto-guarita.jpg` | Renders do projeto | **Sempre** exibidos com a tarja "Imagem ilustrativa do projeto" |

Se algum arquivo faltar, o app continua funcionando: o logo some, o quadro do vídeo fica verde-escuro e o card da foto desaparece sem quebrar a galeria.

O vídeo 360° ainda não existe: a seção "Veja do alto" mostra apenas o quadro "Vídeo 360° em breve". Não há `<video>` nem referência a `assets/drone.mp4` na página.

## Uso

- **Arrastar** move o mapa; **roda do mouse** ou **pinça** dá zoom; botões **+**, **−** e **Ver tudo** no canto. Rosa dos ventos e escala em metros ficam no canto inferior direito.
- **Visão geral**: lotes coloridos por status e números das glebas. **Ao ampliar**: números dos lotes e nomes das ruas.
- **Clique/toque** num lote abre o painel com número, gleba, status, área, medidas, valor de referência (só disponíveis), WhatsApp e Compartilhar.
- **Áreas comuns**: marcadores dourados numerados no mapa. Clicar num item da legenda "Áreas comuns" centraliza e destaca o marcador; clicar no marcador (ou Enter com ele focado) abre o mini-painel com nome, situação e descrição.
- **Busca** no topo aceita `12`, `012` ou `lote 12`.
- **Só disponíveis** esmaece vendidos e reservados.
- **Link direto**: `...?lote=123` abre o app já centralizado no lote 123 com o painel aberto (é esse link que o botão Compartilhar copia/envia).
- **Esc** fecha o painel e o mini-painel. No celular, puxe o painel para baixo para fechar.

## Regras de conteúdo

- Usar sempre "chacreamento", "unidade", "lote", "gleba", "fração" — nunca a palavra vetada pelo jurídico (a que começa com "lotea…").
- Não mostrar nem citar lago com píer, deck, parque infantil ou churrasqueira; não prometer energia ligada nem vazão de água.
- Imagens de projeto sempre com a tarja "Imagem ilustrativa do projeto".
- Nenhum dado pessoal na página ou no JSON.
- Rodapé fixo: "Medidas conforme memorial descritivo. Disponibilidade sujeita a confirmação. Imagens de projeto são ilustrativas. Infraestrutura conforme contrato."

## Como os dados são gerados (pipeline oficial)

O arquivo `data/lotes.json` **não é editado à mão**. Ele sai do script `scripts/gerar_dados.py`, que cruza três fontes internas:

| Fonte | O que fornece |
|---|---|
| `- 01 - PL. FRACIONADA - Haras Rio São José.pdf` (planta CAD vetorial, Jan/2021) | geometria de cada lote e de cada gleba |
| `Haras-Rio-Sao-Jose_Base-Glebas-Lotes_v3.xlsx` (memorial) | gleba, área e medidas (frente, fundo, esquerda, direita) |
| `PLANILHA MESTRE POR UNIDADE - 654 lotes - 01-09-2026 - v2.xlsx` | status de cada unidade |

Como funciona: o script rasteriza só os traços vetoriais da planta, encontra as regiões fechadas e casa cada rótulo de lote com a região que o contém. A escala é calibrada pelas áreas do memorial (1 pt = 0,7289 m). Erro mediano de área: 0,9%.

Regras aplicadas:
- `DISPONÍVEL` e `DISTRATADA — sem revenda` → **disponível**
- `VENDIDA` (vigente ou quitada) → **vendido**
- Lotes 267, 269 e 470 (reservas técnicas) e os lotes listados em `reserva_estrategica.txt` (reserva estratégica; arquivo vazio desde 15/09/2026 = nenhum, a definir pelo Jachson) → **reservado**
- Erro conhecido da planta: o rótulo "312" aparece duas vezes e "321" não existe; o script resolve pela área do memorial.

Para atualizar (depois de mudar a Planilha Mestre ou a lista de reserva):

```bash
"C:/Users/Usuário/AppData/Local/Programs/Python/Python312/python.exe" scripts/gerar_dados.py
git add data/lotes.json && git commit -m "Atualiza disponibilidade" && git push
```

O script depende de `pymupdf`, `openpyxl`, `numpy` e `opencv-python-headless` (este último instalado em `D:\Programas\pylibs`). Ele também grava `scripts/verificacao_mapa.png`, uma imagem para conferência visual.

Para alterar a lista da reserva estratégica, edite `reserva_estrategica.txt` (um número de lote por linha) e rode o script de novo.

Campos de configuração em `data/lotes.json → meta` que o script preenche: `preco_m2` (valor de referência por m²; `null` esconde o preço) e `whatsapp` (número em formato internacional sem `+`; `null` esconde o botão). Ambos são definidos no topo de `scripts/gerar_dados.py`.


### Vias, áreas comuns e pontos de interesse

Depois de extrair os lotes, `gerar_dados.py` chama `scripts/enriquecer.py`, que trabalha só em metros e em segundos:

- **Contorno do imóvel**: união dos lotes com as áreas especiais, fechada com 30 m.
- **Avenidas**: corredor livre logo abaixo da faixa superior de glebas (**Avenida Pau Ferro**, sentido entrada → área de preservação) e logo acima da faixa inferior (**Avenida Umbuzeiro**, sentido de volta). Os nomes ficam em `meta.avenidas`.
- **Ruas transversais**: vãos verticais regulares (11–13 m) entre as colunas de glebas, numeradas **Rua 1 … Rua N** a partir da entrada. A quantidade fica em `meta.ruas`.
- **Acesso**: ligação do ponto "ENTRADA" da planta até a Avenida Pau Ferro.
- **Áreas**: `reserva` (área de preservação ambiental), `clube` (área comum de lazer, rótulo "ÁREA VERDE E [LAZER]" da planta), `area_comum` (área verde junto à entrada) e `imovel`.
- **Pontos de interesse**: definidos em `pontos.json` (raiz do projeto). Cada item tem `n`, `id`, `nome`, `tipo`, `situacao` (`pronto` | `em_obra` | `previsto`), `prazo` e `desc`. O campo `onde` diz onde o pino cai: `"entrada"`, `"reserva"`, `"clube"` (distribuído automaticamente dentro da área comum, **posição aproximada**), uma coordenada `[x, y]` em metros, ou `null` (item só na legenda, sem pino). Edite esse arquivo e rode `scripts/enriquecer.py` para atualizar.

Regra de conteúdo: só entram em `pontos.json` itens que constam do contrato de compra e venda vigente. Lago com píer, deck, parque infantil e churrasqueira não entram.

## Publicação

Repositório: https://github.com/Jachsonazevedo/haras-rio-sao-jose-mapa · Site: https://jachsonazevedo.github.io/haras-rio-sao-jose-mapa/

Link direto para um lote: `https://jachsonazevedo.github.io/haras-rio-sao-jose-mapa/?lote=318`

## Mapa ilustrado 2,5D (o próprio mapa interativo)

Desde a rodada 4 o mapa interativo é desenhado em projeção oblíqua (`<g id="mundo-3d" transform="matrix(1 0 0.26 0.74 0 0)">`): a geometria real em metros fica nessa camada e recebe o relevo; rótulos, placas, árvores, ícones e marcadores ficam em camadas planas posicionadas pelo JS com a mesma projeção (`proj()` em `js/app.js`), por isso não distorcem. `scripts/decorar.py` (chamado no fim de `gerar_dados.py`) grava em `data/lotes.json` o contorno do chão (`areas[tipo=imovel]`) e o bloco `decor`: árvores (`[x, y, tipo 1-3, escala]`), a Estrada de Duas Vendas rumo ao norte (Poções), a placa "Poções" e os ícones da área de lazer (`decor.lazer`, ids de `pontos.json`), que aparecem quando o zoom deixa a área de lazer com ≥ 200 px de largura. Os lotes seguem coloridos por status em qualquer zoom.

`scripts/gerar_mapa_guia.py` gera a versão estática para compartilhar (`assets/mapa-guia.svg` e `assets/mapa-guia.png`, 2000×900), com legenda numerada e detalhe ampliado da área de lazer. Rode depois de `gerar_dados.py`.

## Experiência virtual (`tour/`, desde 26/09/2026)

Passeio pelo Haras "na pegada" dos tours 360° de empreendimentos, feito com **material real**: fotos e vídeo de drone (DJI Mini 2) de 24–25/09/2026.
Publicado em `…/haras-rio-sao-jose-mapa/tour/` e ligado ao app pelo menu ("Passeio virtual") e pelo botão da faixa de abertura.

| Arquivo | Papel |
|---|---|
| `tour/index.html`, `tour/tour.css`, `tour/tour.js` | A experiência: abertura com vídeo, visualizador (Photo Sphere Viewer 5.15.1 + three 0.185.1 via import map do jsDelivr, sem build), pontos de interesse, miniaturas, setas, passeio automático, tela cheia, "Voo pelo Haras", WhatsApp e link para o mapa de unidades. |
| `tour/cenas.json` | Cenas (texto, imagem, recorte, limites do olhar, pontos) e o voo. **Gerado** — não editar à mão. |
| `scripts/preparar_tour.py` | Lista de cenas (foto, horizonte, textos, pontos em pixels da foto) → reprojeta cada foto para um recorte esférico na geometria da câmera (73,7° × 45,7°, inclinação pelo horizonte) e grava `tour/img/*.jpg` + `tour/cenas.json`. |
| `tour/img/abertura.mp4`, `voo-1080.mp4`, `voo-720.mp4`, `voo.json` | Vídeo da abertura (volta na portaria) e o "Voo pelo Haras" (10 trechos do vídeo de 10 min, com capítulos). |

Como funciona: a foto do drone não é 360°, então ela vira um **recorte** da esfera e o olhar fica preso à área da foto (limites em `cenas.json`); arrastar dá a sensação de olhar em volta a partir do ponto em que o drone estava. **Quando houver fotos 360° de verdade** (modo Pano → Esfera do drone, arquivo equirretangular 2:1), basta incluir a cena no script com `esfera=True`: ela entra inteira, sem limites.

Atualizar: editar `CENAS` em `scripts/preparar_tour.py` → `python scripts/preparar_tour.py` → commit/push. Regras: só itens do contrato; nada de processo; nomes de clientes nunca.

### Tour 360° do alto (desde 26/09/2026, 2ª versão)
O tour abre em **esferas 360° completas vistas do alto** (5 pontos: portaria, centro, perto da preservação, lazer/lago e vista geral), giradas com o dedo como num tour de drone. Cada esfera é a maquete do Haras (mesma geometria da planta) renderizada por `render360.html` + `js/render360.js` (cubo 6×2048 → equirretangular 6144×3072), com **só as unidades à venda em verde**. Pontos de vista em `scripts/preparar_tour.py` (`PONTOS360`) → `tour/pontos360.json`.
- **Toque num lote**: o tour converte o toque (yaw/pitch) no ponto do chão, acha o lote em `data/lotes.json`, contorna em dourado e mostra área, medidas, "Quero este lote" (WhatsApp) e "Ver no mapa" (`../?lote=N`).
- **Fotos reais** (botão de câmera): galeria com as fotos do drone de set/2026. **Voo pelo Haras**: vídeo com capítulos.
- Regerar: `python scripts/servidor_render.py 8766` → `http://localhost:8766/render360.html` → console `await __r360.gerarTodas()` → `python scripts/preparar_tour.py`. Regerar sempre que a disponibilidade mudar (o verde é da data da geração).
- Quando houver **fotos 360° reais** (modo Esfera do drone), elas entram como cenas `esfera=True` no script.

### Som ambiente do tour (desde 26/09/2026)
Trilha de fundo em laço: cachoeira ao fundo, riacho, vento nas folhas, pássaros (sabiá, bem-te-vi, trinados, rolinha, piados) e música suave (acordes + kalimba). **Tudo sintetizado** por `scripts/gerar_som_ambiente.py` (sem gravação de terceiros, sem direito autoral) → `tour/audio/ambiente.mp3` (97 s, 128 kbps, 1,5 MB).
- Laço sem emenda: camadas periódicas em 96 s; o arquivo tem 0,5 s de margem de cada lado e o tour toca a janela 0,5–96,5 s (Web Audio, `loopStart/loopEnd`).
- Começa no toque em "Iniciar a experiência" (ou no primeiro toque, em link direto), com o volume subindo em 3 s; botão de alto-falante no topo liga/desliga (preferência guardada no aparelho); abaixa sozinho durante o "Voo pelo Haras" (que tem som próprio) e quando a aba sai da tela. No iPhone, toca mesmo com a chave de silencioso (`navigator.audioSession`, iOS 17+).
- Trocar o som: ajustar níveis/cantos no script → rodar → subir `?v=` de `SOM.url` em `tour/tour.js`.

### Filme de abertura com música (desde 26/09/2026)
Ao tocar em "Iniciar a experiência" roda um filme de 44,5 s (`tour/img/filme.mp4`, 12,8 MB) com trechos reais do voo (portaria → avenida → rede elétrica → rede de água → glebas → chácaras habitadas → portaria) e **trilha de natureza com música** (amanhecer com canarinhos → rio e bem-te-vi → cachoeira → chuva passando com trovão distante → passarada e melodia → resolução em Dó maior, o mesmo tom do som ambiente do tour), **composta e sintetizada** por `scripts/gerar_trilha_natureza.py` (versões anteriores: `gerar_musica_pagode.py` e `gerar_musica_caipira.py`) (sem direito autoral). O tour carrega por trás; botão "Pular"; no fim, o som ambiente do tour entra.
- As frases **não estão gravadas na imagem**: ficam em `FRASES` no `tour/tour.js` (tempos casados com as tomadas de `scripts/gerar_filme.py`), por cima do vídeo, para ficarem inteiras no celular em pé.
- Regerar: `python scripts/gerar_trilha_natureza.py && python scripts/gerar_filme.py` → subir `filme.mp4?v=` no `tour/index.html`. Mudar tomadas = ajustar `TOMADAS` e os tempos de `FRASES` juntos.
- As esferas do tour levam `?v=<data do arquivo>` (gerado por `preparar_tour.py`), para o verde novo aparecer sem cache depois de regerar.
