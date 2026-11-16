"""Test de fumée de l'interface : une installation locale copiée dans un dossier temporaire,
pilotée par la vraie fenêtre (Qt hors écran)."""
import os
import shutil
import tempfile
import time
import unittest
from pathlib import Path

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PySide6.QtCore import QSettings
from PySide6.QtWidgets import QApplication  # noqa: E402

from sparqlsandbox_admin.profils import DepotProfils, Profil  # noqa: E402
from sparqlsandbox_admin.ui.fenetre import Fenetre  # noqa: E402

SITE = Path(__file__).resolve().parents[2]
app = QApplication.instance() or QApplication([])


def attend(cond, delai=5.0):
    fin = time.time() + delai
    while time.time() < fin:
        app.processEvents()
        if cond():
            return True
        time.sleep(0.01)
    return False


class FenetreTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        shutil.copytree(SITE / "donnees", self.tmp / "site" / "donnees")
        os.environ["SPARQLSANDBOX_ADMIN_HOME"] = str(self.tmp / "admin")
        profils = DepotProfils(self.tmp / "profils.json")
        profils.remplace(None, Profil("Local", "local", racine=str(self.tmp / "site")))
        self.f = Fenetre(profils, QSettings(str(self.tmp / "reglages.ini"), QSettings.IniFormat))
        self.addCleanup(self.f.close)

    def test_chargement_des_onglets(self):
        jeux = self.f.pages[0][1]
        self.assertTrue(attend(lambda: jeux.liste.count() == 2))
        jeux.liste.setCurrentRow(1)  # cinema
        self.assertTrue(attend(lambda: jeux.jeu is not None and jeux.jeu.nom == "cinema"))
        self.assertEqual(jeux.table.rowCount(), 3)  # ontologie, instances, formes
        self.assertGreater(jeux.liste_ex.count(), 5)
        for i in range(1, len(self.f.pages)):
            self.f.onglets.setCurrentIndex(i)
            app.processEvents()
        ex = self.f.pages[1][1]
        self.assertTrue(attend(lambda: ex.table.rowCount() == 2))

    def test_changement_de_machine(self):
        # régression : changer de machine dans le sélecteur faisait planter l'application
        self.f.ctx.profils.remplace(None, Profil("Autre", "local", racine=str(self.tmp / "site")))
        self.f._remplit_choix()
        self.assertEqual(self.f.choix.count(), 2)
        for i in (1, 0, 1):
            self.f.choix.setCurrentIndex(i)
            self.f.choix.activated.emit(i)
            self.assertTrue(attend(lambda: self.f.ctx.profil.nom == self.f.choix.itemText(i)))
            self.assertEqual(self.f.choix.currentIndex(), i)
        jeux = self.f.pages[0][1]
        self.assertTrue(attend(lambda: jeux.liste.count() == 2))
        self.assertEqual(self.f.reglages.value("profil"), "Autre")  # dernier choix mémorisé

    def test_enregistrement_et_services(self):
        jeux = self.f.pages[0][1]
        self.assertTrue(attend(lambda: jeux.liste.count() == 2))
        jeux.liste.setCurrentRow(0)
        self.assertTrue(attend(lambda: jeux.jeu is not None))
        jeux.titre.setText("Amis modifiés")
        jeux.enregistre()
        conf = self.tmp / "site/donnees/amis/config.xml"
        self.assertTrue(attend(lambda: "Amis modifiés" in conf.read_text(encoding="utf-8")))

        sites = self.f.pages[2][1]
        self.f.onglets.setCurrentIndex(2)
        sites._ajoute("https://dbpedia.org/sparql")
        sites.enregistre()
        ini = self.tmp / "sparqlsandbox.ini"
        self.assertTrue(attend(lambda: ini.exists()))
        self.assertIn("services_autorises", ini.read_text(encoding="utf-8"))

        reg = self.f.pages[3][1]
        self.f.onglets.setCurrentIndex(3)
        self.assertTrue(attend(lambda: reg.etat.text() != ""))
        reg.form.widgets["duree_session_min"].setValue(720)
        reg.enregistre()
        self.assertTrue(attend(lambda: "duree_session_min = 720" in ini.read_text(encoding="utf-8")))
        self.assertIn("services_autorises", ini.read_text(encoding="utf-8"))  # réglage voisin conservé


if __name__ == "__main__":
    unittest.main()
