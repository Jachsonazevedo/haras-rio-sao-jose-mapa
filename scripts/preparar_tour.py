"""Prepara a experiência virtual (tour/) a partir das fotos reais de drone.

Cada foto (DJI Mini 2, FC7303: 4000×2250, lente de 24 mm equivalente → campo de 73,7° × 45,7°)
é reprojetada para um RECORTE equirretangular, na geometria certa da câmera (inclinação estimada
pelo horizonte). No visualizador (Photo Sphere Viewer) o cliente arrasta e "olha em volta" dentro
da vista do drone, como num tour 360°; os pontos de interesse são dados em pixels da foto original
e convertidos para yaw/pitch aqui.

Quando existir uma foto 360° de verdade (modo "Esfera" do drone, equirretangular 2:1), basta pôr
a cena com "esfera": True e o arquivo: ela entra inteira, sem recorte nem limites.

Uso: python scripts/preparar_tour.py   → grava tour/img/*.jpg e tour/cenas.json
"""
import json, math, os, sys
sys.path.insert(0, r"D:\Programas\pylibs")
import numpy as np, cv2

APP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAIDA = os.path.join(APP, "tour")
IMG = os.path.join(SAIDA, "img")
NOVAS = r"D:\Haras Rio São José\Auditoria conta Bradesco Jachson 23\Nova Adm Marcelo Julho 2026\Vendas Novas\Tour 360\Drive nuvemfotos46 - 26-09-2026"
ANTIGAS = r"D:\Haras Rio São José\Auditoria conta Bradesco Jachson 23\Novas Fotos drobre set 2024\HARAS -20240913T145041Z-001\HARAS"

HFOV = 73.74          # graus, 16:9 da FC7303
PPD = 36              # pixels por grau no recorte (360° → 12.960 px)
FUNDO = (39, 56, 24)  # BGR do verde da marca, fora da foto

