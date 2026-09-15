# -*- coding: utf-8 -*-
"""Gera o MAPA-GUIA ilustrado (estilo parque, 2,5D) do Haras Rio São José a partir de data/lotes.json.

Saída: assets/mapa-guia.svg (vetorial, usado na página) — a mesma geometria real do mapa interativo,
desenhada em projeção oblíqua com relevo, árvores, placas de avenidas/ruas, ícones das áreas comuns
e legenda numerada. Roda sozinho: python scripts/gerar_mapa_guia.py
"""
import sys, os, json, math, random
sys.path.insert(0, r"D:\Programas\pylibs"); sys.stdout.reconfigure(encoding="utf-8")
import numpy as np, cv2

APP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
J = json.load(open(os.path.join(APP, "data", "lotes.json"), encoding="utf-8"))
PONTOS = json.load(open(os.path.join(APP, "pontos.json"), encoding="utf-8"))
OUT = os.path.join(APP, "assets", "mapa-guia.svg")
random.seed(7)

# ------------------------------------------------------------------ paleta
VERDE = "#183827"; VERDE_M = "#24513A"; MARFIM = "#FDFAF2"; DOURADO = "#C8A86B"; DOURADO_F = "#b8944f"
MADEIRA = "#6A3C25"; TERRACOTA = "#A74726"
CHAO_A, CHAO_B, CHAO_LADO, CHAO_BORDA = "#A7CF86", "#8FBE6C", "#587A3B", "#5E8A44"
LOTE_A, LOTE_B, LOTE_TRACO = "#CBE3A8", "#C0DC9B", "#FFFFFF"
MATA, MATA_BORDA = "#7BAD5C", "#5E8A44"
AREIA, AREIA_BORDA = "#F0E4C3", "#D8C69A"
VIA, VIA_BORDA, VIA_EIXO = "#EFE2BF", "#CDB98F", "#FFFFFF"
ESTRADA, ESTRADA_BORDA = "#D6D2C8", "#B9B4A8"
AGUA, AGUA_CLARA = "#5BB4D8", "#9FD6EA"

# ------------------------------------------------------------------ projeção oblíqua (2,5D)
W, H = 2000, 900
SH, YF = 0.26, 0.74                       # cisalhamento em x e achatamento em y
xs = [p[0] for a in J["areas"] for p in a["poly"]] + [p[0] for l in J["lotes"] for p in l["poly"]]
ys = [p[1] for a in J["areas"] for p in a["poly"]] + [p[1] for l in J["lotes"] for p in l["poly"]]
MINX, MAXX, MINY, MAXY = min(xs), max(xs), min(ys), max(ys)
S = (W - 130) / ((MAXX - MINX) + SH * (MAXY - MINY))
OX = 70 - S * (MINX + SH * MINY)
OY = 128 - S * YF * MINY
def P(p):  # mundo (m) -> tela (px)
    return (OX + S * (p[0] + SH * p[1]), OY + S * YF * p[1])
def pts(poly): return " ".join(f"{x:.1f},{y:.1f}" for x, y in (P(p) for p in poly))
def f(v): return f"{v:.1f}"

# ------------------------------------------------------------------ chão: união de tudo, fechada
R = 1.0  # 1 px = 1 m no raster auxiliar
ox, oy = int(MINX) - 60, int(MINY) - 60
RW, RH = int(MAXX - MINX) + 120, int(MAXY - MINY) + 120
mask = np.zeros((RH, RW), np.uint8)
def raster(poly, val=255):
    cv2.fillPoly(mask, [np.array([[p[0] - ox, p[1] - oy] for p in poly], np.int32)], val)
for l in J["lotes"]: raster(l["poly"])
for a in J["areas"]: raster(a["poly"])
mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((41, 41), np.uint8))
cs, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
chao = cv2.approxPolyDP(max(cs, key=cv2.contourArea), 6, True)
CHAO = [[float(q[0][0]) + ox, float(q[0][1]) + oy] for q in chao]
chao_np = np.array([[p[0], p[1]] for p in CHAO], np.float32)
def dentro(poly_np, p): return cv2.pointPolygonTest(poly_np, (float(p[0]), float(p[1])), False) >= 0

