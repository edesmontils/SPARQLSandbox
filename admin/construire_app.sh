#!/bin/sh
# Construit « SPARQLSandbox Admin.app » (dossier dist/) avec PyInstaller, icône comprise.
#   ./construire_app.sh               construit l'application
#   ./construire_app.sh --installer   la construit puis l'installe dans /Applications
#                                     (ou ~/Applications si /Applications n'est pas accessible en écriture)
set -e
cd "$(dirname "$0")"
APP="SPARQLSandbox Admin"
[ -x .venv/bin/python ] || { python3 -m venv .venv && .venv/bin/pip install -q -r requirements.txt; }
.venv/bin/pip install -q pyinstaller
ICONE=icone/SPARQLSandboxAdmin.icns
[ -f "$ICONE" ] && [ "$ICONE" -nt icone/icone.svg ] || .venv/bin/python creer_icone.py

# le Finder peut recréer un .DS_Store pendant la suppression : on réessaie
for i in 1 2 3; do rm -rf build dist 2>/dev/null && break; sleep 1; done
[ ! -e dist ] || { echo "Impossible de supprimer dist/ (fermez-le dans le Finder)"; exit 1; }
.venv/bin/pyinstaller --noconfirm --windowed --name "$APP" \
  --icon "$PWD/$ICONE" \
  --osx-bundle-identifier fr.desmontils.sparqlsandboxadmin \
  --exclude-module tkinter --exclude-module PySide6.QtWebEngineCore --exclude-module PySide6.QtQml \
  --exclude-module PySide6.Qt3DCore --exclude-module PySide6.QtMultimedia \
  --paths . --collect-submodules rdflib \
  --distpath dist --workpath build --specpath build \
  lancement.py >/dev/null 2>&1 || { echo "Échec de PyInstaller (voir build/)"; exit 1; }
echo "Construit : $PWD/dist/$APP.app"

if [ "$1" = "--installer" ]; then
  DEST=/Applications
  [ -w "$DEST" ] || { DEST="$HOME/Applications"; mkdir -p "$DEST"; }
  rm -rf "$DEST/$APP.app"
  ditto "dist/$APP.app" "$DEST/$APP.app"
  touch "$DEST/$APP.app"   # rafraîchit l'icône dans le Finder
  echo "Installé : $DEST/$APP.app"
fi