# horizonte = fração da altura em que está a linha do horizonte (conferida à mão); inclinação = pitch fixo (fotos sem horizonte)
CENAS = [
    dict(id="portaria", foto=(NOVAS, "DJI_0650.JPG"), horizonte=0.42,
         sobre="Chegada", titulo="Portaria nova",
         texto="A entrada do Haras pela Estrada de Duas Vendas: guarita revitalizada, portões novos, muros e piso concretado. É por aqui que você chega à sua chácara.",
         pontos=[dict(x=2150, y=800, titulo="Guarita", texto="Guarita da portaria, reformada em 2026, com controle de acesso de veículos e pedestres.")]),
    dict(id="portaria-alto", foto=(NOVAS, "DJI_0653.JPG"), horizonte=0.07,
         sobre="Chegada", titulo="A portaria vista do alto",
         texto="Guarita, portões de entrada e saída, muros laterais e o acesso concretado. Ao fundo, as primeiras chácaras do empreendimento.",
         pontos=[dict(x=1930, y=1180, titulo="Guarita e portões", texto="Portão de entrada, portão de saída e guarita no meio: o acesso ao Haras é controlado."),
                 dict(x=430, y=930, titulo="Estrada de Duas Vendas", texto="Estrada de acesso, a menos de dez minutos do centro de Poções.")]),
    dict(id="vista-geral", foto=(NOVAS, "DJI_0656.JPG"), horizonte=0.08,
         sobre="O empreendimento", titulo="Avenidas e chácaras",
         texto="As avenidas cascalhadas cortam o Haras de ponta a ponta, com a rede elétrica ao lado. Várias famílias já construíram e moram nas suas chácaras.",
         pontos=[dict(x=2110, y=720, titulo="Avenida com rede elétrica", texto="Postes e rede elétrica ao longo das avenidas: 215 postes e 13 transformadores instalados."),
                 dict(x=930, y=575, titulo="Chácaras construídas", texto="Casas, pomares e cercas: o Haras já tem vida.")]),
    dict(id="avenida-rede", foto=(NOVAS, "DJI_0694.JPG"), horizonte=0.24,
         sobre="Infraestrutura", titulo="Rede elétrica nas avenidas",
         texto="A rede elétrica acompanha as avenidas do Haras. Ao lado da via, a vala com a tubulação da nova rede de água.",
         pontos=[dict(x=2110, y=720, titulo="Poste e transformador", texto="Rede elétrica instalada: 215 postes e 13 transformadores em todo o chacreamento."),
                 dict(x=1465, y=1500, titulo="Rede de água", texto="Tubulação da rede-tronco de água, instalada ao longo da avenida.")]),
    dict(id="rede-agua", foto=(NOVAS, "DJI_0669.JPG"), horizonte=0.24,
         sobre="Infraestrutura", titulo="Rede de água em implantação",
         texto="A tubulação azul é a rede-tronco de água, sendo enterrada ao longo das avenidas. O sistema tem poços, bombeamento solar e reservatórios.",
         pontos=[dict(x=2430, y=1465, titulo="Tubulação da rede-tronco", texto="Tubos da rede de água sendo instalados nas valas, pelas avenidas principais."),
                 dict(x=930, y=330, titulo="Rede elétrica", texto="Postes da rede elétrica ao longo da avenida.")]),
    dict(id="rua-agua", foto=(NOVAS, "DJI_0667.JPG"), horizonte=0.13,
         sobre="Infraestrutura", titulo="Água chegando às ruas",
         texto="A rede de água avança pelas ruas internas, ao lado das chácaras que já estão de pé.",
         pontos=[dict(x=1430, y=1600, titulo="Vala com a tubulação", texto="A rede de água passa pela rua; cada comprador faz o ramal até a sua chácara."),
                 dict(x=3430, y=750, titulo="Chácara construída", texto="Uma das chácaras já construídas no Haras.")]),
    dict(id="reservatorios", foto=(NOVAS, "DJI_0677.JPG"), horizonte=0.09,
         sobre="Infraestrutura", titulo="Reservatórios de água",
         texto="Reservatórios do sistema de água do Haras em construção, ao lado da avenida. O sistema prevê poços, bombeamento solar e 140 mil litros de reservação.",
         pontos=[dict(x=2570, y=1535, titulo="Reservatório em concreto", texto="Anel de concreto de um dos reservatórios do sistema de água, em construção."),
                 dict(x=2355, y=1070, titulo="Caixa d'água", texto="Caixa d'água do sistema, já no local, aguardando a instalação."),
                 dict(x=930, y=1750, titulo="Área do segundo reservatório", texto="Terreno escavado para o reservatório vizinho.")]),
    dict(id="chacaras", foto=(NOVAS, "DJI_0680.JPG"), horizonte=0.08,
         sobre="Vida no Haras", titulo="Chácaras de quem já mora aqui",
         texto="Casas, pomares, coqueiros e caixas d'água: é assim que as chácaras do Haras ganham vida. A sua pode ser a próxima.",
         pontos=[dict(x=535, y=1290, titulo="Chácara com casa e pomar", texto="Chácara construída, com casa, pomar e cerca."),
                 dict(x=3535, y=645, titulo="Mais vizinhos", texto="Casas já construídas ao longo da rua.")]),
    dict(id="glebas", foto=(NOVAS, "DJI_0687.JPG"), horizonte=0.10,
         sobre="O empreendimento", titulo="Glebas e a serra ao fundo",
         texto="As glebas demarcadas se estendem até a área de preservação ambiental. Ao fundo, a serra que emoldura Poções.",
         pontos=[dict(x=2430, y=575, titulo="Glebas demarcadas", texto="Lotes a partir de 2.000 m², em 57 glebas.")]),
    dict(id="cruzamento", foto=(NOVAS, "DJI_0697.JPG"), horizonte=0.14,
         sobre="O empreendimento", titulo="Cruzamento das avenidas",
         texto="Encontro das avenidas, com a rede elétrica e a mata nativa em volta. Terrenos amplos para a sua chácara rural.",
         pontos=[dict(x=1750, y=895, titulo="Rede elétrica", texto="A energia chega pelas avenidas até as ruas das glebas.")]),
    dict(id="lago", foto=(ANTIGAS, "DJI_0199.jpg"), inclinacao=-48.0,
         sobre="Natureza", titulo="Lago natural",
         texto="Um dos lagos naturais do Haras, cercado de vegetação. A área de preservação ambiental (Reserva Legal e APP) faz parte do empreendimento.",
         pontos=[]),
]


def ler(caminho):
    return cv2.imdecode(np.fromfile(caminho, np.uint8), cv2.IMREAD_COLOR)


def gravar(caminho, img, q=82):
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, q, cv2.IMWRITE_JPEG_PROGRESSIVE, 1])
    buf.tofile(caminho)


