<?php
// Actions appelées par le JavaScript (POST, réponse JSON) :
// executer (jeu, requete64), explorer (jeu), reinitialiser (jeu),
// exercice (jeu, exercice), verifier (jeu, exercice, question, requete64),
// intention (jeu, exercice, question, intention) : correction par IA si elle est activée
// (ia.php), sinon auto-évaluation
require __DIR__.'/session.php';
require_once __DIR__.'/fonctions.php';
require_once __DIR__.'/exercices.php';
require_once __DIR__.'/ia.php';
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

function reponse($ok, $html, $code = 200) {
	http_response_code($code);
	echo json_encode(array('ok' => $ok, 'html' => $html), JSON_UNESCAPED_UNICODE);
	exit;
}

if (!$session_ok || $_SERVER['REQUEST_METHOD'] !== 'POST')
	reponse(false, "<p class='statut ko'>❌ Requête invalide.</p>", 400);
if (!jeton_valide())
	reponse(false, "<p class='statut ko'>❌ Session expirée (plus de ".libelle_duree(DUREE_SESSION)." d'inactivité, "
		."ou application ouverte dans un autre onglet) : rechargez la page pour continuer.</p>", 403);

$jeux = liste_jeux();
$jeu = param('jeu');
if (!is_string($jeu) || !isset($jeux[$jeu])) reponse(false, "<p class='statut ko'>❌ Jeu de données inconnu.</p>", 400);

switch (param('action')) {
case 'executer':
	$requete = requete_recue();
	if (is_null($requete)) reponse(false, "<p class='statut ko'>❌ Pas de requête reçue.</p>", 400);
	$r = execute_sparql($jeu, $requete);
	reponse($r['ok'], affiche_resultat($r, prefixes_jeu($jeu)));
// Exercices au format QueryCraft (exercices.php)
case 'exercice':
	$ex = questions_exercice($jeu, param('exercice'));
	if (is_null($ex)) reponse(false, "<p class='statut ko'>❌ Exercice inconnu.</p>", 404);
	http_response_code(200);
	echo json_encode(array('ok' => true, 'exercice' => $ex), JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
	exit;
case 'verifier':
	$requete = requete_recue();
	if (is_null($requete)) reponse(false, "<p class='statut ko'>❌ Pas de requête reçue.</p>", 400);
	list($ok, $h) = verifie_reponse($jeu, param('exercice'), param('question'), $requete);
	reponse($ok, $h);
case 'intention':
	if (is_null(ia_config())) {
		list($ok, $h) = intention_reference($jeu, param('exercice'), param('question'), param('intention'));
		reponse($ok, $h);
	}
	$r = ia_corriger_intention($jeu, param('exercice'), param('question'), param('intention'));
	http_response_code($r['statut'] ?? 200);
	echo json_encode(array('ok' => !isset($r['erreur']), 'html' => ia_correction_html($r),
		'ia' => isset($r['erreur']) ? null : array('verdict' => $r['verdict'], 'explication' => $r['explication'], 'modele' => $r['modele'])),
		JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
	exit;
case 'explorer':
	list($h, $coherence) = explore_jeu($jeu);
	echo json_encode(array('ok' => true, 'html' => $h, 'coherence' => $coherence), JSON_UNESCAPED_UNICODE);
	exit;
case 'reinitialiser':
	reinitialise_jeu($jeu);
	reponse(true, "<p class='statut ok'>↩️ Votre copie a été remise dans l'état d'origine.</p>");
default:
	reponse(false, "<p class='statut ko'>❌ Action inconnue.</p>", 400);
}
