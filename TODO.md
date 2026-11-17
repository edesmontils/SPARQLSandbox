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
- **Export** d'un résultat (CSV, Turtle) et de la copie de session (Turtle).
- **Éditeur d'ontologie** (fait : `editeur.php`, `js/editeur.js`, `js/disposition.js`, `ontologie.php`,
  `peuplement.php`) : graphe et liste éditables (sous-classes multiples, flèches ré-accrochables par
  leurs extrémités), instances affichées, créées, modifiées et supprimées à la main, peuplement par IA
  (général ou ciblé) ; tout est un brouillon enregistré d'un coup dans la copie. Reste : le bouton de
  contrôle de cohérence ontologie/instance dans l'éditeur, la création d'un nœud anonyme à la main,
  et des formes SHACL générées avec l'ontologie.
- **Diagramme du vocabulaire** (fait) : pistes d'amélioration : éviter tout croisement de liens
  (la disposition en couches est simple, sans minimisation des croisements), propriétés
  `owl:inverseOf` et restrictions OWL, export du diagramme en SVG ou PNG, zoom.
