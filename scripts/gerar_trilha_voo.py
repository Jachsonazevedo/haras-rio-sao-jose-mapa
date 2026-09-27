"""Trilha do "Voo pelo Haras" (3 min 36 s): música + sons da natureza com narrativa que acompanha
os capítulos do voo (tour/voo.json). Mesma linguagem da trilha do filme de abertura
(gerar_trilha_natureza.py) — canarinhos, bem-te-vi, sabiá, rolinha, rio, cachoeira, chuva, vento
nas árvores e música em Dó maior —, tudo composto e sintetizado aqui (sem direito autoral).

Roteiro (segundos do voo):
  0–30    Portaria nova ........ amanhecer, vento, canarinhos ao longe, a música nasce
  30–46   Avenidas e rede ...... arpejos começam, passarinhos
  46–64   Rede de água ......... o rio aparece
  64–82   Pelas avenidas ....... música cheia, primeira melodia
  82–98   Reservatório ......... a cachoeira cresce
  98–114  Chácaras habitadas ... rolinha, bem-te-vi, melodia calorosa
  114–128 Reservatórios ........ água, música mais leve
  128–158 Glebas e chácaras .... passa uma chuva (trovão distante), a música recolhe; depois a passarada volta
  158–188 Vida no Haras ........ ponto alto: música cheia, melodia, muitos pássaros
  188–216 De volta à portaria .. resolução em Dó maior e a natureza fica

Saída: %TEMP%/trilha_voo.wav → usada por gerar_video_voo.py.
Uso: python scripts/gerar_trilha_voo.py && python scripts/gerar_video_voo.py
"""
import os, sys, wave
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gerar_som_ambiente as amb

SR = amb.SR
DUR = 216.0
N = int(DUR * SR)
SAIDA = os.path.join(os.environ.get('TEMP', '.'), 'trilha_voo.wav')
rng = np.random.default_rng(3606)
amb.rng = rng
t = np.arange(N) / SR
F = np.maximum(np.fft.rfftfreq(N, 1 / SR), 1.0)


def filtrar(x, H): return np.fft.irfft(np.fft.rfft(x, axis=-1) * H, n=N, axis=-1)
def pb(fc, o=2): return 1 / np.sqrt(1 + (F / fc) ** (2 * o))
def pa(fc, o=2): return 1 / np.sqrt(1 + (fc / F) ** (2 * o))
def rms(x): return float(np.sqrt(np.mean(x ** 2)) + 1e-12)
def db(v): return 10 ** (v / 20)
def hz(m): return 440.0 * 2 ** ((m - 69) / 12)


