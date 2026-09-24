# -*- coding: utf-8 -*-
"""Camada decorativa do mapa ilustrado (roda depois de enriquecer.py; chamado por gerar_dados.py).

Acrescenta ao data/lotes.json, em metros do mundo:
  - areas[tipo=imovel]: contorno do chão = união de lotes + áreas (o relevo 2,5D é desenhado sobre ele);
  - decor.arvores: [[x, y, tipo(1-3), escala], ...] — mata densa na reserva, cordão na borda do imóvel, algumas no clube;
  - decor.estrada: polilinha da Estrada de Duas Vendas saindo da portaria rumo ao norte (Poções);
  - decor.poções: ponto da placa de direção;
  - decor.lazer: itens da área de lazer com posição para os ícones (mesmos ids de pontos.json) — clube na parte baixa da faixa, acima do lago;
  - decor.eixo_clube: centro e eixos (u ao longo da faixa, v atravessado) usados para orientar as construções;
  - vias[Acesso ao clube]: via da portaria até o clube, pelo corredor livre entre os blocos (como na implantação).
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

# --- lago natural na ponta baixa da faixa (sem píer/deck): elipse ajustada ao interior do polígono
cbb = bb(clube["poly"])
lago = None
for frac in (0.86, 0.82, 0.78, 0.74):
    cy_ = cbb[1] + frac * (cbb[3] - cbb[1])
    xs_ = [gx for gx in np.arange(cbb[0], cbb[2], 2) if cv2.pointPolygonTest(clu_np, (float(gx), float(cy_)), True) >= 6]
    if len(xs_) < 12: continue
    cx_ = (min(xs_) + max(xs_)) / 2; rx = (max(xs_) - min(xs_)) / 2 * .8; ry = min(rx * .75, 34)
    lago = [[round(cx_ + rx * math.cos(t), 1), round(cy_ + ry * math.sin(t), 1)] for t in np.linspace(0, 2 * math.pi, 24, endpoint=False)]
    break
if lago:
    J["areas"] = [a for a in J["areas"] if a["tipo"] != "lago"] + [{"tipo": "lago", "nome": "Lago", "poly": lago}]
    print("lago:", len(lago), "vértices, centro", lago[0])
lago_np = np.array(lago, np.float32) if lago else None

# --- área de lazer (CLUBE): na parte BAIXA da faixa, logo acima do lago, como na implantação do projeto
#     (correção de 24/09/2026 — antes ficava na parte alta, junto aos lotes 144–152).
#     Eixo da faixa por componentes principais; layout inspirado no render "CLUBE" (só itens do contrato v4).
pts_ = [(gx, gy) for gx in np.arange(cbb[0], cbb[2], 3) for gy in np.arange(820, cbb[3], 3)
        if dentro(clu_np, (gx, gy)) and (lago_np is None or cv2.pointPolygonTest(lago_np, (float(gx), float(gy)), True) < -5)]
P_ = np.array(pts_, float); O_ = P_.mean(axis=0)
w_, V_ = np.linalg.eigh(np.cov((P_ - O_).T)); u_ = V_[:, np.argmax(w_)]
if lago and (np.array(lago).mean(axis=0) - O_) @ u_ < 0: u_ = -u_      # u: descendo a faixa, rumo ao lago
v_ = np.array([u_[1], -u_[0]])                                          # v: para a borda sudeste
if v_ @ np.array([1, 1]) < 0: v_ = -v_
LAYOUT = {  # (s ao longo da faixa, t atravessado), em metros a partir do centro da parte baixa
    "baias": (-52, 20), "fazendinha": (-50, -26), "quadra": (-8, -38), "banheiros": (28, -26),
    "salao": (4, 14), "piscina": (30, 16), "quiosques": (62, -4),
}
ordem = ["salao", "piscina", "quiosques", "banheiros", "quadra", "baias", "fazendinha"]
nomes = {p["id"]: p for p in PONTOS}
def no_clube(s_, t_): q = O_ + u_ * s_ + v_ * t_; return [round(float(q[0]), 1), round(float(q[1]), 1)]
lazer = [{"id": k, "nome": nomes[k]["nome"], "tipo": nomes[k]["tipo"], "desc": nomes[k].get("desc", ""), "c": no_clube(*LAYOUT[k])} for k in ordem]
eixo_clube = {"o": [round(float(O_[0]), 1), round(float(O_[1]), 1)], "u": [round(float(u_[0]), 4), round(float(u_[1]), 4)], "v": [round(float(v_[0]), 4), round(float(v_[1]), 4)]}

# --- acesso ao clube (via laranja da implantação): da via de acesso da portaria, pelo corredor livre entre os blocos,
#     ao lado da área verde e descendo o braço do clube. Traçado por A* numa grade de 2 m, fora dos lotes.
import heapq
bx0, by0, CW, CH = 100, 300, 200, 330
m_ = np.zeros((CH, CW), np.uint8)
for l in J["lotes"]: cv2.fillPoly(m_, [np.array([[(q[0] - bx0) / 2, (q[1] - by0) / 2] for q in l["poly"]], np.int32)], 255)
m_ = cv2.dilate(m_, np.ones((3, 3), np.uint8))
im_ = np.zeros((CH, CW), np.uint8)
cv2.fillPoly(im_, [np.array([[(q[0] - bx0) / 2, (q[1] - by0) / 2] for q in CHAO], np.int32)], 255)
im_ = cv2.erode(im_, np.ones((3, 3), np.uint8))
livre_ = (m_ == 0) & (im_ > 0)
dist_ = cv2.distanceTransform((livre_ * 255).astype(np.uint8), cv2.DIST_L2, 5)
def mais_perto(c):
    ys, xs = np.nonzero(livre_); i = np.argmin((xs - c[0]) ** 2 + (ys - c[1]) ** 2); return (int(xs[i]), int(ys[i]))
entrada_clube = O_ + u_ * (-78) + v_ * (-4)
ini_ = mais_perto((int((ent[0] + 8 - bx0) / 2), int((ent[1] + 6 - by0) / 2)))
fim_ = mais_perto((int((entrada_clube[0] - bx0) / 2), int((entrada_clube[1] - by0) / 2)))
aberto, veio, g_ = [(0, ini_)], {ini_: None}, {ini_: 0}
while aberto:
    _, c_ = heapq.heappop(aberto)
    if c_ == fim_: break
    for dx, dy in [(1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)]:
        n_ = (c_[0] + dx, c_[1] + dy)
        if not (0 <= n_[0] < CW and 0 <= n_[1] < CH) or not livre_[n_[1], n_[0]]: continue
        cu = g_[c_] + math.hypot(dx, dy) * (1 + 3.0 / (1 + dist_[n_[1], n_[0]]))
        if cu < g_.get(n_, 1e18): g_[n_] = cu; veio[n_] = c_; heapq.heappush(aberto, (cu + math.dist(n_, fim_), n_))
cam_ = []
c_ = fim_ if fim_ in veio else None
while c_: cam_.append(c_); c_ = veio[c_]
cam_ = cam_[::-1]
J["vias"] = [v for v in J["vias"] if v.get("nome") != "Acesso ao clube"]
if cam_:
    simp = cv2.approxPolyDP(np.array(cam_, np.float32).reshape(-1, 1, 2), 3, False).reshape(-1, 2)
    acesso = [[round(float(q[0]) * 2 + bx0, 1), round(float(q[1]) * 2 + by0, 1)] for q in simp]
    ac0 = next((v for v in J["vias"] if v["tipo"] == "acesso"), None)
    if ac0: acesso = [[acesso[0][0], ac0["pts"][0][1]]] + acesso     # encosta na via de acesso da portaria
    acesso.append([round(float(entrada_clube[0]), 1), round(float(entrada_clube[1]), 1)])
    J["vias"].append({"nome": "Acesso ao clube", "tipo": "acesso", "pts": acesso})
    print("acesso ao clube:", acesso)

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
for p in semear(clu_np, cbb, 34, 12, 60):
    if all(math.dist(p, it["c"]) > 34 for it in lazer) and (lago_np is None or cv2.pointPolygonTest(lago_np, (float(p[0]), float(p[1])), True) < -10): arv.append((p, "c"))
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

J["decor"] = {"arvores": arvores, "estrada": estrada, "pocoes": pocoes, "lazer": lazer, "eixo_clube": eixo_clube, "projecao": {"sh": 0.26, "yf": 0.74}}
J["meta"]["bbox"] = [round(min(MINX, estrada[-1][0]) - 20, 1), round(min(MINY, estrada[-1][1]) - 20, 1), round(MAXX + 20, 1), round(MAXY + 20, 1)]
json.dump(J, open(JP, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print(f"decor: {len(arvores)} árvores | lazer {[(i['id'], i['c']) for i in lazer]} | estrada {estrada} | bbox {J['meta']['bbox']} | {os.path.getsize(JP)//1024} KB")
