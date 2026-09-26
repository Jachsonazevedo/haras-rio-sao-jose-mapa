# -*- coding: utf-8 -*-
"""Servidor local para gerar as IMAGENS 3D do app (render.html).

Serve a pasta do app (como o `python -m http.server`) e aceita POST /salvar?nome=<arquivo>
com o JPG/PNG gerado no navegador, gravando em assets/fotos/3d/ (ou assets/ para a planta).
Só roda na máquina local; não faz parte do site publicado.

Uso:  python scripts/servidor_render.py 8766   → abrir http://localhost:8766/render.html
"""
import os
import re
import sys
import json
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DESTINOS = {
    "fotos": os.path.join(RAIZ, "assets", "fotos", "3d"),
    "assets": os.path.join(RAIZ, "assets"),
    "tour": os.path.join(RAIZ, "tour", "img"),
}
NOME_OK = re.compile(r"^[a-z0-9][a-z0-9-]{1,60}\.(jpg|png)$")


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=RAIZ, **k)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_POST(self):
        u = urlparse(self.path)
        if u.path != "/salvar":
            self.send_error(404)
            return
        q = parse_qs(u.query)
        nome = (q.get("nome") or [""])[0]
        destino = DESTINOS.get((q.get("pasta") or ["fotos"])[0])
        if not NOME_OK.match(nome) or not destino:
            self.send_error(400, "nome ou pasta inválidos")
            return
        tam = int(self.headers.get("Content-Length") or 0)
        if tam <= 0 or tam > 25 * 1024 * 1024:
            self.send_error(400, "tamanho inválido")
            return
        corpo = self.rfile.read(tam)
        os.makedirs(destino, exist_ok=True)
        caminho = os.path.join(destino, nome)
        with open(caminho, "wb") as f:
            f.write(corpo)
        resp = json.dumps({"ok": True, "arquivo": os.path.relpath(caminho, RAIZ).replace("\\", "/"), "bytes": len(corpo)}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(resp)))
        self.end_headers()
        self.wfile.write(resp)


if __name__ == "__main__":
    porta = int(sys.argv[1]) if len(sys.argv) > 1 else 8766
    print(f"servindo {RAIZ} em http://localhost:{porta}/render.html")
    ThreadingHTTPServer(("127.0.0.1", porta), Handler).serve_forever()
