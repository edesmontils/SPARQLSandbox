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
			'Ctrl-Enter': function () { raccourci(); },
			'Cmd-Enter': function () { raccourci(); }
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
	editeur.on('change', function () {
		if (!exercice) ecrit(cleBrouillon, editeur.getValue());
		else if (questionCourante().attendu === 'R') noteQuestion(questionCourante(), { reponse: editeur.getValue() });
	});

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

	function echappe(t) {
		return String(t).replace(/[&<>"']/g, function (c) {
			return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
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

	//======================================================
	// Exercices au format QueryCraft
	//======================================================
	// exercice : { code, questions, index } pendant un exercice, null sinon. Les réponses,
	// intentions et réussites sont gardées dans ce navigateur, par exercice.
	var exercice = null;
	var texteLibre = null; // contenu de l'éditeur avant l'ouverture de l'exercice
	var panneau = document.getElementById('exercice');
	var boutonVerifier = document.getElementById('verifier');
	var titreEditeur = document.getElementById('titre-editeur');
	var titreLibre = titreEditeur.textContent;

	function questionCourante() { return exercice.questions[exercice.index]; }
	// Éditeur en lecture seule (requête donnée d'une question d'intention)
	function lecture(oui) {
		editeur.setOption('readOnly', oui);
		editeur.getWrapperElement().classList.toggle('cm-lecture', oui);
	}
	function raccourci() {
		if (exercice && questionCourante().attendu === 'R') verifier(); else executer();
	}
	function cleSuivi(code) { return 'sparqlsandbox-exercice-' + donnees.jeu + '-' + code; }
	function suivi(code) {
		var s = lit(cleSuivi(code), {});
		return s && typeof s === 'object' && !Array.isArray(s) ? s : {};
	}
	function etatQuestion(q) { return suivi(exercice.code)[q.code] || {}; }
	function noteQuestion(q, champs) {
		var s = suivi(exercice.code), e = s[q.code] || {};
		Object.keys(champs).forEach(function (k) { e[k] = champs[k]; });
		s[q.code] = e;
		ecrit(cleSuivi(exercice.code), s);
	}
	function faite(e) { return !!(e && (e.reussie || e.comparee)); }

	// Progression affichée sur les cartes des exercices
	function majCartes() {
		document.querySelectorAll('.carte-exercice').forEach(function (c) {
			var s = suivi(c.dataset.exercice), n = 0;
			Object.keys(s).forEach(function (k) { if (faite(s[k])) n++; });
			var zone = c.querySelector('.carte-suivi');
			zone.textContent = n ? '✓ ' + n + '/' + zone.dataset.total + ' faite' + (n > 1 ? 's' : '') : '';
		});
	}

	function adresse(code) {
		try {
			history.replaceState(null, '', '?jeu=' + encodeURIComponent(donnees.jeu)
				+ (code ? '&exercice=' + encodeURIComponent(code) : ''));
		} catch (e) { /* adresse inchangée */ }
	}

	function ouvreExercice(code) {
		appel('exercice', { exercice: code }).then(function (r) {
			if (!r.ok) { resultat.innerHTML = r.html; return; }
			if (!exercice) texteLibre = editeur.getValue();
			exercice = { code: code, questions: r.exercice.questions, index: 0 };
			// reprise à la première question pas encore faite
			var s = suivi(code), i = 0;
			while (i < exercice.questions.length - 1 && faite(s[exercice.questions[i].code])) i++;
			afficheQuestion(i);
			adresse(code);
			panneau.scrollIntoView({ block: 'start' });
		});
	}

	function quitteExercice() {
		exercice = null;
		panneau.hidden = true;
		panneau.innerHTML = '';
		boutonVerifier.hidden = true;
		titreEditeur.textContent = titreLibre;
		lecture(false);
		editeur.setValue(texteLibre !== null ? texteLibre : '');
		resultat.innerHTML = '';
		adresse(null);
	}

	function afficheQuestion(i) {
		exercice.index = i;
		var q = questionCourante(), e = etatQuestion(q), n = exercice.questions.length, s = suivi(exercice.code);
		var h = '<div class="exercice-entete"><h2 class="title">📝 ' + echappe(exercice.code) + ' · question ' + q.numero + '/' + n
			+ ' <span class="sorte">' + echappe(q.libelle) + '</span></h2>'
			+ '<button type="button" class="btn secondaire" data-action="quitter">✖ Quitter l\'exercice</button></div>';
		h += '<nav class="numeros" aria-label="Questions">';
		exercice.questions.forEach(function (x, k) {
			h += '<button type="button" class="numero' + (k === i ? ' courant' : '') + (faite(s[x.code]) ? ' faite' : '')
				+ '" data-question="' + k + '"' + (k === i ? ' aria-current="step"' : '') + '>' + x.numero + '</button>';
		});
		h += '</nav>';
		h += q.attendu === 'R'
			? '<p class="enonce">' + echappe(q.intention) + '</p>'
			: '<p class="enonce">Que recherche la requête ci-dessous ? Exécutez-la si besoin, puis rédigez son intention.</p>';
		if (q.instructions) h += '<p class="instructions">' + echappe(q.instructions) + '</p>';
		// table calculée et échappée par le serveur
		if (q.table) h += '<details class="attendu" open><summary>Résultat ' + (q.attendu === 'R' ? 'attendu' : 'de la requête') + '</summary>' + q.table + '</details>';
		if (q.aide) h += '<details class="aide"><summary>💡 Indice</summary><p>' + echappe(q.aide) + '</p></details>';
		if (q.attendu === 'I') {
			h += '<label for="intention" class="libelle">Votre intention :</label>'
				+ '<textarea id="intention" rows="3" placeholder="Cette requête recherche…"></textarea>'
				+ '<div class="boutons"><button type="button" class="btn" data-action="comparer">✅ Comparer avec l\'intention attendue</button></div>'
				+ '<div id="correction"></div>';
		}
		h += '<div class="boutons navigation">'
			+ '<button type="button" class="btn secondaire" data-action="precedente"' + (i === 0 ? ' disabled' : '') + '>◀ Précédente</button>'
			+ '<button type="button" class="btn secondaire" data-action="suivante"' + (i === n - 1 ? ' disabled' : '') + '>Suivante ▶</button></div>';
		panneau.innerHTML = h;
		panneau.hidden = false;
		resultat.innerHTML = '';

		if (q.attendu === 'R') {
			titreEditeur.textContent = '✏️ Votre réponse';
			boutonVerifier.hidden = false;
			lecture(false);
			editeur.setValue(typeof e.reponse === 'string' ? e.reponse : (q.modele || ''));
		} else {
			titreEditeur.textContent = '🔎 Requête à comprendre';
			boutonVerifier.hidden = true;
			lecture(true);
			editeur.setValue(q.requete);
			var zone = document.getElementById('intention');
			zone.value = typeof e.intention === 'string' ? e.intention : '';
			zone.addEventListener('input', function () { noteQuestion(q, { intention: zone.value }); });
		}

		panneau.querySelectorAll('[data-question]').forEach(function (b) {
			b.addEventListener('click', function () { afficheQuestion(+b.dataset.question); });
		});
		panneau.querySelector('[data-action="quitter"]').addEventListener('click', quitteExercice);
		panneau.querySelector('[data-action="precedente"]').addEventListener('click', function () { afficheQuestion(i - 1); });
		panneau.querySelector('[data-action="suivante"]').addEventListener('click', function () { afficheQuestion(i + 1); });
		var comparer = panneau.querySelector('[data-action="comparer"]');
		if (comparer) comparer.addEventListener('click', function () { compareIntention(q, comparer); });
	}

	function verifier() {
		var q = questionCourante();
		boutonVerifier.disabled = true;
		resultat.innerHTML = "<p class='astuce'>⏳ Vérification…</p>";
		appel('verifier', { exercice: exercice.code, question: q.code, requete64: base64(editeur.getValue()) }).then(function (r) {
			boutonVerifier.disabled = false;
			resultat.innerHTML = r.html;
			if (resultat.querySelector('[data-correct="1"]')) {
				noteQuestion(q, { reussie: true });
				var b = panneau.querySelector('[data-question="' + exercice.index + '"]');
				if (b) b.classList.add('faite');
				majCartes();
			}
		});
	}
	boutonVerifier.addEventListener('click', verifier);

	function compareIntention(q, bouton) {
		var texte = document.getElementById('intention').value;
		var zone = document.getElementById('correction');
		bouton.disabled = true;
		appel('intention', { exercice: exercice.code, question: q.code, intention: texte }).then(function (r) {
			bouton.disabled = false;
			zone.innerHTML = r.html;
			if (r.ok) {
				noteQuestion(q, { comparee: true });
				var b = panneau.querySelector('[data-question="' + exercice.index + '"]');
				if (b) b.classList.add('faite');
				majCartes();
			}
		});
	}

	document.querySelectorAll('.carte-exercice').forEach(function (c) {
		c.addEventListener('click', function () { ouvreExercice(c.dataset.exercice); });
	});
	majCartes();
	if (donnees.exercice && document.querySelector('.carte-exercice[data-exercice="' + CSS.escape(donnees.exercice) + '"]'))
		ouvreExercice(donnees.exercice);
})();
