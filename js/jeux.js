// Jeux vierges personnels (voir fonctions.php, « Jeux vierges personnels ») : créer le sien depuis la navigation,
// le supprimer depuis sa page. Rien de partagé n'est touché : le jeu n'existe que dans la session.
(function () {
	'use strict';
	var donnees = JSON.parse(document.getElementById('donnees').textContent);

	function appelle(action, champs) {
		var corps = new URLSearchParams();
		corps.set('action', action); corps.set('csrf', donnees.csrf);
		Object.keys(champs || {}).forEach(function (k) { corps.set(k, champs[k]); });
		return fetch('controler.php', { method: 'POST', body: corps, credentials: 'same-origin' }).then(function (r) { return r.json(); })
			.catch(function () { return { ok: false, html: "Le serveur ne répond pas." }; });
	}
	function texte(html) { var d = document.createElement('div'); d.innerHTML = html || ''; return d.textContent; }

	var creer = document.getElementById('nouveau-jeu');
	if (creer) creer.addEventListener('click', function () {
		var titre = window.prompt('Titre de votre jeu vierge (privé à cette session, 60 caractères au plus) :', 'Mon ontologie');
		if (titre === null) return;
		creer.disabled = true;
		appelle('jeu_creer', { titre: titre }).then(function (r) {
			creer.disabled = false;
			if (!r.ok) { window.alert(texte(r.html)); return; }
			window.location.href = '?jeu=' + encodeURIComponent(r.jeu);
		});
	});

	var supprimer = document.getElementById('supprimer-jeu');
	if (supprimer) supprimer.addEventListener('click', function () {
		if (!window.confirm('Supprimer définitivement « ' + supprimer.dataset.titre + ' » et tout ce qu\'il contient ? Exportez-le en Turtle d\'abord si vous voulez le garder.')) return;
		supprimer.disabled = true;
		appelle('jeu_supprimer', { jeu: donnees.jeu }).then(function (r) {
			if (!r.ok) { supprimer.disabled = false; window.alert(texte(r.html)); return; }
			window.location.href = './';
		});
	});
})();
