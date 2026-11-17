<?php
// Éditeur d'ontologie : modèle modifiable de l'ontologie d'une copie de session, et mise à jour
// SPARQL qui applique les changements faits par l'étudiant (page editeur.php, js/editeur.js).
//
// Le modèle ne garde que ce que l'éditeur sait modifier :
//   classes : iri, nom, label (+ langue), comment (+ langue), parents (super-classes), n (instances),
//             et les relations de onto_relations() : equiv (owl:equivalentClass), disjoint (owl:disjointWith),
//             voir (rdfs:seeAlso), defini (rdfs:isDefinedBy)
//   props   : iri, nom, label, comment (+ langues), domain, range (une seule valeur chacun), decl, min, max (cardinalité
//             SHACL, '' si non fixée), relations
//             (superprops : rdfs:subPropertyOf, equiv : owl:equivalentProperty, inverse : owl:inverseOf, voir, defini),
//             carac (caractéristiques OWL : fonctionnelle, symétrique…), genre (objet | donnee : owl:ObjectProperty ou DatatypeProperty)
// Les autres déclarations (plusieurs domaines, annotations…) ne sont jamais touchées : la mise à
// jour n'efface que les triplets que l'éditeur a lus, un par un (DELETE DATA), jamais en bloc,
// sauf pour la suppression d'un élément (toutes ses déclarations, pas ses instances).

const ONTO_LIGNES_MAX = 3000;
const ONTO_ELEMENTS_MAX = 400;
const ONTO_LIBELLE_MAX = 200;
const ONTO_COMMENTAIRE_MAX = 1000;
const ONTO_LANGUE_DEFAUT = 'fr';
const ONTO_ESPACE_DEFAUT = 'http://example.org/ontologie#';
// Graphe nommé de la copie qui garde les contraintes de cardinalité voulues par l'étudiant (<propriété> sh:minCount n ; sh:maxCount m).
// Les formes SHACL sont dérivées de l'ontologie et de ces cardinalités à chaque contrôle (coherence.php, formes_depuis_modele()).
const ONTO_GRAPHE_CONTRAINTES = 'urn:sparqlsandbox:contraintes';
const ONTO_CARDINALITE_MAX = 1000;

// Relations entre éléments de l'ontologie, et annotations : type d'élément => clé => array(prédicat, titre, genre de cible
// ('classe', 'prop' : un élément de l'ontologie ; 'iri' : n'importe quelle IRI))
function onto_relations() {
	$R = PREFIXES_STANDARD['rdfs']; $O = PREFIXES_STANDARD['owl'];
	$voir = array($R.'seeAlso', 'voir aussi', 'iri');
	$defini = array($R.'isDefinedBy', 'défini par', 'iri');
	return array(
		'classes' => array(
			'equiv' => array($O.'equivalentClass', 'équivalent à', 'classe'),
			'disjoint' => array($O.'disjointWith', 'disjoint de', 'classe'),
			'voir' => $voir, 'defini' => $defini),
		'props' => array(
			'superprops' => array($R.'subPropertyOf', 'sous-propriété de', 'prop'),
			'equiv' => array($O.'equivalentProperty', 'équivalente à', 'prop'),
			'inverse' => array($O.'inverseOf', 'inverse de', 'prop'),
			'voir' => $voir, 'defini' => $defini),
	);
}

// Caractéristiques OWL d'une propriété : clé => array(classe OWL, titre, aide)
function onto_caracteristiques() {
	$O = PREFIXES_STANDARD['owl'];
	return array(
		'fonctionnelle' => array($O.'FunctionalProperty', 'fonctionnelle', 'au plus une valeur par sujet'),
		'fonctionnelle_inverse' => array($O.'InverseFunctionalProperty', 'fonctionnelle inverse', 'une valeur ne peut venir que d\'un sujet (comme un identifiant)'),
		'symetrique' => array($O.'SymmetricProperty', 'symétrique', 'si A p B alors B p A'),
		'asymetrique' => array($O.'AsymmetricProperty', 'asymétrique', 'si A p B alors jamais B p A'),
		'transitive' => array($O.'TransitiveProperty', 'transitive', 'si A p B et B p C alors A p C'),
		'reflexive' => array($O.'ReflexiveProperty', 'réflexive', 'tout élément est lié à lui-même'),
		'irreflexive' => array($O.'IrreflexiveProperty', 'irréflexive', 'aucun élément n\'est lié à lui-même'),
	);
}

// Genre OWL d'une propriété : clé => classe OWL
function onto_genres() {
	$O = PREFIXES_STANDARD['owl'];
	return array('objet' => $O.'ObjectProperty', 'donnee' => $O.'DatatypeProperty');
}

