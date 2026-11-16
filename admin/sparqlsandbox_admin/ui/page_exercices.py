"""Onglet « Exercices » (format QueryCraft) et onglet « Maintenance »."""
from __future__ import annotations

import os
from pathlib import Path

from PySide6.QtCore import QUrl
from PySide6.QtGui import QDesktopServices
from PySide6.QtWidgets import (QAbstractItemView, QFileDialog, QHBoxLayout, QHeaderView, QInputDialog, QLabel,
                               QListWidget, QPushButton, QTableWidget, QTableWidgetItem, QVBoxLayout, QWidget)

from .. import maintenance
from ..jeux import Depot, JeuInvalide
from .page_jeux import taille_lisible


class PageExercices(QWidget):
    def __init__(self, ctx):
        super().__init__()
        self.ctx = ctx
        self.table = QTableWidget(0, 4)
        self.table.setHorizontalHeaderLabels(["Code", "Fichier de données", "Questions", "Types"])
        self.table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.table.setSelectionMode(QAbstractItemView.SingleSelection)
        self.table.setEditTriggers(QAbstractItemView.NoEditTriggers)
        self.table.horizontalHeader().setSectionResizeMode(3, QHeaderView.Stretch)
        self.table.verticalHeader().hide()
        b_ajout, b_tel, b_suppr = QPushButton("Ajouter / remplacer…"), QPushButton("Télécharger…"), QPushButton("Supprimer…")
        b_ajout.clicked.connect(self.ajoute)
        b_tel.clicked.connect(self.telecharge)
        b_suppr.clicked.connect(self.supprime)
        info = QLabel("Un exercice est un fichier JSON au format QueryCraft, dans donnees/exercices/ : son code est le "
                      "nom du fichier. Il porte sur le jeu dont l'un des fichiers s'appelle <code>database.name</code>.")
        info.setWordWrap(True)
        l = QVBoxLayout(self)
        l.addWidget(info)
        l.addWidget(self.table, 1)
        h = QHBoxLayout()
        for b in (b_ajout, b_tel, b_suppr):
            h.addWidget(b)
        h.addStretch(1)
        l.addLayout(h)

    def recharge(self):
        ctx = self.ctx
        if ctx.profil is None:
            return

        def fini(res):
            self.table.setRowCount(0)
            for code, d in res:
                qs = d.get("questions", {}) if d else {}
                base = (d.get("database") or {}).get("name", "") if d else ""
                types = sorted({q[3] for q in qs.values() if isinstance(q, list) and len(q) > 3})
                valeurs = [code, base, str(len(qs)) if d else "JSON illisible", ", ".join(types)]
                self.table.insertRow(self.table.rowCount())
                for c, v in enumerate(valeurs):
                    self.table.setItem(self.table.rowCount() - 1, c, QTableWidgetItem(v))
            ctx.message.emit(f"{len(res)} exercice(s).")

        ctx.lance(lambda: ctx.depot().exercices(), fini)

    def _code(self) -> str | None:
        r = self.table.currentRow()
        return self.table.item(r, 0).text() if r >= 0 else None

    def ajoute(self):
        chemin, _ = QFileDialog.getOpenFileName(self, "Choisir un exercice (JSON)", "", "JSON (*.json)")
        if not chemin:
            return
        try:
            contenu = Path(chemin).read_bytes()
        except OSError as e:
            return self.ctx.erreur(f"Fichier illisible : {e}")
        _, err = Depot.verifie_exercice(contenu)
        if err:
            return self.ctx.erreur(f"Exercice invalide : {err}")
        code, ok = QInputDialog.getText(self, "Code de l'exercice", "Code (nom du fichier, sans .json) :",
                                        text=Path(chemin).stem)
        if not ok:
            return
        ctx = self.ctx
        ctx.lance(lambda: ctx.depot().ajoute_exercice(code.strip(), contenu),
                  lambda _: (ctx.message.emit(f"Exercice « {code} » enregistré."), self.recharge()))

    def telecharge(self):
        code = self._code()
        if not code:
            return
        dest, _ = QFileDialog.getSaveFileName(self, "Enregistrer l'exercice", str(Path.home() / "Downloads" / f"{code}.json"))
        if dest:
            ctx = self.ctx
            ctx.lance(lambda: Path(dest).write_bytes(ctx.depot().lit_exercice(code)),
                      lambda _: ctx.message.emit(f"Exercice enregistré dans {dest}."))

    def supprime(self):
        code = self._code()
        if code and self.ctx.confirme("Supprimer l'exercice", f"Supprimer l'exercice « {code} » ?",
                                      "Une sauvegarde est gardée sur ce Mac."):
            ctx = self.ctx
            ctx.lance(lambda: ctx.depot().supprime_exercice(code),
                      lambda _: (ctx.message.emit(f"Exercice « {code} » supprimé."), self.recharge()))


