"""Fenêtre principale : plaque de machine et navigation à gauche, page à droite."""
from __future__ import annotations

from PySide6.QtCore import QSettings, QTimer, QUrl, Qt
from PySide6.QtGui import QAction, QDesktopServices, QKeySequence, QShortcut
from PySide6.QtWidgets import (QFrame, QHBoxLayout, QLabel, QMainWindow, QMenu, QMessageBox, QProgressBar,
                               QPushButton, QStackedWidget, QVBoxLayout, QWidget)

from .. import __version__
from ..profils import DepotProfils
from .composants import EtatVide, Notification, bouton, etiquette, style
from .contexte import Contexte
from .dialogues import DialogueProfils
from .page_exercices import PageExercices, PageMaintenance
from .page_jeux import PageJeux
from .page_reglages import PageIA, PageReglages, PageSites


class PlaqueMachine(QPushButton):
    """La machine administrée, en tête de la navigation : une plaque indigo, ambre pour la production.
    Un clic ouvre la liste des machines."""

    def __init__(self, fenetre: "Fenetre"):
        super().__init__()
        self.setObjectName("plaque")
        self.fenetre = fenetre
        self.setCursor(Qt.PointingHandCursor)
        self.nom = QLabel()
        self.nom.setObjectName("plaqueNom")
        self.detail = QLabel()
        self.detail.setObjectName("plaqueDetail")
        for l in (self.nom, self.detail):
            l.setAttribute(Qt.WA_TransparentForMouseEvents)
        fleche = QLabel("▾")
        fleche.setAttribute(Qt.WA_TransparentForMouseEvents)
        textes = QVBoxLayout()
        textes.setSpacing(0)
        textes.addWidget(self.nom)
        textes.addWidget(self.detail)
        l = QHBoxLayout(self)
        l.setContentsMargins(12, 6, 12, 6)
        l.addLayout(textes, 1)
        l.addWidget(fleche)
        self.menu = QMenu(self)
        self.setMenu(self.menu)
        self.menu.aboutToShow.connect(self._remplit)

    def _remplit(self):
        ctx = self.fenetre.ctx
        self.menu.clear()
        for p in ctx.profils.profils:
            a = self.menu.addAction(p.nom + ("  (production)" if p.production else ""))
            a.setCheckable(True)
            a.setChecked(bool(ctx.profil and ctx.profil.nom == p.nom))
            a.triggered.connect(lambda _=False, nom=p.nom: self.choisit(nom))
        if ctx.profils.profils:
            self.menu.addSeparator()
        self.menu.addAction("Gérer les machines…", self.fenetre.gere_profils)

    def choisit(self, nom: str):
        # hors du signal du menu : la sélection reconstruit la fenêtre
        QTimer.singleShot(0, lambda: self.fenetre.change_machine(nom))

    def actualise(self, profil):
        if profil is None:
            self.nom.setText("Aucune machine")
            self.detail.setText("Cliquez pour en ajouter une")
        else:
            self.nom.setText(profil.nom)
            self.detail.setText("Ce Mac" if profil.type == "local" else
                                (f"{profil.utilisateur}@" if profil.utilisateur else "") + profil.hote)
        style(self, production=bool(profil and profil.production))
        for l in (self.nom, self.detail):  # les étiquettes lisent la propriété de leur parent
            l.style().unpolish(l)
            l.style().polish(l)