// Prédicats des relations, et types OWL spéciaux (caractéristiques, genre)
function onto_predicats() {
	$p = array();
	foreach (onto_relations() as $t) foreach ($t as $d) $p[$d[0]] = $d[0];
	return array_values($p);
}
function onto_types_speciaux() {
	$t = array();
	foreach (onto_caracteristiques() as $d) $t[] = $d[0];
	return array_merge($t, array_values(onto_genres()));
}

// Ce que le client a besoin de savoir pour dessiner les champs d'axiomes
function onto_meta() {
	$rel = array();
	foreach (onto_relations() as $k => $t) foreach ($t as $cle => $d) $rel[$k][] = array('cle' => $cle, 'titre' => $d[1], 'cible' => $d[2]);
	$car = array();
	foreach (onto_caracteristiques() as $cle => $d) $car[] = array('cle' => $cle, 'titre' => $d[1], 'aide' => $d[2]);
	return array('relations' => $rel, 'carac' => $car);
}

// Un élément « vide » du type $k (classes | props) : valeurs par défaut des champs que l'éditeur gère
function onto_vide($k) {
	$o = array('label' => '', 'llang' => '', 'comment' => '', 'clang' => '');
	if ($k === 'classes') $o['parents'] = array(); else $o = array_merge($o, array('domain' => '', 'range' => '', 'carac' => array(), 'genre' => '', 'min' => '', 'max' => ''));
	foreach (onto_relations()[$k] as $cle => $_) $o[$cle] = array();
	return $o;
}

// Types de données proposés comme portée d'une propriété
function onto_types() {
	$x = PREFIXES_STANDARD['xsd'];
	return array($x.'string', $x.'integer', $x.'decimal', $x.'boolean', $x.'date', $x.'dateTime', PREFIXES_STANDARD['rdfs'].'Literal');
}

// Une valeur parmi des littéraux ([valeur, langue]) : la langue par défaut d'abord, puis sans
// langue, puis la première dans l'ordre alphabétique des langues
function onto_choisit_litteral(array $valeurs) {
	if (!$valeurs) return array('', '');
	usort($valeurs, function ($a, $b) { return strcmp($a[1], $b[1]) ?: strcmp($a[0], $b[0]); });
	foreach (array(ONTO_LANGUE_DEFAUT, '') as $langue)
		foreach ($valeurs as $v) if ($v[1] === $langue) return $v;
	return $valeurs[0];
}

// Espace de noms des nouveaux éléments : le plus fréquent parmi les classes et propriétés déclarées
function onto_espace(array $iris) {
	$n = array();
	foreach ($iris as $iri) {
		if (voc_est_meta($iri) || voc_est_litteral($iri)) continue;
		$p = max((int)strrpos($iri, '#'), (int)strrpos($iri, '/'));
		if ($p > 0) { $e = substr($iri, 0, $p + 1); $n[$e] = ($n[$e] ?? 0) + 1; }
	}
	if (!$n) return ONTO_ESPACE_DEFAUT;
	arsort($n);
	return array_key_first($n);
}

