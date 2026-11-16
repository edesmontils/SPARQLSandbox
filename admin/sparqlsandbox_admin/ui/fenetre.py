"""Fenêtre principale."""
from __future__ import annotations

from PySide6.QtCore import QSettings, QTimer, QUrl
from PySide6.QtGui import QAction, QDesktopServices, QKeySequence
from PySide6.QtWidgets import (QComboBox, QLabel, QMainWindow, QProgressBar, QTabWidget, QToolBar, QWidget)

from .. import __version__
from ..profils import DepotProfils
from .contexte import Contexte
from .dialogues import DialogueProfils
from .page_exercices import PageExercices, PageMaintenance
from .page_jeux import PageJeux
from .page_reglages import PageIA, PageReglages, PageSites


class Fenetre(QMainWindow):
    def __init__(self, profils: DepotProfils | None = None):
        super().__init__()
        self.setWindowTitle("SPARQLSandbox Admin")
        self.resize(1100, 760)
        self.ctx = Contexte(profils or DepotProfils(), self)
        ctx = self.ctx

        self.pages = [("Jeux de données", PageJeux(ctx)), ("Exercices", PageExercices(ctx)),
                      ("Sites interrogables", PageSites(ctx)), ("Réglages", PageReglages(ctx)),
                      ("Correction par IA", PageIA(ctx)), ("Maintenance", PageMaintenance(ctx))]
        self.onglets = QTabWidget()
        for titre, page in self.pages:
            self.onglets.addTab(page, titre)
        self.setCentralWidget(self.onglets)
        self.perimees: set[int] = set()
        self.onglets.currentChanged.connect(self._onglet)

        # barre d'outils : choix de la machine
        self.choix = QComboBox()
        self.choix.setMinimumWidth(220)
        self.choix.activated.connect(self._choisi)
        barre = QToolBar("Machine")
        barre.setMovable(False)
        barre.addWidget(QLabel("  Machine : "))
        barre.addWidget(self.choix)
        a_profils = QAction("Machines…", self)
        a_profils.triggered.connect(self.gere_profils)
        a_actu = QAction("Actualiser", self)
        a_actu.setShortcut(QKeySequence.Refresh)
        a_actu.triggered.connect(self.actualise)
        a_site = QAction("Ouvrir le site", self)
        a_site.triggered.connect(self.ouvre_site)
        barre.addSeparator()
        for a in (a_profils, a_actu, a_site):
            barre.addAction(a)
        self.addToolBar(barre)

        menu = self.menuBar().addMenu("Machines")
        menu.addAction(a_profils)
        menu.addAction(a_actu)
        menu.addAction(a_site)
        aide = self.menuBar().addMenu("Aide")
        aide.addAction("À propos", self.a_propos)

        # barre d'état
        self.occupe = QProgressBar()
        self.occupe.setRange(0, 0)
        self.occupe.setMaximumWidth(110)
        self.occupe.setTextVisible(False)
        self.occupe.hide()
        self.statusBar().addPermanentWidget(self.occupe)
        ctx.travail.occupe.connect(self.occupe.setVisible)
        ctx.message.connect(lambda m: self.statusBar().showMessage(m, 8000))
        ctx.profil_change.connect(self._profil_change)

        self._remplit_choix()
        reglages = QSettings("SPARQLSandboxAdmin", "SPARQLSandboxAdmin")
        dernier = reglages.value("profil", "")
        self.setProperty("reglages", reglages)
        noms = ctx.profils.noms()
        ctx.selectionne(dernier if dernier in noms else (noms[0] if noms else None))
        if not noms:
            self.statusBar().showMessage("Aucune machine : ouvrez « Machines… » pour en ajouter une.")

    # --- machines
    def _remplit_choix(self):
        noms = self.ctx.profils.noms()
        self.choix.blockSignals(True)  # vider la liste pendant « activated » fait planter Qt
        if noms != [self.choix.itemText(i) for i in range(self.choix.count())]:
            self.choix.clear()
            self.choix.addItems(noms)
        self.choix.setCurrentIndex(noms.index(self.ctx.profil.nom) if self.ctx.profil in self.ctx.profils.profils else -1)
        self.choix.blockSignals(False)

    def _choisi(self, i: int):
        nom = self.choix.itemText(i)
        QTimer.singleShot(0, lambda: self.ctx.selectionne(nom))  # hors du signal du combo

    def _profil_change(self):
        self._remplit_choix()
        if self.ctx.profil:
            self.property("reglages").setValue("profil", self.ctx.profil.nom)
            self.setWindowTitle(f"SPARQLSandbox Admin — {self.ctx.profil.nom}")
        else:
            self.setWindowTitle("SPARQLSandbox Admin")
        self.perimees = set(range(len(self.pages)))
        self._onglet(self.onglets.currentIndex())

    def _onglet(self, i: int):
        if i in self.perimees:
            self.perimees.discard(i)
            self.pages[i][1].recharge()

    def actualise(self):
        self.perimees = set(range(len(self.pages)))
        self._onglet(self.onglets.currentIndex())

    def gere_profils(self):
        DialogueProfils(self.ctx, self).exec()
        self._remplit_choix()
        if self.ctx.profil is None and self.ctx.profils.noms():
            self.ctx.selectionne(self.ctx.profils.noms()[0])

    def ouvre_site(self):
        p = self.ctx.profil
        if p and p.url:
            QDesktopServices.openUrl(QUrl(p.url))
        else:
            self.statusBar().showMessage("Aucune adresse publique pour cette machine (voir « Machines… »).", 6000)

    def a_propos(self):
        from PySide6.QtWidgets import QMessageBox
        QMessageBox.about(self, "SPARQLSandbox Admin",
                          f"<b>SPARQLSandbox Admin</b> {__version__}<br>Administration des installations de "
                          "SPARQLSandbox (jeux de données, exercices, sites interrogables, réglages) par SSH.")

    def closeEvent(self, e):
        self.ctx.travail.pool.waitForDone(3000)
        t = self.ctx._transport
        if t is not None:
            t.ferme()
        super().closeEvent(e)
