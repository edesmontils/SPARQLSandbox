<?php
// Éditeur d'ontologie : page où l'étudiant modifie, en graphe ou en liste, l'ontologie de sa
// copie de session (js/editeur.js, js/disposition.js ; modèle et enregistrement dans ontologie.php).
require __DIR__.'/session.php';
require_once __DIR__.'/fonctions.php';
require_once __DIR__.'/ia.php';

if (empty($_SESSION['csrf'])) $_SESSION['csrf'] = bin2hex(random_bytes(16));

$jeux = liste_jeux();
$jeu = param('jeu');
if (!is_string($jeu) || !isset($jeux[$jeu])) { header('Location: ./'); exit; }

try {
	$config = charge_config();
	$nom_appli = (string)$config['name'];
} catch (Exception $e) {
	error_log('SPARQLSandbox : config.xml invalide : '.$e->getMessage());
	$nom_appli = 'SPARQL Sandbox';
}
$donnees_js = array(
	'csrf' => $_SESSION['csrf'],
	'jeu' => $jeu,
	'titre_jeu' => $jeux[$jeu]['titre'],
	'retour' => './?jeu='.urlencode($jeu),
	// peuplement de l'instance par IA (ia.php) : sinon, l'onglet l'explique
	'ia' => !is_null(ia_config()),
);
header('Cache-Control: no-store');
?><!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title><?php echo html("Éditeur d'ontologie – ".$jeux[$jeu]['titre']." – ".$nom_appli); ?></title>
  <link rel="icon" href="images/favicon.svg" type="image/svg+xml">
  <link href="<?php echo url_fichier('default.css'); ?>" rel="stylesheet">
  <script type="application/json" id="donnees"><?php echo json_encode($donnees_js, JSON_HEX_TAG | JSON_HEX_AMP | JSON_UNESCAPED_UNICODE); ?></script>
  <script src="<?php echo url_fichier('js/disposition.js'); ?>" defer></script>
  <script src="<?php echo url_fichier('js/editeur.js'); ?>" defer></script>
</head>
<body>
<div class="container ed">

  <div class="ed-barre">
    <button type="button" class="btn secondaire" id="retour" title="Revenir au graphe du vocabulaire">← Retour au graphe</button>
    <h1>🧬 Éditeur d'ontologie <small>jeu « <?php echo html($jeux[$jeu]['titre']); ?> » · votre copie</small></h1>
    <div class="groupe">
      <span class="etat" id="etat">Chargement…</span>
      <button type="button" class="btn vert" id="b-enreg" disabled>💾 Enregistrer</button>
    </div>
  </div>

  <div class="ed-corps">
    <div class="ed-centre">
      <div id="message" aria-live="polite" hidden></div>

      <div class="bascule">
        <button type="button" class="btn secondaire petit" id="add-classe">＋ Concept</button>
        <button type="button" class="btn secondaire petit" id="add-prop">＋ Propriété</button>
        <div class="seg" role="group" aria-label="Affichage" style="margin-left:auto">
          <button type="button" id="v-graphe" class="actif">🕸️ Graphe</button>
          <button type="button" id="v-liste" title="Alternative accessible au clavier et aux lecteurs d'écran">📋 Vue liste</button>
        </div>
      </div>

      <section class="vol" id="zone-liste" hidden>
        <h2>📋 Vue liste <span class="astuce" style="margin:0;font-weight:400;font-size:.8em">alternative accessible au graphe</span></h2>
        <div class="contenu">
          <div class="groupe-cl" style="margin-top:0"><span>Concepts</span><span id="n-classes"></span></div>
          <ul class="arbre" id="arbre-classes"></ul>
          <div class="groupe-cl" style="margin-top:16px"><span>Propriétés</span><span id="n-props"></span></div>
          <ul class="arbre" id="arbre-props"></ul>
        </div>
      </section>

      <section class="vol" id="zone-graphe">
        <h2>🕸️ Graphe de l'ontologie <button type="button" class="btn secondaire petit" id="reorg" title="Recalcule la disposition des concepts">↺ Réorganiser</button></h2>
        <div class="zone-svg"><svg id="svg-graphe" class="graphe-svg" viewBox="0 0 700 380" role="group" aria-label="Graphe éditable de l'ontologie : un bouton par concept" aria-describedby="aide-clavier"></svg></div>
        <div class="aide-graphe" id="aide-clavier">
          <span><strong>Clavier</strong> : <kbd>Tab</kbd> entre dans le graphe, <kbd>←↑↓→</kbd> changent de concept, <kbd>Entrée</kbd> le choisit, <kbd>F2</kbd> le renomme, <kbd>R</kbd> relation, <kbd>S</kbd> sous-classe, <kbd>A</kbd> attribut (puis flèches et <kbd>Entrée</kbd> pour viser, <kbd>Échap</kbd> pour annuler), <kbd>Maj</kbd>+flèches le déplacent, <kbd>Suppr</kbd> le supprime. La vue liste et la fiche font tout cela sans graphe.</span>
          <span><kbd>double-clic</kbd> sur le fond : nouveau concept</span>
          <span><kbd>●</kbd> glisser vers un concept : propriété entre concepts ; vers le fond : attribut</span>
          <span><kbd>▲</kbd> glisser vers un concept : « sous-classe de »</span>
          <span><kbd>double-clic</kbd> sur un nom : renommer</span>
          <span><kbd>Suppr</kbd> : supprimer la sélection</span>
          <span><i class="sw" style="border-color:var(--sb-ok)"></i>nouveau <i class="sw" style="border-color:#d19a00;margin-left:8px"></i>modifié <i class="sw" style="border-color:var(--sb-danger);border-style:dashed;margin-left:8px"></i>supprimé</span>
        </div>
        <details class="orphelines" id="orphelines" hidden>
          <summary id="orph-titre"></summary>
          <p class="astuce" style="margin:6px 14px">Ces propriétés n'ont pas de domaine ou de portée : le graphe ne peut pas les dessiner. Sélectionnez-en une pour la compléter dans la fiche.</p>
          <ul class="arbre" id="arbre-orph" style="padding:0 12px 10px"></ul>
        </details>
      </section>

      <section class="vol" id="fiche"></section>
    </div>

    <aside class="vol ed-droite">
      <div class="onglets" role="tablist">
        <button type="button" role="tab" aria-selected="true" data-onglet="instances" class="actif">🗃️ Instance <span class="compte" id="c-inst">…</span></button>
        <button type="button" role="tab" aria-selected="false" data-onglet="ia">✨ Peupler avec l'IA</button>
      </div>

      <div class="panneau" id="p-instances" role="tabpanel"><p class="astuce">Chargement…</p></div>

      <div class="panneau" id="p-ia" role="tabpanel" hidden>
