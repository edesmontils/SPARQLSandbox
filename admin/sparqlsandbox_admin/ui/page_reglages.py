"""Réglages : sparqlsandbox.ini, sites interrogables (SERVICE) et correction par IA."""
from __future__ import annotations

from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import (QCheckBox, QComboBox, QFrame, QGridLayout, QHBoxLayout, QLabel, QLineEdit, QMessageBox,
                               QScrollArea, QSpinBox, QVBoxLayout, QWidget)

from .. import maintenance
from ..inifile import (CHAMPS_IA, CHAMPS_SPARQLSANDBOX, IniFile, pose_services, services_autorises,
                       url_service_valide)
from . import theme
from .composants import PageBase, bouton, etiquette, style

ENTETE_INI = ("; Réglages de SPARQL Sandbox, modifiés par SPARQLSandbox Admin.\n"
              "; Tous les réglages sont facultatifs : une ligne absente ou commentée garde sa valeur par défaut.\n")
ENTETE_IA = ("; Correction des intentions par IA (ProxyIAg), modifiée par SPARQLSandbox Admin.\n"
             "; Ce fichier contient une clé : droits 600, jamais dans le dépôt.\n")


def lit_ini(ctx, chemin: str, entete: str, repli: str = "") -> tuple[IniFile, bool]:
    """(contenu, existe) ; appelé depuis une tâche. ``repli`` : fichier relu, pour pré-remplir
    le formulaire, quand ``chemin`` n'existe pas (réglages désactivés)."""
    t = ctx.transport()
    chemin = t.chemin(chemin)
    if t.existe(chemin):
        return IniFile(t.lit(chemin).decode("utf-8", "replace")), True
    if repli and t.existe(t.chemin(repli)):
        return IniFile(t.lit(t.chemin(repli)).decode("utf-8", "replace")), False
    return IniFile(entete), False


