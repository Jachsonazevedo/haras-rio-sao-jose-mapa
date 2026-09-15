# Mapa do Haras Rio São José

App web estático (HTML + CSS + JavaScript puro, sem build e sem dependências além das Google Fonts) que mostra o mapa das unidades do chacreamento **Haras Rio São José** (Poções/BA): 654 unidades em 57 glebas, com destaque para as **disponíveis**, busca por número, painel com área/medidas/status, botão de WhatsApp e link compartilhável por lote.

Feito para o corretor e para o cliente consultarem rapidamente qualquer lote — inclusive no celular.

## Estrutura

```
haras-mapa-app/
├── index.html          # página única
├── css/styles.css      # estilos (identidade visual, mobile-first)
├── js/app.js           # mapa SVG, pan/zoom, busca, painel, deep link, compartilhar
├── data/lotes.json     # DADOS (glebas, lotes, vias, áreas) — hoje é um EXEMPLO com 12 lotes
├── assets/             # logo.png, drone.mp4, drone-poster.jpg (colocar aqui)
├── .nojekyll           # impede o GitHub Pages de processar a pasta com Jekyll
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

## Como atualizar os dados (`data/lotes.json`)

Substitua o arquivo `data/lotes.json` por um novo com o **mesmo formato** e publique (commit + push). Não é preciso mexer em mais nada.

Formato:

```json
{
  "meta": {
    "gerado_em": "2026-09-15T12:00:00",
    "fonte": "Planilha Mestre 01/09/2026",
    "unidade": "m",
    "bbox": [0, 0, 2100, 700],
    "total": 654, "disponiveis": 157, "vendidos": 464, "reservados": 33,
    "preco_m2": 27.5,
    "whatsapp": "5577999999999"
  },
  "glebas": [ { "id": "01", "poly": [[x,y], ...], "label": [x,y], "lotes": ["001","002"] } ],
  "lotes":  [ { "id": "001", "gleba": "01", "poly": [[x,y], ...], "c": [x,y], "area": 3594.79,
                "frente": 82.37, "fundo": 4.62, "esq": 87.52, "dir": 97.63, "status": "disponivel" } ],
  "vias":   [ [[x,y], [x,y], ...] ],
  "areas":  [ { "tipo": "reserva", "nome": "Reserva legal", "poly": [[x,y], ...] } ]
}
```

Regras:

- Coordenadas em **metros**, num plano local: `x` cresce para a direita, `y` cresce **para baixo** (como no SVG).
- `meta.bbox` = `[minx, miny, maxx, maxy]`. Se faltar ou for inválido, o app calcula a partir dos polígonos.
- `status` deve ser `"disponivel"`, `"vendido"` ou `"reservado"`. Reserva técnica e reserva estratégica entram como `"reservado"`.
  Qualquer valor desconhecido é tratado como **reservado** (nunca como disponível).
- `meta.preco_m2` pode ser `null`. Se for número, o painel mostra "Valor de referência" = área × preço, com a nota "sujeito a confirmação".
- `meta.whatsapp` no formato E.164 sem `+` (ex.: `5577999999999`). Se vier vazio/`null`, o botão de WhatsApp não aparece.
- A legenda exibe a contagem **real** do array `lotes`; se `meta.disponiveis/vendidos/reservados/total` divergirem, o app avisa no console do navegador (F12).
- `c` (centro do lote) e `label` (posição do rótulo da gleba) são opcionais — o app usa o centroide do polígono quando faltam.
- `vias` são polilinhas (linhas de centro); `areas.tipo` pode ser `reserva`, `area_comum` ou `lazer` (todas desenhadas com hachura leve).
- **Nenhum dado pessoal** deve entrar no JSON (sem nomes de compradores).

Para conferir se o JSON está válido antes de publicar:

```
python -c "import json;json.load(open('data/lotes.json', encoding='utf-8'));print('ok')"
```

## Como atualizar os assets

Coloque os arquivos na pasta `assets/` com exatamente estes nomes:

| Arquivo | Uso | Observações |
|---|---|---|
| `assets/logo.png` | Logo no cabeçalho e favicon | PNG com fundo transparente, ~200×200 px |
| `assets/drone.mp4` | Vídeo da seção "Veja do alto" | MP4 (H.264/AAC), de preferência até ~20 MB; sem áudio necessário (o player inicia mudo) |
| `assets/drone-poster.jpg` | Imagem de capa do vídeo | JPG 1600×900 px aprox. |

Se algum arquivo faltar, o app continua funcionando: o logo some, e a seção de vídeo mostra "Vídeo em breve." sem quebrar o layout.

## Uso

- **Arrastar** move o mapa; **roda do mouse** ou **pinça** dá zoom; botões **+**, **−** e **Ver tudo** no canto.
- **Clique/toque** num lote abre o painel com número, gleba, status, área, medidas, valor de referência, WhatsApp e Compartilhar.
- **Busca** no topo aceita `12`, `012` ou `lote 12`.
- **Só disponíveis** esmaece vendidos e reservados.
- **Link direto**: `...?lote=123` abre o app já centralizado no lote 123 com o painel aberto (é esse link que o botão Compartilhar copia/envia).
- **Esc** fecha o painel. No celular, puxe o painel para baixo para fechar.

## Regras de conteúdo

- Usar sempre "chacreamento", "unidade", "lote", "gleba", "fração" — nunca a palavra vetada pelo jurídico (a que começa com "lotea…").
- O app não promete infraestrutura; mostra apenas mapa, medidas e status.
- Rodapé fixo: "Medidas conforme memorial descritivo. Disponibilidade sujeita a confirmação. Imagens ilustrativas."
