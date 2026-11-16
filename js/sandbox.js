// SPARQL Sandbox : éditeur, exécution des requêtes, exploration et mémoire
(function () {
	'use strict';
	var donnees = JSON.parse(document.getElementById('donnees').textContent);

	// Temps restant avant l'expiration de la session (pied de page) ; chaque appel au
	// serveur la prolonge de toute sa durée
	var tempsSession = document.getElementById('temps-session');
	var finSession = Date.now() + donnees.duree_session * 1000;
	function libelleDuree(s) {
		var min = Math.max(1, Math.ceil(s / 60)), h = Math.floor(min / 60), m = min % 60;
		if (h === 0) return m + ' minute' + (m > 1 ? 's' : '');
		return h + ' h ' + (m < 10 ? '0' : '') + m;
	}
	function afficheTempsSession() {
		if (!tempsSession) return;
		var reste = (finSession - Date.now()) / 1000;
		if (reste <= 0) {
			tempsSession.textContent = '⌛ Session expirée : rechargez la page pour continuer.';
			tempsSession.classList.add('bientot');
			return;
		}
		tempsSession.textContent = '⏳ Session : ' + libelleDuree(reste) + ' restante' + (reste > 60 ? 's' : '');
		tempsSession.classList.toggle('bientot', reste <= 10 * 60);
	}
	afficheTempsSession();
	setInterval(afficheTempsSession, 15000);
	function prolongeSession() { finSession = Date.now() + donnees.duree_session * 1000; afficheTempsSession(); }

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
				if (r.headers.get('X-SPARQLSandbox') && r.status !== 403) prolongeSession();
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
		if (!trousComplets()) return;
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
		if (modeleTrous !== null) {
			champsTrous().forEach(function (c) { c.value = ''; c.classList.remove('vide'); ajusteTrou(c); });
			majRequeteTrous();
			resultat.innerHTML = '';
			erreurTrous.hidden = true;
			if (champsTrous()[0]) champsTrous()[0].focus();
			return;
		}
		editeur.setValue('');
		resultat.innerHTML = '';
		editeur.focus();
	});

	document.querySelectorAll('[data-exemple]').forEach(function (b) {
		b.addEventListener('click', function () {
			quitteTrous();
			editeur.setValue(donnees.exemples[+b.dataset.exemple][1]);
			resultat.innerHTML = '';
			editeur.focus();
		});
	});

	// Contenu de la copie ; un clic sur une classe ou une propriété en fait une requête
	var zoneExplorer = document.getElementById('explorer');
	var zoneCoherence = document.getElementById('coherence');
	function prefixesUtiles(nom) {
		var p = nom.indexOf(':') > 0 ? nom.slice(0, nom.indexOf(':')) : null;
		var lignes = [];
		if (p && donnees.prefixes[p]) lignes.push('PREFIX ' + p + ': <' + donnees.prefixes[p] + '>');
		return lignes.length ? lignes.join('\n') + '\n' : '';
	}
	function terme(nom) { return nom.charAt(0) === '<' || nom.indexOf(':') > 0 ? nom : '<' + nom + '>'; }
	function explorer() {
		actualiseVocabulaire();
		appel('explorer').then(function (r) {
			zoneExplorer.innerHTML = r.html;
			zoneCoherence.innerHTML = r.coherence || '';
			zoneExplorer.querySelectorAll('ul[data-sorte] button').forEach(function (b) {
				b.addEventListener('click', function () {
					var sorte = b.closest('ul').dataset.sorte, nom = b.dataset.nom;
					var requete = sorte === 'classes'
						? prefixesUtiles(nom) + 'SELECT ?s\nWHERE {\n  ?s a ' + terme(nom) + ' .\n}\nLIMIT 50'
						: prefixesUtiles(nom) + 'SELECT ?s ?o\nWHERE {\n  ?s ' + terme(nom) + ' ?o .\n}\nLIMIT 50';
					quitteTrous();
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

	// Diagramme du vocabulaire de la copie (js/vocabulaire.js)
	var sectionVoc = document.getElementById('vocabulaire'), perimeVoc = true;
	var zoneVoc = document.getElementById('schema-vocabulaire');
	// Instances d'une classe avec leurs attributs (une colonne par propriété à valeur littérale ;
	// plusieurs valeurs d'une même propriété sont réunies dans la cellule)
	function requeteClasse(nom, classe) {
		var attrs = [], vus = {}, vars = { s: true };
		((classe && classe.attributs) || []).forEach(function (a) {
			if (vus[a.nom]) return;
			vus[a.nom] = true;
			var v = a.nom.replace(/^.*[:#\/]/, '').replace(/[^A-Za-z0-9_]/g, '_').replace(/^(\d)/, '_$1') || 'a', base = v, i = 2;
			while (vars[v]) v = base + (i++);
			vars[v] = true;
			attrs.push({ nom: a.nom, v: v });
		});
		var prefixes = '', deja = {};
		[nom].concat(attrs.map(function (a) { return a.nom; })).forEach(function (n) {
			var p = n.indexOf(':') > 0 ? n.slice(0, n.indexOf(':')) : null;
			if (p && donnees.prefixes[p] && !deja[p]) { deja[p] = true; prefixes += 'PREFIX ' + p + ': <' + donnees.prefixes[p] + '>\n'; }
		});
		if (!attrs.length) return prefixes + 'SELECT ?s\nWHERE {\n  ?s a ' + terme(nom) + ' .\n}\nLIMIT 50';
		var colonnes = attrs.map(function (a) { return '(GROUP_CONCAT(DISTINCT STR(?_' + a.v + '); separator=" | ") AS ?' + a.v + ')'; }).join(' ');
		var optionnels = attrs.map(function (a) { return '  OPTIONAL { ?s ' + terme(a.nom) + ' ?_' + a.v + ' }'; }).join('\n');
		return prefixes + 'SELECT ?s ' + colonnes + '\nWHERE {\n  ?s a ' + terme(nom) + ' .\n' + optionnels + '\n}\nGROUP BY ?s\nORDER BY ?s\nLIMIT 50';
	}
	var panneauVoc = document.getElementById('panneau-vocabulaire');
	var resultatVoc = document.getElementById('resultat-vocabulaire');
	var requeteVoc = null, numeroVoc = 0;
	// Un clic sur le diagramme exécute la requête et montre le résultat à côté, sans la requête
	function interrogeVocabulaire(sorte, nom, classe) {
		if (sorte === 'classes') requeteVoc = requeteClasse(nom, classe);
		else requeteVoc = prefixesUtiles(nom) + 'SELECT ?s ?o\nWHERE {\n  ?s ' + terme(nom) + ' ?o .\n}\nLIMIT 50';
		var mon = ++numeroVoc;
		document.getElementById('titre-panneau-vocabulaire').textContent = (sorte === 'classes' ? 'Instances de ' : 'Triplets de ') + nom;
		resultatVoc.innerHTML = "<p class='astuce'>⏳ Exécution…</p>";
		panneauVoc.hidden = false;
		appel('executer', { requete64: base64(requeteVoc) }).then(function (r) {
			if (mon === numeroVoc) resultatVoc.innerHTML = r.html;
		});
	}
	document.getElementById('reprendre-vocabulaire').addEventListener('click', function () {
		quitteTrous();
		editeur.setValue(requeteVoc);
		resultat.innerHTML = '';
		editeur.focus();
	});
	document.getElementById('fermer-panneau-vocabulaire').addEventListener('click', function () {
		numeroVoc++;
		panneauVoc.hidden = true;
		zoneVoc.querySelectorAll('.voc-choisi').forEach(function (e) { e.classList.remove('voc-choisi'); });
	});
	function metsAJourVocabulaire() {
		zoneVoc.innerHTML = '<p class="astuce">Chargement…</p>';
		panneauVoc.hidden = true;
		numeroVoc++;
		appel('vocabulaire').then(function (r) {
			if (!r.ok) { zoneVoc.innerHTML = r.html; return; }
			window.dessineVocabulaire(r.modele, zoneVoc, interrogeVocabulaire);
		});
	}
	// Le diagramme suit la copie : redessiné à chaque actualisation, ou à l'ouverture s'il est replié
	function actualiseVocabulaire() {
		if (!sectionVoc) return;
		if (sectionVoc.open) { perimeVoc = false; metsAJourVocabulaire(); } else perimeVoc = true;
	}
	sectionVoc.addEventListener('toggle', function () { if (sectionVoc.open && perimeVoc) actualiseVocabulaire(); });
	actualiseVocabulaire();

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
			b.addEventListener('click', function () { quitteTrous(); editeur.setValue(q); editeur.focus(); });
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

	//------------------------------------------------------
	// Requête à trous (types rI->R, rIT->R), saisie comme dans SQLSandbox et QueryCraft :
	// le modèle marque chaque trou par « ___ » (trois soulignés ou plus) ; chaque trou a son
	// champ, et la requête assemblée (« ___ » pour un trou vide) va dans l'éditeur, masqué,
	// que lisent l'exécution, la vérification et le suivi. L'exécution attend tous les trous.
	//------------------------------------------------------
	var MARQUE_TROU = /_{3,}/;
	var modeleTrous = null; // modèle de la question à trous affichée, null sinon
	var assemblage = false; // vrai pendant que l'éditeur reçoit la requête assemblée
	var zoneTrous = document.createElement('div');
	zoneTrous.className = 'trous cm-s-default';
	zoneTrous.id = 'trous';
	zoneTrous.hidden = true;
	var erreurTrous = document.createElement('p');
	erreurTrous.className = 'statut ko';
	erreurTrous.id = 'trous-erreur';
	erreurTrous.hidden = true;
	var consigneTrous = document.createElement('p');
	consigneTrous.className = 'libelle';
	consigneTrous.hidden = true;
	consigneTrous.innerHTML = 'Complétez la requête en remplissant les trous '
		+ '<span class="astuce">(Entrée : trou suivant, Ctrl+Entrée : vérifier)</span>';
	var enveloppe = editeur.getWrapperElement();
	enveloppe.parentNode.insertBefore(consigneTrous, enveloppe);
	enveloppe.parentNode.insertBefore(zoneTrous, enveloppe);
	enveloppe.parentNode.insertBefore(erreurTrous, enveloppe);
	var boutonPrefixes = document.getElementById('prefixes');

	function aTrous(q) { return !!(q && q.attendu === 'R' && q.modele && MARQUE_TROU.test(q.modele)); }
	function partiesModele(modele) { return modele.split(MARQUE_TROU); }
	// Valeurs des trous retrouvées dans une réponse, ou null si elle ne suit pas le modèle
	function valeursTrous(modele, requete) {
		var esc = function (x) { return x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); };
		var m = new RegExp('^' + partiesModele(modele).map(esc).join('([\\s\\S]*?)') + '$').exec(requete || '');
		if (!m) return null;
		return m.slice(1).map(function (v) { return MARQUE_TROU.test(v) && !v.replace(MARQUE_TROU, '').trim() ? '' : v; });
	}
	function champsTrous() { return Array.prototype.slice.call(zoneTrous.querySelectorAll('.trou')); }
	function assembleTrous() {
		var parties = partiesModele(modeleTrous), champs = champsTrous(), r = parties[0];
		for (var i = 1; i < parties.length; i++) r += ((champs[i - 1] ? champs[i - 1].value.trim() : '') || '___') + parties[i];
		return r;
	}
	function majRequeteTrous() {
		assemblage = true;
		editeur.setValue(assembleTrous());
		assemblage = false;
	}
	function ajusteTrou(champ) { champ.style.width = Math.max(8, champ.value.length + 2) + 'ch'; }

	// Coloration SPARQL d'un texte, par le mode CodeMirror de l'éditeur (HTML échappé)
	function coloreSparql(texte) {
		var mode = CodeMirror.getMode(editeur.options, editeur.getOption('mode'));
		var etat = CodeMirror.startState(mode), h = '';
		texte.split('\n').forEach(function (ligne, n) {
			if (n) h += '\n';
			var flux = new CodeMirror.StringStream(ligne, editeur.getOption('tabSize'));
			if (!ligne && mode.blankLine) mode.blankLine(etat);
			while (!flux.eol()) {
				var style = mode.token(flux, etat), mot = echappe(flux.current());
				h += style ? '<span class="' + style.replace(/(^|\s+)/g, '$1cm-') + '">' + mot + '</span>' : mot;
				flux.start = flux.pos;
			}
		});
		return h;
	}

	function afficheTrous(q, reponse) {
		modeleTrous = q.modele;
		var valeurs = valeursTrous(q.modele, reponse || '');
		var parties = partiesModele(q.modele);
		// La requête est colorée d'un seul tenant, chaque trou y étant un repère (un mot ASCII
		// que l'analyseur garde d'un bloc) ; les repères deviennent ensuite les champs
		var texte = parties[0];
		for (var k = 1; k < parties.length; k++) texte += 'qqtrou' + k + 'qq' + parties[k];
		zoneTrous.innerHTML = coloreSparql(texte).replace(/qqtrou(\d+)qq/g, '<span class="place-trou" data-trou="$1"></span>');
		zoneTrous.querySelectorAll('.place-trou').forEach(function (place) {
			var i = parseInt(place.getAttribute('data-trou'), 10);
			var champ = document.createElement('input');
			champ.type = 'text';
			champ.className = 'trou';
			champ.spellcheck = false;
			champ.autocomplete = 'off';
			champ.setAttribute('autocapitalize', 'off');
			champ.setAttribute('aria-label', 'Trou ' + i + ' sur ' + (parties.length - 1));
			champ.value = valeurs ? valeurs[i - 1] : '';
			ajusteTrou(champ);
			champ.addEventListener('input', function () {
				ajusteTrou(champ);
				champ.classList.remove('vide');
				erreurTrous.hidden = true;
				majRequeteTrous();
			});
			champ.addEventListener('keydown', function (e) {
				if (e.key !== 'Enter') return;
				e.preventDefault();
				if (e.ctrlKey || e.metaKey) { raccourci(); return; }
				var champs = champsTrous(), suivant = champs[champs.indexOf(champ) + 1];
				if (suivant) suivant.focus();
			});
			place.parentNode.replaceChild(champ, place);
		});
		zoneTrous.hidden = consigneTrous.hidden = false;
		erreurTrous.hidden = true;
		enveloppe.hidden = true;
		boutonPrefixes.hidden = true;
		majRequeteTrous();
	}

	// Retour à l'éditeur complet (autre question, fin de l'exercice, ou requête remplacée
	// par un exemple ou l'explorateur)
	function quitteTrous() {
		if (modeleTrous === null) return;
		modeleTrous = null;
		zoneTrous.hidden = consigneTrous.hidden = erreurTrous.hidden = true;
		zoneTrous.innerHTML = '';
		enveloppe.hidden = false;
		boutonPrefixes.hidden = false;
		editeur.refresh();
	}

	// Avant exécution : tous les trous remplis, sinon les vides sont signalés
	function trousComplets() {
		if (modeleTrous === null) return true;
		var vides = champsTrous().filter(function (c) { return !c.value.trim(); });
		vides.forEach(function (c) { c.classList.add('vide'); });
		if (vides.length === 0) return true;
		erreurTrous.textContent = vides.length === 1 ? "⚠️ Il reste un trou à compléter avant d'exécuter la requête."
			: '⚠️ Il reste ' + vides.length + " trous à compléter avant d'exécuter la requête.";
		erreurTrous.hidden = false;
		vides[0].focus();
		return false;
	}
	function cleSuivi(code) { return 'sparqlsandbox-exercice-' + donnees.jeu + '-' + code; }
	function suivi(code) {
		var s = lit(cleSuivi(code), {});
		return s && typeof s === 'object' && !Array.isArray(s) ? s : {};
	}
	function etatQuestion(q) { return suivi(exercice.code)[q.code] || {}; }
	// codeEx : exercice de la question, quand il a pu être quitté entre-temps (réponse tardive)
	function noteQuestion(q, champs, codeEx) {
		codeEx = codeEx || exercice.code;
		var s = suivi(codeEx), e = s[q.code] || {};
		Object.keys(champs).forEach(function (k) { e[k] = champs[k]; });
		s[q.code] = e;
		ecrit(cleSuivi(codeEx), s);
	}
	// Faite : requête vérifiée juste, intention jugée correcte par l'IA, ou comparée à celle de
	// l'enseignant (auto-évaluation)
	function faite(e) { return !!(e && (e.reussie || (e.comparee && !(e.comparaison && e.comparaison.ia)))); }

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
		modeCopie(false);
		exercice = null;
		panneau.hidden = true;
		panneau.innerHTML = '';
		boutonVerifier.hidden = true;
		titreEditeur.textContent = titreLibre;
		quitteTrous();
		lecture(false);
		editeur.setValue(texteLibre !== null ? texteLibre : '');
		resultat.innerHTML = '';
		adresse(null);
	}

	function afficheQuestion(i) {
		modeCopie(false);
		exercice.index = i;
		var q = questionCourante(), e = etatQuestion(q), n = exercice.questions.length, s = suivi(exercice.code);
		var h = '<div class="exercice-entete"><h2 class="title">📝 ' + echappe(exercice.code) + ' · question ' + q.numero + '/' + n
			+ ' <span class="sorte">' + echappe(q.libelle) + '</span></h2>'
			+ '<span class="boutons-entete"><button type="button" class="btn secondaire" data-action="copie">📄 Ma copie</button>'
			+ '<button type="button" class="btn secondaire" data-action="quitter">✖ Quitter l\'exercice</button></span></div>';
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
				+ '<div class="boutons"><button type="button" class="btn" data-action="comparer">'
					+ (donnees.ia ? '✅ Faire corriger mon intention' : '✅ Comparer avec l\'intention attendue') + '</button></div>'
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
			quitteTrous();
			editeur.setValue(typeof e.reponse === 'string' ? e.reponse : (q.modele || ''));
			if (aTrous(q)) afficheTrous(q, typeof e.reponse === 'string' ? e.reponse : '');
		} else {
			quitteTrous();
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
		panneau.querySelector('[data-action="copie"]').addEventListener('click', afficheCopie);
		panneau.querySelector('[data-action="precedente"]').addEventListener('click', function () { afficheQuestion(i - 1); });
		panneau.querySelector('[data-action="suivante"]').addEventListener('click', function () { afficheQuestion(i + 1); });
		var comparer = panneau.querySelector('[data-action="comparer"]');
		if (comparer) comparer.addEventListener('click', function () { compareIntention(q, comparer); });
	}

	function verifier() {
		var q = questionCourante();
		if (!trousComplets()) return;
		boutonVerifier.disabled = true;
		resultat.innerHTML = "<p class='astuce'>⏳ Vérification…</p>";
		var requete = editeur.getValue();
		appel('verifier', { exercice: exercice.code, question: q.code, requete64: base64(requete) }).then(function (r) {
			boutonVerifier.disabled = false;
			resultat.innerHTML = r.html;
			// La dernière vérification est gardée pour la copie
			var statut = resultat.querySelector('.statut'), correct = resultat.querySelector('[data-correct]');
			noteQuestion(q, { verification: { date: Date.now(), requete: requete, ok: !!r.ok,
				correct: correct ? correct.dataset.correct === '1' : null,
				message: statut ? statut.textContent.trim().slice(0, 300) : '' } });
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
		var codeEx = exercice.code;
		bouton.disabled = true;
		if (donnees.ia) zone.innerHTML = "<p class='astuce'>⏳ Correction en cours…</p>";
		appel('intention', { exercice: exercice.code, question: q.code, intention: texte }).then(function (r) {
			// l'étudiant a pu changer de question pendant la correction
			if (r.ok) {
				var c = { date: Date.now(), texte: texte };
				if (r.ia) { c.ia = true; c.verdict = r.ia.verdict || ''; c.explication = r.ia.explication || ''; c.modele = r.ia.modele || ''; }
				noteQuestion(q, { comparee: true, comparaison: c }, codeEx);
				// une intention corrigée par l'IA ne compte comme faite que si elle est jugée correcte
				if (!r.ia || r.ia.verdict === 'correct') noteQuestion(q, { reussie: true }, codeEx);
				majCartes();
			}
			if (!exercice || exercice.code !== codeEx || questionCourante() !== q || !document.getElementById('correction')) return;
			bouton.disabled = false;
			zone.innerHTML = r.html;
			if (r.ok && (!r.ia || r.ia.verdict === 'correct')) {
				var b = panneau.querySelector('[data-question="' + exercice.index + '"]');
				if (b) b.classList.add('faite');
			}
		});
	}

	//------------------------------------------------------
	// Copie de l'étudiant, comme dans SQLSandbox : ses réponses à l'exercice et ce qu'il en
	// a fait (vérifications, comparaisons d'intention), à imprimer ou enregistrer en PDF
	//------------------------------------------------------
	var sectionEditeur = document.querySelector('.post.editeur');
	var cleNom = 'sparqlsandbox-nom';
	var titreAvantImpression = null;

	function modeCopie(oui) {
		document.body.classList.toggle('mode-copie', oui);
		sectionEditeur.hidden = oui;
	}
	function dateLisible(ms) {
		var d = new Date(ms);
		return d.toLocaleDateString('fr-FR') + ' à ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
	}
	// Texte de l'IA (Markdown simple) en HTML sûr, comme ia_texte_html() du serveur : échappé,
	// puis code, gras, italique et retours à la ligne
	function texteIa(t) {
		return echappe(t).replace(/`([^`\n]+)`/g, '<code>$1</code>')
			.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
			.replace(/(^|[^\w*])\*([^*\n]+)\*(?![\w*])/g, '$1<em>$2</em>')
			.replace(/\n/g, '<br>');
	}
	function pluriel(n, mot) { return n + ' ' + mot + (n > 1 ? 's' : ''); }
	// Une réponse compte si elle n'est pas vide et diffère du modèle donné au départ
	function repondue(q, e) {
		if (q.attendu === 'I') return typeof e.intention === 'string' && e.intention.trim() !== '';
		return typeof e.reponse === 'string' && e.reponse.trim() !== '' && e.reponse.trim() !== (q.modele || '').trim();
	}

	function copieVerification(e) {
		var v = e.verification;
		if (!v) return '<p class="copie-etat attention">Réponse jamais vérifiée.</p>';
		var h = '<p class="copie-etat' + (v.correct === true ? ' juste' : (v.correct === false || !v.ok) ? ' attention' : '') + '">'
			+ 'Dernière vérification, le ' + dateLisible(v.date) + ' : ' + echappe(v.message || (v.ok ? 'requête exécutée.' : 'erreur.')) + '</p>';
		if ((e.reponse || '').trim() !== (v.requete || '').trim())
			h += '<p class="copie-etat attention">La réponse a été modifiée depuis cette vérification.</p>';
		return h;
	}
	function copieComparaison(e) {
		var c = e.comparaison;
		if (!c) return e.comparee ? '<p class="copie-etat">Intention comparée à celle de l\'enseignant (auto-évaluation).</p>'
			: '<p class="copie-etat">' + (donnees.ia ? 'Correction' : 'Comparaison') + ' non demandée.</p>';
		var h;
		if (c.ia) {
			var libelles = { correct: 'intention correcte', partiel: 'intention partiellement correcte', incorrect: 'intention incorrecte' };
			h = '<div class="copie-correction"><p class="copie-etat' + (c.verdict === 'correct' ? ' juste' : ' attention') + '">'
				+ 'Corrigée par une IA (' + echappe(c.modele || '') + ') le ' + dateLisible(c.date) + ' : <strong>'
				+ echappe(libelles[c.verdict] || 'sans verdict') + '</strong></p>'
				+ (c.explication ? '<p>' + texteIa(c.explication) + '</p>' : '') + '</div>';
		} else h = '<p class="copie-etat">Comparée à l\'intention de l\'enseignant le ' + dateLisible(c.date) + ' (auto-évaluation).</p>';
		if ((e.intention || '').trim() !== (c.texte || '').trim())
			h += '<p class="copie-etat attention">L\'intention a été modifiée après cette comparaison.</p>';
		return h;
	}

	function afficheCopie() {
		var qs = exercice.questions, s = suivi(exercice.code);
		var nbRep = 0, nbJustes = 0, nbComp = 0;
		qs.forEach(function (q) {
			var e = s[q.code] || {};
			if (repondue(q, e)) nbRep++;
			if (q.attendu === 'R' && e.reussie) nbJustes++;
			if (q.attendu === 'I' && e.comparee) nbComp++;
		});
		var nom = lit(cleNom, '');
		var h = '<div class="sans-impression"><div class="boutons">'
			+ '<button type="button" class="btn" data-action="imprimer">🖨️ Imprimer ou enregistrer en PDF</button>'
			+ '<button type="button" class="btn secondaire" data-action="retour">⬅️ Retour à l\'exercice</button></div>'
			+ '<p class="astuce">Dans la fenêtre d\'impression, choisissez « Enregistrer au format PDF » comme imprimante.</p></div>';
		h += '<article class="copie"><header class="copie-entete"><h2>Copie — exercice ' + echappe(exercice.code) + '</h2>'
			+ '<p><label for="copie-nom">Nom et prénom :</label> <input type="text" id="copie-nom" maxlength="100" autocomplete="name" value="'
			+ echappe(typeof nom === 'string' ? nom : '') + '"></p>'
			+ '<p>Jeu de données <strong>' + echappe(donnees.titre_jeu || donnees.jeu) + '</strong> · copie établie le ' + dateLisible(Date.now())
			+ ' · ' + echappe(donnees.appli || 'SPARQL Sandbox') + ' ' + echappe(donnees.version || '') + '</p>'
			+ '<p class="copie-bilan">' + nbRep + ' / ' + pluriel(qs.length, 'question') + ' avec une réponse';
		if (qs.some(function (q) { return q.attendu === 'R'; }))
			h += ' · ' + pluriel(nbJustes, 'requête') + ' vérifiée' + (nbJustes > 1 ? 's' : '') + ' juste' + (nbJustes > 1 ? 's' : '');
		if (qs.some(function (q) { return q.attendu === 'I'; }))
			h += ' · ' + pluriel(nbComp, 'intention') + (donnees.ia
				? ' soumise' + (nbComp > 1 ? 's' : '') + ' à correction'
				: ' comparée' + (nbComp > 1 ? 's' : '') + ' à celle de l\'enseignant');
		h += '</p><p class="copie-avertissement">« Juste » veut dire que, lors de la vérification, la requête donnait sur la copie '
			+ 'du jeu de données de l\'étudiant le même résultat que la solution.</p></header>';
		qs.forEach(function (q) {
			var e = s[q.code] || {};
			h += '<section class="copie-question"><h3>Question ' + q.numero + ' <span class="type">' + echappe(q.libelle || '') + '</span></h3>';
			if (q.instructions) h += '<p class="copie-consigne">' + echappe(q.instructions) + '</p>';
			if (q.attendu === 'I') h += '<p class="libelle">Requête donnée :</p><pre class="cm-s-default copie-sparql">' + coloreSparql(q.requete) + '</pre>';
			else h += '<p class="copie-enonce">' + echappe(q.intention) + '</p>';
			h += '<p class="libelle">' + (q.attendu === 'I' ? 'Intention rédigée' : 'Requête proposée') + ' :</p>';
			if (!repondue(q, e)) h += '<p class="copie-vide">Non traitée.</p>';
			else if (q.attendu === 'I')
				h += '<blockquote class="copie-texte">' + echappe(e.intention).replace(/\n/g, '<br>') + '</blockquote>' + copieComparaison(e);
			else h += '<pre class="cm-s-default copie-sparql">' + coloreSparql(e.reponse) + '</pre>' + copieVerification(e);
			h += '</section>';
		});
		h += '<footer class="copie-pied">Copie établie par le navigateur de l\'étudiant à partir de ce qu\'il y a saisi et vérifié.</footer></article>';

		quitteTrous();
		modeCopie(true);
		panneau.innerHTML = h;
		panneau.hidden = false;
		boutonVerifier.hidden = true;
		resultat.innerHTML = '';
		var champNom = document.getElementById('copie-nom');
		champNom.addEventListener('input', function () { ecrit(cleNom, champNom.value); });
		panneau.querySelector('[data-action="imprimer"]').addEventListener('click', function () {
			if (champNom.value.trim() === '') {
				alert('Indiquez votre nom et votre prénom en haut de la copie.');
				champNom.focus();
				return;
			}
			window.print();
		});
		panneau.querySelector('[data-action="retour"]').addEventListener('click', function () { afficheQuestion(exercice.index); });
		panneau.scrollIntoView({ block: 'start' });
	}

	// Nom proposé pour le fichier PDF : les navigateurs reprennent le titre de la page. Il est
	// posé juste avant l'impression et rendu après (« Martin Élise - cinema-tp1 »).
	function nomFichierCopie() {
		var propre = function (x) { return x.replace(/[\/\\:*?"<>|\u0000-\u001f]+/g, '-').replace(/\s+/g, ' ').trim(); };
		var champ = document.getElementById('copie-nom'), nom = propre(champ ? champ.value : '').slice(0, 80);
		return (nom ? nom + ' - ' : '') + propre(exercice.code);
	}
	window.addEventListener('beforeprint', function () {
		if (!exercice || !document.getElementById('copie-nom') || titreAvantImpression !== null) return;
		titreAvantImpression = document.title;
		document.title = nomFichierCopie();
	});
	window.addEventListener('afterprint', function () {
		if (titreAvantImpression === null) return;
		document.title = titreAvantImpression;
		titreAvantImpression = null;
	});

	// Cartes des exercices
	document.querySelectorAll('.carte-exercice').forEach(function (c) {
		c.addEventListener('click', function () { ouvreExercice(c.dataset.exercice); });
	});
	majCartes();
	if (donnees.exercice && document.querySelector('.carte-exercice[data-exercice="' + CSS.escape(donnees.exercice) + '"]'))
		ouvreExercice(donnees.exercice);
})();
