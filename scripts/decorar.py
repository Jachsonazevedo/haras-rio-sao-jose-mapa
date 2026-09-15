# -*- coding: utf-8 -*-
"""Camada decorativa do mapa ilustrado (roda depois de enriquecer.py; chamado por gerar_dados.py).

Acrescenta ao data/lotes.json, em metros do mundo:
  - areas[tipo=imovel]: contorno do chão = união de lotes + áreas (o relevo 2,5D é desenhado sobre ele);
  - decor.arvores: [[x, y, tipo(1-3), escala], ...] — mata densa na reserva, cordão na borda do imóvel, algumas no clube;
  - decor.estrada: polilinha da Estrada de Duas Vendas saindo da portaria rumo ao norte (Poções);
  - decor.poções: ponto da placa de direção;
  - decor.lazer: itens da área de lazer com posição para os ícones (mesmos ids de pontos.json).
"""
import sys, os, json, math, random
sys.path.insert(0, r"D:\Programas\pylibs"); sys.stdout.reconfigure(encoding="utf-8")
import numpy as np, cv2

APP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JP = os.path.join(APP, "data", "lotes.json")
J = json.load(open(JP, encoding="utf-8"))
PONTOS = json.load(open(os.path.join(APP, "pontos.json"), encoding="utf-8"))
random.seed(11)

xs = [p[0] for a in J["areas"] for p in a["poly"]] + [p[0] for l in J["lotes"] for p in l["poly"]]
ys = [p[1] for a in J["areas"] for p in a["poly"]] + [p[1] for l in J["lotes"] for p in l["poly"]]
MINX, MAXX, MINY, MAXY = min(xs), max(xs), min(ys), max(ys)

# --- chão: união fechada de lotes + áreas
ox, oy = int(MINX) - 60, int(MINY) - 60
RW, RH = int(MAXX - MINX) + 120, int(MAXY - MINY) + 120
mask = np.zeros((RH, RW), np.uint8)
def raster(poly): cv2.fillPoly(mask, [np.array([[p[0] - ox, p[1] - oy] for p in poly], np.int32)], 255)
for l in J["lotes"]: raster(l["poly"])
for a in J["areas"]:
    if a["tipo"] != "imovel": raster(a["poly"])
mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((41, 41), np.uint8))
cs, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
c = cv2.approxPolyDP(max(cs, key=cv2.contourArea), 6, True)
CHAO = [[round(float(q[0][0]) + ox, 1), round(float(q[0][1]) + oy, 1)] for q in c]
J["areas"] = [{"tipo": "imovel", "nome": "Chacreamento Haras Rio São José", "poly": CHAO}] + [a for a in J["areas"] if a["tipo"] != "imovel"]
print("chão:", len(CHAO), "vértices |", f"{cv2.contourArea(c)/1e4:.1f} ha")

areas = {a["tipo"]: a for a in J["areas"]}
reserva, clube = areas["reserva"], areas["clube"]
res_np = np.array(reserva["poly"], np.float32); clu_np = np.array(clube["poly"], np.float32)
chao_np = np.array(CHAO, np.float32)
lot_np = [np.array(l["poly"], np.float32) for l in J["lotes"]]
def dentro(poly_np, p): return cv2.pointPolygonTest(poly_np, (float(p[0]), float(p[1])), False) >= 0
def em_lote(p): return any(dentro(ln, p) for ln in lot_np)
def bb(poly): return (min(p[0] for p in poly), min(p[1] for p in poly), max(p[0] for p in poly), max(p[1] for p in poly))
ent = J["meta"]["entrada"]

def semear(poly_np, bbox, passo, jitter, n_max, evitar_lotes=False):
    x0, y0, x1, y1 = bbox; out = []
    for gy in np.arange(y0, y1, passo):
        for gx in np.arange(x0, x1, passo):
            p = (gx + random.uniform(-jitter, jitter), gy + random.uniform(-jitter, jitter))
            if not dentro(poly_np, p): continue
            if evitar_lotes and em_lote(p): continue
            out.append(p)
    random.shuffle(out); return out[:n_max]

