"""Profils de machines (Pi, production…) : où et comment joindre chaque installation.

Aucun mot de passe n'est mémorisé : la connexion SSH passe par les clés et l'agent SSH
de l'utilisateur (et son ~/.ssh/config).
"""
from __future__ import annotations

import json
import os
import posixpath
import sys
from dataclasses import asdict, dataclass, fields
from pathlib import Path

from .transport import LocalTransport, SSHTransport, Transport


def dossier_donnees() -> Path:
    """Dossier de l'application (profils, sauvegardes)."""
    if os.environ.get("SPARQLSANDBOX_ADMIN_HOME"):
        return Path(os.environ["SPARQLSANDBOX_ADMIN_HOME"])
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "SPARQLSandboxAdmin"
    return Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share")) / "SPARQLSandboxAdmin"


@dataclass
class Profil:
    nom: str
    type: str = "ssh"          # « ssh » ou « local »
    hote: str = ""             # nom ou alias de ~/.ssh/config, ou adresse
    utilisateur: str = ""
    port: int = 0
    cle: str = ""              # clé privée facultative
    racine: str = ""           # racine du site (le dossier qui contient donnees/)
    ini: str = ""              # sparqlsandbox.ini (défaut : à côté de la racine)
    ini_ia: str = ""           # sparqlsandbox-ia.ini
    dossier_tmp: str = ""      # dossier de travail (défaut : sparqlsandbox-tmp à côté de la racine)
    url: str = ""              # adresse publique, pour ouvrir le site

    def _voisin(self, valeur: str, nom: str) -> str:
        return valeur or posixpath.join(posixpath.dirname(self.racine.rstrip("/")), nom)

    @property
    def chemin_ini(self) -> str:
        return self._voisin(self.ini, "sparqlsandbox.ini")

    @property
    def chemin_ini_ia(self) -> str:
        return self._voisin(self.ini_ia, "sparqlsandbox-ia.ini")

    @property
    def chemin_tmp(self) -> str:
        return self._voisin(self.dossier_tmp, "sparqlsandbox-tmp")

    @property
    def dossier_jeux(self) -> str:
        return posixpath.join(self.racine, "donnees")

    @property
    def dossier_exercices(self) -> str:
        return posixpath.join(self.racine, "donnees", "exercices")

    def transport(self) -> Transport:
        if self.type == "local":
            return LocalTransport()
        return SSHTransport(self.hote, self.utilisateur, self.port, self.cle)

    def erreurs(self) -> list[str]:
        e = []
        if not self.nom.strip():
            e.append("Le nom est obligatoire.")
        if self.type == "ssh" and not self.hote.strip():
            e.append("L'hôte SSH est obligatoire.")
        if not self.racine.strip():
            e.append("La racine du site est obligatoire.")
        return e


class DepotProfils:
    def __init__(self, fichier: Path | None = None):
        self.fichier = fichier or dossier_donnees() / "profils.json"
        self.profils: list[Profil] = []
        self.charge()

    def charge(self) -> None:
        self.profils = []
        try:
            brut = json.loads(self.fichier.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return
        connus = {f.name for f in fields(Profil)}
        for p in brut if isinstance(brut, list) else []:
            if isinstance(p, dict) and p.get("nom"):
                self.profils.append(Profil(**{k: v for k, v in p.items() if k in connus}))

    def enregistre(self) -> None:
        self.fichier.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.fichier.with_suffix(".tmp")
        tmp.write_text(json.dumps([asdict(p) for p in self.profils], indent=2, ensure_ascii=False),
                       encoding="utf-8")
        os.replace(tmp, self.fichier)

    def noms(self) -> list[str]:
        return [p.nom for p in self.profils]

    def trouve(self, nom: str) -> Profil | None:
        return next((p for p in self.profils if p.nom == nom), None)

    def remplace(self, ancien_nom: str | None, profil: Profil) -> None:
        for i, p in enumerate(self.profils):
            if p.nom == ancien_nom:
                self.profils[i] = profil
                break
        else:
            self.profils.append(profil)
        self.enregistre()

    def supprime(self, nom: str) -> None:
        self.profils = [p for p in self.profils if p.nom != nom]
        self.enregistre()
