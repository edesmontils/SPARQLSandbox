// Diagramme du vocabulaire d'un jeu : classes (avec leurs attributs), sous-classes et propriétés
// entre classes. SVG dessiné ici, sans bibliothèque, à partir du modèle de vocabulaire.php.
//   dessineVocabulaire(modele, conteneur, surClic)
// surClic(sorte, nom) est appelé au clic sur une classe ('classes') ou une propriété ('proprietes').
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

	// Couches : arêtes super-classe → sous-classe et domaine → portée, sans les cycles
	function calculeCouches(noeuds, aretes) {
		var n = noeuds.length, suivants = [], etat = [], i;
		for (i = 0; i < n; i++) { suivants.push([]); etat.push(0); }
		aretes.forEach(function (a) { if (a[0] !== a[1]) suivants[a[0]].push(a[1]); });
		// Retire les arêtes de retour (DFS) pour obtenir un graphe sans cycle
		var arriere = {};
		function visite(u) {
			etat[u] = 1;
			suivants[u].forEach(function (v) {
				if (etat[v] === 1) arriere[u + '>' + v] = true;
				else if (etat[v] === 0) visite(v);
			});
			etat[u] = 2;
		}
		for (i = 0; i < n; i++) if (etat[i] === 0) visite(i);
		var entrants = [], couche = [];
		for (i = 0; i < n; i++) { entrants.push(0); couche.push(0); }
		for (i = 0; i < n; i++) suivants[i] = suivants[i].filter(function (v) { return !arriere[i + '>' + v]; });
		for (i = 0; i < n; i++) suivants[i].forEach(function (v) { entrants[v]++; });
		var file = [];
		for (i = 0; i < n; i++) if (entrants[i] === 0) file.push(i);
		while (file.length) {
			var u = file.shift();
			suivants[u].forEach(function (v) {
				if (couche[v] < couche[u] + 1) couche[v] = couche[u] + 1;
				if (--entrants[v] === 0) file.push(v);
			});
		}
		return couche;
	}

	// Ordre dans les couches : balayages (descendants puis montants) par barycentre des voisins
	function ordonne(couches, voisins, rang) {
		var coucheDe = {}, balayage;
		couches.forEach(function (l, ci) { l.forEach(function (u) { coucheDe[u] = ci; }); });
		function position(u) { return (rang[u] + 0.5) / couches[coucheDe[u]].length; }
		for (balayage = 0; balayage < 6; balayage++) {
			var ordre = couches.map(function (_, i) { return balayage % 2 === 0 ? i : couches.length - 1 - i; });
			ordre.forEach(function (ci) {
				var l = couches[ci], cle = {};
				l.forEach(function (u) {
					var vs = voisins[u];
					cle[u] = vs.length ? vs.reduce(function (s, v) { return s + position(v); }, 0) / vs.length : position(u);
				});
				l.sort(function (x, y) { return cle[x] - cle[y]; });
				l.forEach(function (u, i) { rang[u] = i; });
			});
		}
	}

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

		// Couches et ordre
		var aretes = [], voisins = noeuds.map(function () { return []; });
		sous.forEach(function (s) { aretes.push([index[s.vers], index[s.de]]); });
		liens.forEach(function (l) { aretes.push([index[l.de], index[l.vers]]); });
		aretes.forEach(function (a) { voisins[a[0]].push(a[1]); voisins[a[1]].push(a[0]); });
		var couche = calculeCouches(noeuds, aretes);
		var nbCouches = Math.max.apply(null, couche) + 1;
		var couches = [], rang = {}, i;
		for (i = 0; i < nbCouches; i++) couches.push([]);
		noeuds.forEach(function (c, u) { couches[couche[u]].push(u); });
		couches.forEach(function (l) { l.forEach(function (u, k) { rang[u] = k; }); });
		ordonne(couches, voisins, rang);

		// Positions : couches centrées
		var largeurs = couches.map(function (l) {
			return l.reduce(function (s, u) { return s + boites[u].w; }, 0) + Math.max(0, l.length - 1) * ECART_X;
		});
		var largeurMax = Math.max.apply(null, largeurs);
		var y = MARGE, coucheY = [], coucheH = [];
		couches.forEach(function (l, ci) {
			var x = MARGE + (largeurMax - largeurs[ci]) / 2, hMax = 0;
			coucheY[ci] = y;
			l.forEach(function (u) {
				boites[u].x = x; boites[u].y = y;
				x += boites[u].w + ECART_X;
				hMax = Math.max(hMax, boites[u].h);
			});
			coucheH[ci] = hMax;
			y += hMax + ECART_Y;
		});
		var largeur = largeurMax + 2 * MARGE, hauteur = y - ECART_Y + MARGE;

		// Arêtes à tracer : [source, cible, sorte, lien]
		var traits = [];
		sous.forEach(function (s) { traits.push({ a: index[s.de], b: index[s.vers], sorte: 'sous' }); });
		liens.forEach(function (l) { traits.push({ a: index[l.de], b: index[l.vers], sorte: 'lien', lien: l }); });

		// Place à droite pour les boucles (propriété d'une classe vers elle-même) et leur étiquette
		if (traits.some(function (t) { return t.a === t.b; })) largeur += 170;
		// Liens parallèles (mêmes extrémités) : leurs étiquettes sont décalées en hauteur
		var groupes = {}, rangGroupe = [];
		traits.forEach(function (t, k) {
			var cle = Math.min(t.a, t.b) + '-' + Math.max(t.a, t.b);
			groupes[cle] = (groupes[cle] || 0) + 1;
			rangGroupe[k] = [cle, groupes[cle] - 1];
		});

		// Points de passage d'un lien qui franchit des couches : dans les espaces libres entre les
		// nœuds de chaque couche traversée (ou au-delà des extrémités), au plus près de la droite
		var occupe = {};
		function passage(ci, cible) {
			var l = couches[ci], candidats = [], k;
			candidats.push({ id: 'g', x: boites[l[0]].x - ECART_X / 2 });
			for (k = 0; k + 1 < l.length; k++)
				candidats.push({ id: k, x: (boites[l[k]].x + boites[l[k]].w + boites[l[k + 1]].x) / 2 });
			candidats.push({ id: 'd', x: boites[l[l.length - 1]].x + boites[l[l.length - 1]].w + ECART_X / 2 });
			var meilleur = null;
			candidats.forEach(function (c) { if (!meilleur || Math.abs(c.x - cible) < Math.abs(meilleur.x - cible)) meilleur = c; });
			var cle = ci + ':' + meilleur.id, deja = occupe[cle] || 0;
			occupe[cle] = deja + 1;
			return meilleur.x + (deja % 2 ? 1 : -1) * Math.ceil(deja / 2) * 14;
		}
		function centreX(u) { return boites[u].x + boites[u].w / 2; }
		traits.forEach(function (t) {
			t.passages = [];
			var ca = couche[t.a], cb = couche[t.b];
			if (t.a === t.b || Math.abs(ca - cb) < 2) return;
			var pas = ca < cb ? 1 : -1, n = Math.abs(cb - ca), xa = centreX(t.a), xb = centreX(t.b);
			for (var ci = ca + pas, j = 1; ci !== cb; ci += pas, j++) {
				t.passages.push({ x: passage(ci, xa + (xb - xa) * j / n), y: coucheY[ci] + coucheH[ci] / 2 });
			}
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
		var dessin = '', etiquettes = '', boucles = {};
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
		conteneur.querySelectorAll('[data-sorte]').forEach(function (g) {
			function ouvre() {
				conteneur.querySelectorAll('.voc-choisi').forEach(function (e) { e.classList.remove('voc-choisi'); });
				g.classList.add('voc-choisi');
				if (surClic) surClic(g.dataset.sorte, g.dataset.nom);
			}
			g.addEventListener('click', ouvre);
			g.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ouvre(); } });
		});
	};
})();
