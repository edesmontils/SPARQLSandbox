<?php
// Tests de SPARQL Sandbox : php tests/run.php
// Ils demandent Oxigraph (pip install oxigraph, ou SPARQLSANDBOX_OXIGRAPH=chemin).

$travail = sys_get_temp_dir().'/sparqlsandbox-tests-'.getmypid();
@mkdir($travail, 0700, true);
define('DOSSIER_TMP', realpath($travail));
define('DELAI_MAX', 2);
define('TAILLE_MAX_COPIE', 2 * 1024 * 1024);
require __DIR__.'/../dossiers.php';
require __DIR__.'/../fonctions.php';
$_SESSION = array();

$succes = 0;
$echecs = array();
function verifie($condition, $libelle) {
	global $succes, $echecs;
	if ($condition) $succes++;
	else { $echecs[] = $libelle; echo "ÉCHEC : $libelle\n"; }
}
function nettoie() { global $travail; supprime_dossier($travail); }
register_shutdown_function('nettoie');

echo "Oxigraph : ".(chemin_oxigraph() ?? 'introuvable')."\n";
if (is_null(chemin_oxigraph())) { echo "Oxigraph est nécessaire aux tests.\n"; exit(1); }

//------------------------------------------------------------
// Analyse des requêtes
//------------------------------------------------------------
$refus = array(
	'SELECT * WHERE { SERVICE <http://x.org/sparql> { ?s ?p ?o } }',
	'select * where { service silent <http://x.org/sparql> { ?s ?p ?o } }',
	"SELECT * WHERE { ?s ?p 'a' . SERVICE ?x { ?s ?p ?o } }",
	'LOAD <http://example.org/x.ttl>',
	'load silent <http://example.org/x.ttl> into graph <http://g>',
	"PREFIX ex: <http://ex.org/>\n# commentaire\nSELECT * WHERE {?s ?p ?o}\n;LOAD <http://x>",
);
foreach ($refus as $q) verifie(!is_null(analyse_sparql($q)['refus']), "refus de : $q");
$permis = array(
	'SELECT ?x WHERE { ?x <http://ex.org/p> "SERVICE et LOAD" }',
	"SELECT ?x WHERE { ?x <http://ex.org/p> '''LOAD\nSERVICE''' }",
	"SELECT ?x WHERE { ?x <http://ex.org/SERVICE> ?y } # SERVICE dans un commentaire",
	'PREFIX ex: <http://ex.org/> SELECT ?service WHERE { ?service ex:service ex:LOAD }',
	'SELECT ?x WHERE { ?x <http://ex.org/p> "il dit \"SERVICE\"" }',
);
foreach ($permis as $q) verifie(is_null(analyse_sparql($q)['refus']), "accepte : $q");

$formes = array(
	'SELECT * WHERE { ?s ?p ?o }' => 'SELECT',
	"PREFIX ex: <http://ex.org/select>\nBASE <http://b/>\nask { ?s ?p ?o }" => 'ASK',
	"# un commentaire SELECT\nCONSTRUCT WHERE { ?s ?p ?o }" => 'CONSTRUCT',
	'DESCRIBE <http://ex.org/a>' => 'DESCRIBE',
	'PREFIX ex: <http://ex.org/> INSERT DATA { ex:a ex:b ex:c }' => 'UPDATE',
	'DELETE WHERE { ?s ?p ?o }' => 'UPDATE',
	'WITH <http://g> DELETE { ?s ?p ?o } WHERE { ?s ?p ?o }' => 'UPDATE',
	'CLEAR DEFAULT' => 'UPDATE',
);
foreach ($formes as $q => $f) verifie(analyse_sparql($q)['forme'] === $f, "forme $f de : $q");
$a = analyse_sparql("PREFIX ex: <http://ex.org/>\nPREFIX : <http://vide/>\nSELECT * {}");
verifie($a['prefixes'] === array('ex' => 'http://ex.org/', '' => 'http://vide/'), 'préfixes déclarés par la requête');

verifie(retire_marge("\n\t\t\tSELECT ?x\n\t\t\tWHERE {\n\t\t\t  ?x a ?c .\n\t\t\t}\n\t\t") === "SELECT ?x\nWHERE {\n  ?x a ?c .\n}",
	'marge des exemples retirée, indentation gardée');