areas = {a["tipo"]: a for a in J["areas"]}
reserva = areas["reserva"]; clube = areas["clube"]; verde = areas.get("area_comum")
res_np = np.array(reserva["poly"], np.float32); clu_np = np.array(clube["poly"], np.float32)
lot_np = [np.array(l["poly"], np.float32) for l in J["lotes"]]

def centroide(poly):
    a = cx = cy = 0.0
    for i in range(len(poly)):
        x0, y0 = poly[i]; x1, y1 = poly[(i + 1) % len(poly)]
        c = x0 * y1 - x1 * y0; a += c; cx += (x0 + x1) * c; cy += (y0 + y1) * c
    if abs(a) < 1e-6: return [sum(p[0] for p in poly) / len(poly), sum(p[1] for p in poly) / len(poly)]
    return [cx / (3 * a), cy / (3 * a)]

def along(pl, frac):
    """ponto e direção (unitária, em tela) a uma fração do comprimento de uma polilinha (mundo)."""
    segs = [(pl[i], pl[i + 1], math.dist(pl[i], pl[i + 1])) for i in range(len(pl) - 1)]
    total = sum(s[2] for s in segs); alvo = frac * total; acc = 0
    for a, b, d in segs:
        if acc + d >= alvo:
            t = (alvo - acc) / d if d else 0
            p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
            pa, pb = P(a), P(b); dx, dy = pb[0] - pa[0], pb[1] - pa[1]; n = math.hypot(dx, dy) or 1
            return P(p), (dx / n, dy / n)
        acc += d
    return P(pl[-1]), (1, 0)

# ------------------------------------------------------------------ SVG
o = []
o.append(f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 {W} {H}" width="{W}" height="{H}" font-family="\'Segoe UI\', Inter, Arial, sans-serif">')
o.append(f'''<title>Mapa-guia ilustrado do Chacreamento Haras Rio São José</title>
<defs>
  <linearGradient id="chao" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{CHAO_A}"/><stop offset="1" stop-color="{CHAO_B}"/></linearGradient>
  <linearGradient id="ceu" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FDFAF2"/><stop offset="1" stop-color="#F3EEDF"/></linearGradient>
  <filter id="blur" x="-10%" y="-10%" width="120%" height="140%"><feGaussianBlur stdDeviation="9"/></filter>
  <filter id="sombra" x="-30%" y="-30%" width="160%" height="180%"><feDropShadow dx="0" dy="2" stdDeviation="1.6" flood-color="#000" flood-opacity=".28"/></filter>
  <filter id="sombra-pin" x="-50%" y="-50%" width="200%" height="220%"><feDropShadow dx="0" dy="3" stdDeviation="2.2" flood-color="#000" flood-opacity=".32"/></filter>
  <g id="arv1"><ellipse cx="2" cy="4" rx="9" ry="3.2" fill="#000" opacity=".16"/><rect x="-1.2" y="-2" width="2.4" height="6" fill="#6A3C25"/><circle cx="0" cy="-5" r="7.5" fill="#4E8A3C"/><circle cx="-2.4" cy="-7" r="4.6" fill="#6DAA55"/></g>
  <g id="arv2"><ellipse cx="2" cy="4" rx="8" ry="3" fill="#000" opacity=".16"/><rect x="-1.2" y="-2" width="2.4" height="6" fill="#6A3C25"/><circle cx="0" cy="-5" r="6.5" fill="#3F7A33"/><circle cx="-2" cy="-7" r="4" fill="#5C9A48"/></g>
  <g id="arv3"><ellipse cx="2" cy="4" rx="9" ry="3.2" fill="#000" opacity=".16"/><rect x="-1.2" y="-2" width="2.4" height="6" fill="#6A3C25"/><circle cx="0" cy="-5" r="7" fill="#5E9A44"/><circle cx="-2.4" cy="-7.4" r="4.4" fill="#86BE66"/></g>
  <g id="pin"><path d="M0 0 L-6 -12 H6 Z" fill="{DOURADO_F}"/><circle cx="0" cy="-24" r="15" fill="{DOURADO}" stroke="{MARFIM}" stroke-width="2.6"/></g>
</defs>
<rect width="{W}" height="{H}" fill="url(#ceu)"/>''')