class Formulaire(QWidget):
    """Formulaire de réglages construit depuis une liste de Champ : une section par groupe, le libellé et
    son aide à gauche, la valeur à droite avec un rappel de la valeur par défaut."""
    modifie = Signal()
    liste_demandee = Signal(str)  # clé d'un champ « choix » dont on veut recharger la liste

    def __init__(self, champs):
        super().__init__()
        self.champs = champs
        self.widgets: dict[str, QWidget] = {}
        self._rappels: dict[str, QLabel] = {}
        self._retablir: dict[str, QWidget] = {}
        self._chargement = False
        self._statuts: dict[str, QLabel] = {}
        grille = QGridLayout(self)
        grille.setContentsMargins(0, 0, 0, 0)
        grille.setHorizontalSpacing(32)
        grille.setVerticalSpacing(18)
        grille.setColumnStretch(0, 3)
        grille.setColumnStretch(1, 2)
        ligne, groupe = 0, None
        for c in champs:
            if c.groupe != groupe:
                if groupe is not None:
                    grille.setRowMinimumHeight(ligne, 14)  # air avant une nouvelle section
                    ligne += 1
                groupe = c.groupe
                titre = etiquette(groupe, "section")
                grille.addWidget(titre, ligne, 0, 1, 2)
                ligne += 1
                trait = QFrame()
                trait.setFixedHeight(1)
                trait.setStyleSheet(f"background: {theme.TRAIT}")
                grille.addWidget(trait, ligne, 0, 1, 2)
                ligne += 1
            texte = QVBoxLayout()
            texte.setSpacing(2)
            texte.addWidget(etiquette(c.libelle, "champ"))
            if c.aide:
                texte.addWidget(etiquette(c.aide, "aide"))
            gauche = QWidget()
            gauche.setLayout(texte)
            texte.setContentsMargins(0, 0, 0, 0)
            if c.type == "entier":
                w = QSpinBox()
                w.setRange(0, 10_000_000)
                w.setValue(int(c.defaut))
                if c.unite:
                    w.setSuffix(" " + c.unite)
                w.setMaximumWidth(190)
                w.valueChanged.connect(lambda _=None, k=c.cle: self._change(k))
            elif c.type == "choix":
                w = QComboBox()
                w.setEditable(True)
                w.setInsertPolicy(QComboBox.NoInsert)
                w.lineEdit().setPlaceholderText(c.exemple)
                w.setMinimumHeight(32)
                w.currentTextChanged.connect(lambda _=None, k=c.cle: self._change(k))
            else:
                w = QLineEdit()
                w.setPlaceholderText(c.exemple)
                if c.type == "secret":
                    w.setEchoMode(QLineEdit.Password)
                if c.cle in ("oxigraph", "pyshacl", "url"):
                    w.setProperty("role", "code")
                w.textEdited.connect(lambda _=None, k=c.cle: self._change(k))
            self.widgets[c.cle] = w
            droite = QVBoxLayout()
            droite.setSpacing(3)
            if c.type == "secret":
                voir = QCheckBox("Afficher la clé")
                voir.toggled.connect(lambda v, w=w: w.setEchoMode(QLineEdit.Normal if v else QLineEdit.Password))
                droite.addWidget(w)
                droite.addWidget(voir)
            elif c.type == "choix":
                droite.addWidget(w)
                charger = bouton("Charger la liste du service")
                charger.setToolTip("Interroge ProxyIAg depuis la machine avec l'adresse et la clé ci-dessus")
                charger.clicked.connect(lambda _=False, k=c.cle: self.liste_demandee.emit(k))
                statut = etiquette("", "aide")
                self._statuts[c.cle] = statut
                droite.addWidget(charger, 0, Qt.AlignLeft)
                droite.addWidget(statut)
            else:
                droite.addWidget(w)
            pied = QHBoxLayout()
            rappel = etiquette("", "aide", False)
            retablir = bouton("Rétablir", "lien")
            retablir.clicked.connect(lambda _=False, k=c.cle: self._retabli(k))
            retablir.hide()
            self._rappels[c.cle], self._retablir[c.cle] = rappel, retablir
            pied.addWidget(rappel)
            pied.addWidget(retablir)
            pied.addStretch(1)
            if c.type == "entier" or c.cle in ("oxigraph", "pyshacl"):
                droite.addLayout(pied)
            grille.addWidget(gauche, ligne, 0, Qt.AlignTop)
            cadre = QWidget()
            cadre.setLayout(droite)
            droite.setContentsMargins(0, 0, 0, 0)
            grille.addWidget(cadre, ligne, 1, Qt.AlignTop)
            ligne += 1
        grille.setRowStretch(ligne, 1)

    def _champ(self, cle):
        return next(c for c in self.champs if c.cle == cle)

    def _retabli(self, cle):
        c, w = self._champ(cle), self.widgets[cle]
        if isinstance(w, QSpinBox):
            w.setValue(int(c.defaut))
        elif isinstance(w, QComboBox):
            w.setCurrentText("")
        else:
            w.clear()
        self._change(cle)

    def _change(self, cle):
        self._rappel(cle)
        if not self._chargement:
            self.modifie.emit()

    def _rappel(self, cle):
        c, w = self._champ(cle), self.widgets[cle]
        if isinstance(w, QSpinBox):
            ecart = w.value() != int(c.defaut)
            unite = f" {c.unite}" if c.unite else ""
            self._rappels[cle].setText(f"Valeur par défaut : {int(c.defaut):,}{unite}".replace(",", " ")
                                       if ecart else "")
            self._retablir[cle].setVisible(ecart)
        elif c.cle in ("oxigraph", "pyshacl"):
            ecart = bool(w.text().strip())
            self._rappels[cle].setText("" if not ecart else "Recherche automatique désactivée")
            self._retablir[cle].setText("Revenir à l'automatique")
            self._retablir[cle].setVisible(ecart)

    def charge(self, ini: IniFile):
        self._chargement = True
        for c in self.champs:
            w = self.widgets[c.cle]
            v = ini.get(c.cle, c.defaut)
            if isinstance(w, QSpinBox):
                try:
                    w.setValue(int(v))
                except (TypeError, ValueError):
                    w.setValue(int(c.defaut))
            elif isinstance(w, QComboBox):
                w.setCurrentText(str(v))
            else:
                w.setText(str(v) if not isinstance(v, list) else ", ".join(v))
            self._rappel(c.cle)
        self._chargement = False

    def applique(self, ini: IniFile, toujours: tuple[str, ...] = ()):
        """Écrit les valeurs dans ``ini`` ; celles qui valent leur défaut sont retirées
        (sauf les clés de ``toujours``)."""
        for c in self.champs:
            v = self.valeur(c.cle)
            if c.cle in toujours:
                ini.pose(c.cle, v)
            else:
                ini.pose_ou_retire(c.cle, v, c.defaut if c.defaut != "" else None)

    def valeur(self, cle: str):
        w = self.widgets[cle]
        if isinstance(w, QSpinBox):
            return w.value()
        return w.currentText().strip() if isinstance(w, QComboBox) else w.text().strip()

    def remplit_choix(self, cle: str, valeurs: list[str], message: str, erreur: bool = False):
        """Met à jour la liste d'un champ « choix » en gardant la valeur saisie."""
        w = self.widgets[cle]
        courant = w.currentText()
        w.blockSignals(True)
        w.clear()
        w.addItems(valeurs)
        w.setCurrentText(courant)
        w.blockSignals(False)
        self._statuts[cle].setText(message)
        self._statuts[cle].setStyleSheet(f"color: {theme.DANGER if erreur else theme.ATTENUE}")


