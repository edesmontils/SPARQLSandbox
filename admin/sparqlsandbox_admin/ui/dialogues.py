"""Boîtes de dialogue : gestion des profils, nouveau jeu."""
from __future__ import annotations

from pathlib import Path

from PySide6.QtWidgets import (QComboBox, QDialog, QDialogButtonBox, QFileDialog, QFormLayout, QHBoxLayout,
                               QLabel, QLineEdit, QListWidget, QMessageBox, QPushButton, QSpinBox,
                               QVBoxLayout, QWidget)

from .. import maintenance
from ..jeux import NOM_JEU, FORMATS, Jeu
from ..profils import Profil

FILTRE_RDF = "Fichiers RDF (" + " ".join("*" + e for e in FORMATS) + ");;Tous les fichiers (*)"


class ChampFichier(QWidget):
    """Champ de saisie d'un chemin local avec bouton « Parcourir… »."""

    def __init__(self, filtre: str = FILTRE_RDF, parent=None):
        super().__init__(parent)
        self.champ = QLineEdit()
        b = QPushButton("Parcourir…")
        b.clicked.connect(self._parcourir)
        l = QHBoxLayout(self)
        l.setContentsMargins(0, 0, 0, 0)
        l.addWidget(self.champ, 1)
        l.addWidget(b)
        self.filtre = filtre

    def _parcourir(self):
        f, _ = QFileDialog.getOpenFileName(self, "Choisir un fichier", "", self.filtre)
        if f:
            self.champ.setText(f)

    def texte(self) -> str:
        return self.champ.text().strip()


class DialogueNouveauJeu(QDialog):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Nouveau jeu de données")
        self.setMinimumWidth(520)
        self.nom = QLineEdit()
        self.nom.setPlaceholderText("minuscules, chiffres, - et _")
        self.titre = QLineEdit()
        self.ontologie = ChampFichier()
        self.instances = ChampFichier()
        f = QFormLayout(self)
        f.addRow("Nom (identifiant)", self.nom)
        f.addRow("Titre", self.titre)
        f.addRow("Ontologie (facultatif)", self.ontologie)
        f.addRow("Instances", self.instances)
        f.addRow(QLabel("Une ontologie seule est possible ; sinon, indiquez au moins les instances."))
        bb = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
        bb.accepted.connect(self._valide)
        bb.rejected.connect(self.reject)
        f.addRow(bb)

    def _valide(self):
        if not NOM_JEU.match(self.nom.text()):
            QMessageBox.warning(self, "Nom invalide", "Le nom doit être en minuscules, chiffres, - et _.")
        elif not (self.ontologie.texte() or self.instances.texte()):
            QMessageBox.warning(self, "Fichier manquant", "Indiquez au moins un fichier (ontologie ou instances).")
        else:
            self.accept()

    def resultat(self) -> tuple[Jeu, dict[str, bytes]]:
        """Le jeu à créer et le contenu de ses fichiers (lus ici, dans le fil de l'interface)."""
        fichiers: dict[str, bytes] = {}
        noms = []
        for champ in (self.ontologie, self.instances):
            if champ.texte():
                p = Path(champ.texte())
                fichiers[p.name] = p.read_bytes()
                noms.append(p.name)
        return Jeu(self.nom.text(), self.titre.text().strip() or self.nom.text(), noms), fichiers