# --- estrada externa (Estrada de Duas Vendas) chegando à portaria
ent = J["meta"]["entrada"]
acesso = next(v for v in J["vias"] if v["tipo"] == "acesso")
ext = [[ent[0] - 520, ent[1] + 150], [ent[0] - 260, ent[1] + 70], ent]
o.append(f'<polyline points="{pts(ext)}" fill="none" stroke="{ESTRADA_BORDA}" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>')
o.append(f'<polyline points="{pts(ext)}" fill="none" stroke="{ESTRADA}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>')
o.append(f'<polyline points="{pts(ext)}" fill="none" stroke="#fff" stroke-width="1.4" stroke-dasharray="9 8" stroke-linecap="round" stroke-linejoin="round"/>')

# --- chão com sombra e relevo
o.append(f'<polygon points="{pts(CHAO)}" transform="translate(16 34)" fill="#2b3d1f" opacity=".22" filter="url(#blur)"/>')
o.append(f'<polygon points="{pts(CHAO)}" transform="translate(0 22)" fill="{CHAO_LADO}"/>')
o.append(f'<polygon points="{pts(CHAO)}" fill="url(#chao)" stroke="{CHAO_BORDA}" stroke-width="2" stroke-linejoin="round"/>')

# --- áreas
o.append(f'<polygon points="{pts(reserva["poly"])}" fill="{MATA}" stroke="{MATA_BORDA}" stroke-width="1.5" stroke-linejoin="round"/>')
o.append(f'<polygon points="{pts(clube["poly"])}" fill="{AREIA}" stroke="{AREIA_BORDA}" stroke-width="1.5" stroke-linejoin="round"/>')
if verde: o.append(f'<polygon points="{pts(verde["poly"])}" fill="#B6D896" stroke="{MATA_BORDA}" stroke-width="1" stroke-linejoin="round"/>')

# --- lotes e glebas
o.append(f'<g stroke="{LOTE_TRACO}" stroke-width=".7" stroke-opacity=".85" stroke-linejoin="round">')
for l in J["lotes"]:
    fill = LOTE_A if int(l["gleba"]) % 2 else LOTE_B
    o.append(f'<polygon points="{pts(l["poly"])}" fill="{fill}"/>')
o.append('</g>')

# --- vias
vias = J["vias"]
def via_w(t): return {"avenida": 14, "rua": 9, "acesso": 10}[t] * S
o.append('<g fill="none" stroke-linecap="round" stroke-linejoin="round">')
for v in vias: o.append(f'<polyline points="{pts(v["pts"])}" stroke="{VIA_BORDA}" stroke-width="{f(via_w(v["tipo"]) + 2.4)}"/>')
for v in vias: o.append(f'<polyline points="{pts(v["pts"])}" stroke="{VIA}" stroke-width="{f(via_w(v["tipo"]))}"/>')
for v in vias:
    if v["tipo"] == "avenida": o.append(f'<polyline points="{pts(v["pts"])}" stroke="{VIA_EIXO}" stroke-width="1.2" stroke-dasharray="8 7" opacity=".9"/>')
o.append('</g>')

# --- números das glebas
o.append(f'<g font-weight="700" font-size="10.5" text-anchor="middle" fill="{VERDE}">')
for g in J["glebas"]:
    c = P(g.get("label") or centroide(g["poly"]))
    o.append(f'<circle cx="{f(c[0])}" cy="{f(c[1])}" r="8.6" fill="#fff" fill-opacity=".92" stroke="{CHAO_BORDA}" stroke-width=".8"/><text x="{f(c[0])}" y="{f(c[1] + 3.7)}">{g["id"]}</text>')
o.append('</g>')

# --- árvores: reserva (densas), borda do imóvel e clube (esparsas)
arvores = []
def semear(poly_np, bbox, passo, jitter, n_max, evitar_lotes=False):
    x0, y0, x1, y1 = bbox; out = []
    for gy in np.arange(y0, y1, passo):
        for gx in np.arange(x0, x1, passo):
            p = (gx + random.uniform(-jitter, jitter), gy + random.uniform(-jitter, jitter))
            if not dentro(poly_np, p): continue
            if evitar_lotes and any(dentro(ln, p) for ln in lot_np): continue
            out.append(p)
    random.shuffle(out); return out[:n_max]
