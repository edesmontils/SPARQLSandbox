<?php
//============================================================================
// Exercices au format de QueryCraft, comme dans SQL Sandbox.
//
// Un exercice est un fichier JSON de donnees/exercices/ :
// {"database": {"type": "rdf", "name": "cinema.ttl"},
//  "questions": {code: [requete, intention, commentaire, type, instructions(, modele)]}}
// Il porte sur le jeu de données dont l'un des fichiers s'appelle database.name.
//
// Types de question : à gauche de la flèche ce que reçoit l'étudiant, à droite ce qu'il
// produit. I : intention, R : requête, r : requête à trous (6e élément), T : table résultat
// affichée d'emblée. …->R : écrire la requête ; …->I : rédiger l'intention de la requête
// donnée, corrigée par IA quand elle est activée (ia.php), sinon auto-évaluation :
// l'intention de l'enseignant est montrée après la rédaction.
//
// Le navigateur ne reçoit jamais la solution d'une question …->R ni l'intention attendue
// d'une question …->I : le serveur les relit ici.
//============================================================================
require_once __DIR__.'/fonctions.php';

if (!defined('EXOS_DOSSIER')) define('EXOS_DOSSIER', __DIR__.'/donnees/exercices');
define('EXOS_TYPES', array('I->R', 'IT->R', 'rI->R', 'rIT->R', 'R->I', 'RT->I'));
define('EXOS_TYPES_BASE', array('rdf', 'sparql'));
define('INTENTION_MAX', 2000);

// Exercices valides d'un tableau décodé {code: {database, questions}} : les codes et les
// questions mal formés sont écartés
function exos_valides($exercices) {
	$ok = array();
	if (!is_array($exercices)) return $ok;
	foreach ($exercices as $code => $exo) {
		if (!is_string($code) || !preg_match('/^[A-Za-z0-9_-]{1,64}$/D', $code)) continue;
		if (!is_array($exo) || !isset($exo['questions']) || !is_array($exo['questions'])) continue;
		$questions = array();
		foreach ($exo['questions'] as $cq => $q) {
			if (!preg_match('/^[A-Za-z0-9_-]{1,64}$/D', (string)$cq)) continue;
			if (!is_array($q) || !in_array(count($q), array(5, 6), true)) continue;
			$q = array_values($q);
			foreach ($q as $champ) if (!is_string($champ)) continue 2;
			$questions[(string)$cq] = $q;
		}
		$db = (isset($exo['database']) && is_array($exo['database'])) ? $exo['database'] : null;
		if ($questions) $ok[$code] = array('database' => $db, 'questions' => $questions);
	}
	return $ok;
}

// Exercices du dossier local
function exos_catalogue() {
	static $exercices = null;
	if (!is_null($exercices)) return $exercices;
	$lus = array();
	foreach (glob(EXOS_DOSSIER.'/*.json') ?: array() as $f) {
		$d = json_decode((string)@file_get_contents($f), true);
		if (is_array($d)) $lus[basename($f, '.json')] = $d;
		else error_log("SPARQLSandbox : exercice $f illisible (JSON invalide)");
	}
	return $exercices = exos_valides($lus);
}

// Exercices du jeu $jeu : ceux dont database désigne l'un de ses fichiers de données
function exos_de_jeu($jeu) {
	$jeux = liste_jeux();
	$liste = array();
	if (!isset($jeux[$jeu])) return $liste;
	$fichiers = array_map('basename', $jeux[$jeu]['fichiers']);
	foreach (exos_catalogue() as $code => $exo) {
		$db = $exo['database'];
		if ($db && in_array($db['type'] ?? '', EXOS_TYPES_BASE, true) && in_array($db['name'] ?? '', $fichiers, true)) $liste[$code] = $exo;
	}
	ksort($liste, SORT_NATURAL | SORT_FLAG_CASE);
	return $liste;
}

