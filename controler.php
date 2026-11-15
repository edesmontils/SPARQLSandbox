<?php
// Actions appelées par le JavaScript (POST, réponse JSON) :
// executer (jeu, requete64), explorer (jeu), reinitialiser (jeu)
require __DIR__.'/session.php';
require_once __DIR__.'/fonctions.php';
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
	reponse(false, "<p class='statut ko'>❌ Session expirée (plus de ".round(DUREE_SESSION / 3600, 1)." h d'inactivité, "
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
case 'explorer':
	reponse(true, explore_jeu($jeu));
case 'reinitialiser':
	reinitialise_jeu($jeu);
	reponse(true, "<p class='statut ok'>↩️ Votre copie a été remise dans l'état d'origine.</p>");
default:
	reponse(false, "<p class='statut ko'>❌ Action inconnue.</p>", 400);
}
