"""Diagnostic et entretien d'une installation : copies de session, stores d'origine, services."""
from __future__ import annotations

import posixpath
import re
import shlex
from dataclasses import dataclass, field

from .inifile import IniFile
from .transport import Transport, TransportError

COPIE = re.compile(r"^copie_[0-9a-f]{16}_([a-z0-9_-]+)$")
ORIGINE = re.compile(r"^origine_([a-z0-9_-]+)_[0-9a-f]{16}$")


@dataclass
class Etat:
    copies: dict[str, tuple[int, int]] = field(default_factory=dict)  # jeu -> (nombre, Ko)
    origines: dict[str, int] = field(default_factory=dict)            # jeu -> Ko
    tables: int = 0
    libre_ko: int | None = None
    tmp_existe: bool = True

    @property
    def nb_copies(self) -> int:
        return sum(n for n, _ in self.copies.values())

    @property
    def ko_copies(self) -> int:
        return sum(k for _, k in self.copies.values())


def _tailles(t: Transport, dossier: str, noms: list[str]) -> dict[str, int]:
    """Taille en Ko de chaque sous-dossier (du -sk, en une seule commande)."""
    if not noms:
        return {}
    cmd = f"cd {shlex.quote(dossier)} && du -sk -- " + " ".join(shlex.quote(n) for n in noms)
    _, sortie, _ = t.execute(cmd, 120)  # du renvoie un code ≠ 0 si un dossier disparaît en route
    res = {}
    for ligne in sortie.splitlines():
        ko, _, nom = ligne.partition("\t")
        if ko.isdigit():
            res[nom] = int(ko)
    return res


def etat(t: Transport, dossier_tmp: str) -> Etat:
    e = Etat()
    dossier_tmp = t.chemin(dossier_tmp)
    if not t.est_dossier(dossier_tmp):
        e.tmp_existe = False
        return e
    entrees = t.liste(dossier_tmp)
    copies = [x.nom for x in entrees if x.est_dossier and COPIE.match(x.nom)]
    origines = [x.nom for x in entrees if x.est_dossier and ORIGINE.match(x.nom)]
    e.tables = sum(1 for x in entrees if x.nom.startswith("table_"))
    tailles = _tailles(t, dossier_tmp, copies + origines)
    for nom in copies:
        n, k = e.copies.get(COPIE.match(nom).group(1), (0, 0))
        e.copies[COPIE.match(nom).group(1)] = (n + 1, k + tailles.get(nom, 0))
    for nom in origines:
        jeu = ORIGINE.match(nom).group(1)
        e.origines[jeu] = e.origines.get(jeu, 0) + tailles.get(nom, 0)
    _, sortie, _ = t.execute(f"df -Pk {shlex.quote(dossier_tmp)} | tail -n 1")
    champs = sortie.split()
    if len(champs) >= 4 and champs[3].isdigit():
        e.libre_ko = int(champs[3])
    return e


def purge_copies(t: Transport, dossier_tmp: str, jeu: str | None = None) -> int:
    """Supprime les copies de session (de ``jeu``, ou de tous les jeux) et leurs verrous.
    Les étudiants repartent alors d'une nouvelle copie du jeu d'origine. Renvoie le nombre supprimé."""
    dossier_tmp = t.chemin(dossier_tmp)
    n = 0
    for x in t.liste(dossier_tmp):
        m = COPIE.match(x.nom) if x.est_dossier else None
        if m and (jeu is None or m.group(1) == jeu):
            t.supprime(posixpath.join(dossier_tmp, x.nom))
            t.supprime(posixpath.join(dossier_tmp, "verrou_" + x.nom))
            n += 1
    return n


def purge_origines(t: Transport, dossier_tmp: str, jeu: str | None = None) -> int:
    """Supprime les stores d'origine (rechargés à la prochaine requête) et les tables d'exercices
    en cache : à faire après avoir changé des fichiers qu'on veut voir pris en compte tout de suite."""
    dossier_tmp = t.chemin(dossier_tmp)
    n = 0
    for x in t.liste(dossier_tmp):
        m = ORIGINE.match(x.nom) if x.est_dossier else None
        if (m and (jeu is None or m.group(1) == jeu)) or (not x.est_dossier and x.nom.startswith("table_")):
            t.supprime(posixpath.join(dossier_tmp, x.nom))
            n += 1
    return n


def teste_service(t: Transport, url: str) -> tuple[bool, str]:
    """Interroge un point d'accès SPARQL depuis la machine administrée (c'est elle qui le fera)."""
    cmd = ("curl -sS -m 10 -o /dev/null -w '%{http_code}' -G -H 'Accept: application/sparql-results+json' "
           "--data-urlencode 'query=ASK { ?s ?p ?o }' " + shlex.quote(url))
    code, sortie, erreur = t.execute(cmd, 20)
    if code != 0:
        return False, (erreur.strip() or f"curl a échoué (code {code})")
    return (sortie.strip().startswith("2"), f"HTTP {sortie.strip()}")


