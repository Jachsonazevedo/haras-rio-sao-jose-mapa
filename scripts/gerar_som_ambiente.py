"""Gera o som ambiente do tour (tour/audio/ambiente.mp3).

Tudo sintetizado aqui (sem gravação de terceiros, sem direito autoral):
cachoeira ao fundo, riacho, vento nas folhas, pássaros (sabiá, bem-te-vi,
trinados, rolinha, piados) e uma música suave (acordes + notas de kalimba).

O laço é perfeito: todas as camadas são periódicas em DUR segundos (filtros e
reverberação por FFT circular, eventos que passam do fim voltam ao começo).
O arquivo sai com MARGEM segundos a mais de cada lado; o tour toca em laço a
janela [MARGEM, MARGEM + DUR] — qualquer atraso do decodificador MP3 não cria
emenda, porque qualquer janela de DUR segundos é um período completo.

Uso: python scripts/gerar_som_ambiente.py
"""
import os, subprocess, wave
import numpy as np

SR = 44100
DUR = 96                      # segundos do laço
MARGEM = 0.5                  # segundos extras antes e depois (ver docstring)
N = DUR * SR
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAIDA = os.path.join(RAIZ, 'tour', 'audio', 'ambiente.mp3')
FFMPEG = r'D:\Programas\ffmpeg\bin\ffmpeg.exe'

rng = np.random.default_rng(20260926)
t = np.arange(N) / SR
F = np.fft.rfftfreq(N, 1 / SR)
F1 = np.maximum(F, 1.0)


def filtrar(x, H):
    """Filtro circular no domínio da frequência (mantém o laço perfeito)."""
    return np.fft.irfft(np.fft.rfft(x, axis=-1) * H, n=N, axis=-1)


def ruido(canais=1):
    return rng.standard_normal((canais, N)) if canais > 1 else rng.standard_normal(N)


def rms(x):
    return float(np.sqrt(np.mean(x ** 2)) + 1e-12)


def db(v):
    return 10 ** (v / 20)


def passa_baixa(fc, ordem=2):
    return 1 / np.sqrt(1 + (F1 / fc) ** (2 * ordem))


def passa_alta(fc, ordem=2):
    return 1 / np.sqrt(1 + (fc / F1) ** (2 * ordem))


def lfo_lento(fc):
    """Modulação aleatória lenta e periódica (ruído filtrado bem abaixo de fc)."""
    m = filtrar(ruido(), passa_baixa(fc, 4))
    return m / (np.max(np.abs(m)) + 1e-12)


def estereo(mono, pan):
    """pan -1 (esq.) … +1 (dir.), potência constante."""
    a = (pan + 1) * np.pi / 4
    return np.vstack([mono * np.cos(a), mono * np.sin(a)])


def somar(buf, ini, sinal):
    """Soma um evento (2×L) no buffer circular a partir da amostra ini."""
    L = sinal.shape[1]
    ini %= N
    fim = ini + L
    if fim <= N:
        buf[:, ini:fim] += sinal
    else:
        k = N - ini
        buf[:, ini:] += sinal[:, :k]
        buf[:, :fim - N] += sinal[:, k:]


def reverb(x, rt=1.4, brilho=3500, seed=1):
    """Reverberação de ambiente aberto (IR de ruído com decaimento), circular."""
    r = np.random.default_rng(seed)
    L = int(2.6 * SR)
    tt = np.arange(L) / SR
    ir = r.standard_normal((2, L)) * np.exp(-6.9 * tt / rt)
    ir[:, :int(0.012 * SR)] = 0                       # pré-atraso
    irp = np.zeros((2, N)); irp[:, :L] = ir
    H = np.fft.rfft(irp, axis=-1) * passa_baixa(brilho, 1)
    y = np.fft.irfft(np.fft.rfft(x, axis=-1) * H, n=N, axis=-1)
    return y * (rms(x) / rms(y))