rb = reserva["poly"]; rbb = (min(p[0] for p in rb), min(p[1] for p in rb), max(p[0] for p in rb), max(p[1] for p in rb))
arvores += semear(res_np, rbb, 27, 9, 700)
# borda: ao longo do contorno do chão, fora dos lotes/vias
for i in range(len(CHAO)):
    a, b = CHAO[i], CHAO[(i + 1) % len(CHAO)]; d = math.dist(a, b)
    for t in np.arange(0, d, 34):
        p = (a[0] + (b[0] - a[0]) * t / d + random.uniform(-9, 9), a[1] + (b[1] - a[1]) * t / d + random.uniform(-9, 9))
        if dentro(res_np, p) or dentro(clu_np, p): continue
        if any(dentro(ln, p) for ln in lot_np): continue
        if math.dist(p, ent) < 60: continue
        arvores.append(p)
# clube: algumas árvores no entorno
cb = clube["poly"]; cbb = (min(p[0] for p in cb), min(p[1] for p in cb), max(p[0] for p in cb), max(p[1] for p in cb))
arvores += semear(clu_np, cbb, 60, 14, 26)

# --- ícones das áreas comuns (posições dentro do clube, em grade)
def grade_no_clube():
    """candidatos no interior do clube (>= 16 m da borda) e escolha gulosa dos mais afastados entre si."""
    cand = []
    for gy in np.arange(cbb[1] + 10, cbb[3], 12):
        for gx in np.arange(cbb[0] + 10, cbb[2], 12):
            d = cv2.pointPolygonTest(clu_np, (float(gx), float(gy)), True)
            if d >= 16: cand.append((float(gx), float(gy), d))
    cand.sort(key=lambda q: -q[2])
    esc = [cand[0][:2]]
    while len(esc) < 7 and cand:
        melhor = max(cand, key=lambda q: min(math.dist(q[:2], e) for e in esc) + q[2] * .35)
        esc.append(melhor[:2])
    esc.sort(key=lambda q: (q[1], q[0]))
    return esc
cels = grade_no_clube()
ordem_clube = ["salao", "piscina", "quiosques", "banheiros", "quadra", "baias", "fazendinha"]
pos = {k: cels[i % len(cels)] for i, k in enumerate(ordem_clube)}
pos["guarita"] = tuple(ent)
pos["reserva"] = tuple(centroide(reserva["poly"]))
# árvores não podem ficar em cima dos ícones
arvores = [p for p in arvores if all(math.dist(p, q) > 48 for q in pos.values())]
arvores.sort(key=lambda p: P(p)[1])
o.append('<g>')
for p in arvores:
    x, y = P(p); k = random.choice(["arv1", "arv2", "arv3"]); sc = random.uniform(.85, 1.25)
    o.append(f'<use href="#{k}" transform="translate({f(x)} {f(y)}) scale({sc:.2f})"/>')
o.append('</g>')

