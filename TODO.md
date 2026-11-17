# À faire

Pistes pour rapprocher SPARQLSandbox de SQLSandbox, par ordre d'intérêt :

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
- **Import et export en Turtle** : l'export de la copie, de l'ontologie seule ou des instances seules existe
  (`export.php`, boutons sous le diagramme du vocabulaire). À faire :
  - **import** d'un fichier Turtle (téléversement) dans la copie, pour l'ontologie, les instances ou les deux,
    avec choix entre fusionner et remplacer (`LOAD` reste interdit : le fichier est lu par Oxigraph à l'arrivée) ;
    limites de taille et de nombre de triplets, rejet d'un fichier mal formé avec la ligne en cause, copie intacte
    en cas d'échec, `@prefix` du fichier proposés comme préfixes ajoutés, cohérence recalculée après l'import ;
  - **boutons dans l'éditeur** (importer, exporter) et reprise du brouillon d'ontologie après un import ;
  - **export** avec les préfixes ajoutés par l'étudiant, d'un résultat de requête (CSV, Turtle) et d'autres
    sérialisations (N-Triples, RDF/XML, JSON-LD).
- **Préfixes** (fait) : l'étudiant ajoute à sa copie un vocabulaire standard (catalogue de `PREFIXES_CATALOGUE`) ou un préfixe métier,
  gardé en session ; piste : l'exporter avec le Turtle de la copie, ou le garder avec les mémoires de requêtes.
- **Éditeur d'ontologie** (fait : `editeur.php`, `js/editeur.js`, `js/disposition.js`, `ontologie.php`,
  `peuplement.php`) : graphe et liste éditables (sous-classes multiples, flèches ré-accrochables par
  leurs extrémités), instances affichées, créées, modifiées et supprimées à la main, peuplement par IA
  (général ou ciblé), axiomes RDFS/OWL des concepts et propriétés (sous-propriété, inverse, équivalences,
  disjonction, caractéristiques, genre, annotations) ; tout est un brouillon enregistré d'un coup dans la copie. Reste : le bouton de
  le bouton de contrôle de cohérence ontologie/instance dans l'éditeur ; formes SHACL dérivées de l'ontologie (cardinalités, propriété fonctionnelle,
  concepts disjoints) faites ; à traduire encore : `owl:InverseFunctionalProperty`, symétrie, irréflexivité, `sh:in` (valeurs permises).
- **Diagramme du vocabulaire** (fait) : pistes d'amélioration : éviter tout croisement de liens
  (la disposition en couches est simple, sans minimisation des croisements), propriétés
  `owl:inverseOf` et restrictions OWL, export du diagramme en SVG ou PNG, zoom.