// Construit le modèle à partir des lignes lues dans le store (même forme que construit_vocabulaire())
//   $classes   [c]                   classes déclarées (rdfs:Class, owl:Class)
//   $parents   [c, sup]              rdfs:subClassOf entre IRI
//   $props     [p, dom|null, ran|null]  propriétés déclarées (type, domaine, portée)
//   $instances [c => nombre]         instances par classe
//   $labels    [x, texte, langue]    rdfs:label
//   $comments  [x, texte, langue]    rdfs:comment
//   $axiomes   [s, p, o]             relations de onto_relations() entre IRI
//   $speciaux  [s, type]             types owl des propriétés : caractéristiques et genre
//   $contraintes [p, 'min'|'max', n] cardinalités voulues (graphe ONTO_GRAPHE_CONTRAINTES)
function construit_modele_ontologie(array $classes, array $parents, array $props, array $instances, array $labels, array $comments, array $axiomes, array $speciaux, array $contraintes, array $prefixes) {
	$cl = array();   // iri => decl
	$ajoute = function ($iri, $decl) use (&$cl) {
		if (!is_string($iri) || voc_est_meta($iri) || voc_est_litteral($iri)) return;
		if (!isset($cl[$iri])) $cl[$iri] = false;
		if ($decl) $cl[$iri] = true;
	};
	foreach ($classes as $c) $ajoute($c, true);
	$sup = array();
	foreach ($parents as $l) {
		if (voc_est_meta($l[0]) || voc_est_meta($l[1]) || $l[0] === $l[1]) continue;
		$ajoute($l[0], false);
		$ajoute($l[1], false);
		$sup[$l[0]][$l[1]] = true;
	}
	$pr = array();   // iri => [dom => true, ran => true]
	foreach ($props as $l) {
		if (voc_est_meta($l[0])) continue;
		if (!isset($pr[$l[0]])) $pr[$l[0]] = array('dom' => array(), 'ran' => array());
		if (!is_null($l[1]) && !voc_est_meta($l[1])) { $pr[$l[0]]['dom'][$l[1]] = true; $ajoute($l[1], false); }
		if (!is_null($l[2]) && !voc_est_meta($l[2])) { $pr[$l[0]]['ran'][$l[2]] = true; $ajoute($l[2], false); }
	}
	// relations : le prédicat donne la clé ; une relation vers un concept ou une propriété y fait entrer la cible
	$rel_pred = array();
	foreach (onto_relations() as $k => $t) foreach ($t as $cle => $d) $rel_pred[$d[0]][] = array($k, $cle, $d[2]);
	$rel = array('classes' => array(), 'props' => array());   // k => iri => cle => iri => true
	foreach ($axiomes as $l) {
		foreach ($rel_pred[$l[1]] ?? array() as $d) {
			list($k, $cle, $cible) = $d;
			$connu = $k === 'classes' ? isset($cl[$l[0]]) : isset($pr[$l[0]]);
			if (!$connu || voc_est_meta($l[0])) continue;
			if ($cible === 'classe') $ajoute($l[2], false);
			elseif ($cible === 'prop' && !voc_est_meta($l[2]) && !isset($pr[$l[2]])) $pr[$l[2]] = array('dom' => array(), 'ran' => array());
			$rel[$k][$l[0]][$cle][$l[2]] = true;
		}
	}
	$car = array(); $genre = array();
	$carac_par_iri = array(); foreach (onto_caracteristiques() as $cle => $d) $carac_par_iri[$d[0]] = $cle;
	$genre_par_iri = array_flip(onto_genres());
	foreach ($speciaux as $l) {
		if (isset($carac_par_iri[$l[1]])) $car[$l[0]][$carac_par_iri[$l[1]]] = true;
		elseif (isset($genre_par_iri[$l[1]])) $genre[$l[0]] = $genre_par_iri[$l[1]];
	}
	$card = array();
	foreach ($contraintes as $l) $card[$l[0]][$l[1]] = (string)(int)$l[2];
	$textes = function (array $lignes) {
		$t = array();
		foreach ($lignes as $l) $t[$l[0]][] = array($l[1], $l[2]);
		return $t;
	};
	$labels = $textes($labels);
	$comments = $textes($comments);
	$nom = function ($iri) use ($prefixes) { return abrege_iri($iri, $prefixes); };
	$liste = function ($k, $iri, $cle) use ($rel) { $v = array_keys($rel[$k][$iri][$cle] ?? array()); sort($v); return $v; };

	ksort($cl);
	$sortie = array('classes' => array(), 'props' => array(), 'types' => array(), 'espace' => '');
	foreach ($cl as $iri => $decl) {
		$p = isset($sup[$iri]) ? array_keys($sup[$iri]) : array();
		sort($p);
		list($label, $ll) = onto_choisit_litteral($labels[$iri] ?? array());
		list($comment, $cl_) = onto_choisit_litteral($comments[$iri] ?? array());
		$e = array('iri' => $iri, 'nom' => $nom($iri), 'label' => $label, 'llang' => $ll,
			'comment' => $comment, 'clang' => $cl_, 'parents' => $p, 'n' => (int)($instances[$iri] ?? 0), 'decl' => $decl);
		foreach (onto_relations()['classes'] as $cle => $_) $e[$cle] = $liste('classes', $iri, $cle);
		$sortie['classes'][] = $e;
	}
	ksort($pr);
	foreach ($pr as $iri => $d) {
		$dom = array_keys($d['dom']); sort($dom);
		$ran = array_keys($d['ran']); sort($ran);
		list($label, $ll) = onto_choisit_litteral($labels[$iri] ?? array());
		list($comment, $cl_) = onto_choisit_litteral($comments[$iri] ?? array());
		$cs = array_keys($car[$iri] ?? array()); sort($cs);
		$e = array('iri' => $iri, 'nom' => $nom($iri), 'label' => $label, 'llang' => $ll, 'comment' => $comment, 'clang' => $cl_,
			'domain' => $dom ? $dom[0] : '', 'range' => $ran ? $ran[0] : '', 'carac' => $cs, 'genre' => $genre[$iri] ?? '',
			'min' => $card[$iri]['min'] ?? '', 'max' => $card[$iri]['max'] ?? '');
		foreach (onto_relations()['props'] as $cle => $_) $e[$cle] = $liste('props', $iri, $cle);
		$sortie['props'][] = $e;
	}
	foreach (onto_types() as $t) $sortie['types'][] = array('iri' => $t, 'nom' => $nom($t));
	$sortie['espace'] = onto_espace(array_merge(array_keys($cl), array_keys($pr)));
	$sortie['prefixes'] = $prefixes;   // pour abréger et résoudre les identifiants saisis dans l'éditeur
	$sortie['meta'] = onto_meta();
	return $sortie;
}