def envelope(L, ataque, soltura):
    e = np.ones(L)
    a = max(1, int(ataque * SR)); s = max(1, int(soltura * SR))
    a = min(a, L // 2); s = min(s, L // 2)
    e[:a] = np.sin(np.linspace(0, np.pi / 2, a)) ** 2
    e[-s:] = np.cos(np.linspace(0, np.pi / 2, s)) ** 2
    return e


def tom(freqs, dur, harm=(1.0, 0.12, 0.04), vib=(0, 0), aspero=0.0, ataque=0.012, soltura=0.03):
    """Nota com contorno de frequência (lista de pontos ao longo da nota)."""
    L = int(dur * SR)
    tt = np.arange(L) / SR
    f = np.interp(np.linspace(0, 1, L), np.linspace(0, 1, len(freqs)), freqs)
    if vib[0]:
        f = f * (1 + vib[1] * np.sin(2 * np.pi * vib[0] * tt))
    fase = 2 * np.pi * np.cumsum(f) / SR
    s = sum(h * np.sin((k + 1) * fase) for k, h in enumerate(harm) if (k + 1) * f.max() < SR / 2 - 500)
    if aspero:
        s = s * (1 - aspero + aspero * np.abs(np.sin(2 * np.pi * 75 * tt)))
    return s * envelope(L, ataque, soltura)


def juntar(partes):
    """partes = [(sinal, pausa_depois_s), ...] → uma frase."""
    out = []
    for s, p in partes:
        out.append(s); out.append(np.zeros(int(p * SR)))
    return np.concatenate(out)


# ---------------------------------------------------------------- água
def cachoeira():
    a, b = ruido(), ruido()
    x = np.vstack([a, 0.55 * a + 0.835 * b])                 # estéreo largo, meio correlacionado
    H = (F1 ** -0.35) * passa_alta(140, 2) * passa_baixa(2600, 2) * (1 + 0.6 * np.exp(-((F1 - 900) / 700) ** 2))
    x = filtrar(x, H)
    mod = 1 + 0.10 * lfo_lento(0.15) + 0.06 * lfo_lento(3.0)  # respiração e respingos
    return x * mod / rms(x)


def riacho():
    buf = np.zeros((2, N))
    n = int(DUR * 28)
    for _ in range(n):
        f0 = rng.uniform(450, 1700)
        d = rng.uniform(0.015, 0.05)
        L = int(d * SR); tt = np.arange(L) / SR
        f = f0 * (1 + 0.45 * tt / d)                          # bolha: frequência sobe
        s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt / (d / 3.5)) * envelope(L, 0.002, 0.004)
        somar(buf, rng.integers(N), estereo(s * rng.uniform(0.3, 1.0), rng.uniform(-0.8, 0.8)))
    buf = filtrar(buf, passa_baixa(3000, 1))
    return buf / rms(buf)


def vento():
    a, b = ruido(), ruido()
    x = filtrar(np.vstack([a, 0.4 * a + 0.92 * b]), passa_alta(250, 2) * passa_baixa(1800, 2))
    rajada = np.clip(0.55 + 0.45 * lfo_lento(0.08), 0.1, 1.0)
    return x * rajada / rms(x)


# ---------------------------------------------------------------- pássaros
def sabia(paleta):
    partes = []
    for _ in range(rng.integers(4, 8)):
        f = rng.choice(paleta)
        tipo = rng.integers(4)
        d = rng.uniform(0.10, 0.30)
        if tipo == 0:   contorno = [f, f * 1.04]
        elif tipo == 1: contorno = [f * 0.85, f * 1.12]
        elif tipo == 2: contorno = [f * 1.15, f * 0.9]
        else:           contorno = [f, f, f * 1.25, f * 1.25]
        vib = (rng.uniform(25, 40), 0.018) if rng.random() < 0.35 else (0, 0)
        partes.append((tom(contorno, d, vib=vib), rng.uniform(0.05, 0.14)))
    return juntar(partes)


def bem_te_vi():
    h = (1.0, 0.35, 0.18, 0.06)
    return juntar([
        (tom([2700, 3150], 0.11, harm=h, aspero=0.25), 0.07),
        (tom([3350, 3300], 0.09, harm=h, aspero=0.25), 0.08),
        (tom([2600, 3600, 3700, 3000], 0.34, harm=h, aspero=0.25, soltura=0.08), 0.0),
    ])


def trinado():
    partes = []
    k = rng.integers(8, 20); topo = rng.uniform(5200, 6400); base = topo * rng.uniform(0.6, 0.72)
    for i in range(k):
        g = 0.5 + 0.5 * np.sin(np.pi * (i + 1) / (k + 1))
        partes.append((g * tom([topo, base], 0.035, harm=(1, 0.05), ataque=0.004, soltura=0.012), 0.032))
    return juntar(partes)


def rolinha():
    partes = []
    for _ in range(rng.integers(3, 5)):
        partes.append((tom([610, 640, 600], 0.2, harm=(1, 0.08), ataque=0.05, soltura=0.09), 0.22))
        partes.append((tom([580, 600, 560], 0.2, harm=(1, 0.08), ataque=0.05, soltura=0.09), 1.1))
    return juntar(partes)


def piados():
    partes = []
    for _ in range(rng.integers(2, 6)):
        f = rng.uniform(6200, 7600)
        partes.append((tom([f * 0.9, f * 1.1], 0.04, harm=(1,), ataque=0.004, soltura=0.015), rng.uniform(0.08, 0.3)))
    return juntar(partes)


def passaros():
    perto, longe = np.zeros((2, N)), np.zeros((2, N))

    def espalhar(n, gerar, alvo, ganho, pan, jitter=0.25):
        for i in range(n):
            ini = int(((i + rng.uniform(0, 1 - jitter)) / n) * N)
            s = gerar()
            somar(alvo, ini, estereo(s * ganho * rng.uniform(0.75, 1.0), float(np.clip(pan + rng.normal(0, 0.08), -1, 1))))

    # dois sabiás com "vozes" próprias, um de cada lado
    p1 = rng.uniform(1900, 3300, 6); p2 = rng.uniform(2100, 3500, 6)
    espalhar(12, lambda: sabia(p1), perto, 1.0, -0.55)
    espalhar(10, lambda: sabia(p2), longe, 0.9, 0.6)
    espalhar(4, bem_te_vi, perto, 0.8, 0.35)
    espalhar(3, bem_te_vi, longe, 0.7, -0.7)
    espalhar(8, trinado, longe, 0.6, 0.1)
    espalhar(5, rolinha, perto, 0.55, -0.2)
    espalhar(14, piados, longe, 0.35, 0.0, jitter=0.1)
    longe = filtrar(longe, passa_baixa(4200, 1))
    return perto, longe


