<?php
// Diagramme du vocabulaire d'une copie de session : classes, sous-classes, propriétés.
// Il réunit ce que l'ontologie DÉCLARE (rdfs:subClassOf, rdfs:domain, rdfs:range) et ce que
// les données MONTRENT (classe du sujet et classe, ou type de donnée, de l'objet).
// Le dessin est fait côté navigateur (js/vocabulaire.js) à partir du modèle JSON construit ici.

// Ressource sans classe connue : extrémité d'un lien dont la classe est inconnue
const VOC_RESSOURCE = 'http://www.w3.org/2000/01/rdf-schema#Resource';
// Nombre maximal de lignes lues par requête
const VOC_LIGNES_MAX = 2000;

// Vocabulaire du langage lui-même (rdfs:Class, rdf:Property, owl:…) : pas un nœud du diagramme
function voc_est_meta($iri) {
	foreach (array('rdf', 'rdfs', 'owl') as $p)
		if (strpos($iri, PREFIXES_STANDARD[$p]) === 0) return true;
	return false;
}

// Valeur littérale (type de donnée) plutôt que ressource : devient un attribut de classe
function voc_est_litteral($iri) {
	return strpos($iri, PREFIXES_STANDARD['xsd']) === 0
		|| in_array($iri, array(PREFIXES_STANDARD['rdfs'].'Literal', PREFIXES_STANDARD['rdf'].'langString',
			PREFIXES_STANDARD['rdf'].'PlainLiteral', PREFIXES_STANDARD['rdf'].'XMLLiteral', PREFIXES_STANDARD['rdf'].'HTML'), true);
}