class Fenetre(QMainWindow):
    GROUPES = [("Contenu", [0, 1]), ("Serveur", [2, 3, 4, 5])]

    def __init__(self, profils: DepotProfils | None = None, reglages: QSettings | None = None):
        super().__init__()
        self.setWindowTitle("SPARQLSandbox Admin")
        self.setMinimumSize(980, 640)
        self.resize(1180, 780)
        self.ctx = Contexte(profils or DepotProfils(), self)
        ctx = self.ctx
        self.reglages = reglages or QSettings("SPARQLSandboxAdmin", "SPARQLSandboxAdmin")

        self.pages = [("Jeux de données", PageJeux(ctx)), ("Exercices", PageExercices(ctx)),
                      ("Sites interrogables", PageSites(ctx)), ("Réglages", PageReglages(ctx)),
                      ("Correction par IA", PageIA(ctx)), ("Maintenance", PageMaintenance(ctx))]
        self.perimees: set[int] = set()
        self.courante = 0

        # --- colonne de gauche
        self.plaque = PlaqueMachine(self)
        lateral = QWidget()
        lateral.setObjectName("lateral")
        lateral.setFixedWidth(240)
        ll = QVBoxLayout(lateral)
        ll.setContentsMargins(0, 16, 0, 12)
        ll.setSpacing(0)
        entourage = QVBoxLayout()
        entourage.setContentsMargins(14, 0, 14, 8)
        entourage.addWidget(self.plaque)
        ll.addLayout(entourage)
        boutons: dict[int, QPushButton] = {}
        for i, (titre, _) in enumerate(self.pages):
            b = QPushButton(titre)
            b.setCheckable(True)
            b.setAutoExclusive(True)
            b.setCursor(Qt.PointingHandCursor)
            b.setProperty("nav", True)
            b.setToolTip(f"⌘{i + 1}")
            b.clicked.connect(lambda _=False, i=i: self.aller(i))
            boutons[i] = b
        for groupe, indices in self.GROUPES:
            ll.addWidget(etiquette(groupe, "groupe"))
            for i in indices:
                ll.addWidget(boutons[i])
        ll.addStretch(1)
        self.nav = [boutons[i] for i in range(len(self.pages))]
        site = bouton("Ouvrir le site", "lien")
        site.clicked.connect(self.ouvre_site)
        pied = QHBoxLayout()
        pied.setContentsMargins(16, 0, 0, 0)
        pied.addWidget(site)
        pied.addStretch(1)
        ll.addLayout(pied)

        # --- zone de contenu
        self.pile = QStackedWidget()
        for _, page in self.pages:
            self.pile.addWidget(page)
        self.vide = EtatVide("Aucune machine",
                             "Ajoutez la machine à administrer (le Raspberry Pi, la production…) : "
                             "SPARQLSandbox Admin s'y connecte en SSH avec vos clés.",
                             "Ajouter une machine", self.gere_profils)
        self.pile.addWidget(self.vide)
        self.occupe = QProgressBar()
        self.occupe.setRange(0, 0)
        self.occupe.setTextVisible(False)
        self.occupe.setFixedHeight(3)
        self.occupe.hide()
        self.bandeau = QFrame()
        self.bandeau.setObjectName("bandeauProd")
        bl = QHBoxLayout(self.bandeau)
        bl.setContentsMargins(28, 7, 28, 7)
        bl.addWidget(QLabel("Production : ce que vous modifiez ici est vu tout de suite par les étudiants."))
        self.bandeau.hide()
        contenu = QWidget()
        contenu.setObjectName("contenu")
        cl = QVBoxLayout(contenu)
        cl.setContentsMargins(0, 0, 0, 0)
        cl.setSpacing(0)
        cl.addWidget(self.occupe)
        cl.addWidget(self.bandeau)
        cl.addWidget(self.pile, 1)

        centre = QWidget()
        cc = QHBoxLayout(centre)
        cc.setContentsMargins(0, 0, 0, 0)
        cc.setSpacing(0)
        cc.addWidget(lateral)
        cc.addWidget(contenu, 1)
        self.setCentralWidget(centre)
        self.toast = Notification(self)

        # --- menus et raccourcis
        a_profils = QAction("Gérer les machines…", self)
        a_profils.setShortcut(QKeySequence.Preferences)
        a_profils.triggered.connect(self.gere_profils)
        a_actu = QAction("Actualiser", self)
        a_actu.setShortcut(QKeySequence.Refresh)
        a_actu.triggered.connect(self.actualise)
        a_site = QAction("Ouvrir le site", self)
        a_site.triggered.connect(self.ouvre_site)
        menu = self.menuBar().addMenu("Machines")
        for a in (a_profils, a_actu, a_site):
            menu.addAction(a)
        self.menuBar().addMenu("Aide").addAction("À propos", self.a_propos)
        for i in range(len(self.pages)):
            QShortcut(QKeySequence(f"Ctrl+{i + 1}"), self, activated=lambda i=i: self.aller(i))
        QShortcut(QKeySequence.Save, self, activated=self.enregistre_page)

        # --- état
        ctx.travail.occupe.connect(self.occupe.setVisible)
        ctx.message.connect(lambda m: self.toast.montre(m))
        ctx.profil_change.connect(self._profil_change)
        self.restaure_fenetre()
        dernier = self.reglages.value("profil", "")
        noms = ctx.profils.noms()
        ctx.selectionne(dernier if dernier in noms else (noms[0] if noms else None))

    # --- fenêtre
    def restaure_fenetre(self):
        g = self.reglages.value("geometrie")
        if g:
            self.restoreGeometry(g)

    def closeEvent(self, e):
        self.reglages.setValue("geometrie", self.saveGeometry())
        self.ctx.travail.pool.waitForDone(3000)
        t = self.ctx._transport
        if t is not None:
            t.ferme()
        super().closeEvent(e)

    # --- machines
    def _modifs_en_attente(self) -> bool:
        """Vrai si l'utilisateur renonce à quitter la page courante à cause de modifications non enregistrées."""
        page = self.pages[self.courante][1]
        if not page.sale:
            return False
        b = QMessageBox(QMessageBox.Question, "Modifications non enregistrées",
                        f"La page « {self.pages[self.courante][0]} » a des modifications non enregistrées.",
                        QMessageBox.Cancel, self)
        b.setInformativeText("Les abandonner ?")
        ok = b.addButton("Abandonner les modifications", QMessageBox.DestructiveRole)
        b.setDefaultButton(b.button(QMessageBox.Cancel))
        b.exec()
        if b.clickedButton() is not ok:
            return True
        page.marque_sale(False)
        return False

    def change_machine(self, nom: str):
        if self.ctx.profil and self.ctx.profil.nom == nom:
            return
        if self._modifs_en_attente():
            return
        self.ctx.selectionne(nom)

    def _profil_change(self):
        p = self.ctx.profil
        self.plaque.actualise(p)
        self.bandeau.setVisible(bool(p and p.production))
        self.setWindowTitle("SPARQLSandbox Admin" + (f" — {p.nom}" if p else ""))
        if p:
            self.reglages.setValue("profil", p.nom)
        for _, page in self.pages:
            page.marque_sale(False)
        self.perimees = set(range(len(self.pages)))
        self._affiche(self.courante)

    def gere_profils(self):
        DialogueProfils(self.ctx, self).exec()
        self.plaque.actualise(self.ctx.profil)
        self.bandeau.setVisible(self.ctx.production)
        if self.ctx.profil is None and self.ctx.profils.noms():
            self.ctx.selectionne(self.ctx.profils.noms()[0])
        elif self.ctx.profil is None:
            self._affiche(self.courante)

    # --- navigation
    def aller(self, i: int):
        if i != self.courante and self._modifs_en_attente():
            self.nav[self.courante].setChecked(True)
            return
        self.courante = i
        self._affiche(i)

    def _affiche(self, i: int):
        self.nav[i].setChecked(True)
        if self.ctx.profil is None:
            self.pile.setCurrentWidget(self.vide)
            return
        self.pile.setCurrentIndex(i)
        if i in self.perimees:
            self.perimees.discard(i)
            self.pages[i][1].recharge()

    def actualise(self):
        if self._modifs_en_attente():
            return
        self.perimees = set(range(len(self.pages)))
        self._affiche(self.courante)

    def enregistre_page(self):
        page = self.pages[self.courante][1]
        if page.sale and self.ctx.profil is not None:
            page.enregistre()

    def ouvre_site(self):
        p = self.ctx.profil
        if p and p.url:
            QDesktopServices.openUrl(QUrl(p.url))
        else:
            self.toast.montre("Aucune adresse publique pour cette machine : ajoutez-la dans « Gérer les machines ».",
                              erreur=True)

    def a_propos(self):
        QMessageBox.about(self, "SPARQLSandbox Admin",
                          f"<b>SPARQLSandbox Admin</b> {__version__}<br>Administration des installations de "
                          "SPARQLSandbox par SSH : jeux de données, exercices, sites interrogables, réglages.")
