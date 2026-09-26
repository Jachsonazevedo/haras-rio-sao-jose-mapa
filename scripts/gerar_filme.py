"""Filme de abertura do tour (tour/img/filme.mp4): trechos reais do voo de drone (set/2026)
com a toada caipira (gerar_musica_caipira.py) de trilha. As frases NÃO são gravadas na imagem —
entram por cima, no próprio tour (FRASES em tour/tour.js), para ficarem nítidas no celular em pé.

Uso: python scripts/gerar_musica_caipira.py && python scripts/gerar_filme.py
"""
import os, subprocess

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FF = r'D:\Programas\ffmpeg\bin\ffmpeg.exe'
VOO = os.path.join(RAIZ, 'tour', 'img', 'voo-1080.mp4')
MUSICA = os.path.join(os.environ.get('TEMP', '.'), 'toada_haras.wav')
SAIDA = os.path.join(RAIZ, 'tour', 'img', 'filme.mp4')
FUSAO = 0.8

# (início no voo, duração) — casados com as frases do tour
TOMADAS = [
    (1.0, 9.5),     # portaria — "Imagine uma chácara aqui. Sua."
    (28.5, 7.0),    # avenida e paisagem — "Um lugar de sossego…"
    (64.0, 6.5),    # avenida com os postes — "Rede elétrica pronta…"
    (49.0, 6.5),    # tubulação da água — "Água de poços artesianos…"
    (129.5, 6.0),   # vista das glebas — "Área de lazer em construção"
    (143.5, 7.0),   # chácaras com casas — "Muitas famílias…"
    (199.0, 6.8),   # de volta à portaria — "Agora é a sua vez."
]

total = sum(d for _, d in TOMADAS) - FUSAO * (len(TOMADAS) - 1)
partes = []
for i, (ini, dur) in enumerate(TOMADAS):
    partes.append(f'[0:v]trim=start={ini}:duration={dur},setpts=PTS-STARTPTS,fps=30,'
                  f'scale=1280:720:flags=lanczos,eq=saturation=1.08:contrast=1.03,format=yuv420p[v{i}]')
atual, acc = 'v0', TOMADAS[0][1]
for i in range(1, len(TOMADAS)):
    off = acc - FUSAO
    partes.append(f'[{atual}][v{i}]xfade=transition=fade:duration={FUSAO}:offset={off:.3f}[x{i}]')
    atual, acc = f'x{i}', off + TOMADAS[i][1]
partes.append(f'[{atual}]fade=t=in:st=0:d=0.8,fade=t=out:st={total - 1.4:.3f}:d=1.4[vf]')
partes.append(f'[1:a]atrim=0:{total:.3f},afade=t=out:st={total - 1.6:.3f}:d=1.6[af]')

subprocess.run([FF, '-y', '-v', 'error', '-i', VOO, '-i', MUSICA, '-filter_complex', ';'.join(partes),
                '-map', '[vf]', '-map', '[af]', '-c:v', 'libx264', '-preset', 'slow', '-crf', '27',
                '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '112k',
                '-movflags', '+faststart', SAIDA], check=True)
print(f'ok -> {SAIDA} ({total:.1f} s, {os.path.getsize(SAIDA) / 1e6:.1f} MB)')