# --- área de lazer: posições dos ícones (interior do clube, afastados entre si)
cbb = bb(clube["poly"])
cand = []
for gy in np.arange(cbb[1] + 10, cbb[3], 10):
    for gx in np.arange(cbb[0] + 10, cbb[2], 10):
        d = cv2.pointPolygonTest(clu_np, (float(gx), float(gy)), True)
        if d >= 16: cand.append((float(gx), float(gy), d))
cand.sort(key=lambda q: -q[2])
ordem = ["salao", "piscina", "quiosques", "banheiros", "quadra", "baias", "fazendinha"]
esc = [cand[0][:2]]
while len(esc) < len(ordem):
    esc.append(max(cand, key=lambda q: min(math.dist(q[:2], e) for e in esc) + q[2] * .35)[:2])
esc.sort(key=lambda q: (q[1], q[0]))
nomes = {p["id"]: p for p in PONTOS}
lazer = [{"id": k, "nome": nomes[k]["nome"], "tipo": nomes[k]["tipo"], "desc": nomes[k].get("desc", ""), "c": [round(esc[i][0], 1), round(esc[i][1], 1)]} for i, k in enumerate(ordem)]

# --- árvores
arv = []
rbb = bb(reserva["poly"])
for p in semear(res_np, rbb, 30, 10, 420): arv.append((p, "r"))
for i in range(len(CHAO)):
    a, b = CHAO[i], CHAO[(i + 1) % len(CHAO)]; d = math.dist(a, b)
    for t in np.arange(0, d, 36):
        p = (a[0] + (b[0] - a[0]) * t / d + random.uniform(-8, 8), a[1] + (b[1] - a[1]) * t / d + random.uniform(-8, 8))
        if dentro(res_np, p) or dentro(clu_np, p) or em_lote(p) or math.dist(p, ent) < 70: continue
        arv.append((p, "b"))
for p in semear(clu_np, cbb, 40, 12, 40):
    if all(math.dist(p, it["c"]) > 34 for it in lazer): arv.append((p, "c"))
# nunca em cima das vias
def perto_de_via(p, folga):
    for v in J["vias"]:
        w = {"avenida": 14, "rua": 9, "acesso": 10}[v["tipo"]] / 2 + folga
        pts = v["pts"]
        for i in range(len(pts) - 1):
            ax, ay = pts[i]; bx, by = pts[i + 1]; dx, dy = bx - ax, by - ay
            L2 = dx * dx + dy * dy or 1
            t = max(0, min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / L2))
            if math.hypot(p[0] - (ax + dx * t), p[1] - (ay + dy * t)) < w: return True
    return False
arv = [(p, k) for p, k in arv if not perto_de_via(p, 6)]
arvores = [[round(p[0], 1), round(p[1], 1), random.choice([1, 2, 3]), round(random.uniform(.8, 1.25), 2)] for p, k in arv]

# --- estrada externa: da portaria rumo ao norte (Poções fica atrás da Av. Pau Ferro, direção norte)
estrada = [[round(ent[0], 1), round(ent[1], 1)], [ent[0] - 110, ent[1] - 60], [ent[0] - 150, ent[1] - 260], [ent[0] - 140, MINY - 150]]
estrada = [[round(x, 1), round(y, 1)] for x, y in estrada]
pocoes = [round(estrada[-1][0], 1), round(estrada[-1][1] + 40, 1)]

J["decor"] = {"arvores": arvores, "estrada": estrada, "pocoes": pocoes, "lazer": lazer, "projecao": {"sh": 0.26, "yf": 0.74}}
J["meta"]["bbox"] = [round(min(MINX, estrada[-1][0]) - 20, 1), round(min(MINY, estrada[-1][1]) - 20, 1), round(MAXX + 20, 1), round(MAXY + 20, 1)]
json.dump(J, open(JP, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print(f"decor: {len(arvores)} árvores | lazer {[(i['id'], i['c']) for i in lazer]} | estrada {estrada} | bbox {J['meta']['bbox']} | {os.path.getsize(JP)//1024} KB")