// Lit le modèle de l'ontologie du store $store (sans verrou : l'appelant le tient déjà, ou n'en a pas besoin) ;
// renvoie array(modèle|null, message d'erreur)
function lit_ontologie_store($jeu, $store) {
	$pre = 'PREFIX rdf: <'.PREFIXES_STANDARD['rdf'].'> PREFIX rdfs: <'.PREFIXES_STANDARD['rdfs'].'> '
		.'PREFIX owl: <'.PREFIXES_STANDARD['owl'].'> PREFIX sh: <http://www.w3.org/ns/shacl#> ';
	$lim = ' LIMIT '.ONTO_LIGNES_MAX;
	$requetes = array(
		'classes' => 'SELECT DISTINCT ?c WHERE { ?c a ?t . VALUES ?t { rdfs:Class owl:Class } FILTER(isIRI(?c)) }'.$lim,
		'parents' => 'SELECT ?c ?sup WHERE { ?c rdfs:subClassOf ?sup . FILTER(isIRI(?c) && isIRI(?sup)) }'.$lim,
		'props' => 'SELECT DISTINCT ?p ?dom ?ran WHERE { '
			.'{ ?p a ?t . VALUES ?t { rdf:Property owl:ObjectProperty owl:DatatypeProperty } } UNION { ?p rdfs:domain ?d0 } UNION { ?p rdfs:range ?r0 } '
			.'OPTIONAL { ?p rdfs:domain ?dom . FILTER(isIRI(?dom)) } OPTIONAL { ?p rdfs:range ?ran . FILTER(isIRI(?ran)) } FILTER(isIRI(?p)) }'.$lim,
		'instances' => 'SELECT ?c (COUNT(DISTINCT ?s) AS ?n) WHERE { ?s a ?c . FILTER(isIRI(?c)) } GROUP BY ?c'.$lim,
		'labels' => 'SELECT ?x ?l (LANG(?l) AS ?g) WHERE { ?x rdfs:label ?l . FILTER(isIRI(?x) && isLiteral(?l)) }'.$lim,
		'comments' => 'SELECT ?x ?l (LANG(?l) AS ?g) WHERE { ?x rdfs:comment ?l . FILTER(isIRI(?x) && isLiteral(?l)) }'.$lim,
		// relations et annotations (onto_relations), caractéristiques et genre OWL des propriétés
		'axiomes' => 'SELECT ?s ?p ?o WHERE { ?s ?p ?o . VALUES ?p { '.implode(' ', array_map('onto_iri', onto_predicats())).' } FILTER(isIRI(?s) && isIRI(?o)) }'.$lim,
		'speciaux' => 'SELECT ?s ?t WHERE { ?s a ?t . VALUES ?t { '.implode(' ', array_map('onto_iri', onto_types_speciaux())).' } FILTER(isIRI(?s)) }'.$lim,
		// cardinalités voulues, gardées dans un graphe nommé à part
		'contraintes' => 'SELECT ?p ?c ?n WHERE { GRAPH <'.ONTO_GRAPHE_CONTRAINTES.'> { ?p ?c ?n . VALUES ?c { sh:minCount sh:maxCount } FILTER(isIRI(?p)) } }'.$lim,
	);
	$lignes = array();
	foreach ($requetes as $cle => $q) {
		$r = lance_oxigraph(array('query', '--location', $store, '--results-format', 'json'), $pre.$q);
		$j = $r['code'] === 0 ? json_decode($r['sortie'], true) : null;
		if (!is_array($j)) return array(null, $r['delai'] ? "La lecture de l'ontologie a pris trop de temps." : ($r['erreur'] !== '' ? message_oxigraph($r['erreur']) : 'Lecture impossible.'));
		$lignes[$cle] = $j['results']['bindings'] ?? array();
	}
	$val = 'voc_valeur';
	$instances = array();
	foreach ($lignes['instances'] as $l) $instances[$val($l, 'c')] = (int)$val($l, 'n');
	$textes = function ($ls) use ($val) { return array_map(function ($l) use ($val) { return array($val($l, 'x'), (string)$val($l, 'l'), (string)$val($l, 'g')); }, $ls); };
	$prefixes = array_merge(PREFIXES_STANDARD, prefixes_jeu($jeu));
	return array(construit_modele_ontologie(
		array_map(function ($l) use ($val) { return $val($l, 'c'); }, $lignes['classes']),
		array_map(function ($l) use ($val) { return array($val($l, 'c'), $val($l, 'sup')); }, $lignes['parents']),
		array_map(function ($l) use ($val) { return array($val($l, 'p'), $val($l, 'dom'), $val($l, 'ran')); }, $lignes['props']),
		$instances, $textes($lignes['labels']), $textes($lignes['comments']),
		array_map(function ($l) use ($val) { return array($val($l, 's'), $val($l, 'p'), $val($l, 'o')); }, $lignes['axiomes']),
		array_map(function ($l) use ($val) { return array($val($l, 's'), $val($l, 't')); }, $lignes['speciaux']),
		array_map(function ($l) use ($val) { return array($val($l, 'p'), substr($val($l, 'c'), -8) === 'minCount' ? 'min' : 'max', $val($l, 'n')); }, $lignes['contraintes']),
		$prefixes), '');
}