class DialogueProfils(QDialog):
    """Liste des machines administrées et formulaire du profil sélectionné."""

    def __init__(self, ctx, parent=None):
        super().__init__(parent)
        self.ctx = ctx
        self.setWindowTitle("Machines")
        self.setMinimumSize(780, 480)
        self.liste = QListWidget()
        self.liste.setMaximumWidth(190)
        self.liste.currentRowChanged.connect(self._affiche)
        self.nom = QLineEdit()
        self.type = QComboBox()
        self.type.addItem("Machine distante (SSH)", "ssh")
        self.type.addItem("Ce Mac (local)", "local")
        self.type.currentIndexChanged.connect(self._type_change)
        self.hote = QLineEdit()
        self.hote.setPlaceholderText("adresse ou alias de ~/.ssh/config")
        self.utilisateur = QLineEdit()
        self.port = QSpinBox()
        self.port.setRange(0, 65535)
        self.port.setSpecialValueText("par défaut")
        self.cle = ChampFichier("Tous les fichiers (*)")
        self.racine = QLineEdit()
        self.racine.setPlaceholderText("dossier qui contient donnees/ (index.php)")
        self.ini = QLineEdit()
        self.ini_ia = QLineEdit()
        self.tmp = QLineEdit()
        self.url = QLineEdit()
        self.url.setPlaceholderText("https://…/SPARQLSandbox/")
        self.form = QFormLayout()
        for lib, w in [("Nom", self.nom), ("Type", self.type), ("Hôte SSH", self.hote),
                       ("Utilisateur", self.utilisateur), ("Port", self.port), ("Clé privée", self.cle),
                       ("Racine du site", self.racine), ("sparqlsandbox.ini", self.ini),
                       ("sparqlsandbox-ia.ini", self.ini_ia), ("Dossier de travail", self.tmp),
                       ("Adresse publique", self.url)]:
            self.form.addRow(lib, w)
        aide = QLabel("Authentification : clés SSH et agent de l'utilisateur (aucun mot de passe n'est "
                      "mémorisé). Les chemins laissés vides sont déduits de la racine du site.")
        aide.setWordWrap(True)
        b_ajout, b_suppr = QPushButton("Ajouter"), QPushButton("Supprimer")
        b_test = QPushButton("Tester")
        b_ok = QPushButton("Enregistrer")
        b_ok.setDefault(True)
        b_ajout.clicked.connect(self._ajoute)
        b_suppr.clicked.connect(self._supprime)
        b_test.clicked.connect(self._teste)
        b_ok.clicked.connect(self._enregistre)
        gauche = QVBoxLayout()
        gauche.addWidget(self.liste, 1)
        h = QHBoxLayout()
        h.addWidget(b_ajout)
        h.addWidget(b_suppr)
        gauche.addLayout(h)
        droite = QVBoxLayout()
        droite.addLayout(self.form)
        droite.addWidget(aide)
        droite.addStretch(1)
        h2 = QHBoxLayout()
        h2.addStretch(1)
        h2.addWidget(b_test)
        h2.addWidget(b_ok)
        droite.addLayout(h2)
        racine = QHBoxLayout(self)
        racine.addLayout(gauche)
        racine.addLayout(droite, 1)
        self._ancien: str | None = None
        self._remplit(self.ctx.profil.nom if self.ctx.profil else None)

    def _remplit(self, selection: str | None):
        self.liste.blockSignals(True)
        self.liste.clear()
        self.liste.addItems(self.ctx.profils.noms())
        self.liste.blockSignals(False)
        noms = self.ctx.profils.noms()
        self.liste.setCurrentRow(noms.index(selection) if selection in noms else (0 if noms else -1))
        self._affiche(self.liste.currentRow())

    def _affiche(self, ligne: int):
        noms = self.ctx.profils.noms()
        p = self.ctx.profils.trouve(noms[ligne]) if 0 <= ligne < len(noms) else None
        self._ancien = p.nom if p else None
        p = p or Profil("", racine="")
        self.nom.setText(p.nom)
        self.type.setCurrentIndex(self.type.findData(p.type))
        self.hote.setText(p.hote)
        self.utilisateur.setText(p.utilisateur)
        self.port.setValue(p.port)
        self.cle.champ.setText(p.cle)
        self.racine.setText(p.racine)
        self.ini.setText(p.ini)
        self.ini_ia.setText(p.ini_ia)
        self.tmp.setText(p.dossier_tmp)
        self.url.setText(p.url)
        self._type_change()

    def _type_change(self):
        ssh = self.type.currentData() == "ssh"
        for w in (self.hote, self.utilisateur, self.port, self.cle):
            w.setEnabled(ssh)

    def _profil(self) -> Profil:
        return Profil(self.nom.text().strip(), self.type.currentData(), self.hote.text().strip(),
                      self.utilisateur.text().strip(), self.port.value(), self.cle.texte(),
                      self.racine.text().strip().rstrip("/") or "", self.ini.text().strip(),
                      self.ini_ia.text().strip(), self.tmp.text().strip(), self.url.text().strip())

    def _ajoute(self):
        self.liste.blockSignals(True)
        self.liste.setCurrentRow(-1)
        self.liste.blockSignals(False)
        self._ancien = None
        self._affiche_vide()

    def _affiche_vide(self):
        for w in (self.nom, self.hote, self.utilisateur, self.racine, self.ini, self.ini_ia, self.tmp, self.url):
            w.clear()
        self.cle.champ.clear()
        self.port.setValue(0)
        self.type.setCurrentIndex(0)
        self.nom.setFocus()

    def _enregistre(self):
        p = self._profil()
        erreurs = p.erreurs()
        autre = self.ctx.profils.trouve(p.nom)
        if autre is not None and p.nom != self._ancien:
            erreurs.append("Une machine porte déjà ce nom.")
        if erreurs:
            QMessageBox.warning(self, "Profil incomplet", "\n".join(erreurs))
            return
        self.ctx.profils.remplace(self._ancien, p)
        if self.ctx.profil and self.ctx.profil.nom == self._ancien:
            self.ctx.selectionne(p.nom)
        self._remplit(p.nom)
        self.ctx.message.emit(f"Profil « {p.nom} » enregistré.")

    def _supprime(self):
        if self._ancien and self.ctx.confirme("Supprimer la machine",
                                              f"Supprimer le profil « {self._ancien} » ?",
                                              "Seul le profil est supprimé : la machine n'est pas touchée."):
            actuel = self.ctx.profil.nom if self.ctx.profil else None
            self.ctx.profils.supprime(self._ancien)
            if actuel == self._ancien:
                self.ctx.selectionne(None)
            self._remplit(None)

    def _teste(self):
        p = self._profil()
        erreurs = p.erreurs()
        if erreurs:
            QMessageBox.warning(self, "Profil incomplet", "\n".join(erreurs))
            return

        def travail():
            t = p.transport()
            try:
                return maintenance.diagnostic(t, p)
            finally:
                t.ferme()

        def fini(res):
            icones = {"ok": "✅", "avert": "⚠️", "erreur": "❌"}
            QMessageBox.information(self, "Test de la machine",
                                    "\n".join(f"{icones[n]} {m}" for n, m in res))

        self.ctx.lance(travail, fini)
