"""Boîtes de dialogue : gestion des machines, nouveau jeu."""
from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (QCheckBox, QComboBox, QDialog, QFileDialog, QFormLayout, QFrame, QHBoxLayout,
                               QLabel, QLineEdit, QListWidget, QMessageBox, QScrollArea, QSpinBox, QVBoxLayout, QWidget)

from .. import maintenance
from ..jeux import FORMATS, NOM_JEU, Jeu
from ..profils import Profil
from .composants import bouton, etiquette

FILTRE_RDF = "Fichiers RDF (" + " ".join("*" + e for e in FORMATS) + ");;Tous les fichiers (*)"


class ChampFichier(QWidget):
    """Champ de saisie d'un chemin local avec bouton « Choisir… »."""

    def __init__(self, filtre: str = FILTRE_RDF, parent=None):
        super().__init__(parent)
        self.champ = QLineEdit()
        b = bouton("Choisir…")
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


def formulaire(parent: QWidget | None = None) -> QFormLayout:
    f = QFormLayout()
    f.setHorizontalSpacing(16)
    f.setVerticalSpacing(12)
    f.setLabelAlignment(Qt.AlignRight | Qt.AlignVCenter)
    f.setFieldGrowthPolicy(QFormLayout.ExpandingFieldsGrow)
    return f


def section(titre: str) -> QLabel:
    return etiquette(titre, "section")


