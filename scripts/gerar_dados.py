# -*- coding: utf-8 -*-
"""Gera data/lotes.json do app a partir da PLANTA FRACIONADA (PDF vetorial), do Memorial de Lotes e da Planilha Mestre.
Método: rasteriza só os traços vetoriais, acha as regiões fechadas (componentes conexos) e casa cada rótulo de lote com a região que o contém."""
import sys, os, re, glob, json, math, datetime
sys.path.insert(0, r"D:\Programas\pylibs")
sys.stdout.reconfigure(encoding="utf-8")
import numpy as np, cv2, pymupdf, openpyxl
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
OUTDIR = os.environ.get("OUTDIR", os.path.abspath(os.path.join(HERE, "..")) if os.path.basename(HERE) == "scripts" else HERE)
R = r"D:\Haras Rio São José"
NA = R + r"\Auditoria conta Bradesco Jachson 23\Nova Adm Marcelo Julho 2026"
PLANTA = glob.glob(NA + r"\Migração Sienge Acade\*PL. FRACIONADA*.pdf")[0]
BASE = NA + r"\Migração Sienge Acade\Haras-Rio-Sao-Jose_Base-Glebas-Lotes_v3.xlsx"
MESTRE = NA + r"\Migração Sienge Acade\Conferência\PLANILHA MESTRE POR UNIDADE - 654 lotes - 01-09-2026 - v2.xlsx"
RESERVA_TEC = {"267", "269", "470"}
RESERVA_ESTRATEGICA_ARQ = os.path.join(OUTDIR, "reserva_estrategica.txt")   # um lote por linha; se não existir, usa os 30 maiores
ZOOM = 2.6
ESPESSURA = 2

def num(v):
    s = str(v or "").strip().replace(".", "").replace(",", ".")
    try: return float(s)
    except: return None

# ---------- 1) vetores → raster de traços ----------
doc = pymupdf.open(PLANTA); pg = doc[0]
ROT = pg.rotation; RM = pymupdf.Matrix(pg.rotation_matrix)
pg.set_rotation(0)                       # trabalha no espaço bruto; rotaciona só na saída
W, H = pg.rect.width, pg.rect.height
print("rotação original da página:", ROT)
Wp, Hp = int(W * ZOOM) + 2, int(H * ZOOM) + 2
canvas = np.zeros((Hp, Wp), np.uint8)
n_seg = 0
for dr in pg.get_drawings():
    if dr.get("width") is not None and dr["width"] > 6: continue          # molduras grossas
    for it in dr["items"]:
        if it[0] == "l":
            p1, p2 = it[1], it[2]
            cv2.line(canvas, (int(p1.x*ZOOM), int(p1.y*ZOOM)), (int(p2.x*ZOOM), int(p2.y*ZOOM)), 255, ESPESSURA); n_seg += 1
        elif it[0] == "re":
            r = it[1]; cv2.rectangle(canvas, (int(r.x0*ZOOM), int(r.y0*ZOOM)), (int(r.x1*ZOOM), int(r.y1*ZOOM)), 255, ESPESSURA); n_seg += 1
        elif it[0] == "qu":
            q = it[1]; pts = np.array([[q.ul.x, q.ul.y], [q.ur.x, q.ur.y], [q.lr.x, q.lr.y], [q.ll.x, q.ll.y]]) * ZOOM
            cv2.polylines(canvas, [pts.astype(np.int32)], True, 255, ESPESSURA); n_seg += 1
        elif it[0] == "c":
            p = [it[1], it[2], it[3], it[4]]
            pts = [(( (1-t)**3*p[0].x + 3*(1-t)**2*t*p[1].x + 3*(1-t)*t**2*p[2].x + t**3*p[3].x)*ZOOM,
                    ( (1-t)**3*p[0].y + 3*(1-t)**2*t*p[1].y + 3*(1-t)*t**2*p[2].y + t**3*p[3].y)*ZOOM) for t in np.linspace(0, 1, 8)]
            cv2.polylines(canvas, [np.array(pts, np.int32)], False, 255, ESPESSURA); n_seg += 1
print(f"planta {os.path.basename(PLANTA)} | {W:.0f}x{H:.0f} pt | raster {Wp}x{Hp} | segmentos {n_seg}")

# ---------- 2) rótulos ----------
lot_labels, gleba_labels, textos = {}, {}, []
for b in pg.get_text("dict")["blocks"]:
    if b.get("type") != 0: continue
    for l in b["lines"]:
        for s in l["spans"]:
            t = s["text"].strip(); x0, y0, x1, y1 = s["bbox"]
            cx, cy = (x0+x1)/2, (y0+y1)/2
            if re.fullmatch(r"\d{1,3}", t) and 1 <= int(t) <= 654:
                if s["size"] < 15: lot_labels.setdefault(int(t), []).append((cx, cy))
                else: gleba_labels.setdefault(int(t), []).append((cx, cy))
            elif t: textos.append((t, cx, cy))
