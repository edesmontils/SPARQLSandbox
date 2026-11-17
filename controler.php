<?php
// Actions appelées par le JavaScript (POST, réponse JSON) :
// executer (jeu, requete64), explorer (jeu), vocabulaire (jeu), reinitialiser (jeu),
// ontologie (jeu), ontologie_enregistrer (jeu, brouillon64 : ontologie, instances, propositions de l'IA), instances (jeu),
// instance (jeu, iri ou anon), ia_peupler (jeu, mode, quantite, consigne, brouillon64) :
// éditeur d'ontologie (editeur.php), affichage et peuplement par IA des instances (peuplement.php),
// exercice (jeu, exercice), verifier (jeu, exercice, question, requete64),
// intention (jeu, exercice, question, intention) : correction par IA si elle est activée
// (ia.php), sinon auto-évaluation
require __DIR__.'/session.php';
require_once __DIR__.'/fonctions.php';
require_once __DIR__.'/exercices.php';
require_once __DIR__.'/ia.php';
require_once __DIR__.'/peuplement.php';
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

// Brouillon de l'éditeur reçu (base64 d'un JSON) : tableau, vide s'il n'y en a pas, null s'il est illisible
function brouillon_recu() {
	$brut = param('brouillon64');
	if (!is_string($brut) || $brut === '') return array();
	$texte = base64_decode($brut, true);
	$b = $texte === false ? null : json_decode($texte, true);
	return is_array($b) ? $b : null;
}

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
case 'vocabulaire':
	list($modele, $erreur) = vocabulaire_jeu($jeu);
	if (is_null($modele)) reponse(false, "<p class='statut ko'>❌ ".html($erreur)."</p>");
	echo json_encode(array('ok' => true, 'modele' => $modele), JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
	exit;
case 'ontologie':
	list($modele, $erreur) = modele_ontologie($jeu);
	if (is_null($modele)) reponse(false, "<p class='statut ko'>❌ ".html($erreur)."</p>");
	echo json_encode(array('ok' => true, 'modele' => $modele), JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
	exit;
case 'ontologie_enregistrer':
	$brut = param('brouillon64');
	$texte = is_string($brut) ? base64_decode($brut, true) : false;
	$brouillon = $texte === false ? null : json_decode($texte, true);
	if (!is_array($brouillon)) reponse(false, "<p class='statut ko'>❌ Brouillon reçu illisible.</p>", 400);
	list($ok, $h, $modele, $sujets) = enregistre_ontologie($jeu, $brouillon);
	echo json_encode(array('ok' => $ok, 'html' => $h, 'modele' => $modele, 'sujets' => $sujets), JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
	exit;
case 'instances':
	list($modele, $erreur) = modele_instances($jeu);
	if (is_null($modele)) reponse(false, "<p class='statut ko'>❌ ".html($erreur)."</p>");
	echo json_encode(array('ok' => true, 'modele' => $modele), JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
	exit;
case 'ia_peupler':
	$brouillon = brouillon_recu();
	if (is_null($brouillon)) reponse(false, "<p class='statut ko'>❌ Brouillon reçu illisible.</p>", 400);
	$r = ia_peupler($jeu, param('mode'), param('quantite'), param('consigne'), $brouillon);
	http_response_code($r['statut'] ?? 200);
	if (isset($r['erreur'])) echo json_encode(array('ok' => false, 'html' => "<p class='statut ko'>❌ ".html($r['erreur'])."</p>"), JSON_UNESCAPED_UNICODE);
	else echo json_encode($r, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
	exit;
case 'instance':
	list($modele, $erreur) = modele_instance($jeu, (string)param('iri'), (string)param('anon'));
	if (is_null($modele)) reponse(false, "<p class='statut ko'>❌ ".html($erreur)."</p>");
	echo json_encode(array('ok' => true, 'modele' => $modele), JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
	exit;
case 'reinitialiser':
	reinitialise_jeu($jeu);
	reponse(true, "<p class='statut ok'>↩️ Votre copie a été remise dans l'état d'origine.</p>");
default:
	reponse(false, "<p class='statut ko'>❌ Action inconnue.</p>", 400);
}