def img_para_esfera(x, y, W, H, f, p):
    """pixel da foto → (lon, lat) em graus; câmera inclinada p graus (negativo = para baixo)"""
    cx, cy = W / 2, H / 2
    vx, vy, vz = (x - cx) / f, -(y - cy) / f, 1.0
    pr = math.radians(p)
    # gira em torno do eixo x por +p (câmera → mundo)
    wy = vy * math.cos(pr) + vz * math.sin(pr)
    wz = -vy * math.sin(pr) + vz * math.cos(pr)
    n = math.sqrt(vx * vx + wy * wy + wz * wz)
    return math.degrees(math.atan2(vx, wz)), math.degrees(math.asin(wy / n))


def processar_esfera(c, im, nome):
    """foto 360° equirretangular 2:1: entra inteira (até 8192×4096); pontos em pixels da própria esfera"""
    H, W = im.shape[:2]
    if W > 8192: im = cv2.resize(im, (8192, 4096), interpolation=cv2.INTER_AREA); H, W = im.shape[:2]
    gravar(os.path.join(IMG, f"{c['id']}.jpg"), im, 80)
    gravar(os.path.join(IMG, f"{c['id']}-mini.jpg"), cv2.resize(im[H // 4: 3 * H // 4, :], (384, 216), interpolation=cv2.INTER_AREA), 78)
    pontos = [{"id": f"{c['id']}-{i}", "yaw": round(pt["x"] / W * 360 - 180, 2), "pitch": round(90 - pt["y"] / H * 180, 2), "titulo": pt["titulo"], "texto": pt["texto"]}
              for i, pt in enumerate(c.get("pontos", []))]
    return {"id": c["id"], "sobre": c["sobre"], "titulo": c["titulo"], "texto": c["texto"], "imagem": f"img/{c['id']}.jpg", "mini": f"img/{c['id']}-mini.jpg",
            "esfera": True, "inicio": {"yaw": c.get("yaw_inicial", 0), "pitch": c.get("pitch_inicial", -10)}, "fonte": nome, "inclinacao": 0.0,
            "pano": {"croppedWidth": W, "croppedHeight": H, "croppedX": 0, "croppedY": 0, "fullWidth": W, "fullHeight": H}, "limites": None, "pontos": pontos}


def processar(c):
    pasta, nome = c["foto"]
    im = ler(os.path.join(pasta, nome))
    if c.get("esfera"):
        return processar_esfera(c, im, nome)
    H, W = im.shape[:2]
    f = (W / 2) / math.tan(math.radians(HFOV / 2))
    p = c.get("inclinacao")
    if p is None:
        p = -math.degrees(math.atan((0.5 - c["horizonte"]) * H / f))
    # contorno da foto na esfera → caixa do recorte
    borda = [(x, 0) for x in np.linspace(0, W, 40)] + [(x, H) for x in np.linspace(0, W, 40)] + \
            [(0, y) for y in np.linspace(0, H, 24)] + [(W, y) for y in np.linspace(0, H, 24)]
    ll = [img_para_esfera(x, y, W, H, f, p) for x, y in borda]
    lon0, lon1 = min(a for a, _ in ll), max(a for a, _ in ll)
    lat0, lat1 = min(b for _, b in ll), max(b for _, b in ll)
    # área útil (retângulo dentro da foto): usada para limitar o olhar
    util_lon = min(abs(img_para_esfera(0, H / 2, W, H, f, p)[0]), abs(img_para_esfera(0, 0, W, H, f, p)[0]), abs(img_para_esfera(0, H, W, H, f, p)[0]))
    util_top = min(img_para_esfera(x, 0, W, H, f, p)[1] for x in (0, W / 2, W))
    util_bot = max(img_para_esfera(x, H, W, H, f, p)[1] for x in (0, W / 2, W))
    # grade do recorte equirretangular
    x0 = int(math.floor((lon0 + 180) * PPD)); x1 = int(math.ceil((lon1 + 180) * PPD))
    y0 = int(math.floor((90 - lat1) * PPD)); y1 = int(math.ceil((90 - lat0) * PPD))
    xs = (np.arange(x0, x1) + 0.5) / PPD - 180
    ys = 90 - (np.arange(y0, y1) + 0.5) / PPD
    LON, LAT = np.meshgrid(np.radians(xs), np.radians(ys))
    dx = np.cos(LAT) * np.sin(LON); dy = np.sin(LAT); dz = np.cos(LAT) * np.cos(LON)
    pr = math.radians(p)
    # mundo → câmera (gira por -p)
    cy_ = dy * math.cos(pr) - dz * math.sin(pr)
    cz_ = dy * math.sin(pr) + dz * math.cos(pr)
    with np.errstate(divide="ignore", invalid="ignore"):
        mx = (W / 2 + f * dx / cz_).astype(np.float32)
        my = (H / 2 - f * cy_ / cz_).astype(np.float32)
    mx[cz_ <= 0] = -1; my[cz_ <= 0] = -1
    rec = cv2.remap(im, mx, my, cv2.INTER_AREA if PPD < W / HFOV else cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=FUNDO)
    gravar(os.path.join(IMG, f"{c['id']}.jpg"), rec)
    mini = cv2.resize(im, (384, 216), interpolation=cv2.INTER_AREA)
    gravar(os.path.join(IMG, f"{c['id']}-mini.jpg"), mini, 78)
    pontos = []
    for i, pt in enumerate(c.get("pontos", [])):
        yaw, pitch = img_para_esfera(pt["x"], pt["y"], W, H, f, p)
        pontos.append({"id": f"{c['id']}-{i}", "yaw": round(yaw, 2), "pitch": round(pitch, 2), "titulo": pt["titulo"], "texto": pt["texto"]})
    return {
        "id": c["id"], "sobre": c["sobre"], "titulo": c["titulo"], "texto": c["texto"],
        "imagem": f"img/{c['id']}.jpg", "mini": f"img/{c['id']}-mini.jpg", "esfera": False,
        "pano": {"fullWidth": 360 * PPD, "fullHeight": 180 * PPD, "croppedWidth": x1 - x0, "croppedHeight": y1 - y0, "croppedX": x0, "croppedY": y0},
        "limites": {"yawMin": round(-util_lon, 2), "yawMax": round(util_lon, 2), "pitchMin": round(util_bot, 2), "pitchMax": round(util_top, 2)},
        "inicio": {"yaw": 0, "pitch": round(p, 2)},
        "fonte": nome, "inclinacao": round(p, 1),
        "pontos": pontos,
    }


# ---------------------------------------------------------------- esferas 360° da maquete (vista do alto)
# Coordenadas da planta (data/lotes.json, metros): x ao longo do Haras, z atravessado; alt = altura da câmera.
# yaw0/pitch0 = para onde a vista abre (graus; yaw 0 = direção -z, cresce para +x).
PONTOS360 = [
    dict(id="geral", x=1400, z=500, alt=1450, yaw0=90, pitch0=-90, largura=8144, sobre="Visão geral", titulo="O Haras inteiro, visto de cima",
         texto="Todo o empreendimento de uma vez: 57 glebas, as avenidas, a portaria e a área de preservação. Em verde, as unidades à venda. Aproxime com dois dedos (ou +), gire com o dedo e toque num lote para ver área e medidas."),
    dict(id="portaria", x=330, z=380, alt=95, yaw0=90, pitch0=-24, sobre="Chegada", titulo="Sobre a portaria",
         texto="Você está no alto, sobre a entrada do Haras. Gire com o dedo para olhar em volta e para baixo: em verde, as unidades à venda. Toque num lote para ver área e medidas."),
    dict(id="centro", x=1450, z=430, alt=300, yaw0=90, pitch0=-36, sobre="Vista aérea 360°", titulo="No meio das glebas",
         texto="O coração do Haras: avenidas, ruas e as glebas em volta. Em verde, as unidades à venda. Toque num lote para ver área e medidas."),
    dict(id="fundo", x=2550, z=470, alt=230, yaw0=90, pitch0=-28, sobre="Vista aérea 360°", titulo="Perto da área de preservação",
         texto="As últimas glebas, junto à área de preservação ambiental (Reserva Legal e APP)."),
    dict(id="lazer", x=90, z=830, alt=130, yaw0=-150, pitch0=-30, sobre="Vista aérea 360°", titulo="Área de lazer e lago",
         texto="A área de lazer prevista no contrato, na parte baixa da faixa, e o lago natural na ponta."),
]


def esfera_yp(cam, X, Z, Y=0.0):
    dx, dz, dy = X - cam["x"], Z - cam["z"], Y - cam["alt"]
    return round(math.degrees(math.atan2(dx, -dz)), 2), round(math.degrees(math.atan2(dy, math.hypot(dx, dz))), 2)


def cenas_360():
    d = json.load(open(os.path.join(APP, "data", "lotes.json"), encoding="utf-8"))
    cen = lambda P: (sum(q[0] for q in P) / len(P), sum(q[1] for q in P) / len(P))
    areas = {a["tipo"]: a for a in d["areas"]}
    lazer = {i["id"]: i["c"] for i in d["decor"]["lazer"]}
    # (título, texto, ponto no chão, foto real, vista 360° ligada)
    info = [
        ("Portaria", "Portaria revitalizada na entrada, pela Estrada de Duas Vendas. Foto real de set/2026.", d["meta"]["entrada"], "img/foto-portaria-alto.jpg", "portaria"),
        ("Área de lazer e lago", "Área de lazer prevista no contrato (salão, piscina, quiosques, quadra de areia, banheiros, baias e fazendinha) e o lago natural na ponta. Foto real do lago.", lazer.get("salao"), "img/foto-lago.jpg", "lazer"),
        ("Área de preservação", "Reserva Legal e APP, preservadas.", cen(areas["reserva"]["poly"]), None, "fundo"),
    ]
    cenas = []
    for p in PONTOS360:
        img = os.path.join(IMG, f"esfera-{p['id']}.jpg")
        if not os.path.exists(img):
            print("  (sem esfera ainda)", p["id"]); continue
        pts = []
        for i, (tit, tx, c, foto, vista) in enumerate(info):
            if not c: continue
            yaw, pitch = esfera_yp(p, c[0], c[1])
            extra = {}
            if foto: extra["foto"] = foto
            if vista and vista != p["id"]: extra["cena"] = f"360-{vista}"
            pts.append({"id": f"{p['id']}-i{i}", "tipo": "info", "yaw": yaw, "pitch": pitch, "titulo": tit, "texto": tx, **extra})
        for q in PONTOS360:
            # setas só para as vistas que não têm ponto próprio (centro); as outras abrem pelo ponto (Portaria, Área de lazer, Área de preservação)
            if q is p or q["id"] != "centro" or p["id"] == "geral": continue   # na vista geral, a seta cobriria o mapa
            yaw, pitch = esfera_yp(p, q["x"], q["z"])
            pts.append({"id": f"{p['id']}-ir-{q['id']}", "tipo": "cena", "cena": f"360-{q['id']}", "yaw": yaw, "pitch": pitch, "titulo": q["titulo"], "texto": ""})
        cenas.append({"id": f"360-{p['id']}", "sobre": p["sobre"], "titulo": p["titulo"], "texto": p["texto"], "esfera": True,
                      "imagem": f"img/esfera-{p['id']}.jpg", "mini": f"img/esfera-{p['id']}-mini.jpg",
                      "camera": {"x": p["x"], "z": p["z"], "alt": p["alt"]}, "inicio": {"yaw": p["yaw0"], "pitch": p["pitch0"]},
                      "limites": None, "pontos": pts})
    return cenas


def fotos_reais():
    """fotos reais do drone para a galeria (1600 px, sem recorte)"""
    fotos = []
    for c in CENAS:
        pasta, nome = c["foto"]
        im = ler(os.path.join(pasta, nome)); h, w = im.shape[:2]
        im = cv2.resize(im, (1600, int(h * 1600 / w)), interpolation=cv2.INTER_AREA)
        gravar(os.path.join(IMG, f"foto-{c['id']}.jpg"), im, 82)
        fotos.append({"id": c["id"], "imagem": f"img/foto-{c['id']}.jpg", "titulo": c["titulo"], "texto": c["texto"], "sobre": c["sobre"]})
    return fotos


def main():
    os.makedirs(IMG, exist_ok=True)
    json.dump([{**{k: p[k] for k in ("id", "x", "z", "alt", "yaw0", "pitch0")}, "largura": p.get("largura", 6144)} for p in PONTOS360],
              open(os.path.join(SAIDA, "pontos360.json"), "w", encoding="utf-8"), indent=1)
    cenas = cenas_360()
    fotos = fotos_reais()
    print(f"esferas: {len(cenas)} | fotos reais: {len(fotos)}")
    voo_arq = os.path.join(SAIDA, "voo.json")
    voo = json.load(open(voo_arq, encoding="utf-8")) if os.path.exists(voo_arq) else None
    json.dump({"versao": 2, "whatsapp": "5511991468192", "voo": voo, "cenas": cenas, "fotos": fotos}, open(os.path.join(SAIDA, "cenas.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("ok:", len(cenas), "cenas")


if __name__ == "__main__":
    main()
