# À faire

Pistes pour rapprocher SPARQLSandbox de SQLSandbox, par ordre d'intérêt :

- **Exercices** au format QueryCraft (types `I->R`, `IT->R`, `R->I`…), avec la solution gardée
  côté serveur et la comparaison des résultats (au multi-ensemble près pour `SELECT`, à
  l'isomorphisme de graphes près pour `CONSTRUCT`).
- **Diagramme du vocabulaire** d'un jeu : classes, propriétés (`rdfs:domain`, `rdfs:range`,
  `rdfs:subClassOf`) et liens observés dans les données.
- **Graphes nommés** : un jeu en TriG pour travailler `GRAPH`, `FROM NAMED`, `COPY`, `MOVE`.
- **Inférence RDFS** : Oxigraph n'en fait pas ; proposer en option une version « saturée » d'un jeu
  (`rdfs:subClassOf`, `rdfs:subPropertyOf`, `rdfs:domain`, `rdfs:range`) pour comparer.
- **Export** d'un résultat (CSV, Turtle) et de la copie de session (Turtle).
- **Requêtes fédérées** encadrées : liste blanche de points d'accès (Wikidata, DBpedia) pour
  `SERVICE`, désactivée par défaut.
- Génération de données ou correction d'intentions par IA (ProxyIAg), comme dans SQLSandbox.
