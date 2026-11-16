"""Pages « Exercices » (format QueryCraft) et « Maintenance »."""
from __future__ import annotations

import os
from pathlib import Path

from PySide6.QtCore import Qt, QUrl
from PySide6.QtGui import QDesktopServices
from PySide6.QtWidgets import (QAbstractItemView, QFileDialog, QHBoxLayout, QHeaderView, QInputDialog,
                               QStackedWidget, QTableWidget, QTableWidgetItem, QVBoxLayout, QWidget)

from .. import maintenance
from ..jeux import Depot
from . import theme
from .composants import EtatVide, PageBase, ZoneDepot, bouton, etiquette
from .page_jeux import pluriel, taille_lisible


def tableau(colonnes: list[str], etire: int = 0) -> QTableWidget:
    t = QTableWidget(0, len(colonnes))
    t.setHorizontalHeaderLabels(colonnes)
    t.setSelectionBehavior(QAbstractItemView.SelectRows)
    t.setSelectionMode(QAbstractItemView.SingleSelection)
    t.setEditTriggers(QAbstractItemView.NoEditTriggers)
    for i in range(len(colonnes)):
        t.horizontalHeader().setSectionResizeMode(i, QHeaderView.Stretch if i == etire else
                                                  QHeaderView.ResizeToContents)
    t.horizontalHeader().setHighlightSections(False)
    t.horizontalHeader().setDefaultAlignment(Qt.AlignLeft | Qt.AlignVCenter)
    t.verticalHeader().hide()
    t.setShowGrid(False)
    t.setFrameShape(QTableWidget.NoFrame)
    return t


def remplit(t: QTableWidget, lignes: list[list[str]], hauteur: int = 38) -> None:
    t.setRowCount(0)
    for valeurs in lignes:
        r = t.rowCount()
        t.insertRow(r)
        for c, v in enumerate(valeurs):
            t.setItem(r, c, QTableWidgetItem(v))
        t.setRowHeight(r, hauteur)


class PageExercices(PageBase):
    def __init__(self, ctx):
        super().__init__(ctx, "Exercices", "")
        b_ajout = bouton("Ajouter un exercice…", "primaire")
        b_ajout.clicked.connect(self.ajoute)
        self.actions.addWidget(b_ajout)
        self.table = tableau(["Code", "Jeu de données", "Questions", "Types de questions"], 3)
        self.table.itemSelectionChanged.connect(self._maj_boutons)
        self.zone = ZoneDepot(self.table)
        self.zone.deposes.connect(self.importe)
        self.vide = EtatVide("Aucun exercice", "Glissez ici un fichier JSON au format QueryCraft, ou ajoutez-le "
                             "avec le bouton ci-dessus. Les étudiants le trouvent dans le jeu qu'il vise.",
                             "Ajouter un exercice…", self.ajoute)
        self.pile = QStackedWidget()
        self.pile.addWidget(self.zone)
        self.pile.addWidget(self.vide)
        self.b_tel = bouton("Télécharger…")
        self.b_suppr = bouton("Supprimer…", "danger")
        self.b_tel.clicked.connect(self.telecharge)
        self.b_suppr.clicked.connect(self.supprime)
        pied = QHBoxLayout()
        pied.addWidget(etiquette("Un exercice est un fichier JSON de donnees/exercices/ : son code est le nom du "
                                 "fichier. Il porte sur le jeu dont l'un des fichiers s'appelle comme indiqué.",
                                 "aide"), 1)
        pied.addWidget(self.b_tel)
        pied.addWidget(self.b_suppr)
        self.corps.addWidget(self.pile, 1)
        self.corps.addLayout(pied)
        self._maj_boutons()

    def _maj_boutons(self):
        ok = self.table.currentRow() >= 0
        self.b_tel.setEnabled(ok)
        self.b_suppr.setEnabled(ok)

    def recharge(self):
        ctx = self.ctx
        if ctx.profil is None:
            return

        def fini(res):
            lignes = []
            for code, d in res:
                qs = d.get("questions", {}) if d else {}
                base = (d.get("database") or {}).get("name", "") if d else ""
                types = sorted({q[3] for q in qs.values() if isinstance(q, list) and len(q) > 3})
                lignes.append([code, base, str(len(qs)) if d else "JSON illisible", ", ".join(types)])
            remplit(self.table, lignes)
            self.sous_titre.setText(f"{pluriel(len(res), 'exercice')} sur {ctx.profil.nom}" if res else
                                    f"Aucun exercice sur {ctx.profil.nom}")
            self.pile.setCurrentWidget(self.zone if res else self.vide)
            self._maj_boutons()

        ctx.lance(lambda: ctx.depot().exercices(), fini)

    def _code(self) -> str | None:
        r = self.table.currentRow()
        return self.table.item(r, 0).text() if r >= 0 else None

    def ajoute(self):
        chemins, _ = QFileDialog.getOpenFileNames(self, "Choisir des exercices (JSON)", "", "JSON (*.json)")
        if chemins:
            self.importe(chemins)

    def importe(self, chemins: list[str]):
        ctx = self.ctx
        if ctx.profil is None:
            return
        for chemin in chemins:
            try:
                contenu = Path(chemin).read_bytes()
            except OSError as e:
                return ctx.erreur(f"Fichier illisible : {e}")
            _, err = Depot.verifie_exercice(contenu)
            if err:
                return ctx.erreur(f"« {Path(chemin).name} » n'est pas un exercice valide.\n{err}")
            code = Path(chemin).stem
            if len(chemins) == 1:
                code, ok = QInputDialog.getText(self, "Code de l'exercice",
                                                "Code de l'exercice (nom du fichier, sans .json) :", text=code)
                if not ok:
                    return
            code = code.strip()
            ctx.lance(lambda c=code, d=contenu: ctx.depot().ajoute_exercice(c, d),
                      lambda _, c=code: (ctx.message.emit(f"Exercice « {c} » enregistré."), self.recharge()))

    def telecharge(self):
        code = self._code()
        if not code:
            return
        dest, _ = QFileDialog.getSaveFileName(self, "Enregistrer l'exercice",
                                              str(Path.home() / "Downloads" / f"{code}.json"))
        if dest:
            ctx = self.ctx
            ctx.lance(lambda: Path(dest).write_bytes(ctx.depot().lit_exercice(code)),
                      lambda _: ctx.message.emit(f"Exercice enregistré dans {dest}."))

    def supprime(self):
        code = self._code()
        ctx = self.ctx
        if code and ctx.confirme("Supprimer l'exercice", f"Supprimer l'exercice « {code} » de {ctx.profil.nom} ?",
                                 "Une sauvegarde est gardée sur ce Mac.", libelle="Supprimer l'exercice"):
            ctx.lance(lambda: ctx.depot().supprime_exercice(code),
                      lambda _: (ctx.message.emit(f"Exercice « {code} » supprimé."), self.recharge()))