def pluriel_modeles(n: int) -> str:
    return f"{n} modèle{'s' if n > 1 else ''}"


def zone_defilante(contenu: QWidget) -> QScrollArea:
    z = QScrollArea()
    z.setWidgetResizable(True)
    z.setFrameShape(QFrame.NoFrame)
    z.setWidget(contenu)
    contenu.setMaximumWidth(860)
    z.viewport().setAutoFillBackground(False)
    contenu.setAutoFillBackground(False)
    return z


class PageReglages(PageBase):
    def __init__(self, ctx):
        super().__init__(ctx, "Réglages", "", "Enregistrer les réglages")
        self.form = Formulaire(CHAMPS_SPARQLSANDBOX)
        self.form.modifie.connect(lambda: self.marque_sale(True))
        self.etat = self.sous_titre
        self.corps.addWidget(zone_defilante(self.form), 1)

    def recharge(self):
        ctx = self.ctx
        if ctx.profil is None:
            return
        chemin = ctx.profil.chemin_ini

        def fini(res):
            ini, existe = res
            self.form.charge(ini)
            self.marque_sale(False)
            self.etat.setText(chemin + ("" if existe else " — fichier absent : il sera créé à l'enregistrement. "
                                                          "Les valeurs affichées sont celles par défaut."))

        ctx.lance(lambda: lit_ini(ctx, chemin, ENTETE_INI), fini)

    def enregistre(self):
        ctx = self.ctx
        if ctx.profil is None:
            return
        chemin = ctx.profil.chemin_ini

        def travail():
            ini, _ = lit_ini(ctx, chemin, ENTETE_INI)  # relu : on ne touche qu'aux champs du formulaire
            self.form.applique(ini)
            ctx.transport().ecrit(chemin, ini.texte().encode("utf-8"))

        ctx.lance(travail, lambda _: (ctx.message.emit("Réglages enregistrés : ils servent dès la requête suivante."),
                                      self.recharge()))


