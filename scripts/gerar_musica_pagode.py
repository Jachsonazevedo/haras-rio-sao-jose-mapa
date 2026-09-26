"""Pagode de viola instrumental (modão caipira animado) para o filme de abertura do tour.
Saída: %TEMP%/pagode_haras.wav → usado por gerar_filme.py.

Composição e síntese próprias (sem gravação de terceiros, sem direito autoral) — no estilo
do pagode de viola (linha Tião Carreiro), sem copiar nenhuma melodia existente:
- viola caipira em Cebolão (Mi) com ponteado em semicolcheias, corridas descendentes,
  ligados (hammer-on) e rasqueados nos fins de frase;
- a "dupla" em terças (melodia de cima + terça diatônica abaixo) nas partes A e B;
- violão na batida sincopada do pagode (baixo alternado + acorde abafado no contratempo).
118 bpm, 2/4, Mi maior. Forma: introdução de viola → A → A' → B → volta da introdução → final.

Uso: python scripts/gerar_musica_pagode.py && python scripts/gerar_filme.py
"""
import os, wave
import numpy as np

SR = 44100
BPM = 118
SEMI = 60 / BPM / 4            # semicolcheia
COMPASSO = 8 * SEMI            # 2/4
SAIDA = os.path.join(os.environ.get('TEMP', '.'), 'pagode_haras.wav')
rng = np.random.default_rng(1960)

# ---------------------------------------------------------------- composição (original)
R = None  # pausa
# cada compasso: (acorde, [(nota, semicolcheias), ...]) — soma 8 por compasso
INTRO = [
    ('E',  [(76, 1), (75, 1), (73, 1), (71, 1), (68, 2), (71, 2)]),
    ('E',  [(73, 1), (71, 1), (68, 1), (64, 1), (68, 4)]),
    ('B7', [(69, 1), (71, 1), (73, 1), (71, 1), (69, 2), (66, 2)]),
    ('B7', [(75, 1), (73, 1), (71, 1), (69, 1), (66, 4)]),
    ('B7', [(71, 2), (69, 1), (71, 1), (73, 2), (75, 2)]),
    ('B7', [(76, 1), (75, 1), (73, 1), (71, 1), (69, 2), (71, 2)]),
    ('E',  [(68, 1), (71, 1), (76, 1), (71, 1), (68, 2), (64, 2)]),
    ('E',  'RASQ'),
]
PARTE_A = [
    ('E',  [(71, 3), (71, 3), (73, 2)]),
    ('E',  [(71, 3), (68, 3), (71, 2)]),
    ('B7', [(73, 3), (73, 3), (75, 2)]),
    ('B7', [(73, 3), (71, 3), (69, 2)]),
    ('B7', [(69, 3), (69, 3), (71, 2)]),
    ('B7', [(73, 2), (71, 2), (69, 2), (66, 2)]),
    ('E',  [(68, 6), (71, 2)]),
    ('E',  [(68, 4), ('run', [71, 73, 75, 76])]),
]
PARTE_A2 = PARTE_A[:6] + [
    ('E',  [(68, 3), (71, 3), (76, 2)]),
    ('E',  [(76, 4), ('run', [75, 73, 71, 73])]),
]
PARTE_B = [
    ('E7', [(74, 2), (74, 2), (76, 2), (74, 2)]),
    ('E7', [(71, 4), (68, 2), (71, 2)]),
    ('A',  [(73, 3), (73, 3), (76, 2)]),
    ('A',  [(73, 2), (69, 2), (73, 4)]),
    ('E',  [(71, 3), (71, 3), (73, 2)]),
    ('B7', [(75, 2), (73, 2), (71, 2), (69, 2)]),
    ('E',  [(68, 4), (71, 2), (68, 2)]),
    ('E',  [(64, 4), ('run', [64, 68, 71, 75])]),
]
FINAL = [('E', 'FIM1'), ('E', 'FIM2'), ('E', 'SOA')]
FORMA = [(INTRO, False), (PARTE_A, True), (PARTE_A2, True), (PARTE_B, True), (INTRO[:7], False), (FINAL, False)]

ESCALA = [4, 6, 8, 9, 11, 1, 3]  # Mi maior
VIOLA_ACORDE = {'E': [59, 64, 68, 71, 76], 'E7': [59, 62, 68, 71, 76], 'A': [57, 64, 69, 73, 76], 'B7': [59, 63, 66, 69, 75]}
VIOLAO = {  # baixo, baixo alternado, acorde
    'E': (40, 47, [52, 56, 59, 64]), 'E7': (40, 47, [52, 56, 62, 64]),
    'A': (45, 40, [57, 61, 64, 69]), 'B7': (47, 42, [51, 57, 59, 66]),
}


