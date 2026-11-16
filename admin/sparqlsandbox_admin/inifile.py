"""Lecture et modification d'un fichier .ini en gardant ses commentaires.

Les réglages de SPARQLSandbox (sparqlsandbox.ini et sparqlsandbox-ia.ini) sont lus par
parse_ini_file() de PHP. Une modification remplace la ligne du réglage (ou « décommente »
l'exemple ``;clé = valeur``, ou ajoute une ligne), sans toucher au reste du fichier.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

_ACTIF = re.compile(r"^\s*([A-Za-z0-9_.\-]+)(\[\])?\s*=\s*(.*?)\s*$")
_COMMENTE = re.compile(r"^\s*;\s*([A-Za-z0-9_.\-]+)\s*=")


def _decode(valeur: str) -> str:
    if len(valeur) >= 2 and valeur[0] == valeur[-1] == '"':
        return valeur[1:-1].replace('\\"', '"')
    if len(valeur) >= 2 and valeur[0] == valeur[-1] == "'":
        return valeur[1:-1]
    # commentaire en fin de ligne d'une valeur non guillemetée
    return re.sub(r"\s+;.*$", "", valeur)


def encode(valeur) -> str:
    """Valeur écrite dans le fichier : entiers tels quels, texte entre guillemets."""
    if isinstance(valeur, bool):
        return "1" if valeur else "0"
    if isinstance(valeur, int):
        return str(valeur)
    s = str(valeur)
    if re.fullmatch(r"[0-9]+", s):
        return s
    return '"' + s.replace('"', '\\"') + '"'


@dataclass
class Champ:
    """Description d'un réglage pour construire un formulaire."""
    cle: str
    libelle: str
    type: str = "texte"      # texte, entier, secret
    defaut: object = ""
    aide: str = ""


class IniFile:
    def __init__(self, texte: str = ""):
        self.lignes = texte.splitlines()

    def texte(self) -> str:
        return "\n".join(self.lignes) + "\n"

    def _actives(self, cle: str):
        for i, l in enumerate(self.lignes):
            m = _ACTIF.match(l)
            if m and m.group(1) == cle:
                yield i, m

    def get(self, cle: str, defaut=None):
        """Valeur du réglage (liste si ``cle[] =`` est répété), ou ``defaut``."""
        trouves = list(self._actives(cle))
        if not trouves:
            return defaut
        if any(m.group(2) for _, m in trouves):
            return [_decode(m.group(3)) for _, m in trouves]
        return _decode(trouves[-1][1].group(3))

    def a(self, cle: str) -> bool:
        return any(True for _ in self._actives(cle))

    def retire(self, cle: str) -> None:
        """Supprime le réglage : sa ligne devient un commentaire (réglage par défaut)."""
        for i, _ in self._actives(cle):
            self.lignes[i] = ";" + self.lignes[i].lstrip()

    def pose(self, cle: str, valeur) -> None:
        ligne = f"{cle} = {encode(valeur)}"
        actives = [i for i, _ in self._actives(cle)]
        if actives:
            self.lignes[actives[0]] = ligne
            for i in reversed(actives[1:]):  # doublons ou cle[] répétés
                del self.lignes[i]
            return
        for i, l in enumerate(self.lignes):  # exemple commenté : on le remplace
            m = _COMMENTE.match(l)
            if m and m.group(1) == cle:
                self.lignes[i] = ligne
                return
        if self.lignes and self.lignes[-1].strip():
            self.lignes.append("")
        self.lignes.append(ligne)

    def pose_ou_retire(self, cle: str, valeur, defaut=None) -> None:
        """Pose ``valeur`` ; la retire si elle est vide ou égale à la valeur par défaut."""
        if valeur in ("", None) or (defaut is not None and str(valeur) == str(defaut)):
            self.retire(cle)
        else:
            self.pose(cle, valeur)


# --- Réglages de SPARQLSandbox -------------------------------------------------------

CHAMPS_SPARQLSANDBOX = [
    Champ("oxigraph", "Exécutable Oxigraph", "texte", "",
          "Chemin complet ; vide : bin/oxigraph du site, puis le PATH."),
    Champ("pyshacl", "Exécutable pyshacl", "texte", "",
          "Pour vérifier les formes SHACL ; vide : bin/pyshacl du site, puis le PATH."),
    Champ("duree_session_min", "Durée de vie des sessions et copies (minutes)", "entier", 180,
          "Une copie inactive plus longtemps est purgée."),
    Champ("occupation_max_mo", "Total maximal des copies (Mo)", "entier", 1024),
    Champ("espace_libre_min_mo", "Espace disque libre à préserver (Mo)", "entier", 200,
          "Aucune copie n'est faite s'il reste moins de place."),
]

CHAMPS_IA = [
    Champ("url", "URL de ProxyIAg", "texte", "", "HTTPS obligatoire, sauf pour localhost."),
    Champ("cle", "Clé (sk-…)", "secret", "", "Clé propre à l'application, créée avec proxyiag-keys."),
    Champ("modele", "Alias du modèle", "texte", "", "Par exemple proxyiag/gemma-4-31b."),
    Champ("par_session_intention", "Corrections par session et par jour", "entier", 30),
    Champ("delai", "Délai minimal entre deux corrections (s)", "entier", 5),
    Champ("par_ip", "Appels par adresse IP et par jour (0 : sans limite)", "entier", 250),
    Champ("plafond_global", "Appels par jour pour toute l'installation (0 : sans limite)", "entier", 500),
    Champ("max_tokens", "Longueur maximale de la réponse (tokens)", "entier", 1500),
    Champ("delai_appel", "Attente maximale de la réponse (s)", "entier", 60),
]


def services_autorises(ini: IniFile) -> list[str]:
    """Points d'accès listés dans services_autorises (virgules, espaces ou cle[] répétée)."""
    brut = ini.get("services_autorises", [])
    if not isinstance(brut, list):
        brut = [brut]
    res: list[str] = []
    for b in brut:
        for u in re.split(r"[\s,]+", b):
            if u and u not in res:
                res.append(u)
    return res


def url_service_valide(u: str) -> bool:
    return bool(re.fullmatch(r'https?://[^\s<>"]+', u, re.I))


def pose_services(ini: IniFile, urls: list[str]) -> None:
    if urls:
        ini.pose("services_autorises", ", ".join(urls))
    else:
        ini.retire("services_autorises")
