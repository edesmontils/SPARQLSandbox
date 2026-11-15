<?php
// Démarrage de session commun à toutes les pages (cookie protégé), comme dans SQLSandbox
ini_set('session.cookie_httponly', '1');
ini_set('session.cookie_samesite', 'Lax');
ini_set('session.use_strict_mode', '1');
ini_set('display_errors', '0');
require_once __DIR__.'/dossiers.php';
define('DUREE_SESSION', duree_vie());
// Les sessions ont leur propre dossier, hors du site (le nom d'un fichier de session
// contient l'identifiant de session), et à défaut tmp/sessions.
$dossierSessions = dossier_prive('sessions-'.INSTANCE, __DIR__.'/tmp/sessions');
if (!is_null($dossierSessions)) {
	if (strpos($dossierSessions, __DIR__) === 0 && !is_file($dossierSessions.'/index.html'))
		@touch($dossierSessions.'/index.html');
	ini_set('session.save_path', $dossierSessions);
	ini_set('session.gc_probability', '1');
	ini_set('session.gc_divisor', '100');
}
ini_set('session.gc_maxlifetime', (string)DUREE_SESSION);
ini_set('session.cookie_lifetime', (string)DUREE_SESSION);
ini_set('session.cookie_secure', (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? '1' : '0');
session_name(INSTANCE);
$session_ok = session_start();
if ($session_ok) { // le cookie expire DUREE_SESSION après la dernière requête
	$p = session_get_cookie_params();
	setcookie(session_name(), session_id(), array('expires' => time() + DUREE_SESSION, 'path' => $p['path'],
		'secure' => (bool)$p['secure'], 'httponly' => true, 'samesite' => 'Lax'));
}
header('X-Frame-Options: SAMEORIGIN');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');
// Permet au JavaScript de distinguer les réponses de l'application de celles d'un pare-feu
header('X-SPARQLSandbox: 1');
