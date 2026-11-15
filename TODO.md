# À faire

Pistes pour rapprocher SPARQLSandbox de SQLSandbox, par ordre d'intérêt :

- **Exercices** : synchroniser le catalogue d'une instance QueryCraft (`exos_source`), comme
  SQLSandbox, quand QueryCraft gérera des jeux RDF ; comparer les graphes de `CONSTRUCT` à
  l'isomorphisme près (aujourd'hui, tous les nœuds anonymes sont tenus pour égaux) ; vérifier
  l'effet d'une mise à jour en comparant les graphes obtenus.
- **Diagramme du vocabulaire** d'un jeu : classes, propriétés (`rdfs:domain`, `rdfs:range`,
  `rdfs:subClassOf`) et liens observés dans les données.
- **Graphes nommés** : un jeu en TriG pour travailler `GRAPH`, `FROM NAMED`, `COPY`, `MOVE`.
- **Inférence RDFS** : Oxigraph n'en fait pas ; proposer en option une version « saturée » d'un jeu
  (`rdfs:subClassOf`, `rdfs:subPropertyOf`, `rdfs:domain`, `rdfs:range`) pour comparer.
- **Export** d'un résultat (CSV, Turtle) et de la copie de session (Turtle).
- **Requêtes fédérées** encadrées : liste blanche de points d'accès (Wikidata, DBpedia) pour
  `SERVICE`, désactivée par défaut.
- Correction des intentions (`…->I`) et génération de données par IA (ProxyIAg), comme dans SQLSandbox.
