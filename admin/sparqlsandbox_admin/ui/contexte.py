"""État partagé par les pages : profil courant, connexion, dépôt de jeux."""
from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import QObject, Signal
from PySide6.QtWidgets import QMessageBox, QWidget

from ..jeux import Depot
from ..profils import DepotProfils, Profil, dossier_donnees
from ..transport import Transport
from .travail import Travail


class Contexte(QObject):
    profil_change = Signal()
    message = Signal(str)

    def __init__(self, profils: DepotProfils, fenetre: QWidget):
        super().__init__()
        self.profils = profils
        self.fenetre = fenetre
        self.travail = Travail()
        self.profil: Profil | None = None
        self._transport: Transport | None = None

    # --- profil et connexion
    def selectionne(self, nom: str | None) -> None:
        if self._transport is not None:
            t, self._transport = self._transport, None
            self.travail.lance(t.ferme)
        self.profil = self.profils.trouve(nom) if nom else None
        self.profil_change.emit()

    def transport(self) -> Transport:
        """À appeler depuis une tâche (peut créer la connexion)."""
        if self.profil is None:
            raise RuntimeError("Aucune machine sélectionnée : créez un profil (menu Machines).")
        if self._transport is None:
            self._transport = self.profil.transport()
        return self._transport

    def depot(self) -> Depot:
        p = self.profil
        if p is None:
            raise RuntimeError("Aucune machine sélectionnée : créez un profil (menu Machines).")
        return Depot(self.transport(), p.dossier_jeux, p.dossier_exercices,
                     self.dossier_sauvegardes())

    def dossier_sauvegardes(self) -> Path:
        nom = (self.profil.nom if self.profil else "sans-profil").replace("/", "_")
        return dossier_donnees() / "sauvegardes" / nom

    # --- exécution
    def lance(self, fonction, rappel=None, rappel_erreur=None) -> None:
        """Exécute ``fonction`` hors du fil de l'interface ; erreur affichée par défaut."""
        self.travail.lance(fonction, rappel, rappel_erreur or self.erreur)

    def erreur(self, message: str) -> None:
        QMessageBox.critical(self.fenetre, "Erreur", message)

    def confirme(self, titre: str, texte: str, detail: str = "") -> bool:
        b = QMessageBox(QMessageBox.Warning, titre, texte, QMessageBox.Yes | QMessageBox.Cancel, self.fenetre)
        b.setDefaultButton(QMessageBox.Cancel)
        b.setInformativeText(detail)
        return b.exec() == QMessageBox.Yes