// Lit le modèle de l'ontologie de la copie de session ; renvoie array(modèle|null, message d'erreur)
function modele_ontologie($jeu) {
	$copie = store_copie($jeu, $erreur);
	if (is_null($copie)) return array(null, $erreur);
	$place = reserve_execution();
	if (is_null($place)) return array(null, 'Trop de requêtes en cours depuis votre poste : réessayez dans un instant.');
	$v = verrou('copie_'.basename($copie));
	$r = lit_ontologie_store($jeu, $copie);
	libere($v);
	libere($place);
	return $r;
}

//------------------------------------------------------------------------------
// Mise à jour : de l'état courant au brouillon de l'étudiant
//------------------------------------------------------------------------------

function onto_iri_valide($iri) {
	return is_string($iri) && strlen($iri) <= 500 && preg_match('/^[A-Za-z][A-Za-z0-9+.-]*:[^\s<>"{}|\\\\^`]+$/D', $iri) === 1;
}

function onto_iri($iri) { return '<'.$iri.'>'; }

function onto_litteral($texte, $langue) {
	$t = '"'.strtr($texte, array('\\' => '\\\\', '"' => '\\"', "\n" => '\\n', "\r" => '\\r', "\t" => '\\t')).'"';
	return $langue !== '' ? $t.'@'.$langue : $t;
}

function onto_langue_valide($l) { return is_string($l) && ($l === '' || preg_match('/^[A-Za-z]{1,8}(-[A-Za-z0-9]{1,8})*$/D', $l) === 1); }

