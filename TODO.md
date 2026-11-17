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
  contrôle de cohérence ontologie/instance dans l'éditeur ; formes SHACL dérivées de l'ontologie (cardinalités, propriété fonctionnelle,
  concepts disjoints) faites ; à traduire encore : `owl:InverseFunctionalProperty`, symétrie, irréflexivité, `sh:in` (valeurs permises).
- **Diagramme du vocabulaire** (fait) : pistes d'amélioration : éviter tout croisement de liens
  (la disposition en couches est simple, sans minimisation des croisements), propriétés
  `owl:inverseOf` et restrictions OWL, export du diagramme en SVG ou PNG, zoom.

## Retours utilisateurs (TODO-list)

Tâches relevées lors d'une session de test, par priorité décroissante. Les identifiants (T1…T14)
servent de référence.

### P1 — bloquant ou confusant

- **T4 — `cine:titre` non conservé à l'enregistrement (langue perdue)** : `rdfs:range rdfs:Literal`
  (`donnees/cinema/ontologie.ttl:24`) ; le type observé `rdf:langString` remplace `rdfs:Literal`
  (`vocabulaire.php:105`), mais la langue n'est pas transmise au brouillon (`js/editeur.js:57,876` ;
  le champ `l` doit être propagé via `peuplement.php:254` et `ontologie.php` `enregistre_ontologie`).
  Piste : garder `@lang` dans le brouillon et à l'enregistrement.
- **T6 — instances en cours d'ajout invisibles** : un nouveau film avec un nouveau réalisateur
  n'apparaît pas dans la liste (`js/editeur.js` `rendInstances()`, brouillon `instances`).
  Piste : afficher les instances « nouveau » du brouillon (badge, rouvrables).
- **T2 — incohérences différentes entre page principale et éditeur** : le panneau « Cohérence »
  (`coherence.php` `controle_coherence`, action `explorer` de `controler.php`) et la vue
  « Formes SHACL » de l'éditeur (action `formes`) ne montrent pas les mêmes anomalies.
  Piste : un seul rapport (RDFS + SHACL, formes du jeu + formes dérivées du brouillon) dans les
  deux pages ; le bouton de contrôle de cohérence dans l'éditeur est déjà listé plus haut.
- **T8 — l'IA insère des triplets incohérents (incomplets)** : `peuplement.php` `peupl_valide()`
  ne vérifie que la structure. Piste : valider les propositions contre les formes (pyshacl sur un
  store temporaire, comme `controles_shacl`) ou les marquer via `difference_coherence`.
- **T13 — erreur de vérification peu lisible en TP** : `exercices.php` `verifie_reponse` (l. 209-223)
  dit *que* le résultat diffère, pas *quoi*. Contrainte : ne jamais montrer la solution.
  Piste : écart mis en forme (colonnes, lignes, ordre, premières valeurs différentes en évidence),
  tableau comparatif pour les questions `…T…`.

### P2 — gênant

- **T1 — zoom/slider sur les grands graphes** : `js/vocabulaire.js:171`, `js/editeur.js:315`
  (viewBox), `js/disposition.js`. Piste : zoom sur le viewBox (molette, boutons ±, slider), pan.
  Le zoom du diagramme est déjà listé plus haut.
- **T14 — re-cliquer un objet le désélectionne** : `js/vocabulaire.js:175-181` (`ouvre` sans
  bascule), `js/editeur.js:772,799` (`selectionneConcept`). Piste : second clic → `E.sel = null`,
  fermer la fiche et la description.
- **T3 — accès aux nœuds anonymes** : action `instance` avec `anon` (`controler.php`,
  `ontologie.php` `modele_instance`), liste des instances de `js/editeur.js`.
  Piste : filtre « anonymes », lien depuis la classe.
- **T7 — propriété externe (`foaf:name`) difficile à utiliser** : seules les propriétés déclarées
  du jeu sont proposées. Piste : proposer aussi les propriétés observées (`vocabulaire.php`) et
  les standards (`PREFIXES_STANDARD`).
- **T5 — marquer la provenance d'une instance (IA / saisie manuelle)** : brouillon
  `ia: {jeton, indices}` (`peuplement.php:420`), `rendInstances` de `js/editeur.js`.
  Piste : badge « IA » / « manuel », persisté en session comme les propositions.
- **T12 — masquer « Éditer l'ontologie » et « Exporter » pendant un exercice** : boutons rendus
  dans `index.php`, mode exercice dans `js/sandbox.js`. Piste : masquer quand `exercice` est actif ;
  décider si l'URL directe `editeur.php` est aussi bloquée ou seulement masquée.

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