class PageMaintenance(QWidget):
    def __init__(self, ctx):
        super().__init__()
        self.ctx = ctx
        self.resume = QLabel()
        self.resume.setWordWrap(True)
        self.table = QTableWidget(0, 4)
        self.table.setHorizontalHeaderLabels(["Jeu", "Copies de session", "Taille des copies", "Store d'origine"])
        self.table.setEditTriggers(QAbstractItemView.NoEditTriggers)
        self.table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.table.setSelectionMode(QAbstractItemView.SingleSelection)
        self.table.horizontalHeader().setSectionResizeMode(QHeaderView.Stretch)
        self.table.verticalHeader().hide()
        self.diag = QListWidget()
        b_etat, b_diag = QPushButton("Actualiser l'état"), QPushButton("Diagnostic")
        b_copies = QPushButton("Purger les copies du jeu sélectionné…")
        b_toutes = QPushButton("Purger toutes les copies…")
        b_orig = QPushButton("Recharger les jeux d'origine…")
        b_sauv = QPushButton("Ouvrir les sauvegardes")
        b_etat.clicked.connect(self.recharge)
        b_diag.clicked.connect(self.diagnostic)
        b_copies.clicked.connect(lambda: self.purge_copies(True))
        b_toutes.clicked.connect(lambda: self.purge_copies(False))
        b_orig.clicked.connect(self.purge_origines)
        b_sauv.clicked.connect(self.ouvre_sauvegardes)
        info = QLabel("Les copies inactives sont purgées automatiquement après la durée de vie réglée ; purgez-les "
                      "à la main pour que tous les étudiants repartent du jeu d'origine. Un jeu d'origine se recharge "
                      "tout seul quand ses fichiers changent : « Recharger » force aussi le recalcul des tables "
                      "d'exercices en cache.")
        info.setWordWrap(True)
        l = QVBoxLayout(self)
        l.addWidget(self.resume)
        l.addWidget(self.table, 2)
        h = QHBoxLayout()
        for b in (b_etat, b_copies, b_toutes, b_orig):
            h.addWidget(b)
        h.addStretch(1)
        l.addLayout(h)
        l.addWidget(info)
        h2 = QHBoxLayout()
        h2.addWidget(b_diag)
        h2.addWidget(b_sauv)
        h2.addStretch(1)
        l.addLayout(h2)
        l.addWidget(self.diag, 1)

    def recharge(self):
        ctx = self.ctx
        if ctx.profil is None:
            return
        chemin = ctx.profil.chemin_tmp

        def fini(e):
            self.table.setRowCount(0)
            if not e.tmp_existe:
                self.resume.setText(f"Dossier de travail absent : {chemin}. Il est créé à la première requête d'un étudiant.")
                return
            for jeu in sorted(set(e.copies) | set(e.origines)):
                n, ko = e.copies.get(jeu, (0, 0))
                valeurs = [jeu, str(n), taille_lisible(ko * 1024), taille_lisible(e.origines.get(jeu, 0) * 1024)]
                self.table.insertRow(self.table.rowCount())
                for c, v in enumerate(valeurs):
                    self.table.setItem(self.table.rowCount() - 1, c, QTableWidgetItem(v))
            libre = f" Espace libre : {taille_lisible(e.libre_ko * 1024)}." if e.libre_ko is not None else ""
            self.resume.setText(f"<b>{chemin}</b> — {e.nb_copies} copie(s) de session, "
                                f"{taille_lisible(e.ko_copies * 1024)}.{libre}")

        ctx.lance(lambda: maintenance.etat(ctx.transport(), chemin), fini)

    def _jeu(self) -> str | None:
        r = self.table.currentRow()
        return self.table.item(r, 0).text() if r >= 0 else None

    def purge_copies(self, un_jeu: bool):
        ctx = self.ctx
        jeu = self._jeu() if un_jeu else None
        if un_jeu and not jeu:
            return
        cible = f"du jeu « {jeu} »" if jeu else "de tous les jeux"
        if not ctx.confirme("Purger les copies", f"Supprimer les copies de session {cible} sur {ctx.profil.nom} ?",
                            "Les étudiants perdront leurs modifications et repartiront du jeu d'origine."):
            return
        chemin = ctx.profil.chemin_tmp
        ctx.lance(lambda: maintenance.purge_copies(ctx.transport(), chemin, jeu),
                  lambda n: (ctx.message.emit(f"{n} copie(s) supprimée(s)."), self.recharge()))

    def purge_origines(self):
        ctx = self.ctx
        jeu = self._jeu()
        cible = f"du jeu « {jeu} »" if jeu else "de tous les jeux"
        if not ctx.confirme("Recharger les jeux d'origine",
                            f"Supprimer les stores d'origine {cible} sur {ctx.profil.nom} ?",
                            "Ils seront reconstruits à la prochaine requête (quelques secondes de plus pour le "
                            "premier étudiant)."):
            return
        chemin = ctx.profil.chemin_tmp
        ctx.lance(lambda: maintenance.purge_origines(ctx.transport(), chemin, jeu),
                  lambda n: (ctx.message.emit(f"{n} élément(s) supprimé(s)."), self.recharge()))

    def diagnostic(self):
        ctx = self.ctx
        if ctx.profil is None:
            return
        p = ctx.profil

        def fini(res):
            self.diag.clear()
            icones = {"ok": "✅", "avert": "⚠️", "erreur": "❌"}
            self.diag.addItems([f"{icones[n]}  {m}" for n, m in res])

        ctx.lance(lambda: maintenance.diagnostic(ctx.transport(), p), fini)

    def ouvre_sauvegardes(self):
        d = self.ctx.dossier_sauvegardes()
        os.makedirs(d, exist_ok=True)
        QDesktopServices.openUrl(QUrl.fromLocalFile(str(d)))
