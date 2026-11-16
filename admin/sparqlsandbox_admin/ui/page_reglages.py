"""Onglets de réglages : sparqlsandbox.ini, sites interrogables (SERVICE) et correction par IA."""
from __future__ import annotations

from PySide6.QtWidgets import (QCheckBox, QFormLayout, QHBoxLayout, QInputDialog, QLabel, QLineEdit, QListWidget,
                               QMenu, QMessageBox, QPushButton, QSpinBox, QVBoxLayout, QWidget)

from .. import maintenance
from ..inifile import (CHAMPS_IA, CHAMPS_SPARQLSANDBOX, IniFile, pose_services, services_autorises,
                       url_service_valide)

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
    """Formulaire construit à partir d'une liste de Champ."""

    def __init__(self, champs):
        super().__init__()
        self.champs = champs
        self.widgets: dict[str, QWidget] = {}
        f = QFormLayout(self)
        for c in champs:
            if c.type == "entier":
                w = QSpinBox()
                w.setRange(0, 10_000_000)
                w.setValue(int(c.defaut))
            else:
                w = QLineEdit()
                if c.type == "secret":
                    w.setEchoMode(QLineEdit.Password)
            if c.aide:
                w.setToolTip(c.aide)
            self.widgets[c.cle] = w
            if c.type == "secret":
                ligne = QHBoxLayout()
                ligne.addWidget(w, 1)
                voir = QCheckBox("Afficher")
                voir.toggled.connect(lambda v, w=w: w.setEchoMode(QLineEdit.Normal if v else QLineEdit.Password))
                ligne.addWidget(voir)
                f.addRow(c.libelle, ligne)
            else:
                f.addRow(c.libelle + (f"  —  {c.aide}" if c.aide and c.type != "entier" else ""), w)
            if c.type == "entier" and c.aide:
                w.setToolTip(c.aide)

    def charge(self, ini: IniFile):
        for c in self.champs:
            w = self.widgets[c.cle]
            v = ini.get(c.cle, c.defaut)
            if isinstance(w, QSpinBox):
                try:
                    w.setValue(int(v))
                except (TypeError, ValueError):
                    w.setValue(int(c.defaut))
            else:
                w.setText(str(v) if not isinstance(v, list) else ", ".join(v))

    def applique(self, ini: IniFile, toujours: tuple[str, ...] = ()):
        """Écrit les valeurs dans ``ini`` ; celles qui valent leur défaut sont retirées
        (sauf les clés de ``toujours``)."""
        for c in self.champs:
            w = self.widgets[c.cle]
            v = w.value() if isinstance(w, QSpinBox) else w.text().strip()
            if c.cle in toujours:
                ini.pose(c.cle, v)
            else:
                ini.pose_ou_retire(c.cle, v, c.defaut if c.defaut != "" else None)

    def valeur(self, cle: str):
        w = self.widgets[cle]
        return w.value() if isinstance(w, QSpinBox) else w.text().strip()


class PageReglages(QWidget):
    def __init__(self, ctx):
        super().__init__()
        self.ctx = ctx
        self.form = Formulaire(CHAMPS_SPARQLSANDBOX)
        self.etat = QLabel()
        self.etat.setWordWrap(True)
        b = QPushButton("Enregistrer")
        b.setDefault(True)
        b.clicked.connect(self.enregistre)
        note = QLabel("Les valeurs par défaut ne sont pas écrites dans le fichier. Les réglages sont lus à chaque "
                      "requête : pas de redémarrage à prévoir.")
        note.setWordWrap(True)
        l = QVBoxLayout(self)
        l.addWidget(self.etat)
        l.addWidget(self.form)
        l.addWidget(note)
        l.addStretch(1)
        h = QHBoxLayout()
        h.addStretch(1)
        h.addWidget(b)
        l.addLayout(h)

    def recharge(self):
        ctx = self.ctx
        if ctx.profil is None:
            return
        chemin = ctx.profil.chemin_ini

        def fini(res):
            ini, existe = res
            self.form.charge(ini)
            self.etat.setText(f"<b>{chemin}</b>" + ("" if existe else " — absent : il sera créé à l'enregistrement."))

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

        ctx.lance(travail, lambda _: (ctx.message.emit("Réglages enregistrés."), self.recharge()))


