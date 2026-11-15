<?php
//============================================================================
// Cohérence d'une base de connaissances (store Oxigraph), vérifiée au chargement d'un jeu
// de données et après chaque mise à jour d'un étudiant. Une incohérence n'empêche rien :
// elle est signalée (RDF est en monde ouvert ; c'est un outil pour apprendre).
//
// 1. Contrôles RDFS, pour tous les jeux : l'ontologie du jeu est lue comme un ensemble de
//    contraintes en monde fermé.
//    - classe ou propriété utilisée dans l'espace de noms de l'ontologie sans y être déclarée ;
//    - rdfs:domain : le sujet doit être du type indiqué (sous-classes comprises) ;
//    - rdfs:range : l'objet doit être du type indiqué, ou un littéral du bon type de données ;
//    - littéral mal formé pour son type ("abc"^^xsd:integer, "2026-13-45"^^xsd:date).
// 2. Formes SHACL, pour les jeux qui en fournissent (<formes nom="…"/> dans leur config.xml),
//    validées par pyshacl s'il est installé (pip install pyshacl).
//============================================================================

define('ANOMALIES_MAX', 50);           // anomalies gardées par contrôle
define('DELAI_SHACL', 15);             // secondes pour la validation SHACL
define('TYPES_VERIFIES', array('integer', 'decimal', 'double', 'float', 'boolean', 'date', 'dateTime'));

// Exécute une requête de contrôle sur $store ; lignes (bindings) ou null en cas d'échec
function requete_controle($store, $requete) {
	$r = lance_oxigraph(array('query', '--location', $store, '--results-format', 'json'), $requete, 10);
	if ($r['code'] !== 0) { error_log('SPARQLSandbox : contrôle de cohérence en échec : '.message_oxigraph($r['erreur'])); return null; }
	$j = json_decode($r['sortie'], true);
	return is_array($j) ? ($j['results']['bindings'] ?? array()) : null;
}

// Terme d'un résultat en texte court (préfixes, littéral entre guillemets)
function terme_court($t, $prefixes) {
	if (!is_array($t)) return '?';
	if (($t['type'] ?? '') === 'uri') return abrege_iri($t['value'], $prefixes);
	if (($t['type'] ?? '') === 'bnode') return 'un nœud anonyme';
	$v = mb_strlen($t['value']) > 60 ? mb_substr($t['value'], 0, 57).'…' : $t['value'];
	$h = '"'.$v.'"';
	if (!empty($t['xml:lang'])) $h .= '@'.$t['xml:lang'];
	elseif (!empty($t['datatype']) && $t['datatype'] !== PREFIXES_STANDARD['xsd'].'string') $h .= '^^'.abrege_iri($t['datatype'], $prefixes);
	return $h;
}

// Espace de noms d'une IRI (jusqu'au dernier # ou /)
function espace_de_noms($iri) {
	$p = max(strrpos($iri, '#'), strrpos($iri, '/'));
	return $p === false ? $iri : substr($iri, 0, $p + 1);
}

function anomalie($source, $message, $gravite = 'violation') {
	return array('source' => $source, 'gravite' => $gravite, 'message' => $message);
}

