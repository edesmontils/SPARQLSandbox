<?php
// SPARQL Sandbox : fonctions communes (jeux de données, analyse des requêtes,
// exécution par Oxigraph, copies de session, affichage des résultats)

//======================================================
// Limites (même esprit que SQL Sandbox)
//======================================================

// Lignes d'un résultat affichées (SELECT) ou triplets (CONSTRUCT, DESCRIBE)
define('MAX_LIGNES', 1000);
// Durée maximale d'une requête (secondes)
if (!defined('DELAI_MAX')) define('DELAI_MAX', 5); // réglable avant l'inclusion (tests)
// Taille maximale du texte d'une requête (octets)
define('LONGUEUR_MAX_REQUETE', 64 * 1024);
// Taille maximale de la sortie d'Oxigraph lue (octets) : au-delà, la requête est arrêtée
define('SORTIE_MAX', 4 * 1024 * 1024);
// Mémoire virtuelle d'un processus Oxigraph (Ko, ulimit -v). En dessous d'environ 1 Go,
// RocksDB ne peut plus créer ses fils d'exécution et Oxigraph s'arrête aussitôt.
define('MEMOIRE_MAX_KO', 1536 * 1024);
// Taille maximale du store d'une session (octets)
if (!defined('TAILLE_MAX_COPIE')) define('TAILLE_MAX_COPIE', 20 * 1024 * 1024);
// Total des stores de session, et espace libre à garder sur le disque (octets)
define('OCCUPATION_MAX', 1024 * 1024 * 1024);
define('ESPACE_LIBRE_MIN', 200 * 1024 * 1024);
// Requêtes simultanées par adresse IP, et attente d'une place (secondes)
define('REQUETES_PAR_IP', 4);
define('ATTENTE_PLACE', 3);

// Préfixes connus de tous les jeux de données
const PREFIXES_STANDARD = array(
	'rdf'  => 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
	'rdfs' => 'http://www.w3.org/2000/01/rdf-schema#',
	'xsd'  => 'http://www.w3.org/2001/XMLSchema#',
	'owl'  => 'http://www.w3.org/2002/07/owl#',
	'foaf' => 'http://xmlns.com/foaf/0.1/',
	'dc'   => 'http://purl.org/dc/terms/',
	'schema' => 'http://schema.org/',
);

//======================================================
// Paramètres reçus, jeton anti-CSRF
//======================================================

function param($nom) {
	if (isset($_POST[$nom]) && is_string($_POST[$nom])) return $_POST[$nom];
	if (isset($_GET[$nom]) && is_string($_GET[$nom])) return $_GET[$nom];
	return null;
}

// Texte de la requête : en base64 (requete64), pour qu'un pare-feu applicatif ne le
// prenne pas pour une attaque, ou en clair (requete)
function requete_recue() {
	$b64 = isset($_POST['requete64']) && is_string($_POST['requete64']) ? $_POST['requete64'] : null;
	if (!is_null($b64)) {
		$texte = base64_decode($b64, true);
		return ($texte !== false && mb_check_encoding($texte, 'UTF-8')) ? $texte : null;
	}
	$texte = isset($_POST['requete']) && is_string($_POST['requete']) ? $_POST['requete'] : null;
	return (!is_null($texte) && mb_check_encoding($texte, 'UTF-8')) ? $texte : null;
}

// Le jeton n'est accepté qu'en POST
function jeton_valide() {
	return isset($_POST['csrf'], $_SESSION['csrf']) && is_string($_POST['csrf'])
	    && hash_equals($_SESSION['csrf'], $_POST['csrf']);
}