class PageSites(QWidget):
    """Points d'accès SPARQL que SERVICE peut interroger (réglage services_autorises)."""
    PRESETS = {"Wikidata": "https://query.wikidata.org/sparql", "DBpedia": "https://dbpedia.org/sparql"}

    def __init__(self, ctx):
        super().__init__()
        self.ctx = ctx
        self.liste = QListWidget()
        info = QLabel("Les requêtes fédérées (<code>SERVICE &lt;…&gt;</code>) ne sont permises que vers ces points "
                      "d'accès (adresses exactes, http ou https). Le <b>serveur</b> les interroge pour le compte des "
                      "étudiants, 5 secondes au plus. Liste vide : <code>SERVICE</code> est refusé.")
        info.setWordWrap(True)
        b_ajout, b_suppr = QPushButton("Ajouter…"), QPushButton("Retirer")
        b_test, b_ok = QPushButton("Tester depuis la machine"), QPushButton("Enregistrer")
        b_ok.setDefault(True)
        menu = QMenu(self)
        for nom, url in self.PRESETS.items():
            menu.addAction(nom, lambda u=url: self._ajoute(u))
        menu.addSeparator()
        menu.addAction("Autre adresse…", self.saisie)
        b_ajout.setMenu(menu)
        b_suppr.clicked.connect(self.retire)
        b_test.clicked.connect(self.teste)
        b_ok.clicked.connect(self.enregistre)
        l = QVBoxLayout(self)
        l.addWidget(info)
        l.addWidget(self.liste, 1)
        h = QHBoxLayout()
        h.addWidget(b_ajout)
        h.addWidget(b_suppr)
        h.addWidget(b_test)
        h.addStretch(1)
        h.addWidget(b_ok)
        l.addLayout(h)

    def recharge(self):
        ctx = self.ctx
        if ctx.profil is None:
            return
        chemin = ctx.profil.chemin_ini

        def fini(res):
            self.liste.clear()
            self.liste.addItems(services_autorises(res[0]))

        ctx.lance(lambda: lit_ini(ctx, chemin, ENTETE_INI), fini)

    def urls(self) -> list[str]:
        return [self.liste.item(i).text() for i in range(self.liste.count())]

    def saisie(self):
        u, ok = QInputDialog.getText(self, "Point d'accès SPARQL", "Adresse (http ou https) :")
        if ok:
            self._ajoute(u.strip())

    def _ajoute(self, url: str):
        if not url_service_valide(url):
            return QMessageBox.warning(self, "Adresse invalide", "L'adresse doit commencer par http:// ou https://.")
        if url not in self.urls():
            self.liste.addItem(url)

    def retire(self):
        r = self.liste.currentRow()
        if r >= 0:
            self.liste.takeItem(r)

    def teste(self):
        it = self.liste.currentItem()
        if it is None:
            return
        ctx, url = self.ctx, it.text()
        ctx.lance(lambda: maintenance.teste_service(ctx.transport(), url),
                  lambda r: QMessageBox.information(self, "Test du point d'accès",
                                                    f"{'✅' if r[0] else '❌'} {url}\n{r[1]}"))

    def enregistre(self):
        ctx = self.ctx
        if ctx.profil is None:
            return
        chemin, urls = ctx.profil.chemin_ini, self.urls()

        def travail():
            ini, _ = lit_ini(ctx, chemin, ENTETE_INI)
            pose_services(ini, urls)
            ctx.transport().ecrit(chemin, ini.texte().encode("utf-8"))

        ctx.lance(travail, lambda _: ctx.message.emit(f"{len(urls)} point(s) d'accès autorisé(s)."))


class PageIA(QWidget):
    """Correction des intentions par IA : fichier sparqlsandbox-ia.ini (sa présence l'active)."""

    def __init__(self, ctx):
        super().__init__()
        self.ctx = ctx
        self.form = Formulaire(CHAMPS_IA)
        self.etat = QLabel()
        self.etat.setWordWrap(True)
        self.b_ok = QPushButton("Enregistrer et activer")
        self.b_ok.setDefault(True)
        self.b_off = QPushButton("Désactiver")
        self.b_ok.clicked.connect(self.enregistre)
        self.b_off.clicked.connect(self.desactive)
        l = QVBoxLayout(self)
        l.addWidget(self.etat)
        l.addWidget(self.form)
        l.addStretch(1)
        h = QHBoxLayout()
        h.addWidget(self.b_off)
        h.addStretch(1)
        h.addWidget(self.b_ok)
        l.addLayout(h)

    def recharge(self):
        ctx = self.ctx
        if ctx.profil is None:
            return
        chemin = ctx.profil.chemin_ini_ia

        def fini(res):
            ini, existe = res
            self.form.charge(ini)
            self.b_off.setEnabled(existe)
            self.etat.setText(f"<b>{chemin}</b> — " + (
                "✅ correction par IA <b>activée</b>." if existe else
                "correction par IA <b>désactivée</b> : les étudiants s'auto-évaluent."))

        ctx.lance(lambda: lit_ini(ctx, chemin, ENTETE_IA, chemin + ".desactive"), fini)

    def enregistre(self):
        ctx = self.ctx
        if ctx.profil is None:
            return
        url = self.form.valeur("url")
        local = url.startswith(("http://localhost", "http://127.0.0.1", "http://[::1]"))
        if not (url.startswith("https://") or local):
            return QMessageBox.warning(self, "URL invalide", "L'URL de ProxyIAg doit être en HTTPS (sauf localhost).")
        if not (self.form.valeur("cle") and self.form.valeur("modele")):
            return QMessageBox.warning(self, "Réglages incomplets", "La clé et l'alias du modèle sont obligatoires.")
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
                            "pour réactiver, enregistrez de nouveau les réglages."):
            return

        def travail():
            t = ctx.transport()
            t.renomme(t.chemin(chemin), t.chemin(chemin) + ".desactive")

        ctx.lance(travail, lambda _: (ctx.message.emit("Correction par IA désactivée."), self.recharge()))
