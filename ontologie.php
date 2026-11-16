<?php
// Éditeur d'ontologie : modèle modifiable de l'ontologie d'une copie de session, et mise à jour
// SPARQL qui applique les changements faits par l'étudiant (page editeur.php, js/editeur.js).
//
// Le modèle ne garde que ce que l'éditeur sait modifier :
//   classes : iri, nom, label (+ langue), comment (+ langue), parent (une super-classe), n (instances)
//   props   : iri, nom, label (+ langue), domain, range (une seule valeur chacun), decl
// Les autres déclarations (plusieurs domaines, annotations…) ne sont jamais touchées : la mise à
// jour n'efface que les triplets que l'éditeur a lus, un par un (DELETE DATA), jamais en bloc,
// sauf pour la suppression d'un élément (toutes ses déclarations, pas ses instances).

const ONTO_LIGNES_MAX = 3000;
const ONTO_ELEMENTS_MAX = 400;
const ONTO_LIBELLE_MAX = 200;
const ONTO_COMMENTAIRE_MAX = 1000;
const ONTO_LANGUE_DEFAUT = 'fr';
const ONTO_ESPACE_DEFAUT = 'http://example.org/ontologie#';

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
function construit_modele_ontologie(array $classes, array $parents, array $props, array $instances, array $labels, array $comments, array $prefixes) {
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
	$textes = function (array $lignes) {
		$t = array();
		foreach ($lignes as $l) $t[$l[0]][] = array($l[1], $l[2]);
		return $t;
	};
	$labels = $textes($labels);
	$comments = $textes($comments);
	$nom = function ($iri) use ($prefixes) { return abrege_iri($iri, $prefixes); };

	ksort($cl);
	$sortie = array('classes' => array(), 'props' => array(), 'types' => array(), 'espace' => '');
	foreach ($cl as $iri => $decl) {
		$p = isset($sup[$iri]) ? array_keys($sup[$iri]) : array();
		sort($p);
		list($label, $ll) = onto_choisit_litteral($labels[$iri] ?? array());
		list($comment, $cl_) = onto_choisit_litteral($comments[$iri] ?? array());
		$sortie['classes'][] = array('iri' => $iri, 'nom' => $nom($iri), 'label' => $label, 'llang' => $ll,
			'comment' => $comment, 'clang' => $cl_, 'parent' => $p ? $p[0] : '', 'n' => (int)($instances[$iri] ?? 0), 'decl' => $decl);
	}
	ksort($pr);
	foreach ($pr as $iri => $d) {
		$dom = array_keys($d['dom']); sort($dom);
		$ran = array_keys($d['ran']); sort($ran);
		list($label, $ll) = onto_choisit_litteral($labels[$iri] ?? array());
		$sortie['props'][] = array('iri' => $iri, 'nom' => $nom($iri), 'label' => $label, 'llang' => $ll,
			'domain' => $dom ? $dom[0] : '', 'range' => $ran ? $ran[0] : '');
	}
	foreach (onto_types() as $t) $sortie['types'][] = array('iri' => $t, 'nom' => $nom($t));
	$sortie['espace'] = onto_espace(array_merge(array_keys($cl), array_keys($pr)));
	return $sortie;
}