def diagnostic(t: Transport, profil) -> list[tuple[str, str]]:
    """Vérifie l'installation : [(niveau, message)], niveau parmi ok, avert, erreur."""
    r: list[tuple[str, str]] = []
    try:
        t.accueil()
    except TransportError as e:
        return [("erreur", f"Connexion impossible : {e}")]
    r.append(("ok", "Connexion établie."))
    if t.est_dossier(profil.dossier_jeux):
        r.append(("ok", f"Dossier des jeux : {profil.dossier_jeux}"))
    else:
        return r + [("erreur", f"Dossier des jeux introuvable : {profil.dossier_jeux} (racine du site ?)")]
    ini = IniFile()
    chemin_ini = t.chemin(profil.chemin_ini)
    if t.existe(chemin_ini):
        ini = IniFile(t.lit(chemin_ini).decode("utf-8", "replace"))
        r.append(("ok", f"Réglages : {chemin_ini}"))
    else:
        r.append(("avert", f"Pas de fichier de réglages ({chemin_ini}) : valeurs par défaut."))
    for nom in ("oxigraph", "pyshacl"):
        chemin = ini.get(nom) or posixpath.join(t.chemin(profil.racine), "bin", nom)
        code, _, _ = t.execute(f"[ -x {shlex.quote(chemin)} ] || command -v {nom}")
        niveau = "ok" if code == 0 else ("erreur" if nom == "oxigraph" else "avert")
        r.append((niveau, f"{nom} : " + ("trouvé." if code == 0 else
                  "introuvable." + ("" if nom == "oxigraph" else " Seuls les contrôles RDFS seront faits."))))
    if t.est_dossier(profil.chemin_tmp):
        r.append(("ok", f"Dossier de travail : {profil.chemin_tmp}"))
    else:
        r.append(("avert", f"Dossier de travail absent ({profil.chemin_tmp}) : créé à la première requête, "
                           "ou mal indiqué dans le profil."))
    if t.existe(t.chemin(profil.chemin_ini_ia)):
        r.append(("ok", "Correction des intentions par IA : activée."))
    else:
        r.append(("ok", "Correction des intentions par IA : désactivée (auto-évaluation)."))
    return r


# --- mise à jour du site (git pull) -----------------------------------------------------

@dataclass
class EtatDepot:
    branche: str
    tete: str                      # empreinte courte du commit actuel
    modifie: bool                  # fichiers suivis modifiés localement
    a_recuperer: list[str] = field(default_factory=list)  # commits en avance sur le serveur : « empreinte titre »


@dataclass
class ResultatMaj:
    avant: str
    apres: str
    commits: list[str]
    sortie: str
    relance: tuple[int, str] | None = None  # (code, sortie) de la commande de relance


def _git(t: Transport, racine: str, args: str, delai: int = 90) -> str:
    code, sortie, erreur = t.execute(f"git -C {shlex.quote(t.chemin(racine))} {args} 2>&1", delai)
    if code != 0:
        raise TransportError((sortie + erreur).strip() or f"git a échoué (code {code})")
    return sortie.strip()


def etat_depot(t: Transport, racine: str) -> EtatDepot:
    """Interroge le dépôt git du site (après un « fetch ») : branche, commit et commits à récupérer."""
    if _git(t, racine, "rev-parse --is-inside-work-tree") != "true":
        raise TransportError(f"{racine} n'est pas un dépôt git.")
    branche = _git(t, racine, "rev-parse --abbrev-ref HEAD")
    tete = _git(t, racine, "rev-parse --short HEAD")
    _git(t, racine, "fetch --quiet")
    try:
        nouveaux = _git(t, racine, "log --oneline 'HEAD..@{u}'")
    except TransportError as e:
        raise TransportError(f"La branche « {branche} » ne suit aucune branche distante : {e}") from e
    modifie = bool(_git(t, racine, "status --porcelain --untracked-files=no"))
    return EtatDepot(branche, tete, modifie, [l for l in nouveaux.splitlines() if l])


def met_a_jour(t: Transport, racine: str, relance: str = "") -> ResultatMaj:
    """git pull (avance rapide seulement : jamais de fusion ni d'écrasement), puis la commande de relance."""
    avant = _git(t, racine, "rev-parse --short HEAD")
    sortie = _git(t, racine, "pull --ff-only", 120)
    apres = _git(t, racine, "rev-parse --short HEAD")
    commits = []
    if avant != apres:
        commits = [l for l in _git(t, racine, f"log --oneline {avant}..{apres}").splitlines() if l]
    res = ResultatMaj(avant, apres, commits, sortie)
    if relance.strip():
        code, out, err = t.execute(relance.strip() + " 2>&1", 90)
        res.relance = (code, (out + err).strip())
    return res