// Lecture d'un type : array('modele' => bool, 'table' => bool, 'attendu' => 'R'|'I').
// Un type inconnu ou vide est lu comme I->R.
function exos_type($type) {
	if (!in_array($type, EXOS_TYPES, true)) return array('modele' => false, 'table' => false, 'attendu' => 'R');
	list($gauche, $droite) = explode('->', $type);
	return array('modele' => $gauche[0] === 'r', 'table' => strpos($gauche, 'T') !== false, 'attendu' => $droite);
}

function libelle_type($type) {
	$t = exos_type($type);
	if ($t['attendu'] === 'I') return 'intention';
	return $t['modele'] ? 'requête à compléter' : 'requête';
}

// Question $code_q de l'exercice $code_ex du jeu $jeu, ou null
function exos_question($jeu, $code_ex, $code_q) {
	if (!is_string($code_ex) || !is_string($code_q)) return null;
	$exos = exos_de_jeu($jeu);
	if (!isset($exos[$code_ex]['questions'][$code_q])) return null;
	$q = $exos[$code_ex]['questions'][$code_q];
	return array('requete' => $q[0], 'intention' => $q[1], 'commentaire' => $q[2], 'type' => $q[3],
	             'instructions' => $q[4], 'modele' => $q[5] ?? '');
}

// Table résultat (HTML) de la requête $requete sur le store d'ORIGINE du jeu : elle ne dépend
// pas des modifications de l'étudiant. Une requête n'écrit rien dans le store, qui peut donc
// être interrogé sans verrou. La requête vient de l'enseignant mais passe par les mêmes
// protections que celles des étudiants. Le résultat est gardé en cache (table_*, purgés avec
// les copies inactives).
function exos_table_resultat($jeu, $requete) {
	$indisponible = "<p class='astuce'>Table indisponible.</p>";
	$a = analyse_sparql($requete);
	// une table dépendant d'un service distant ne serait pas stable dans le cache
	if (!is_null($a['refus']) || $a['forme'] === 'UPDATE' || $a['services']) return $indisponible;
	$origine = store_origine($jeu);
	if (is_null($origine)) return $indisponible;
	$cache = DOSSIER_TMP.'/table_'.hash('sha256', $origine."\n".$requete).'.html';
	if (is_file($cache)) { @touch($cache); return (string)@file_get_contents($cache); }
	$place = reserve_execution();
	if (is_null($place)) return $indisponible;
	$res = interroge_store($origine, $requete, $a);
	libere($place);
	$h = $res['ok'] ? affiche_corps($res, prefixes_jeu($jeu)) : $indisponible;
	if ($h === '') $h = "<p class='astuce'>Résultat vide.</p>";
	$tmp = $cache.'.'.getmypid();
	if (@file_put_contents($tmp, $h) !== false) @rename($tmp, $cache);
	return $h;
}

// Données d'une question envoyées au navigateur : jamais la solution d'une question …->R,
// jamais l'intention attendue d'une question …->I
function exos_question_client($jeu, $code_ex, $code_q, $q, $numero) {
	$type = exos_type($q['type']);
	$intention = $type['attendu'] === 'I';
	return array(
		'exercice' => (string)$code_ex,
		'code' => (string)$code_q,
		'numero' => $numero,
		'attendu' => $type['attendu'],
		'libelle' => libelle_type($q['type']),
		'intention' => $intention ? '' : $q['intention'],
		'instructions' => $q['instructions'],
		'requete' => $intention ? $q['requete'] : '',
		'modele' => $type['modele'] ? $q['modele'] : '',
		'table' => $type['table'] ? exos_table_resultat($jeu, $q['requete']) : '',
		'aide' => $q['commentaire'],
	);
}

// Questions d'un exercice, telles qu'envoyées au navigateur, ou null
function questions_exercice($jeu, $code) {
	$exos = exos_de_jeu($jeu);
	if (!is_string($code) || !isset($exos[$code])) return null;
	$questions = array();
	foreach (array_keys($exos[$code]['questions']) as $code_q) {
		$q = exos_question($jeu, $code, (string)$code_q);
		$questions[] = exos_question_client($jeu, $code, (string)$code_q, $q, count($questions) + 1);
	}
	return array('exercice' => $code, 'questions' => $questions);
}