<?php if (is_null(ia_config())) { ?>
        <p class="astuce">L'IA générative n'est pas activée sur ce serveur : le peuplement automatique de l'instance n'est pas disponible.
          Vous pouvez ajouter des données avec <code>INSERT DATA</code> depuis la page des requêtes.</p>
<?php } else { ?>
        <p class="astuce" style="margin-top:0">L'IA ajoute des données à l'instance <em>sans requête SPARQL</em>. Vous relisez ses propositions et n'ajoutez que celles que vous choisissez.</p>
        <label class="radio-carte"><input type="radio" name="mode" value="general" checked> <strong>Peuplement général</strong>
          <small>Enrichit toute l'instance à partir de l'ontologie, telle que vous la voyez ici.</small></label>
        <label class="radio-carte"><input type="radio" name="mode" value="cible"> <strong>Ciblé sur mes modifications</strong>
          <small>Ne génère que des données qui exercent ce que vous avez créé ou changé.</small></label>
        <div class="cible" id="cible"></div>
        <div class="ligne">
          <label for="quantite">Nouvelles instances</label>
          <select id="quantite" class="champ" style="width:auto"><option>3</option><option selected>5</option><option>10</option></select>
        </div>
        <label for="consigne" class="visuellement-cache">Consigne</label>
        <textarea id="consigne" class="champ" rows="2" maxlength="300" placeholder="Consigne facultative : « films français des années 90 »…"></textarea>
        <div class="boutons"><button type="button" class="btn" id="generer">✨ Générer des propositions</button></div>
        <div id="propositions" class="propositions" aria-live="polite"></div>
<?php } ?>
      </div>
    </aside>
  </div>
</div>

<dialog id="dlg-sortie">
  <h2>Quitter l'éditeur ?</h2>
  <p id="dlg-texte"></p>
  <div class="boutons">
    <button type="button" class="btn secondaire" id="s-continuer">Continuer l'édition</button>
    <button type="button" class="btn danger" id="s-abandon">Quitter sans enregistrer</button>
    <button type="button" class="btn vert" id="s-enreg">💾 Enregistrer et quitter</button>
  </div>
</dialog>
<div class="toast" id="toast" role="status"></div>
<div id="annonce" class="visuellement-cache" role="status" aria-live="polite"></div>
</body>
</html>
