# SPARQLSandbox

Cette petite application Web a été développée à des fins pédagogiques, dans le même esprit que
[SQLSandbox](https://github.com/edesmontils/SQLSandbox) : un « bac à sable » pour apprendre
**SPARQL** et le Web sémantique. Chaque étudiant interroge et modifie **sa propre copie** de
petits graphes RDF, directement dans le navigateur, sans compte et sans rien installer ; les
données d'origine restent intactes.

Une instance est en ligne : <https://pedago.desmontils.net/SPARQLSandbox/>.

L'auteur ne peut être considéré responsable des dysfonctionnements ou pertes de données et se
réserve le droit de supprimer toute instance à tout moment.

## Fonctionnement

- **Moteur SPARQL** : [Oxigraph](https://github.com/oxigraph/oxigraph) (SPARQL 1.1, requêtes et
  mises à jour), appelé en ligne de commande par PHP. Chaque jeu de données est chargé une fois
  dans un store Oxigraph (`origine_<jeu>_<empreinte>`, refait quand l'un de ses fichiers change) ; chaque
  session reçoit, à sa première requête, une copie de ce store (`copie_<aléa>_<jeu>`).
- **Mises à jour** (`INSERT DATA`, `DELETE WHERE`, `DELETE/INSERT`, `CLEAR`…) : exécutées sur une
  copie temporaire du store de la session, qui ne le remplace que si elle réussit et ne dépasse
  pas la taille permise. Toutes les opérations d'une requête sont donc appliquées, ou aucune.
- **Résultats** : tableau pour `SELECT`, vrai/faux pour `ASK`, triplets (sujet, prédicat, objet)
  pour `CONSTRUCT` et `DESCRIBE`. Les IRI sont abrégées avec les préfixes du jeu et ceux de la
  requête ; la langue ou le type des littéraux est indiqué.
- **Exploration** : « 🧩 Contenu de votre copie » liste les classes et les propriétés utilisées
  (avec leur nombre) ; un clic en fait une requête.
- **Diagramme du vocabulaire** (section repliable « 🗺️ Vocabulaire de votre copie », au-dessus de l'éditeur) : classes avec leurs
  attributs, sous-classes (`rdfs:subClassOf`) et propriétés entre classes. Il réunit ce que
  l'ontologie déclare (`rdfs:domain`, `rdfs:range`) et ce que les données montrent (classe du sujet
  et de l'objet de chaque triplet), donc il fonctionne aussi pour un jeu sans ontologie. Trait
  plein : observé ; pointillé : déclaré mais jamais observé. Il suit les mises à jour de la copie.
  Un clic sur une classe ou une propriété affiche ses instances (avec une colonne par attribut) ou ses triplets à droite du
  diagramme (dessous si la place manque) (lien « Dans l'éditeur » pour reprendre la requête).
  Le modèle est construit par `vocabulaire.php`, le dessin (SVG) par `js/vocabulaire.js`.
- **Exemples** : chaque jeu de données propose des requêtes commentées (`config.xml` du jeu).
- **Exercices** au format QueryCraft, avec vérification des requêtes (voir plus bas).
- **Cohérence** : la base de connaissances est contrôlée au chargement et après chaque mise à
  jour, par rapport à son ontologie (RDFS) et à ses formes SHACL (voir plus bas).
- **Mémoire** : les requêtes mémorisées et le brouillon en cours sont gardés dans le navigateur
  (`localStorage`), par jeu de données.

## Prérequis

- PHP 8.0 ou plus récent, avec `proc_open` autorisé et les extensions `SimpleXML`, `dom` et
  `mbstring` ;
- l'exécutable `oxigraph` (testé avec la version 0.5), par exemple :
  - `pip install oxigraph` (ou `pip install --user oxigraph`, qui le place dans `~/.local/bin`) ;
  - ou un binaire des [versions publiées d'Oxigraph](https://github.com/oxigraph/oxigraph/releases),
    copié dans `bin/oxigraph` à la racine du site (dossier ignoré par git).

  L'application le cherche dans le réglage `oxigraph` de `sparqlsandbox.ini`, la variable
  d'environnement `SPARQLSANDBOX_OXIGRAPH`, `bin/oxigraph`, puis le `PATH`.

- facultatif : [pyshacl](https://github.com/RDFLib/pySHACL) (`pip install pyshacl`, testé avec
  la version 0.40), pour vérifier les formes SHACL des jeux qui en ont. Il est cherché comme
  Oxigraph (réglage `pyshacl`, variable `SPARQLSANDBOX_PYSHACL`, `bin/pyshacl`, `PATH`). Sans
  lui, seuls les contrôles RDFS sont faits, et la page le signale.

Un hébergement mutualisé qui interdit `proc_open` ou l'exécution de binaires ne convient pas.

## Installation

1. Copier les fichiers sur le serveur (sans `.git/`, `.github/` ni `tests/`), en vérifiant que
   les fichiers `.htaccess` de la racine, de `donnees/`, `tests/` et `tmp/` sont bien envoyés.
2. À la première requête, l'application crée à côté de la racine web (hors du site) deux dossiers
   de travail : `sparqlsandbox-tmp` (stores Oxigraph, verrous) et `sessions-sparqlsandbox`
   (sessions PHP). À défaut, elle se replie sur `tmp/` et `tmp/sessions/`, qui doivent alors être
   accessibles en écriture.
3. Facultatif : copier `sparqlsandbox.ini.exemple` hors du site sous le nom `sparqlsandbox.ini`
   (ou l'indiquer par la variable `SPARQLSANDBOX_INI`) pour régler le chemin d'Oxigraph, la durée
   des sessions et les plafonds d'espace disque.
4. Facultatif : copier `ia.ini.exemple` hors du site sous le nom `sparqlsandbox-ia.ini` pour
   activer la correction des intentions par IA (voir plus bas).

Un message « Problème d'installation » s'affiche si aucun dossier de travail n'est utilisable ou
si Oxigraph est introuvable.

Pour essayer en local : `php -S localhost:8000`, puis <http://localhost:8000>. Le serveur intégré
de PHP ne doit pas servir l'application en public.

## Sécurité

L'application est ouverte à tous sans compte ; comme SQLSandbox, elle borne ce que chacun peut
faire :

- une requête est arrêtée au bout de **5 secondes** ; la mémoire d'un processus Oxigraph est
  limitée (`ulimit -v`) ; la sortie lue est plafonnée à 4 Mo et l'affichage à 1000 lignes ;
- **`LOAD`** est refusé avant l'exécution, et **`SERVICE`** (requêtes fédérées) aussi, sauf vers les
  points d'accès du réglage `services_autorises` de `sparqlsandbox.ini` (par défaut Wikidata et
  DBpedia ; une valeur vide interdit `SERVICE` ; adresse exacte, ni variable ni jokers). Ils feraient sinon sortir le serveur vers le web. Le mot-clé est cherché hors des chaînes, commentaires et IRI ;
- la page **Services fédérés** (lien en pied de page) décrit les points d'accès autorisés. Les services
  connus du code (Wikidata, DBpedia, DBpedia fr, data.bnf.fr, Europeana) ont une description écrite à la
  main ; pour tout autre service de `services_autorises`, la fiche est demandée une fois à l'IA (si la
  correction par IA est activée, voir plus bas), gardée dans le dossier de travail, et signalée par une
  note de bas de page comme générée par IA et non vérifiée ;
- le store d'une session est limité à 20 Mo, le total des copies à 1 Go, et aucune copie n'est
  faite s'il reste moins de 200 Mo libres (réglables dans `sparqlsandbox.ini`) ;
- chaque adresse IP a au plus 4 requêtes en cours, et les requêtes d'une session sur un même jeu
  sont exécutées l'une après l'autre ;
- jeton anti-CSRF (en POST seulement), cookie de session `HttpOnly` et `SameSite=Lax`, `Secure` en
  HTTPS ; le texte des requêtes est envoyé en base64 pour ne pas être bloqué par un pare-feu
  applicatif ;
- les messages d'Oxigraph sont montrés sans les chemins du serveur ;
- les copies inactives depuis 3 heures (durée de la session, réglable par `duree_session_min`)
  sont purgées à chaque ouverture de l'application. La page d'accueil annonce la durée réglée, et
  le pied de page affiche le temps restant avant l'expiration de la session.

Les répertoires `donnees/`, `tests/` et `tmp/` ne doivent pas être accessibles depuis le web : les
`.htaccess` fournis s'en chargent sous Apache. Sous nginx ou Caddy, les interdire dans la
configuration du serveur (voir le README de SQLSandbox, la règle est la même avec `donnees` à la
place de `bdd` et `lib`).

## Ajouter un jeu de données

Créer un dossier dans `donnees/` avec :

- le ou les fichiers de données : Turtle (`.ttl`), TriG (`.trig`, pour des graphes nommés),
  N-Triples, N-Quads ou RDF/XML (format reconnu par son extension). Plusieurs fichiers, par
  exemple l'ontologie et les instances (comme pour « Cinéma » : `ontologie.ttl` et `cinema.ttl`),
  sont chargés ensemble dans le graphe par défaut ;
- un `config.xml` :

```xml
<?xml version="1.0" encoding="UTF-8"?>
<jeu nom="monjeu">                <!-- minuscules, chiffres, - et _ -->
	<titre>Mon jeu</titre>
	<fichier nom="ontologie.ttl"/>    <!-- un ou plusieurs fichiers -->
	<fichier nom="monjeu.ttl"/>
	<formes nom="formes.ttl"/>        <!-- facultatif : formes SHACL -->
	<référence>https://…</référence>  <!-- facultatif -->
	<description><p>Description en HTML…</p></description>
	<exemples>
		<exemple titre="Toutes les classes">
			SELECT DISTINCT ?c WHERE { ?s a ?c }
		</exemple>
	</exemples>
</jeu>
```

Dans les exemples, `<` et `>` s'écrivent `&lt;` et `&gt;`. Les tests (`php tests/run.php`)
exécutent tous les exemples de tous les jeux.

## Exercices (format QueryCraft)

Comme dans SQLSandbox, les exercices suivent le format JSON de
[QueryCraft](https://pedago.desmontils.net/querycraft/). Ils sont rangés dans
`donnees/exercices/` (protégé comme les données) : un fichier par exercice, dont le nom
(sans `.json`) est le code de l'exercice.

```json
{
  "database": {"type": "rdf", "name": "cinema.ttl"},
  "questions": {
    "c1": ["SELECT … (solution)", "intention", "commentaire (indice)", "I->R", "instructions"],
    "c3": ["SELECT … (solution)", "intention", "commentaire", "rI->R", "instructions", "SELECT ___ … (requête à trous)"]
  }
}
```

L'exercice porte sur le jeu de données dont l'un des fichiers s'appelle `database.name` (`type` :
`rdf` ou `sparql`). Chaque question est une liste `[requête, intention, commentaire, type,
instructions]`, avec un 6e élément, la requête à trous, pour les types `rI->R` et `rIT->R`.

| Type | L'étudiant reçoit | Il produit |
|---|---|---|
| `I->R` | l'intention | la requête |
| `IT->R` | l'intention et la table attendue | la requête |
| `rI->R` | l'intention et une requête à trous | la requête |
| `rIT->R` | l'intention, une requête à trous et la table attendue | la requête |
| `R->I` | une requête, qu'il peut exécuter | son intention |
| `RT->I` | une requête et son résultat | son intention |

**Requêtes à trous** (`rI->R`, `rIT->R`) : comme dans SQLSandbox et QueryCraft, chaque trou du
modèle, marqué par `___` (trois soulignés ou plus), devient un champ de saisie dans le texte coloré
de la requête ; seuls les trous se remplissent (Entrée : trou suivant, Ctrl+Entrée : vérifier).
L'exécution et la vérification attendent que tous les trous soient remplis. Si le modèle ne contient
pas de `___`, la requête se complète dans l'éditeur.

**Vérification des requêtes** (`…->R`), propre à SPARQLSandbox : « ✅ Vérifier ma réponse »
(ou Ctrl+Entrée) exécute la requête de l'étudiant sur sa copie, puis la solution sur la même
copie, et compare les résultats :

- les noms des variables ne comptent pas, l'ordre des colonnes si ;
- l'ordre des lignes ne compte que si la solution contient `ORDER BY` ;
- les nœuds anonymes sont tous équivalents (leurs identifiants changent d'une exécution à
  l'autre), la langue et le type des littéraux comptent ;
- pour `CONSTRUCT` et `DESCRIBE`, ce sont les ensembles de triplets qui sont comparés.

Le message dit si la forme de requête, le nombre de colonnes ou de lignes, l'ordre ou le contenu
diffère, sans montrer la solution. Une question dont la solution est une mise à jour n'est pas
comparée : la mise à jour est exécutée et l'étudiant vérifie son effet.

**Intentions** (`…->I`) : corrigées par une IA quand elle est activée (section suivante), sinon
auto-évaluation : une fois son intention rédigée, l'étudiant la voit à côté de celle de
l'enseignant. Avec l'IA, l'intention de l'enseignant n'est jamais montrée, et une question
d'intention ne compte comme faite que si l'IA la juge correcte.

**Copie de l'étudiant** : comme dans SQLSandbox, « 📄 Ma copie » (en tête de l'exercice) présente
ses réponses, prêtes à imprimer ou à enregistrer en PDF par le navigateur : nom et prénom (gardés
dans le navigateur), bilan, puis pour chaque question la requête proposée et sa dernière
vérification, ou l'intention rédigée et sa comparaison, en signalant une réponse modifiée depuis.
Seule la copie est imprimée, et le nom du fichier PDF proposé reprend celui de l'étudiant et le
code de l'exercice.

Le navigateur ne reçoit jamais la solution d'une question `…->R` ni l'intention attendue d'une
question `…->I` : le serveur les relit dans le fichier. La table attendue (types `…T…`) est
calculée sur le jeu d'**origine**, avec les mêmes protections que les requêtes des étudiants, et
gardée en cache dans le dossier de travail (`table_*`). Les réponses, intentions et questions
réussies sont gardées dans le navigateur ; l'adresse `?jeu=cinema&exercice=cinema-tp1` ouvre
directement un exercice.

Les tests vérifient que chaque solution est reconnue comme bonne réponse.

## Correction des intentions par IA

Comme dans SQLSandbox, « ✅ Faire corriger mon intention » fait évaluer l'intention rédigée pour une
question `R->I` ou `RT->I` par un modèle de langage, qui rend un verdict (correcte, partiellement
correcte, incorrecte) et un retour bref, sans donner l'intention attendue ni de SPARQL. La
correction est gardée dans le navigateur et figure sur la copie de l'étudiant.

La fonction passe par un ProxyIAg (proxy compatible
OpenAI qui garde les vraies clés des providers et applique des quotas) et **n'existe que si le
fichier de réglages est présent**. Copier `ia.ini.exemple` **hors du site**, à côté de la racine
web, sous le nom `sparqlsandbox-ia.ini` (`~/sparqlsandbox-ia.ini` chez OVH, droits `600`), et y
renseigner l'URL du proxy (HTTPS obligatoire hors `localhost`), une clé `sk-…` propre à
l'application et l'alias du modèle. La variable d'environnement `SPARQLSANDBOX_IA_INI` permet de
placer le fichier ailleurs. Prérequis : les extensions `curl` et `mbstring` de PHP ; sans elles,
la fonction est désactivée.

- **Prompt** : `templates/intention_prompt.md`, adapté de celui de SQLSandbox et QueryCraft. Le
  serveur y place la requête et l'intention de l'enseignant, relues dans le fichier de
  l'exercice (jamais reçues du navigateur), et l'intention de l'étudiant. Le message système
  décrit le jeu de données : sa description (`config.xml`) et le contenu de ses fichiers
  (ontologie et instances, 20 000 caractères au plus).
- **Injections** : l'intention de l'étudiant est placée entre balises `<intention_etudiant>`
  (qu'il ne peut pas refermer lui-même), et le modèle a pour consigne de ne suivre aucune
  demande qu'elle contient. Si l'explication renvoyée recopie malgré tout l'intention de
  référence (entière, ou six de ses mots à la suite), elle est remplacée par un message
  invitant à reformuler, et l'incident est noté dans le journal de PHP.
- **Quotas** : la clé étant unique, le quota de ProxyIAg est commun à tous les étudiants.
  L'application limite donc chaque session (`par_session_intention`, 30 corrections par jour,
  `delai` de 5 secondes entre deux), chaque adresse IP (`par_ip`, 250 appels par jour, fichier
  `ia_ip` du dossier de travail ; assez large pour une salle de TP derrière une même adresse)
  et l'installation entière (`plafond_global`, 500 par jour, fichier `ia_compteur`). Un appel
  qui échoue côté service est rendu au quota.
- **Erreurs** : les messages du proxy ne sont jamais montrés aux étudiants ; ils vont dans le
  journal d'erreurs de PHP. La session est libérée pendant l'appel, pour que les autres
  requêtes de l'étudiant n'attendent pas.

Les tests (`tests/run.php`) utilisent un faux ProxyIAg (`tests/faux_proxy.php`).

## Cohérence de la base de connaissances

La base de connaissances d'un jeu est contrôlée **au chargement** (store d'origine : le rapport est
gardé en cache dans le dossier de travail, et les anomalies sont notées dans le journal de PHP
pour l'enseignant) et **après chaque mise à jour** d'un étudiant. Une incohérence n'est jamais
refusée — RDF est en monde ouvert, et se tromper fait partie de l'apprentissage — mais elle est
signalée :

- sous le résultat de la mise à jour : les anomalies qu'elle **introduit**, et celles qu'elle
  **corrige** ;
- dans le panneau « 🩺 Cohérence » : toutes les anomalies de la copie.

**Contrôles RDFS** (tous les jeux), qui lisent l'ontologie comme des contraintes en monde fermé :

- classe ou propriété utilisée dans l'espace de noms de l'ontologie sans y être déclarée (faute
  de frappe : `cine:Flim`) ;
- `rdfs:domain` : le sujet doit être du type indiqué, sous-classes comprises ;
- `rdfs:range` : l'objet doit être une ressource du type indiqué, ou un littéral du type de
  données indiqué ;
- littéral mal formé pour son type (`"mille"^^xsd:integer`, `"2026-13-45"^^xsd:date`).

**Formes SHACL** (jeux qui déclarent `<formes nom="…"/>`), validées par pyshacl : cardinalités,
langues, listes de valeurs, bornes… que RDFS ne sait pas exprimer. Les messages des formes
(`sh:message`, en français) sont ceux que voient les étudiants. Les deux jeux fournis en ont un
(`donnees/cinema/formes.ttl`, `donnees/amis/formes.ttl`).

Les tests vérifient que chaque jeu est cohérent au chargement.

## Tests

```sh
php tests/run.php
```

Ils demandent Oxigraph, et sont lancés par GitHub Actions (`.github/workflows/tests.yml`).

## Licence

Le code de SPARQLSandbox est un logiciel libre, distribué sous la licence GNU GPL version 3
(fichier `LICENSE`).

Éléments tiers, sous leur propre licence :
- éditeur [CodeMirror 5](https://codemirror.net/5/) (`js/codemirror/`, version 5.65.21, avec son
  mode `sparql`) : licence MIT (`js/codemirror/LICENSE`) ;
- police [Atkinson Hyperlegible Next](https://www.brailleinstitute.org/freefont/) du Braille
  Institute of America (`fonts/`) : utilisation libre, sans modification des fichiers
  (`fonts/LICENCE.txt`) ;
- [Oxigraph](https://github.com/oxigraph/oxigraph), installé à part : licences MIT ou Apache 2.0.
