<?php
// Page « Crédits » : à propos, auteur, technologies, licence, conditions d'utilisation, liens, références
require __DIR__.'/session.php';
require_once __DIR__.'/fonctions.php';

try {
	$config = charge_config();
	$nom_appli = (string)$config['name'];
	$version = (string)$config['version'];
} catch (Exception $e) {
	error_log('SPARQLSandbox : config.xml invalide : '.$e->getMessage());
	$nom_appli = 'SPARQL Sandbox';
	$version = '';
}
header('Cache-Control: no-store');
?><!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title><?php echo html($nom_appli.' – Crédits'); ?></title>
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
  <section class="post credits">
    <h2 class="title">📖 À propos</h2>
    <div class="story">
      <p><strong>SPARQL Sandbox</strong> est un bac à sable pédagogique pour apprendre à interroger et à modifier des
        graphes RDF avec SPARQL. Chaque étudiant travaille sur sa propre copie de petits jeux de données : il peut les
        interroger, les modifier, revenir aux données d'origine, et suivre des exercices vérifiés automatiquement.</p>
      <p>Il a été conçu dans le même esprit que <strong>SQL Sandbox</strong>, du même auteur, dont il partage la charte
        graphique et le format des exercices.</p>
      <p class="liens"><a class="btn" href="https://pedago.desmontils.net/SQLSandbox/">🗄️ SQL Sandbox</a>
        <a class="btn secondaire" href="https://pedago.desmontils.net/querycraft/">🔍 QueryCraft</a></p>
    </div>
  </section>

  <section class="post credits">
    <h2 class="title">👨‍🏫 Auteur</h2>
    <div class="story">
      <div class="carte-auteur">
        <div class="icone-auteur">👨🏻‍💻</div>
        <div>
          <h3>Emmanuel Desmontils</h3>
          <p>Nantes Université</p>
          <p>Laboratoire des Sciences du Numérique de Nantes (LS2N) – Équipe VELO</p>
          <p>Centre de Recherche en Éducation de Nantes (CREN)</p>
          <p>📧 <a href="mailto:emmanuel.desmontils@univ-nantes.fr">emmanuel.desmontils@univ-nantes.fr</a></p>
        </div>
      </div>
    </div>
  </section>

  <section class="post credits">
    <h2 class="title">🛠️ Technologies utilisées</h2>
    <div class="story">
      <div class="grille-techno">
        <div><span class="icone">🐘</span><strong>PHP</strong><span>8.0 et plus</span></div>
        <div><span class="icone">🕸️</span><strong>Oxigraph</strong><span>Moteur SPARQL 1.1</span></div>
        <div><span class="icone">✅</span><strong>pySHACL</strong><span>Formes SHACL (facultatif)</span></div>
        <div><span class="icone">📄</span><strong>SimpleXML</strong><span>Configuration et contenus</span></div>
        <div><span class="icone">✏️</span><strong>CodeMirror 5</strong><span>Éditeur SPARQL (licence MIT)</span></div>
        <div><span class="icone">🔤</span><strong>Atkinson Hyperlegible Next</strong><span>Police (Braille Institute)</span></div>
        <div><span class="icone">🤖</span><strong>IA générative</strong><span>Correction des intentions, fiches des services</span></div>
      </div>
      <p>Moteur SPARQL : <a href="https://github.com/oxigraph/oxigraph">Oxigraph</a>, appelé en ligne de commande.
        Contrôle des formes : <a href="https://github.com/RDFLib/pySHACL">pySHACL</a>. Éditeur :
        <a href="https://codemirror.net/5/">CodeMirror 5</a>, sous licence MIT. Police
        <a href="https://www.brailleinstitute.org/freefont/">Atkinson Hyperlegible Next</a>, du Braille Institute of
        America, utilisée sans modification comme le prévoit sa licence.</p>
    </div>
  </section>

  <section class="post credits">
    <h2 class="title">📜 Licence</h2>
    <div class="story">
      <p><?php echo html($nom_appli); ?> est un logiciel libre développé à des fins pédagogiques et de recherche, distribué
        sous la licence <a rel="license" href="https://www.gnu.org/licenses/gpl-3.0.fr.html">GNU GPL version 3</a>. Son
        code est disponible sur <a href="https://github.com/edesmontils/SPARQLSandbox">https://github.com/edesmontils/SPARQLSandbox</a>.</p>
      <p>© 2026 Emmanuel Desmontils, Nantes Université</p>
    </div>
  </section>

  <section class="post credits">
    <h2 class="title">🛡️ Conditions d'utilisation</h2>
    <div class="story">
      <p>Cette petite application Web a été développée à des fins pédagogiques. Cette instance en ligne est mise à
        disposition pour cet usage uniquement, dans la mesure où son utilisation n'est pas détournée. L'auteur ne peut
        être considéré responsable des dysfonctionnements ou pertes de données et se réserve le droit de la supprimer à
        tout moment.</p>
    </div>
  </section>

  <section class="post credits">
    <h2 class="title">🔗 Liens utiles</h2>
    <div class="story">
      <p class="liens">
        <a class="btn" href="https://github.com/edesmontils/SPARQLSandbox">📦 GitHub</a>
        <a class="btn" href="https://pedago.desmontils.net/SQLSandbox/">🗄️ SQL Sandbox</a>
        <a class="btn" href="https://pedago.desmontils.net/querycraft/">🔍 QueryCraft</a>
        <a class="btn" href="https://www.ls2n.fr/equipe/velo/">🏛️ LS2N</a>
        <a class="btn" href="https://cren.univ-nantes.fr/presentation/theme-1-conception-de-formation-et-mediation-par-le-numerique">🏛️ CREN</a>
        <a class="btn" href="https://www.univ-nantes.fr/">🎓 Nantes Université</a>
      </p>
    </div>
  </section>

  <section class="post credits">
    <h2 class="title">🤖 Développement assisté par IA</h2>
    <div class="story">
      <p>Le développement de SPARQL Sandbox a bénéficié de l'assistance de <strong>Claude Code</strong>, l'outil
        d'assistance au développement d'Anthropic.</p>
      <p class="liens"><a class="btn secondaire" href="https://claude.ai/code">🔗 En savoir plus sur Claude Code</a></p>
    </div>
  </section>

  <p><a href="./">← Retour aux jeux de données</a></p>
</main>
<footer class="pied"><p><?php echo html($nom_appli); ?> <?php echo html($version); ?>
  <span class="separateur">·</span> © 2026 E. Desmontils, Nantes Université
  <span class="separateur">·</span> Logiciel libre sous licence GPL v3</p></footer>
</div>
</body>
</html>