// Contrôle du brouillon reçu (tableau décodé du JSON) ; renvoie array(brouillon nettoyé, message d'erreur|null)
function onto_nettoie_brouillon($b) {
	if (!is_array($b)) return array(null, 'Brouillon illisible.');
	$sortie = array('classes' => array(), 'props' => array(), 'supprimes' => array('classes' => array(), 'props' => array()));
	foreach (array('classes', 'props') as $k) {
		$liste = $b[$k] ?? array();
		if (!is_array($liste) || count($liste) > ONTO_ELEMENTS_MAX) return array(null, 'Trop d\'éléments ('.ONTO_ELEMENTS_MAX.' au plus).');
		foreach ($liste as $e) {
			if (!is_array($e) || !onto_iri_valide($e['iri'] ?? null)) return array(null, 'IRI invalide dans le brouillon.');
			$o = array('iri' => $e['iri']);
			foreach (array('label' => ONTO_LIBELLE_MAX, 'comment' => ONTO_COMMENTAIRE_MAX) as $c => $max) {
				$t = $e[$c] ?? '';
				if (!is_string($t) || mb_strlen($t) > $max || !mb_check_encoding($t, 'UTF-8')) return array(null, "Texte « $c » invalide ou trop long.");
				$o[$c] = trim($t);
			}
			foreach (array('llang', 'clang') as $c) {
				$l = $e[$c] ?? '';
				if (!onto_langue_valide($l)) return array(null, 'Langue invalide.');
				$o[$c] = $l;
			}
			foreach (array('domain', 'range') as $c) {
				$v = $e[$c] ?? '';
				if ($v !== '' && !onto_iri_valide($v)) return array(null, 'IRI invalide dans le brouillon.');
				$o[$c] = (string)$v;
			}
			$ps = $e['parents'] ?? array();
			if (!is_array($ps) || count($ps) > 30) return array(null, 'Trop de super-classes.');
			$o['parents'] = array();
			foreach ($ps as $v) {
				if (!onto_iri_valide($v)) return array(null, 'IRI invalide dans le brouillon.');
				$o['parents'][$v] = $v;
			}
			$o['parents'] = array_values($o['parents']);
			foreach (onto_relations()[$k] as $cle => $_d) {
				$vs = $e[$cle] ?? array();
				if (!is_array($vs) || count($vs) > 30) return array(null, 'Trop de valeurs pour « '.$cle.' ».');
				$o[$cle] = array();
				foreach ($vs as $v) {
					if (!onto_iri_valide($v)) return array(null, 'IRI invalide dans le brouillon.');
					$o[$cle][$v] = $v;
				}
				$o[$cle] = array_values($o[$cle]);
			}
			if ($k === 'props') {
				$cs = $e['carac'] ?? array();
				if (!is_array($cs)) return array(null, 'Caractéristiques invalides.');
				$o['carac'] = array();
				foreach ($cs as $c) {
					if (!is_string($c) || !isset(onto_caracteristiques()[$c])) return array(null, 'Caractéristique OWL inconnue.');
					$o['carac'][$c] = $c;
				}
				$o['carac'] = array_values($o['carac']);
				$g = $e['genre'] ?? '';
				if (!is_string($g) || ($g !== '' && !isset(onto_genres()[$g]))) return array(null, 'Genre de propriété inconnu.');
				$o['genre'] = $g;
				foreach (array('min', 'max') as $c) {
					$v = $e[$c] ?? '';
					if (is_int($v)) $v = (string)$v;
					if (!is_string($v) || !preg_match('/^\d{0,4}$/D', $v) || (int)$v > ONTO_CARDINALITE_MAX) return array(null, 'Cardinalité invalide (un entier de 0 à '.ONTO_CARDINALITE_MAX.').');
					$o[$c] = $v === '' ? '' : (string)(int)$v;
				}
				if ($o['min'] !== '' && $o['max'] !== '' && (int)$o['min'] > (int)$o['max']) return array(null, 'La cardinalité minimale ne peut pas dépasser la maximale.');
			}
			$sortie[$k][$o['iri']] = $o;
		}
		$sup = $b['supprimes'][$k] ?? array();
		if (!is_array($sup) || count($sup) > ONTO_ELEMENTS_MAX) return array(null, 'Trop de suppressions.');
		foreach ($sup as $iri) {
			if (!onto_iri_valide($iri)) return array(null, 'IRI invalide dans les suppressions.');
			$sortie['supprimes'][$k][$iri] = true;
		}
	}
	return array($sortie, null);
}

// Remplacement d'une valeur à un seul exemplaire (domaine, portée, libellé…) :
// ajoute les triplets à retirer dans $moins et ceux à ajouter dans $plus
function onto_remplace(&$moins, &$plus, $s, $p, $ancien, $nouveau) {
	if ($ancien === $nouveau) return;
	if ($ancien !== '') $moins[] = "$s $p $ancien .";
	if ($nouveau !== '') $plus[] = "$s $p $nouveau .";
}