//============================================================================
// Vérification d'une réponse (questions …->R)
//============================================================================

// Clé d'un terme pour la comparaison : les nœuds anonymes sont tous équivalents (leurs
// identifiants changent d'une exécution à l'autre)
function cle_terme($t) {
	if (!is_array($t)) return '';
	switch ($t['type'] ?? '') {
	case 'uri': return 'U'.$t['value'];
	case 'bnode': return '_';
	default:
		$dt = $t['datatype'] ?? (isset($t['xml:lang']) ? PREFIXES_STANDARD['rdf'].'langString' : PREFIXES_STANDARD['xsd'].'string');
		return 'L'.$t['value'].'@'.strtolower($t['xml:lang'] ?? '').'^^'.$dt;
	}
}

// Résultat réduit à ce qui se compare : forme, nombre de colonnes, lignes (chaînes)
function resultat_normalise($r) {
	$x = $r['resultat'];
	if ($r['forme'] === 'ASK') return array('forme' => 'ASK', 'colonnes' => 0, 'lignes' => array($x ? 'vrai' : 'faux'));
	if (in_array($r['forme'], array('CONSTRUCT', 'DESCRIBE'))) {
		$lignes = array();
		foreach ($x['triplets'] as $t) $lignes[] = cle_terme($t[0])."\t".cle_terme($t[1])."\t".cle_terme($t[2]);
		return array('forme' => 'GRAPHE', 'colonnes' => 3, 'lignes' => $lignes);
	}
	$lignes = array();
	foreach ($x['lignes'] as $l) {
		$c = array();
		foreach ($x['variables'] as $v) $c[] = isset($l[$v]) ? cle_terme($l[$v]) : '-';
		$lignes[] = implode("\t", $c);
	}
	return array('forme' => 'SELECT', 'colonnes' => count($x['variables']), 'lignes' => $lignes);
}

// La requête impose-t-elle un ordre (ORDER BY) ?
function requete_ordonnee($q) {
	$j = jetons_sparql($q);
	for ($i = 0; $i + 1 < count($j); $i++)
		if ($j[$i][0] === 'mot' && strtoupper($j[$i][1]) === 'ORDER' && $j[$i + 1][0] === 'mot' && strtoupper($j[$i + 1][1]) === 'BY') return true;
	return false;
}

// Compare le résultat de l'étudiant à celui de la solution. Les noms des variables ne
// comptent pas, l'ordre des colonnes si ; l'ordre des lignes seulement si la solution
// contient ORDER BY. Renvoie array(bonne réponse, message).
function compare_resultats($etudiant, $solution, $ordonne) {
	$e = resultat_normalise($etudiant);
	$s = resultat_normalise($solution);
	$noms = array('SELECT' => 'SELECT', 'ASK' => 'ASK', 'GRAPHE' => 'CONSTRUCT ou DESCRIBE');
	if ($e['forme'] !== $s['forme']) return array(false, "La question attend une requête ".$noms[$s['forme']].".");
	if ($s['forme'] === 'ASK') return $e['lignes'] === $s['lignes']
		? array(true, "Bonne réponse : la réponse est bien « ".$s['lignes'][0]." ».")
		: array(false, "Ce n'est pas la réponse attendue.");
	if ($e['colonnes'] !== $s['colonnes'])
		return array(false, "Votre résultat a ".$e['colonnes']." colonne".($e['colonnes'] > 1 ? 's' : '')
			.", celui attendu en a ".$s['colonnes'].".");
	$unite = $s['forme'] === 'GRAPHE' ? 'triplet' : 'ligne';
	$ne = count($e['lignes']); $ns = count($s['lignes']);
	if ($s['forme'] === 'GRAPHE') { $ordonne = false; $e['lignes'] = array_values(array_unique($e['lignes'])); $s['lignes'] = array_values(array_unique($s['lignes'])); }
	if ($e['lignes'] === $s['lignes']) return array(true, "Bonne réponse : votre résultat est celui attendu.");
	$te = $e['lignes']; $ts = $s['lignes'];
	sort($te); sort($ts);
	if ($te === $ts) return $ordonne
		? array(false, "Les bonnes {$unite}s, mais pas dans l'ordre attendu.")
		: array(true, "Bonne réponse : votre résultat est celui attendu.");
	if ($ne !== $ns) return array(false, "Votre résultat a $ne $unite".($ne > 1 ? 's' : '').", celui attendu en a $ns.");
	return array(false, "Même nombre de {$unite}s, mais certain".($unite === 'ligne' ? 'e' : '')."s diffèrent du résultat attendu"
		.($s['forme'] === 'SELECT' ? " (vérifiez aussi l'ordre des colonnes)" : '').".");
}

