# À faire

Pistes pour rapprocher SPARQLSandbox de SQLSandbox, par ordre d'intérêt :

- **Créer et supprimer un jeu de données** : créer un jeu vierge (nom, titre, description ; fichiers `ontologie.ttl` et
  d'instances vides, `config.xml`, formes facultatives) et en supprimer un (avec confirmation). À décider :
  - **où** : dans l'application web (réservé à l'enseignant : il faudrait une authentification, et les droits d'écriture
    sur `donnees/`, aujourd'hui en lecture seule côté serveur) ou dans l'application d'administration de bureau
    (`admin/sparqlsandbox_admin/jeux.py`, `page_jeux.py`) qui gère déjà les jeux ;
  - **sécurité** : nom de dossier validé (`^[a-z0-9][a-z0-9_-]*$`, comme `liste_jeux()`), jamais de chemin saisi ;
  - **effets d'une suppression** : copies de session en cours, exercices du jeu (`donnees/exercices/`), suivi gardé dans
    le navigateur des étudiants, cache de `liste_jeux()`, jeu choisi dans l'URL ;
  - **jeu vierge** : un jeu sans instance ni ontologie doit s'ouvrir sans erreur (diagramme vide, éditeur utilisable
    pour tout construire), avec un exemple de requête minimal ;
  - **déploiement** : le dossier créé vit-il dans le dépôt git (jeu partagé) ou à côté (jeu local d'une installation) ?
- **Exercices** : synchroniser le catalogue d'une instance QueryCraft (`exos_source`), comme
  SQLSandbox, quand QueryCraft gérera des jeux RDF ; comparer les graphes de `CONSTRUCT` à
  l'isomorphisme près (aujourd'hui, tous les nœuds anonymes sont tenus pour égaux) ; vérifier
  l'effet d'une mise à jour en comparant les graphes obtenus.
- **Ontologie et instances dans des graphes nommés** (option 2) : aujourd'hui, les fichiers d'un jeu
  (pour « Cinéma », `ontologie.ttl` et `cinema.ttl`) sont chargés ensemble dans le graphe par
  défaut. Les charger chacun dans son graphe nommé (`<…/ontologie>`, `<…/instances>`), en TriG ou
  par un attribut `graphe` de `<fichier>` (`oxigraph load --graph`), permettrait de travailler
  `GRAPH`, `FROM`, `FROM NAMED`, `COPY`, `MOVE`. Il faudrait alors revoir les exemples et les
  exercices (qui interrogent le graphe par défaut), ou proposer les deux présentations du jeu.
- **Raisonnement** : Oxigraph n'en fait pas ; permettre de choisir un niveau de raisonnement
  appliqué à la copie de session : aucun, RDF/RDFS (`rdfs:subClassOf`, `rdfs:subPropertyOf`,
  `rdfs:domain`, `rdfs:range`), puis différents niveaux d'OWL (profils OWL 2 RL, EL, QL…), par
  exemple en interrogeant une version « saturée » du jeu, pour comparer les réponses d'un niveau
  à l'autre.
- **Cohérence** : contrôles OWL simples (`owl:disjointWith`, `owl:FunctionalProperty`,
  `owl:inverseOf`), traduction d'un sous-ensemble de SHACL en SPARQL pour se passer de pyshacl
  sur un hébergement sans Python, et choix par jeu entre avertir et refuser une mise à jour
  incohérente.
- **Import et export en Turtle** (import fait : `import.php`, bouton « 🔁 Import / export » de l'éditeur) : un fichier
  Turtle (`.ttl`) ou N-Triples (`.nt`), 1 Mo et 20 000 triplets au plus, est validé par Oxigraph (ligne et colonne en cas
  d'erreur), puis sa partie « ontologie », « instances » ou « tout » est versée par fusion ou remplacement dans une copie
  jetable qui passe les contrôles de cohérence ; la copie de l'étudiant n'est remplacée qu'à la fin, et une simulation
  (« Analyser ») ne change rien. Les `@prefix` du fichier sont ajoutés aux préfixes de la copie. Reste :
  - import depuis la page principale (aujourd'hui seulement dans l'éditeur), et d'autres formats (TriG, RDF/XML, JSON-LD) ;
  - **export** d'un résultat de requête (CSV, Turtle) et d'autres sérialisations (N-Triples, RDF/XML, JSON-LD) ;
  - jeu d'origine à rétablir après un import raté de l'ontologie : le bouton « Revenir au jeu d'origine » existe déjà.
- **Préfixes** (fait) : l'étudiant ajoute à sa copie un vocabulaire standard (catalogue de `PREFIXES_CATALOGUE`) ou un préfixe métier,
  gardé en session ; piste : l'exporter avec le Turtle de la copie, ou le garder avec les mémoires de requêtes.
- **Éditeur d'ontologie** (fait : `editeur.php`, `js/editeur.js`, `js/disposition.js`, `ontologie.php`,
  `peuplement.php`) : graphe et liste éditables (sous-classes multiples, flèches ré-accrochables par
  leurs extrémités), instances affichées, créées, modifiées et supprimées à la main, peuplement par IA
  (général ou ciblé), axiomes RDFS/OWL des concepts et propriétés (sous-propriété, inverse, équivalences,
  disjonction, caractéristiques, genre, annotations) ; tout est un brouillon enregistré d'un coup dans la copie. Le bouton « Contrôler » existe. Reste : formes SHACL dérivées de l'ontologie (cardinalités, propriété fonctionnelle,
  concepts disjoints) faites ; à traduire encore : `owl:InverseFunctionalProperty`, symétrie, irréflexivité, `sh:in` (valeurs permises).
- **Diagramme du vocabulaire** (fait) : pistes d'amélioration : éviter tout croisement de liens
  (la disposition en couches est simple, sans minimisation des croisements), propriétés
  `owl:inverseOf` et restrictions OWL, export du diagramme en SVG ou PNG, zoom.

## Retours utilisateurs (TODO-list)

Tâches relevées lors d'une session de test, par priorité décroissante. Les identifiants (T1…T14)
servent de référence.

### P1 — bloquant ou confusant

- **T4 — langue des textes libres** (fait) : `cine:titre` a pour portée `rdfs:Literal`, que le modèle de l'ontologie ignorait ;
  elle est gardée (`ontologie.php`), et un nouveau texte libre prend la langue par défaut (`fr`) dans le formulaire d'instance
  (`js/editeur.js` `valeurVide`), modifiable ; liste de langues proposée.
- **T6 — instances du brouillon invisibles** (fait) : elles apparaissent en tête de leur concept (`classesAffichees` de
  `js/editeur.js`), avec le badge « à enregistrer », rouvrables ou retirables ; un concept qui n'a que des instances du
  brouillon est montré aussi.
- **T2 — rapport de cohérence unique** (fait) : le bouton « 🔍 Contrôler » de l'éditeur (action `controle`,
  `controle_brouillon()` dans `ontologie.php`) joue le brouillon sur une copie jetable et lui applique les mêmes
  contrôles que le panneau « Cohérence » (RDFS, formes du jeu, formes dérivées) ; sans brouillon, c'est exactement
  ce rapport. « 🛡️ Formes SHACL » montre les formes, pas les anomalies. Piste : surligner dans le graphe les éléments
  en cause.
