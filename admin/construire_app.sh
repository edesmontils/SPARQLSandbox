#!/bin/sh
# Construit « SPARQLSandbox Admin.app » (dossier dist/) avec PyInstaller.
cd "$(dirname "$0")" || exit 1
[ -x .venv/bin/python ] || { python3 -m venv .venv && .venv/bin/pip install -q -r requirements.txt; }
.venv/bin/pip install -q pyinstaller
exec .venv/bin/pyinstaller --noconfirm --windowed --name "SPARQLSandbox Admin" \
  --osx-bundle-identifier fr.desmontils.sparqlsandboxadmin \
  --exclude-module tkinter --exclude-module PySide6.QtWebEngineCore --exclude-module PySide6.QtQml \
  --exclude-module PySide6.Qt3DCore --exclude-module PySide6.QtMultimedia \
  --paths . --collect-submodules rdflib \
  --distpath dist --workpath build --specpath build \
  lancement.py
