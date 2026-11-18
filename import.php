<?php
// Import d'un fichier Turtle (ou N-Triples) dans la copie de session d'un jeu.
//
// Le fichier n'est jamais lu par une requête SPARQL (LOAD reste interdit) : Oxigraph le charge dans un store
// jetable, ce qui le valide (la ligne fautive est donnée en cas de refus), puis la partie voulue (ontologie,
// instances ou tout) est versée dans une copie jetable de la copie de l'étudiant, qui passe les contrôles de
// cohérence. La copie de l'étudiant n'est remplacée qu'à la fin, et seulement si tout a réussi : en cas d'échec,
// ou en simulation, elle reste telle quelle.
//
// L'« ontologie » d'un fichier, ce sont les sujets déclarés comme concept, propriété ou ontologie, ou portant une
// déclaration de schéma (rdfs:subClassOf, rdfs:domain…) ; les « instances » sont tout le reste (comme à l'export).
// « Fusionner » ajoute aux triplets existants ; « remplacer » efface d'abord la même partie de la copie (les
// cardinalités et la provenance qui s'y rattachent sont effacées avec elle).
// Les @prefix du fichier sont ajoutés aux préfixes de la copie quand ils ne gênent aucun préfixe connu.

const IMPORT_TAILLE_MAX = 1048576;     // octets du fichier
const IMPORT_TRIPLETS_MAX = 20000;     // triplets du fichier
const IMPORT_DELAI = 20;               // secondes pour chaque étape d'Oxigraph

// Sujets d'un schéma (graphe par défaut) : à placer dans un WHERE
function import_schema_sujets() {
	return '{ SELECT DISTINCT ?s WHERE { { ?s a ?t . VALUES ?t { rdfs:Class owl:Class rdf:Property owl:ObjectProperty owl:DatatypeProperty owl:AnnotationProperty owl:Ontology owl:Restriction } } '
		.'UNION { ?s rdfs:subClassOf|rdfs:subPropertyOf|rdfs:domain|rdfs:range ?x } } }';
}

function import_prefixe_sparql() {
	return 'PREFIX rdf: <'.PREFIXES_STANDARD['rdf'].'> PREFIX rdfs: <'.PREFIXES_STANDARD['rdfs'].'> PREFIX owl: <'.PREFIXES_STANDARD['owl'].'> ';
}

// Requête CONSTRUCT qui extrait du store du fichier la partie à importer
function import_extrait($partie) {
	$sch = import_schema_sujets();
	if ($partie === 'ontologie') return import_prefixe_sparql().'CONSTRUCT { ?s ?p ?o } WHERE { '.$sch.' ?s ?p ?o }';
	if ($partie === 'instances') return import_prefixe_sparql().'CONSTRUCT { ?s ?p ?o } WHERE { { ?s ?p ?o } MINUS '.$sch.' }';
	return 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }';
}

// Mise à jour qui efface de la copie la partie $partie (mode « remplacer »)
function import_efface($partie) {
	$sch = import_schema_sujets();
	if ($partie === 'ontologie') return import_prefixe_sparql().'DELETE { ?s ?p ?o } WHERE { '.$sch.' ?s ?p ?o } ; CLEAR SILENT GRAPH <'.ONTO_GRAPHE_CONTRAINTES.'>';
	if ($partie === 'instances') return import_prefixe_sparql().'DELETE { ?s ?p ?o } WHERE { { ?s ?p ?o } MINUS '.$sch.' } ; CLEAR SILENT GRAPH <'.PROVENANCE_GRAPHE.'>';
	return 'CLEAR ALL';
}

// Déclarations de préfixes d'un fichier Turtle (@prefix ou PREFIX) : array(préfixe => espace de noms)
function import_prefixes_du_fichier($texte) {
	preg_match_all('/^\s*(?:@prefix|PREFIX)\s+([A-Za-z][\w.-]*):\s*<([^>\s]*)>/mi', $texte, $m, PREG_SET_ORDER);
	$p = array();
	foreach ($m as $d) if ($d[2] !== '' && !isset($p[$d[1]])) $p[$d[1]] = $d[2];
	return $p;
}

// Message d'erreur d'Oxigraph pour un fichier refusé : sans chemin du serveur ni conseil d'option (--lenient) qui n'a pas de sens ici ;
// il garde l'endroit fautif (ligne et colonne)
function import_message_erreur($erreur) {
	$m = message_oxigraph($erreur);
	if (preg_match('/at line (\d+)(?: column (\d+))?: ([^\n]*)/', $m, $x))
		return 'ligne '.$x[1].(isset($x[2]) && $x[2] !== '' ? ', colonne '.$x[2] : '').' : '.mb_substr($x[3], 0, 200).' (erreur de syntaxe du fichier).';
	$m = preg_replace('#'.preg_quote((string)DOSSIER_TMP, '#').'/[^\s:]*#', 'le fichier', $m);
	$m = preg_replace('/(Some files like Wikidata dumps|Error: One or more files)[^\n]*\n?/', '', $m);
	$m = trim(preg_replace('/\n{2,}/', "\n", $m));
	return $m !== '' ? mb_substr($m, 0, 400) : 'syntaxe incorrecte.';
}