print("rótulos de lote:", len(lot_labels), "| rótulos de gleba:", len(gleba_labels))
dup = [k for k, v in lot_labels.items() if len(v) > 1]
print("números de lote com mais de um rótulo:", len(dup), dup[:12])

# ---------- 3) regiões ----------
livre = (canvas == 0).astype(np.uint8)
n, comp, stats, cents = cv2.connectedComponentsWithStats(livre, connectivity=4)
print("componentes brancos:", n)
def comp_em(x, y, raio=6):
    px, py = int(x*ZOOM), int(y*ZOOM)
    for r_ in range(0, raio+1):
        for dx in range(-r_, r_+1):
            for dy in (-r_, r_):
                for (a, b_) in ((px+dx, py+dy), (px+dy, py+dx)):
                    if 0 <= a < Wp and 0 <= b_ < Hp and comp[b_, a] != 0: return comp[b_, a]
    return 0

lote_comp = {}
for nlote, pos in lot_labels.items():
    cands = [comp_em(x, y) for x, y in pos]
    cands = [c for c in cands if c and stats[c, cv2.CC_STAT_AREA] < 400000]
    if cands: lote_comp[nlote] = Counter(cands).most_common(1)[0][0]
# Correção de erro da planta: o rótulo "312" aparece duas vezes e o "321" não existe.
# A região cuja área mais se aproxima do memorial fica com 312; a outra vai para 321.
CORRECOES_ROTULO = {312: 321}
for dupn, alvo in CORRECOES_ROTULO.items():
    cs = [c for c in {comp_em(x, y) for x, y in lot_labels.get(dupn, [])} if c and stats[c, cv2.CC_STAT_AREA] < 400000]
    if len(cs) == 2 and alvo not in lote_comp:
        a = {c: stats[c, cv2.CC_STAT_AREA] for c in cs}
        # decide depois de conhecer a escala: guarda para resolver na etapa 4
        lote_comp[dupn] = cs[0]; lote_comp[alvo] = cs[1]
        print(f"correção de rótulo: {dupn} duplicado -> regiões {cs}; {alvo} recebe a segunda (ajuste por área na etapa 4)")
comp_lotes = defaultdict(list)
for k, c in lote_comp.items(): comp_lotes[c].append(k)
colisao = {c: ks for c, ks in comp_lotes.items() if len(ks) > 1}
print("lotes com região:", len(lote_comp), "| regiões partilhadas por 2+ lotes:", len(colisao), list(colisao.values())[:8])

# ---------- 4) contornos ----------
PT_M = None
def contorno(cid, eps=1.6):
    m = (comp == cid).astype(np.uint8)
    cs, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    c = max(cs, key=cv2.contourArea)
    c = cv2.approxPolyDP(c, eps, True)
    return [(float(p[0][0]) / ZOOM, float(p[0][1]) / ZOOM) for p in c]      # em pt
def area_pt(poly):
    s = 0
    for i in range(len(poly)):
        x1, y1 = poly[i]; x2, y2 = poly[(i+1) % len(poly)]; s += x1*y2 - x2*y1
    return abs(s)/2

# ---------- 5) memorial + mestre ----------
wb = openpyxl.load_workbook(BASE, read_only=True, data_only=True)
rows = list(wb["Lotes"].iter_rows(values_only=True)); hdr = [str(h) for h in rows[0]]; wb.close()
mem = {}
for r in rows[1:]:
    d = dict(zip(hdr, r))
    if not d.get("Lote"): continue
    mem[int(str(d["Lote"]))] = {"gleba": str(d["Gleba"]).zfill(2), "area": float(d["Área (m²)"] or 0),
                                 "frente": num(d.get("Frente (m)")), "fundo": num(d.get("Fundo (m)")),
                                 "esq": num(d.get("Esquerda (m)")), "dir": num(d.get("Direita (m)"))}
wb = openpyxl.load_workbook(MESTRE, read_only=True, data_only=True)
rows = list(wb["Unidades 654"].iter_rows(values_only=True)); hdr = [str(h) for h in rows[0]]; wb.close()
status = {}
for r in rows[1:]:
    d = dict(zip(hdr, r))
    if not d.get("Lote"): continue
    st = str(d["STATUS"]).upper()
    status[int(str(d["Lote"]))] = "disponivel" if ("DISPON" in st or "DISTRATADA" in st) else "vendido"
print("memorial:", len(mem), "| mestre:", len(status), Counter(status.values()))