function html($texte) {
	return htmlspecialchars((string)$texte, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

// Adresse d'un fichier statique, avec sa date pour que le navigateur recharge une version modifiée
function url_fichier($chemin) {
	$f = __DIR__.'/'.ltrim($chemin, './');
	return html($chemin.(is_file($f) ? '?v='.filemtime($f) : ''));
}

//======================================================
// Configuration et jeux de données
//======================================================

function charge_config() {
	static $config = null;
	if (is_null($config)) $config = new SimpleXMLElement(__DIR__.'/config.xml', LIBXML_NOCDATA, true);
	return $config;
}

// Contenu HTML d'un élément XML (sans la balise elle-même)
function contenu_xml($element) {
	// un élément absent donne un SimpleXMLElement vide (count() = 0 et pas de nœud DOM) : pas de description
	if (is_null($element) || !isset($element[0])) return '';
	$h = '';
	foreach (dom_import_simplexml($element)->childNodes as $n) $h .= $n->ownerDocument->saveXML($n);
	return trim($h);
}

// Jeux de données : un dossier de donnees/ par jeu, décrit par son config.xml
// nom => [titre, fichiers, référence, description (HTML), exemples [[titre, requête]...]].
// Un jeu peut avoir plusieurs fichiers (par exemple l'ontologie et les instances), chargés
// ensemble dans le graphe par défaut.
// Jeux de données de l'installation : ceux de donnees/ (partagés par tous), puis les jeux vierges personnels de la session
function liste_jeux() {
	$jeux = jeux_partages();
	foreach (jeux_perso() as $id => $jeu) $jeux[$id] = $jeu;
	return $jeux;
}

function jeux_partages() {
	static $jeux = null;
	if (!is_null($jeux)) return $jeux;
	$jeux = array();
	foreach (glob(__DIR__.'/donnees/*/config.xml') ?: array() as $conf) {
		try {
			$x = new SimpleXMLElement($conf, LIBXML_NOCDATA, true);
		} catch (Exception $e) {
			error_log("SPARQLSandbox : $conf invalide : ".$e->getMessage());
			continue;
		}
		$nom = (string)$x['nom'];
		$fichiers = array();
		foreach ($x->fichier as $f) $fichiers[] = dirname($conf).'/'.basename((string)$f['nom']);
		$absents = array_filter($fichiers, function ($f) { return !is_file($f); });
		if (!preg_match('/^[a-z0-9][a-z0-9_-]*$/D', $nom) || !$fichiers || $absents) {
			error_log("SPARQLSandbox : $conf ignoré (nom invalide ou fichier de données absent)");
			continue;
		}
		$exemples = array();
		if (isset($x->exemples)) foreach ($x->exemples->exemple as $ex)
			$exemples[] = array((string)$ex['titre'], retire_marge((string)$ex));
		$jeux[$nom] = array(
			'titre' => (string)$x->titre !== '' ? (string)$x->titre : $nom,
			'fichiers' => $fichiers,
			// formes SHACL facultatives (coherence.php)
			'formes' => array_values(array_filter(array_map(function ($f) use ($conf) {
				return dirname($conf).'/'.basename((string)$f['nom']); }, iterator_to_array($x->formes, false)), 'is_file')),
			'référence' => (string)$x->référence,
			'description' => contenu_xml($x->description),
			'exemples' => $exemples,
		);
	}
	ksort($jeux, SORT_NATURAL | SORT_FLAG_CASE);
	return $jeux;
}

//------------------------------------------------------
// Jeux vierges personnels : un étudiant crée un jeu de données vide, privé à sa session, pour construire une ontologie
// de zéro avec l'éditeur ; il le supprime quand il veut. Rien de partagé n'est touché : le jeu n'existe que dans la
// session (titre) et dans sa copie de travail, et disparaît avec elles.
//------------------------------------------------------

const JEUX_PERSO_MAX = 5;
const JEU_PERSO_TITRE_MAX = 60;

function est_jeu_perso($id) { return is_string($id) && isset($_SESSION['jeux_perso'][$id]); }

// Espace de noms du vocabulaire (voc:) et des instances (ex:) d'un jeu vierge personnel
function jeu_perso_espaces($id) { return array('voc' => 'http://example.org/'.$id.'/vocab#', 'ex' => 'http://example.org/'.$id.'/'); }

// Jeux personnels de la session, au format de jeux_partages()
function jeux_perso() {
	$sortie = array();
	$liste = $_SESSION['jeux_perso'] ?? array();
	if (!is_array($liste)) return $sortie;
	foreach ($liste as $id => $j) {
		if (!is_string($id) || !preg_match('/^perso-[0-9a-f]{8}$/D', $id) || !is_array($j)) continue;
		$titre = (string)($j['titre'] ?? $id);
		$sortie[$id] = array(
			'titre' => $titre, 'fichiers' => array(), 'formes' => array(), 'référence' => '', 'perso' => true,
			'description' => "<p>Votre jeu de données <strong>vierge</strong> : il ne contient rien. Construisez-y une ontologie avec "
				."<strong>✏️ Éditer l'ontologie</strong> (concepts, propriétés, instances, axiomes), ou importez un fichier Turtle depuis l'éditeur (« Import / export »).</p>"
				."<p>Il est <strong>privé à cette session</strong> et disparaît avec elle : exportez-le en Turtle avant de partir. "
				."Préfixes : <code>voc:</code> pour le vocabulaire, <code>ex:</code> pour les instances.</p>",
			'exemples' => array(array('Tout le contenu', "SELECT ?s ?p ?o\nWHERE {\n  ?s ?p ?o .\n}\nLIMIT 50")),
		);
	}
	return $sortie;
}

// Crée un jeu vierge personnel ; renvoie array(ok, identifiant ou message d'erreur)
function cree_jeu_perso($titre) {
	if (!isset($_SESSION)) return array(false, 'Session indisponible.');
	$titre = trim(preg_replace('/[\x00-\x1f\x7f]+/u', ' ', (string)$titre));
	if ($titre === '' || mb_strlen($titre) > JEU_PERSO_TITRE_MAX || !mb_check_encoding($titre, 'UTF-8'))
		return array(false, 'Donnez un titre de 1 à '.JEU_PERSO_TITRE_MAX.' caractères.');
	if (count($_SESSION['jeux_perso'] ?? array()) >= JEUX_PERSO_MAX)
		return array(false, 'Vous avez déjà '.JEUX_PERSO_MAX.' jeux vierges : supprimez-en un d\'abord.');
	do { $id = 'perso-'.bin2hex(random_bytes(4)); } while (isset($_SESSION['jeux_perso'][$id]) || isset(jeux_partages()[$id]));
	$_SESSION['jeux_perso'][$id] = array('titre' => $titre, 'cree' => time());
	return array(true, $id);
}

// Supprime un jeu vierge personnel, avec sa copie de travail et tout ce qui s'y rattache ; renvoie array(ok, message)
function supprime_jeu_perso($id) {
	if (!est_jeu_perso($id)) return array(false, "Ce jeu n'est pas un de vos jeux vierges : il ne peut pas être supprimé ici.");
	reinitialise_jeu($id);            // copie de travail, cohérence, préfixes ajoutés
	unset($_SESSION['jeux_perso'][$id], $_SESSION['peuplement'][$id]);
	return array(true, 'Jeu supprimé.');
}

// Store vide, point de départ des jeux vierges (créé une fois pour toutes dans le dossier de travail)
function store_vide(&$erreur = null) {
	if (is_null(DOSSIER_TMP)) { $erreur = "Aucun dossier de travail n'est accessible en écriture."; return null; }
	$dossier = DOSSIER_TMP.'/origine_vide';
	if (is_dir($dossier)) return $dossier;
	$v = verrou('origine_vide', 30);
	if (!is_dir($dossier)) {
		$tmp = $dossier.'.tmp'.getmypid();
		supprime_dossier($tmp);
		$r = lance_oxigraph(array('update', '--location', $tmp), 'INSERT DATA { }');
		if (!($r['code'] === 0 && is_dir($tmp) && @rename($tmp, $dossier))) {
			supprime_dossier($tmp);
			$erreur = "Le jeu vierge n'a pas pu être préparé.";
		}
	}
	libere($v);
	return is_dir($dossier) ? $dossier : null;
}

// Texte d'un exemple sans la marge due à l'indentation du XML (l'indentation propre à la
// requête est gardée)
function retire_marge($texte) {
	$lignes = explode("\n", str_replace("\r", '', trim($texte, "\n\r")));
	$marge = null;
	foreach ($lignes as $l) {
		if (trim($l) === '') continue;
		$n = strlen($l) - strlen(ltrim($l, " \t"));
		$marge = is_null($marge) ? $n : min($marge, $n);
	}
	foreach ($lignes as &$l) $l = rtrim(substr($l, min((int)$marge, strlen($l) - strlen(ltrim($l, " \t")))));
	return trim(implode("\n", $lignes));
}

// Préfixes déclarés dans les fichiers de données d'un jeu (@prefix ou PREFIX)
// Préfixes déclarés dans les fichiers du jeu, puis ceux que l'étudiant a ajoutés à sa copie (voir plus bas)
function prefixes_jeu($jeu) {
	return array_merge(prefixes_fichiers($jeu), prefixes_ajoutes($jeu));
}

function prefixes_fichiers($jeu) {
	if (est_jeu_perso($jeu)) return jeu_perso_espaces($jeu);
	$jeux = liste_jeux();
	if (!isset($jeux[$jeu])) return array();
	$texte = '';
	foreach ($jeux[$jeu]['fichiers'] as $f) $texte .= (string)@file_get_contents($f, false, null, 0, 256 * 1024)."\n";
	preg_match_all('/^\s*@?prefix\s+([A-Za-z][\w.-]*)?:\s*<([^>\s]*)>/mi', $texte, $m, PREG_SET_ORDER);
	$p = array();
	foreach ($m as $d) $p[$d[1]] = $d[2];
	return $p;
}

//------------------------------------------------------
// Préfixes ajoutés par l'étudiant : vocabulaires standards ou « métier », gardés en session
// pour la copie du jeu (ils servent à abréger les IRI, dans les requêtes comme dans l'éditeur)
//------------------------------------------------------

const PREFIXES_AJOUTES_MAX = 20;
// Vocabulaires courants proposés en un clic : préfixe => array(espace de noms, description)
const PREFIXES_CATALOGUE = array(
	'skos'  => array('http://www.w3.org/2004/02/skos/core#', 'SKOS : thésaurus, concepts et vocabulaires contrôlés'),
	'dce'   => array('http://purl.org/dc/elements/1.1/', 'Dublin Core, éléments (titre, créateur, sujet…)'),
	'org'   => array('http://www.w3.org/ns/org#', 'Organisations, unités et rôles'),
	'prov'  => array('http://www.w3.org/ns/prov#', 'Provenance : qui a produit quoi, comment'),
	'dcat'  => array('http://www.w3.org/ns/dcat#', 'Catalogues de jeux de données'),
	'vcard' => array('http://www.w3.org/2006/vcard/ns#', 'Cartes de visite : personnes, adresses, contacts'),
	'geo'   => array('http://www.w3.org/2003/01/geo/wgs84_pos#', 'Positions géographiques (latitude, longitude)'),
	'time'  => array('http://www.w3.org/2006/time#', 'Temps : instants, intervalles, durées'),
	'sh'    => array('http://www.w3.org/ns/shacl#', 'SHACL : formes de validation'),
	'void'  => array('http://rdfs.org/ns/void#', 'Description de jeux de données liés'),
	'sioc'  => array('http://rdfs.org/sioc/ns#', 'Communautés en ligne : forums, messages, utilisateurs'),
	'gr'    => array('http://purl.org/goodrelations/v1#', 'Commerce : offres, produits, entreprises'),
	'wd'    => array('http://www.wikidata.org/entity/', 'Wikidata : entités'),
	'wdt'   => array('http://www.wikidata.org/prop/direct/', 'Wikidata : propriétés directes'),
	'dbo'   => array('http://dbpedia.org/ontology/', 'DBpedia : ontologie'),
	'dbr'   => array('http://dbpedia.org/resource/', 'DBpedia : ressources'),
);

function prefixes_ajoutes($jeu) {
	$p = $_SESSION['prefixes'][$jeu] ?? array();
	return is_array($p) ? $p : array();
}

// Tous les préfixes connus de la copie : standard, du jeu, ajoutés (les derniers l'emportent)
function prefixes_connus($jeu) { return array_merge(PREFIXES_STANDARD, prefixes_jeu($jeu)); }

// Ajoute le préfixe $prefixe pour l'espace de noms $iri à la copie du jeu ; renvoie array(ok, message)
function ajoute_prefixe($jeu, $prefixe, $iri) {
	if (!isset(liste_jeux()[$jeu])) return array(false, 'Jeu inconnu.');
	$prefixe = trim((string)$prefixe); $iri = trim((string)$iri);
	if (!preg_match('/^[A-Za-z][A-Za-z0-9_-]{0,19}$/D', $prefixe)) return array(false, 'Préfixe invalide : une lettre puis des lettres, chiffres, _ ou - (20 caractères au plus).');
	if (strlen($iri) > 200 || !preg_match('#^https?://[^\s<>"{}|\\^`]+[\#/]$#D', $iri))
		return array(false, "Espace de noms invalide : une adresse http(s) qui se termine par # ou / (par exemple http://example.org/meteo#).");
	$connus = prefixes_connus($jeu);
	if (isset($connus[$prefixe])) return $connus[$prefixe] === $iri ? array(true, "Le préfixe $prefixe: est déjà défini pour cet espace de noms.") : array(false, "Le préfixe $prefixe: est déjà utilisé pour <".$connus[$prefixe].'>.');
	$autre = array_search($iri, $connus, true);
	if ($autre !== false) return array(false, "Cet espace de noms a déjà le préfixe $autre:.");
	if (count(prefixes_ajoutes($jeu)) >= PREFIXES_AJOUTES_MAX) return array(false, 'Vous avez déjà ajouté '.PREFIXES_AJOUTES_MAX.' préfixes : retirez-en un d\'abord.');
	$_SESSION['prefixes'][$jeu][$prefixe] = $iri;
	return array(true, "Préfixe $prefixe: ajouté.");
}

// Retire un préfixe ajouté par l'étudiant (ceux du jeu et les standards restent) ; renvoie array(ok, message)
function retire_prefixe($jeu, $prefixe) {
	if (!isset(prefixes_ajoutes($jeu)[$prefixe])) return array(false, "Le préfixe $prefixe: n'a pas été ajouté : il ne peut pas être retiré.");
	unset($_SESSION['prefixes'][$jeu][$prefixe]);
	return array(true, "Préfixe $prefixe: retiré.");
}

// Pour la boîte de dialogue : préfixes du jeu, standards, ajoutés, et vocabulaires du catalogue pas encore définis
function liste_prefixes($jeu) {
	$connus = prefixes_connus($jeu);
	$catalogue = array();
	foreach (PREFIXES_CATALOGUE as $p => $d)
		if (!isset($connus[$p]) && !in_array($d[0], $connus, true)) $catalogue[] = array('prefixe' => $p, 'iri' => $d[0], 'description' => $d[1]);
	$fichiers = prefixes_fichiers($jeu);
	return array('jeu' => $fichiers, 'standard' => array_diff_key(PREFIXES_STANDARD, $fichiers), 'ajoutes' => prefixes_ajoutes($jeu), 'catalogue' => $catalogue);
}

//======================================================
// Analyse d'une requête SPARQL
//======================================================

// Découpe une requête en jetons, en mettant à part commentaires, chaînes et IRI, pour
// reconnaître les mots-clés sans être trompé par leur présence dans un texte.
// Renvoie une liste de [type, valeur] (types : mot, pname, iri, var, chaine, nombre, ponct).
function jetons_sparql($q) {
	$motifs = array(
		'espace' => '\s+',
		'commentaire' => '#[^\n\r]*',
		'chaine' => "'''(?:[^'\\\\]|\\\\.|'(?!''))*(?:'''|$)|\"\"\"(?:[^\"\\\\]|\\\\.|\"(?!\"\"))*(?:\"\"\"|$)"
		           ."|'(?:[^'\\\\\\n\\r]|\\\\.)*(?:'|$)|\"(?:[^\"\\\\\\n\\r]|\\\\.)*(?:\"|$)",
		'iri' => '<[^<>"{}|^`\\\\\x00-\x20]*>',
		'var' => '[?$][\p{L}\p{N}_]+',
		'pname' => '(?:[\p{L}][\p{L}\p{N}_.-]*)?:(?:[\p{L}\p{N}_:%-]|\\\\.|\.(?=[\p{L}\p{N}_:%-]))*',
		'mot' => '[\p{L}_][\p{L}\p{N}_]*',
		'nombre' => '[0-9]+(?:\.[0-9]*)?(?:[eE][+-]?[0-9]+)?',
		'ponct' => '.',
	);
	$regex = '/\G(?:';
	$noms = array();
	foreach ($motifs as $nom => $m) { $regex .= ($noms ? '|' : '')."($m)"; $noms[] = $nom; }
	$regex .= ')/su';
	$jetons = array();
	$pos = 0;
	$long = strlen($q);
	while ($pos < $long && preg_match($regex, $q, $m, 0, $pos)) {
		if ($m[0] === '') break;
		$pos += strlen($m[0]);
		for ($i = 1; $i < count($m); $i++) if (isset($m[$i]) && $m[$i] !== '') {
			if ($noms[$i - 1] !== 'espace' && $noms[$i - 1] !== 'commentaire') $jetons[] = array($noms[$i - 1], $m[$i]);
			break;
		}
	}
	return $jetons;
}

// Points d'accès SPARQL que SERVICE peut interroger : réglage « services_autorises » de
// sparqlsandbox.ini (liste séparée par des virgules ou des espaces, ou services_autorises[]
// répété). Par défaut : Wikidata et DBpedia ; un réglage vide (services_autorises =) les
// interdit tous. Seules les adresses http(s) sont retenues, et la comparaison est exacte
// (aucun préfixe, aucun joker).
const SERVICES_PAR_DEFAUT = array('https://query.wikidata.org/sparql', 'https://dbpedia.org/sparql');
function services_autorises() {
	$r = reglages();
	if (!array_key_exists('services_autorises', $r)) return SERVICES_PAR_DEFAUT;
	$brut = $r['services_autorises'];
	if (!is_array($brut)) $brut = array($brut);
	$liste = array();
	foreach ($brut as $b)
		foreach (preg_split('/[\s,]+/', (string)$b, -1, PREG_SPLIT_NO_EMPTY) as $u)
			if (preg_match('#^https?://[^\s<>"]+$#i', $u)) $liste[] = $u;
	return array_values(array_unique($liste));
}

// Forme d'une requête (SELECT, ASK, CONSTRUCT, DESCRIBE, ou UPDATE pour une mise à jour),
// préfixes qu'elle déclare, et refus éventuel (message) :
// - LOAD ferait télécharger un document du web par le serveur : toujours refusé ;
// - SERVICE (requête fédérée) ne l'est que vers un point d'accès de $services (par défaut,
//   services_autorises()) : une variable, une IRI relative ou une adresse hors liste est refusée.
function analyse_sparql($q, $services = null) {
	if (is_null($services)) $services = services_autorises();
	$res = array('forme' => null, 'prefixes' => array(), 'refus' => null, 'services' => array());
	$jetons = jetons_sparql($q);
	$n = count($jetons);
	for ($i = 0; $i < $n; $i++) {
		list($type, $val) = $jetons[$i];
		if ($type !== 'mot') continue;
		$mot = strtoupper($val);
		if ($mot === 'SERVICE') {
			$j = $i + 1;
			if ($j < $n && $jetons[$j][0] === 'mot' && strtoupper($jetons[$j][1]) === 'SILENT') $j++;
			$cible = null;
			if ($j < $n && $jetons[$j][0] === 'iri') $cible = substr($jetons[$j][1], 1, -1);
			elseif ($j < $n && $jetons[$j][0] === 'pname' && isset($res['prefixes'][rtrim(strstr($jetons[$j][1], ':', true), ':')])) {
				$p = strstr($jetons[$j][1], ':', true);
				$cible = $res['prefixes'][$p].substr($jetons[$j][1], strlen($p) + 1);
			}
			if (!$services) $res['refus'] = "Les requêtes fédérées (SERVICE) ne sont pas permises dans SPARQL Sandbox : "
				."elles feraient interroger d'autres serveurs par celui-ci.";
			elseif (is_null($cible)) $res['refus'] = "SERVICE doit être suivi de l'IRI d'un point d'accès autorisé "
				."(pas d'une variable) : ".implode(', ', $services).'.';
			elseif (!in_array($cible, $services, true)) $res['refus'] = "Le point d'accès <$cible> n'est pas autorisé pour SERVICE. "
				."Points d'accès autorisés : ".implode(', ', $services).'.';
			else $res['services'][] = $cible;
		}
		elseif ($mot === 'LOAD') $res['refus'] = "LOAD n'est pas permis dans SPARQL Sandbox : il ferait télécharger un document "
			."du web par le serveur. Ajoutez les triplets avec INSERT DATA.";
		if (is_null($res['refus']) && $mot === 'PREFIX' && $i + 2 < $n && $jetons[$i + 1][0] === 'pname' && $jetons[$i + 2][0] === 'iri')
			$res['prefixes'][rtrim($jetons[$i + 1][1], ':')] = substr($jetons[$i + 2][1], 1, -1);
		if (is_null($res['forme'])) {
			if (in_array($mot, array('SELECT', 'ASK', 'CONSTRUCT', 'DESCRIBE'))) $res['forme'] = $mot;
			elseif (in_array($mot, array('INSERT', 'DELETE', 'CLEAR', 'CREATE', 'DROP', 'COPY', 'MOVE', 'ADD', 'WITH', 'LOAD')))
				$res['forme'] = 'UPDATE';
		}
		if (!is_null($res['refus'])) break;
	}
	return $res;
}

//======================================================
// Exécution d'Oxigraph
//======================================================

// Chemin de l'exécutable oxigraph : réglage « oxigraph » de sparqlsandbox.ini, variable
// d'environnement SPARQLSANDBOX_OXIGRAPH, bin/oxigraph du site, puis le PATH
function chemin_oxigraph() {
	return chemin_programme('oxigraph');
}

// Chemin d'un exécutable ($nom : oxigraph, pyshacl) : réglage du même nom dans
// sparqlsandbox.ini, variable d'environnement SPARQLSANDBOX_<NOM>, bin/<nom> du site,
// puis le PATH ; null s'il est introuvable
function chemin_programme($nom) {
	static $chemins = array();
	if (array_key_exists($nom, $chemins)) return $chemins[$nom];
	$r = reglages();
	$candidats = array();
	if (!empty($r[$nom])) $candidats[] = $r[$nom];
	if (getenv('SPARQLSANDBOX_'.strtoupper($nom))) $candidats[] = getenv('SPARQLSANDBOX_'.strtoupper($nom));
	$candidats[] = __DIR__.'/bin/'.$nom;
	$path = (string)getenv('PATH');
	foreach (array_merge(explode(':', $path), array('/usr/local/bin', '/usr/bin', getenv('HOME').'/.local/bin')) as $d)
		if ($d !== '') $candidats[] = rtrim($d, '/').'/'.$nom;
	$chemins[$nom] = null;
	foreach ($candidats as $c) if (@is_file($c) && @is_executable($c)) { $chemins[$nom] = $c; break; }
	return $chemins[$nom];
}

// Lance Oxigraph avec les arguments donnés et $entree sur son entrée standard, en
// limitant sa durée ($delai secondes), sa mémoire et la taille de sa sortie.
// Renvoie [code, sortie, erreur, delai_depasse, sortie_trop_longue].
function lance_oxigraph(array $args, $entree = '', $delai = DELAI_MAX) {
	return lance_programme('oxigraph', $args, $entree, $delai);
}

// Même chose pour un exécutable quelconque trouvé par chemin_programme()
function lance_programme($nom, array $args, $entree = '', $delai = DELAI_MAX) {
	$res = array('code' => null, 'sortie' => '', 'erreur' => '', 'delai' => false, 'trop' => false);
	$bin = chemin_programme($nom);
	if (is_null($bin) || !function_exists('proc_open')) {
		$res['erreur'] = "$nom est introuvable (ou proc_open est désactivé) : voir l'installation dans le README.";
		error_log('SPARQLSandbox : '.$res['erreur']);
		return $res;
	}
	$cmd = array_merge(array('/bin/sh', '-c', 'ulimit -v '.MEMOIRE_MAX_KO.' 2>/dev/null; exec "$0" "$@"', $bin), $args);
	$env = array('PATH' => '/usr/local/bin:/usr/bin:/bin', 'RUST_BACKTRACE' => '0', 'LANG' => 'C.UTF-8',
	             'HOME' => (string)DOSSIER_TMP);
	$p = @proc_open($cmd, array(0 => array('pipe', 'r'), 1 => array('pipe', 'w'), 2 => array('pipe', 'w')), $tubes, DOSSIER_TMP, $env);
	if (!is_resource($p)) { $res['erreur'] = "Impossible de lancer $nom."; return $res; }
	if ($entree !== '') fwrite($tubes[0], $entree);
	fclose($tubes[0]);
	stream_set_blocking($tubes[1], false);
	stream_set_blocking($tubes[2], false);
	$fin = microtime(true) + $delai;
	$ouverts = array(1 => $tubes[1], 2 => $tubes[2]);
	while ($ouverts) {
		$reste = $fin - microtime(true);
		if ($reste <= 0) { $res['delai'] = true; break; }
		$lire = array_values($ouverts); $w = null; $e = null;
		if (@stream_select($lire, $w, $e, (int)$reste, (int)(($reste - floor($reste)) * 1e6)) === false) break;
		foreach ($ouverts as $k => $t) {
			$morceau = fread($t, 65536);
			if ($morceau !== false && $morceau !== '') {
				if ($k == 1) $res['sortie'] .= $morceau; else $res['erreur'] .= substr($morceau, 0, 65536);
			}
			if (feof($t)) unset($ouverts[$k]);
		}
		if (strlen($res['sortie']) > SORTIE_MAX) { $res['trop'] = true; break; }
	}
	$etat = proc_get_status($p);
	if ($etat['running']) proc_terminate($p, 9);
	fclose($tubes[1]);
	fclose($tubes[2]);
	$code = proc_close($p);
	$res['code'] = ($res['delai'] || $res['trop']) ? null : ($etat['running'] ? $code : $etat['exitcode']);
	return $res;
}

// Message d'erreur d'Oxigraph présentable à l'étudiant (sans chemins du serveur)
function message_oxigraph($erreur) {
	$e = preg_replace('/\n\s*Stack backtrace:.*$/s', '', (string)$erreur);
	$e = preg_replace('/^Error:\s*/', '', trim($e));
	if (!is_null(DOSSIER_TMP)) $e = str_replace(DOSSIER_TMP, '…', $e);
	$e = str_replace(__DIR__, '…', $e);
	return $e === '' ? 'Erreur inconnue' : mb_substr($e, 0, 2000);
}

//======================================================
// Stores : jeux d'origine et copies de session
//======================================================

function taille_dossier($d) {
	$t = 0;
	foreach (@scandir($d) ?: array() as $f) {
		if ($f === '.' || $f === '..') continue;
		$c = "$d/$f";
		$t += is_dir($c) && !is_link($c) ? taille_dossier($c) : (int)@filesize($c);
	}
	return $t;
}

function supprime_dossier($d) {
	if (!is_dir($d) || is_link($d)) { if (file_exists($d) || is_link($d)) @unlink($d); return; }
	foreach (@scandir($d) ?: array() as $f) if ($f !== '.' && $f !== '..') supprime_dossier("$d/$f");
	@rmdir($d);
}

function copie_dossier($source, $cible) {
	if (!@mkdir($cible, 0700)) return false;
	foreach (@scandir($source) ?: array() as $f) {
		if ($f === '.' || $f === '..' || $f === 'LOCK') continue;
		$s = "$source/$f"; $c = "$cible/$f";
		if (is_dir($s)) { if (!copie_dossier($s, $c)) return false; }
		elseif (!@copy($s, $c)) return false;
	}
	return true;
}

// Verrou exclusif (fichier du dossier de travail) ; null si impossible
function verrou($nom, $attente = 10) {
	$h = @fopen(DOSSIER_TMP.'/verrou_'.$nom, 'c');
	if ($h === false) return null;
	$fin = microtime(true) + $attente;
	while (!flock($h, LOCK_EX | LOCK_NB)) {
		if (microtime(true) > $fin) { fclose($h); return null; }
		usleep(50000);
	}
	return $h;
}

function libere($h) {
	if (is_resource($h)) { flock($h, LOCK_UN); fclose($h); }
}

// Store du jeu d'origine, construit une fois depuis ses fichiers (Turtle, TriG, N-Triples...)
// et refait quand l'un d'eux change. Il n'est jamais interrogé : il sert de modèle aux copies.
function store_origine($jeu, &$erreur = null) {
	$jeux = liste_jeux();
	if (!isset($jeux[$jeu]) || is_null(DOSSIER_TMP)) { $erreur = "Jeu de données inconnu."; return null; }
	if (!empty($jeux[$jeu]['perso'])) return store_vide($erreur);
	$fichiers = $jeux[$jeu]['fichiers'];
	$empreinte = '';
	foreach ($fichiers as $f) $empreinte .= basename($f).':'.sha1_file($f)."\n";
	$dossier = DOSSIER_TMP.'/origine_'.$jeu.'_'.substr(sha1($empreinte), 0, 16);
	if (is_dir($dossier)) return $dossier;
	$v = verrou('origine_'.$jeu, 30);
	if (is_null($v)) { $erreur = "Le jeu de données est en cours de préparation : réessayez dans un instant."; return null; }
	if (!is_dir($dossier)) {
		$tmp = $dossier.'.tmp'.getmypid();
		supprime_dossier($tmp);
		$r = lance_oxigraph(array_merge(array('load', '--location', $tmp, '--file'), $fichiers), '', 60);
		if ($r['code'] === 0 && is_dir($tmp) && @rename($tmp, $dossier)) {
			// versions précédentes du même jeu
			foreach (glob(DOSSIER_TMP.'/origine_'.$jeu.'_*') ?: array() as $ancien)
				if ($ancien !== $dossier && strpos($ancien, '.tmp') === false) supprime_dossier($ancien);
		} else {
			supprime_dossier($tmp);
			error_log("SPARQLSandbox : chargement de ".implode(', ', $fichiers)." impossible : ".$r['erreur']);
			$erreur = "Le jeu de données n'a pas pu être chargé.";
		}
	}
	libere($v);
	return is_dir($dossier) ? $dossier : null;
}

// Fichier où index.php note le total des copies, lu par espace_sature()
function fichier_occupation() {
	return is_null(DOSSIER_TMP) ? null : DOSSIER_TMP.'/occupation';
}

function espace_sature() {
	$f = fichier_occupation();
	$occupation = (!is_null($f) && is_file($f)) ? (int)@file_get_contents($f) : 0;
	$libre = is_null(DOSSIER_TMP) ? false : @disk_free_space(DOSSIER_TMP);
	$r = reglages();
	$max = !empty($r['occupation_max_mo']) ? (int)$r['occupation_max_mo'] * 1048576 : OCCUPATION_MAX;
	$min = !empty($r['espace_libre_min_mo']) ? (int)$r['espace_libre_min_mo'] * 1048576 : ESPACE_LIBRE_MIN;
	return $occupation > $max || ($libre !== false && $libre < $min);
}

// Store de la session pour un jeu, créé à la première utilisation par copie de l'origine
function store_copie($jeu, &$erreur = null) {
	if (is_null(DOSSIER_TMP)) { $erreur = "Aucun dossier de travail n'est accessible en écriture."; return null; }
	$copie = $_SESSION['copies'][$jeu] ?? null;
	if (is_string($copie) && dirname($copie) === DOSSIER_TMP && is_dir($copie)) { @touch($copie); return $copie; }
	if (espace_sature()) {
		$erreur = "Le serveur manque de place pour une nouvelle copie : réessayez plus tard.";
		return null;
	}
	$origine = store_origine($jeu, $erreur);
	if (is_null($origine)) return null;
	$copie = DOSSIER_TMP.'/copie_'.bin2hex(random_bytes(8)).'_'.$jeu;
	$tmp = $copie.'.tmp';
	if (!copie_dossier($origine, $tmp) || !@rename($tmp, $copie)) {
		supprime_dossier($tmp);
		$erreur = "Impossible de préparer votre copie du jeu de données.";
		return null;
	}
	$_SESSION['copies'][$jeu] = $copie;
	// une copie neuve a la cohérence du jeu d'origine
	$rapport = coherence_origine($jeu);
	if (!is_null($rapport)) note_coherence($jeu, $copie, $rapport);
	return $copie;
}

// Revient au jeu d'origine : la copie est supprimée, la suivante sera refaite
function reinitialise_jeu($jeu) {
	$copie = $_SESSION['copies'][$jeu] ?? null;
	unset($_SESSION['copies'][$jeu], $_SESSION['coherence'][$jeu], $_SESSION['prefixes'][$jeu]);
	if (is_string($copie) && dirname($copie) === DOSSIER_TMP) {
		$v = verrou('copie_'.basename($copie));
		supprime_dossier($copie);
		libere($v);
		@unlink(DOSSIER_TMP.'/verrou_copie_'.basename($copie));
	}
}

// Purge des copies inactives depuis plus de $seuil secondes ; renvoie le total des copies restantes
function purge_copies($seuil) {
	if (is_null(DOSSIER_TMP)) return 0;
	$total = 0;
	foreach (@scandir(DOSSIER_TMP) ?: array() as $f) {
		$c = DOSSIER_TMP.'/'.$f;
		$age = time() - (int)@filemtime($c);
		if (preg_match('/^copie_[0-9a-f]{16}_[a-z0-9_-]+$/D', $f) && is_dir($c)) {
			if ($age > $seuil) { supprime_dossier($c); @unlink(DOSSIER_TMP.'/verrou_copie_'.$f); }
			else $total += taille_dossier($c);
		} elseif (preg_match('/\.(tmp\d*|maj\d+|vieux\d+)$/', $f) && $age > 600) {
			supprime_dossier($c); // restes d'une requête interrompue
		} elseif ((strpos($f, 'verrou_ip_') === 0 || strpos($f, 'table_') === 0) && $age > $seuil) {
			@unlink($c);
		}
	}
	$occ = fichier_occupation();
	if (!is_null($occ) && @file_put_contents($occ.'.'.getmypid(), (string)$total) !== false) @rename($occ.'.'.getmypid(), $occ);
	return $total;
}

// Place d'exécution pour l'adresse IP du client (au plus REQUETES_PAR_IP à la fois)
function reserve_execution() {
	$ip = md5((string)($_SERVER['REMOTE_ADDR'] ?? 'local'));
	$fin = microtime(true) + ATTENTE_PLACE;
	do {
		for ($k = 0; $k < REQUETES_PAR_IP; $k++) {
			$h = @fopen(DOSSIER_TMP."/verrou_ip_{$ip}_$k", 'c');
			if ($h !== false && flock($h, LOCK_EX | LOCK_NB)) { @touch(DOSSIER_TMP."/verrou_ip_{$ip}_$k"); return $h; }
			if ($h !== false) fclose($h);
		}
		usleep(100000);
	} while (microtime(true) < $fin);
	return null;
}

//======================================================
// Exécution d'une requête de l'étudiant
//======================================================

function compte_triplets($store) {
	$r = lance_oxigraph(array('query', '--location', $store, '--results-format', 'json',
		'--query', 'SELECT (COUNT(*) AS ?n) WHERE { { ?s ?p ?o } UNION { GRAPH ?g { ?s ?p ?o } } }'));
	$j = $r['code'] === 0 ? json_decode($r['sortie'], true) : null;
	return isset($j['results']['bindings'][0]['n']['value']) ? (int)$j['results']['bindings'][0]['n']['value'] : null;
}

// Exécute $requete sur la copie de session du jeu $jeu.
// Renvoie ['ok' => bool, 'message' => texte, 'forme' => ..., 'resultat' => ...] où resultat vaut :
// SELECT : ['variables' => [...], 'lignes' => [[var => terme]...], 'tronque' => bool]
// ASK : bool ; CONSTRUCT, DESCRIBE : ['triplets' => [[s, p, o]...], 'tronque' => bool] ;
// UPDATE : ['avant' => n, 'apres' => n]. Un terme est ['type' => uri|literal|bnode, 'value', 'xml:lang'?, 'datatype'?].
function execute_sparql($jeu, $requete) {
	$res = array('ok' => false, 'message' => '', 'forme' => null, 'resultat' => null, 'prefixes' => array());
	if (strlen($requete) > LONGUEUR_MAX_REQUETE) { $res['message'] = "Requête trop longue."; return $res; }
	if (trim($requete) === '') { $res['message'] = "La requête est vide."; return $res; }
	$a = analyse_sparql($requete);
	$res['forme'] = $a['forme'];
	$res['prefixes'] = $a['prefixes'];
	if (!is_null($a['refus'])) { $res['message'] = $a['refus']; return $res; }
	$copie = store_copie($jeu, $erreur);
	if (is_null($copie)) { $res['message'] = $erreur; return $res; }
	$place = reserve_execution();
	if (is_null($place)) { $res['message'] = "Trop de requêtes en cours depuis votre poste : réessayez dans un instant."; return $res; }
	$v = verrou('copie_'.basename($copie));
	if (is_null($v)) { libere($place); $res['message'] = "Une autre de vos requêtes est en cours sur ce jeu : réessayez dans un instant."; return $res; }
	try {
		if ($a['forme'] === 'UPDATE') return execute_mise_a_jour($jeu, $copie, $requete, $res);
		return interroge_store($copie, $requete, $a);
	} finally {
		@touch($copie);
		libere($v);
		libere($place);
	}
}

// Interrogation (pas de mise à jour) du store $store, déjà analysée ($a, analyse_sparql()) ;
// renvoie le même tableau qu'execute_sparql(). Le store n'est pas modifié.
function interroge_store($store, $requete, $a) {
	$res = array('ok' => false, 'message' => '', 'forme' => $a['forme'], 'resultat' => null, 'prefixes' => $a['prefixes']);
	$format = in_array($a['forme'], array('CONSTRUCT', 'DESCRIBE')) ? 'nt' : 'json';
	$r = lance_oxigraph(array('query', '--location', $store, '--results-format', $format), $requete);
	if (!is_null($m = message_execution($r))) { $res['message'] = $m; return $res; }
	if ($format === 'nt') {
		$res['resultat'] = lit_ntriples($r['sortie']);
	} else {
		$j = json_decode($r['sortie'], true);
		if (!is_array($j)) { $res['message'] = "Réponse d'Oxigraph illisible."; return $res; }
		if (array_key_exists('boolean', $j)) { $res['forme'] = 'ASK'; $res['resultat'] = (bool)$j['boolean']; }
		else {
			$res['forme'] = 'SELECT';
			$lignes = $j['results']['bindings'] ?? array();
			$res['resultat'] = array('variables' => $j['head']['vars'] ?? array(),
				'lignes' => array_slice($lignes, 0, MAX_LIGNES), 'tronque' => count($lignes) > MAX_LIGNES);
		}
	}
	$res['ok'] = true;
	return $res;
}

// Message d'échec d'un appel à Oxigraph, ou null s'il a réussi
function message_execution($r) {
	if ($r['delai']) return "La requête a été arrêtée au bout de ".DELAI_MAX." secondes.";
	if ($r['trop']) return "Le résultat est trop volumineux : ajoutez LIMIT à la requête.";
	if ($r['code'] !== 0) return message_oxigraph($r['erreur']);
	return null;
}

// Mise à jour : faite sur une copie temporaire du store, qui ne remplace celui de la session
// que si elle réussit et ne dépasse pas la taille permise (toutes les opérations, ou aucune)
function execute_mise_a_jour($jeu, $copie, $requete, $res) {
	$avant = compte_triplets($copie);
	$coherenceAvant = coherence_copie($jeu, $copie);
	$tmp = $copie.'.maj'.getmypid();
	supprime_dossier($tmp);
	if (!copie_dossier($copie, $tmp)) { supprime_dossier($tmp); $res['message'] = "Copie de travail impossible."; return $res; }
	$r = lance_oxigraph(array('update', '--location', $tmp), $requete);
	if (!is_null($m = message_execution($r))) { supprime_dossier($tmp); $res['message'] = $m; return $res; }
	if (taille_dossier($tmp) > TAILLE_MAX_COPIE) {
		supprime_dossier($tmp);
		$res['message'] = "Cette mise à jour ferait dépasser ".round(TAILLE_MAX_COPIE / 1048576)." Mo à votre copie : elle n'a pas été appliquée.";
		return $res;
	}
	$vieux = $copie.'.vieux'.getmypid();
	if (!@rename($copie, $vieux) || !@rename($tmp, $copie)) {
		if (is_dir($vieux) && !is_dir($copie)) @rename($vieux, $copie);
		supprime_dossier($tmp);
		$res['message'] = "La mise à jour n'a pas pu être enregistrée.";
		return $res;
	}
	supprime_dossier($vieux);
	$res['ok'] = true;
	$res['resultat'] = array('avant' => $avant, 'apres' => compte_triplets($copie));
	// cohérence après la mise à jour, comparée à celle d'avant (coherence.php)
	$coherenceApres = controle_coherence($jeu, $copie);
	note_coherence($jeu, $copie, $coherenceApres);
	$res['coherence'] = array('avant' => $coherenceAvant, 'apres' => $coherenceApres);
	return $res;
}

// Lecture du format N-Triples (ou N-Quads) produit par Oxigraph
function lit_ntriples($texte) {
	$terme = '(<[^>]*>|_:\S+|"(?:[^"\\\\]|\\\\.)*"(?:@[A-Za-z0-9-]+|\^\^<[^>]*>)?)';
	$triplets = array();
	$tronque = false;
	foreach (preg_split('/\r?\n/', $texte) as $ligne) {
		if (!preg_match("/^\\s*$terme\\s+$terme\\s+$terme(?:\\s+$terme)?\\s*\\.\\s*$/u", $ligne, $m)) continue;
		if (count($triplets) >= MAX_LIGNES) { $tronque = true; break; }
		$triplets[] = array(terme_nt($m[1]), terme_nt($m[2]), terme_nt($m[3]));
	}
	return array('triplets' => $triplets, 'tronque' => $tronque);
}

function terme_nt($t) {
	if ($t[0] === '<') return array('type' => 'uri', 'value' => substr($t, 1, -1));
	if ($t[0] === '_') return array('type' => 'bnode', 'value' => substr($t, 2));
	preg_match('/^"((?:[^"\\\\]|\\\\.)*)"(?:@([A-Za-z0-9-]+)|\^\^<([^>]*)>)?$/s', $t, $m);
	$v = json_decode('"'.str_replace(array('\\\'', "\t"), array("'", '\t'), $m[1]).'"');
	$r = array('type' => 'literal', 'value' => is_string($v) ? $v : stripcslashes($m[1]));
	if (!empty($m[2])) $r['xml:lang'] = $m[2];
	if (!empty($m[3])) $r['datatype'] = $m[3];
	return $r;
}

//======================================================
// Affichage
//======================================================

// IRI abrégée par un préfixe connu (ex:Film), sinon entre chevrons
function abrege_iri($iri, $prefixes) {
	$meilleur = null;
	foreach ($prefixes as $p => $espace) {
		if ($espace !== '' && strpos($iri, $espace) === 0) {
			$local = substr($iri, strlen($espace));
			if (preg_match('/^[\p{L}\p{N}_-]*$/u', $local) && (is_null($meilleur) || strlen($espace) > strlen($meilleur[1])))
				$meilleur = array($p, $espace, $local);
		}
	}
	return is_null($meilleur) ? '<'.$iri.'>' : $meilleur[0].':'.$meilleur[2];
}

function affiche_terme($t, $prefixes) {
	if (!is_array($t)) return '';
	$type = $t['type'] ?? '';
	if ($type === 'uri') return "<span class='iri' title='".html($t['value'])."'>".html(abrege_iri($t['value'], $prefixes))."</span>";
	if ($type === 'bnode') return "<span class='bnode'>_:".html($t['value'])."</span>";
	$h = "<span class='litteral'>".html($t['value'])."</span>";
	if (!empty($t['xml:lang'])) $h .= "<span class='etiquette'>@".html($t['xml:lang'])."</span>";
	elseif (!empty($t['datatype']) && $t['datatype'] !== PREFIXES_STANDARD['xsd'].'string')
		$h .= "<span class='etiquette'>".html(abrege_iri($t['datatype'], $prefixes))."</span>";
	return $h;
}

// Résultat d'execute_sparql() en HTML
function affiche_resultat($r, $prefixes) {
	if (!$r['ok']) return "<p class='statut ko'>❌ ".nl2br(html($r['message']))."</p>";
	$statut = $r['forme'] === 'UPDATE' ? '✅ Mise à jour effectuée' : '✅ Requête réussie';
	return "<p class='statut ok'>$statut</p>".affiche_corps($r, $prefixes);
}

// Résultat réussi sans la ligne de statut : réponse d'un ASK, effet d'une mise à jour, ou
// tableau (SELECT ; sujet, prédicat, objet pour CONSTRUCT et DESCRIBE) suivi de sa taille.
// Préfixes utilisés pour abréger les IRI : standard, du jeu ($prefixes), de la requête.
function affiche_corps($r, $prefixes) {
	$prefixes = array_merge(PREFIXES_STANDARD, $prefixes, $r['prefixes'] ?? array());
	$x = $r['resultat'];
	switch ($r['forme']) {
	case 'ASK':
		return "<p class='booleen'>Réponse : <strong>".($x ? 'vrai (true)' : 'faux (false)')."</strong></p>";
	case 'UPDATE':
		if (is_null($x['avant']) || is_null($x['apres'])) return '';
		$d = $x['apres'] - $x['avant'];
		return "<p>Votre copie contient maintenant <strong>".$x['apres']."</strong> triplet".($x['apres'] > 1 ? 's' : '')
		      ." (".($d > 0 ? '+' : '').$d.").</p>"
		      .(isset($r['coherence']) ? affiche_effet_coherence($r['coherence']['avant'], $r['coherence']['apres']) : '');
	case 'CONSTRUCT': case 'DESCRIBE':
		$entetes = array('Sujet', 'Prédicat', 'Objet');
		$lignes = array();
		foreach ($x['triplets'] as $t) $lignes[] = $t;
		$unite = 'triplet';
		break;
	default: // SELECT
		$entetes = array();
		foreach ($x['variables'] as $v) $entetes[] = '?'.$v;
		$lignes = array();
		foreach ($x['lignes'] as $l) {
			$c = array();
			foreach ($x['variables'] as $v) $c[] = $l[$v] ?? null;
			$lignes[] = $c;
		}
		$unite = 'ligne';
	}
	$n = count($lignes);
	$compte = "<p class='compte-lignes'>$n $unite".($n > 1 ? 's' : '')
	         .($x['tronque'] ? ' (seul'.($unite === 'ligne' ? 'es les ' : 's les ').MAX_LIGNES.' premi'.($unite === 'ligne' ? 'ères' : 'ers').' sont affiché'.($unite === 'ligne' ? 'e' : '').'s)' : '')."</p>";
	if ($n == 0 || !$entetes) return $compte;
	$h = "<div class='defile'><table class='resultat'><thead><tr>";
	foreach ($entetes as $e) $h .= "<th>".html($e)."</th>";
	$h .= "</tr></thead><tbody>\n";
	foreach ($lignes as $l) {
		$h .= "<tr>";
		foreach ($l as $t) $h .= "<td>".(is_null($t) ? "<span class='non-lie'>—</span>" : affiche_terme($t, $prefixes))."</td>";
		$h .= "</tr>\n";
	}
	return $h."</tbody></table></div>".$compte;
}

// Aperçu de la copie de session : nombre de triplets, classes et propriétés utilisées ;
// renvoie array(HTML de l'aperçu, HTML du rapport de cohérence)
function explore_jeu($jeu) {
	$copie = store_copie($jeu, $erreur);
	if (is_null($copie)) return array("<p class='statut ko'>❌ ".html($erreur)."</p>", '');
	$place = reserve_execution();
	if (is_null($place)) return array("<p class='statut ko'>❌ Trop de requêtes en cours depuis votre poste : réessayez dans un instant.</p>", '');
	$v = verrou('copie_'.basename($copie));
	$requetes = array(
		'classes' => 'SELECT ?x (COUNT(DISTINCT ?s) AS ?n) WHERE { ?s a ?x } GROUP BY ?x ORDER BY DESC(?n) ?x',
		'proprietes' => 'SELECT ?x (COUNT(*) AS ?n) WHERE { ?s ?x ?o } GROUP BY ?x ORDER BY DESC(?n) ?x',
	);
	$donnees = array();
	foreach ($requetes as $cle => $q) {
		$r = lance_oxigraph(array('query', '--location', $copie, '--results-format', 'json'), $q);
		$j = $r['code'] === 0 ? json_decode($r['sortie'], true) : null;
		$donnees[$cle] = $j['results']['bindings'] ?? array();
	}
	$total = compte_triplets($copie);
	$coherence = affiche_coherence(coherence_copie($jeu, $copie));
	libere($v);
	libere($place);
	$prefixes = array_merge(PREFIXES_STANDARD, prefixes_jeu($jeu));
	$h = "<p>Votre copie contient <strong>".(int)$total."</strong> triplets.</p>\n";
	$titres = array('classes' => 'Classes (rdf:type) et nombre d\'instances', 'proprietes' => 'Propriétés et nombre de triplets');
	foreach ($donnees as $cle => $lignes) {
		$h .= "<h3>".html($titres[$cle])."</h3>\n";
		if (!$lignes) { $h .= "<p class='astuce'>Aucune.</p>"; continue; }
		$h .= "<ul class='pastilles explorer' data-sorte='$cle'>";
		foreach (array_slice($lignes, 0, 100) as $l) {
			$nom = abrege_iri($l['x']['value'], $prefixes);
			$h .= "<li><button type='button' class='pastille' data-iri='".html($l['x']['value'])."' data-nom='".html($nom)."' title='".html($l['x']['value'])."'>"
			     .html($nom)." <span class='compte'>".(int)$l['n']['value']."</span></button></li>";
		}
		$h .= "</ul>\n";
	}
	return array($h, $coherence);
}

require_once __DIR__.'/coherence.php';
require_once __DIR__.'/vocabulaire.php';
require_once __DIR__.'/ontologie.php';