# ---------------------------------------------------------------- música suave
def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


ACORDES = [                       # C maj9 · A m9 · F maj9 · G6sus — 12 s cada, 2 voltas
    [48, 55, 64, 71, 74],
    [45, 52, 60, 67, 71],
    [41, 48, 57, 64, 67],
    [43, 50, 57, 60, 64],
]
PESOS = [0.45, 0.35, 0.3, 0.25, 0.2]
PENTA = [72, 74, 76, 79, 81, 84, 86, 88]   # dó pentatônico, oitava 5–6


def musica():
    pad, kal = np.zeros((2, N)), np.zeros((2, N))
    passo, sobrepos = 12.0, 4.0
    L = int((passo + sobrepos) * SR)
    tt = np.arange(L) / SR
    jan = np.ones(L); s = int(sobrepos * SR)
    jan[:s] = np.sin(np.linspace(0, np.pi / 2, s)) ** 2
    jan[-s:] = np.cos(np.linspace(0, np.pi / 2, s)) ** 2
    for i in range(int(DUR / passo)):
        notas = ACORDES[i % len(ACORDES)]
        for j, (m, p) in enumerate(zip(notas, PESOS)):
            f = hz(m); v = np.zeros(L)
            for d in (-0.0018, 0.0, 0.0021):
                fase = 2 * np.pi * f * (1 + d) * tt + rng.uniform(0, 2 * np.pi)
                v += np.sin(fase) + 0.07 * np.sin(3 * fase)
            v *= p * jan * (1 + 0.08 * np.sin(2 * np.pi * 0.11 * tt + j))
            somar(pad, int((i * passo - sobrepos / 2) * SR), estereo(v, (j - 2) * 0.25))
        # kalimba: 3–4 notas espaçadas, das notas que combinam com o acorde
        classes = {n % 12 for n in notas}
        boas = [m for m in PENTA if m % 12 in classes] or PENTA
        for _ in range(rng.integers(3, 5)):
            f = hz(int(rng.choice(boas)))
            Lk = int(2.4 * SR); tk = np.arange(Lk) / SR
            k = (np.sin(2 * np.pi * f * tk) * np.exp(-tk / 0.9)
                 + 0.18 * np.sin(2 * np.pi * 2 * f * tk) * np.exp(-tk / 0.25)) * envelope(Lk, 0.003, 0.3)
            ini = int((i * passo + rng.uniform(0.5, passo - 1)) * SR)
            somar(kal, ini, estereo(k * rng.uniform(0.6, 1.0), rng.uniform(-0.5, 0.5)))
    pad = filtrar(pad, passa_baixa(1600, 1) * passa_alta(70, 2))
    return pad / rms(pad), kal / np.max(np.abs(kal))


# ---------------------------------------------------------------- mixagem
def main():
    print('cachoeira, riacho, vento...')
    agua = cachoeira() * db(-28) + riacho() * db(-35)
    ar = vento() * db(-38)
    print('pássaros...')
    perto, longe = passaros()
    pico = max(np.max(np.abs(perto)), np.max(np.abs(longe)))
    perto, longe = perto / pico, longe / pico
    aves = perto * db(-11) + longe * db(-18)
    aves = aves + reverb(aves, rt=1.1, brilho=5000, seed=3) * db(-9)
    print('música...')
    pad, kal = musica()
    mus = pad * db(-33) + kal * db(-26)
    mus = mus + reverb(mus, rt=2.2, brilho=2500, seed=7) * db(-6)

    mix = agua + ar + aves + mus
    mix = np.tanh(mix * 1.1) / 1.1                               # limitador suave
    mix *= db(-2) / np.max(np.abs(mix))
    print(f'RMS {20*np.log10(rms(mix)):.1f} dBFS · pico -2 dBFS · {DUR} s')

    m = int(MARGEM * SR)
    ext = np.concatenate([mix[:, -m:], mix, mix[:, :m]], axis=1)  # margem circular
    pcm = (np.clip(ext, -1, 1) * 32767).astype('<i2').T.copy()
    os.makedirs(os.path.dirname(SAIDA), exist_ok=True)
    wav = os.path.join(os.environ.get('TEMP', '.'), 'ambiente_tour.wav')
    with wave.open(wav, 'wb') as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
    subprocess.run([FFMPEG, '-y', '-loglevel', 'error', '-i', wav, '-c:a', 'libmp3lame', '-b:a', '128k', SAIDA], check=True)
    os.remove(wav)
    print('ok ->', SAIDA, f'{os.path.getsize(SAIDA)/1e6:.2f} MB')


if __name__ == '__main__':
    main()
