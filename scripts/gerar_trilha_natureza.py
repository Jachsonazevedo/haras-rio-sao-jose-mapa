"""Trilha do filme de abertura: música com sons da natureza e narrativa de transição.
Saída: %TEMP%/trilha_natureza.wav → usado por gerar_filme.py (substitui o pagode de viola).

Tudo composto e sintetizado aqui (sem gravação de terceiros, sem direito autoral). A história
acompanha as tomadas e as frases do filme (tempos de gerar_filme.py / FRASES no tour.js):
  0–9 s    amanhecer: vento nas árvores, primeiros canarinhos ao longe, a música nasce
  9–15 s   sossego: o rio aparece, bem-te-vi perto, arpejos lentos
  15–21 s  a música ganha movimento (rede elétrica)
  21–27 s  a cachoeira cresce (rede de água)
  26–33 s  passa uma chuva: trovão distante, chuva nas folhas, a música recolhe (área de lazer)
  32–38 s  depois da chuva, a passarada volta toda e a melodia aparece (famílias que moram lá)
  38–44 s  "Agora é a sua vez": resolução em Dó maior, brilho final, fica a natureza
A tonalidade (Dó maior) é a mesma do som ambiente do tour, que entra quando o filme termina.

Uso: python scripts/gerar_trilha_natureza.py && python scripts/gerar_filme.py
"""
import os, sys, wave
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gerar_som_ambiente as amb   # pássaros e utilitários do som ambiente do tour

SR = amb.SR
DUR = 44.8
N = int(DUR * SR)
SAIDA = os.path.join(os.environ.get('TEMP', '.'), 'trilha_natureza.wav')
rng = np.random.default_rng(2609)
amb.rng = rng
t = np.arange(N) / SR
F = np.maximum(np.fft.rfftfreq(N, 1 / SR), 1.0)


def filtrar(x, H):
    return np.fft.irfft(np.fft.rfft(x, axis=-1) * H, n=N, axis=-1)


def pb(fc, o=2): return 1 / np.sqrt(1 + (F / fc) ** (2 * o))
def pa(fc, o=2): return 1 / np.sqrt(1 + (fc / F) ** (2 * o))
def rms(x): return float(np.sqrt(np.mean(x ** 2)) + 1e-12)
def db(v): return 10 ** (v / 20)