def icone(tipo, x, y):
    """ícones simples, em px de tela, ancorados no ponto (x, y) = base do objeto."""
    g = [f'<g transform="translate({f(x)} {f(y)})" filter="url(#sombra)">']
    if tipo == "salao":
        g.append(f'<rect x="-24" y="-16" width="48" height="18" fill="#F3EAD4" stroke="#8A6A45" stroke-width="1"/><polygon points="-27,-16 0,-30 27,-16" fill="{TERRACOTA}"/><rect x="-5" y="-9" width="10" height="11" fill="{MADEIRA}"/><rect x="-18" y="-11" width="7" height="6" fill="#B9D5E6"/><rect x="11" y="-11" width="7" height="6" fill="#B9D5E6"/>')
    elif tipo == "piscina":
        g.append(f'<rect x="-30" y="-16" width="60" height="30" rx="10" fill="#F8F1DC" stroke="#D8C69A" stroke-width="1"/><rect x="-25" y="-11" width="50" height="20" rx="8" fill="{AGUA}"/><path d="M-17 -3 q4 -3 8 0 t8 0 t8 0" fill="none" stroke="{AGUA_CLARA}" stroke-width="1.6" stroke-linecap="round"/><path d="M-15 4 q4 -3 8 0 t8 0 t8 0" fill="none" stroke="{AGUA_CLARA}" stroke-width="1.6" stroke-linecap="round"/>')
    elif tipo == "quiosques":
        for dx in (-20, 0, 20):
            g.append(f'<rect x="{dx - .8}" y="-8" width="1.6" height="10" fill="{MADEIRA}"/><path d="M{dx - 10} -8 L{dx} -18 L{dx + 10} -8 Z" fill="{DOURADO}" stroke="{MADEIRA}" stroke-width=".8"/>')
    elif tipo == "banheiros":
        g.append(f'<rect x="-15" y="-11" width="30" height="13" fill="#F3EAD4" stroke="#8A6A45" stroke-width="1"/><polygon points="-17,-11 0,-19 17,-11" fill="{MADEIRA}"/><rect x="-9" y="-7" width="5" height="9" fill="{VERDE_M}"/><rect x="4" y="-7" width="5" height="9" fill="{TERRACOTA}"/>')
    elif tipo == "quadra":
        g.append(f'<rect x="-24" y="-14" width="48" height="26" rx="3" fill="#EBD59A" stroke="#fff" stroke-width="1.5"/><line x1="0" y1="-14" x2="0" y2="12" stroke="#fff" stroke-width="1.2"/><circle cx="0" cy="-1" r="5" fill="none" stroke="#fff" stroke-width="1.2"/>')
    elif tipo == "baias":
        g.append(f'<rect x="-30" y="-12" width="34" height="13" fill="#E4CFA8" stroke="#8A6A45" stroke-width="1"/><polygon points="-32,-12 -13,-20 6,-12" fill="{MADEIRA}"/><line x1="-22" y1="-12" x2="-22" y2="1" stroke="#8A6A45" stroke-width=".8"/><line x1="-13" y1="-12" x2="-13" y2="1" stroke="#8A6A45" stroke-width=".8"/><line x1="-4" y1="-12" x2="-4" y2="1" stroke="#8A6A45" stroke-width=".8"/><ellipse cx="20" cy="-3" rx="12" ry="8" fill="#D9C39A" stroke="#8A6A45" stroke-width="1.4" stroke-dasharray="2.5 2"/>')
    elif tipo == "fazendinha":
        g.append(f'<rect x="-24" y="-13" width="48" height="24" rx="2" fill="#D3E5A8" stroke="#8A6A45" stroke-width="1.4" stroke-dasharray="3 2.2"/><circle cx="-12" cy="-4" r="2.4" fill="#fff" stroke="#8A6A45" stroke-width=".6"/><circle cx="-2" cy="3" r="2.4" fill="#fff" stroke="#8A6A45" stroke-width=".6"/><circle cx="10" cy="-3" r="2.2" fill="#E8C7A0" stroke="#8A6A45" stroke-width=".6"/><circle cx="14" cy="5" r="2" fill="#fff" stroke="#8A6A45" stroke-width=".6"/>')
    elif tipo == "guarita":
        g.append(f'<rect x="-16" y="-14" width="9" height="16" fill="#F3EAD4" stroke="#8A6A45" stroke-width="1"/><rect x="7" y="-14" width="9" height="16" fill="#F3EAD4" stroke="#8A6A45" stroke-width="1"/><rect x="-20" y="-20" width="40" height="7" rx="1.5" fill="{TERRACOTA}"/><line x1="-6" y1="-6" x2="6" y2="-6" stroke="{VERDE}" stroke-width="2" stroke-linecap="round"/>')
    g.append('</g>')
    return "".join(g)

# --- rótulos e placas
def placa_av(nome, x, y, dirx, acima=True, seta="→"):
    txt = f'{nome.upper()}  {seta}' if seta == "→" else f'{seta}  {nome.upper()}'
    w = 11 + len(txt) * 6.9; h = 22
    yy = y - 38 if acima else y + 58
    return (f'<g filter="url(#sombra)"><line x1="{f(x)}" y1="{f(y)}" x2="{f(x)}" y2="{f(yy)}" stroke="{MADEIRA}" stroke-width="2"/>'
            f'<rect x="{f(x - w / 2)}" y="{f(yy - h / 2)}" width="{f(w)}" height="{h}" rx="5" fill="{VERDE}" stroke="{DOURADO}" stroke-width="1.2"/>'
            f'<text x="{f(x)}" y="{f(yy + 4)}" font-size="11.5" font-weight="700" fill="#fff" text-anchor="middle" letter-spacing=".08em">{txt}</text></g>')