def terca_abaixo(m):
    if m % 12 not in ESCALA:
        return m - 3
    i = ESCALA.index(m % 12)
    return m - (m % 12 - ESCALA[(i - 2) % 7]) % 12


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


# ---------------------------------------------------------------- síntese das cordas
def corda(f, dur, tau0, queda_agudos, pos, brilho=1.0, inarm=6e-5, amp=1.0, abafar=None):
    L = int(dur * SR)
    t = np.arange(L) / SR
    s = np.zeros(L)
    for k in range(1, int(min(40, 11000 / f)) + 1):
        fk = k * f * np.sqrt(1 + inarm * k * k)
        if fk > SR / 2 - 1000:
            break
        a = abs(np.sin(np.pi * k * pos)) / k ** (1.15 - 0.25 * brilho)
        tau = tau0 / (1 + queda_agudos * (k - 1) ** 1.3)
        s += a * np.sin(2 * np.pi * fk * t + rng.uniform(0, 2 * np.pi)) * np.exp(-t / tau)
    if abafar:  # mão direita abafando (batida do violão)
        s *= np.exp(-np.maximum(0, t - abafar) / 0.03)
    at = int(0.002 * SR); s[:at] *= np.linspace(0, 1, at)
    fim = int(0.03 * SR); s[-fim:] *= np.linspace(1, 0, fim)
    n = int(0.005 * SR)
    s[:n] += np.convolve(rng.standard_normal(n) * np.exp(-np.arange(n) / (0.001 * SR)) * 0.1, np.ones(3) / 3, 'same')
    return amp * s / (np.max(np.abs(s)) + 1e-9)


def viola(m, dur, ligado=False, oitava=False, amp=1.0):
    f = hz(m)
    s = corda(f, dur, 1.6, 0.06, 0.12, brilho=1.4) + 0.85 * corda(f * 2 ** (5 / 1200), dur, 1.5, 0.06, 0.12, brilho=1.4)
    if oitava:
        s += 0.4 * corda(f * 2 * 2 ** (-4 / 1200), dur, 1.2, 0.08, 0.12, brilho=1.4)
    d = int(0.007 * SR)
    s = np.concatenate([s[:d] * 0.6, s])[:len(s)]
    if ligado:
        g = int(0.05 * SR)
        s = np.concatenate([corda(hz(m - 2), 0.07, 1.0, 0.06, 0.12, brilho=1.4)[:g] * 0.9, s[:len(s) - g]])
    return amp * s / (np.max(np.abs(s)) + 1e-9)


def violao(m, dur, amp=1.0, abafar=None):
    return corda(hz(m), dur, 1.2, 0.28, 0.2, brilho=0.7, inarm=2e-5, amp=amp, abafar=abafar)


# ---------------------------------------------------------------- arranjo
n_comp = sum(len(p) for p, _ in FORMA)
TOTAL = n_comp * COMPASSO + 2.5
N = int(TOTAL * SR)
vio, gui = np.zeros((2, N)), np.zeros((2, N))


def por(buf, t0, s, pan, humano=0.006):
    i = max(0, int((t0 + rng.uniform(-humano, humano)) * SR))
    j = min(N, i + len(s))
    a = (pan + 1) * np.pi / 4
    buf[0, i:j] += s[:j - i] * np.cos(a)
    buf[1, i:j] += s[:j - i] * np.sin(a)


def rasqueado(t, acorde, amp=0.5, dur=0.5, sobe=False):
    notas = VIOLA_ACORDE[acorde][::-1] if sobe else VIOLA_ACORDE[acorde]
    for k, m in enumerate(notas):
        por(vio, t + 0.011 * k, viola(m, dur, oitava=m < 66, amp=amp * (0.8 + 0.2 * k / 4)), 0.1, humano=0.002)