// Construit le modèle du diagramme. Les entrées sont des listes de lignes déjà lues :
//   $classes   [c, sup|null]            classes déclarées et leurs super-classes
//   $instances [c => nombre]            instances par classe
//   $props     [p, dom|null, ran|null]  rdfs:domain / rdfs:range (une des deux par ligne)
//   $obs_obj   [c, p, d|null, n]        liens observés vers une ressource (d : sa classe)
//   $obs_lit   [c, p, type, n]          valeurs littérales observées
// Renvoie array('classes' => [...], 'sous' => [...], 'liens' => [...])
function construit_vocabulaire(array $classes, array $instances, array $props, array $obs_obj, array $obs_lit, array $prefixes) {
	$noeuds = array();   // iri => array('n' => instances, 'decl' => bool)
	$sous = array();     // "sous|super" => array(sous, super)
	$attrs = array();    // "classe|prop|type" => ...
	$liens = array();    // "de|prop|vers" => ...
	$ajoute = function ($iri, $decl) use (&$noeuds, $instances) {
		if (!isset($noeuds[$iri])) $noeuds[$iri] = array('n' => (int)($instances[$iri] ?? 0), 'decl' => false);
		if ($decl) $noeuds[$iri]['decl'] = true;
	};
	$attr = function ($c, $p, $type, $n, $decl) use (&$attrs) {
		$k = "$c|$p|$type";
		if (!isset($attrs[$k])) $attrs[$k] = array('c' => $c, 'p' => $p, 'type' => $type, 'n' => 0, 'decl' => false);
		$attrs[$k]['n'] += $n;
		if ($decl) $attrs[$k]['decl'] = true;
	};
	$lien = function ($de, $p, $vers, $n, $decl) use (&$liens) {
		$k = "$de|$p|$vers";
		if (!isset($liens[$k])) $liens[$k] = array('de' => $de, 'p' => $p, 'vers' => $vers, 'n' => 0, 'decl' => false);
		$liens[$k]['n'] += $n;
		if ($decl) $liens[$k]['decl'] = true;
	};

	foreach ($classes as $l) {
		if (voc_est_meta($l[0])) continue;
		$ajoute($l[0], true);
		if (!is_null($l[1]) && !voc_est_meta($l[1]) && $l[1] !== $l[0]) {
			$ajoute($l[1], true);
			$sous[$l[0].'|'.$l[1]] = array($l[0], $l[1]);
		}
	}

	// Propriétés observées : elles priment sur une déclaration incomplète (domaine ou portée absents)
	$observees = array();
	foreach ($obs_obj as $l) $observees[$l[1]] = true;
	foreach ($obs_lit as $l) $observees[$l[1]] = true;

	// Déclarations : une ligne par domaine ou par portée ; on les croise par propriété
	$decl = array();
	foreach ($props as $l) {
		if (!is_null($l[1])) $decl[$l[0]]['dom'][$l[1]] = true;
		if (!is_null($l[2])) $decl[$l[0]]['ran'][$l[2]] = true;
	}
	foreach ($decl as $p => $d) {
		$doms = array_keys($d['dom'] ?? array());
		$rans = array_keys($d['ran'] ?? array());
		$litt = array_values(array_filter($rans, 'voc_est_litteral'));
		$res = array_values(array_filter($rans, function ($r) { return !voc_est_litteral($r); }));
		if (!$doms) {
			if (isset($observees[$p])) continue;
			$doms = array(VOC_RESSOURCE);
		}
		foreach ($doms as $dom) {
			if (voc_est_meta($dom)) continue;
			foreach ($litt as $t) $attr($dom, $p, $t, 0, true);
			if (!$rans) continue;
			foreach ($res as $ran) {
				if (voc_est_meta($ran)) continue;
				$lien($dom, $p, $ran, 0, true);
			}
		}
	}

	foreach ($obs_obj as $l) {
		if (voc_est_meta($l[0])) continue;
		$vers = (is_null($l[2]) || voc_est_meta($l[2])) ? VOC_RESSOURCE : $l[2];
		$lien($l[0], $l[1], $vers, (int)$l[3], false);
	}
	foreach ($obs_lit as $l) {
		if (voc_est_meta($l[0])) continue;
		$attr($l[0], $l[1], $l[2], (int)$l[3], false);
	}

	// rdfs:Literal déclaré, mais le type précis est observé : on ne garde que ce dernier
	foreach ($attrs as $k => $a) {
		if (!$a['decl'] || $a['n'] > 0 || $a['type'] !== PREFIXES_STANDARD['rdfs'].'Literal') continue;
		foreach ($attrs as $b) if ($b['c'] === $a['c'] && $b['p'] === $a['p'] && $b['n'] > 0) { unset($attrs[$k]); break; }
	}

	// Nœuds : tout ce qui est cité ; « n » des classes observées vient de $instances
	foreach ($instances as $c => $n) if (!voc_est_meta($c)) $ajoute($c, false);
	foreach ($liens as $l) { $ajoute($l['de'], false); $ajoute($l['vers'], false); }
	foreach ($attrs as $a) $ajoute($a['c'], false);
	if (isset($noeuds[VOC_RESSOURCE])) $noeuds[VOC_RESSOURCE]['n'] = 0;

	$nom = function ($iri) use ($prefixes) { return abrege_iri($iri, $prefixes); };
	$sortie = array('classes' => array(), 'sous' => array(), 'liens' => array());
	ksort($noeuds);
	foreach ($noeuds as $iri => $c) {
		$a = array_filter($attrs, function ($x) use ($iri) { return $x['c'] === $iri; });
		$liste = array();
		foreach ($a as $x) $liste[] = array('iri' => $x['p'], 'nom' => $nom($x['p']), 'type' => $nom($x['type']),
			'n' => $x['n'], 'decl' => $x['decl']);
		usort($liste, function ($x, $y) { return strcmp($x['nom'], $y['nom']) ?: strcmp($x['type'], $y['type']); });
		$sortie['classes'][] = array('iri' => $iri, 'nom' => $nom($iri), 'n' => $c['n'], 'decl' => $c['decl'], 'attributs' => $liste);
	}
	foreach ($sous as $s) $sortie['sous'][] = array('de' => $s[0], 'vers' => $s[1]);
	foreach ($liens as $l) $sortie['liens'][] = array('de' => $l['de'], 'vers' => $l['vers'], 'iri' => $l['p'],
		'nom' => $nom($l['p']), 'n' => $l['n'], 'decl' => $l['decl']);
	usort($sortie['liens'], function ($x, $y) { return strcmp($x['nom'], $y['nom']); });
	return $sortie;
}

// Valeurs d'une ligne de résultats JSON : iri, ou null si la variable n'est pas liée
function voc_valeur($ligne, $var) {
	return isset($ligne[$var]['value']) ? $ligne[$var]['value'] : null;
}

