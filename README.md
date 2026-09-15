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
- Lotes 267, 269 e 470 (reservas técnicas) e os lotes listados em `reserva_estrategica.txt` (reserva estratégica, 30 unidades) → **reservado**
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
