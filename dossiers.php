<?php
// Nom de cette installation : il donne le nom du cookie de session et des dossiers de
// travail. Deux installations sur un même hébergement doivent avoir des noms différents,
// sinon elles partagent cookie et sessions.
if (!defined('INSTANCE')) define('INSTANCE', 'sparqlsandbox');

// Dossiers de travail de l'application (stores des sessions, verrous, sessions PHP).
// Ils sont placés hors du site, à côté de la racine web (par exemple ~/sparqlsandbox-tmp
// chez OVH), pour ne pas dépendre d'un .htaccess. À défaut, repli sur un dossier du site.
function dossier_prive($nom, $repli) {
	$candidats = array();
	if (!empty($_SERVER['DOCUMENT_ROOT']))
		$candidats[] = dirname(rtrim($_SERVER['DOCUMENT_ROOT'], '/')).'/'.$nom;
	$candidats[] = $repli;
	foreach ($candidats as $dossier) {
		if (!@is_dir($dossier)) @mkdir($dossier, 0700, true);
		if (@is_dir($dossier) && @is_writable($dossier)) return realpath($dossier);
	}
	return null;
}

// Stores Oxigraph des sessions et des jeux d'origine, verrous (null si aucun dossier
// n'est accessible en écriture)
if (!defined('DOSSIER_TMP')) define('DOSSIER_TMP', dossier_prive(INSTANCE.'-tmp', __DIR__.'/tmp'));

// Fichier sparqlsandbox.ini de cette installation, hors du site : variable d'environnement
// SPARQLSANDBOX_INI, puis à côté de la racine web (~/sparqlsandbox.ini chez OVH) ;
// null s'il n'existe pas.
function fichier_ini() {
	$candidats = array();
	if (getenv('SPARQLSANDBOX_INI')) $candidats[] = getenv('SPARQLSANDBOX_INI');
	if (!empty($_SERVER['DOCUMENT_ROOT']))
		$candidats[] = dirname(rtrim($_SERVER['DOCUMENT_ROOT'], '/')).'/'.INSTANCE.'.ini';
	foreach ($candidats as $f) {
		if (!is_file($f)) continue;
		if (!is_readable($f)) error_log("SPARQLSandbox : $f existe mais PHP ne peut pas le lire : ses réglages sont ignorés.");
		return $f;
	}
	return null;
}

// Réglages de sparqlsandbox.ini (tableau vide sans fichier)
function reglages() {
	static $valeurs = null;
	if (is_null($valeurs)) {
		$f = fichier_ini();
		$valeurs = (!is_null($f) && is_readable($f)) ? (@parse_ini_file($f) ?: array()) : array();
	}
	return $valeurs;
}

// Durée de vie (secondes) d'une session et des copies des jeux de données, depuis la
// dernière activité : duree_session_min de sparqlsandbox.ini, sinon 3 heures.
function duree_vie() {
	$r = reglages();
	if (isset($r['duree_session_min']) && (int)$r['duree_session_min'] > 0)
		return max(60, (int)$r['duree_session_min'] * 60);
	return 3 * 60 * 60;
}

// Durée en clair, arrondie à la minute : « 3 heures », « 1 heure 30 », « 45 minutes »
function libelle_duree($secondes) {
	$min = max(1, (int)round($secondes / 60));
	$h = intdiv($min, 60);
	$m = $min % 60;
	if ($h == 0) return $m.' minute'.($m > 1 ? 's' : '');
	return $h.' heure'.($h > 1 ? 's' : '').($m ? ' '.sprintf('%02d', $m) : '');
}
