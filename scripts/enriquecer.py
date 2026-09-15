# -*- coding: utf-8 -*-
"""Enriquece data/lotes.json (gerado por gerar_dados.py) com: contorno do imóvel, vias nomeadas
(Avenida Pau Ferro, Avenida Umbuzeiro, Rua 1…N), áreas especiais, pontos de interesse e metadados.
Trabalha só em metros, a partir das geometrias já extraídas. Rápido (segundos)."""
import sys, os, json, math, datetime
sys.path.insert(0, r"D:\Programas\pylibs"); sys.stdout.reconfigure(encoding="utf-8")
import numpy as np, cv2
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
JP = os.path.join(ROOT, "data", "lotes.json")
PONTOS_CFG = os.path.join(ROOT, "pontos.json")
J = json.load(open(JP, encoding="utf-8"))
AV_NOMES = J["meta"].get("avenidas") or ["Avenida Pau Ferro", "Avenida Umbuzeiro"]

# ---------- raster dos lotes (1 px = 1 m) ----------
pts = [p for l in J["lotes"] for p in l["poly"]]
x0 = min(p[0] for p in pts) - 60; y0 = min(p[1] for p in pts) - 60
x1 = max(p[0] for p in pts) + 60; y1 = max(p[1] for p in pts) + 60
W, H = int(x1 - x0) + 1, int(y1 - y0) + 1
lot = np.zeros((H, W), np.uint8)
for l in J["lotes"]:
    cv2.fillPoly(lot, [np.array([[p[0]-x0, p[1]-y0] for p in l["poly"]], np.int32)], 255)