class PageSites(PageBase):
    """Points d'accès SPARQL que SERVICE peut interroger (réglage services_autorises)."""
    PRESETS = {"Wikidata": "https://query.wikidata.org/sparql", "DBpedia": "https://dbpedia.org/sparql"}

    def __init__(self, ctx):
        super().__init__(ctx, "Sites interrogables",
                         "Les points d'accès SPARQL que les étudiants peuvent interroger avec SERVICE. "
                         "C'est le serveur qui les appelle, 5 secondes au plus.", "Enregistrer la liste")
        self._urls: list[str] = []
        self.etats: dict[str, str] = {}
        self.saisie = QLineEdit()
        self.saisie.setPlaceholderText("https://exemple.org/sparql")
        self.saisie.setProperty("role", "code")
        self.saisie.returnPressed.connect(self.ajoute_saisie)
        b_ajoute = bouton("Ajouter", "primaire")
        b_ajoute.clicked.connect(self.ajoute_saisie)
        ajout = QHBoxLayout()
        ajout.addWidget(self.saisie, 1)
        ajout.addWidget(b_ajoute)
        self.raccourcis = QHBoxLayout()
        self.b_presets = {}
        for nom, url in self.PRESETS.items():
            b = bouton(f"+ {nom}")
            b.clicked.connect(lambda _=False, u=url: self._ajoute(u))
            self.b_presets[url] = b
            self.raccourcis.addWidget(b)
        self.raccourcis.addStretch(1)
        self.rangees = QVBoxLayout()
        self.rangees.setSpacing(8)
        self.vide = etiquette("Aucun point d'accès autorisé : toute requête SERVICE est refusée. "
                              "Ajoutez-en un ci-dessus pour permettre les requêtes fédérées.", "aide")
        contenu = QWidget()
        cl = QVBoxLayout(contenu)
        cl.setContentsMargins(0, 0, 0, 0)
        cl.setSpacing(14)
        cl.addLayout(ajout)
        cl.addLayout(self.raccourcis)
        cl.addLayout(self.rangees)
        cl.addWidget(self.vide)
        cl.addStretch(1)
        self.corps.addWidget(zone_defilante(contenu), 1)
        self._dessine()

    def recharge(self):
        ctx = self.ctx
        if ctx.profil is None:
            return
        chemin = ctx.profil.chemin_ini

        def fini(res):
            self._urls = services_autorises(res[0])
            self.etats = {}
            self.marque_sale(False)
            self._dessine()

        ctx.lance(lambda: lit_ini(ctx, chemin, ENTETE_INI), fini)

    def urls(self) -> list[str]:
        return list(self._urls)

    def _dessine(self):
        while self.rangees.count():
            w = self.rangees.takeAt(0).widget()
            if w:
                w.deleteLater()
        for u in self._urls:
            cadre = QFrame()
            cadre.setObjectName("ligne")
            h = QHBoxLayout(cadre)
            h.setContentsMargins(14, 8, 8, 8)
            adresse = etiquette(u, "code", False)
            etat = etiquette(self.etats.get(u, ""), "aide", False)
            b_test = bouton("Tester")
            b_test.setToolTip("Interroge ce point d'accès depuis la machine, comme le ferait un étudiant")
            b_test.clicked.connect(lambda _=False, u=u: self.teste(u))
            b_retire = bouton("Retirer", "danger")
            b_retire.clicked.connect(lambda _=False, u=u: self.retire(u))
            h.addWidget(adresse, 1)
            h.addWidget(etat)
            h.addWidget(b_test)
            h.addWidget(b_retire)
            self.rangees.addWidget(cadre)
        self.vide.setVisible(not self._urls)
        for url, b in self.b_presets.items():
            b.setVisible(url not in self._urls)

    def ajoute_saisie(self):
        u = self.saisie.text().strip()
        if u and self._ajoute(u):
            self.saisie.clear()

    def _ajoute(self, url: str) -> bool:
        if not url_service_valide(url):
            QMessageBox.warning(self, "Adresse invalide", "L'adresse doit commencer par http:// ou https://.")
            return False
        if url not in self._urls:
            self._urls.append(url)
            self.marque_sale(True)
            self._dessine()
        return True

    def retire(self, url: str):
        if url in self._urls:
            self._urls.remove(url)
            self.marque_sale(True)
            self._dessine()

    def teste(self, url: str):
        ctx = self.ctx
        self.etats[url] = "Test en cours…"
        self._dessine()

        def fini(r):
            ok, msg = r
            self.etats[url] = ("✓ répond · " if ok else "✗ ne répond pas · ") + msg
            self._dessine()

        ctx.lance(lambda: maintenance.teste_service(ctx.transport(), url), fini)

    def enregistre(self):
        ctx = self.ctx
        if ctx.profil is None:
            return
        chemin, urls = ctx.profil.chemin_ini, self.urls()

        def travail():
            ini, _ = lit_ini(ctx, chemin, ENTETE_INI)
            pose_services(ini, urls)
            ctx.transport().ecrit(chemin, ini.texte().encode("utf-8"))

        def fini(_):
            self.marque_sale(False)
            ctx.message.emit(f"{len(urls)} point(s) d'accès autorisé(s)." if urls else
                             "Plus aucun point d'accès : SERVICE est refusé.")

        ctx.lance(travail, fini)


