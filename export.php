<?php
// Export Turtle de la copie de session d'un jeu : tout (export.php?jeu=…), ou seulement
// l'ontologie (&partie=ontologie) ou les instances (&partie=instances). Réponse : fichier .ttl.
require __DIR__.'/session.php';
require_once __DIR__.'/fonctions.php';
require_once __DIR__.'/ontologie.php';
require_once __DIR__.'/peuplement.php';

function export_erreur($code, $message) {
	http_response_code($code);
	header('Content-Type: text/plain; charset=utf-8');
	echo $message;
	exit;
}

// Triplets de la copie (graphe par défaut et graphes nommés réunis) qui forment l'ontologie :
// sujets déclarés comme classe, propriété ou ontologie, ou portant une déclaration de schéma
function export_requete($partie) {
	$pre = 'PREFIX rdf: <'.PREFIXES_STANDARD['rdf'].'> PREFIX rdfs: <'.PREFIXES_STANDARD['rdfs'].'> PREFIX owl: <'.PREFIXES_STANDARD['owl'].'> ';
	$tout = '{ ?s ?p ?o } UNION { GRAPH ?g { ?s ?p ?o } FILTER(?g != <'.PROVENANCE_GRAPHE.'>) }';   // la provenance (éditeur) n\'est pas une donnée
	if ($partie === 'tout') return $pre.'CONSTRUCT { ?s ?p ?o } WHERE { '.$tout.' }';
	$sch = '{ ?s a ?t . VALUES ?t { rdfs:Class owl:Class rdf:Property owl:ObjectProperty owl:DatatypeProperty '
		.'owl:AnnotationProperty owl:Ontology owl:Restriction } } '
		.'UNION { ?s rdfs:subClassOf|rdfs:subPropertyOf|rdfs:domain|rdfs:range ?x }';
	$schema = '{ SELECT DISTINCT ?s WHERE { { '.$sch.' } UNION { GRAPH ?g0 { '.$sch.' } } } }';
	if ($partie === 'ontologie') return $pre.'CONSTRUCT { ?s ?p ?o } WHERE { '.$schema.' { '.$tout.' } }';
	return $pre.'CONSTRUCT { ?s ?p ?o } WHERE { { '.$tout.' } MINUS '.$schema.' }';
}

// Remplace les IRI entre chevrons par leur forme abrégée (hors littéraux) et
// ajoute les déclarations @prefix utiles ; renvoie le Turtle complet
function export_abrege($ttl, array $prefixes) {
	$utilises = array();
	$sortie = preg_replace_callback('/"(?:[^"\\\\]|\\\\.)*"|<([^<>\s"{}|\\\\^`]*)>/su', function ($m) use ($prefixes, &$utilises) {
		if (!isset($m[1])) return $m[0]; // littéral : inchangé
		$iri = $m[1];
		$meilleur = null;
		foreach ($prefixes as $nom => $ns) {
			if ($ns === '' || strpos($iri, $ns) !== 0) continue;
			$local = substr($iri, strlen($ns));
			if ($local === '' || !preg_match('/^[A-Za-z0-9_]([A-Za-z0-9_-]*[A-Za-z0-9_])?$/D', $local)) continue;
			if (!preg_match('/^[A-Za-z][A-Za-z0-9_-]*$/D', (string)$nom)) continue;
			if (is_null($meilleur) || strlen($ns) > strlen($prefixes[$meilleur[0]])) $meilleur = array($nom, $local);
		}
		if (is_null($meilleur)) return $m[0];
		$utilises[$meilleur[0]] = true;
		return $meilleur[0].':'.$meilleur[1];
	}, $ttl);
	if (!is_string($sortie)) return $ttl;
	ksort($utilises);
	$entete = '';
	foreach ($utilises as $nom => $_) $entete .= '@prefix '.$nom.': <'.$prefixes[$nom].'> .'."\n";
	return $entete.($entete !== '' ? "\n" : '').$sortie;
}

if (!$session_ok) export_erreur(400, 'Session indisponible.');
$jeux = liste_jeux();
$jeu = param('jeu');
if (!is_string($jeu) || !isset($jeux[$jeu])) export_erreur(400, 'Jeu de données inconnu.');
$partie = param('partie') ?? 'tout';
if (!in_array($partie, array('tout', 'ontologie', 'instances'), true)) export_erreur(400, 'Partie inconnue.');

$copie = store_copie($jeu, $erreur);
if (is_null($copie)) export_erreur(503, (string)$erreur);
$place = reserve_execution();
if (is_null($place)) export_erreur(429, 'Trop de requêtes en cours depuis votre poste : réessayez dans un instant.');
$v = verrou('copie_'.basename($copie));
if (is_null($v)) { libere($place); export_erreur(503, 'Une autre de vos requêtes est en cours sur ce jeu : réessayez dans un instant.'); }
try {
	$r = lance_oxigraph(array('query', '--location', $copie, '--results-format', 'ttl'), export_requete($partie), 30);
	@touch($copie);
} finally {
	libere($v);
	libere($place);
}
if ($r['delai']) export_erreur(504, "L'export a pris trop de temps.");
if ($r['trop']) export_erreur(413, "Le jeu de données est trop volumineux pour être exporté.");
if ($r['code'] !== 0) export_erreur(500, "Export impossible.");

$ttl = export_abrege($r['sortie'], array_merge(PREFIXES_STANDARD, prefixes_jeu($jeu)));
$nom = preg_replace('/[^A-Za-z0-9_-]+/', '_', $jeu).($partie === 'tout' ? '' : '_'.$partie).'.ttl';
header('Content-Type: text/turtle; charset=utf-8');
header('Content-Disposition: attachment; filename="'.$nom.'"');
header('Cache-Control: no-store');
echo "# ".$jeux[$jeu]['titre']." – ".($partie === 'tout' ? 'ontologie et instances' : $partie)." (copie de session)\n".$ttl;