lot = cv2.morphologyEx(lot, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
livre = (lot == 0).astype(np.uint8)

# ---------- contorno do imóvel: união de lotes + áreas extraídas ----------
areas_prev = [a for a in J.get("areas", []) if a.get("tipo") != "imovel"]
uni = lot.copy()
for a in areas_prev:
    cv2.fillPoly(uni, [np.array([[p[0]-x0, p[1]-y0] for p in a["poly"]], np.int32)], 255)
uni = cv2.morphologyEx(uni, cv2.MORPH_CLOSE, np.ones((31, 31), np.uint8))
cs, _ = cv2.findContours(uni, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
c = cv2.approxPolyDP(max(cs, key=cv2.contourArea), 4, True)
imovel = [[round(float(q[0][0]) + x0, 1), round(float(q[0][1]) + y0, 1)] for q in c]
print("imóvel:", len(imovel), "vértices |", f"{cv2.contourArea(c)/1e4:.1f} ha")

# ---------- avenidas: eixo entre a faixa de glebas (superior/inferior) e a malha central ----------
# classifica glebas: "topo" = nenhuma gleba acima dela no mesmo intervalo de x; "base" = nenhuma abaixo
def bbox(poly): return (min(p[0] for p in poly), min(p[1] for p in poly), max(p[0] for p in poly), max(p[1] for p in poly))
GB = {g["id"]: bbox(g["poly"]) for g in J["glebas"] if len(g["poly"]) >= 3}
def sobrepoe_x(a, b): return min(a[2], b[2]) - max(a[0], b[0]) > 30
topo_ids, base_ids = set(), set()
for gid, bb in GB.items():
    acima = [o for o, ob in GB.items() if o != gid and sobrepoe_x(bb, ob) and ob[3] <= bb[1] + 15]
    abaixo = [o for o, ob in GB.items() if o != gid and sobrepoe_x(bb, ob) and ob[1] >= bb[3] - 15]
    if not acima and abaixo: topo_ids.add(gid)
    if not abaixo and acima: base_ids.add(gid)
# glebas do canto da entrada (01, 14, 16…) saem: ficam muito abaixo/acima da mediana da faixa
if topo_ids:
    med_b = float(np.median([GB[g][3] for g in topo_ids])); topo_ids = {g for g in topo_ids if GB[g][3] < med_b + 60}
if base_ids:
    med_t = float(np.median([GB[g][1] for g in base_ids])); base_ids = {g for g in base_ids if GB[g][1] > med_t - 60}
print("glebas da faixa superior:", sorted(topo_ids), "| inferior:", sorted(base_ids))
def mascara(ids):
    m = np.zeros((H, W), np.uint8)
    for g in J["glebas"]:
        if g["id"] in ids: cv2.fillPoly(m, [np.array([[p[0]-x0, p[1]-y0] for p in g["poly"]], np.int32)], 255)
    return m
m_topo, m_base = mascara(topo_ids), mascara(base_ids)
m_malha = mascara({g["id"] for g in J["glebas"]} - topo_ids - base_ids)

def eixo(m_faixa, m_outra, faixa_em_cima):
    pts_ = []
    for x in range(0, W, 4):
        cf = np.flatnonzero(m_faixa[:, x]); co = np.flatnonzero(m_outra[:, x])
        if not len(cf) or not len(co): continue
        if faixa_em_cima:
            y_a = cf.max(); cand = co[co > y_a]
            if not len(cand): continue
            y_b = cand.min()
        else:
            y_b = cf.min(); cand = co[co < y_b]
            if not len(cand): continue
            y_a = cand.max()
        if 3 <= y_b - y_a <= 60: pts_.append((x, (y_a + y_b) / 2))
    # trecho contínuo mais longo (buracos > 30 m quebram)
    segs, cur = [], [pts_[0]]
    for q in pts_[1:]:
        if q[0] - cur[-1][0] > 30: segs.append(cur); cur = []
        cur.append(q)
    segs.append(cur); seg = max(segs, key=lambda s_: s_[-1][0] - s_[0][0])
    ys = np.array([q[1] for q in seg]); med = np.array([np.median(ys[max(0, i-6):i+7]) for i in range(len(ys))])
    seg = [q for q, mm in zip(seg, med) if abs(q[1] - mm) < 15]
    arr = np.array(seg, np.float32).reshape(-1, 1, 2)
    sp = cv2.approxPolyDP(arr, 2.0, False)
    return [[round(float(q[0][0]) + x0, 1), round(float(q[0][1]) + y0, 1)] for q in sp]

av_topo = eixo(m_topo, m_malha, True)
av_base = eixo(m_base, m_malha, False)
print("Pau Ferro:", len(av_topo), "pts,", round(av_topo[-1][0] - av_topo[0][0]), "m |", "Umbuzeiro:", len(av_base), "pts,", round(av_base[-1][0] - av_base[0][0]), "m")

# ---------- ruas transversais: projeção de colunas entre as avenidas ----------
def y_em(av, xm):
    for (xa, ya), (xb, yb) in zip(av, av[1:]):
        if xa <= xm <= xb: return ya + (yb - ya) * (xm - xa) / (xb - xa) if xb != xa else ya
    return av[0][1] if xm < av[0][0] else av[-1][1]
yt = int(min(p[1] for p in av_topo) - y0) + 30; yb_ = int(max(p[1] for p in av_base) - y0) - 30
xi = int(max(av_topo[0][0], av_base[0][0]) - x0); xf = int(min(av_topo[-1][0], av_base[-1][0]) - x0)
perfil = livre[yt:yb_, :].mean(axis=0)
bandas, i = [], 0
while i < W:
    if perfil[i] >= 0.5:
        j = i
        while j < W and perfil[j] >= 0.5: j += 1
        if 5 <= j - i <= 45: bandas.append((i + j) / 2)
        i = j
    else: i += 1
ruas = []
for cx_ in bandas:
    pts_ = []
    for y in range(max(0, yt - 30), min(H, yb_ + 30), 4):
        row = livre[y, :]; cc = int(round(cx_))
        if not row[cc]: continue
        i = cc
        while i > 0 and row[i-1]: i -= 1
        j = cc
        while j < W-1 and row[j+1]: j += 1
        if j - i + 1 <= 45: pts_.append(((i + j) / 2, y))
    if len(pts_) >= 10 and pts_[-1][1] - pts_[0][1] >= 150:
        arr = np.array(pts_, np.float32).reshape(-1, 1, 2)
        s = cv2.approxPolyDP(arr, 2.5, False)
        ruas.append([[round(float(p[0][0]) + x0, 1), round(float(p[0][1]) + y0, 1)] for p in s])
ruas.sort(key=lambda r: r[0][0])
print("ruas transversais:", len(ruas))

# acesso da entrada até a Avenida Pau Ferro (se houver ponto de entrada)
ent = J["meta"].get("entrada")
vias = [{"nome": AV_NOMES[0], "tipo": "avenida", "pts": av_topo}, {"nome": AV_NOMES[1], "tipo": "avenida", "pts": av_base}]
for i, r in enumerate(ruas, 1): vias.append({"nome": f"Rua {i}", "tipo": "rua", "pts": r})
if ent:
    alvo = min(av_topo, key=lambda p: math.hypot(p[0]-ent[0], p[1]-ent[1]))
    vias.append({"nome": "Acesso", "tipo": "acesso", "pts": [ent, [alvo[0], ent[1]], alvo] if abs(alvo[0]-ent[0]) > 20 else [ent, alvo]})

# ---------- áreas ----------
areas = [{"tipo": "imovel", "nome": "Chacreamento Haras Rio São José", "poly": imovel}] + areas_prev

# ---------- pontos de interesse ----------
def centroide(poly):
    return [sum(p[0] for p in poly)/len(poly), sum(p[1] for p in poly)/len(poly)]
def dentro(pt, poly):
    x, y = pt; ins = False; n = len(poly)
    for i in range(n):
        x1_, y1_ = poly[i]; x2_, y2_ = poly[(i+1) % n]
        if (y1_ > y) != (y2_ > y) and x < x1_ + (y - y1_) * (x2_ - x1_) / (y2_ - y1_): ins = not ins
    return ins
clube = next((a for a in areas if a["tipo"] == "clube"), None)
reserva = next((a for a in areas if a["tipo"] == "reserva"), None)
cfg = json.load(open(PONTOS_CFG, encoding="utf-8")) if os.path.exists(PONTOS_CFG) else []
pontos = []
if clube:
    # espalha os pontos "no clube" ao longo do eixo maior do polígono, só em posições internas
    poly = clube["poly"]; cx, cy = centroide(poly)
    xs = [p[0] for p in poly]; ys = [p[1] for p in poly]
    ax = max(xs) - min(xs); ay = max(ys) - min(ys)
    cand = []
    for t in np.linspace(-0.45, 0.45, 13):
        for u in np.linspace(-0.4, 0.4, 5):
            p = [cx + t*ax*0.9, cy + t*ay*0.9 + u*min(ax, ay)*0.35]
            if dentro(p, poly): cand.append(p)
    cand.sort(key=lambda q: q[1])                      # de cima para baixo: mais perto dos lotes primeiro
    cand = cand[:max(8, int(len(cand) * 0.45))]         # só a metade de cima da área
    sel = []
    for q in cand:                                     # afasta os pinos pelo menos 28 m entre si
        if all(math.hypot(q[0]-r[0], q[1]-r[1]) >= 28 for r in sel): sel.append(q)
        if len(sel) >= 8: break
    cand = (sel + [[cx, cy]] * 8)[:8]
    ci = 0
for k in cfg:
    onde = k.get("onde")
    if onde == "entrada" and ent: c = ent
    elif onde == "reserva" and reserva: c = centroide(reserva["poly"])
    elif onde == "clube" and clube:
        c = cand[min(ci, len(cand)-1)]; ci += 1
    elif isinstance(onde, list): c = onde
    else: c = None
    pontos.append({"n": k["n"], "id": k["id"], "nome": k["nome"], "tipo": k["tipo"], "c": [round(c[0], 1), round(c[1], 1)] if c else None,
                   "situacao": k.get("situacao"), "prazo": k.get("prazo"), "desc": k.get("desc", "")})
print("pontos:", [(p["n"], p["id"], "pin" if p["c"] else "sem pin") for p in pontos])

# ---------- metadados e gravação ----------
J["areas"] = areas; J["vias"] = vias; J["pontos"] = pontos
J["meta"]["avenidas"] = AV_NOMES; J["meta"]["ruas"] = len(ruas)
J["meta"]["area_total_m2"] = round(sum((l.get("area") or 0) for l in J["lotes"]), 2)
J["meta"]["glebas"] = len(J["glebas"])
allpts = [p for l in J["lotes"] for p in l["poly"]] + [p for a in areas for p in a["poly"]] + [p for v in vias for p in v["pts"]]
J["meta"]["bbox"] = [round(min(p[0] for p in allpts), 1), round(min(p[1] for p in allpts), 1), round(max(p[0] for p in allpts), 1), round(max(p[1] for p in allpts), 1)]
json.dump(J, open(JP, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print("gravado:", JP, os.path.getsize(JP)//1024, "KB | bbox", J["meta"]["bbox"], "| área total", f'{J["meta"]["area_total_m2"]/1e4:.1f} ha')

# ---------- verificação ----------
mx, my, Mx, My = J["meta"]["bbox"]; SC = 2400 / (Mx - mx); Hh = int((My - my) * SC) + 40
img = np.full((Hh, 2440, 3), 246, np.uint8)
def P(p): return (int((p[0]-mx)*SC)+20, int((p[1]-my)*SC)+20)
cor_area = {"imovel": (200, 200, 200), "reserva": (120, 170, 120), "clube": (90, 160, 200), "area_comum": (150, 190, 150), "lago": (220, 170, 90)}
for a in areas:
    cv2.polylines(img, [np.array([P(p) for p in a["poly"]], np.int32)], True, cor_area.get(a["tipo"], (0, 0, 0)), 2)
    cv2.putText(img, a["tipo"], P(a["poly"][0]), cv2.FONT_HERSHEY_SIMPLEX, 0.5, cor_area.get(a["tipo"], (0, 0, 0)), 1)
for l in J["lotes"]: cv2.polylines(img, [np.array([P(p) for p in l["poly"]], np.int32)], True, (215, 215, 215), 1)
for v in vias:
    col = (60, 60, 200) if v["tipo"] == "avenida" else ((0, 140, 255) if v["tipo"] == "acesso" else (200, 120, 60))
    cv2.polylines(img, [np.array([P(p) for p in v["pts"]], np.int32)], False, col, 3 if v["tipo"] != "rua" else 2)
    if v["nome"]: cv2.putText(img, v["nome"], P(v["pts"][len(v["pts"])//2]), cv2.FONT_HERSHEY_SIMPLEX, 0.5, col, 1)
for p in pontos:
    if p["c"]: cv2.circle(img, P(p["c"]), 9, (0, 170, 200), -1); cv2.putText(img, str(p["n"]), (P(p["c"])[0]-4, P(p["c"])[1]+4), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (255, 255, 255), 1)
cv2.imwrite(os.path.join(HERE, "verificacao_vias.png"), img); print("verificação:", os.path.join(HERE, "verificacao_vias.png"))
