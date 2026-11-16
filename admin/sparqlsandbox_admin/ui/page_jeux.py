"""Onglet « Jeux de données » : création, métadonnées, fichiers (ontologie, instances, formes), suppression."""
from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (QFileDialog, QFormLayout, QGroupBox, QHBoxLayout, QLabel, QLineEdit,
                               QListWidget, QListWidgetItem, QMessageBox, QPlainTextEdit, QPushButton,
                               QSplitter, QTableWidget, QTableWidgetItem, QVBoxLayout, QWidget,
                               QAbstractItemView, QHeaderView)

from ..jeux import FORMATS, Depot, Exemple, Jeu, JeuInvalide, verifie_jeu
from .dialogues import FILTRE_RDF, DialogueNouveauJeu


def taille_lisible(octets: int) -> str:
    if octets < 1024:
        return f"{octets} o"
    if octets < 1024 * 1024:
        return f"{octets / 1024:.1f} Ko"
    return f"{octets / 1024 / 1024:.1f} Mo"


class PageJeux(QWidget):
    def __init__(self, ctx):
        super().__init__()
        self.ctx = ctx
        self.jeu: Jeu | None = None
        self.tailles: dict[str, int] = {}
        self.exemples: list[Exemple] = []
        self._chargement = False

        # --- liste des jeux
        self.liste = QListWidget()
        self.liste.currentItemChanged.connect(self._selection)
        b_nouveau, b_suppr = QPushButton("Nouveau…"), QPushButton("Supprimer…")
        b_nouveau.clicked.connect(self.nouveau)
        b_suppr.clicked.connect(self.supprime)
        g = QWidget()
        gl = QVBoxLayout(g)
        gl.setContentsMargins(0, 0, 0, 0)
        gl.addWidget(self.liste, 1)
        h = QHBoxLayout()
        h.addWidget(b_nouveau)
        h.addWidget(b_suppr)
        gl.addLayout(h)

        # --- détail
        self.nom = QLabel()
        self.titre = QLineEdit()
        self.reference = QLineEdit()
        f = QFormLayout()
        f.addRow("Identifiant", self.nom)
        f.addRow("Titre", self.titre)
        f.addRow("Référence", self.reference)

        self.table = QTableWidget(0, 3)
        self.table.setHorizontalHeaderLabels(["Fichier", "Rôle", "Taille"])
        self.table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.table.setSelectionMode(QAbstractItemView.SingleSelection)
        self.table.setEditTriggers(QAbstractItemView.NoEditTriggers)
        self.table.horizontalHeader().setSectionResizeMode(0, QHeaderView.Stretch)
        self.table.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeToContents)
        self.table.horizontalHeader().setSectionResizeMode(2, QHeaderView.ResizeToContents)
        self.table.verticalHeader().hide()
        self.table.setMinimumHeight(130)
        self.table.setMaximumHeight(210)
        self.avertissement = QLabel()
        self.avertissement.setStyleSheet("color: #b45309")
        self.avertissement.setWordWrap(True)
        boutons = {}
        for cle, lib in [("ontologie", "Ajouter une ontologie…"), ("donnees", "Ajouter des instances…"),
                         ("formes", "Ajouter des formes SHACL…"), ("telecharger", "Télécharger…"),
                         ("retirer", "Retirer")]:
            boutons[cle] = QPushButton(lib)
        boutons["ontologie"].clicked.connect(lambda: self.ajoute("ontologie"))
        boutons["donnees"].clicked.connect(lambda: self.ajoute("donnees"))
        boutons["formes"].clicked.connect(lambda: self.ajoute("formes"))
        boutons["telecharger"].clicked.connect(self.telecharge)
        boutons["retirer"].clicked.connect(self.retire)
        hb = QHBoxLayout()
        for b in boutons.values():
            hb.addWidget(b)
        gf = QGroupBox("Fichiers (un fichier de même nom est remplacé ; l'ancien est sauvegardé sur ce Mac)")
        lf = QVBoxLayout(gf)
        lf.addWidget(self.table)
        lf.addWidget(self.avertissement)
        lf.addLayout(hb)

        self.description = QPlainTextEdit()
        self.description.setPlaceholderText("Description en HTML (<p>…</p>, <ul>…)")
        gd = QGroupBox("Description (HTML)")
        QVBoxLayout(gd).addWidget(self.description)

        self.liste_ex = QListWidget()
        self.liste_ex.currentRowChanged.connect(self._affiche_exemple)
        self.titre_ex = QLineEdit()
        self.titre_ex.setPlaceholderText("Titre de l'exemple")
        self.titre_ex.textEdited.connect(self._edite_exemple)
        self.requete_ex = QPlainTextEdit()
        self.requete_ex.setPlaceholderText("Requête SPARQL")
        self.requete_ex.setStyleSheet("font-family: Menlo, monospace; font-size: 14px")
        self.requete_ex.textChanged.connect(self._edite_exemple)
        b_ex_a, b_ex_s = QPushButton("Ajouter"), QPushButton("Supprimer")
        b_ex_a.clicked.connect(self.ajoute_exemple)
        b_ex_s.clicked.connect(self.supprime_exemple)
        ge = QGroupBox("Exemples de requêtes")
        le = QHBoxLayout(ge)
        gauche = QVBoxLayout()
        gauche.addWidget(self.liste_ex)
        hh = QHBoxLayout()
        hh.addWidget(b_ex_a)
        hh.addWidget(b_ex_s)
        gauche.addLayout(hh)
        droite = QVBoxLayout()
        droite.addWidget(self.titre_ex)
        droite.addWidget(self.requete_ex)
        le.addLayout(gauche, 1)
        le.addLayout(droite, 2)

        self.b_enregistre = QPushButton("Enregistrer les modifications")
        self.b_enregistre.setDefault(True)
        self.b_enregistre.clicked.connect(self.enregistre)
        self.b_ouvrir = QPushButton("Ouvrir le site")
        self.b_ouvrir.clicked.connect(self.ouvre_site)
        hbas = QHBoxLayout()
        hbas.addWidget(self.b_ouvrir)
        hbas.addStretch(1)
        hbas.addWidget(self.b_enregistre)

        self.detail = QWidget()
        dl = QVBoxLayout(self.detail)
        dl.addLayout(f)
        dl.addWidget(gf)
        dl.addWidget(gd, 1)
        dl.addWidget(ge, 2)
        dl.addLayout(hbas)
        self.detail.setEnabled(False)

        s = QSplitter()
        s.addWidget(g)
        s.addWidget(self.detail)
        s.setStretchFactor(1, 1)
        s.setSizes([200, 800])
        QVBoxLayout(self).addWidget(s)

    # --- chargement
    def recharge(self, selection: str | None = None):
        ctx = self.ctx
        if ctx.profil is None:
            self.liste.clear()
            self.detail.setEnabled(False)
            return
        garde = selection or (self.jeu.nom if self.jeu else None)

        def fini(res):
            self.liste.blockSignals(True)
            self.liste.clear()
            for nom, jeu, erreur in res:
                it = QListWidgetItem(("⚠️ " if erreur else "") + (jeu.titre if jeu else nom))
                it.setData(Qt.UserRole, nom)
                it.setToolTip(erreur or nom)
                self.liste.addItem(it)
            self.liste.blockSignals(False)
            noms = [r[0] for r in res]
            self.liste.setCurrentRow(noms.index(garde) if garde in noms else -1)
            self._selection(self.liste.currentItem(), None)
            ctx.message.emit(f"{len(res)} jeu(x) de données.")

        ctx.lance(lambda: ctx.depot().lister(), fini)

    def _nom_courant(self) -> str | None:
        it = self.liste.currentItem()
        return it.data(Qt.UserRole) if it else None

    def _selection(self, courant, _precedent):
        nom = courant.data(Qt.UserRole) if courant else None
        if nom is None:
            self.jeu = None
            self.detail.setEnabled(False)
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
            self.detail.setEnabled(False)
            ctx.erreur(f"Le jeu « {nom} » est illisible :\n{m}")

        ctx.lance(travail, fini, erreur)

    def _affiche(self):
        j = self.jeu
        self._chargement = True
        self.detail.setEnabled(True)
        self.nom.setText(j.nom)
        self.titre.setText(j.titre)
        self.reference.setText(j.reference)
        self.description.setPlainText(j.description)
        self.exemples = [Exemple(e.titre, e.requete) for e in j.exemples]
        self.liste_ex.clear()
        self.liste_ex.addItems([e.titre or "(sans titre)" for e in self.exemples])
        self.table.setRowCount(0)
        for f in j.fichiers + j.formes:
            r = self.table.rowCount()
            self.table.insertRow(r)
            role = "Formes SHACL" if f in j.formes else "Données"
            taille = taille_lisible(self.tailles[f]) if f in self.tailles else "absent !"
            for c, v in enumerate((f, role, taille)):
                self.table.setItem(r, c, QTableWidgetItem(v))
        self.avertissement.setText(("Fichiers déclarés mais absents : " + ", ".join(j.absents) +
                                    ". Le jeu est ignoré par SPARQLSandbox.") if j.absents else "")
        self.b_ouvrir.setVisible(bool(self.ctx.profil and self.ctx.profil.url))
        self._chargement = False
        if self.exemples:
            self.liste_ex.setCurrentRow(0)
        else:
            self._affiche_exemple(-1)

    # --- exemples
    def _affiche_exemple(self, ligne: int):
        self._chargement = True
        ok = 0 <= ligne < len(self.exemples)
        self.titre_ex.setEnabled(ok)
        self.requete_ex.setEnabled(ok)
        self.titre_ex.setText(self.exemples[ligne].titre if ok else "")
        self.requete_ex.setPlainText(self.exemples[ligne].requete if ok else "")
        self._chargement = False

    def _edite_exemple(self, *_):
        i = self.liste_ex.currentRow()
        if self._chargement or not 0 <= i < len(self.exemples):
            return
        self.exemples[i] = Exemple(self.titre_ex.text(), self.requete_ex.toPlainText())
        self.liste_ex.item(i).setText(self.titre_ex.text() or "(sans titre)")

    def ajoute_exemple(self):
        self.exemples.append(Exemple("Nouvel exemple", "SELECT * WHERE { ?s ?p ?o } LIMIT 10"))
        self.liste_ex.addItem("Nouvel exemple")
        self.liste_ex.setCurrentRow(len(self.exemples) - 1)
        self.titre_ex.setFocus()
        self.titre_ex.selectAll()

    def supprime_exemple(self):
        i = self.liste_ex.currentRow()
        if 0 <= i < len(self.exemples):
            del self.exemples[i]
            self.liste_ex.takeItem(i)

    # --- actions
    def _jeu_modifie(self) -> Jeu:
        j = self.jeu
        return Jeu(j.nom, self.titre.text().strip() or j.nom, list(j.fichiers), list(j.formes),
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
            ctx.message.emit(f"Jeu « {jeu.nom} » enregistré.")
            self.recharge(jeu.nom)

        ctx.lance(lambda: ctx.depot().enregistre(jeu), fini)

    def nouveau(self):
        if self.ctx.profil is None:
            return self.ctx.erreur("Créez d'abord une machine (menu Machines).")
        d = DialogueNouveauJeu(self)
        if d.exec() != d.Accepted:
            return
        try:
            jeu, fichiers = d.resultat()
        except OSError as e:
            return self.ctx.erreur(f"Fichier illisible : {e}")
        ctx = self.ctx
        ctx.lance(lambda: ctx.depot().cree(jeu, fichiers), lambda _: self._fait(f"Jeu « {jeu.nom} » créé.", jeu.nom))

    def supprime(self):
        nom = self._nom_courant()
        if not nom:
            return
        if not self.ctx.confirme("Supprimer le jeu de données",
                                 f"Supprimer le jeu « {nom} » de {self.ctx.profil.nom} ?",
                                 "Ses fichiers et son config.xml seront effacés de la machine ; "
                                 "une sauvegarde est gardée sur ce Mac. Les copies des étudiants disparaîtront "
                                 "avec le jeu (purge automatique)."):
            return
        ctx = self.ctx

        def fini(sauv):
            self._fait(f"Jeu « {nom} » supprimé" + (f" (sauvegarde : {sauv})." if sauv else "."))

        ctx.lance(lambda: ctx.depot().supprime(nom), fini)

    def _fait(self, message: str, selection: str | None = None):
        self.ctx.message.emit(message)
        if selection is None:
            self.jeu = None
        self.recharge(selection)

    def ajoute(self, role: str):
        if not self.jeu:
            return
        titres = {"ontologie": "Choisir l'ontologie", "donnees": "Choisir des fichiers d'instances",
                  "formes": "Choisir des formes SHACL"}
        chemins, _ = QFileDialog.getOpenFileNames(self, titres[role], "", FILTRE_RDF)
        if not chemins:
            return
        try:
            contenus = [(Path(c).name, Path(c).read_bytes()) for c in chemins]
        except OSError as e:
            return self.ctx.erreur(f"Fichier illisible : {e}")
        nom, ctx = self.jeu.nom, self.ctx

        def travail():
            d = ctx.depot()
            return [f"{n} : {d.ajoute_fichier(nom, n, c, role)}" for n, c in contenus]

        def fini(msgs):
            ctx.message.emit(" ; ".join(msgs))
            self.recharge(nom)

        ctx.lance(travail, fini)

    def _fichier_selectionne(self) -> str | None:
        r = self.table.currentRow()
        return self.table.item(r, 0).text() if r >= 0 else None

    def retire(self):
        f = self._fichier_selectionne()
        if not (f and self.jeu):
            return
        if not self.ctx.confirme("Retirer le fichier", f"Retirer « {f} » du jeu « {self.jeu.nom} » ?",
                                 "Il est effacé de la machine ; une sauvegarde est gardée sur ce Mac."):
            return
        nom, ctx = self.jeu.nom, self.ctx
        ctx.lance(lambda: ctx.depot().retire_fichier(nom, f),
                  lambda _: self._fait(f"« {f} » retiré.", nom))

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
        from PySide6.QtCore import QUrl
        from PySide6.QtGui import QDesktopServices
        if self.ctx.profil and self.ctx.profil.url and self.jeu:
            sep = "&" if "?" in self.ctx.profil.url else "?"
            QDesktopServices.openUrl(QUrl(f"{self.ctx.profil.url}{sep}jeu={self.jeu.nom}"))
