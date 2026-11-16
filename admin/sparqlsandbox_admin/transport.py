"""Accès aux fichiers et commandes d'une installation de SPARQLSandbox.

Deux implémentations de la même interface :
- SSHTransport : s'appuie sur le client ``ssh`` du système (donc sur ~/.ssh/config, l'agent SSH,
  ProxyJump…) avec une connexion partagée (ControlMaster) ; rien à installer sur le serveur
  que du shell POSIX ;
- LocalTransport : une installation sur ce Mac (``php -S``, tests).
"""
from __future__ import annotations

import os
import posixpath
import shlex
import shutil
import subprocess
import tempfile
from dataclasses import dataclass


class TransportError(Exception):
    """Échec d'une opération (connexion, commande, droits…)."""


@dataclass
class Entree:
    nom: str
    est_dossier: bool
    taille: int = 0


class Transport:
    """Interface commune. Les chemins sont des chemins POSIX de la machine administrée ;
    « ~/ » en début de chemin désigne son dossier personnel."""

    def accueil(self) -> str:
        raise NotImplementedError

    def chemin(self, p: str) -> str:
        if p == "~":
            return self.accueil()
        if p.startswith("~/"):
            return posixpath.join(self.accueil(), p[2:])
        return p

    def lit(self, p: str) -> bytes:
        raise NotImplementedError

    def ecrit(self, p: str, donnees: bytes, mode: int | None = None) -> None:
        raise NotImplementedError

    def liste(self, p: str) -> list[Entree]:
        raise NotImplementedError

    def existe(self, p: str) -> bool:
        raise NotImplementedError

    def est_dossier(self, p: str) -> bool:
        raise NotImplementedError

    def mkdir(self, p: str) -> None:
        raise NotImplementedError

    def supprime(self, p: str) -> None:
        """Supprime un fichier ou, récursivement, un dossier."""
        raise NotImplementedError

    def renomme(self, source: str, cible: str) -> None:
        raise NotImplementedError

    def execute(self, commande: str, delai: int = 60) -> tuple[int, str, str]:
        """Lance une commande shell ; renvoie (code, sortie, erreur)."""
        raise NotImplementedError

    def ferme(self) -> None:
        pass


class LocalTransport(Transport):
    def accueil(self) -> str:
        return os.path.expanduser("~")

    def lit(self, p):
        try:
            with open(self.chemin(p), "rb") as f:
                return f.read()
        except OSError as e:
            raise TransportError(f"{p} : {e.strerror or e}") from e

    def ecrit(self, p, donnees, mode=None):
        p = self.chemin(p)
        tmp = f"{p}.tmp{os.getpid()}"
        try:
            os.makedirs(os.path.dirname(p) or ".", exist_ok=True)
            with open(tmp, "wb") as f:
                f.write(donnees)
            if mode is not None:
                os.chmod(tmp, mode)
            elif os.path.exists(p):
                shutil.copymode(p, tmp)
            os.replace(tmp, p)
        except OSError as e:
            raise TransportError(f"{p} : {e.strerror or e}") from e

    def liste(self, p):
        try:
            res = []
            for e in os.scandir(self.chemin(p)):
                dossier = e.is_dir()
                res.append(Entree(e.name, dossier, 0 if dossier else e.stat().st_size))
            return sorted(res, key=lambda e: e.nom.lower())
        except OSError as e:
            raise TransportError(f"{p} : {e.strerror or e}") from e

    def existe(self, p):
        return os.path.exists(self.chemin(p))

    def est_dossier(self, p):
        return os.path.isdir(self.chemin(p))

    def mkdir(self, p):
        try:
            os.makedirs(self.chemin(p), exist_ok=True)
        except OSError as e:
            raise TransportError(f"{p} : {e.strerror or e}") from e

    def supprime(self, p):
        p = self.chemin(p)
        try:
            if os.path.isdir(p) and not os.path.islink(p):
                shutil.rmtree(p)
            elif os.path.lexists(p):
                os.remove(p)
        except OSError as e:
            raise TransportError(f"{p} : {e.strerror or e}") from e

    def renomme(self, source, cible):
        try:
            os.replace(self.chemin(source), self.chemin(cible))
        except OSError as e:
            raise TransportError(f"{source} : {e.strerror or e}") from e

    def execute(self, commande, delai=60):
        try:
            r = subprocess.run(["sh", "-c", commande], capture_output=True, timeout=delai)
        except subprocess.TimeoutExpired as e:
            raise TransportError("Commande trop longue.") from e
        return r.returncode, r.stdout.decode("utf-8", "replace"), r.stderr.decode("utf-8", "replace")