// Importe (ou, avec $simuler, essaie d'importer) le fichier $fichier dans la copie du jeu.
//   $extension : ttl ou nt ; $partie : tout | ontologie | instances ; $mode : fusionner | remplacer
// Renvoie array(ok, HTML du compte rendu, importé : bool)
function import_turtle($jeu, $fichier, $extension, $partie, $mode, $simuler) {
	$ko = function ($m) { return array(false, "<p class='statut ko'>❌ ".html($m)."</p>", false); };
	if (!in_array($extension, array('ttl', 'nt'), true)) return $ko('Format non pris en charge : Turtle (.ttl) ou N-Triples (.nt) seulement.');
	if (!in_array($partie, array('tout', 'ontologie', 'instances'), true) || !in_array($mode, array('fusionner', 'remplacer'), true)) return $ko('Demande inconnue.');
	$taille = is_file($fichier) ? filesize($fichier) : false;
	if ($taille === false || $taille === 0) return $ko('Le fichier est vide ou illisible.');
	if ($taille > IMPORT_TAILLE_MAX) return $ko('Le fichier est trop gros : '.round(IMPORT_TAILLE_MAX / 1048576).' Mo au plus.');
	$texte = (string)file_get_contents($fichier);
	if (strpos($texte, "\0") !== false || !mb_check_encoding($texte, 'UTF-8')) return $ko("Le fichier n'est pas un texte UTF-8 : ce n'est pas du Turtle.");
	$copie = store_copie($jeu, $erreur);
	if (is_null($copie)) return $ko($erreur);
	$place = reserve_execution();
	if (is_null($place)) return $ko('Trop de requêtes en cours depuis votre poste : réessayez dans un instant.');
	$v = verrou('copie_'.basename($copie));
	if (is_null($v)) { libere($place); return $ko('Une autre de vos requêtes est en cours sur ce jeu : réessayez dans un instant.'); }
	$base = DOSSIER_TMP.'/import_'.getmypid().'_'.bin2hex(random_bytes(4));
	$source = $base.'.'.$extension;
	$lu = $base.'_lu'; $part = $base.'_part.nt'; $jetable = $base.'_copie';
	$remplace = false;
	try {
		if (!@copy($fichier, $source)) return $ko('Le fichier n\'a pas pu être préparé.');
		// 1. lecture : le fichier est chargé dans un store jetable, ce qui le valide
		// (par l'entrée standard : « load --file » charge un .nt en parallèle et sépare les triplets d'un même nœud anonyme)
		$r = lance_oxigraph(array('load', '--location', $lu, '--format', $extension), $texte, IMPORT_DELAI);
		if ($r['delai']) return $ko('La lecture du fichier a pris trop de temps.');
		if ($r['code'] !== 0) return $ko('Fichier refusé : '.import_message_erreur($r['erreur']));
		$n_fichier = compte_triplets($lu);
		if (is_null($n_fichier)) return $ko('Le fichier n\'a pas pu être compté.');
		if ($n_fichier == 0) return $ko('Le fichier ne contient aucun triplet.');
		if ($n_fichier > IMPORT_TRIPLETS_MAX) return $ko("Le fichier contient $n_fichier triplets : ".IMPORT_TRIPLETS_MAX.' au plus.');
		// 2. la partie voulue, extraite en N-Triples
		$r = lance_oxigraph(array('query', '--location', $lu, '--results-format', 'nt'), import_extrait($partie), IMPORT_DELAI);
		if ($r['code'] !== 0 || $r['trop'] || $r['delai']) return $ko('La partie à importer n\'a pas pu être extraite du fichier.');
		$sortie_part = $r['sortie'];
		$n_part = substr_count($r['sortie'], "\n");
		if ($n_part == 0) return $ko('Le fichier ne contient rien de cette partie ('.($partie === 'ontologie' ? "pas de déclaration de concept ni de propriété" : 'pas d\'instance').').');
		// 3. copie jetable de la copie : effacement éventuel, puis chargement
		supprime_dossier($jetable);
		if (!copie_dossier($copie, $jetable)) return $ko('Copie de travail impossible.');
		$avant_n = compte_triplets($copie);
		if ($mode === 'remplacer') {
			$r = lance_oxigraph(array('update', '--location', $jetable), import_efface($partie), IMPORT_DELAI);
			if ($r['code'] !== 0) return $ko('Remplacement impossible : '.message_oxigraph($r['erreur']));
		}
		$r = lance_oxigraph(array('load', '--location', $jetable, '--format', 'nt'), $sortie_part, IMPORT_DELAI);
		if ($r['code'] !== 0) return $ko('Import impossible : '.message_oxigraph($r['erreur']));
		$apres_n = compte_triplets($jetable);
		if (taille_dossier($jetable) > TAILLE_MAX_COPIE) return $ko('Cet import ferait dépasser '.round(TAILLE_MAX_COPIE / 1048576).' Mo à votre copie : il n\'a pas été fait.');
		// 4. contrôles de cohérence de la copie telle qu'elle serait
		$avant = coherence_copie($jeu, $copie);
		$apres = controle_coherence($jeu, $jetable);
		// 5. préfixes du fichier : ajoutés s'ils ne gênent aucun préfixe connu
		$ajoutes = array(); $refuses = array();
		foreach (import_prefixes_du_fichier($texte) as $p => $ns) {
			$connus = prefixes_connus($jeu);
			if (isset($connus[$p]) && $connus[$p] === $ns || in_array($ns, $connus, true)) continue;   // déjà défini
			if ($simuler) { if (!isset($connus[$p])) $ajoutes[] = $p; else $refuses[] = $p; continue; }
			list($ok, ) = ajoute_prefixe($jeu, $p, $ns);
			if ($ok) $ajoutes[] = $p; else $refuses[] = $p;
		}
		// 6. la copie jetable remplace la copie, seulement si ce n'est pas une simulation
		if (!$simuler) {
			$vieux = $copie.'.vieux'.getmypid();
			if (!@rename($copie, $vieux) || !@rename($jetable, $copie)) {
				if (is_dir($vieux) && !is_dir($copie)) @rename($vieux, $copie);
				return $ko('L\'import n\'a pas pu être enregistré : votre copie est inchangée.');
			}
			supprime_dossier($vieux);
			note_coherence($jeu, $copie, $apres);
			unset($_SESSION['peuplement'][$jeu]);    // les propositions de l'IA décrivaient l'ancienne copie
			@touch($copie);
			$remplace = true;
		}
	} finally {
		supprime_dossier($lu);
		supprime_dossier($jetable);
		@unlink($source); @unlink($part);
		libere($v);
		libere($place);
	}
	list($nouvelles, $corrigees) = difference_coherence($avant, $apres);
	$noms = array('tout' => 'ontologie et instances', 'ontologie' => 'ontologie', 'instances' => 'instances');
	$delta = !is_null($avant_n) && !is_null($apres_n) ? ' ('.($apres_n - $avant_n >= 0 ? '+' : '').($apres_n - $avant_n).')' : '';
	$h = $simuler ? "<p class='statut avertissement'>🔎 Simulation : rien n'a été importé, votre copie est inchangée.</p>" : "<p class='statut ok'>✅ Import fait.</p>";
	$h .= "<p>Fichier : <strong>$n_fichier</strong> triplet".($n_fichier > 1 ? 's' : '').'. Partie '.($mode === 'remplacer' ? 'remplacée' : 'ajoutée').' : <strong>'.$noms[$partie].'</strong> ('
		.$n_part.' triplet'.($n_part > 1 ? 's' : '').'). Votre copie '.($simuler ? 'contiendrait' : 'contient maintenant').' <strong>'.(int)$apres_n.'</strong> triplets'.$delta.'.</p>';
	if ($ajoutes) $h .= '<p>Préfixes '.($simuler ? 'qui seraient ajoutés' : 'ajoutés').' : '.html(implode(', ', array_map(function ($p) { return $p.':'; }, $ajoutes))).'.</p>';
	if ($refuses) $h .= "<p class='astuce'>Préfixes du fichier non repris (déjà utilisés pour un autre espace de noms) : ".html(implode(', ', array_map(function ($p) { return $p.':'; }, $refuses))).'.</p>';
	$na = count($apres['anomalies']);
	if ($na == 0) $h .= "<p class='statut ok'>✅ Aucune incohérence".($corrigees ? ' : l\'import en corrige '.count($corrigees) : '').'.</p>';
	else $h .= "<p class='statut avertissement'>⚠️ $na incohérence".($na > 1 ? 's' : '').($apres['tronque'] ? ' (au moins)' : '').' après l\'import ('.count($nouvelles).' nouvelle'.(count($nouvelles) > 1 ? 's' : '').', '.count($corrigees).' corrigée'.(count($corrigees) > 1 ? 's' : '').').</p>';
	if ($nouvelles) $h .= '<h3>Nouvelles, à cause de l\'import</h3>'.liste_anomalies(array_slice($nouvelles, 0, 15)).(count($nouvelles) > 15 ? "<p class='astuce'>… et ".(count($nouvelles) - 15).' autres.</p>' : '');
	foreach ($apres['notes'] as $note) $h .= "<p class='astuce'>".html($note)."</p>";
	return array(true, $h, $remplace);
}
