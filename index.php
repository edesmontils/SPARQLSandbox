<?php
require __DIR__.'/session.php';
require_once __DIR__.'/fonctions.php';
require_once __DIR__.'/exercices.php';

if (empty($_SESSION['csrf'])) $_SESSION['csrf'] = bin2hex(random_bytes(16));
if ($session_ok) session_regenerate_id(true);

$erreurs = array();
try {
	$config = charge_config();
	$nom_appli = (string)$config['name'];
	$version = (string)$config['version'];
} catch (Exception $e) {
	error_log('SPARQLSandbox : config.xml invalide : '.$e->getMessage());
	$config = null;
	$nom_appli = 'SPARQL Sandbox';
	$version = '';
	$erreurs[] = "Problème d'installation : la configuration de l'application est illisible.";
}
if (is_null(DOSSIER_TMP))
	$erreurs[] = "Problème d'installation : aucun dossier de travail n'est accessible en écriture (".INSTANCE."-tmp à côté du site, ou tmp).";
elseif (is_null(chemin_oxigraph()))
	$erreurs[] = "Problème d'installation : Oxigraph est introuvable (voir le README).";

// Purge des copies inactives, et relevé de la place qu'occupent les autres
purge_copies(DUREE_SESSION);

$jeux = liste_jeux();
$jeu = param('jeu');
if (!is_string($jeu) || !isset($jeux[$jeu])) $jeu = null;
// Copies dont le jeu a disparu
foreach (array_keys($_SESSION['copies'] ?? array()) as $j) if (!isset($jeux[$j])) unset($_SESSION['copies'][$j]);

$prefixes = is_null($jeu) ? array() : array_merge(array('rdf' => PREFIXES_STANDARD['rdf'], 'rdfs' => PREFIXES_STANDARD['rdfs'],
	'xsd' => PREFIXES_STANDARD['xsd']), prefixes_jeu($jeu));
$donnees_js = array(
	'csrf' => $_SESSION['csrf'],
	'duree_session' => DUREE_SESSION,
	'jeu' => $jeu,
	'prefixes' => $prefixes,
	'exemples' => is_null($jeu) ? array() : $jeux[$jeu]['exemples'],
	// Exercice à ouvrir au chargement (?jeu=…&exercice=…)
	'exercice' => (is_null($jeu) || !is_string(param('exercice'))) ? null : param('exercice'),
);
$exercices = is_null($jeu) ? array() : exos_de_jeu($jeu);
?><!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title><?php echo html($nom_appli.(is_null($jeu) ? '' : ' – '.$jeux[$jeu]['titre'])); ?></title>
  <link rel="icon" href="images/favicon.svg" type="image/svg+xml">
  <link href="<?php echo url_fichier('js/codemirror/codemirror.css'); ?>" rel="stylesheet">
  <link href="<?php echo url_fichier('default.css'); ?>" rel="stylesheet">
  <!-- Éditeur SPARQL : CodeMirror 5 (licence MIT, js/codemirror/LICENSE) -->
  <script src="<?php echo url_fichier('js/codemirror/codemirror.js'); ?>"></script>
  <script src="<?php echo url_fichier('js/codemirror/sparql.js'); ?>"></script>
  <script src="<?php echo url_fichier('js/codemirror/matchbrackets.js'); ?>"></script>
  <script type="application/json" id="donnees"><?php echo json_encode($donnees_js, JSON_HEX_TAG | JSON_HEX_AMP | JSON_UNESCAPED_UNICODE); ?></script>
  <script src="<?php echo url_fichier('js/sandbox.js'); ?>" defer></script>
</head>
<body>
<div class="container">
<header class="entete">
  <div class="marque">
    <img src="images/logo.svg" alt="">
    <div>
      <h1><a href="./"><?php echo html($nom_appli); ?></a></h1>
      <p class="sous-titre">Un bac à sable pour apprendre SPARQL et le Web sémantique</p>
    </div>
  </div>
</header>
<nav class="jeux" aria-label="Jeux de données">
  <span class="libelle">Jeux de données :</span>
  <ul class="pastilles">
<?php foreach ($jeux as $nom => $j) { ?>
    <li><a class="pastille<?php echo $nom === $jeu ? ' active' : ''; ?>" href="?jeu=<?php echo html(urlencode($nom)); ?>"<?php echo $nom === $jeu ? ' aria-current="page"' : ''; ?>><?php echo html($j['titre']); ?></a></li>
<?php } ?>
  </ul>