c = 0
for parte, dupla in FORMA:
    for acorde, frase in parte:
        t0 = c * COMPASSO
        # violão: batida do pagode (baixo 0 e 4; acorde abafado em 3, 6 e 7)
        b, alt, notas = VIOLAO[acorde]
        if frase in ('FIM2', 'SOA'):
            if frase == 'FIM2':
                por(gui, t0, violao(b, 2.6, amp=0.9), -0.15)
                for k, m in enumerate(notas):
                    por(gui, t0 + 0.012 * k, violao(m, 2.6, amp=0.4), 0.2)
            c += 1
            continue
        por(gui, t0, violao(b, 0.5, amp=0.9, abafar=0.35), -0.15)
        por(gui, t0 + 4 * SEMI, violao(alt, 0.5, amp=0.8, abafar=0.35), -0.15)
        for slot, forca in ((3, 0.42), (6, 0.36), (7, 0.3)):
            for k, m in enumerate(notas):
                por(gui, t0 + slot * SEMI + 0.009 * k, violao(m, 0.3, amp=forca, abafar=0.1), 0.2, humano=0.003)
        # viola
        if frase == 'RASQ':
            rasqueado(t0, acorde, 0.55, 0.3); rasqueado(t0 + 3 * SEMI, acorde, 0.6, 0.6, sobe=True)
        elif frase == 'FIM1':
            rasqueado(t0, 'B7', 0.55, 0.3); rasqueado(t0 + 3 * SEMI, 'B7', 0.55, 0.3, sobe=True)
            rasqueado(t0 + 6 * SEMI, 'B7', 0.6, 0.3)
            rasqueado(t0 + COMPASSO, 'E', 0.7, 2.8, sobe=True)
        else:
            t = t0
            for item in frase:
                if item[0] == 'run':
                    for m in item[1]:
                        por(vio, t, viola(m, SEMI + 0.18, amp=0.62), 0.25)
                        if dupla:
                            por(vio, t + 0.003, viola(terca_abaixo(m), SEMI + 0.18, oitava=True, amp=0.45), -0.1)
                        t += SEMI
                    continue
                m, n = item
                dur = n * SEMI
                if m is not R:
                    lig = n >= 3
                    amp = 0.8 if dupla else 0.72
                    por(vio, t, viola(m, dur + 0.22, ligado=lig, amp=amp), 0.25)
                    if dupla or n >= 4:
                        por(vio, t + 0.003, viola(terca_abaixo(m), dur + 0.22, ligado=lig, oitava=True, amp=0.58), -0.1)
                t += dur
        c += 1


# ---------------------------------------------------------------- caixa, reverb, mixagem
def filtro(x, H):
    n = x.shape[-1]
    F = np.maximum(np.fft.rfftfreq(n, 1 / SR), 1)
    return np.fft.irfft(np.fft.rfft(x, axis=-1) * H(F), n=n, axis=-1)


def caixa_viola(F):
    return (1 + 0.45 * np.exp(-((F - 240) / 60) ** 2) + 0.3 * np.exp(-((F - 500) / 100) ** 2)
            + 0.45 * np.exp(-((F - 3000) / 1000) ** 2)) / np.sqrt(1 + (F / 8000) ** 4) / np.sqrt(1 + (110 / F) ** 4)


def caixa_violao(F):
    return (1 + 0.6 * np.exp(-((F - 105) / 30) ** 2) + 0.3 * np.exp(-((F - 210) / 50) ** 2)) \
        / np.sqrt(1 + (F / 4200) ** 4) / np.sqrt(1 + (60 / F) ** 4)


def reverb(x, rt=0.9):
    L = int(1.6 * SR)
    t = np.arange(L) / SR
    ir = np.random.default_rng(5).standard_normal((2, L)) * np.exp(-6.9 * t / rt)
    ir[:, :int(0.012 * SR)] = 0
    n = x.shape[1] + L
    y = np.fft.irfft(np.fft.rfft(x, n, axis=-1) * np.fft.rfft(ir, n, axis=-1), n, axis=-1)[:, :x.shape[1]]
    y = filtro(y, lambda F: 1 / np.sqrt(1 + (F / 5000) ** 2))
    return y / (np.sqrt(np.mean(y ** 2)) + 1e-9) * np.sqrt(np.mean(x ** 2))


vio = filtro(vio, caixa_viola)
gui = filtro(gui, caixa_violao)
seco = vio / np.max(np.abs(vio)) + gui / np.max(np.abs(gui)) * 0.62
mix = seco + 0.22 * reverb(seco)
mix = np.tanh(mix * 1.25) / 1.25
fade = int(1.2 * SR)
mix[:, -fade:] *= np.linspace(1, 0, fade) ** 2
mix *= 10 ** (-1.5 / 20) / np.max(np.abs(mix))

with wave.open(SAIDA, 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((mix * 32767).astype('<i2').T.copy().tobytes())
print(f'ok -> {SAIDA} ({TOTAL:.1f} s, {BPM} bpm, {n_comp} compassos)')