// Exécute la réponse de l'étudiant sur sa copie, puis la solution sur la même copie (les
// deux voient les mêmes données), et compare. Renvoie array(ok, html).
function verifie_reponse($jeu, $code_ex, $code_q, $requete) {
	$q = exos_question($jeu, $code_ex, $code_q);
	if (is_null($q) || exos_type($q['type'])['attendu'] !== 'R') return array(false, "<p class='statut ko'>❌ Question inconnue.</p>");
	$prefixes = prefixes_jeu($jeu);
	$r = execute_sparql($jeu, $requete);
	$h = affiche_resultat($r, $prefixes);
	if (!$r['ok']) return array(false, $h);
	$formeSolution = analyse_sparql($q['requete'])['forme'];
	if ($formeSolution === 'UPDATE' || $r['forme'] === 'UPDATE') {
		$m = $formeSolution === $r['forme']
			? "▶️ Mise à jour exécutée. Vérifiez son effet avec une requête : une mise à jour ne se compare pas automatiquement."
			: "La question attend ".($formeSolution === 'UPDATE' ? "une mise à jour." : "une requête d'interrogation, pas une mise à jour.");
		return array(true, "<p class='statut neutre'>".html($m)."</p>".$h);
	}
	$s = execute_sparql($jeu, $q['requete']);
	if (!$s['ok']) {
		error_log("SPARQLSandbox : solution de $code_ex/$code_q en échec : ".$s['message']);
		return array(true, "<p class='statut neutre'>▶️ Requête exécutée, mais la solution de l'enseignant n'a pas pu être exécutée pour comparer.</p>".$h);
	}
	list($bon, $message) = compare_resultats($r, $s, requete_ordonnee($q['requete']));
	$tronque = !empty($r['resultat']['tronque']) || !empty($s['resultat']['tronque'])
		? " (comparaison faite sur les ".MAX_LIGNES." premières lignes)" : '';
	return array(true, "<p class='statut ".($bon ? 'ok' : 'ko')."' data-correct='".($bon ? '1' : '0')."'>"
		.($bon ? '🎉 ' : '❌ ').html($message.$tronque)."</p>".affiche_corps($r, $prefixes));
}

// Intention rédigée pour une question …->I : auto-évaluation, l'intention de l'enseignant
// est montrée (et son commentaire). Renvoie array(ok, html).
function intention_reference($jeu, $code_ex, $code_q, $texte) {
	$q = exos_question($jeu, $code_ex, $code_q);
	if (is_null($q) || exos_type($q['type'])['attendu'] !== 'I') return array(false, "<p class='statut ko'>❌ Question inconnue.</p>");
	$texte = trim((string)$texte);
	if (mb_strlen($texte) < 5) return array(false, "<p class='statut ko'>❌ Rédigez d'abord l'intention de la requête.</p>");
	if (mb_strlen($texte) > INTENTION_MAX) return array(false, "<p class='statut ko'>❌ Intention trop longue.</p>");
	$h = "<p class='statut neutre'><strong>Auto-évaluation</strong> : comparez votre intention à celle de l'enseignant.</p>"
	    ."<div class='comparaison'><div><h4>Votre intention</h4><blockquote>".nl2br(html($texte))."</blockquote></div>"
	    ."<div><h4>Intention de l'enseignant</h4><blockquote>".nl2br(html($q['intention']))."</blockquote></div></div>";
	return array(true, $h);
}