</nav>
<main id="contenu">
<?php foreach ($erreurs as $e) echo "<p class='statut ko'>❌ ".html($e)."</p>\n"; ?>
<?php if (is_null($jeu)) {
	// {duree_session} : durée réelle, réglée dans sparqlsandbox.ini
	echo $config ? str_replace('{duree_session}', html(libelle_duree(DUREE_SESSION)), contenu_xml($config->accueil)) : '';
} else { $j = $jeux[$jeu]; ?>
  <section class="post">
    <h2 class="title"><?php echo html($j['titre']); ?></h2>
    <div class="story"><?php echo $j['description']; ?>
<?php if ($j['référence'] !== '') { ?>
      <p class="astuce">Référence : <a href="<?php echo html($j['référence']); ?>" rel="noopener" target="_blank"><?php echo html($j['référence']); ?></a></p>
<?php } ?>
    </div>
  </section>

  <div class="colonnes">
    <div class="principale">
    <section class="post exercice" id="exercice" hidden aria-live="polite"></section>
    <section class="post editeur">
      <h2 class="title" id="titre-editeur">✏️ Interroger ce jeu de données</h2>
      <label for="requete" class="visuellement-cache">Requête SPARQL</label>
      <textarea id="requete" spellcheck="false"></textarea>
      <div class="boutons">
        <button type="button" class="btn" id="verifier" hidden title="Ctrl+Entrée (Cmd+Entrée sur Mac)">✅ Vérifier ma réponse</button>
        <button type="button" class="btn" id="executer" title="Ctrl+Entrée (Cmd+Entrée sur Mac)">▶️ Exécuter</button>
        <button type="button" class="btn secondaire" id="prefixes">🏷️ Insérer les préfixes</button>
        <button type="button" class="btn secondaire" id="memoriser">🧺 Mémoriser</button>
        <button type="button" class="btn secondaire" id="effacer">🧹 Effacer</button>
      </div>
      <div id="resultat" aria-live="polite"></div>
    </section>
    </div>

    <aside class="laterale">
<?php if ($exercices) { ?>
      <section class="post">
        <h2 class="title">📝 Exercices</h2>
        <ul class="cartes-exercices">
<?php foreach ($exercices as $code => $exo) {
	$sortes = array();
	foreach ($exo['questions'] as $q) $sortes[libelle_type($q[3])] = true;
	$nb = count($exo['questions']); ?>
          <li><button type="button" class="carte-exercice" data-exercice="<?php echo html($code); ?>">
            <span class="carte-titre"><?php echo html($code); ?></span>
            <span class="carte-detail"><?php echo $nb.' question'.($nb > 1 ? 's' : '').' · '.html(implode(', ', array_keys($sortes))); ?></span>
            <span class="carte-suivi" data-total="<?php echo $nb; ?>"></span>
          </button></li>
<?php } ?>
        </ul>
      </section>
<?php } ?>
<?php if ($j['exemples']) { ?>
      <section class="post">
        <h2 class="title">💡 Exemples</h2>
        <ul class="exemples">
<?php foreach ($j['exemples'] as $k => $ex) { ?>
          <li><button type="button" class="lien" data-exemple="<?php echo (int)$k; ?>"><?php echo html($ex[0]); ?></button></li>
<?php } ?>
        </ul>
      </section>
<?php } ?>
      <section class="post">
        <h2 class="title">🧩 Contenu de votre copie</h2>
        <p class="astuce">Cliquez sur une classe ou une propriété pour l'utiliser dans une requête.</p>
        <div id="explorer"><p class="astuce">Chargement…</p></div>
        <div class="boutons">
          <button type="button" class="btn secondaire" id="actualiser">🔄 Actualiser</button>
          <button type="button" class="btn danger" id="reinitialiser">↩️ Revenir au jeu d'origine</button>
        </div>
      </section>
      <section class="post">
        <h2 class="title">🩺 Cohérence</h2>
        <p class="astuce">Votre copie comparée à l'ontologie du jeu (RDFS)<?php echo $j['formes'] ? ' et à ses formes SHACL' : ''; ?>.
          Une incohérence est signalée, jamais refusée.</p>
        <div id="coherence" aria-live="polite"><p class="astuce">Chargement…</p></div>
      </section>
      <section class="post">
        <h2 class="title">🧺 Mémoire</h2>
        <ul id="memoire" class="exemples"><li class="astuce">Aucune requête mémorisée.</li></ul>
      </section>
    </aside>
  </div>
<?php } ?>
</main>
<footer class="pied"><p><?php echo html($nom_appli); ?> <?php echo html($version); ?>
  <span class="separateur">·</span> © 2026 E. Desmontils, Nantes Université
  <span class="separateur">·</span> Logiciel libre sous licence GPL v3
  <span class="separateur">·</span> Moteur SPARQL <a href="https://github.com/oxigraph/oxigraph">Oxigraph</a></p>
  <p class="temps-session" id="temps-session" title="La session et vos copies sont effacées après <?php echo html(libelle_duree(DUREE_SESSION)); ?> sans activité">⏳ Session valable <?php echo html(libelle_duree(DUREE_SESSION)); ?> après la dernière action</p></footer>
</div>
</body>
</html>