// Mise à jour SPARQL qui amène le modèle $courant (modele_ontologie()) au brouillon $b
// (onto_nettoie_brouillon()). Renvoie array(texte de la mise à jour ('' s'il n'y a rien à faire), nombre de changements).
function onto_mise_a_jour(array $courant, array $b) {
	$RDF = PREFIXES_STANDARD['rdf']; $RDFS = PREFIXES_STANDARD['rdfs'];
	$type = onto_iri($RDF.'type'); $label = onto_iri($RDFS.'label'); $comment = onto_iri($RDFS.'comment');
	$sous = onto_iri($RDFS.'subClassOf'); $domain = onto_iri($RDFS.'domain'); $range = onto_iri($RDFS.'range');
	$parIri = function (array $liste) { $m = array(); foreach ($liste as $e) $m[$e['iri']] = $e; return $m; };
	$cc = $parIri($courant['classes']); $cp = $parIri($courant['props']);
	$moins = array(); $plus = array(); $suppr = array(); $n = 0;
	$moinsG = array(); $plusG = array();   // cardinalités, dans le graphe nommé des contraintes
	$iriSi = function ($v) { return $v === '' ? '' : onto_iri($v); };
	$texte = function ($t, $l) { return $t === '' ? '' : onto_litteral($t, $l); };

	foreach ($b['supprimes']['classes'] as $iri => $_) if (isset($cc[$iri])) { $suppr[] = "DELETE WHERE { ".onto_iri($iri)." ?p ?o }"; $n++; }
	foreach ($b['supprimes']['props'] as $iri => $_) if (isset($cp[$iri])) {
		$suppr[] = "DELETE WHERE { ".onto_iri($iri)." ?p ?o }";
		$suppr[] = "DELETE WHERE { GRAPH <".ONTO_GRAPHE_CONTRAINTES."> { ".onto_iri($iri)." ?c ?n } }";   // sa cardinalité part avec elle
		$n++;
	}

	foreach (array('classes' => $cc, 'props' => $cp) as $k => $existants) {
		foreach ($b[$k] as $iri => $e) {
			if (isset($b['supprimes'][$k][$iri])) continue;
			$s = onto_iri($iri);
			$o = $existants[$iri] ?? null;
			$avant = count($moins) + count($plus) + count($moinsG) + count($plusG);
			if (is_null($o)) { // nouvel élément
				$plus[] = $s.' '.$type.' '.onto_iri($k === 'classes' ? $RDFS.'Class' : $RDF.'Property').' .';
				$o = onto_vide($k);
				if ($e['label'] !== '' && $e['llang'] === '') $e['llang'] = ONTO_LANGUE_DEFAUT;
				if ($e['comment'] !== '' && $e['clang'] === '') $e['clang'] = ONTO_LANGUE_DEFAUT;
			}
			// le libellé garde sa langue d'origine ; s'il change seul de langue, c'est un remplacement
			onto_remplace($moins, $plus, $s, $label, $texte($o['label'], $o['llang']), $texte($e['label'], $e['llang'] !== '' || $o['label'] === '' ? $e['llang'] : $o['llang']));
			onto_remplace($moins, $plus, $s, $comment, $texte($o['comment'], $o['clang']), $texte($e['comment'], $e['clang'] !== '' || $o['comment'] === '' ? $e['clang'] : $o['clang']));
			if ($k === 'classes') {
				// super-classes : on retire celles qui ont disparu, on ajoute les nouvelles (les autres ne bougent pas)
				foreach (array_diff($o['parents'], $e['parents']) as $v) $moins[] = "$s $sous ".onto_iri($v)." .";
				foreach (array_diff($e['parents'], $o['parents']) as $v) $plus[] = "$s $sous ".onto_iri($v)." .";
			} else {
				onto_remplace($moins, $plus, $s, $domain, $iriSi($o['domain']), $iriSi($e['domain']));
				onto_remplace($moins, $plus, $s, $range, $iriSi($o['range']), $iriSi($e['range']));
				$cs = onto_caracteristiques();
				foreach (array_diff($o['carac'], $e['carac']) as $c) $moins[] = "$s $type ".onto_iri($cs[$c][0])." .";
				foreach (array_diff($e['carac'], $o['carac']) as $c) $plus[] = "$s $type ".onto_iri($cs[$c][0])." .";
				// cardinalité SHACL voulue : une valeur par borne, dans le graphe des contraintes
				$entier = function ($v) { return '"'.$v.'"^^<'.PREFIXES_STANDARD['xsd'].'integer>'; };
				foreach (array('min' => 'minCount', 'max' => 'maxCount') as $c => $pred) {
					if ($o[$c] === $e[$c]) continue;
					$pg = onto_iri('http://www.w3.org/ns/shacl#'.$pred);
					if ($o[$c] !== '') $moinsG[] = "$s $pg ".$entier($o[$c])." .";
					if ($e[$c] !== '') $plusG[] = "$s $pg ".$entier($e[$c])." .";
				}
				$gs = onto_genres();
				if ($o['genre'] !== $e['genre']) {
					if ($o['genre'] !== '') $moins[] = "$s $type ".onto_iri($gs[$o['genre']])." .";
					if ($e['genre'] !== '') $plus[] = "$s $type ".onto_iri($gs[$e['genre']])." .";
				}
			}
			foreach (onto_relations()[$k] as $cle => $d) {   // relations et annotations : seulement ce qui a changé
				foreach (array_diff($o[$cle], $e[$cle]) as $v) $moins[] = "$s ".onto_iri($d[0])." ".onto_iri($v)." .";
				foreach (array_diff($e[$cle], $o[$cle]) as $v) $plus[] = "$s ".onto_iri($d[0])." ".onto_iri($v)." .";
			}
			if (count($moins) + count($plus) + count($moinsG) + count($plusG) > $avant) $n++;
		}
	}
	$ops = array();
	$g = '<'.ONTO_GRAPHE_CONTRAINTES.'>';
	if ($moins) $ops[] = "DELETE DATA {\n  ".implode("\n  ", $moins)."\n}";
	if ($moinsG) $ops[] = "DELETE DATA {\n  GRAPH $g {\n    ".implode("\n    ", $moinsG)."\n  }\n}";
	if ($plus) $ops[] = "INSERT DATA {\n  ".implode("\n  ", $plus)."\n}";
	if ($plusG) $ops[] = "INSERT DATA {\n  GRAPH $g {\n    ".implode("\n    ", $plusG)."\n  }\n}";
	$ops = array_merge($ops, $suppr);
	return array(implode(" ;\n", $ops), $n);
}