- **T8 — propositions de l'IA incohérentes** (fait) : le prompt contient maintenant les formes du jeu et celles de
  l'ontologie (`peupl_contraintes()`), avec la consigne de renseigner les propriétés obligatoires ; chaque proposition
  est contrôlée avant d'être montrée (`peupl_controle()` : toutes jouées sur une copie jetable, `simule_mise_a_jour()`,
  anomalies nouvelles rattachées à l'instance concernée). Les propositions douteuses sont signalées (⚠️) et décochées ;
  « cocher sans anomalie ». Le contrôle ne bloque jamais le peuplement.
- **T13 — erreur de vérification peu lisible en TP** : `exercices.php` `verifie_reponse` (l. 209-223)
  dit *que* le résultat diffère, pas *quoi*. Contrainte : ne jamais montrer la solution.
  Piste : écart mis en forme (colonnes, lignes, ordre, premières valeurs différentes en évidence),
  tableau comparatif pour les questions `…T…`.

### P2 — gênant

- **T1 — zoom/slider sur les grands graphes** : `js/vocabulaire.js:171`, `js/editeur.js:315`
  (viewBox), `js/disposition.js`. Piste : zoom sur le viewBox (molette, boutons ±, slider), pan.
  Le zoom du diagramme est déjà listé plus haut.
- **T14 — second clic = désélection** (fait) : dans le diagramme principal (`vocabulaire.js` `ouvre` : `surClic(null…)` ferme le panneau)
  et dans l'éditeur (graphe : un clic sans déplacement sur le concept déjà choisi ; liste, flèches, attributs, touche Entrée).
- **T3 — nœuds anonymes** (fait) : filtre « nœuds anonymes seulement » dans l'onglet Instance, badge `∅ n` sur chaque concept,
  et « les voir » depuis la fiche d'un concept qui en possède.
- **T7 — propriété externe (`foaf:name`) difficile à utiliser** : seules les propriétés déclarées
  du jeu sont proposées. Piste : proposer aussi les propriétés observées (`vocabulaire.php`) et
  les standards (`PREFIXES_STANDARD`).
- **T5 — provenance d'une instance** (fait) : « IA » ou « manuel », gardée par le serveur dans un graphe nommé à part
  (`urn:sparqlsandbox:provenance`, `peuplement.php`), retirée avec l'instance, absente des exports ; badge dans l'onglet Instance,
  nœuds anonymes compris.
- **T12 — ni édition ni export pendant un exercice** (fait, côté affichage) : « Éditer l'ontologie » et « Exporter » sont masqués
  (`body.exercice-actif`, `js/sandbox.js`). L'URL directe `editeur.php` n'est pas bloquée : le serveur ne sait pas qu'un exercice
  est ouvert (état gardé dans le navigateur) ; un blocage demanderait un état d'exercice côté serveur, avec le risque de
  bloquer un étudiant qui ferme son navigateur en plein exercice.
### P3 — améliorations

- **T9 — saisie assistée selon le type attendu** : champ littéral (`js/editeur.js:876`),
  `sh:datatype` / `sh:languageIn` / `sh:in` (`donnees/*/formes.ttl`, `formes_depuis_modele`).
  Piste : champ `date` / `number` / sélecteur de langue, liste déroulante pour `sh:in`.
- **T10 — proposer les valeurs existantes de la base, plus une valeur libre** : à créer côté
  serveur (action `controler.php` ou extension de `vocabulaire.php` : `SELECT DISTINCT ?o` sur la
  copie), consommée par `js/editeur.js` via un `<datalist>` + « nouvelle valeur ».
- **T11 — vocabulaires standards en ressource JSON** : `PREFIXES_CATALOGUE` est une constante PHP
  (`fonctions.php:175-192`). Piste : fichier JSON (préfixes + classes et propriétés usuelles :
  FOAF, Dublin Core, Creative Commons…), proposé à l'ajout d'un concept ou d'une propriété.