def placa_rua(nome, x, y, acima=True):
    w = 12 + len(nome) * 6.2; h = 16; yy = y - 16 if acima else y + 16
    return (f'<g><rect x="{f(x - w / 2)}" y="{f(yy - h / 2)}" width="{f(w)}" height="{h}" rx="3.5" fill="#fff" stroke="{VERDE}" stroke-width="1"/>'
            f'<text x="{f(x)}" y="{f(yy + 3.6)}" font-size="9.6" font-weight="700" fill="{VERDE}" text-anchor="middle" letter-spacing=".04em">{nome.upper()}</text></g>')
def rotulo(txt, x, y, size=13, cor=VERDE, italic=True, peso="600", fundo=True):
    w = len(txt) * size * .56 + 18
    r = ""
    if fundo: r += f'<rect x="{f(x - w / 2)}" y="{f(y - size * .8)}" width="{f(w)}" height="{f(size * 1.6)}" rx="{f(size * .8)}" fill="{MARFIM}" fill-opacity=".9" stroke="{CHAO_BORDA}" stroke-width=".8"/>'
    r += f'<text x="{f(x)}" y="{f(y + size * .36)}" font-family="Georgia, \'Times New Roman\', serif" font-style="{"italic" if italic else "normal"}" font-size="{size}" font-weight="{peso}" fill="{cor}" text-anchor="middle">{txt}</text>'
    return r

for v in vias:
    if v["tipo"] == "avenida":
        acima = "Pau Ferro" in v["nome"]
        seta = "→" if acima else "←"
        ruas_x = [P(max(r["pts"], key=lambda q: q[1]))[0] for r in vias if r["tipo"] == "rua"]
        for fr in (0.16, 0.5, 0.84):
            (x, y), _ = along(v["pts"], fr)
            if not acima:  # placas de baixo: desvia das placas de rua
                for _ in range(12):
                    if all(abs(x - rx_) > 34 for rx_ in ruas_x): break
                    fr += 0.025; (x, y), _ = along(v["pts"], fr)
            o.append(placa_av(v["nome"].replace("Avenida", "Av."), x, y, 1, acima=acima, seta=seta))
    elif v["tipo"] == "rua":
        topo = min(v["pts"], key=lambda p: p[1]); base = max(v["pts"], key=lambda p: p[1])
        x, y = P(topo); o.append(placa_rua(v["nome"], x, y - 2, acima=True))
        x, y = P(base); o.append(placa_rua(v["nome"], x, y + 2, acima=False))

# estrada externa: rótulo + placa de direção
ex, ey = P(ext[0]); o.append(rotulo("Estrada de Duas Vendas · km 4,5", ex + 70, ey + 30, 11.5, cor=MADEIRA, italic=False))
o.append(f'<g filter="url(#sombra)" transform="translate({f(ex + 40)} {f(ey - 46)})"><line x1="0" y1="0" x2="0" y2="40" stroke="{MADEIRA}" stroke-width="2.2"/><path d="M-4 -12 H70 L82 0 L70 12 H-4 Z" fill="#2F5C8F"/><text x="34" y="4" font-size="11" font-weight="700" fill="#fff" text-anchor="middle">POÇÕES</text></g>')
# reserva
rx, ry = P(pos["reserva"]); o.append(rotulo("Área de Preservação Ambiental", rx, ry + 44, 14))
o.append(rotulo("Reserva Legal e APP · caça, pesca e captação de água proibidas", rx, ry + 66, 9.5, cor="#3E5C43", italic=False, peso="500"))
# clube
cx_, cy_ = P(centroide(clube["poly"]))
# portaria
gx, gy = P(pos["guarita"]); o.append(rotulo("Portaria · Entrada", gx - 78, gy + 26, 12, italic=False))
# glebas
o.append(rotulo("57 glebas · lotes a partir de 2.000 m²", P([1420, 40])[0], P([1420, 40])[1] - 46, 13))

# --- pinos no mapa principal: portaria (1) e reserva (9); clube ganha o detalhe ampliado
NOMES = {p["id"]: p for p in PONTOS}
ORDEM = ["guarita", "salao", "piscina", "quiosques", "banheiros", "quadra", "baias", "fazendinha", "reserva"]
numeros = {k: i + 1 for i, k in enumerate(ORDEM)}
def pino(x, y, n, esc=1.0):
    return (f'<g transform="translate({f(x)} {f(y)}) scale({esc})" filter="url(#sombra-pin)"><use href="#pin"/>'
            f'<text x="0" y="-19.5" font-size="14" font-weight="800" fill="{VERDE}" text-anchor="middle">{n}</text></g>')
