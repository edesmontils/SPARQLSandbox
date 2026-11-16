#!/bin/sh
# Lance l'application (crée l'environnement virtuel à la première fois).
cd "$(dirname "$0")" || exit 1
[ -x .venv/bin/python ] || { python3 -m venv .venv && .venv/bin/pip install -q -r requirements.txt; }
exec .venv/bin/python -m sparqlsandbox_admin
