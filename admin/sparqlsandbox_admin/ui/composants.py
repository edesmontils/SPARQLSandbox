"""Composants communs : page, barre de modifications, état vide, zone de dépôt, notification."""
from __future__ import annotations

from PySide6.QtCore import QEvent, QPoint, QTimer, Qt, Signal
from PySide6.QtWidgets import (QFrame, QHBoxLayout, QLabel, QPushButton, QVBoxLayout, QWidget)


def style(widget: QWidget, **proprietes) -> QWidget:
    """Pose des propriétés lues par la feuille de style (role, nav, production…)."""
    for k, v in proprietes.items():
        widget.setProperty(k, v)
    widget.style().unpolish(widget)
    widget.style().polish(widget)
    return widget


def etiquette(texte: str = "", role: str = "", mots: bool = True) -> QLabel:
    l = QLabel(texte)
    l.setWordWrap(mots)
    if role:
        l.setProperty("role", role)
    l.setTextInteractionFlags(Qt.TextSelectableByMouse)
    return l


def bouton(texte: str, role: str = "", infobulle: str = "") -> QPushButton:
    b = QPushButton(texte)
    b.setCursor(Qt.PointingHandCursor)
    if role:
        b.setProperty("role", role)
    if infobulle:
        b.setToolTip(infobulle)
    return b


class BarreModifs(QFrame):
    """Barre collée en bas d'une page : apparaît quand des modifications ne sont pas enregistrées."""
    enregistrer = Signal()
    annuler = Signal()

    def __init__(self, libelle_ok: str = "Enregistrer"):
        super().__init__()
        self.setObjectName("barreModifs")
        self.etat = QLabel("Modifications non enregistrées")
        self.etat.setObjectName("etatModifs")
        self.b_annuler = bouton("Annuler les modifications")
        self.b_ok = bouton(libelle_ok, "primaire")
        self.b_ok.setToolTip("⌘S")
        self.b_annuler.clicked.connect(self.annuler)
        self.b_ok.clicked.connect(self.enregistrer)
        l = QHBoxLayout(self)
        l.setContentsMargins(28, 10, 28, 10)
        l.addWidget(self.etat, 1)
        l.addWidget(self.b_annuler)
        l.addWidget(self.b_ok)
        self.hide()


class PageBase(QWidget):
    """Une page : titre, sous-titre, actions, corps et barre de modifications.
    Les sous-classes remplissent ``self.corps`` et définissent recharge/enregistre/annule."""
    modifiee = Signal(bool)

    def __init__(self, ctx, titre: str, sous_titre: str = "", libelle_ok: str = "Enregistrer"):
        super().__init__()
        self.ctx = ctx
        self._sale = False
        self.titre = etiquette(titre)
        self.titre.setObjectName("titrePage")
        self.sous_titre = etiquette(sous_titre)
        self.sous_titre.setObjectName("sousTitre")
        self.actions = QHBoxLayout()
        self.actions.setSpacing(8)
        entete = QHBoxLayout()
        textes = QVBoxLayout()
        textes.setSpacing(2)
        textes.addWidget(self.titre)
        textes.addWidget(self.sous_titre)
        entete.addLayout(textes, 1)
        entete.addLayout(self.actions)
        self.corps = QVBoxLayout()
        self.corps.setContentsMargins(0, 0, 0, 0)
        self.barre = BarreModifs(libelle_ok)
        self.barre.enregistrer.connect(self.enregistre)
        self.barre.annuler.connect(self.annule)
        haut = QWidget()
        hl = QVBoxLayout(haut)
        hl.setContentsMargins(28, 24, 28, 16)
        hl.setSpacing(16)
        hl.addLayout(entete)
        hl.addLayout(self.corps, 1)
        l = QVBoxLayout(self)
        l.setContentsMargins(0, 0, 0, 0)
        l.setSpacing(0)
        l.addWidget(haut, 1)
        l.addWidget(self.barre)

    # modifications en attente
    @property
    def sale(self) -> bool:
        return self._sale

    def marque_sale(self, sale: bool = True):
        if sale != self._sale:
            self._sale = sale
            self.barre.setVisible(sale)
            self.modifiee.emit(sale)

    # à définir
    def recharge(self):
        pass

    def enregistre(self):
        pass

    def annule(self):
        self.marque_sale(False)
        self.recharge()


class EtatVide(QWidget):
    """Message d'une zone vide : dit ce qu'on peut faire, avec l'action sous la main."""

    def __init__(self, titre: str, texte: str, libelle_action: str = "", action=None):
        super().__init__()
        l = QVBoxLayout(self)
        l.setAlignment(Qt.AlignCenter)
        l.setSpacing(6)
        t = etiquette(titre, "section")
        t.setAlignment(Qt.AlignCenter)
        d = etiquette(texte, "aide")
        d.setAlignment(Qt.AlignCenter)
        d.setMaximumWidth(420)
        l.addWidget(t)
        l.addWidget(d, 0, Qt.AlignCenter)
        if libelle_action:
            b = bouton(libelle_action, "primaire")
            b.clicked.connect(action)
            l.addSpacing(8)
            l.addWidget(b, 0, Qt.AlignCenter)


class ZoneDepot(QFrame):
    """Entoure un widget et accepte le dépôt de fichiers (glisser-déposer depuis le Finder)."""
    deposes = Signal(list)

    def __init__(self, interieur: QWidget):
        super().__init__()
        self.setObjectName("zoneDepot")
        self.setAcceptDrops(True)
        l = QVBoxLayout(self)
        l.setContentsMargins(0, 0, 0, 0)
        l.addWidget(interieur)

    def dragEnterEvent(self, e):
        if e.mimeData().hasUrls():
            e.acceptProposedAction()
            style(self, survol=True)

    def dragLeaveEvent(self, e):
        style(self, survol=False)

    def dropEvent(self, e):
        style(self, survol=False)
        chemins = [u.toLocalFile() for u in e.mimeData().urls() if u.isLocalFile()]
        if chemins:
            e.acceptProposedAction()
            self.deposes.emit(chemins)


class Notification(QLabel):
    """Message bref en bas de la fenêtre (remplace la barre d'état)."""

    def __init__(self, fenetre: QWidget):
        super().__init__(fenetre)
        self.setObjectName("toast")
        self.fenetre = fenetre
        self.setAttribute(Qt.WA_TransparentForMouseEvents)
        self.minuteur = QTimer(self)
        self.minuteur.setSingleShot(True)
        self.minuteur.timeout.connect(self.hide)
        fenetre.installEventFilter(self)
        self.hide()

    def montre(self, texte: str, erreur: bool = False, duree: int = 4500):
        self.setText(texte)
        style(self, erreur=erreur)
        self.setMaximumWidth(max(300, self.fenetre.width() - 80))
        self.adjustSize()
        self.place()
        self.show()
        self.raise_()
        self.minuteur.start(duree)

    def place(self):
        self.move(QPoint((self.fenetre.width() - self.width()) // 2, self.fenetre.height() - self.height() - 28))

    def eventFilter(self, obj, ev):
        if obj is self.fenetre and ev.type() == QEvent.Resize and self.isVisible():
            self.place()
        return False
