import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from sparqlsandbox_admin import inifile, jeux, maintenance
from sparqlsandbox_admin.profils import DepotProfils, Profil
from sparqlsandbox_admin.transport import LocalTransport, TransportError

SITE = Path(__file__).resolve().parents[2]  # racine de SPARQLSandbox
TTL = b"@prefix ex: <http://example.org/> .\nex:a ex:p ex:b .\n"


class IniTest(unittest.TestCase):
    EXEMPLE = (SITE / "sparqlsandbox.ini.exemple").read_text(encoding="utf-8")

    def test_pose_decommente_l_exemple(self):
        ini = inifile.IniFile(self.EXEMPLE)
        ini.pose("duree_session_min", 720)
        self.assertEqual(ini.get("duree_session_min"), "720")
        self.assertIn("duree_session_min = 720", ini.texte())
        self.assertNotIn(";duree_session_min", ini.texte())
        self.assertIn("Total des copies", ini.texte())  # commentaires conservés

    def test_retire_et_services(self):
        ini = inifile.IniFile(self.EXEMPLE)
        self.assertEqual(inifile.services_autorises(ini), [])
        inifile.pose_services(ini, ["https://query.wikidata.org/sparql", "https://dbpedia.org/sparql"])
        self.assertEqual(inifile.services_autorises(ini),
                         ["https://query.wikidata.org/sparql", "https://dbpedia.org/sparql"])
        inifile.pose_services(ini, [])
        self.assertEqual(inifile.services_autorises(ini), [])

    def test_valeurs_repetees_et_guillemets(self):
        ini = inifile.IniFile('services_autorises[] = "https://a.org/sparql"\nservices_autorises[] = https://b.org/s\n')
        self.assertEqual(inifile.services_autorises(ini), ["https://a.org/sparql", "https://b.org/s"])
        ini.pose("services_autorises", "https://c.org/s")
        self.assertEqual(ini.texte().count("services_autorises"), 1)
        ini.pose("cle", 'sk-"x"')
        self.assertEqual(ini.get("cle"), 'sk-"x"')

    def test_ajout_en_fin(self):
        ini = inifile.IniFile("; rien\n")
        ini.pose("oxigraph", "/usr/bin/oxigraph")
        self.assertEqual(ini.get("oxigraph"), "/usr/bin/oxigraph")


class ConfigTest(unittest.TestCase):
    def test_ronde_sur_les_jeux_fournis(self):
        for conf in (SITE / "donnees").glob("*/config.xml"):
            j1 = jeux.lit_config(conf.read_bytes())
            j2 = jeux.lit_config(jeux.ecrit_config(j1))
            self.assertEqual(j1, j2, conf)
            # idempotent : une 2e écriture ne change plus rien (pas de dérive d'indentation)
            self.assertEqual(jeux.ecrit_config(j1), jeux.ecrit_config(j2))
            self.assertEqual(jeux.verifie_jeu(j1), [])

    def test_exemples_et_chevrons(self):
        j = jeux.Jeu("t", "T", ["t.ttl"], exemples=[jeux.Exemple('A "b"', "SELECT * WHERE { ?s ?p ?o FILTER (?o < 3) }")])
        j2 = jeux.lit_config(jeux.ecrit_config(j))
        self.assertEqual(j2.exemples, j.exemples)

    def test_verifications(self):
        self.assertTrue(jeux.verifie_jeu(jeux.Jeu("Mauvais Nom", "x", ["a.ttl"])))
        self.assertTrue(jeux.verifie_jeu(jeux.Jeu("ok", "x", [])))
        self.assertTrue(jeux.verifie_jeu(jeux.Jeu("ok", "x", ["a.txt"])))
        self.assertTrue(jeux.verifie_jeu(jeux.Jeu("ok", "x", ["a.ttl"], description="<p>non fermé")))

    def test_valide_rdf(self):
        self.assertTrue(jeux.valide_rdf("a.ttl", TTL)[0])
        self.assertFalse(jeux.valide_rdf("a.ttl", b"ex:a ex:p")[0])
        self.assertFalse(jeux.valide_rdf("a.csv", TTL)[0])
        self.assertFalse(jeux.valide_rdf("a.ttl", b"  ")[0])

    def test_exercices_fournis(self):
        for f in (SITE / "donnees" / "exercices").glob("*.json"):
            d, err = jeux.Depot.verifie_exercice(f.read_bytes())
            self.assertIsNotNone(d, f"{f.name} : {err}")
        self.assertIsNone(jeux.Depot.verifie_exercice(b'{"questions": {"q": ["a"]}}')[0])


class DepotTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        shutil.copytree(SITE / "donnees", self.tmp / "site" / "donnees")
        self.depot = jeux.Depot(LocalTransport(), str(self.tmp / "site/donnees"),
                                str(self.tmp / "site/donnees/exercices"), self.tmp / "sauv")

    def test_liste(self):
        self.assertEqual(self.depot.noms(), ["amis", "cinema"])  # « exercices » est exclu
        self.assertEqual(self.depot.lit("cinema").fichiers, ["ontologie.ttl", "cinema.ttl"])

    def test_cycle_complet_d_un_jeu(self):
        d = self.depot
        d.cree(jeux.Jeu("test", "Test", ["test.ttl"]), {"test.ttl": TTL})
        self.assertIn("test", d.noms())
        with self.assertRaises(jeux.JeuInvalide):
            d.cree(jeux.Jeu("test", "Test", ["test.ttl"]), {"test.ttl": TTL})
        d.ajoute_fichier("test", "onto.ttl", TTL, "ontologie")
        d.ajoute_fichier("test", "formes.ttl", TTL, "formes")
        d.ajoute_fichier("test", "test.ttl", TTL + b"\n", "donnees")  # remplace (sauvegarde l'ancien)
        j = d.lit("test")
        self.assertEqual(j.fichiers, ["onto.ttl", "test.ttl"])
        self.assertEqual(j.formes, ["formes.ttl"])
        self.assertEqual(j.absents, [])
        d.retire_fichier("test", "onto.ttl")
        self.assertEqual(d.lit("test").fichiers, ["test.ttl"])
        with self.assertRaises(jeux.JeuInvalide):
            d.retire_fichier("test", "test.ttl")  # dernier fichier de données
        sauv = d.supprime("test")
        self.assertNotIn("test", d.noms())
        self.assertTrue((sauv / "test.ttl").is_file())

    def test_refus(self):
        with self.assertRaises(jeux.JeuInvalide):
            self.depot.ajoute_fichier("amis", "mauvais.ttl", b"pas du turtle")
        with self.assertRaises(jeux.JeuInvalide):
            self.depot.lit("../etc")
        with self.assertRaises(jeux.JeuInvalide):
            self.depot.ajoute_fichier("amis", "config.xml", TTL)

    def test_exercices(self):
        d = self.depot
        self.assertEqual({c for c, _ in d.exercices()}, {"amis-tp1", "cinema-tp1"})
        contenu = d.lit_exercice("amis-tp1")
        with self.assertRaises(jeux.JeuInvalide):
            d.ajoute_exercice("../x", contenu)
        d.ajoute_exercice("copie", contenu)
        self.assertIn("copie", {c for c, _ in d.exercices()})
        d.supprime_exercice("copie")
        self.assertNotIn("copie", {c for c, _ in d.exercices()})
        self.assertEqual(json.loads(contenu), json.loads(d.lit_exercice("amis-tp1")))