# escala pt→m calibrada pela área do memorial
razoes = []
polys_pt = {}
for nlote, cid in lote_comp.items():
    if cid in colisao: continue
    poly = contorno(cid); polys_pt[nlote] = poly
    a = area_pt(poly)
    if nlote in mem and mem[nlote]["area"] > 0 and a > 0:
        razoes.append(math.sqrt(mem[nlote]["area"] / a))
razoes.sort(); PT_M = razoes[len(razoes)//2]
print(f"escala calibrada: 1 pt = {PT_M:.4f} m (teórico 1:2000 = 0,7056) | amostras {len(razoes)}")
for dupn, alvo in CORRECOES_ROTULO.items():
    if dupn in polys_pt and alvo in polys_pt and dupn in mem and alvo in mem:
        a1, a2 = area_pt(polys_pt[dupn]) * PT_M**2, area_pt(polys_pt[alvo]) * PT_M**2
        if abs(a1 - mem[dupn]["area"]) + abs(a2 - mem[alvo]["area"]) > abs(a2 - mem[dupn]["area"]) + abs(a1 - mem[alvo]["area"]):
            polys_pt[dupn], polys_pt[alvo] = polys_pt[alvo], polys_pt[dupn]
            lote_comp[dupn], lote_comp[alvo] = lote_comp[alvo], lote_comp[dupn]
        print(f"   {dupn}: {area_pt(polys_pt[dupn])*PT_M**2:.0f} m² (memorial {mem[dupn]['area']:.0f}) | {alvo}: {area_pt(polys_pt[alvo])*PT_M**2:.0f} m² (memorial {mem[alvo]['area']:.0f})")
erros = []
for nlote, poly in polys_pt.items():
    if nlote in mem and mem[nlote]["area"] > 0:
        erros.append(abs(area_pt(poly) * PT_M**2 - mem[nlote]["area"]) / mem[nlote]["area"])
erros.sort()
print(f"erro de área vs memorial: mediana {erros[len(erros)//2]*100:.1f}% | p90 {erros[int(len(erros)*.9)]*100:.1f}% | >15%: {sum(1 for e in erros if e > .15)}")

# ---------- 6) reserva estratégica ----------
if os.path.exists(RESERVA_ESTRATEGICA_ARQ):
    reserva_est = {int(x) for x in open(RESERVA_ESTRATEGICA_ARQ).read().split() if x.strip().isdigit()}
    origem_res = "arquivo reserva_estrategica.txt"
else:
    disp = [k for k, s in status.items() if s == "disponivel" and str(k).zfill(3) not in RESERVA_TEC]
    reserva_est = set(sorted(disp, key=lambda k: -mem.get(k, {"area": 0})["area"])[:30])
    origem_res = "30 maiores disponíveis (padrão; troque criando reserva_estrategica.txt)"
    open(RESERVA_ESTRATEGICA_ARQ, "w").write("\n".join(str(k).zfill(3) for k in sorted(reserva_est)))
print("reserva estratégica:", len(reserva_est), "lotes —", origem_res)

# ---------- 7) montar saída ----------
def ROTP(x, y):
    q = pymupdf.Point(x, y) * RM
    return q.x, q.y
polys_rot = {k: [ROTP(x, y) for x, y in v] for k, v in polys_pt.items()}
minx = min(x for p in polys_rot.values() for x, y in p); miny = min(y for p in polys_rot.values() for x, y in p)
def M(x, y):
    x, y = ROTP(x, y)
    return [round((x - minx) * PT_M, 2), round((y - miny) * PT_M, 2)]
lotes_out, faltam = [], []
for nlote in range(1, 655):
    if nlote not in polys_pt: faltam.append(nlote); continue
    m = mem.get(nlote, {}); st = status.get(nlote, "vendido")
    lid = str(nlote).zfill(3)
    if lid in RESERVA_TEC or nlote in reserva_est: st = "reservado" if st == "disponivel" else st
    poly = [M(x, y) for x, y in polys_pt[nlote]]
    cx = sum(p[0] for p in poly)/len(poly); cy = sum(p[1] for p in poly)/len(poly)
    lotes_out.append({"id": lid, "gleba": m.get("gleba", "?"), "poly": poly, "c": [round(cx, 2), round(cy, 2)],
                      "area": m.get("area"), "frente": m.get("frente"), "fundo": m.get("fundo"), "esq": m.get("esq"), "dir": m.get("dir"), "status": st})
print("lotes no JSON:", len(lotes_out), "| sem geometria:", faltam)

# glebas: união das regiões dos lotes
glebas_out = []
por_gleba = defaultdict(list)
for l in lotes_out: por_gleba[l["gleba"]].append(l["id"])
for gid, ids in sorted(por_gleba.items()):
    mask = np.zeros_like(canvas)
    for lid in ids:
        cid = lote_comp.get(int(lid))
        if cid: mask[comp == cid] = 255
    mask = cv2.dilate(mask, np.ones((ESPESSURA*2+3, ESPESSURA*2+3), np.uint8))
    cs, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    c = cv2.approxPolyDP(max(cs, key=cv2.contourArea), 2.5, True)
    poly = [M(float(p[0][0])/ZOOM, float(p[0][1])/ZOOM) for p in c]
    lab = gleba_labels.get(int(gid))
    label = M(*lab[0]) if lab else [sum(p[0] for p in poly)/len(poly), sum(p[1] for p in poly)/len(poly)]
    glebas_out.append({"id": gid, "poly": poly, "label": [round(label[0], 2), round(label[1], 2)], "lotes": ids})
print("glebas:", len(glebas_out))

# áreas especiais pelos textos
areas_out = []
for chave, tipo, nome in (("PRESERVA", "reserva", "Área de preservação ambiental"), ("ÁREA COMUM", "area_comum", "Área comum"), ("AREA COMUM", "area_comum", "Área comum")):
    for t, cx, cy in textos:
        if chave in t.upper():
            cid = comp_em(cx, cy, 12)
            if cid and stats[cid, cv2.CC_STAT_AREA] < 0.5 * Wp * Hp and cid not in comp_lotes:
                poly = [M(x, y) for x, y in contorno(cid, 3)]
                if not any(a["poly"] == poly for a in areas_out):
                    areas_out.append({"tipo": tipo, "nome": nome, "poly": poly})
print("áreas especiais:", [(a["tipo"], len(a["poly"])) for a in areas_out])

allpts = [p for l in lotes_out for p in l["poly"]] + [p for g in glebas_out for p in g["poly"]] + [p for a in areas_out for p in a["poly"]]
bbox = [round(min(p[0] for p in allpts), 1), round(min(p[1] for p in allpts), 1), round(max(p[0] for p in allpts), 1), round(max(p[1] for p in allpts), 1)]
cnt = Counter(l["status"] for l in lotes_out)
out = {"meta": {"gerado_em": datetime.datetime.now().isoformat(timespec="minutes"), "fonte": "Planilha Mestre 01/09/2026 · Memorial de Lotes · Planta Fracionada (Jan/2021)",
                "unidade": "m", "bbox": bbox, "total": len(lotes_out), "disponiveis": cnt["disponivel"], "vendidos": cnt["vendido"], "reservados": cnt["reservado"],
                "preco_m2": 27.5, "whatsapp": None, "escala_pt_m": round(PT_M, 5), "reserva_estrategica": origem_res},
       "glebas": glebas_out, "lotes": lotes_out, "vias": [], "areas": areas_out}
os.makedirs(os.path.join(OUTDIR, "data"), exist_ok=True)
json.dump(out, open(os.path.join(OUTDIR, "data", "lotes.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print("STATUS:", dict(cnt), "| bbox:", bbox, "| JSON:", os.path.join(OUTDIR, "data", "lotes.json"), os.path.getsize(os.path.join(OUTDIR, "data", "lotes.json"))//1024, "KB")

# imagem de verificação
SC = 2400 / (bbox[2] - bbox[0] + 1)
ver = np.full((int((bbox[3]-bbox[1]) * SC) + 20, 2420, 3), 245, np.uint8)
cor = {"disponivel": (107, 168, 200), "vendido": (217, 222, 217), "reservado": (122, 162, 166)}
for l in lotes_out:
    pts = np.array([[(p[0]-bbox[0])*SC + 10, (p[1]-bbox[1])*SC + 10] for p in l["poly"]], np.int32)
    cv2.fillPoly(ver, [pts], cor[l["status"]]); cv2.polylines(ver, [pts], True, (39, 56, 24), 1)
for g in glebas_out:
    pts = np.array([[(p[0]-bbox[0])*SC + 10, (p[1]-bbox[1])*SC + 10] for p in g["poly"]], np.int32)
    cv2.polylines(ver, [pts], True, (0, 0, 0), 2)
    cv2.putText(ver, g["id"], (int((g["label"][0]-bbox[0])*SC)+2, int((g["label"][1]-bbox[1])*SC)+14), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (38, 71, 167), 1)
for a in areas_out:
    pts = np.array([[(p[0]-bbox[0])*SC + 10, (p[1]-bbox[1])*SC + 10] for p in a["poly"]], np.int32)
    cv2.polylines(ver, [pts], True, (60, 120, 60), 2)
cv2.imwrite(os.path.join(OUTDIR, "verificacao_mapa.png"), ver)
print("verificação:", os.path.join(OUTDIR, "verificacao_mapa.png"))
