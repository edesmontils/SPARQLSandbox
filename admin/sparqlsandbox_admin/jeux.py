"""Jeux de données et exercices d'une installation de SPARQLSandbox.

Un jeu est un dossier de ``donnees/`` : ses fichiers RDF et un ``config.xml`` (voir le README
de SPARQLSandbox). Les exercices sont des fichiers JSON de ``donnees/exercices/``.
"""
from __future__ import annotations

import json
import posixpath
import re
import textwrap
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path
from xml.sax.saxutils import escape

from .transport import Transport, TransportError

NOM_JEU = re.compile(r"^[a-z0-9][a-z0-9_-]*$")
CODE_EXERCICE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
# extension -> (libellé, format rdflib)
FORMATS = {
    ".ttl": ("Turtle", "turtle"),
    ".trig": ("TriG", "trig"),
    ".nt": ("N-Triples", "nt"),
    ".nq": ("N-Quads", "nquads"),
    ".rdf": ("RDF/XML", "xml"),
}
RESERVES = {"exercices"}  # sous-dossiers de donnees/ qui ne sont pas des jeux


class JeuInvalide(Exception):
    pass


@dataclass
class Exemple:
    titre: str
    requete: str


@dataclass
class Jeu:
    nom: str
    titre: str = ""
    fichiers: list[str] = field(default_factory=list)
    formes: list[str] = field(default_factory=list)
    reference: str = ""
    description: str = ""  # HTML
    exemples: list[Exemple] = field(default_factory=list)
    absents: list[str] = field(default_factory=list)  # fichiers déclarés mais absents


# --- config.xml ---------------------------------------------------------------------

def _dedente(texte: str) -> str:
    texte = re.sub(r"\A(?:[ \t]*\n)+", "", texte or "")
    return textwrap.dedent(texte.rstrip())


def _interieur(el: ET.Element) -> str:
    """Contenu XML d'un élément (sans sa balise), tel qu'écrit dans le fichier."""
    if el is None:
        return ""
    morceaux = [escape(el.text or "")]
    for enfant in el:
        s = ET.tostring(enfant, encoding="unicode")
        morceaux.append(s)  # tostring inclut la queue (tail)
    brut = "".join(morceaux).strip()
    # la marge due à l'indentation du fichier est retirée (la première ligne n'en a plus)
    premiere, _, reste = brut.partition("\n")
    return premiere + ("\n" + textwrap.dedent(reste) if reste else "")


def lit_config(contenu: bytes, defaut_nom: str = "") -> Jeu:
    try:
        racine = ET.fromstring(contenu)
    except ET.ParseError as e:
        raise JeuInvalide(f"config.xml invalide : {e}") from e
    nom = racine.get("nom") or defaut_nom
    titre = (racine.findtext("titre") or "").strip()
    jeu = Jeu(nom=nom, titre=titre or nom)
    jeu.fichiers = [f.get("nom", "") for f in racine.findall("fichier") if f.get("nom")]
    jeu.formes = [f.get("nom", "") for f in racine.findall("formes") if f.get("nom")]
    jeu.reference = (racine.findtext("référence") or "").strip()
    jeu.description = _interieur(racine.find("description"))
    ex = racine.find("exemples")
    if ex is not None:
        jeu.exemples = [Exemple((e.get("titre") or "").strip(), _dedente(e.text or ""))
                        for e in ex.findall("exemple")]
    return jeu


def verifie_jeu(jeu: Jeu) -> list[str]:
    """Problèmes qui feraient ignorer le jeu par SPARQLSandbox."""
    p = []
    if not NOM_JEU.match(jeu.nom or ""):
        p.append("Le nom doit être en minuscules, chiffres, - et _ (et commencer par une lettre ou un chiffre).")
    if not jeu.fichiers:
        p.append("Un jeu doit avoir au moins un fichier de données.")
    for f in jeu.fichiers + jeu.formes:
        if posixpath.basename(f) != f or f.startswith("."):
            p.append(f"Nom de fichier invalide : {f}.")
    for f in jeu.fichiers:
        if Path(f).suffix.lower() not in FORMATS:
            p.append(f"Format non reconnu pour {f} (extensions : {', '.join(FORMATS)}).")
    if jeu.description:
        try:
            ET.fromstring(f"<d>{jeu.description}</d>")
        except ET.ParseError as e:
            p.append(f"La description n'est pas du XHTML bien formé : {e}.")
    return p