def curva(pontos):
    """envelope no tempo a partir de pontos (segundos, nível), suavizado"""
    ts, vs = zip(*pontos)
    e = np.interp(t, ts, vs)
    k = int(0.25 * SR)
    c = np.concatenate([np.full(k // 2, e[0]), e, np.full(k - k // 2, e[-1])]).cumsum()   # média móvel rápida
    return (c[k:k + N] - c[:N]) / k


def lento(fc):
    m = filtrar(rng.standard_normal(N), pb(fc, 4))
    return m / (np.max(np.abs(m)) + 1e-12)


def ruido_est(corr=0.5):
    a, b = rng.standard_normal(N), rng.standard_normal(N)
    return np.vstack([a, corr * a + np.sqrt(1 - corr ** 2) * b])


def somar(buf, t0, s):
    i = int(t0 * SR)
    if i >= N: return
    j = min(N, i + s.shape[1])
    buf[:, i:j] += s[:, :j - i]


# ---------------------------------------------------------------- natureza
def vento_arvores():
    x = filtrar(ruido_est(0.3), pa(220) * pb(2200))
    folhas = filtrar(ruido_est(0.2), pa(2500) * pb(8000)) * np.clip(0.5 + 0.8 * lento(6.0), 0, None)
    x = x / rms(x) + 0.5 * folhas / rms(folhas)
    rajada = np.clip(0.6 + 0.4 * lento(0.12), 0.15, 1)
    env = curva([(0, 0.0), (0.6, 0.8), (9, 0.6), (20, 0.4), (25.5, 0.6), (27.5, 1.3), (31, 1.2), (33.5, 0.5), (44.8, 0.45)])
    return x * rajada * env


def riacho():
    buf = np.zeros((2, N))
    for _ in range(int(DUR * 30)):
        t0 = rng.uniform(0, DUR)
        f0 = rng.uniform(450, 1700); d = rng.uniform(0.015, 0.05)
        L = int(d * SR); tt = np.arange(L) / SR
        s = np.sin(2 * np.pi * np.cumsum(f0 * (1 + 0.45 * tt / d)) / SR) * np.exp(-tt / (d / 3.5)) * amb.envelope(L, 0.002, 0.004)
        somar(buf, t0, amb.estereo(s * rng.uniform(0.3, 1), rng.uniform(-0.8, 0.8)))
    agua = filtrar(ruido_est(0.4), pa(300) * pb(2500))
    x = filtrar(buf, pb(3200, 1)); x = x / rms(x) + 0.35 * agua / rms(agua)
    return x * curva([(0, 0), (8, 0), (11, 0.9), (20, 1.0), (27, 0.8), (33, 1.0), (44.8, 0.9)])


def cachoeira():
    x = filtrar(ruido_est(0.55), (F ** -0.35) * pa(140) * pb(2600) * (1 + 0.6 * np.exp(-((F - 900) / 700) ** 2)))
    x = x / rms(x) * (1 + 0.1 * lento(0.2) + 0.06 * lento(3))
    return x * curva([(0, 0), (19, 0), (22.5, 1.0), (26, 1.0), (29, 0.3), (44.8, 0.25)])


def chuva():
    x = filtrar(ruido_est(0.2), pa(1400) * pb(9000, 1))
    x = x / rms(x) * (1 + 0.15 * lento(1.5))
    gotas = np.zeros((2, N))
    for _ in range(1600):
        t0 = rng.uniform(25.5, 34.5)
        f = rng.uniform(1800, 5200); L = int(0.03 * SR); tt = np.arange(L) / SR
        s = np.sin(2 * np.pi * f * tt) * np.exp(-tt / 0.004) * rng.uniform(0.2, 1)
        somar(gotas, t0, amb.estereo(s, rng.uniform(-0.9, 0.9)))
    x = x + 0.9 * gotas / (rms(gotas) + 1e-9)
    return x * curva([(0, 0), (26, 0), (28, 1.0), (31, 1.0), (34, 0.0), (44.8, 0)])


def trovao(t0=26.6):
    L = int(4.5 * SR); tt = np.arange(L) / SR
    x = np.zeros((2, N))
    r = rng.standard_normal((2, L)) * (1 - np.exp(-tt / 0.25)) * np.exp(-tt / 1.3)
    x[:, int(t0 * SR):int(t0 * SR) + L] = r
    x = filtrar(x, pb(140, 3) * pa(25, 2))
    return x / (np.max(np.abs(x)) + 1e-9)


# ---------------------------------------------------------------- pássaros
def canario():
    partes = []
    for _ in range(rng.integers(3, 6)):
        tipo = rng.integers(4)
        base = rng.uniform(3200, 5200)
        if tipo == 0:   sil = lambda: amb.tom([base, base * 1.6], 0.028, harm=(1, 0.08), ataque=0.003, soltura=0.01)
        elif tipo == 1: sil = lambda: amb.tom([base * 1.4, base * 0.9], 0.032, harm=(1, 0.08), ataque=0.003, soltura=0.01)
        elif tipo == 2: sil = lambda: amb.tom([base, base * 1.05], 0.06, harm=(1, 0.1), vib=(38, 0.05), ataque=0.006, soltura=0.015)
        else:           sil = lambda: amb.tom([base * 0.9, base], 0.07, harm=(1, 0.15), aspero=0.5, ataque=0.005, soltura=0.02)
        gap = rng.uniform(0.022, 0.05)
        for _ in range(rng.integers(5, 13)):
            partes.append((sil(), gap))
        partes.append((np.zeros(1), rng.uniform(0.04, 0.12)))
    return amb.juntar(partes)


PASSAROS = [  # (segundo, canto, ganho, pan, longe)
    (1.8, canario, 0.55, -0.6, True), (5.2, canario, 0.6, 0.55, True), (6.5, amb.rolinha, 0.35, -0.2, True),
    (9.8, canario, 0.8, -0.4, False), (11.6, amb.bem_te_vi, 0.8, 0.4, False), (13.3, canario, 0.7, 0.6, True),
    (15.8, lambda: amb.sabia(rng.uniform(2000, 3300, 6)), 0.75, -0.5, False), (18.6, amb.bem_te_vi, 0.6, -0.6, True),
    (19.8, canario, 0.65, 0.5, False), (22.8, amb.piados, 0.4, 0.2, True), (24.6, canario, 0.5, -0.5, True),
    (32.2, canario, 0.9, -0.35, False), (32.9, amb.bem_te_vi, 0.85, 0.45, False), (34.0, amb.trinado, 0.6, 0.1, True),
    (34.8, lambda: amb.sabia(rng.uniform(2000, 3300, 6)), 0.8, -0.6, False), (36.3, canario, 0.8, 0.6, False),
    (38.4, amb.piados, 0.4, -0.2, True), (40.2, canario, 0.75, -0.5, False), (41.6, amb.bem_te_vi, 0.8, 0.35, False),
    (43.0, canario, 0.55, 0.6, True),
]


def passaros():
    perto, longe = np.zeros((2, N)), np.zeros((2, N))
    for t0, canto, g, pan, fundo in PASSAROS:
        s = canto(); s = s / (np.max(np.abs(s)) + 1e-9) * g
        somar(longe if fundo else perto, t0, amb.estereo(s, pan))
    longe = filtrar(longe, pb(4300, 1))
    return perto + 0.55 * longe


# ---------------------------------------------------------------- música
def hz(m): return 440.0 * 2 ** ((m - 69) / 12)


ACORDES = [  # (início, notas)
    (0.0,  [48, 55, 64, 71, 74]),       # C maj9 — amanhecer
    (8.7,  [45, 52, 60, 67, 71]),       # A m9 — sossego
    (14.9, [41, 48, 57, 64, 67]),       # F maj9 — movimento
    (20.6, [43, 50, 57, 60, 64]),       # G6sus — água
    (26.3, [45, 52, 60, 64, 69]),       # A m — chuva
    (31.5, [41, 48, 57, 64, 69]),       # F add9 — depois da chuva
    (37.7, [43, 50, 55, 60, 62]),       # G sus4
    (39.6, [43, 50, 55, 59, 62]),       # G
    (40.4, [48, 55, 64, 67, 71, 76]),   # C maj7 — "agora é a sua vez"
]
# densidade dos arpejos por trecho (intervalo entre notas, s); None = sem arpejo
ARPEJO = [(0.0, 1.6), (8.7, 0.75), (14.9, 0.375), (20.6, 0.375), (26.3, 1.4), (31.5, 0.375), (37.7, 0.19), (40.4, None)]
MELODIA = [(31.9, 76, 0.75), (32.65, 79, 0.75), (33.4, 81, 1.1), (34.5, 79, 0.75), (35.25, 76, 0.75),
           (36.0, 74, 0.75), (36.75, 72, 0.9), (38.0, 74, 0.8), (38.8, 79, 0.9), (40.4, 84, 2.5)]


def pluck(f, dur=2.6, brilho=0.18, tau=0.9):
    L = int(dur * SR); tt = np.arange(L) / SR
    s = np.sin(2 * np.pi * f * tt) * np.exp(-tt / tau) + brilho * np.sin(2 * np.pi * 2 * f * tt) * np.exp(-tt / (tau / 3.5)) \
        + 0.06 * np.sin(2 * np.pi * 3 * f * tt) * np.exp(-tt / (tau / 6))
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
        if t0 >= 14.9:  # baixo
            for tb in (t0, t0 + (t1 - t0) / 2) if t1 - t0 > 3 else (t0,):
                somar(bx, tb, amb.estereo(pluck(hz(notas[0] - 12 if notas[0] > 44 else notas[0]), 3.0, 0.3, 1.4), 0))
    # arpejos
    for i, (t0, passo) in enumerate(ARPEJO):
        if passo is None: continue
        t1 = ARPEJO[i + 1][0]
        notas = [n for (ta, ns) in ACORDES if ta <= t0 for n in [ns]][-1]
        altas = sorted({n + 12 for n in notas[1:]} | {n + 24 for n in notas[2:4]})
        k, tt0 = 0, t0 + 0.4
        while tt0 < t1 - 0.1:
            m = altas[k % len(altas)] if passo < 1 else int(rng.choice(altas))
            somar(arp, tt0, amb.estereo(pluck(hz(m)) * rng.uniform(0.6, 1), float(np.sin(k * 0.9) * 0.5)))
            k += 1; tt0 += passo
    for t0, m, d in MELODIA:
        somar(mel, t0, amb.estereo(pluck(hz(m), 3.2, 0.25, 1.3), 0.1))
    # brilho final
    for k, m in enumerate([72, 76, 79, 83, 84, 88]):
        somar(arp, 40.4 + 0.07 * k, amb.estereo(pluck(hz(m), 3.5, 0.15, 1.6) * 0.8, (k - 2.5) * 0.25))
    pad = filtrar(pad, pb(1700, 1) * pa(60))
    pad *= curva([(0, 0), (1.0, 0.35), (8, 0.8), (26, 0.8), (27.5, 0.55), (31.5, 0.8), (40.4, 1.1), (44.8, 0.9)])
    arp *= curva([(0, 1), (26, 1), (27, 0.6), (31, 0.6), (32, 1), (44.8, 1)])
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
    print('natureza...')
    nat = (vento_arvores() * db(-33) + riacho() * db(-33) + cachoeira() * db(-25)
           + chuva() * db(-30) + trovao() * db(-16))
    print('passaros...')
    aves = passaros()
    aves = aves / np.max(np.abs(aves)) * db(-12)
    aves = aves + reverb(aves, 1.1, 5000, 3) * db(-10)
    print('musica...')
    pad, arp, bx, mel = musica()
    mus = pad * db(-30) + arp * db(-19) + bx * db(-22) + mel * db(-15)
    mus = mus + reverb(mus, 2.4, 3000, 7) * db(-5)
    mix = nat + aves + mus
    mix *= curva([(0, 0), (0.5, 1), (43.0, 1), (44.8, 0)])
    mix = np.tanh(mix * 1.1) / 1.1
    mix *= db(-1.5) / np.max(np.abs(mix))
    with wave.open(SAIDA, 'wb') as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((mix * 32767).astype('<i2').T.copy().tobytes())
    print(f'ok -> {SAIDA} ({DUR} s, RMS {20 * np.log10(rms(mix)):.1f} dBFS)')


if __name__ == '__main__':
    main()
