# SPARQLSandbox

Cette petite application Web a été développée à des fins pédagogiques, dans le même esprit que
[SQLSandbox](https://github.com/edesmontils/SQLSandbox) : un « bac à sable » pour apprendre
**SPARQL** et le Web sémantique. Chaque étudiant interroge et modifie **sa propre copie** de
petits graphes RDF, directement dans le navigateur, sans compte et sans rien installer ; les
données d'origine restent intactes.

L'auteur ne peut être considéré responsable des dysfonctionnements ou pertes de données et se
réserve le droit de supprimer toute instance à tout moment.

## Fonctionnement

- **Moteur SPARQL** : [Oxigraph](https://github.com/oxigraph/oxigraph) (SPARQL 1.1, requêtes et
  mises à jour), appelé en ligne de commande par PHP. Chaque jeu de données est chargé une fois
  dans un store Oxigraph (`origine_<jeu>_<empreinte>`, refait quand le fichier change) ; chaque
  session reçoit, à sa première requête, une copie de ce store (`copie_<aléa>_<jeu>`).
- **Mises à jour** (`INSERT DATA`, `DELETE WHERE`, `DELETE/INSERT`, `CLEAR`…) : exécutées sur une
  copie temporaire du store de la session, qui ne le remplace que si elle réussit et ne dépasse
  pas la taille permise. Toutes les opérations d'une requête sont donc appliquées, ou aucune.
- **Résultats** : tableau pour `SELECT`, vrai/faux pour `ASK`, triplets (sujet, prédicat, objet)
  pour `CONSTRUCT` et `DESCRIBE`. Les IRI sont abrégées avec les préfixes du jeu et ceux de la
  requête ; la langue ou le type des littéraux est indiqué.
- **Exploration** : « 🧩 Contenu de votre copie » liste les classes et les propriétés utilisées
  (avec leur nombre) ; un clic en fait une requête.
- **Exemples** : chaque jeu de données propose des requêtes commentées (`config.xml` du jeu).
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

Un message « Problème d'installation » s'affiche si aucun dossier de travail n'est utilisable ou
si Oxigraph est introuvable.

Pour essayer en local : `php -S localhost:8000`, puis <http://localhost:8000>. Le serveur intégré
de PHP ne doit pas servir l'application en public.

## Sécurité

L'application est ouverte à tous sans compte ; comme SQLSandbox, elle borne ce que chacun peut
faire :

- une requête est arrêtée au bout de **5 secondes** ; la mémoire d'un processus Oxigraph est
  limitée (`ulimit -v`) ; la sortie lue est plafonnée à 4 Mo et l'affichage à 1000 lignes ;
- **`SERVICE`** (requêtes fédérées) et **`LOAD`** sont refusés avant l'exécution : ils feraient
  sortir le serveur vers le web. Le mot-clé est cherché hors des chaînes, commentaires et IRI ;
- le store d'une session est limité à 20 Mo, le total des copies à 1 Go, et aucune copie n'est
  faite s'il reste moins de 200 Mo libres (réglables dans `sparqlsandbox.ini`) ;
- chaque adresse IP a au plus 4 requêtes en cours, et les requêtes d'une session sur un même jeu
  sont exécutées l'une après l'autre ;
- jeton anti-CSRF (en POST seulement), cookie de session `HttpOnly` et `SameSite=Lax`, `Secure` en
  HTTPS ; le texte des requêtes est envoyé en base64 pour ne pas être bloqué par un pare-feu
  applicatif ;
- les messages d'Oxigraph sont montrés sans les chemins du serveur ;
- les copies inactives depuis 3 heures (durée de la session) sont purgées à chaque ouverture de
  l'application.

Les répertoires `donnees/`, `tests/` et `tmp/` ne doivent pas être accessibles depuis le web : les
`.htaccess` fournis s'en chargent sous Apache. Sous nginx ou Caddy, les interdire dans la
configuration du serveur (voir le README de SQLSandbox, la règle est la même avec `donnees` à la
place de `bdd` et `lib`).

## Ajouter un jeu de données

Créer un dossier dans `donnees/` avec :

- le fichier de données : Turtle (`.ttl`), TriG (`.trig`, pour des graphes nommés), N-Triples,
  N-Quads ou RDF/XML (format reconnu par son extension) ;
- un `config.xml` :

```xml
<?xml version="1.0" encoding="UTF-8"?>
<jeu nom="monjeu">                <!-- minuscules, chiffres, - et _ -->
	<titre>Mon jeu</titre>
	<fichier nom="monjeu.ttl"/>
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