def ecrit_config(jeu: Jeu) -> bytes:
    """config.xml d'un jeu (les commentaires d'un ancien fichier ne sont pas conservés)."""
    t = "\t"
    l = ['<?xml version="1.0" encoding="UTF-8"?>',
         f'<jeu nom="{escape(jeu.nom, {chr(34): "&quot;"})}">',
         f"{t}<titre>{escape(jeu.titre or jeu.nom)}</titre>"]
    for f in jeu.fichiers:
        l.append(f'{t}<fichier nom="{escape(f, {chr(34): "&quot;"})}"/>')
    for f in jeu.formes:
        l.append(f'{t}<formes nom="{escape(f, {chr(34): "&quot;"})}"/>')
    l.append(f"{t}<référence>{escape(jeu.reference)}</référence>")
    if jeu.description.strip():
        l.append(f"{t}<description>")
        l.append(textwrap.indent(jeu.description.strip(), t * 2))
        l.append(f"{t}</description>")
    if jeu.exemples:
        l.append(f"{t}<exemples>")
        for e in jeu.exemples:
            titre = escape(e.titre, {chr(34): "&quot;"})
            corps = textwrap.indent(escape(e.requete.strip("\n")), t * 4)
            l.append(f'{t * 2}<exemple titre="{titre}">')
            l.append(corps)
            l.append(f"{t * 2}</exemple>")
        l.append(f"{t}</exemples>")
    l.append("</jeu>")
    return ("\n".join(l) + "\n").encode("utf-8")


# --- validation des fichiers RDF ----------------------------------------------------

def valide_rdf(nom_fichier: str, contenu: bytes) -> tuple[bool, str]:
    """Contrôle la syntaxe d'un fichier RDF (avec rdflib s'il est installé).
    Renvoie (valide, message) ; sans rdflib, seul l'encodage est vérifié."""
    ext = Path(nom_fichier).suffix.lower()
    if ext not in FORMATS:
        return False, f"Format non reconnu ({ext or 'sans extension'}) : {', '.join(FORMATS)}."
    if not contenu.strip():
        return False, "Le fichier est vide."
    if ext != ".rdf":
        try:
            contenu.decode("utf-8")
        except UnicodeDecodeError:
            return False, "Le fichier n'est pas en UTF-8."
    try:
        import rdflib
    except ImportError:
        return True, "Syntaxe non vérifiée (rdflib n'est pas installé)."
    try:
        g = rdflib.Dataset() if ext in (".trig", ".nq") else rdflib.Graph()
        g.parse(data=contenu, format=FORMATS[ext][1])
        n = len(g)
    except Exception as e:  # rdflib lève des exceptions de types variés
        return False, f"Syntaxe invalide : {str(e).splitlines()[0] if str(e) else type(e).__name__}"
    return True, f"{n} triplet{'s' if n > 1 else ''}."


# --- dépôt : opérations sur l'installation ------------------------------------------

