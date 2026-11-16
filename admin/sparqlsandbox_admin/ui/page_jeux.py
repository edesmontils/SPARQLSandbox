"""Page « Jeux de données » : liste à gauche, détail à droite (fichiers, description, exemples)."""
from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import QSize, Qt, QUrl
from PySide6.QtGui import QDesktopServices
from PySide6.QtWidgets import (QAbstractItemView, QFileDialog, QHBoxLayout, QHeaderView, QLabel,
                               QLineEdit, QListWidget, QListWidgetItem, QMenu, QMessageBox, QPlainTextEdit,
                               QSplitter, QStackedWidget, QTabWidget, QTableWidget, QTableWidgetItem,
                               QTextBrowser, QVBoxLayout, QWidget)

from ..jeux import Exemple, Jeu, verifie_jeu
from . import theme
from .composants import EtatVide, PageBase, ZoneDepot, bouton, etiquette
from .dialogues import FILTRE_RDF, DialogueNouveauJeu


def taille_lisible(octets: int) -> str:
    if octets < 1024:
        return f"{octets} o"
    if octets < 1024 * 1024:
        return f"{octets / 1024:.1f} Ko".replace(".", ",")
    return f"{octets / 1024 / 1024:.1f} Mo".replace(".", ",")


def pluriel(n: int, mot: str) -> str:
    return f"{n} {mot}{'s' if n > 1 else ''}"


def role_probable(nom_fichier: str) -> str:
    """Rôle d'un fichier déposé, d'après son nom."""
    n = nom_fichier.lower()
    if "forme" in n or "shape" in n or "shacl" in n:
        return "formes"
    if "ontolog" in n or "vocab" in n:
        return "ontologie"
    return "donnees"