class MaintenanceTest(unittest.TestCase):
    def test_etat_et_purges(self):
        tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, tmp, True)
        for nom in ("copie_0123456789abcdef_amis", "copie_fedcba9876543210_cinema", "origine_amis_0123456789abcdef"):
            (tmp / nom).mkdir()
            (tmp / nom / "f").write_bytes(b"x" * 2048)
        (tmp / "verrou_copie_0123456789abcdef_amis").write_text("")
        (tmp / "table_abc").write_text("")
        (tmp / "autre").mkdir()
        t = LocalTransport()
        e = maintenance.etat(t, str(tmp))
        self.assertEqual(e.nb_copies, 2)
        self.assertEqual(set(e.copies), {"amis", "cinema"})
        self.assertEqual(e.tables, 1)
        self.assertIn("amis", e.origines)
        self.assertIsNotNone(e.libre_ko)
        self.assertEqual(maintenance.purge_copies(t, str(tmp), "amis"), 1)
        self.assertFalse((tmp / "verrou_copie_0123456789abcdef_amis").exists())
        self.assertEqual(maintenance.purge_copies(t, str(tmp)), 1)
        self.assertEqual(maintenance.purge_origines(t, str(tmp)), 2)  # un store + une table
        self.assertTrue((tmp / "autre").is_dir())  # le reste n'est jamais touché

    def test_dossier_tmp_absent(self):
        self.assertFalse(maintenance.etat(LocalTransport(), "/nexiste/pas").tmp_existe)


def git(cwd, *args):
    subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@t", *args], cwd=cwd, check=True,
                   capture_output=True)


class MiseAJourTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        origine, self.site, self.autre = self.tmp / "origine.git", self.tmp / "site", self.tmp / "autre"
        git(self.tmp, "init", "-q", "--bare", "-b", "main", str(origine))
        git(self.tmp, "clone", "-q", str(origine), str(self.site))
        (self.site / "index.php").write_text("v1")
        git(self.site, "add", "."); git(self.site, "commit", "-q", "-m", "premier"); git(self.site, "push", "-q", "origin", "main")
        git(self.tmp, "clone", "-q", str(origine), str(self.autre))
        self.t = LocalTransport()

    def publie(self, texte, titre):
        (self.autre / "index.php").write_text(texte)
        git(self.autre, "commit", "-q", "-am", titre); git(self.autre, "push", "-q", "origin", "main")

    def test_a_jour(self):
        e = maintenance.etat_depot(self.t, str(self.site))
        self.assertEqual((e.branche, e.a_recuperer, e.modifie), ("main", [], False))

    def test_pull_et_relance(self):
        self.publie("v2", "deuxième version")
        e = maintenance.etat_depot(self.t, str(self.site))
        self.assertEqual(len(e.a_recuperer), 1)
        self.assertIn("deuxième version", e.a_recuperer[0])
        r = maintenance.met_a_jour(self.t, str(self.site), f"touch {self.tmp}/relance.ok")
        self.assertNotEqual(r.avant, r.apres)
        self.assertIn("deuxième version", r.commits[0])
        self.assertEqual((self.site / "index.php").read_text(), "v2")
        self.assertEqual(r.relance[0], 0)
        self.assertTrue((self.tmp / "relance.ok").exists())
        self.assertEqual(maintenance.etat_depot(self.t, str(self.site)).a_recuperer, [])

    def test_modifications_locales_jamais_ecrasees(self):
        (self.site / "index.php").write_text("local")
        self.publie("v2", "conflit")
        self.assertTrue(maintenance.etat_depot(self.t, str(self.site)).modifie)
        with self.assertRaises(TransportError):
            maintenance.met_a_jour(self.t, str(self.site))
        self.assertEqual((self.site / "index.php").read_text(), "local")

    def test_pas_un_depot(self):
        with self.assertRaises(TransportError):
            maintenance.etat_depot(self.t, str(self.tmp))


class ProfilTest(unittest.TestCase):
    def test_defauts_et_persistance(self):
        p = Profil("Pi", hote="pi", racine="/home/ed/programmation/SPARQLSandbox")
        self.assertEqual(p.chemin_ini, "/home/ed/programmation/sparqlsandbox.ini")
        self.assertEqual(p.chemin_tmp, "/home/ed/programmation/sparqlsandbox-tmp")
        self.assertEqual(Profil("x", racine="/a/b", ini="/c.ini").chemin_ini, "/c.ini")
        d = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, d, True)
        dp = DepotProfils(d / "profils.json")
        dp.remplace(None, p)
        self.assertEqual(DepotProfils(d / "profils.json").trouve("Pi"), p)
        dp.remplace("Pi", Profil("Pi2", hote="pi", racine="/r"))
        self.assertEqual(DepotProfils(d / "profils.json").noms(), ["Pi2"])


if __name__ == "__main__":
    unittest.main()