class Depot:
    def __init__(self, t: Transport, dossier_jeux: str, dossier_exercices: str,
                 dossier_sauvegardes: Path | None = None):
        self.t = t
        self.jeux_dir = dossier_jeux
        self.exos_dir = dossier_exercices
        self.sauvegardes = dossier_sauvegardes

    # chemins
    def _dir(self, nom: str) -> str:
        if not NOM_JEU.match(nom):
            raise JeuInvalide(f"Nom de jeu invalide : {nom!r}.")
        return posixpath.join(self.jeux_dir, nom)

    # lecture
    def noms(self) -> list[str]:
        try:
            entrees = self.t.liste(self.jeux_dir)
        except TransportError as e:
            raise TransportError(f"Dossier des jeux illisible ({e}). Vérifiez la racine du site du profil.") from e
        return [e.nom for e in entrees if e.est_dossier and e.nom not in RESERVES and NOM_JEU.match(e.nom)]

    def lit(self, nom: str) -> Jeu:
        d = self._dir(nom)
        jeu = lit_config(self.t.lit(posixpath.join(d, "config.xml")), nom)
        presents = {e.nom for e in self.t.liste(d)}
        jeu.absents = [f for f in jeu.fichiers + jeu.formes if f not in presents]
        return jeu

    def lister(self) -> list[tuple[str, Jeu | None, str]]:
        """[(nom, jeu ou None, erreur)] : un jeu au config.xml illisible reste listé."""
        res = []
        for nom in self.noms():
            try:
                res.append((nom, self.lit(nom), ""))
            except (TransportError, JeuInvalide) as e:
                res.append((nom, None, str(e)))
        return res

    def tailles(self, nom: str) -> dict[str, int]:
        return {e.nom: e.taille for e in self.t.liste(self._dir(nom)) if not e.est_dossier}

    def lit_fichier(self, nom: str, fichier: str) -> bytes:
        return self.t.lit(posixpath.join(self._dir(nom), posixpath.basename(fichier)))

    # écriture
    def enregistre(self, jeu: Jeu) -> None:
        p = verifie_jeu(jeu)
        if p:
            raise JeuInvalide("\n".join(p))
        self.t.ecrit(posixpath.join(self._dir(jeu.nom), "config.xml"), ecrit_config(jeu))

    def cree(self, jeu: Jeu, fichiers: dict[str, bytes] | None = None) -> None:
        """Crée le dossier du jeu, ses fichiers et son config.xml."""
        d = self._dir(jeu.nom)
        if self.t.existe(d):
            raise JeuInvalide(f"Le jeu « {jeu.nom} » existe déjà.")
        for nom_f, contenu in (fichiers or {}).items():
            ok, msg = valide_rdf(nom_f, contenu)
            if not ok:
                raise JeuInvalide(f"{nom_f} : {msg}")
        self.t.mkdir(d)
        try:
            for nom_f, contenu in (fichiers or {}).items():
                self.t.ecrit(posixpath.join(d, nom_f), contenu)
            self.enregistre(jeu)
        except Exception:
            self.t.supprime(d)
            raise

    def ajoute_fichier(self, nom: str, nom_fichier: str, contenu: bytes, role: str = "donnees") -> str:
        """Dépose un fichier dans le jeu et le déclare dans config.xml.
        ``role`` : « ontologie » (chargée en premier), « donnees » (instances) ou « formes » (SHACL).
        Un fichier de même nom est remplacé (l'ancien est sauvegardé). Renvoie le message de contrôle."""
        nom_fichier = posixpath.basename(nom_fichier)
        ok, msg = valide_rdf(nom_fichier, contenu)
        if not ok:
            raise JeuInvalide(f"{nom_fichier} : {msg}")
        if nom_fichier == "config.xml" or nom_fichier.startswith("."):
            raise JeuInvalide(f"Nom de fichier interdit : {nom_fichier}.")
        jeu = self.lit(nom)
        cible = posixpath.join(self._dir(nom), nom_fichier)
        if self.t.existe(cible):
            self.sauvegarde_fichier(nom, nom_fichier)
        self.t.ecrit(cible, contenu)
        liste = jeu.formes if role == "formes" else jeu.fichiers
        if nom_fichier not in liste:
            (liste.insert(0, nom_fichier) if role == "ontologie" else liste.append(nom_fichier))
            self.enregistre(jeu)
        return msg

    def retire_fichier(self, nom: str, fichier: str) -> None:
        """Retire un fichier du jeu (déclaration et fichier, après sauvegarde)."""
        jeu = self.lit(nom)
        if fichier in jeu.fichiers and len(jeu.fichiers) == 1:
            raise JeuInvalide("Un jeu doit garder au moins un fichier de données.")
        self.sauvegarde_fichier(nom, fichier)
        jeu.fichiers = [f for f in jeu.fichiers if f != fichier]
        jeu.formes = [f for f in jeu.formes if f != fichier]
        self.enregistre(jeu)
        self.t.supprime(posixpath.join(self._dir(nom), posixpath.basename(fichier)))

    def supprime(self, nom: str) -> Path | None:
        """Supprime le jeu après l'avoir sauvegardé en local ; renvoie le dossier de sauvegarde."""
        d = self._dir(nom)
        sauv = self.sauvegarde_jeu(nom)
        self.t.supprime(d)
        return sauv

    # sauvegardes locales
    def _dossier_sauvegarde(self, nom: str) -> Path | None:
        if self.sauvegardes is None:
            return None
        p = self.sauvegardes / f"{time.strftime('%Y%m%d-%H%M%S')}-{nom}"
        p.mkdir(parents=True, exist_ok=True)
        return p

    def sauvegarde_fichier(self, nom: str, fichier: str) -> None:
        dest = self._dossier_sauvegarde(nom)
        if dest is not None:
            try:
                (dest / posixpath.basename(fichier)).write_bytes(self.lit_fichier(nom, fichier))
            except TransportError:
                pass  # fichier déclaré mais absent

    def sauvegarde_jeu(self, nom: str) -> Path | None:
        dest = self._dossier_sauvegarde(nom)
        if dest is None:
            return None
        d = self._dir(nom)
        for e in self.t.liste(d):
            if not e.est_dossier:
                (dest / e.nom).write_bytes(self.t.lit(posixpath.join(d, e.nom)))
        return dest

    # exercices
    def exercices(self) -> list[tuple[str, dict | None]]:
        """[(code, contenu JSON ou None si illisible)]."""
        if not self.t.est_dossier(self.exos_dir):
            return []
        res = []
        for e in self.t.liste(self.exos_dir):
            if e.est_dossier or not e.nom.endswith(".json"):
                continue
            try:
                d = json.loads(self.t.lit(posixpath.join(self.exos_dir, e.nom)).decode("utf-8"))
                res.append((e.nom[:-5], d if isinstance(d, dict) else None))
            except (ValueError, TransportError):
                res.append((e.nom[:-5], None))
        return res

    @staticmethod
    def verifie_exercice(contenu: bytes) -> tuple[dict | None, str]:
        """Contrôle un exercice au format QueryCraft ; renvoie (données, message d'erreur)."""
        try:
            d = json.loads(contenu.decode("utf-8"))
        except (ValueError, UnicodeDecodeError) as e:
            return None, f"JSON invalide : {e}"
        if not isinstance(d, dict) or not isinstance(d.get("questions"), dict) or not d["questions"]:
            return None, "Il faut un objet avec une clé « questions » non vide."
        for cq, q in d["questions"].items():
            if not CODE_EXERCICE.match(str(cq)):
                return None, f"Code de question invalide : {cq!r}."
            if not isinstance(q, list) or len(q) not in (5, 6) or not all(isinstance(c, str) for c in q):
                return None, f"La question {cq} doit être une liste de 5 ou 6 textes."
            if q[3] not in ("I->R", "IT->R", "rI->R", "rIT->R", "R->I", "RT->I"):
                return None, f"Type de question inconnu pour {cq} : {q[3]!r}."
        return d, ""

    def ajoute_exercice(self, code: str, contenu: bytes) -> dict:
        if not CODE_EXERCICE.match(code):
            raise JeuInvalide("Code d'exercice invalide (lettres, chiffres, - et _, 64 caractères au plus).")
        d, err = self.verifie_exercice(contenu)
        if d is None:
            raise JeuInvalide(err)
        cible = posixpath.join(self.exos_dir, code + ".json")
        if self.t.existe(cible):
            dest = self._dossier_sauvegarde("exercice-" + code)
            if dest is not None:
                (dest / (code + ".json")).write_bytes(self.t.lit(cible))
        self.t.mkdir(self.exos_dir)
        self.t.ecrit(cible, json.dumps(d, indent=2, ensure_ascii=False).encode("utf-8") + b"\n")
        return d

    def lit_exercice(self, code: str) -> bytes:
        if not CODE_EXERCICE.match(code):
            raise JeuInvalide("Code d'exercice invalide.")
        return self.t.lit(posixpath.join(self.exos_dir, code + ".json"))

    def supprime_exercice(self, code: str) -> None:
        if not CODE_EXERCICE.match(code):
            raise JeuInvalide("Code d'exercice invalide.")
        cible = posixpath.join(self.exos_dir, code + ".json")
        dest = self._dossier_sauvegarde("exercice-" + code)
        if dest is not None:
            (dest / (code + ".json")).write_bytes(self.t.lit(cible))
        self.t.supprime(cible)