class PageIA(PageBase):
    """Correction des intentions par IA : fichier sparqlsandbox-ia.ini (sa présence l'active)."""

    def __init__(self, ctx):
        super().__init__(ctx, "Correction par IA", "", "Enregistrer et activer")
        self.form = Formulaire(CHAMPS_IA)
        self.form.modifie.connect(lambda: self.marque_sale(True))
        self.form.liste_demandee.connect(lambda _cle: self.charge_modeles())
        self.etat = etiquette("", "section")
        self.b_off = bouton("Désactiver", "danger")
        self.b_off.clicked.connect(self.desactive)
        self.actions.addWidget(self.b_off)
        self.corps.addWidget(self.etat)
        self.corps.addWidget(zone_defilante(self.form), 1)

    def recharge(self):
        ctx = self.ctx
        if ctx.profil is None:
            return
        chemin = ctx.profil.chemin_ini_ia

        def fini(res):
            ini, existe = res
            self.form.charge(ini)
            self.marque_sale(False)
            self.b_off.setEnabled(existe)
            self.barre.b_ok.setText("Enregistrer" if existe else "Enregistrer et activer")
            self.sous_titre.setText(chemin)
            self.etat.setText("Correction activée : les étudiants reçoivent un avis du modèle." if existe else
                              "Correction désactivée : les étudiants comparent eux-mêmes leur intention à celle de "
                              "l'enseignant.")
            self.etat.setStyleSheet(f"color: {theme.OK if existe else theme.ATTENUE}")
            if existe:
                self.charge_modeles(silencieux=True)

        ctx.lance(lambda: lit_ini(ctx, chemin, ENTETE_IA, chemin + ".desactive"), fini)

    def charge_modeles(self, silencieux: bool = False):
        """Remplit la liste des modèles avec ceux que propose le service (adresse et clé du formulaire)."""
        ctx = self.ctx
        url, cle = self.form.valeur("url"), self.form.valeur("cle")
        if ctx.profil is None:
            return
        if not (url and cle):
            if not silencieux:
                self.form.remplit_choix("modele", [], "Renseignez l'adresse et la clé de ProxyIAg d'abord.", True)
            return
        self.form.remplit_choix("modele", [self.form.widgets["modele"].itemText(i)
                                           for i in range(self.form.widgets["modele"].count())],
                                "Interrogation du service…")

        def fini(modeles):
            self.form.remplit_choix("modele", modeles,
                                    f"{pluriel_modeles(len(modeles))} proposé(s) par le service." if modeles else
                                    "Le service ne propose aucun modèle pour cette clé.", not modeles)

        def erreur(message):
            self.form.remplit_choix("modele", [], message, True)

        ctx.lance(lambda: maintenance.liste_modeles(ctx.transport(), url, cle), fini, erreur)

    def enregistre(self):
        ctx = self.ctx
        if ctx.profil is None:
            return
        url = self.form.valeur("url")
        local = url.startswith(("http://localhost", "http://127.0.0.1", "http://[::1]"))
        if not (url.startswith("https://") or local):
            return QMessageBox.warning(self, "Adresse invalide",
                                       "L'adresse de ProxyIAg doit commencer par https:// (http:// n'est permis que "
                                       "pour localhost).")
        if not (self.form.valeur("cle") and self.form.valeur("modele")):
            return QMessageBox.warning(self, "Réglages incomplets", "La clé et le modèle sont obligatoires.")
        chemin = ctx.profil.chemin_ini_ia

        def travail():
            ini, _ = lit_ini(ctx, chemin, ENTETE_IA)
            self.form.applique(ini, toujours=("url", "cle", "modele"))
            t = ctx.transport()
            t.ecrit(chemin, ini.texte().encode("utf-8"), mode=0o600)
            t.supprime(t.chemin(chemin) + ".desactive")  # la clé ne reste pas en double

        ctx.lance(travail, lambda _: (ctx.message.emit("Correction par IA activée."), self.recharge()))

    def desactive(self):
        ctx = self.ctx
        chemin = ctx.profil.chemin_ini_ia
        if not ctx.confirme("Désactiver la correction par IA",
                            "Désactiver la correction des intentions par IA ?",
                            f"Le fichier est renommé en {chemin}.desactive (la clé y est conservée) ; "
                            "pour réactiver, enregistrez de nouveau les réglages.", libelle="Désactiver"):
            return

        def travail():
            t = ctx.transport()
            t.renomme(t.chemin(chemin), t.chemin(chemin) + ".desactive")

        ctx.lance(travail, lambda _: (ctx.message.emit("Correction par IA désactivée."), self.recharge()))
