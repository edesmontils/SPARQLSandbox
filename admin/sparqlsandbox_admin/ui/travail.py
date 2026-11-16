"""Exécution des opérations réseau hors du fil de l'interface."""
from __future__ import annotations

from PySide6.QtCore import QObject, QRunnable, QThreadPool, Signal


class _Signaux(QObject):
    fini = Signal(object)
    erreur = Signal(str)


class _Tache(QRunnable):
    def __init__(self, fonction):
        super().__init__()
        self.fonction = fonction
        self.signaux = _Signaux()

    def run(self):
        try:
            resultat = self.fonction()
        except Exception as e:  # toute erreur est montrée à l'utilisateur
            self.signaux.erreur.emit(str(e) or type(e).__name__)
        else:
            self.signaux.fini.emit(resultat)


class Travail(QObject):
    """Lance des fonctions bloquantes dans un pool de threads ; ``occupe`` est vrai tant que
    l'une d'elles s'exécute. Les rappels s'exécutent dans le fil de l'interface."""
    occupe = Signal(bool)

    def __init__(self):
        super().__init__()
        self.pool = QThreadPool()
        self.pool.setMaxThreadCount(1)  # une connexion SSH partagée : opérations en file
        self.en_cours = 0
        self._taches = set()

    def lance(self, fonction, rappel=None, rappel_erreur=None):
        t = _Tache(fonction)
        self._taches.add(t)
        self.en_cours += 1
        self.occupe.emit(True)

        def fini(r):
            self._termine(t)
            if rappel:
                rappel(r)

        def erreur(m):
            self._termine(t)
            if rappel_erreur:
                rappel_erreur(m)

        t.signaux.fini.connect(fini)
        t.signaux.erreur.connect(erreur)
        self.pool.start(t)

    def _termine(self, t):
        self._taches.discard(t)
        self.en_cours -= 1
        if self.en_cours == 0:
            self.occupe.emit(False)