x, y = P(pos["guarita"]); o.append(icone("guarita", x, y)); o.append(pino(x, y - 22, numeros["guarita"]))
x, y = P(pos["reserva"]); o.append(pino(x, y, numeros["reserva"]))

# --- detalhe ampliado da área de lazer (canto inferior esquerdo)
DX, DY, DW, DH = 50, 585, 470, 290
ZC = 1.85
cc = centroide(clube["poly"]); ccx, ccy = P(cc)
def PD(p):
    x, y = P(p); return (DX + DW / 2 + 10 + (x - ccx) * ZC, DY + DH / 2 + 50 + (y - ccy) * ZC)
def ptsD(poly): return " ".join(f"{x:.1f},{y:.1f}" for x, y in (PD(p) for p in poly))
o.append(f'<line x1="{f(cx_)}" y1="{f(cy_)}" x2="{f(DX + DW / 2)}" y2="{f(DY)}" stroke="{CHAO_BORDA}" stroke-width="1.4" stroke-dasharray="5 4"/>')
o.append(f'<circle cx="{f(cx_)}" cy="{f(cy_)}" r="7" fill="none" stroke="{CHAO_BORDA}" stroke-width="1.6"/>')
o.append(f'<clipPath id="clip-det"><rect x="{DX}" y="{DY}" width="{DW}" height="{DH}" rx="18"/></clipPath>')
o.append(f'<rect x="{DX}" y="{DY}" width="{DW}" height="{DH}" rx="18" fill="#fff" stroke="{CHAO_BORDA}" stroke-width="1.2" filter="url(#sombra)"/>')
o.append('<g clip-path="url(#clip-det)">')
o.append(f'<rect x="{DX}" y="{DY}" width="{DW}" height="{DH}" fill="url(#chao)"/>')
o.append(f'<polygon points="{ptsD(clube["poly"])}" transform="translate(0 10)" fill="{CHAO_LADO}"/>')
o.append(f'<polygon points="{ptsD(clube["poly"])}" fill="{AREIA}" stroke="{AREIA_BORDA}" stroke-width="2" stroke-linejoin="round"/>')
cam = [PD(pos[k]) for k in ordem_clube]
o.append('<polyline points="' + " ".join(f"{a:.1f},{b:.1f}" for a, b in cam) + f'" fill="none" stroke="{VIA}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>')
det_arv = [p for p in semear(clu_np, cbb, 26, 8, 60) if all(math.dist(p, pos[k]) > 34 for k in ordem_clube)]
det_arv += [p for p in semear(chao_np, (cbb[0] - 80, cbb[1] - 40, cbb[2] + 80, cbb[3] + 60), 30, 10, 80) if not dentro(clu_np, p) and not any(dentro(ln, p) for ln in lot_np)]
det_arv.sort(key=lambda p: PD(p)[1])
for p in det_arv:
    x, y = PD(p); o.append(f'<use href="#{random.choice(["arv1", "arv2", "arv3"])}" transform="translate({f(x)} {f(y)}) scale({random.uniform(1.1, 1.5):.2f})"/>')
for k in ordem_clube:
    x, y = PD(pos[k]); o.append(icone(k, x, y))
for k in ordem_clube:
    x, y = PD(pos[k]); o.append(pino(x, y - 22, numeros[k], .95))
o.append('</g>')
o.append(f'<rect x="{DX}" y="{DY}" width="{DW}" height="{DH}" rx="18" fill="none" stroke="{CHAO_BORDA}" stroke-width="1.2"/>')
o.append(f'<g transform="translate({DX + 14} {DY + 24})"><rect x="-4" y="-16" width="176" height="24" rx="12" fill="{VERDE}"/><text x="84" y="1" font-size="12.5" font-weight="700" fill="#fff" text-anchor="middle" letter-spacing=".06em">ÁREA DE LAZER · DETALHE</text></g>')
o.append(rotulo("Área de lazer (ver detalhe)", cx_ - 64, cy_ - 34, 12.5))