class PageMaintenance(PageBase):
    GLYPHES = {"ok": ("✓", theme.OK), "avert": ("!", theme.AMBRE_TEXTE), "erreur": ("✕", theme.DANGER)}

    def __init__(self, ctx):
        super().__init__(ctx, "Maintenance", "")
        b_diag = bouton("Relancer le diagnostic")
        b_diag.clicked.connect(self.diagnostic)
        self.actions.addWidget(b_diag)

        # --- diagnostic (à gauche)
        self.resultats = QVBoxLayout()
        self.resultats.setSpacing(8)
        gauche = QVBoxLayout()
        gauche.addWidget(etiquette("Diagnostic de l'installation", "section"))
        gauche.addSpacing(4)
        gauche.addLayout(self.resultats)
        gauche.addStretch(1)
        cg = QWidget()
        cg.setLayout(gauche)
        cg.setFixedWidth(340)

        # --- copies des étudiants (à droite)
        self.resume = etiquette("", "aide")
        self.table = tableau(["Jeu de données", "Copies", "Taille des copies", "Jeu d'origine"], 0)
        self.table.itemSelectionChanged.connect(self._maj_boutons)
        self.b_copies = bouton("Purger les copies de ce jeu…", "danger")
        self.b_toutes = bouton("Purger toutes les copies…", "danger")
        self.b_orig = bouton("Recharger les jeux d'origine…")
        b_sauv = bouton("Ouvrir les sauvegardes", "lien")
        self.b_copies.clicked.connect(lambda: self.purge_copies(True))
        self.b_toutes.clicked.connect(lambda: self.purge_copies(False))
        self.b_orig.clicked.connect(self.purge_origines)
        b_sauv.clicked.connect(self.ouvre_sauvegardes)
        actions = QVBoxLayout()
        actions.setSpacing(8)
        ligne1 = QHBoxLayout()
        ligne1.addWidget(self.b_copies)
        ligne1.addWidget(self.b_toutes)
        ligne1.addStretch(1)
        ligne2 = QHBoxLayout()
        ligne2.addWidget(self.b_orig)
        ligne2.addStretch(1)
        actions.addLayout(ligne1)
        actions.addLayout(ligne2)
        info = etiquette("Chaque étudiant travaille sur sa propre copie des jeux ; elle disparaît après la durée de "
                         "vie réglée. Purger les copies les efface tout de suite : chacun repart du jeu d'origine "
                         "et perd ses modifications. « Recharger » reconstruit les jeux d'origine et le cache des "
                         "tables d'exercices.", "aide")
        droite = QVBoxLayout()
        droite.setSpacing(10)
        droite.addWidget(etiquette("Copies des étudiants", "section"))
        droite.addWidget(self.resume)
        droite.addWidget(self.table, 1)
        droite.addLayout(actions)
        droite.addWidget(info)
        droite.addWidget(b_sauv, 0, Qt.AlignLeft)
        ligne = QHBoxLayout()
        ligne.setSpacing(32)
        ligne.addWidget(cg)
        ligne.addLayout(droite, 1)
        self.corps.addLayout(ligne, 1)
        self._maj_boutons()

    def recharge(self):
        self.etat()
        self.diagnostic()

    def etat(self):
        ctx = self.ctx
        if ctx.profil is None:
            return
        chemin = ctx.profil.chemin_tmp

        def fini(e):
            self.sous_titre.setText(f"Dossier de travail : {chemin}")
            if not e.tmp_existe:
                remplit(self.table, [])
                self.resume.setText("Le dossier de travail n'existe pas encore : il est créé à la première requête "
                                    "d'un étudiant.")
                return
            lignes = []
            for jeu in sorted(set(e.copies) | set(e.origines)):
                n, ko = e.copies.get(jeu, (0, 0))
                lignes.append([jeu, str(n), taille_lisible(ko * 1024), taille_lisible(e.origines.get(jeu, 0) * 1024)])
            remplit(self.table, lignes)
            libre = f" · {taille_lisible(e.libre_ko * 1024)} libres sur le disque" if e.libre_ko is not None else ""
            self.resume.setText(f"{pluriel(e.nb_copies, 'copie')} de session, {taille_lisible(e.ko_copies * 1024)}"
                                f"{libre}.")
            self._maj_boutons()

        ctx.lance(lambda: maintenance.etat(ctx.transport(), chemin), fini)

    def diagnostic(self):
        ctx = self.ctx
        if ctx.profil is None:
            return
        p = ctx.profil

        def fini(res):
            while self.resultats.count():
                w = self.resultats.takeAt(0).widget()
                if w:
                    w.deleteLater()
            for niveau, message in res:
                glyphe, couleur = self.GLYPHES[niveau]
                l = etiquette(f'<span style="color:{couleur};font-weight:700">{glyphe}</span>&nbsp;&nbsp;{message}')
                l.setTextFormat(Qt.RichText)
                self.resultats.addWidget(l)

        ctx.lance(lambda: maintenance.diagnostic(ctx.transport(), p), fini)

    def _jeu(self) -> str | None:
        r = self.table.currentRow()
        return self.table.item(r, 0).text() if r >= 0 else None

    def _maj_boutons(self):
        self.b_copies.setEnabled(self._jeu() is not None)

    def purge_copies(self, un_jeu: bool):
        ctx = self.ctx
        jeu = self._jeu() if un_jeu else None
        if un_jeu and not jeu:
            return
        cible = f"du jeu « {jeu} »" if jeu else "de tous les jeux"
        if not ctx.confirme("Purger les copies", f"Supprimer les copies de session {cible} sur {ctx.profil.nom} ?",
                            "Les étudiants perdent leurs modifications et repartent du jeu d'origine.",
                            mot="purger" if not jeu else "", libelle="Purger les copies"):
            return
        chemin = ctx.profil.chemin_tmp
        ctx.lance(lambda: maintenance.purge_copies(ctx.transport(), chemin, jeu),
                  lambda n: (ctx.message.emit(f"{pluriel(n, 'copie')} supprimée(s)."), self.etat()))

    def purge_origines(self):
        ctx = self.ctx
        jeu = self._jeu()
        cible = f"du jeu « {jeu} »" if jeu else "de tous les jeux"
        if not ctx.confirme("Recharger les jeux d'origine",
                            f"Supprimer les stores d'origine {cible} sur {ctx.profil.nom} ?",
                            "Ils sont reconstruits à la prochaine requête : le premier étudiant attend quelques "
                            "secondes de plus.", libelle="Recharger"):
            return
        chemin = ctx.profil.chemin_tmp
        ctx.lance(lambda: maintenance.purge_origines(ctx.transport(), chemin, jeu),
                  lambda n: (ctx.message.emit(f"{n} élément(s) supprimé(s), rechargés à la prochaine requête."),
                             self.etat()))

    def ouvre_sauvegardes(self):
        d = self.ctx.dossier_sauvegardes()
        os.makedirs(d, exist_ok=True)
        QDesktopServices.openUrl(QUrl.fromLocalFile(str(d)))