// Applique le brouillon (ontologie et instances) à la copie de session, en une seule mise à jour :
// tout ou rien. Renvoie array(ok, HTML du message, modèle de l'ontologie à jour|null, IRI des instances ajoutées ou modifiées)
function enregistre_ontologie($jeu, $brouillon) {
	$ko = function ($m) { return array(false, "<p class='statut ko'>❌ ".html($m)."</p>", null, array()); };
	list($b, $erreur) = onto_nettoie_brouillon($brouillon);
	if (is_null($b)) return $ko($erreur);
	$prefixes = array_merge(PREFIXES_STANDARD, prefixes_jeu($jeu));
	list($bi, $erreur) = inst_nettoie($brouillon['instances'] ?? array(), $prefixes);
	if (is_null($bi)) return $ko($erreur);
	list($courant, $erreur) = modele_ontologie($jeu);
	if (is_null($courant)) return $ko($erreur);
	list($maj, $n) = onto_mise_a_jour($courant, $b);
	list($majI, $nb, $erreur, $sujets) = inst_mise_a_jour($jeu, $bi, $prefixes);
	if (!is_null($erreur)) return $ko($erreur);
	$tout = implode(" ;\n", array_filter(array($maj, $majI), 'strlen'));
	if ($tout === '') return array(true, "<p class='statut ok'>Rien à enregistrer : votre copie est déjà à jour.</p>", $courant, array());
	$r = execute_sparql($jeu, $tout);
	if (!$r['ok']) return array(false, affiche_resultat($r, array()), null, array());
	if ($bi['ia'] && isset($_SESSION['peuplement'][$jeu])) { // propositions de l'IA acceptées : retirées de la liste
		foreach ($bi['ia']['indices'] as $k) unset($_SESSION['peuplement'][$jeu]['propositions'][$k]);
	}
	list($nouveau, $erreur) = modele_ontologie($jeu);
	$parts = array();
	if ($n) $parts[] = "$n élément".($n > 1 ? 's' : '')." de l'ontologie";
	$ajout = $nb['nouvelles'] + $nb['ia'];
	if ($ajout) $parts[] = "$ajout instance".($ajout > 1 ? 's' : '')." ajoutée".($ajout > 1 ? 's' : '');
	if ($nb['modifiees']) $parts[] = $nb['modifiees']." instance".($nb['modifiees'] > 1 ? 's' : '')." modifiée".($nb['modifiees'] > 1 ? 's' : '');
	if ($nb['supprimees']) $parts[] = $nb['supprimees']." instance".($nb['supprimees'] > 1 ? 's' : '')." supprimée".($nb['supprimees'] > 1 ? 's' : '');
	return array(true, "<p class='statut ok'>✅ Enregistré : ".implode(', ', $parts).".</p>".affiche_corps($r, prefixes_jeu($jeu)), $nouveau, $sujets);
}

// Ontologie « effective » : le modèle courant avec le brouillon appliqué (éléments ajoutés,
// modifiés, supprimés), sans rien enregistrer. Sert à demander à l'IA des données qui
// correspondent à ce que l'étudiant est en train de construire. $prefixes abrège les nouveaux IRI.
function onto_applique_brouillon(array $courant, array $b, array $prefixes) {
	foreach (array('classes', 'props') as $k) {
		$m = array();
		foreach ($courant[$k] as $e) $m[$e['iri']] = $e;
		foreach ($b['supprimes'][$k] as $iri => $_) unset($m[$iri]);
		$champs = array_merge(array('label', 'llang', 'comment', 'clang'), $k === 'classes' ? array('parents') : array('domain', 'range', 'carac', 'genre', 'min', 'max'), array_keys(onto_relations()[$k]));
		foreach ($b[$k] as $iri => $e) {
			if (isset($b['supprimes'][$k][$iri])) continue;
			$o = $m[$iri] ?? array_merge(array('iri' => $iri, 'nom' => abrege_iri($iri, $prefixes)), onto_vide($k), $k === 'classes' ? array('n' => 0, 'decl' => true) : array());
			foreach ($champs as $c) if (array_key_exists($c, $o) && array_key_exists($c, $e)) $o[$c] = $e[$c];
			$m[$iri] = $o;
		}
		$courant[$k] = array_values($m);
	}
	return $courant;
}
