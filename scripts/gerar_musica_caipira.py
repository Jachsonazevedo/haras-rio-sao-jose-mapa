"""Toada caipira instrumental para o filme de abertura do tour (tour/audio/toada.wav → usado por gerar_filme.py).

Composição e síntese próprias (sem gravação de terceiros, sem direito autoral):
viola caipira em afinação Cebolão (Mi) fazendo a melodia em terças — o jeito das duplas
caipiras — com "ponteado" (ligado de uma nota abaixo) nas notas longas, e violão de nylon
na levada de toada/guarânia (baixo no 1º tempo, acorde nos tempos 2 e 3). 80 bpm, 3/4, Mi maior.
Cordas por síntese aditiva: parciais com decaimento próprio, posição da palheta, leve
inarmonicidade, cordas duplas (par em uníssono desafinado e oitava nos pares graves da viola),
ressonância de caixa e reverberação curta.

Uso: python scripts/gerar_musica_caipira.py
"""
import os, wave
import numpy as np

SR = 44100
BPM = 80
BATIDA = 60 / BPM
COMPASSO = 3 * BATIDA
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAIDA = os.path.join(os.environ.get('TEMP', '.'), 'toada_haras.wav')

rng = np.random.default_rng(1974)

# ---------------------------------------------------------------- harmonia e melodia
# 2 compassos de introdução (ponteio da viola) + 16 da toada + acorde final
HARMONIA = ['E', 'E',
            'E', 'E', 'B7', 'B7', 'B7', 'B7', 'E', 'E',
            'E', 'E7', 'A', 'A', 'E', 'B7', 'E', 'E']
ACORDE = {  # (baixo, baixo alternado, notas do acorde para o violão)
    'E':  (40, 47, [56, 59, 64]),
    'E7': (40, 47, [56, 62, 64]),
    'A':  (45, 40, [57, 61, 64]),
    'B7': (47, 42, [51, 57, 59]),
}
# melodia (voz de cima) por compasso da toada: (nota MIDI, tempos)
MELODIA = [
    [(71, 2), (73, 1)], [(71, 1), (68, 1), (71, 1)], [(73, 2), (71, 1)], [(69, 3)],
    [(69, 1), (71, 1), (73, 1)], [(75, 2), (73, 1)], [(71, 3)], [(68, 1), (71, 1), (76, 1)],
    [(76, 2), (75, 1)], [(74, 2), (71, 1)], [(73, 2), (76, 1)], [(73, 1), (69, 1), (73, 1)],
    [(71, 2), (68, 1)], [(73, 1), (71, 1), (69, 1)], [(68, 3)], [(68, 3)],
]
ESCALA = [4, 6, 8, 9, 11, 1, 3]  # Mi maior (classes de altura)


def terca_abaixo(m):
    """terça diatônica abaixo (Mi maior); notas fora da escala (Ré natural do E7) → Si."""
    if m % 12 not in ESCALA:
        return m - 3
    i = ESCALA.index(m % 12)
    alvo = ESCALA[(i - 2) % 7]
    d = (m % 12 - alvo) % 12
    return m - d


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


# ---------------------------------------------------------------- síntese das cordas
def corda(f, dur, tau0, queda_agudos, pos, brilho=1.0, inarm=6e-5, amp=1.0):
    L = int(dur * SR)
    t = np.arange(L) / SR
    s = np.zeros(L)
    K = int(min(40, 11000 / f))
    for k in range(1, K + 1):
        fk = k * f * np.sqrt(1 + inarm * k * k)
        if fk > SR / 2 - 1000:
            break
        a = abs(np.sin(np.pi * k * pos)) / k ** (1.15 - 0.25 * brilho)
        tau = tau0 / (1 + queda_agudos * (k - 1) ** 1.3)
        s += a * np.sin(2 * np.pi * fk * t + rng.uniform(0, 2 * np.pi)) * np.exp(-t / tau)
    ataque = int(0.0025 * SR)
    s[:ataque] *= np.linspace(0, 1, ataque)
    fim = int(0.05 * SR)
    s[-fim:] *= np.linspace(1, 0, fim)
    # ruído da palheta/unha
    n = int(0.006 * SR)
    clique = rng.standard_normal(n) * np.exp(-np.arange(n) / (0.0012 * SR)) * 0.08
    s[:n] += np.convolve(clique, np.ones(4) / 4, 'same')
    return amp * s / (np.max(np.abs(s)) + 1e-9)


def viola(m, dur, ponteado=False, oitava=False, amp=1.0):
    """par de cordas de aço (uníssono desafinado; oitava nos pares graves) com ligado opcional"""
    f = hz(m)
    s = corda(f, dur, 1.9, 0.07, 0.13, brilho=1.3) + 0.85 * corda(f * 2 ** (4 / 1200), dur, 1.8, 0.07, 0.13, brilho=1.3)
    if oitava:
        s += 0.4 * corda(f * 2 * 2 ** (-3 / 1200), dur, 1.4, 0.09, 0.13, brilho=1.3)
    atraso = int(0.009 * SR)  # a palheta passa pelas duas cordas do par
    s = np.concatenate([s[:atraso] * 0.6, s])[:len(s)]
    if ponteado:  # ligado: começa um tom abaixo e sobe
        g = int(0.075 * SR)
        baixo = corda(hz(m - 2), 0.09, 1.2, 0.07, 0.13, brilho=1.3)[:g]
        s = np.concatenate([baixo * 0.9, s[:len(s) - g]])
    return amp * s / (np.max(np.abs(s)) + 1e-9)


