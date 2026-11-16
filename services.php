<?php
// Page « Services fédérés » : points d'accès que SERVICE peut interroger, avec leur description
// (écrite à la main pour les services connus, par IA pour les autres : voir federation.php)
require __DIR__.'/session.php';
require_once __DIR__.'/federation.php';

try {
	$config = charge_config();
	$nom_appli = (string)$config['name'];
	$version = (string)$config['version'];
} catch (Exception $e) {
	error_log('SPARQLSandbox : config.xml invalide : '.$e->getMessage());
	$nom_appli = 'SPARQL Sandbox';
	$version = '';
}
$fiches = fiches_services();
$modeles = array();
foreach ($fiches as $f) if ($f['ia'] && !empty($f['modele'])) $modeles[$f['modele']] = true;
$note_ia = !empty(array_filter($fiches, function ($f) { return $f['ia']; }));
header('Cache-Control: no-store');
?><!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title><?php echo html($nom_appli.' – Services fédérés'); ?></title>
  <link rel="icon" href="images/favicon.svg" type="image/svg+xml">
  <link href="<?php echo url_fichier('default.css'); ?>" rel="stylesheet">
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
<main id="contenu">
  <section class="post">
    <h2 class="title">🌐 Services fédérés</h2>
    <div class="story">
      <p>Une requête peut interroger un autre point d'accès SPARQL avec <code>SERVICE</code> : la partie entre
        accolades est alors évaluée par ce service, et ses résultats sont joints à ceux de votre copie. C'est ainsi que
        l'on relie des données locales à des données du Web.</p>
      <pre class="exemple-service">SELECT ?nom WHERE {
  SERVICE &lt;https://dbpedia.org/sparql&gt; {
    &lt;http://dbpedia.org/resource/Nantes&gt; rdfs:label ?nom .
    FILTER (lang(?nom) = "fr")
  }
}</pre>
      <p class="astuce">Seuls les points d'accès ci-dessous sont autorisés, avec leur adresse exacte : le serveur les interroge
        pour vous, pendant 5 secondes au plus. <code>SERVICE ?variable</code> et <code>LOAD</code> sont refusés. Ces services
        sont publics et hors de notre contrôle : ils peuvent être lents, limiter leur débit ou être indisponibles.</p>
    </div>
  </section>
<?php if (!$fiches) { ?>
  <p class="statut ko">❌ Aucun service n'est autorisé sur ce serveur : <code>SERVICE</code> est refusé.</p>
<?php } ?>
<?php foreach ($fiches as $f) { ?>
  <section class="post service">
    <h2 class="title"><?php echo html($f['nom']); ?><?php if ($f['ia']) echo ' <sup><a href="#note-ia" title="Description générée par IA">1</a></sup>'; ?></h2>
    <div class="story">
      <p class="astuce">Point d'accès : <code><?php echo html($f['url']); ?></code></p>
<?php if (!is_null($f['description'])) { ?>
      <p><?php echo html($f['description']); ?><?php if ($f['ia']) echo ' <sup><a href="#note-ia">1</a></sup>'; ?></p>
<?php } else { ?>
      <p class="astuce">Description non disponible pour le moment.</p>
<?php } ?>
<?php if (!is_null($f['exemple'])) { ?>
      <details><summary>Exemple de requête</summary><pre class="exemple-service"><?php echo html($f['exemple']); ?></pre></details>
<?php } ?>
    </div>
  </section>
<?php } ?>
<?php if ($note_ia) { ?>
  <p class="note-ia" id="note-ia"><sup>1</sup> Description générée par une IA<?php echo $modeles ? ' ('.html(implode(', ', array_keys($modeles))).')' : ''; ?>
    à partir de l'adresse du point d'accès, pour un service que l'application ne connaît pas : elle n'a pas été vérifiée et peut
    être inexacte. Consultez le site du service pour en être sûr.</p>
<?php } ?>
  <p><a href="./">← Retour aux jeux de données</a></p>
</main>
<footer class="pied"><p><?php echo html($nom_appli); ?> <?php echo html($version); ?>
  <span class="separateur">·</span> © 2026 E. Desmontils, Nantes Université
  <span class="separateur">·</span> Logiciel libre sous licence GPL v3</p></footer>
</div>
</body>
</html>
