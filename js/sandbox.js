// SPARQL Sandbox : éditeur, exécution des requêtes, exploration et mémoire
(function () {
	'use strict';
	var donnees = JSON.parse(document.getElementById('donnees').textContent);
	if (!donnees.jeu) return;

	var zone = document.getElementById('requete');
	var editeur = CodeMirror.fromTextArea(zone, {
		mode: 'application/sparql-query',
		lineNumbers: true,
		matchBrackets: true,
		indentUnit: 2,
		tabSize: 2,
		lineWrapping: true,
		extraKeys: {
			'Ctrl-Enter': function () { executer(); },
			'Cmd-Enter': function () { executer(); }
		}
	});

	// Requête en cours d'écriture, gardée par jeu dans le navigateur (simple confort)
	var cleBrouillon = 'sparqlsandbox-brouillon-' + donnees.jeu;
	var cleMemoire = 'sparqlsandbox-memoire-' + donnees.jeu;
	function lit(cle, defaut) {
		try { var v = localStorage.getItem(cle); return v === null ? defaut : JSON.parse(v); } catch (e) { return defaut; }
	}
	function ecrit(cle, valeur) {
		try { localStorage.setItem(cle, JSON.stringify(valeur)); } catch (e) { /* stockage indisponible */ }
	}
	var brouillon = lit(cleBrouillon, null);
	editeur.setValue(typeof brouillon === 'string' && brouillon !== '' ? brouillon
		: (donnees.exemples.length ? donnees.exemples[0][1] : 'SELECT * WHERE { ?s ?p ?o } LIMIT 20'));
	editeur.on('change', function () { ecrit(cleBrouillon, editeur.getValue()); });

	// Texte UTF-8 en base64 (un pare-feu applicatif peut refuser une requête en clair)
	function base64(texte) {
		var octets = new TextEncoder().encode(texte), binaire = '';
		for (var i = 0; i < octets.length; i++) binaire += String.fromCharCode(octets[i]);
		return btoa(binaire);
	}

	function appel(action, champs) {
		var corps = new URLSearchParams();
		corps.set('action', action);
		corps.set('jeu', donnees.jeu);
		corps.set('csrf', donnees.csrf);
		Object.keys(champs || {}).forEach(function (k) { corps.set(k, champs[k]); });
		return fetch('controler.php', { method: 'POST', body: corps, credentials: 'same-origin' })
			.then(function (r) {
				if (!r.headers.get('X-SPARQLSandbox'))
					return { ok: false, html: "<p class='statut ko'>❌ La requête a été bloquée avant d'atteindre l'application " +
						"(pare-feu ou proxy, code " + r.status + ").</p>" };
				return r.json();
			})
			.catch(function () {
				return { ok: false, html: "<p class='statut ko'>❌ Le serveur ne répond pas.</p>" };
			});
	}

	var resultat = document.getElementById('resultat');
	var boutonExecuter = document.getElementById('executer');
	function executer() {
		boutonExecuter.disabled = true;
		resultat.innerHTML = "<p class='astuce'>⏳ Exécution…</p>";
		var requete = editeur.getValue();
		appel('executer', { requete64: base64(requete) }).then(function (r) {
			resultat.innerHTML = r.html;
			boutonExecuter.disabled = false;
			// Une mise à jour change le contenu de la copie
			if (r.ok && /^\s*(?:(?:PREFIX\s+\S*\s*<[^>]*>|BASE\s*<[^>]*>|#[^\n]*)\s*)*(INSERT|DELETE|CLEAR|CREATE|DROP|COPY|MOVE|ADD|WITH)\b/i.test(requete))
				explorer();
		});
	}
	boutonExecuter.addEventListener('click', executer);

	// Préfixes du jeu, ajoutés en tête de la requête s'ils n'y sont pas déjà
	document.getElementById('prefixes').addEventListener('click', function () {
		var texte = editeur.getValue(), ajout = '';
		Object.keys(donnees.prefixes).forEach(function (p) {
			if (!new RegExp('PREFIX\\s+' + p.replace(/[.-]/g, '\\$&') + ':', 'i').test(texte))
				ajout += 'PREFIX ' + p + ': <' + donnees.prefixes[p] + '>\n';
		});
		if (ajout !== '') editeur.setValue(ajout + texte);
		editeur.focus();
	});

	document.getElementById('effacer').addEventListener('click', function () {
		editeur.setValue('');
		resultat.innerHTML = '';
		editeur.focus();
	});

	document.querySelectorAll('[data-exemple]').forEach(function (b) {
		b.addEventListener('click', function () {
			editeur.setValue(donnees.exemples[+b.dataset.exemple][1]);
			resultat.innerHTML = '';
			editeur.focus();
		});
	});

	// Contenu de la copie ; un clic sur une classe ou une propriété en fait une requête
	var zoneExplorer = document.getElementById('explorer');
	function prefixesUtiles(nom) {
		var p = nom.indexOf(':') > 0 ? nom.slice(0, nom.indexOf(':')) : null;
		var lignes = [];
		if (p && donnees.prefixes[p]) lignes.push('PREFIX ' + p + ': <' + donnees.prefixes[p] + '>');
		return lignes.length ? lignes.join('\n') + '\n' : '';
	}
	function terme(nom) { return nom.charAt(0) === '<' || nom.indexOf(':') > 0 ? nom : '<' + nom + '>'; }
	function explorer() {
		appel('explorer').then(function (r) {
			zoneExplorer.innerHTML = r.html;
			zoneExplorer.querySelectorAll('ul[data-sorte] button').forEach(function (b) {
				b.addEventListener('click', function () {
					var sorte = b.closest('ul').dataset.sorte, nom = b.dataset.nom;
					var requete = sorte === 'classes'
						? prefixesUtiles(nom) + 'SELECT ?s\nWHERE {\n  ?s a ' + terme(nom) + ' .\n}\nLIMIT 50'
						: prefixesUtiles(nom) + 'SELECT ?s ?o\nWHERE {\n  ?s ' + terme(nom) + ' ?o .\n}\nLIMIT 50';
					editeur.setValue(requete);
					resultat.innerHTML = '';
					editeur.focus();
				});
			});
		});
	}
	document.getElementById('actualiser').addEventListener('click', explorer);
	document.getElementById('reinitialiser').addEventListener('click', function () {
		if (!confirm("Effacer toutes vos modifications de ce jeu de données ?")) return;
		appel('reinitialiser').then(function (r) { resultat.innerHTML = r.html; explorer(); });
	});
	explorer();

	// Mémoire : requêtes gardées dans ce navigateur, par jeu de données
	var listeMemoire = document.getElementById('memoire');
	function afficheMemoire() {
		var memoire = lit(cleMemoire, []);
		listeMemoire.innerHTML = '';
		if (!Array.isArray(memoire) || !memoire.length) {
			listeMemoire.innerHTML = "<li class='astuce'>Aucune requête mémorisée.</li>";
			return;
		}
		memoire.forEach(function (q, i) {
			var li = document.createElement('li');
			var b = document.createElement('button');
			b.type = 'button';
			b.className = 'lien';
			b.title = q;
			b.textContent = q.replace(/^(\s*(PREFIX|BASE)\b[^\n]*\n)*/i, '').replace(/\s+/g, ' ').trim().slice(0, 70);
			b.addEventListener('click', function () { editeur.setValue(q); editeur.focus(); });
			var x = document.createElement('button');
			x.type = 'button';
			x.className = 'supprimer';
			x.title = 'Oublier cette requête';
			x.setAttribute('aria-label', 'Oublier cette requête');
			x.textContent = '✕';
			x.addEventListener('click', function () {
				var m = lit(cleMemoire, []);
				m.splice(i, 1);
				ecrit(cleMemoire, m);
				afficheMemoire();
			});
			li.appendChild(b);
			li.appendChild(x);
			listeMemoire.appendChild(li);
		});
	}
	document.getElementById('memoriser').addEventListener('click', function () {
		var q = editeur.getValue().trim();
		if (q === '') return;
		var m = lit(cleMemoire, []);
		if (!Array.isArray(m)) m = [];
		m = m.filter(function (x) { return x !== q; });
		m.unshift(q);
		ecrit(cleMemoire, m.slice(0, 30));
		afficheMemoire();
	});
	afficheMemoire();
})();