def violao(m, dur, amp=1.0):
    return corda(hz(m), dur, 1.3, 0.3, 0.2, brilho=0.6, inarm=2e-5, amp=amp)


# ---------------------------------------------------------------- arranjo
TOTAL = len(HARMONIA) * COMPASSO + 4.0
N = int(TOTAL * SR)
vio_l = np.zeros((2, N))   # viola (melodia)
gui_l = np.zeros((2, N))   # violão


def por(buf, t0, s, pan, humano=0.012):
    i = int((t0 + rng.uniform(-humano, humano) * 0.5) * SR)
    i = max(0, i)
    j = min(N, i + len(s))
    a = (pan + 1) * np.pi / 4
    buf[0, i:j] += s[:j - i] * np.cos(a)
    buf[1, i:j] += s[:j - i] * np.sin(a)


for c, nome in enumerate(HARMONIA):
    t0 = c * COMPASSO
    baixo, alt, notas = ACORDE[nome]
    b = baixo if c % 2 == 0 else alt
    ult = c == len(HARMONIA) - 1
    por(gui_l, t0, violao(b, 3.5 if ult else 2.2, amp=0.95), -0.15)
    if ult:
        for k, n in enumerate(notas):
            por(gui_l, t0 + 0.03 * k, violao(n, 4.0, amp=0.45), 0.2)
        continue
    for tempo in (1, 2):
        for k, n in enumerate(notas):
            por(gui_l, t0 + tempo * BATIDA + 0.018 * k, violao(n, 1.2, amp=0.38 if tempo == 1 else 0.3), 0.2)

# introdução: ponteio da viola nas cordas soltas do Cebolão (Si, Mi, Sol#, Si, Mi)
for c in range(2):
    for k, m in enumerate([59, 64, 68, 71, 76, 71]):
        por(vio_l, c * COMPASSO + k * BATIDA / 2, viola(m, 1.6, oitava=m < 66, amp=0.55), 0.1)

# toada em terças
for i, compasso in enumerate(MELODIA):
    t = (2 + i) * COMPASSO
    for m, tempos in compasso:
        dur = tempos * BATIDA
        ult = i == len(MELODIA) - 1
        soa = dur + (3.0 if ult else 0.45)
        pont = tempos >= 2 and not ult
        por(vio_l, t, viola(m, soa, ponteado=pont, amp=0.8), 0.25)
        por(vio_l, t + 0.004, viola(terca_abaixo(m), soa, ponteado=pont, oitava=True, amp=0.62), -0.1)
        t += dur
# acorde final na viola
tf = len(HARMONIA) * COMPASSO - COMPASSO
for k, m in enumerate([52, 59, 64, 68, 71]):
    por(vio_l, tf + COMPASSO + 0.05 * k, viola(m, 3.6, oitava=m < 66, amp=0.5), 0.0)


# ---------------------------------------------------------------- caixa, reverb, mixagem
def filtro(x, H):
    n = x.shape[-1]
    F = np.fft.rfftfreq(n, 1 / SR)
    return np.fft.irfft(np.fft.rfft(x, axis=-1) * H(np.maximum(F, 1)), n=n, axis=-1)


def caixa_viola(F):
    return (1 + 0.5 * np.exp(-((F - 230) / 60) ** 2) + 0.35 * np.exp(-((F - 480) / 90) ** 2)
            + 0.3 * np.exp(-((F - 2800) / 900) ** 2)) / np.sqrt(1 + (F / 7500) ** 4) / np.sqrt(1 + (90 / F) ** 4)


def caixa_violao(F):
    return (1 + 0.6 * np.exp(-((F - 105) / 30) ** 2) + 0.35 * np.exp(-((F - 210) / 50) ** 2)) \
        / np.sqrt(1 + (F / 3800) ** 4) / np.sqrt(1 + (60 / F) ** 4)


def reverb(x, rt=1.3):
    L = int(2.2 * SR)
    t = np.arange(L) / SR
    ir = np.random.default_rng(5).standard_normal((2, L)) * np.exp(-6.9 * t / rt)
    ir[:, :int(0.015 * SR)] = 0
    n = x.shape[1] + L
    y = np.fft.irfft(np.fft.rfft(x, n, axis=-1) * np.fft.rfft(ir, n, axis=-1), n, axis=-1)[:, :x.shape[1]]
    y = filtro(y, lambda F: 1 / np.sqrt(1 + (F / 4500) ** 2))
    return y / (np.sqrt(np.mean(y ** 2)) + 1e-9) * np.sqrt(np.mean(x ** 2))


vio_l = filtro(vio_l, caixa_viola)
gui_l = filtro(gui_l, caixa_violao)
seco = vio_l / np.max(np.abs(vio_l)) * 0.95 + gui_l / np.max(np.abs(gui_l)) * 0.6
mix = seco + 0.32 * reverb(seco)
mix = np.tanh(mix * 1.2) / 1.2
fade = int(1.5 * SR)
mix[:, -fade:] *= np.linspace(1, 0, fade) ** 2
mix *= 10 ** (-1.5 / 20) / np.max(np.abs(mix))

pcm = (mix * 32767).astype('<i2').T.copy()
with wave.open(SAIDA, 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
print(f'ok -> {SAIDA} ({TOTAL:.1f} s, {BPM} bpm, compasso {COMPASSO:.2f} s)')