# --- cartucho de título
o.append(f'''<g transform="translate(40 34)">
  <text x="0" y="22" font-family="Georgia, 'Times New Roman', serif" font-size="30" font-weight="700" fill="{VERDE}">Mapa-guia do Haras Rio São José</text>
  <text x="0" y="46" font-size="13" fill="#5f6f66" letter-spacing=".12em">CHACREAMENTO · POÇÕES – BA · ILUSTRAÇÃO SEM ESCALA</text>
</g>''')

# --- legenda numerada (à direita do detalhe)
LX, LY = 550, 585
o.append(f'<rect x="{LX}" y="{LY}" width="{W - LX - 40}" height="290" rx="18" fill="#fff" fill-opacity=".8" stroke="{CHAO_BORDA}" stroke-width="1"/>')
o.append(f'<text x="{LX + 28}" y="{LY + 38}" font-family="Georgia, serif" font-size="20" font-weight="700" fill="{VERDE}">Áreas comuns e pontos de referência</text>')
cols = 3; colw = (W - LX - 96) / cols
for i, k in enumerate(ORDEM):
    c, r = i % cols, i // cols
    x = LX + 28 + c * colw; y = LY + 80 + r * 52
    nome = NOMES[k]["nome"] if k != "guarita" else "Portaria e guarita"
    desc = NOMES[k].get("desc", "")
    o.append(f'<circle cx="{f(x + 14)}" cy="{f(y - 5)}" r="14" fill="{DOURADO}" stroke="{MARFIM}" stroke-width="2.4"/><text x="{f(x + 14)}" y="{f(y)}" font-size="13" font-weight="800" fill="{VERDE}" text-anchor="middle">{numeros[k]}</text>')
    o.append(f'<text x="{f(x + 38)}" y="{f(y - 4)}" font-size="15" font-weight="700" fill="{VERDE}">{nome}</text>')
    if desc:
        d = desc if len(desc) <= 62 else desc[:59].rsplit(" ", 1)[0] + "…"
        o.append(f'<text x="{f(x + 38)}" y="{f(y + 14)}" font-size="11.5" fill="#5f6f66">{d}</text>')
o.append(f'<g transform="translate({LX + 28} {LY + 262})" font-size="12" fill="#5f6f66">')
o.append(f'<rect x="0" y="-11" width="22" height="14" fill="{LOTE_A}" stroke="#fff" stroke-width="1"/><text x="30" y="0">Lotes · 57 glebas numeradas</text>')
o.append(f'<rect x="230" y="-11" width="22" height="14" fill="{VIA}" stroke="{VIA_BORDA}" stroke-width="1"/><text x="260" y="0">Av. Pau Ferro (ida) · Av. Umbuzeiro (volta) · Ruas 1 a 12</text>')
o.append(f'<rect x="620" y="-11" width="22" height="14" fill="{MATA}" stroke="{MATA_BORDA}" stroke-width="1"/><text x="650" y="0">Preservação ambiental</text>')
o.append(f'<rect x="830" y="-11" width="22" height="14" fill="{AREIA}" stroke="{AREIA_BORDA}" stroke-width="1"/><text x="860" y="0">Área de lazer</text>')
o.append(f'<text x="1000" y="0" font-style="italic">Ilustração baseada na planta. Imagens ilustrativas; prevalece o contrato.</text>')
o.append('</g>')

# --- rosa dos ventos
rx, ry = W - 110, 120
o.append(f'''<g transform="translate({rx} {ry})" filter="url(#sombra)">
  <circle r="34" fill="#fff" fill-opacity=".9" stroke="{CHAO_BORDA}"/>
  <polygon points="0,-28 6,0 0,-8 -6,0" fill="{TERRACOTA}"/><polygon points="0,28 6,0 0,8 -6,0" fill="#C9C0A8"/>
  <polygon points="-28,0 0,-6 -8,0 0,6" fill="#C9C0A8"/><polygon points="28,0 0,-6 8,0 0,6" fill="#C9C0A8"/>
  <text x="0" y="-38" font-family="Georgia, serif" font-size="13" font-weight="700" fill="{VERDE}" text-anchor="middle">N</text>
</g>''')
o.append('</svg>')
svg = "\n".join(o)
open(OUT, "w", encoding="utf-8").write(svg)
print(f"gravado {OUT} ({len(svg)//1024} KB) | árvores {len(arvores)} | escala {S:.3f} px/m | clube células {len(cels)}")
