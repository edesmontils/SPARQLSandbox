// Diagramme du vocabulaire d'un jeu : classes (avec leurs attributs), sous-classes et propriétés
// entre classes. SVG dessiné ici, sans bibliothèque, à partir du modèle de vocabulaire.php.
//   dessineVocabulaire(modele, conteneur, surClic)
// surClic(sorte, nom, classe) est appelé au clic sur une classe ('classes', avec son objet du modèle)
// ou une propriété ('proprietes') ; surClic(null, null, null) quand on clique de nouveau sur ce qui était choisi.
// Trait plein : observé dans les données ; pointillé : déclaré mais jamais observé.
// Disposition en couches : une super-classe est au-dessus de ses sous-classes, le domaine d'une
// propriété au-dessus de sa portée ; les liens qui traversent une couche peuvent passer sur un nœud.
(function () {
	'use strict';

	var LARGEUR_CAR = 7.4, HAUT_ENTETE = 30, HAUT_LIGNE = 18, MARGE = 24, ECART_X = 70, ECART_Y = 110;
	var RESSOURCE = 'http://www.w3.org/2000/01/rdf-schema#Resource';

	function echappe(t) {
		return String(t).replace(/[&<>"']/g, function (c) {
			return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
		});
	}

	// Étiquette d'un attribut : « nom : type (n) »
	function ligneAttribut(a) { return a.nom + ' : ' + a.type + (a.n > 0 ? ' (' + a.n + ')' : ''); }
	function entete(c) { return c.nom + (c.n > 0 ? '  · ' + c.n : ''); }

	window.dessineVocabulaire = function (m, conteneur, surClic) {
		var noeuds = m.classes.slice();
		if (noeuds.length === 0) {
			conteneur.innerHTML = '<p class="astuce">Aucune classe ni propriété à représenter : ajoutez des données typées (<code>a</code> ' +
				'ou <code>rdf:type</code>) ou déclarez un vocabulaire (<code>rdfs:Class</code>, <code>rdfs:domain</code>…).</p>';
			return;
		}
		var index = {};
		noeuds.forEach(function (c, i) { index[c.iri] = i; });
		var sous = m.sous.filter(function (s) { return index[s.de] !== undefined && index[s.vers] !== undefined; });
		var liens = m.liens.filter(function (l) { return index[l.de] !== undefined && index[l.vers] !== undefined; });

		// Dimensions des nœuds
		var boites = noeuds.map(function (c) {
			var texte = [entete(c)].concat(c.attributs.map(ligneAttribut));
			var l = Math.max.apply(null, texte.map(function (t) { return t.length; }));
			return { w: Math.max(150, Math.ceil(l * LARGEUR_CAR) + 28), h: HAUT_ENTETE + c.attributs.length * HAUT_LIGNE + 8, x: 0, y: 0 };
		});

		// Disposition en couches (js/disposition.js) : une super-classe au-dessus de ses sous-classes,
		// le domaine d'une propriété au-dessus de sa portée ; les classes sans lien sont rangées en bas
		var aretes = [];
		sous.forEach(function (s) { aretes.push({ u: index[s.vers], v: index[s.de] }); });
		liens.forEach(function (l) { aretes.push({ u: index[l.de], v: index[l.vers] }); });
		var D = window.dispositionCouches(boites.map(function (b, u) { return { w: b.w, h: b.h, nom: noeuds[u].nom }; }), aretes,
			{ marge: MARGE, sep: ECART_X, ecartY: ECART_Y, ecartPassage: 56 });
		boites.forEach(function (b, u) { b.x = D.x[u]; b.y = D.y[u]; });
		var couche = D.couche, rang = D.rang, largeur = D.largeur, hauteur = D.hauteur;

		// Arêtes à tracer : [source, cible, sorte, lien]
		var traits = [];
		sous.forEach(function (s, k) { traits.push({ a: index[s.de], b: index[s.vers], sorte: 'sous', arete: k }); });
		liens.forEach(function (l, k) { traits.push({ a: index[l.de], b: index[l.vers], sorte: 'lien', lien: l, arete: sous.length + k }); });

		// Place à droite pour les boucles (propriété d'une classe vers elle-même) et leur étiquette
		if (traits.some(function (t) { return t.a === t.b; })) largeur += 170;
		// Liens parallèles (mêmes extrémités) : leurs étiquettes sont décalées en hauteur
		var groupes = {}, rangGroupe = [];
		traits.forEach(function (t, k) {
			var cle = Math.min(t.a, t.b) + '-' + Math.max(t.a, t.b);
			groupes[cle] = (groupes[cle] || 0) + 1;
			rangGroupe[k] = [cle, groupes[cle] - 1];
		});

		function centreX(u) { return boites[u].x + boites[u].w / 2; }
		// Points de passage : ceux de la disposition vont de u (au-dessus) vers v ; un trait « sous » est tracé de la sous-classe vers sa super-classe
		traits.forEach(function (t) {
			var pts = D.passages[t.arete];
			t.passages = t.sorte === 'sous' ? pts.slice().reverse() : pts;
		});

		// Côté d'attache et ports (répartis le long du côté, triés par abscisse de l'autre extrémité)
		var ports = {};
		traits.forEach(function (t, k) {
			t.boucle = t.a === t.b;
			if (t.boucle) return;
			var ca = couche[t.a], cb = couche[t.b];
			if (ca === cb) { t.coteA = 'haut'; t.coteB = 'haut'; }
			else { t.coteA = ca < cb ? 'bas' : 'haut'; t.coteB = ca < cb ? 'haut' : 'bas'; }
			var pa = t.passages.length ? t.passages[0].x : centreX(t.b);
			var pb = t.passages.length ? t.passages[t.passages.length - 1].x : centreX(t.a);
			[['a', t.a, t.coteA, pa], ['b', t.b, t.coteB, pb]].forEach(function (p) {
				var cle = p[1] + ':' + p[2];
				(ports[cle] = ports[cle] || []).push({ trait: k, fin: p[0], autre: p[3] });
			});
		});
		Object.keys(ports).forEach(function (cle) {
			var liste = ports[cle], u = parseInt(cle, 10);
			liste.sort(function (p, q) { return p.autre - q.autre || p.trait - q.trait; });
			liste.forEach(function (p, r) {
				traits[p.trait]['x' + p.fin] = boites[u].x + boites[u].w * (r + 1) / (liste.length + 1);
			});
		});

		// Dessin
		var defs = '<defs>' +
			'<marker id="voc-fl-obs" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="voc-pointe-obs"/></marker>' +
			'<marker id="voc-fl-decl" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="voc-pointe-decl"/></marker>' +
			'<marker id="voc-fl-sous" viewBox="0 0 12 12" refX="11" refY="6" markerWidth="12" markerHeight="12" orient="auto-start-reverse"><path d="M1,1 L11,6 L1,11 z" class="voc-pointe-sous"/></marker>' +
			'</defs>';
		var dessin = '', etiquettes = '', boucles = {}, posees = [];
		traits.forEach(function (t, k) {
			var A = boites[t.a], B = boites[t.b], d, mx, my;
			var classe = t.sorte === 'sous' ? 'voc-sous' : (t.lien.n > 0 ? 'voc-obs' : 'voc-decl');
			var marqueur = t.sorte === 'sous' ? 'voc-fl-sous' : (t.lien.n > 0 ? 'voc-fl-obs' : 'voc-fl-decl');
			if (t.boucle) {
				boucles[t.a] = (boucles[t.a] || 0) + 1;
				var dec = (boucles[t.a] - 1) * 26;
				var x0 = A.x + A.w, y0 = A.y + 8 + dec, y1 = y0 + 18;
				d = 'M' + x0 + ',' + y0 + ' C' + (x0 + 55) + ',' + (y0 - 6) + ' ' + (x0 + 55) + ',' + (y1 + 6) + ' ' + x0 + ',' + y1;
				mx = x0 + 48; my = (y0 + y1) / 2 + 4;
			} else {
				var x1 = t.xa, x2 = t.xb;
				var y1b = t.coteA === 'bas' ? A.y + A.h : A.y;
				var y2 = t.coteB === 'bas' ? B.y + B.h : B.y;
				if (couche[t.a] === couche[t.b]) {
					var h = 50 + Math.abs(rang[t.a] - rang[t.b]) * 14;
					d = 'M' + x1 + ',' + y1b + ' C' + x1 + ',' + (y1b - h) + ' ' + x2 + ',' + (y2 - h) + ' ' + x2 + ',' + y2;
					mx = (x1 + x2) / 2; my = y1b - h * 0.75;
				} else {
					var pts = [{ x: x1, y: y1b }].concat(t.passages, [{ x: x2, y: y2 }]);
					d = 'M' + x1 + ',' + y1b;
					for (var q = 0; q + 1 < pts.length; q++) {
						var dy = (pts[q + 1].y - pts[q].y) / 2;
						d += ' C' + pts[q].x + ',' + (pts[q].y + dy) + ' ' + pts[q + 1].x + ',' + (pts[q + 1].y - dy) + ' ' + pts[q + 1].x + ',' + pts[q + 1].y;
					}
					// Étiquette au milieu du premier tronçon, entre deux couches
					mx = (pts[0].x + pts[1].x) / 2; my = (pts[0].y + pts[1].y) / 2;
				}
			}
			var nbPar = groupes[rangGroupe[k][0]];
			if (nbPar > 1 && !t.boucle) my += (rangGroupe[k][1] - (nbPar - 1) / 2) * 17;
			if (t.sorte === 'lien') { // deux étiquettes voisines ne se chevauchent pas : la seconde descend d'une ligne
				var larg = (t.lien.nom.length + 6) * 6;
				for (var essai = 0; essai < 6 && posees.some(function (q) { return Math.abs(q.x - mx) < (q.l + larg) / 2 && Math.abs(q.y - my) < 14; }); essai++) my += 15;
				posees.push({ x: mx, y: my, l: larg });
			}
			dessin += '<path d="' + d + '" class="voc-trait ' + classe + '" marker-end="url(#' + marqueur + ')"/>';
			if (t.sorte === 'lien') {
				var info = t.lien.n > 0 ? t.lien.n + ' triplet' + (t.lien.n > 1 ? 's' : '') + ' observé' + (t.lien.n > 1 ? 's' : '')
					: 'déclaré, jamais observé dans vos données';
				etiquettes += '<g class="voc-etiquette ' + classe + '" data-sorte="proprietes" data-nom="' + echappe(t.lien.nom) + '" tabindex="0" role="button">' +
					'<title>' + echappe(t.lien.iri + ' — ' + info) + '</title>' +
					'<text x="' + mx + '" y="' + my + '" text-anchor="' + (t.boucle ? 'start' : 'middle') + '">' + echappe(t.lien.nom + (t.lien.n > 0 ? ' · ' + t.lien.n : '')) + '</text></g>';
			}
		});
		var noeudsSvg = '';
		noeuds.forEach(function (c, u) {
			var b = boites[u];
			var classe = 'voc-noeud' + (c.iri === RESSOURCE ? ' voc-ressource' : '') + (c.n === 0 ? ' voc-vide' : '');
			var info = c.iri + (c.n > 0 ? ' — ' + c.n + ' instance' + (c.n > 1 ? 's' : '') : (c.iri === RESSOURCE ? ' — ressource sans classe' : ' — aucune instance'));
			noeudsSvg += '<g class="' + classe + '" transform="translate(' + b.x + ',' + b.y + ')">' +
				'<title>' + echappe(info) + '</title>' +
				'<rect width="' + b.w + '" height="' + b.h + '" rx="8"/>' +
				(c.iri === RESSOURCE ? '<g>' : '<g class="voc-clic" data-sorte="classes" data-nom="' + echappe(c.nom) + '" tabindex="0" role="button">') +
				'<rect class="voc-entete" width="' + b.w + '" height="' + HAUT_ENTETE + '" rx="8"/>' +
				'<rect class="voc-entete" y="12" width="' + b.w + '" height="' + (HAUT_ENTETE - 12) + '"/>' +
				'<text class="voc-nom" x="' + b.w / 2 + '" y="20" text-anchor="middle">' + echappe(entete(c)) + '</text></g>';
			c.attributs.forEach(function (a, k) {
				noeudsSvg += '<text class="voc-attribut' + (a.n > 0 ? '' : ' voc-decl-texte') + '" x="12" y="' + (HAUT_ENTETE + 14 + k * HAUT_LIGNE) + '">' +
					'<title>' + echappe(a.iri + (a.n > 0 ? ' — ' + a.n + ' valeur(s) observée(s)' : ' — déclaré, jamais observé')) + '</title>' +
					echappe(ligneAttribut(a)) + '</text>';
			});
			noeudsSvg += '</g>';
		});

		conteneur.innerHTML = '<svg class="voc-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + largeur + ' ' + hauteur + '" width="' + largeur +
			'" role="img" aria-label="Diagramme du vocabulaire">' + defs + dessin + noeudsSvg + etiquettes + '</svg>';
		var parNom = {};
		noeuds.forEach(function (c) { parNom[c.nom] = c; });
		conteneur.querySelectorAll('[data-sorte]').forEach(function (g) {
			function ouvre() {
				var etaitChoisi = g.classList.contains('voc-choisi');
				conteneur.querySelectorAll('.voc-choisi').forEach(function (e) { e.classList.remove('voc-choisi'); });
				if (etaitChoisi) { if (surClic) surClic(null, null, null); return; }   // second clic : on désélectionne
				g.classList.add('voc-choisi');
				if (surClic) surClic(g.dataset.sorte, g.dataset.nom, parNom[g.dataset.nom]);
			}
			g.addEventListener('click', ouvre);
			g.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ouvre(); } });
		});
	};
})();