def curva(pontos, suav=0.6):
    ts, vs = zip(*pontos)
    e = np.interp(t, ts, vs)
    k = int(suav * SR)
    c = np.concatenate([np.full(k // 2, e[0]), e, np.full(k - k // 2, e[-1])]).cumsum()
    return (c[k:k + N] - c[:N]) / k


def lento(fc):
    m = filtrar(rng.standard_normal(N), pb(fc, 4))
    return m / (np.max(np.abs(m)) + 1e-12)


def ruido_est(corr=0.5):
    a, b = rng.standard_normal(N), rng.standard_normal(N)
    return np.vstack([a, corr * a + np.sqrt(1 - corr ** 2) * b])


def somar(buf, t0, s):
    i = int(t0 * SR)
    if i >= N or i < 0: return
    j = min(N, i + s.shape[1])
    buf[:, i:j] += s[:, :j - i]


CHUVA = (131.0, 150.0)   # começo e fim da chuva


# ---------------------------------------------------------------- natureza
def vento_arvores():
    x = filtrar(ruido_est(0.3), pa(220) * pb(2200))
    folhas = filtrar(ruido_est(0.2), pa(2500) * pb(8000)) * np.clip(0.5 + 0.8 * lento(6.0), 0, None)
    x = x / rms(x) + 0.5 * folhas / rms(folhas)
    rajada = np.clip(0.6 + 0.4 * lento(0.07), 0.15, 1)
    a, b = CHUVA
    env = curva([(0, 0), (1, 0.8), (30, 0.6), (64, 0.45), (128, 0.5), (a, 1.2), (b - 3, 1.2), (b + 3, 0.5), (216, 0.5)])
    return x * rajada * env


def riacho():
    buf = np.zeros((2, N))
    for _ in range(int(DUR * 28)):
        t0 = rng.uniform(0, DUR); f0 = rng.uniform(450, 1700); d = rng.uniform(0.015, 0.05)
        L = int(d * SR); tt = np.arange(L) / SR
        s = np.sin(2 * np.pi * np.cumsum(f0 * (1 + 0.45 * tt / d)) / SR) * np.exp(-tt / (d / 3.5)) * amb.envelope(L, 0.002, 0.004)
        somar(buf, t0, amb.estereo(s * rng.uniform(0.3, 1), rng.uniform(-0.8, 0.8)))
    agua = filtrar(ruido_est(0.4), pa(300) * pb(2500))
    x = filtrar(buf, pb(3200, 1)); x = x / rms(x) + 0.35 * agua / rms(agua)
    return x * curva([(0, 0), (44, 0), (50, 1.0), (64, 0.6), (82, 0.7), (98, 0.5), (114, 1.0), (128, 0.7), (150, 1.0), (188, 0.6), (216, 0.7)])


def cachoeira():
    x = filtrar(ruido_est(0.55), (F ** -0.35) * pa(140) * pb(2600) * (1 + 0.6 * np.exp(-((F - 900) / 700) ** 2)))
    x = x / rms(x) * (1 + 0.1 * lento(0.2) + 0.06 * lento(3))
    return x * curva([(0, 0), (80, 0), (86, 1.0), (96, 1.0), (101, 0.2), (114, 0.25), (118, 0.7), (126, 0.3), (216, 0.2)])


def chuva():
    a, b = CHUVA
    x = filtrar(ruido_est(0.2), pa(1400) * pb(9000, 1))
    x = x / rms(x) * (1 + 0.15 * lento(1.5))
    gotas = np.zeros((2, N))
    for _ in range(3000):
        t0 = rng.uniform(a - 1, b + 1); f = rng.uniform(1800, 5200)
        L = int(0.03 * SR); tt = np.arange(L) / SR
        somar(gotas, t0, amb.estereo(np.sin(2 * np.pi * f * tt) * np.exp(-tt / 0.004) * rng.uniform(0.2, 1), rng.uniform(-0.9, 0.9)))
    x = x + 0.9 * gotas / (rms(gotas) + 1e-9)
    return x * curva([(0, 0), (a, 0), (a + 3, 0.8), (a + 7, 1.0), (b - 5, 1.0), (b, 0), (216, 0)], 1.0)


def trovoes():
    x = np.zeros((2, N))
    for t0, g in ((CHUVA[0] + 1.0, 1.0), (CHUVA[0] + 9.5, 0.6)):
        L = int(4.5 * SR); tt = np.arange(L) / SR
        r = rng.standard_normal((2, L)) * (1 - np.exp(-tt / 0.25)) * np.exp(-tt / 1.3) * g
        i = int(t0 * SR); x[:, i:i + L] += r
    x = filtrar(x, pb(140, 3) * pa(25, 2))
    return x / (np.max(np.abs(x)) + 1e-9)


# ---------------------------------------------------------------- pássaros
def canario():
    partes = []
    for _ in range(rng.integers(3, 6)):
        tipo = rng.integers(4); base = rng.uniform(3200, 5200)
        if tipo == 0:   sil = lambda: amb.tom([base, base * 1.6], 0.028, harm=(1, 0.08), ataque=0.003, soltura=0.01)
        elif tipo == 1: sil = lambda: amb.tom([base * 1.4, base * 0.9], 0.032, harm=(1, 0.08), ataque=0.003, soltura=0.01)
        elif tipo == 2: sil = lambda: amb.tom([base, base * 1.05], 0.06, harm=(1, 0.1), vib=(38, 0.05), ataque=0.006, soltura=0.015)
        else:           sil = lambda: amb.tom([base * 0.9, base], 0.07, harm=(1, 0.15), aspero=0.5, ataque=0.005, soltura=0.02)
        gap = rng.uniform(0.022, 0.05)
        for _ in range(rng.integers(5, 13)):
            partes.append((sil(), gap))
        partes.append((np.zeros(1), rng.uniform(0.04, 0.12)))
    return amb.juntar(partes)


PALETAS = [rng.uniform(1900, 3300, 6), rng.uniform(2100, 3500, 6)]
ESPECIES = [  # (canto, peso, ganho)
    (canario, 5, 0.75), (amb.bem_te_vi, 2, 0.8), (lambda: amb.sabia(PALETAS[rng.integers(2)]), 2, 0.75),
    (amb.trinado, 1, 0.55), (amb.rolinha, 1, 0.4), (amb.piados, 2, 0.35),
]
# densidade de cantos por segundo em cada trecho
DENSIDADE = [(0, 0.12), (30, 0.18), (64, 0.22), (98, 0.28), (128, 0.18), (CHUVA[0] - 1, 0.0), (CHUVA[1] - 2, 0.45),
             (158, 0.32), (188, 0.25), (212, 0.0)]


def passaros():
    perto, longe = np.zeros((2, N)), np.zeros((2, N))
    pesos = np.array([e[1] for e in ESPECIES], float); pesos /= pesos.sum()
    ts = 1.5
    while ts < DUR - 4:
        dens = [d for (a, d) in DENSIDADE if a <= ts][-1]
        if dens <= 0:
            ts += 1.0; continue
        canto, _, g = ESPECIES[rng.choice(len(ESPECIES), p=pesos)]
        s = canto(); s = s / (np.max(np.abs(s)) + 1e-9) * g * rng.uniform(0.7, 1)
        fundo = rng.random() < 0.45
        somar(longe if fundo else perto, ts, amb.estereo(s, float(rng.uniform(-0.8, 0.8))))
        ts += rng.exponential(1 / dens) + 0.4
    longe = filtrar(longe, pb(4300, 1))
    return perto + 0.55 * longe


# ---------------------------------------------------------------- música
C9, Am9, F9, G6s, Em7, Dm9, Gsus, G, Cmaj7 = ([48, 55, 64, 71, 74], [45, 52, 60, 67, 71], [41, 48, 57, 64, 67],
    [43, 50, 57, 60, 64], [40, 47, 55, 62, 67], [38, 45, 53, 60, 64], [43, 50, 55, 60, 62], [43, 50, 55, 59, 62],
    [48, 55, 64, 67, 71, 76])
CICLO = [C9, Am9, F9, G6s]
CICLO2 = [F9, C9, Dm9, G6s, Am9, Em7, F9, Gsus]


def sequencia():
    """(início, acorde) do voo inteiro: acordes de ~6 s, variando o ciclo por trecho"""
    ac, s = [], 0.0
    trechos = [(0, 30, CICLO, 7.5), (30, 64, CICLO, 6.0), (64, 98, CICLO2, 4.25), (98, 128, CICLO, 7.5),
               (128, 158, [Am9, F9, Em7, Am9, Dm9, G6s], 5.0), (158, 188, CICLO2, 3.75), (188, 216, [Gsus, G, Cmaj7], None)]
    for a, b, ciclo, passo in trechos:
        if passo is None:
            ac += [(188.0, Gsus), (191.5, G), (194.0, Cmaj7)]; continue
        k, s = 0, a
        while s < b - 0.5:
            ac.append((s, ciclo[k % len(ciclo)])); k += 1; s += passo
    return ac


ACORDES = sequencia()
ARPEJO = [(0, 1.6), (30, 0.75), (64, 0.375), (98, 0.75), (128, 0.75), (CHUVA[0], 1.5), (CHUVA[1], 0.375),
          (158, 0.375), (180, 0.1875), (188, 0.75), (194, 0.5), (205, None)]
MOTIVO_A = [(0, 76, 0.75), (0.75, 79, 0.75), (1.5, 81, 1.1), (2.6, 79, 0.75), (3.35, 76, 0.75), (4.1, 74, 0.75), (4.85, 72, 1.4)]
MOTIVO_B = [(0, 72, 0.75), (0.75, 74, 0.75), (1.5, 76, 1.5), (3.0, 79, 0.75), (3.75, 76, 0.75), (4.5, 74, 1.5)]
MELODIA = ([(66 + d, m, l) for d, m, l in MOTIVO_A] + [(74 + d, m, l) for d, m, l in MOTIVO_B]
           + [(101 + d, m, l) for d, m, l in MOTIVO_B] + [(108 + d, m, l) for d, m, l in MOTIVO_A]
           + [(151 + d, m, l) for d, m, l in MOTIVO_A]
           + [(160 + d, m, l) for d, m, l in MOTIVO_A] + [(167.5 + d, m, l) for d, m, l in MOTIVO_B]
           + [(175 + d, m, l) for d, m, l in MOTIVO_A] + [(182 + d, m + 12 if m < 78 else m, l) for d, m, l in MOTIVO_B]
           + [(194.0, 84, 3.0), (197.5, 79, 1.5), (199.0, 76, 3.0)])


def pluck(f, dur=2.6, brilho=0.18, tau=0.9):
    L = int(dur * SR); tt = np.arange(L) / SR
    s = (np.sin(2 * np.pi * f * tt) * np.exp(-tt / tau) + brilho * np.sin(2 * np.pi * 2 * f * tt) * np.exp(-tt / (tau / 3.5))
         + 0.06 * np.sin(2 * np.pi * 3 * f * tt) * np.exp(-tt / (tau / 6)))
    return s * amb.envelope(L, 0.003, 0.3)


def musica():
    pad, arp, bx, mel = (np.zeros((2, N)) for _ in range(4))
    for i, (t0, notas) in enumerate(ACORDES):
        t1 = ACORDES[i + 1][0] if i + 1 < len(ACORDES) else DUR
        a, b = max(0, t0 - 1.2), min(DUR, t1 + 0.6)
        L = int((b - a) * SR); tt = np.arange(L) / SR
        jan = np.ones(L); k = int(min(1.8, (b - a) / 2) * SR)
        jan[:k] = np.sin(np.linspace(0, np.pi / 2, k)) ** 2; jan[-k:] = np.cos(np.linspace(0, np.pi / 2, k)) ** 2
        for j, m in enumerate(notas):
            v = sum(np.sin(2 * np.pi * hz(m) * (1 + d) * tt + rng.uniform(0, 6.3)) for d in (-0.002, 0, 0.0022))
            somar(pad, a, amb.estereo(v * jan * (0.5 if j == 0 else 0.3), (j - 2) * 0.22))
        if t0 >= 30 and not (CHUVA[0] < t0 < CHUVA[1]):
            raiz = notas[0] - 12 if notas[0] > 44 else notas[0]
            for tb in ((t0, t0 + (t1 - t0) / 2) if t1 - t0 > 5 else (t0,)):
                somar(bx, tb, amb.estereo(pluck(hz(raiz), 3.0, 0.3, 1.4), 0))
    for i, (t0, passo) in enumerate(ARPEJO):
        if passo is None: continue
        t1 = ARPEJO[i + 1][0]
        k, ts = 0, t0 + 0.4
        while ts < t1 - 0.1:
            notas = [ns for (ta, ns) in ACORDES if ta <= ts][-1]
            altas = sorted({n + 12 for n in notas[1:]} | {n + 24 for n in notas[2:4]})
            m = altas[k % len(altas)] if passo < 1 else int(rng.choice(altas))
            somar(arp, ts, amb.estereo(pluck(hz(m)) * rng.uniform(0.6, 1), float(np.sin(k * 0.9) * 0.5)))
            k += 1; ts += passo
    for t0, m, d in MELODIA:
        somar(mel, t0, amb.estereo(pluck(hz(m), 3.2, 0.25, 1.3), 0.1))
    for k, m in enumerate([72, 76, 79, 83, 84, 88]):
        somar(arp, 194.0 + 0.07 * k, amb.estereo(pluck(hz(m), 3.5, 0.15, 1.6) * 0.8, (k - 2.5) * 0.25))
    a, b = CHUVA
    pad = filtrar(pad, pb(1700, 1) * pa(60))
    pad *= curva([(0, 0), (2, 0.35), (30, 0.7), (64, 0.9), (a, 0.8), (a + 3, 0.55), (b, 0.6), (b + 3, 0.9), (158, 1.0), (194, 1.1), (216, 0.9)])
    arp *= curva([(0, 1), (a, 1), (a + 2, 0.6), (b, 0.6), (b + 2, 1), (216, 1)])
    return pad / rms(pad), arp / np.max(np.abs(arp)), bx / (np.max(np.abs(bx)) + 1e-9), mel / np.max(np.abs(mel))


def reverb(x, rt, brilho, seed):
    L = int(2.8 * SR); tt = np.arange(L) / SR
    ir = np.random.default_rng(seed).standard_normal((2, L)) * np.exp(-6.9 * tt / rt)
    ir[:, :int(0.015 * SR)] = 0
    n = N + L
    y = np.fft.irfft(np.fft.rfft(x, n, axis=-1) * np.fft.rfft(ir, n, axis=-1), n, axis=-1)[:, :N]
    y = filtrar(y, pb(brilho, 1))
    return y / (rms(y) + 1e-12) * rms(x)


def main():
    print('natureza...', flush=True)
    nat = vento_arvores() * db(-33) + riacho() * db(-33) + cachoeira() * db(-26) + chuva() * db(-30) + trovoes() * db(-16)
    print('passaros...', flush=True)
    aves = passaros()
    aves = aves / np.max(np.abs(aves)) * db(-12)
    aves = aves + reverb(aves, 1.1, 5000, 3) * db(-10)
    print('musica...', flush=True)
    pad, arp, bx, mel = musica()
    mus = pad * db(-30) + arp * db(-19) + bx * db(-22) + mel * db(-15)
    mus = mus + reverb(mus, 2.4, 3000, 7) * db(-5)
    mix = nat + aves + mus
    mix *= curva([(0, 0), (0.8, 1), (212.5, 1), (216, 0)], 0.3)
    mix = np.tanh(mix * 1.1) / 1.1
    mix *= db(-1.5) / np.max(np.abs(mix))
    with wave.open(SAIDA, 'wb') as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((mix * 32767).astype('<i2').T.copy().tobytes())
    print(f'ok -> {SAIDA} ({DUR:.0f} s, RMS {20 * np.log10(rms(mix)):.1f} dBFS)')


if __name__ == '__main__':
    main()