class DialogueNouveauJeu(QDialog):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Nouveau jeu de données")
        self.setMinimumWidth(560)
        self.nom = QLineEdit()
        self.nom.setPlaceholderText("cinema")
        self.nom.setProperty("role", "code")
        self.titre = QLineEdit()
        self.titre.setPlaceholderText("Cinéma")
        self.ontologie = ChampFichier()
        self.instances = ChampFichier()
        f = formulaire()
        f.addRow("Identifiant", self.nom)
        f.addRow("Titre", self.titre)
        aide = etiquette("L'identifiant (minuscules, chiffres, - et _) sert de nom de dossier et d'adresse : "
                         "il ne change plus ensuite.", "aide")
        fichiers = formulaire()
        fichiers.addRow("Ontologie", self.ontologie)
        fichiers.addRow("Instances", self.instances)
        aide2 = etiquette("Indiquez au moins un fichier. D'autres s'ajoutent ensuite depuis la page du jeu.", "aide")
        self.b_ok = bouton("Créer le jeu", "primaire")
        b_annule = bouton("Annuler")
        self.b_ok.setDefault(True)
        self.b_ok.clicked.connect(self._valide)
        b_annule.clicked.connect(self.reject)
        bas = QHBoxLayout()
        bas.addStretch(1)
        bas.addWidget(b_annule)
        bas.addWidget(self.b_ok)
        l = QVBoxLayout(self)
        l.setContentsMargins(24, 22, 24, 20)
        l.setSpacing(10)
        l.addWidget(section("Identité"))
        l.addLayout(f)
        l.addWidget(aide)
        l.addSpacing(8)
        l.addWidget(section("Fichiers de départ"))
        l.addLayout(fichiers)
        l.addWidget(aide2)
        l.addSpacing(10)
        l.addLayout(bas)

    def _valide(self):
        if not NOM_JEU.match(self.nom.text()):
            QMessageBox.warning(self, "Identifiant invalide",
                                "L'identifiant doit être en minuscules, chiffres, - et _, et commencer par une "
                                "lettre ou un chiffre.")
        elif not (self.ontologie.texte() or self.instances.texte()):
            QMessageBox.warning(self, "Fichier manquant", "Indiquez au moins un fichier : ontologie ou instances.")
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
    """Liste des machines administrées et formulaire de la machine sélectionnée."""

    def __init__(self, ctx, parent=None):
        super().__init__(parent)
        self.ctx = ctx
        self.setWindowTitle("Machines")
        self.setMinimumSize(900, 600)
        self.resize(960, 760)
        self.liste = QListWidget()
        self.liste.setFixedWidth(210)
        self.liste.currentRowChanged.connect(self._affiche)
        self.nom = QLineEdit()
        self.type = QComboBox()
        self.type.addItem("Machine distante (SSH)", "ssh")
        self.type.addItem("Ce Mac", "local")
        self.type.currentIndexChanged.connect(self._type_change)
        self.hote = QLineEdit()
        self.hote.setPlaceholderText("adresse ou alias de ~/.ssh/config")
        self.utilisateur = QLineEdit()
        self.utilisateur.setPlaceholderText("le compte qui possède le site (pas root)")
        self.port = QSpinBox()
        self.port.setRange(0, 65535)
        self.port.setSpecialValueText("par défaut")
        self.cle = ChampFichier("Tous les fichiers (*)")
        self.racine = QLineEdit()
        self.racine.setPlaceholderText("le dossier qui contient donnees/ et index.php")
        self.ini = QLineEdit()
        self.ini_ia = QLineEdit()
        self.tmp = QLineEdit()
        self.url = QLineEdit()
        self.url.setPlaceholderText("https://…/SPARQLSandbox/")
        self.relance = QLineEdit()
        self.relance.setProperty("role", "code")
        self.relance.setPlaceholderText("facultatif, ex. : sudo -n systemctl reload php-fpm")
        self.production = QCheckBox("Machine de production")
        self.production.setToolTip("Affiche un bandeau ambre et demande de recopier le nom pour les actions "
                                   "destructrices.")
        for w in (self.racine, self.ini, self.ini_ia, self.tmp):
            w.setProperty("role", "code")
        for w in (self.hote, self.cle.champ):
            w.setProperty("role", "code")

        identite = formulaire()
        identite.addRow("Nom", self.nom)
        identite.addRow("", self.production)
        connexion = formulaire()
        connexion.addRow("Type", self.type)
        connexion.addRow("Hôte SSH", self.hote)
        connexion.addRow("Utilisateur", self.utilisateur)
        connexion.addRow("Port", self.port)
        connexion.addRow("Clé privée", self.cle)
        emplacements = formulaire()
        emplacements.addRow("Racine du site", self.racine)
        emplacements.addRow("sparqlsandbox.ini", self.ini)
        emplacements.addRow("sparqlsandbox-ia.ini", self.ini_ia)
        emplacements.addRow("Dossier de travail", self.tmp)
        emplacements.addRow("Adresse publique", self.url)
        mise_a_jour = formulaire()
        mise_a_jour.addRow("Après la mise à jour", self.relance)
        aide_maj = etiquette("« Mettre à jour le site » fait un git pull (avance rapide seulement) dans la racine du "
                             "site, puis lance cette commande si elle est renseignée. Un site PHP n'a en général "
                             "pas besoin d'être relancé ; sudo doit pouvoir s'exécuter sans mot de passe (sudo -n).",
                             "aide")
        aide_conn = etiquette("Authentification par vos clés SSH et votre agent : aucun mot de passe n'est "
                              "mémorisé. La clé privée n'est utile que si elle n'est pas déjà dans ~/.ssh/config.",
                              "aide")
        aide_chemins = etiquette("Les chemins laissés vides sont déduits de la racine du site, à côté d'elle.",
                                 "aide")

        b_ajout = bouton("Ajouter une machine")
        b_suppr = bouton("Supprimer", "danger")
        b_test = bouton("Tester la connexion")
        b_maj = bouton("Mettre à jour le site…")
        b_maj.setToolTip("git pull sur la machine, puis la commande de relance")
        b_maj.clicked.connect(self._met_a_jour)
        b_ok = bouton("Enregistrer", "primaire")
        b_ferme = bouton("Fermer")
        b_ok.setDefault(True)
        b_ajout.clicked.connect(self._ajoute)
        b_suppr.clicked.connect(self._supprime)
        b_test.clicked.connect(self._teste)
        b_ok.clicked.connect(self._enregistre)
        b_ferme.clicked.connect(self.accept)

        gauche = QVBoxLayout()
        gauche.addWidget(section("Machines"))
        gauche.addWidget(self.liste, 1)
        gauche.addWidget(b_ajout)
        gauche.addWidget(b_suppr)
        droite = QVBoxLayout()
        droite.setSpacing(8)
        droite.setContentsMargins(0, 0, 14, 0)
        droite.addWidget(section("Identité"))
        droite.addLayout(identite)
        droite.addSpacing(10)
        droite.addWidget(section("Connexion"))
        droite.addLayout(connexion)
        droite.addWidget(aide_conn)
        droite.addSpacing(10)
        droite.addWidget(section("Emplacements sur la machine"))
        droite.addLayout(emplacements)
        droite.addWidget(aide_chemins)
        droite.addSpacing(10)
        droite.addWidget(section("Mise à jour du site"))
        droite.addLayout(mise_a_jour)
        droite.addWidget(aide_maj)
        droite.addStretch(1)
        contenu = QWidget()
        contenu.setObjectName("contenu")  # fond « papier » du thème
        contenu.setLayout(droite)
        defilement = QScrollArea()
        defilement.setWidgetResizable(True)
        defilement.setFrameShape(QFrame.NoFrame)
        defilement.viewport().setAutoFillBackground(False)
        defilement.setWidget(contenu)
        bas = QHBoxLayout()
        bas.addWidget(b_test)
        bas.addWidget(b_maj)
        bas.addStretch(1)
        bas.addWidget(b_ferme)
        bas.addWidget(b_ok)
        colonne = QVBoxLayout()
        colonne.setSpacing(12)
        colonne.addWidget(defilement, 1)
        colonne.addLayout(bas)
        racine = QHBoxLayout(self)
        racine.setContentsMargins(22, 20, 22, 18)
        racine.setSpacing(24)
        racine.addLayout(gauche)
        racine.addLayout(colonne, 1)
        self._ancien: str | None = None
        self._remplit(self.ctx.profil.nom if self.ctx.profil else None)

    def _remplit(self, selection: str | None):
        self.liste.blockSignals(True)
        self.liste.clear()
        self.liste.addItems([p.nom + ("  ·  production" if p.production else "") for p in self.ctx.profils.profils])
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
        self.production.setChecked(p.production)
        self.relance.setText(p.commande_relance)
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
                      self.ini_ia.text().strip(), self.tmp.text().strip(), self.url.text().strip(),
                      self.production.isChecked(), self.relance.text().strip())

    def _ajoute(self):
        self.liste.blockSignals(True)
        self.liste.setCurrentRow(-1)
        self.liste.blockSignals(False)
        self._ancien = None
        for w in (self.nom, self.hote, self.utilisateur, self.racine, self.ini, self.ini_ia, self.tmp, self.url):
            w.clear()
        self.cle.champ.clear()
        self.port.setValue(0)
        self.production.setChecked(False)
        self.relance.clear()
        self.type.setCurrentIndex(0)
        self.nom.setFocus()

    def _enregistre(self):
        p = self._profil()
        erreurs = p.erreurs()
        if self.ctx.profils.trouve(p.nom) is not None and p.nom != self._ancien:
            erreurs.append("Une machine porte déjà ce nom.")
        if erreurs:
            QMessageBox.warning(self, "Machine incomplète", "\n".join(erreurs))
            return
        self.ctx.profils.remplace(self._ancien, p)
        if self.ctx.profil and self.ctx.profil.nom == self._ancien:
            self.ctx.selectionne(p.nom)
        self._remplit(p.nom)
        self.ctx.message.emit(f"Machine « {p.nom} » enregistrée.")

    def _supprime(self):
        if self._ancien and self.ctx.confirme("Supprimer la machine", f"Supprimer « {self._ancien} » de la liste ?",
                                              "Seul le profil est supprimé : la machine elle-même n'est pas touchée.",
                                              libelle="Supprimer"):
            actuel = self.ctx.profil.nom if self.ctx.profil else None
            self.ctx.profils.supprime(self._ancien)
            if actuel == self._ancien:
                self.ctx.selectionne(None)
            self._remplit(None)

    def _teste(self):
        p = self._profil()
        erreurs = p.erreurs()
        if erreurs:
            QMessageBox.warning(self, "Machine incomplète", "\n".join(erreurs))
            return

        def travail():
            t = p.transport()
            try:
                return maintenance.diagnostic(t, p)
            finally:
                t.ferme()

        def fini(res):
            icones = {"ok": "✓", "avert": "!", "erreur": "✕"}
            QMessageBox.information(self, f"Test de « {p.nom} »", "\n".join(f"{icones[n]}  {m}" for n, m in res))

        self.ctx.lance(travail, fini)

    def _met_a_jour(self):
        """Vérifie ce qu'il y a à récupérer, demande confirmation, puis git pull et relance."""
        p = self._profil()
        erreurs = p.erreurs()
        if erreurs:
            QMessageBox.warning(self, "Machine incomplète", "\n".join(erreurs))
            return
        ctx = self.ctx

        def verifie():
            t = p.transport()
            try:
                return maintenance.etat_depot(t, p.racine)
            finally:
                t.ferme()

        def propose(etat):
            if not etat.a_recuperer:
                QMessageBox.information(self, f"Mise à jour de « {p.nom} »",
                                        f"Le site est déjà à jour (branche {etat.branche}, commit {etat.tete}).")
                return
            b = QMessageBox(QMessageBox.Question, f"Mise à jour de « {p.nom} »",
                            f"{len(etat.a_recuperer)} modification(s) à récupérer sur la branche {etat.branche} :",
                            QMessageBox.Cancel, self)
            detail = "\n".join(etat.a_recuperer[:15]) + ("\n…" if len(etat.a_recuperer) > 15 else "")
            if etat.modifie:
                detail += ("\n\n⚠ Des fichiers suivis ont été modifiés sur la machine : si git ne peut pas les "
                           "concilier, la mise à jour s'arrête sans rien écraser.")
            if p.production:
                detail = "⚠ PRODUCTION : les étudiants verront le résultat tout de suite.\n\n" + detail
            if p.commande_relance:
                detail += f"\n\nPuis : {p.commande_relance}"
            b.setInformativeText(detail)
            ok = b.addButton("Mettre à jour", QMessageBox.AcceptRole)
            b.setDefaultButton(b.button(QMessageBox.Cancel))
            b.exec()
            if b.clickedButton() is ok:
                lance()

        def lance():
            def travail():
                t = p.transport()
                try:
                    return maintenance.met_a_jour(t, p.racine, p.commande_relance)
                finally:
                    t.ferme()

            def fini(r):
                lignes = [f"Commit {r.avant} → {r.apres}." if r.avant != r.apres else "Aucun changement."]
                lignes += r.commits[:15]
                if r.relance is not None:
                    code, sortie = r.relance
                    lignes.append("")
                    lignes.append("Relance : " + ("réussie." if code == 0 else f"ÉCHEC (code {code})."))
                    if sortie:
                        lignes.append(sortie[:600])
                (QMessageBox.information if r.relance is None or r.relance[0] == 0 else QMessageBox.warning)(
                    self, f"Mise à jour de « {p.nom} »", "\n".join(lignes))
                ctx.message.emit(f"« {p.nom} » mis à jour ({r.apres}).")

            ctx.lance(travail, fini)

        ctx.lance(verifie, propose)