// Contrôles RDFS de $store. Renvoie array(anomalies, tronqué).
function controles_rdfs($store, $prefixes) {
	$P = "PREFIX rdf: <".PREFIXES_STANDARD['rdf'].">\nPREFIX rdfs: <".PREFIXES_STANDARD['rdfs'].">\n"
	    ."PREFIX owl: <".PREFIXES_STANDARD['owl'].">\nPREFIX xsd: <".PREFIXES_STANDARD['xsd'].">\n";
	$xsd = PREFIXES_STANDARD['xsd'];
	$lim = ' LIMIT '.(ANOMALIES_MAX + 1);
	$anomalies = array();
	$tronque = false;
	$ajoute = function ($liste) use (&$anomalies, &$tronque) {
		if (count($liste) > ANOMALIES_MAX) { $tronque = true; $liste = array_slice($liste, 0, ANOMALIES_MAX); }
		foreach ($liste as $a) $anomalies[] = $a;
	};
	$t = function ($l, $v) use ($prefixes) { return terme_court($l[$v] ?? null, $prefixes); };

	// Vocabulaire déclaré par l'ontologie, et ses espaces de noms
	$declares = requete_controle($store, $P.'SELECT DISTINCT ?x ?k WHERE {
		{ ?x a ?t . VALUES ?t { rdfs:Class owl:Class } BIND ("classe" AS ?k) }
		UNION { ?x rdfs:subClassOf ?y BIND ("classe" AS ?k) }
		UNION { ?x a ?t . VALUES ?t { rdf:Property owl:ObjectProperty owl:DatatypeProperty owl:AnnotationProperty } BIND ("propriete" AS ?k) }
		UNION { ?x rdfs:domain|rdfs:range|rdfs:subPropertyOf ?y BIND ("propriete" AS ?k) }
		FILTER (isIRI(?x)) }');
	$vocab = array('classe' => array(), 'propriete' => array());
	$espaces = array();
	foreach ((array)$declares as $l) {
		$vocab[$l['k']['value']][$l['x']['value']] = true;
		$espaces[espace_de_noms($l['x']['value'])] = true;
	}
	// Termes utilisés dans ces espaces de noms sans y être déclarés (une faute de frappe, souvent)
	if ($espaces) {
		$liste = array();
		$usages = array('classe' => 'SELECT DISTINCT ?x WHERE { ?s a ?x FILTER (isIRI(?x)) }',
		                'propriete' => 'SELECT DISTINCT ?x WHERE { ?s ?x ?o }');
		foreach ($usages as $k => $q) foreach ((array)requete_controle($store, $q) as $l) {
			$x = $l['x']['value'];
			if (isset($espaces[espace_de_noms($x)]) && !isset($vocab[$k][$x]))
				$liste[] = anomalie('RDFS', abrege_iri($x, $prefixes).' est utilisée comme '.($k === 'classe' ? 'classe (rdf:type)' : 'propriété')
					." mais n'est pas déclarée dans l'ontologie.");
		}
		$ajoute($liste);
	}

	// rdfs:domain
	$liste = array();
	foreach ((array)requete_controle($store, $P.'SELECT ?s ?p ?d WHERE {
			?p rdfs:domain ?d . FILTER (isIRI(?d) && ?d != rdfs:Resource)
			?s ?p ?o .
			FILTER NOT EXISTS { ?s rdf:type/rdfs:subClassOf* ?d } }'.$lim) as $l)
		$liste[] = anomalie('RDFS', $t($l, 's').' a la propriété '.$t($l, 'p').', dont le domaine est '.$t($l, 'd')
			.', mais n\'est pas de type '.$t($l, 'd').'.');
	$ajoute($liste);

	// rdfs:range vers une classe
	$litteraux = 'STRSTARTS(STR(?r), "'.$xsd.'") || ?r IN (rdfs:Literal, rdf:langString, rdf:PlainLiteral, rdf:HTML, rdf:XMLLiteral) || EXISTS { ?r a rdfs:Datatype }';
	$liste = array();
	foreach ((array)requete_controle($store, $P.'SELECT ?s ?p ?o ?r WHERE {
			?p rdfs:range ?r . FILTER (isIRI(?r) && ?r != rdfs:Resource && !('.$litteraux.'))
			?s ?p ?o .
			FILTER (isLiteral(?o) || NOT EXISTS { ?o rdf:type/rdfs:subClassOf* ?r }) }'.$lim) as $l)
		$liste[] = anomalie('RDFS', ($l['o']['type'] === 'literal'
			? $t($l, 's').' '.$t($l, 'p').' '.$t($l, 'o').' : la valeur devrait être une ressource de type '.$t($l, 'r').', pas un littéral.'
			: $t($l, 's').' '.$t($l, 'p').' '.$t($l, 'o').' : '.$t($l, 'o').' n\'est pas de type '.$t($l, 'r').' (co-domaine de '.$t($l, 'p').').'));
	$ajoute($liste);

	// rdfs:range vers un type de littéral
	$liste = array();
	foreach ((array)requete_controle($store, $P.'SELECT ?s ?p ?o ?r WHERE {
			?p rdfs:range ?r . FILTER (isIRI(?r) && ('.$litteraux.'))
			?s ?p ?o .
			FILTER (!isLiteral(?o) || (?r != rdfs:Literal && datatype(?o) != ?r)) }'.$lim) as $l)
		$liste[] = anomalie('RDFS', $t($l, 's').' '.$t($l, 'p').' '.$t($l, 'o').' : la valeur devrait être '
			.(($l['r']['value'] ?? '') === PREFIXES_STANDARD['rdfs'].'Literal' ? 'un littéral' : 'un littéral de type '.$t($l, 'r')).'.');
	$ajoute($liste);

	// Littéraux mal formés pour leur type
	$cas = 'COALESCE(';
	$fin = '"?"';
	foreach (array_reverse(TYPES_VERIFIES) as $ty) $fin = "IF(?dt = xsd:$ty, xsd:$ty(STR(?o)), $fin)";
	$cas .= $fin.', "INVALIDE")';
	$types = implode(', ', array_map(function ($ty) { return "xsd:$ty"; }, TYPES_VERIFIES));
	$liste = array();
	foreach ((array)requete_controle($store, $P."SELECT ?s ?p ?o WHERE {
			?s ?p ?o . FILTER (isLiteral(?o))
			BIND (datatype(?o) AS ?dt) FILTER (?dt IN ($types))
			BIND ($cas AS ?v) FILTER (sameTerm(?v, \"INVALIDE\")) }".$lim) as $l)
		$liste[] = anomalie('RDFS', $t($l, 's').' '.$t($l, 'p').' : "'.$l['o']['value'].'" n\'est pas une valeur valide de '
			.abrege_iri($l['o']['datatype'] ?? '', $prefixes).'.');
	$ajoute($liste);
	return array($anomalies, $tronque);
}

// Validation SHACL du graphe par défaut de $store avec les formes du jeu.
// Renvoie array(anomalies, tronqué, note) ; note : message si la validation n'a pas pu être faite.
function controles_shacl($jeu, $store, $prefixes) {
	$jeux = liste_jeux();
	$formes = $jeux[$jeu]['formes'] ?? array();
	if (!$formes) return array(array(), false, null);
	if (is_null(chemin_programme('pyshacl')))
		return array(array(), false, "Formes SHACL non vérifiées : pyshacl n'est pas installé sur le serveur.");
	$base = DOSSIER_TMP.'/shacl_'.getmypid().'_'.bin2hex(random_bytes(4));
	$donnees = $base.'.nt';
	$fichierFormes = $formes[0];
	try {
		$r = lance_oxigraph(array('dump', '--location', $store, '--graph', 'default', '--format', 'nt', '--file', $donnees), '', 10);
		if ($r['code'] !== 0) return array(array(), false, "Formes SHACL non vérifiées : export des données impossible.");
		if (count($formes) > 1) { // pyshacl ne lit qu'un fichier de formes
			$fichierFormes = $base.'_formes.ttl';
			$tout = '';
			foreach ($formes as $f) $tout .= (string)file_get_contents($f)."\n";
			file_put_contents($fichierFormes, $tout);
		}
		$r = lance_programme('pyshacl', array('-s', $fichierFormes, '-sf', 'turtle', '-df', 'nt', '-f', 'json-ld', $donnees), '', DELAI_SHACL);
	} finally {
		@unlink($donnees);
		if ($fichierFormes !== $formes[0]) @unlink($fichierFormes);
	}
	if ($r['delai']) return array(array(), false, "Formes SHACL non vérifiées : la validation a dépassé ".DELAI_SHACL." secondes.");
	$j = json_decode($r['sortie'], true);
	if (!is_array($j)) {
		error_log("SPARQLSandbox : validation SHACL de $jeu impossible : ".mb_substr($r['erreur'], 0, 500));
		return array(array(), false, "Formes SHACL non vérifiées : la validation a échoué (voir le journal du serveur).");
	}
	$noeuds = isset($j['@graph']) ? $j['@graph'] : (isset($j[0]) ? $j : array($j));
	$sh = 'http://www.w3.org/ns/shacl#';
	$valeur = function ($n, $cle) use ($sh) { return $n[$sh.$cle][0] ?? null; };
	$terme = function ($v) use ($prefixes) {
		if (!is_array($v)) return '';
		if (isset($v['@id'])) return strpos($v['@id'], '_:') === 0 ? 'un nœud anonyme' : abrege_iri($v['@id'], $prefixes);
		return '"'.(string)($v['@value'] ?? '').'"';
	};
	$gravites = array($sh.'Violation' => 'violation', $sh.'Warning' => 'avertissement', $sh.'Info' => 'information');
	$anomalies = array();
	foreach ($noeuds as $n) {
		if (!in_array($sh.'ValidationResult', (array)($n['@type'] ?? array()), true)) continue;
		$message = (string)($valeur($n, 'resultMessage')['@value'] ?? 'Contrainte non respectée');
		$chemin = $valeur($n, 'resultPath');
		$texte = $terme($valeur($n, 'focusNode')).(is_array($chemin) && isset($chemin['@id']) && strpos($chemin['@id'], '_:') !== 0 ? ' '.$terme($chemin) : '')
		        .' : '.$message.(!is_null($valeur($n, 'value')) ? ' (valeur : '.$terme($valeur($n, 'value')).')' : '');
		$anomalies[] = anomalie('SHACL', $texte, $gravites[$valeur($n, 'resultSeverity')['@id'] ?? ''] ?? 'violation');
	}
	usort($anomalies, function ($a, $b) { return strcmp($a['message'], $b['message']); });
	$tronque = count($anomalies) > ANOMALIES_MAX;
	return array(array_slice($anomalies, 0, ANOMALIES_MAX), $tronque, null);
}

// Rapport de cohérence de $store pour le jeu $jeu :
// ['anomalies' => [...], 'tronque' => bool, 'notes' => [...], 'shacl' => bool (formes vérifiées)]
function controle_coherence($jeu, $store) {
	$prefixes = array_merge(PREFIXES_STANDARD, prefixes_jeu($jeu));
	list($anomalies, $tronque) = controles_rdfs($store, $prefixes);
	list($shacl, $tronqueShacl, $note) = controles_shacl($jeu, $store, $prefixes);
	$jeux = liste_jeux();
	return array('anomalies' => array_merge($anomalies, $shacl), 'tronque' => $tronque || $tronqueShacl,
	             'notes' => is_null($note) ? array() : array($note),
	             'shacl' => !empty($jeux[$jeu]['formes']) && is_null($note));
}

// Rapport du jeu d'origine, calculé une fois par version du jeu (cache dans le dossier de
// travail) ; les anomalies sont notées dans le journal de PHP pour l'enseignant
function coherence_origine($jeu) {
	$origine = store_origine($jeu);
	if (is_null($origine)) return null;
	// le rapport dépend des données (nom du store d'origine), des formes et de la présence de pyshacl
	$cle = implode("\n", array_map('sha1_file', liste_jeux()[$jeu]['formes'] ?? array())).(is_null(chemin_programme('pyshacl')) ? '' : 'pyshacl');
	$cache = DOSSIER_TMP.'/coherence_'.basename($origine).'_'.md5($cle).'.json';
	$r = is_file($cache) ? json_decode((string)@file_get_contents($cache), true) : null;
	if (is_array($r)) return $r;
	$r = controle_coherence($jeu, $origine);
	if ($r['anomalies'])
		error_log("SPARQLSandbox : le jeu $jeu présente ".count($r['anomalies'])." incohérence(s) au chargement, dont : ".$r['anomalies'][0]['message']);
	foreach (glob(DOSSIER_TMP.'/coherence_origine_'.$jeu.'_*') ?: array() as $ancien) if ($ancien !== $cache) @unlink($ancien);
	@file_put_contents($cache.'.'.getmypid(), json_encode($r, JSON_UNESCAPED_UNICODE));
	@rename($cache.'.'.getmypid(), $cache);
	return $r;
}

// Rapport de la copie de session (gardé en session ; celui de l'origine pour une copie neuve)
function coherence_copie($jeu, $copie) {
	$s = $_SESSION['coherence'][$jeu] ?? null;
	if (is_array($s) && ($s['copie'] ?? '') === $copie) return $s['rapport'];
	$r = controle_coherence($jeu, $copie);
	$_SESSION['coherence'][$jeu] = array('copie' => $copie, 'rapport' => $r);
	return $r;
}

function note_coherence($jeu, $copie, $rapport) {
	$_SESSION['coherence'][$jeu] = array('copie' => $copie, 'rapport' => $rapport);
}

function cle_anomalie($a) { return $a['source']."\t".$a['message']; }

// Anomalies apparues et disparues entre deux rapports
function difference_coherence($avant, $apres) {
	$cles = function ($r) { $k = array(); foreach ($r['anomalies'] as $a) $k[cle_anomalie($a)] = $a; return $k; };
	$a = $cles($avant); $b = $cles($apres);
	return array(array_values(array_diff_key($b, $a)), array_values(array_diff_key($a, $b)));
}

function liste_anomalies($anomalies) {
	$h = "<ul class='anomalies'>";
	foreach ($anomalies as $a)
		$h .= "<li class='".html($a['gravite'])."'><span class='source'>".html($a['source'])."</span> ".html($a['message'])."</li>";
	return $h."</ul>";
}

// Rapport complet (panneau « Cohérence » de la copie)
function affiche_coherence($r) {
	if (is_null($r)) return "<p class='astuce'>Cohérence non vérifiée.</p>";
	$h = '';
	$n = count($r['anomalies']);
	$verif = 'Contrôles RDFS'.($r['shacl'] ? ' et formes SHACL' : '');
	if ($n == 0) $h .= "<p class='statut ok'>✅ Aucune incohérence ($verif).</p>";
	else $h .= "<p class='statut avertissement'>⚠️ $n incohérence".($n > 1 ? 's' : '').($r['tronque'] ? ' (au moins)' : '')." ($verif) :</p>".liste_anomalies($r['anomalies']);
	foreach ($r['notes'] as $note) $h .= "<p class='astuce'>".html($note)."</p>";
	return $h;
}

// Effet d'une mise à jour sur la cohérence (affiché sous son résultat)
function affiche_effet_coherence($avant, $apres) {
	list($nouvelles, $corrigees) = difference_coherence($avant, $apres);
	$h = '';
	if ($nouvelles) $h .= "<p class='statut avertissement'>⚠️ Cette mise à jour rend votre copie incohérente ("
		.count($nouvelles).' nouvelle'.(count($nouvelles) > 1 ? 's' : '').' anomalie'.(count($nouvelles) > 1 ? 's' : '')
		.") : elle a été appliquée, à vous de la corriger si besoin.</p>".liste_anomalies($nouvelles);
	if ($corrigees) $h .= "<p class='statut ok'>✅ Cette mise à jour corrige ".count($corrigees).' anomalie'.(count($corrigees) > 1 ? 's' : '')
		.".</p>".liste_anomalies($corrigees);
	if (!$nouvelles && !$corrigees && $apres['anomalies'])
		$h .= "<p class='astuce'>Votre copie présente toujours ".count($apres['anomalies'])." incohérence".(count($apres['anomalies']) > 1 ? 's' : '')
			." (voir « 🩺 Cohérence »).</p>";
	foreach ($apres['notes'] as $note) $h .= "<p class='astuce'>".html($note)."</p>";
	return $h;
}
