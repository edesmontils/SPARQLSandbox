"""Fabrique icone/SPARQLSandboxAdmin.icns à partir de icone/icone.svg (Qt + iconutil, macOS)."""
import os
import subprocess
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
from PySide6.QtCore import Qt  # noqa: E402
from PySide6.QtGui import QGuiApplication, QImage, QPainter  # noqa: E402
from PySide6.QtSvg import QSvgRenderer  # noqa: E402

ici = Path(__file__).resolve().parent
svg = ici / "icone" / "icone.svg"
sortie = ici / "icone" / "SPARQLSandboxAdmin.icns"
app = QGuiApplication(sys.argv)
rendu = QSvgRenderer(str(svg))
with tempfile.TemporaryDirectory() as tmp:
    jeu = Path(tmp) / "icone.iconset"
    jeu.mkdir()
    for base in (16, 32, 128, 256, 512):
        for facteur in (1, 2):
            px = base * facteur
            img = QImage(px, px, QImage.Format_ARGB32)
            img.fill(Qt.transparent)
            p = QPainter(img)
            p.setRenderHints(QPainter.Antialiasing | QPainter.SmoothPixmapTransform)
            rendu.render(p)
            p.end()
            nom = f"icon_{base}x{base}" + ("@2x" if facteur == 2 else "") + ".png"
            img.save(str(jeu / nom))
    subprocess.run(["iconutil", "-c", "icns", str(jeu), "-o", str(sortie)], check=True)
print(sortie)