//------------------------------------------------------------
// Affichage
//------------------------------------------------------------
$p = array('ex' => 'http://ex.org/', 'exb' => 'http://ex.org/b/');
verifie(abrege_iri('http://ex.org/a', $p) === 'ex:a', 'IRI abrégée');
verifie(abrege_iri('http://ex.org/b/c', $p) === 'exb:c', 'préfixe le plus long choisi');
verifie(abrege_iri('http://ex.org/a/b', array('ex' => 'http://ex.org/')) === '<http://ex.org/a/b>', 'IRI non abrégeable');
$t = lit_ntriples("<http://a> <http://b> \"l\\u00E9\\\"on\\n\"@fr .\n_:b1 <http://b> \"3\"^^<http://www.w3.org/2001/XMLSchema#integer> .\n");
verifie(count($t['triplets']) == 2, 'N-Triples : deux triplets lus');
verifie(($t['triplets'][0][2]['value'] ?? '') === "lé\"on\n" && ($t['triplets'][0][2]['xml:lang'] ?? '') === 'fr', 'N-Triples : littéral échappé avec langue');
verifie(($t['triplets'][1][0]['type'] ?? '') === 'bnode' && ($t['triplets'][1][2]['datatype'] ?? '') === PREFIXES_STANDARD['xsd'].'integer', 'N-Triples : nœud anonyme et type');
verifie(strpos(affiche_terme(array('type' => 'literal', 'value' => '<b>'), array()), '&lt;b&gt;') !== false, 'littéral échappé en HTML');
verifie(strpos(message_oxigraph("Error: x in ".DOSSIER_TMP."/copie_1\n\nStack backtrace:\n 0: y"), DOSSIER_TMP) === false, 'chemin du serveur masqué');

//------------------------------------------------------------
// Jeux de données et exemples
//------------------------------------------------------------
$jeux = liste_jeux();
verifie(isset($jeux['cinema'], $jeux['amis']), 'jeux cinema et amis trouvés');
verifie(isset(prefixes_jeu('cinema')['cine']), 'préfixes du jeu lus');
charge_config();
verifie(contenu_xml(charge_config()->accueil) !== '', "page d'accueil dans config.xml");

foreach ($jeux as $nom => $j) {
	verifie(count($j['exemples']) > 0, "$nom : a des exemples");
	foreach ($j['exemples'] as $ex) {
		$r = execute_sparql($nom, $ex[1]);
		verifie($r['ok'], "$nom : exemple « $ex[0] » : ".$r['message']);
		$h = affiche_resultat($r, prefixes_jeu($nom));
		verifie(strpos($h, 'statut ok') !== false, "$nom : affichage de « $ex[0] »");
	}
	reinitialise_jeu($nom);
}

//------------------------------------------------------------
// Exécution sur la copie de session
//------------------------------------------------------------
$total = function () { return compte_triplets(store_copie('amis')); };
$n0 = $total();
verifie($n0 > 0, 'triplets comptés');
$r = execute_sparql('amis', 'PREFIX foaf: <http://xmlns.com/foaf/0.1/> SELECT ?n WHERE { ?p foaf:name ?n } ORDER BY ?n');
verifie($r['ok'] && $r['forme'] === 'SELECT' && count($r['resultat']['lignes']) == 9, 'SELECT : 9 noms');
verifie(($r['resultat']['lignes'][0]['n']['value'] ?? '') === 'Alice Martin', 'SELECT : tri');
$r = execute_sparql('amis', 'ASK { ?s ?p "Angers" }');
verifie($r['ok'] && $r['forme'] === 'ASK' && $r['resultat'] === true, 'ASK vrai');
$r = execute_sparql('amis', 'PREFIX ex: <http://example.org/amis/> CONSTRUCT { ?b ?p ?a } WHERE { ?a ?p ?b . FILTER(?a = ex:gabriel && isIRI(?b)) }');
verifie($r['ok'] && count($r['resultat']['triplets']) == 2, 'CONSTRUCT : triplets inversés');

$r = execute_sparql('amis', 'PREFIX ex: <http://example.org/amis/> INSERT DATA { ex:ines ex:ville "Brest" ; ex:x 1 }');
verifie($r['ok'] && $r['forme'] === 'UPDATE' && $r['resultat']['apres'] === $n0 + 2, 'INSERT DATA : +2 triplets');
$r = execute_sparql('amis', 'PREFIX ex: <http://example.org/amis/> INSERT DATA { ex:ines ex:y 2 } ; DELETE DATA { ex:ines ex:y }');
verifie(!$r['ok'] && $total() === $n0 + 2, 'mise à jour en erreur : rien appliqué');
$r = execute_sparql('amis', 'PREFIX ex: <http://example.org/amis/> DELETE WHERE { ex:ines ?p ?o }');
verifie($r['ok'] && $r['resultat']['apres'] === $n0, 'DELETE WHERE : retour au total initial');

// Deux sessions ne partagent pas leurs copies
execute_sparql('amis', 'INSERT DATA { <http://t/a> <http://t/b> "session 1" }');
$session1 = $_SESSION;
$_SESSION = array();
$r = execute_sparql('amis', 'ASK { <http://t/a> ?p ?o }');
verifie($r['ok'] && $r['resultat'] === false, "une autre session ne voit pas les modifications");
reinitialise_jeu('amis');
$_SESSION = $session1;
$r = execute_sparql('amis', 'ASK { <http://t/a> ?p ?o }');
verifie($r['ok'] && $r['resultat'] === true, 'la session garde ses modifications');
reinitialise_jeu('amis');
$r = execute_sparql('amis', 'ASK { <http://t/a> ?p ?o }');
verifie($r['ok'] && $r['resultat'] === false, 'retour au jeu d\'origine');