class SSHTransport(Transport):
    def __init__(self, hote: str, utilisateur: str = "", port: int = 0, cle: str = ""):
        if not hote or hote.startswith("-"):
            raise TransportError("Hôte SSH invalide.")
        self.cible = f"{utilisateur}@{hote}" if utilisateur else hote
        self.port, self.cle = port, cle
        # chemin de contrôle court (limite des sockets Unix) et réservé à l'utilisateur
        # (/tmp : le dossier temporaire de macOS est trop long pour un chemin de socket)
        base = "/tmp" if os.path.isdir("/tmp") else tempfile.gettempdir()
        self._dossier = os.path.join(base, f"ssa-{os.getuid()}")
        os.makedirs(self._dossier, mode=0o700, exist_ok=True)
        self._accueil: str | None = None

    def _args(self) -> list[str]:
        a = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15",
             "-o", "StrictHostKeyChecking=accept-new",
             "-o", "ControlMaster=auto", "-o", "ControlPersist=120",
             "-o", f"ControlPath={self._dossier}/%C"]
        if self.port:
            a += ["-p", str(self.port)]
        if self.cle:
            a += ["-i", os.path.expanduser(self.cle), "-o", "IdentitiesOnly=yes"]
        return a + [self.cible]

    def _ssh(self, script: str, entree: bytes | None = None, delai: int = 60):
        # le script passe par « sh -c » pour ne pas dépendre du shell de connexion
        commande = "sh -c " + shlex.quote(script)
        try:
            return subprocess.run(self._args() + [commande], input=entree,
                                  capture_output=True, timeout=delai)
        except subprocess.TimeoutExpired as e:
            raise TransportError("Délai dépassé : la machine ne répond pas.") from e
        except FileNotFoundError as e:
            raise TransportError("Le client « ssh » est introuvable.") from e

    def _ok(self, script, entree=None, delai=60) -> bytes:
        r = self._ssh(script, entree, delai)
        if r.returncode != 0:
            msg = r.stderr.decode("utf-8", "replace").strip() or f"code {r.returncode}"
            raise TransportError(msg)
        return r.stdout

    def accueil(self):
        if self._accueil is None:
            self._accueil = self._ok('printf %s "$HOME"').decode().strip()
        return self._accueil

    def lit(self, p):
        r = self._ssh("cat -- " + shlex.quote(self.chemin(p)))
        if r.returncode != 0:
            raise TransportError(f"{p} : {r.stderr.decode('utf-8', 'replace').strip() or 'illisible'}")
        return r.stdout

    def ecrit(self, p, donnees, mode=None):
        p = self.chemin(p)
        q = shlex.quote(p)
        t = shlex.quote(p + ".tmp") + '"$$"'
        # copie -p : le fichier garde droits et propriétaire ; mv rend l'écriture atomique
        script = (f"mkdir -p -- {shlex.quote(posixpath.dirname(p) or '.')} && "
                  f"{{ [ -f {q} ] && cp -p {q} {t} 2>/dev/null; true; }} && "
                  f"cat > {t} && ")
        if mode is not None:
            script += f"chmod {mode:o} {t} && "
        script += f"mv -f {t} {q}"
        self._ok(script, donnees)

    def liste(self, p):
        sortie = self._ok("LC_ALL=C ls -lAp -- " + shlex.quote(self.chemin(p))).decode("utf-8", "replace")
        res = []
        for ligne in sortie.splitlines():
            if not ligne or ligne.startswith("total"):
                continue
            parts = ligne.split(None, 8)
            if len(parts) < 9:
                continue
            nom = parts[8]
            if " -> " in nom:  # lien symbolique : on garde le nom
                nom = nom.split(" -> ")[0]
            dossier = nom.endswith("/")
            res.append(Entree(nom.rstrip("/"), dossier, 0 if dossier else int(parts[4])))
        return sorted(res, key=lambda e: e.nom.lower())

    def _test(self, option, p):
        return self._ssh(f"[ {option} " + shlex.quote(self.chemin(p)) + " ]").returncode == 0

    def existe(self, p):
        return self._test("-e", p)

    def est_dossier(self, p):
        return self._test("-d", p)

    def mkdir(self, p):
        self._ok("mkdir -p -- " + shlex.quote(self.chemin(p)))

    def supprime(self, p):
        p = self.chemin(p)
        if p in ("", "/") or p.rstrip("/") == self.accueil():
            raise TransportError("Suppression refusée.")
        self._ok("rm -rf -- " + shlex.quote(p))

    def renomme(self, source, cible):
        self._ok(f"mv -f -- {shlex.quote(self.chemin(source))} {shlex.quote(self.chemin(cible))}")

    def execute(self, commande, delai=60):
        r = self._ssh(commande, delai=delai)
        return r.returncode, r.stdout.decode("utf-8", "replace"), r.stderr.decode("utf-8", "replace")

    def ferme(self):
        subprocess.run(self._args()[:-1] + ["-O", "exit", self.cible], capture_output=True)