// Lit le modèle de l'ontologie de la copie de session ; renvoie array(modèle|null, message d'erreur)
function modele_ontologie($jeu) {
	$copie = store_copie($jeu, $erreur);
	if (is_null($copie)) return array(null, $erreur);
	$place = reserve_execution();
	if (is_null($place)) return array(null, 'Trop de requêtes en cours depuis votre poste : réessayez dans un instant.');
	$v = verrou('copie_'.basename($copie));
	$pre = 'PREFIX rdf: <'.PREFIXES_STANDARD['rdf'].'> PREFIX rdfs: <'.PREFIXES_STANDARD['rdfs'].'> '
		.'PREFIX owl: <'.PREFIXES_STANDARD['owl'].'> ';
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
	);
	$lignes = array();
	$echec = null;
	foreach ($requetes as $cle => $q) {
		$r = lance_oxigraph(array('query', '--location', $copie, '--results-format', 'json'), $pre.$q);
		$j = $r['code'] === 0 ? json_decode($r['sortie'], true) : null;
		if (!is_array($j)) {
			$echec = $r['delai'] ? "La lecture de l'ontologie a pris trop de temps." : ($r['erreur'] !== '' ? message_oxigraph($r['erreur']) : 'Lecture impossible.');
			break;
		}
		$lignes[$cle] = $j['results']['bindings'] ?? array();
	}
	libere($v);
	libere($place);
	if (!is_null($echec)) return array(null, $echec);
	$val = 'voc_valeur';
	$instances = array();
	foreach ($lignes['instances'] as $l) $instances[$val($l, 'c')] = (int)$val($l, 'n');
	$textes = function ($ls) use ($val) { return array_map(function ($l) use ($val) { return array($val($l, 'x'), (string)$val($l, 'l'), (string)$val($l, 'g')); }, $ls); };
	$prefixes = array_merge(PREFIXES_STANDARD, prefixes_jeu($jeu));
	return array(construit_modele_ontologie(
		array_map(function ($l) use ($val) { return $val($l, 'c'); }, $lignes['classes']),
		array_map(function ($l) use ($val) { return array($val($l, 'c'), $val($l, 'sup')); }, $lignes['parents']),
		array_map(function ($l) use ($val) { return array($val($l, 'p'), $val($l, 'dom'), $val($l, 'ran')); }, $lignes['props']),
		$instances, $textes($lignes['labels']), $textes($lignes['comments']), $prefixes), '');
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
			foreach (array('parent', 'domain', 'range') as $c) {
				$v = $e[$c] ?? '';
				if ($v !== '' && !onto_iri_valide($v)) return array(null, 'IRI invalide dans le brouillon.');
				$o[$c] = (string)$v;
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

// Remplacement d'une valeur à un seul exemplaire (parent, domaine, portée, libellé…) :
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
	$iriSi = function ($v) { return $v === '' ? '' : onto_iri($v); };
	$texte = function ($t, $l) { return $t === '' ? '' : onto_litteral($t, $l); };

	foreach ($b['supprimes']['classes'] as $iri => $_) if (isset($cc[$iri])) { $suppr[] = "DELETE WHERE { ".onto_iri($iri)." ?p ?o }"; $n++; }
	foreach ($b['supprimes']['props'] as $iri => $_) if (isset($cp[$iri])) { $suppr[] = "DELETE WHERE { ".onto_iri($iri)." ?p ?o }"; $n++; }

	foreach (array('classes' => $cc, 'props' => $cp) as $k => $existants) {
		foreach ($b[$k] as $iri => $e) {
			if (isset($b['supprimes'][$k][$iri])) continue;
			$s = onto_iri($iri);
			$o = $existants[$iri] ?? null;
			$avant = count($moins) + count($plus);
			if (is_null($o)) { // nouvel élément
				$plus[] = $s.' '.$type.' '.onto_iri($k === 'classes' ? $RDFS.'Class' : $RDF.'Property').' .';
				$o = array('label' => '', 'llang' => '', 'comment' => '', 'clang' => '', 'parent' => '', 'domain' => '', 'range' => '');
				if ($e['label'] !== '' && $e['llang'] === '') $e['llang'] = ONTO_LANGUE_DEFAUT;
				if ($e['comment'] !== '' && $e['clang'] === '') $e['clang'] = ONTO_LANGUE_DEFAUT;
			}
			// le libellé garde sa langue d'origine ; s'il change seul de langue, c'est un remplacement
			onto_remplace($moins, $plus, $s, $label, $texte($o['label'], $o['llang']), $texte($e['label'], $e['llang'] !== '' || $o['label'] === '' ? $e['llang'] : $o['llang']));
			if ($k === 'classes') {
				onto_remplace($moins, $plus, $s, $comment, $texte($o['comment'], $o['clang']), $texte($e['comment'], $e['clang'] !== '' || $o['comment'] === '' ? $e['clang'] : $o['clang']));
				onto_remplace($moins, $plus, $s, $sous, $iriSi($o['parent']), $iriSi($e['parent']));
			} else {
				onto_remplace($moins, $plus, $s, $domain, $iriSi($o['domain']), $iriSi($e['domain']));
				onto_remplace($moins, $plus, $s, $range, $iriSi($o['range']), $iriSi($e['range']));
			}
			if (count($moins) + count($plus) > $avant) $n++;
		}
	}
	$ops = array();
	if ($moins) $ops[] = "DELETE DATA {\n  ".implode("\n  ", $moins)."\n}";
	if ($plus) $ops[] = "INSERT DATA {\n  ".implode("\n  ", $plus)."\n}";
	$ops = array_merge($ops, $suppr);
	return array(implode(" ;\n", $ops), $n);
}

// Applique le brouillon à la copie de session ; renvoie array(ok, HTML du message, modèle à jour|null)
function enregistre_ontologie($jeu, $brouillon) {
	list($b, $erreur) = onto_nettoie_brouillon($brouillon);
	if (is_null($b)) return array(false, "<p class='statut ko'>❌ ".html($erreur)."</p>", null);
	list($courant, $erreur) = modele_ontologie($jeu);
	if (is_null($courant)) return array(false, "<p class='statut ko'>❌ ".html($erreur)."</p>", null);
	list($maj, $n) = onto_mise_a_jour($courant, $b);
	if ($maj === '') return array(true, "<p class='statut ok'>Rien à enregistrer : l'ontologie est déjà à jour.</p>", $courant);
	$r = execute_sparql($jeu, $maj);
	if (!$r['ok']) return array(false, affiche_resultat($r, array()), null);
	list($nouveau, $erreur) = modele_ontologie($jeu);
	return array(true, "<p class='statut ok'>✅ $n élément".($n > 1 ? 's' : '')." de l'ontologie enregistré".($n > 1 ? 's' : '').".</p>"
		.affiche_corps($r, prefixes_jeu($jeu)), $nouveau);
}