// Limites
$r = execute_sparql('amis', 'SELECT (COUNT(*) AS ?n) WHERE { ?a ?b ?c . ?d ?e ?f . ?g ?h ?i . ?j ?k ?l . ?m ?n2 ?o }');
verifie(!$r['ok'] && strpos($r['message'], 'arrêtée') !== false, 'requête trop longue arrêtée');
verifie(!preg_match('/oxigraph/', (string)shell_exec('pgrep -a oxigraph')), 'aucun processus Oxigraph restant');
$r = execute_sparql('amis', 'SELECT * WHERE { SERVICE <http://x.org/s> { ?s ?p ?o } }');
verifie(!$r['ok'] && strpos($r['message'], 'SERVICE') !== false, 'SERVICE refusé');
$r = execute_sparql('amis', str_repeat('#', LONGUEUR_MAX_REQUETE + 1));
verifie(!$r['ok'], 'texte de requête trop long refusé');
$n0 = $total();
$r = execute_sparql('amis', 'INSERT { ?a <http://t/p> ?v } WHERE { ?a ?b ?c . ?d ?e ?f . ?g ?h ?i . '
	.'BIND (CONCAT(STR(?c), STR(?f), STR(?i), "remplissage pour dépasser la taille permise d\'une copie") AS ?v) }');
verifie(!$r['ok'] && $total() === $n0, 'mise à jour trop volumineuse refusée : '.$r['message']);
$r = execute_sparql('amis', 'SELEC * WHERE');
verifie(!$r['ok'] && $r['message'] !== '', 'erreur de syntaxe signalée');
$r = execute_sparql('amis', '');
verifie(!$r['ok'], 'requête vide refusée');

// Purge
$copie = store_copie('amis');
touch($copie, time() - 4000);
purge_copies(3600);
verifie(!is_dir($copie), 'copie inactive purgée');
verifie(!is_null(store_copie('amis')), 'copie refaite après la purge');

//------------------------------------------------------------
// Application servie par PHP (contrôleur, jeton)
//------------------------------------------------------------
$port = 18000 + getmypid() % 1000;
$racine = realpath(__DIR__.'/..');
$serveur = proc_open(array(PHP_BINARY, '-S', "127.0.0.1:$port", '-t', $racine), array(1 => array('file', '/dev/null', 'w'), 2 => array('file', '/dev/null', 'w')), $tubes,
	$racine, array_merge(getenv(), array('SPARQLSANDBOX_INI' => '/nonexistent')));
usleep(500000);
$cookies = tempnam($travail, 'cookies');
function http($url, $post = null) {
	global $cookies;
	$c = curl_init($url);
	curl_setopt_array($c, array(CURLOPT_RETURNTRANSFER => true, CURLOPT_COOKIEJAR => $cookies, CURLOPT_COOKIEFILE => $cookies,
		CURLOPT_TIMEOUT => 20, CURLOPT_HEADER => false));
	if (!is_null($post)) curl_setopt($c, CURLOPT_POSTFIELDS, http_build_query($post));
	$corps = curl_exec($c);
	$code = curl_getinfo($c, CURLINFO_RESPONSE_CODE);
	curl_close($c);
	return array($code, (string)$corps);
}
if (function_exists('curl_init')) {
	list($code, $page) = http("http://127.0.0.1:$port/?jeu=cinema");
	verifie($code == 200 && strpos($page, 'Interroger ce jeu') !== false, 'page d\'un jeu servie');
	preg_match('/"csrf":"([0-9a-f]+)"/', $page, $m);
	$jeton = $m[1] ?? '';
	verifie($jeton !== '', 'jeton dans la page');
	list($code, $corps) = http("http://127.0.0.1:$port/controler.php", array('action' => 'executer', 'jeu' => 'cinema', 'requete' => 'ASK {}'));
	verifie($code == 403, 'contrôleur : refus sans jeton');
	list($code, $corps) = http("http://127.0.0.1:$port/controler.php", array('action' => 'executer', 'jeu' => 'cinema', 'csrf' => $jeton,
		'requete64' => base64_encode('PREFIX cine: <http://example.org/cinema/vocab#> SELECT ?f WHERE { ?f a cine:Film }')));
	$j = json_decode($corps, true);
	verifie($code == 200 && ($j['ok'] ?? false) && strpos($j['html'], '9 lignes') !== false, 'contrôleur : requête en base64 exécutée');
	list($code, $corps) = http("http://127.0.0.1:$port/controler.php", array('action' => 'executer', 'jeu' => '../x', 'csrf' => $jeton, 'requete' => 'ASK {}'));
	verifie($code == 400, 'contrôleur : jeu inconnu refusé');
	list($code, $corps) = http("http://127.0.0.1:$port/controler.php", array('action' => 'explorer', 'jeu' => 'cinema', 'csrf' => $jeton));
	verifie($code == 200 && strpos($corps, 'cine:Film') !== false, 'contrôleur : exploration');
	list($code, $page) = http("http://127.0.0.1:$port/");
	verifie($code == 200 && strpos($page, 'Bienvenue') !== false, "page d'accueil servie");
} else echo "(extension curl absente : tests HTTP sautés)\n";
proc_terminate($serveur);
proc_close($serveur);

echo "\n$succes vérifications réussies, ".count($echecs)." échec(s)\n";
exit($echecs ? 1 : 0);
