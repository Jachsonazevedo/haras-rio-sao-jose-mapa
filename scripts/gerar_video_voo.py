"""Versões leves do "Voo pelo Haras" com a trilha de natureza (gerar_trilha_voo.py).

Mestre de imagem: tour/img/voo-1080.mp4 (sem som; não é mais usado pela página).
Saídas (H.264 + AAC, faststart, níveis compatíveis com celulares antigos):
  tour/img/voo-720.mp4  → computador e tablet (1280×720, ~1,1 Mbps)
  tour/img/voo-540.mp4  → celular (960×540, ~0,7 Mbps)
Atualiza tour/voo.json (video / video_movel) — depois rodar preparar_tour.py.

Uso: python scripts/gerar_trilha_voo.py && python scripts/gerar_video_voo.py && python scripts/preparar_tour.py
"""
import json, os, subprocess

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FF = r'D:\Programas\ffmpeg\bin\ffmpeg.exe'
IMG = os.path.join(RAIZ, 'tour', 'img')
MESTRE = os.path.join(IMG, 'voo-1080.mp4')
TRILHA = os.path.join(os.environ.get('TEMP', '.'), 'trilha_voo.wav')

VERSOES = [  # (arquivo, largura, altura, crf, teto kbps, nível)
    ('voo-720.mp4', 1280, 720, 30, 1100, '3.1'),
    ('voo-540.mp4', 960, 540, 31, 700, '3.1'),
]
for nome, w, h, crf, teto, nivel in VERSOES:
    saida = os.path.join(IMG, nome)
    tmp = saida + '.tmp.mp4'
    subprocess.run([FF, '-y', '-v', 'error', '-i', MESTRE, '-i', TRILHA, '-map', '0:v', '-map', '1:a',
                    '-vf', f'scale={w}:{h}:flags=lanczos', '-c:v', 'libx264', '-preset', 'slow', '-crf', str(crf),
                    '-maxrate', f'{teto}k', '-bufsize', f'{2 * teto}k', '-profile:v', 'high', '-level', nivel,
                    '-pix_fmt', 'yuv420p', '-g', '60', '-c:a', 'aac', '-b:a', '96k', '-shortest',
                    '-movflags', '+faststart', tmp], check=True)
    os.replace(tmp, saida)
    print(f'ok -> {nome} {os.path.getsize(saida) / 1e6:.1f} MB')

arq = os.path.join(RAIZ, 'tour', 'voo.json')
voo = json.load(open(arq, encoding='utf-8'))
voo['video'] = 'img/voo-720.mp4?v=2'
voo['video_movel'] = 'img/voo-540.mp4?v=2'
json.dump(voo, open(arq, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('voo.json atualizado')