class PageJeux(PageBase):
    def __init__(self, ctx):
        super().__init__(ctx, "Jeux de données", "")
        self.jeu: Jeu | None = None
        self.tailles: dict[str, int] = {}
        self.exemples: list[Exemple] = []
        self._chargement = False
        b_nouveau = bouton("Nouveau jeu…", "primaire")
        b_nouveau.clicked.connect(self.nouveau)
        self.actions.addWidget(b_nouveau)

        # --- liste
        self.liste = QListWidget()
        self.liste.setFixedWidth(270)
        self.liste.setSpacing(2)
        self.liste.currentItemChanged.connect(self._selection)

        # --- détail : en-tête
        self.titre_jeu = QLineEdit()
        self.titre_jeu.setProperty("role", "titre")
        self.titre_jeu.setPlaceholderText("Titre du jeu")
        self.titre_jeu.setToolTip("Cliquez pour modifier le titre")
        self.titre_jeu.textEdited.connect(self._edite)
        self.meta = etiquette("", "aide", False)
        self.b_site = bouton("Ouvrir sur le site", "lien")
        self.b_site.clicked.connect(self.ouvre_site)
        self.b_suppr = bouton("Supprimer ce jeu…", "danger")
        self.b_suppr.clicked.connect(self.supprime)
        meta = QHBoxLayout()
        meta.addWidget(self.meta)
        meta.addWidget(self.b_site)
        meta.addStretch(1)
        meta.addWidget(self.b_suppr)

        # --- onglet Fichiers
        self.table = QTableWidget(0, 3)
        self.table.setHorizontalHeaderLabels(["Fichier", "Rôle", "Taille"])
        self.table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.table.setSelectionMode(QAbstractItemView.SingleSelection)
        self.table.setEditTriggers(QAbstractItemView.NoEditTriggers)
        self.table.horizontalHeader().setSectionResizeMode(0, QHeaderView.Stretch)
        self.table.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeToContents)
        self.table.horizontalHeader().setSectionResizeMode(2, QHeaderView.ResizeToContents)
        self.table.horizontalHeader().setHighlightSections(False)
        self.table.horizontalHeader().setDefaultAlignment(Qt.AlignLeft | Qt.AlignVCenter)
        self.table.horizontalHeaderItem(2).setTextAlignment(Qt.AlignRight | Qt.AlignVCenter)
        self.table.verticalHeader().hide()
        self.table.setShowGrid(False)
        self.table.setFrameShape(QTableWidget.NoFrame)
        self.table.itemSelectionChanged.connect(self._maj_boutons)
        self.zone = ZoneDepot(self.table)
        self.zone.deposes.connect(self.depose)
        menu = QMenu(self)
        menu.addAction("Ontologie…", lambda: self.ajoute("ontologie"))
        menu.addAction("Instances (données)…", lambda: self.ajoute("donnees"))
        menu.addAction("Formes SHACL…", lambda: self.ajoute("formes"))
        self.b_ajoute = bouton("Ajouter un fichier ▾", "primaire")
        self.b_ajoute.setMenu(menu)
        self.b_telecharge = bouton("Télécharger…")
        self.b_retire = bouton("Retirer", "danger")
        self.b_telecharge.clicked.connect(self.telecharge)
        self.b_retire.clicked.connect(self.retire)
        barre = QHBoxLayout()
        barre.addWidget(self.b_ajoute)
        barre.addWidget(etiquette("ou glissez-les ici", "aide", False))
        barre.addStretch(1)
        barre.addWidget(self.b_telecharge)
        barre.addWidget(self.b_retire)
        self.avertissement = etiquette("", "aide")
        self.avertissement.setStyleSheet(f"color: {theme.DANGER}")
        note = etiquette("Ajouter, remplacer ou retirer un fichier s'applique tout de suite sur la machine. "
                         "L'ancien fichier est gardé dans les sauvegardes de ce Mac.", "aide")
        onglet_fichiers = QWidget()
        fl = QVBoxLayout(onglet_fichiers)
        fl.setContentsMargins(0, 14, 0, 0)
        fl.setSpacing(10)
        fl.addLayout(barre)
        fl.addWidget(self.zone, 1)
        fl.addWidget(self.avertissement)
        fl.addWidget(note)

        # --- onglet Description
        self.reference = QLineEdit()
        self.reference.setPlaceholderText("https://…  (page de référence du jeu, facultatif)")
        self.reference.textEdited.connect(self._edite)
        self.description = QPlainTextEdit()
        self.description.setProperty("role", "code")
        self.description.setPlaceholderText("<p>Ce que contient le jeu, en HTML…</p>")
        self.description.textChanged.connect(self._edite_description)
        self.apercu = QTextBrowser()
        self.apercu.setOpenLinks(False)
        onglet_desc = QWidget()
        dl = QVBoxLayout(onglet_desc)
        dl.setContentsMargins(0, 14, 0, 0)
        dl.setSpacing(8)
        dl.addWidget(etiquette("Référence", "champ"))
        dl.addWidget(self.reference)
        entetes = QHBoxLayout()
        entetes.addWidget(etiquette("Description (HTML)", "champ"), 1)
        entetes.addWidget(etiquette("Aperçu", "champ"), 1)
        dl.addLayout(entetes)
        sep = QSplitter()
        sep.addWidget(self.description)
        sep.addWidget(self.apercu)
        sep.setChildrenCollapsible(False)
        dl.addWidget(sep, 1)

        # --- onglet Exemples
        self.liste_ex = QListWidget()
        self.liste_ex.setMaximumWidth(300)
        self.liste_ex.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        self.liste_ex.setTextElideMode(Qt.ElideRight)
        self.liste_ex.currentRowChanged.connect(self._affiche_exemple)
        self.titre_ex = QLineEdit()
        self.titre_ex.setPlaceholderText("Titre de l'exemple")
        self.titre_ex.textEdited.connect(self._edite_exemple)
        self.requete_ex = QPlainTextEdit()
        self.requete_ex.setProperty("role", "code")
        self.requete_ex.setPlaceholderText("SELECT * WHERE { ?s ?p ?o } LIMIT 10")
        self.requete_ex.textChanged.connect(self._edite_exemple)
        b_ex_a = bouton("Ajouter un exemple")
        self.b_ex_s = bouton("Supprimer cet exemple", "danger")
        b_ex_a.clicked.connect(self.ajoute_exemple)
        self.b_ex_s.clicked.connect(self.supprime_exemple)
        onglet_ex = QWidget()
        el = QHBoxLayout(onglet_ex)
        el.setContentsMargins(0, 14, 0, 0)
        gauche = QVBoxLayout()
        gauche.addWidget(self.liste_ex, 1)
        gauche.addWidget(b_ex_a)
        droite = QVBoxLayout()
        droite.addWidget(etiquette("Titre", "champ"))
        droite.addWidget(self.titre_ex)
        droite.addWidget(etiquette("Requête", "champ"))
        droite.addWidget(self.requete_ex, 1)
        droite.addWidget(self.b_ex_s, 0, Qt.AlignRight)
        el.addLayout(gauche)
        el.addSpacing(16)
        el.addLayout(droite, 1)

        self.onglets = QTabWidget()
        self.onglets.setDocumentMode(True)
        self.onglets.addTab(onglet_fichiers, "Fichiers")
        self.onglets.addTab(onglet_desc, "Description")
        self.onglets.addTab(onglet_ex, "Exemples")

        self.detail = QWidget()
        dtl = QVBoxLayout(self.detail)
        dtl.setContentsMargins(0, 0, 0, 0)
        dtl.setSpacing(4)
        dtl.addWidget(self.titre_jeu)
        dtl.addLayout(meta)
        dtl.addSpacing(8)
        dtl.addWidget(self.onglets, 1)

        self.vide_aucun = EtatVide("Aucun jeu de données", "Créez un jeu à partir d'une ontologie et d'instances "
                                   "RDF : les étudiants pourront l'interroger.", "Nouveau jeu…", self.nouveau)
        self.vide_choix = EtatVide("Choisissez un jeu", "Sa description, ses fichiers et ses exemples "
                                   "s'affichent ici.")
        self.pile = QStackedWidget()
        for w in (self.detail, self.vide_aucun, self.vide_choix):
            self.pile.addWidget(w)
        ligne = QHBoxLayout()
        ligne.setSpacing(24)
        ligne.addWidget(self.liste)
        ligne.addWidget(self.pile, 1)
        self.corps.addLayout(ligne, 1)
        self._maj_boutons()

    # --- chargement
    def recharge(self, selection: str | None = None):
        ctx = self.ctx
        if ctx.profil is None:
            return
        garde = selection or (self.jeu.nom if self.jeu else None)

        def fini(res):
            self.liste.blockSignals(True)
            self.liste.clear()
            for nom, jeu, erreur in res:
                titre = jeu.titre if jeu else nom
                if erreur:
                    detail = f'<span style="color:{theme.DANGER}">config.xml illisible</span>'
                elif jeu.absents:
                    detail = f'<span style="color:{theme.DANGER}">{pluriel(len(jeu.absents), "fichier")} absent(s)</span>'
                else:
                    detail = f'{nom} · {pluriel(len(jeu.fichiers) + len(jeu.formes), "fichier")}'
                it = QListWidgetItem()
                it.setData(Qt.UserRole, nom)
                it.setToolTip(erreur or nom)
                it.setSizeHint(QSize(0, 54))
                self.liste.addItem(it)
                w = QLabel(f'<div style="font-size:14px"><b>{titre}</b></div>'
                           f'<div style="font-size:12px;color:{theme.ATTENUE}">{detail}</div>')
                w.setContentsMargins(8, 4, 8, 4)
                w.setAttribute(Qt.WA_TransparentForMouseEvents)
                self.liste.setItemWidget(it, w)
            self.liste.blockSignals(False)
            noms = [r[0] for r in res]
            self.sous_titre.setText(f"{pluriel(len(res), 'jeu')} sur {ctx.profil.nom}" if res else
                                    f"Aucun jeu sur {ctx.profil.nom}")
            self.liste.setCurrentRow(noms.index(garde) if garde in noms else -1)
            self._selection(self.liste.currentItem(), None, force=True)

        ctx.lance(lambda: ctx.depot().lister(), fini)

    def _nom_courant(self) -> str | None:
        it = self.liste.currentItem()
        return it.data(Qt.UserRole) if it else None

    def _selection(self, courant, precedent, force: bool = False):
        nom = courant.data(Qt.UserRole) if courant else None
        if not force and self.sale and self.jeu and nom != self.jeu.nom:
            b = QMessageBox(QMessageBox.Question, "Modifications non enregistrées",
                            f"« {self.jeu.titre} » a des modifications non enregistrées.", QMessageBox.Cancel, self)
            b.setInformativeText("Les abandonner ?")
            ok = b.addButton("Abandonner les modifications", QMessageBox.DestructiveRole)
            b.exec()
            if b.clickedButton() is not ok:
                self.liste.blockSignals(True)
                self.liste.setCurrentItem(precedent)
                self.liste.blockSignals(False)
                return
            self.marque_sale(False)
        if nom is None:
            self.jeu = None
            self.marque_sale(False)
            self.pile.setCurrentWidget(self.vide_aucun if self.liste.count() == 0 else self.vide_choix)
            return
        ctx = self.ctx

        def travail():
            d = ctx.depot()
            return d.lit(nom), d.tailles(nom)

        def fini(res):
            if self._nom_courant() != nom:
                return
            self.jeu, self.tailles = res
            self._affiche()

        def erreur(m):
            self.jeu = None
            self.pile.setCurrentWidget(self.vide_choix)
            ctx.erreur(f"Le jeu « {nom} » est illisible :\n{m}")

        ctx.lance(travail, fini, erreur)

    def _affiche(self):
        j = self.jeu
        if j is None:
            return
        self._chargement = True
        self.pile.setCurrentWidget(self.detail)
        self.titre_jeu.setText(j.titre)
        self.reference.setText(j.reference)
        self.description.setPlainText(j.description)
        self.apercu.setHtml(j.description)
        self.exemples = [Exemple(e.titre, e.requete) for e in j.exemples]
        self.liste_ex.clear()
        self.liste_ex.addItems([e.titre or "(sans titre)" for e in self.exemples])
        self.onglets.setTabText(2, f"Exemples ({len(self.exemples)})")
        self._affiche_fichiers()
        self._chargement = False
        if self.exemples:
            self.liste_ex.setCurrentRow(0)
        else:
            self._affiche_exemple(-1)
        self.marque_sale(False)

    def _affiche_fichiers(self):
        j = self.jeu
        self.table.setRowCount(0)
        for f in j.fichiers + j.formes:
            r = self.table.rowCount()
            self.table.insertRow(r)
            absent = f not in self.tailles
            role = "Formes SHACL" if f in j.formes else "Données"
            taille = "absent" if absent else taille_lisible(self.tailles[f])
            for c, v in enumerate((f, role, taille)):
                it = QTableWidgetItem(v)
                if c == 0:
                    it.setFont(theme.police_code())
                if c == 2:
                    it.setTextAlignment(Qt.AlignRight | Qt.AlignVCenter)
                if absent and c == 2:
                    it.setForeground(Qt.red)
                self.table.setItem(r, c, it)
            self.table.setRowHeight(r, 36)
        self.onglets.setTabText(0, f"Fichiers ({len(j.fichiers) + len(j.formes)})")
        self.meta.setText(f"Identifiant : {j.nom}")
        self.b_site.setVisible(bool(self.ctx.profil and self.ctx.profil.url))
        self.avertissement.setText(("Fichiers déclarés mais absents : " + ", ".join(j.absents) +
                                    ". SPARQLSandbox ignore ce jeu tant qu'ils manquent.") if j.absents else "")
        self._maj_boutons()

    def _maj_boutons(self):
        ok = self.table.currentRow() >= 0
        self.b_telecharge.setEnabled(ok)
        self.b_retire.setEnabled(ok)
        self.b_ex_s.setEnabled(self.liste_ex.currentRow() >= 0)

    # --- modifications
    def _edite(self, *_):
        if not self._chargement:
            self.marque_sale(True)

    def _edite_description(self):
        self.apercu.setHtml(self.description.toPlainText())
        self._edite()

    def _affiche_exemple(self, ligne: int):
        self._chargement = True
        ok = 0 <= ligne < len(self.exemples)
        self.titre_ex.setEnabled(ok)
        self.requete_ex.setEnabled(ok)
        self.titre_ex.setText(self.exemples[ligne].titre if ok else "")
        self.requete_ex.setPlainText(self.exemples[ligne].requete if ok else "")
        self._chargement = False
        self._maj_boutons()

    def _edite_exemple(self, *_):
        i = self.liste_ex.currentRow()
        if self._chargement or not 0 <= i < len(self.exemples):
            return
        self.exemples[i] = Exemple(self.titre_ex.text(), self.requete_ex.toPlainText())
        self.liste_ex.item(i).setText(self.titre_ex.text() or "(sans titre)")
        self.marque_sale(True)

    def ajoute_exemple(self):
        self.exemples.append(Exemple("Nouvel exemple", "SELECT * WHERE { ?s ?p ?o } LIMIT 10"))
        self.liste_ex.addItem("Nouvel exemple")
        self.liste_ex.setCurrentRow(len(self.exemples) - 1)
        self.onglets.setTabText(2, f"Exemples ({len(self.exemples)})")
        self.titre_ex.setFocus()
        self.titre_ex.selectAll()
        self.marque_sale(True)

    def supprime_exemple(self):
        i = self.liste_ex.currentRow()
        if 0 <= i < len(self.exemples):
            del self.exemples[i]
            self.liste_ex.takeItem(i)
            self.onglets.setTabText(2, f"Exemples ({len(self.exemples)})")
            self.marque_sale(True)

    def _jeu_modifie(self) -> Jeu:
        j = self.jeu
        return Jeu(j.nom, self.titre_jeu.text().strip() or j.nom, list(j.fichiers), list(j.formes),
                   self.reference.text().strip(), self.description.toPlainText().strip(),
                   [e for e in self.exemples if e.titre.strip() or e.requete.strip()])

    def enregistre(self):
        if not self.jeu:
            return
        jeu = self._jeu_modifie()
        problemes = verifie_jeu(jeu)
        if problemes:
            QMessageBox.warning(self, "Jeu invalide", "\n".join(problemes))
            return
        ctx = self.ctx

        def fini(_):
            self.marque_sale(False)
            ctx.message.emit(f"« {jeu.titre} » enregistré.")
            self.recharge(jeu.nom)

        ctx.lance(lambda: ctx.depot().enregistre(jeu), fini)

    def annule(self):
        self._affiche()

    # --- actions immédiates
    def nouveau(self):
        if self.ctx.profil is None:
            return self.ctx.erreur("Ajoutez d'abord une machine.")
        d = DialogueNouveauJeu(self)
        if d.exec() != d.Accepted:
            return
        try:
            jeu, fichiers = d.resultat()
        except OSError as e:
            return self.ctx.erreur(f"Fichier illisible : {e}")
        ctx = self.ctx
        self.marque_sale(False)
        ctx.lance(lambda: ctx.depot().cree(jeu, fichiers),
                  lambda _: (ctx.message.emit(f"Jeu « {jeu.titre} » créé."), self.recharge(jeu.nom)))

    def supprime(self):
        nom = self._nom_courant()
        if not nom:
            return
        ctx = self.ctx
        if not ctx.confirme("Supprimer le jeu de données", f"Supprimer le jeu « {nom} » de {ctx.profil.nom} ?",
                            "Ses fichiers et son config.xml sont effacés de la machine ; une sauvegarde est "
                            "gardée sur ce Mac. Les copies des étudiants disparaissent avec lui.",
                            mot=nom, libelle="Supprimer le jeu"):
            return

        def fini(sauv):
            self.marque_sale(False)
            self.jeu = None
            ctx.message.emit(f"Jeu « {nom} » supprimé" + (f" — sauvegarde dans {sauv}" if sauv else ""))
            self.recharge()

        ctx.lance(lambda: ctx.depot().supprime(nom), fini)

    def depose(self, chemins: list[str]):
        if not self.jeu:
            return
        for c in chemins:
            self._envoie([c], role_probable(Path(c).name))

    def ajoute(self, role: str):
        if not self.jeu:
            return
        titres = {"ontologie": "Choisir l'ontologie", "donnees": "Choisir des fichiers d'instances",
                  "formes": "Choisir des formes SHACL"}
        chemins, _ = QFileDialog.getOpenFileNames(self, titres[role], "", FILTRE_RDF)
        if chemins:
            self._envoie(chemins, role)

    def _envoie(self, chemins: list[str], role: str):
        try:
            contenus = [(Path(c).name, Path(c).read_bytes()) for c in chemins]
        except OSError as e:
            return self.ctx.erreur(f"Fichier illisible : {e}")
        nom, ctx = self.jeu.nom, self.ctx

        def travail():
            d = ctx.depot()
            return [f"{n} : {d.ajoute_fichier(nom, n, c, role)}" for n, c in contenus]

        def fini(msgs):
            ctx.message.emit(" · ".join(msgs))
            self._rafraichit_fichiers(nom)

        ctx.lance(travail, fini)

    def _rafraichit_fichiers(self, nom: str):
        """Relit les fichiers du jeu sans toucher aux modifications en cours dans le formulaire."""
        ctx = self.ctx

        def travail():
            d = ctx.depot()
            return d.lit(nom), d.tailles(nom)

        def fini(res):
            if not self.jeu or self.jeu.nom != nom:
                return
            lu, self.tailles = res
            self.jeu.fichiers, self.jeu.formes, self.jeu.absents = lu.fichiers, lu.formes, lu.absents
            self._affiche_fichiers()

        ctx.lance(travail, fini)

    def _fichier_selectionne(self) -> str | None:
        r = self.table.currentRow()
        return self.table.item(r, 0).text() if r >= 0 else None

    def retire(self):
        f = self._fichier_selectionne()
        if not (f and self.jeu):
            return
        ctx = self.ctx
        if not ctx.confirme("Retirer le fichier", f"Retirer « {f} » du jeu « {self.jeu.nom} » ?",
                            "Il est effacé de la machine ; une copie est gardée sur ce Mac.",
                            libelle="Retirer le fichier"):
            return
        nom = self.jeu.nom
        ctx.lance(lambda: ctx.depot().retire_fichier(nom, f),
                  lambda _: (ctx.message.emit(f"« {f} » retiré."), self._rafraichit_fichiers(nom)))

    def telecharge(self):
        f = self._fichier_selectionne()
        if not (f and self.jeu):
            return
        dest, _ = QFileDialog.getSaveFileName(self, "Enregistrer le fichier", str(Path.home() / "Downloads" / f))
        if not dest:
            return
        nom, ctx = self.jeu.nom, self.ctx
        ctx.lance(lambda: Path(dest).write_bytes(ctx.depot().lit_fichier(nom, f)),
                  lambda _: ctx.message.emit(f"« {f} » enregistré dans {dest}."))

    def ouvre_site(self):
        if self.ctx.profil and self.ctx.profil.url and self.jeu:
            sep = "&" if "?" in self.ctx.profil.url else "?"
            QDesktopServices.openUrl(QUrl(f"{self.ctx.profil.url}{sep}jeu={self.jeu.nom}"))