// Modèle du vocabulaire de la copie de session du jeu ; renvoie array(modèle|null, message d'erreur)
function vocabulaire_jeu($jeu) {
	$copie = store_copie($jeu, $erreur);
	if (is_null($copie)) return array(null, $erreur);
	$place = reserve_execution();
	if (is_null($place)) return array(null, 'Trop de requêtes en cours depuis votre poste : réessayez dans un instant.');
	$v = verrou('copie_'.basename($copie));
	$pre = 'PREFIX rdf: <'.PREFIXES_STANDARD['rdf'].'> PREFIX rdfs: <'.PREFIXES_STANDARD['rdfs'].'> '
		.'PREFIX owl: <'.PREFIXES_STANDARD['owl'].'> ';
	$lim = ' LIMIT '.VOC_LIGNES_MAX;
	$requetes = array(
		'classes' => 'SELECT ?c ?sup WHERE { { ?c a ?t . VALUES ?t { rdfs:Class owl:Class } '
			.'OPTIONAL { ?c rdfs:subClassOf ?sup . FILTER(isIRI(?sup)) } } '
			.'UNION { ?c rdfs:subClassOf ?sup . FILTER(isIRI(?sup)) } FILTER(isIRI(?c)) }'.$lim,
		'instances' => 'SELECT ?c (COUNT(DISTINCT ?s) AS ?n) WHERE { ?s a ?c . FILTER(isIRI(?c)) } GROUP BY ?c'.$lim,
		'props' => 'SELECT ?p ?dom ?ran WHERE { { ?p rdfs:domain ?dom . FILTER(isIRI(?dom)) } '
			.'UNION { ?p rdfs:range ?ran . FILTER(isIRI(?ran)) } FILTER(isIRI(?p)) }'.$lim,
		'obs_obj' => 'SELECT ?c ?p ?d (COUNT(*) AS ?n) WHERE { ?s ?p ?o . ?s a ?c . '
			.'FILTER(?p != rdf:type && isIRI(?c) && (isIRI(?o) || isBlank(?o))) '
			.'OPTIONAL { ?o a ?d . FILTER(isIRI(?d)) } } GROUP BY ?c ?p ?d'.$lim,
		'obs_lit' => 'SELECT ?c ?p ?t (COUNT(*) AS ?n) WHERE { ?s ?p ?o . ?s a ?c . '
			.'FILTER(isIRI(?c) && isLiteral(?o)) BIND(datatype(?o) AS ?t) } GROUP BY ?c ?p ?t'.$lim,
	);
	$lignes = array();
	$echec = null;
	foreach ($requetes as $cle => $q) {
		$r = lance_oxigraph(array('query', '--location', $copie, '--results-format', 'json'), $pre.$q);
		$j = $r['code'] === 0 ? json_decode($r['sortie'], true) : null;
		if (!is_array($j)) {
			$echec = $r['delai'] ? 'La lecture du vocabulaire a pris trop de temps.' : ($r['erreur'] !== '' ? message_oxigraph($r['erreur']) : 'Lecture impossible.');
			break;
		}
		$lignes[$cle] = $j['results']['bindings'] ?? array();
	}
	libere($v);
	libere($place);
	if (!is_null($echec)) return array(null, $echec);

	$classes = array_map(function ($l) { return array(voc_valeur($l, 'c'), voc_valeur($l, 'sup')); }, $lignes['classes']);
	$instances = array();
	foreach ($lignes['instances'] as $l) $instances[voc_valeur($l, 'c')] = (int)voc_valeur($l, 'n');
	$props = array_map(function ($l) { return array(voc_valeur($l, 'p'), voc_valeur($l, 'dom'), voc_valeur($l, 'ran')); }, $lignes['props']);
	$obs_obj = array_map(function ($l) { return array(voc_valeur($l, 'c'), voc_valeur($l, 'p'), voc_valeur($l, 'd'), voc_valeur($l, 'n')); }, $lignes['obs_obj']);
	$obs_lit = array_map(function ($l) { return array(voc_valeur($l, 'c'), voc_valeur($l, 'p'), voc_valeur($l, 't'), voc_valeur($l, 'n')); }, $lignes['obs_lit']);
	$prefixes = array_merge(PREFIXES_STANDARD, prefixes_jeu($jeu));
	return array(construit_vocabulaire($classes, $instances, $props, $obs_obj, $obs_lit, $prefixes), '');
}
