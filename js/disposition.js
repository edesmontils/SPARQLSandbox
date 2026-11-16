// Disposition en couches d'un graphe orienté (version courte de la méthode de Sugiyama),
// partagée par le diagramme du vocabulaire (vocabulaire.js) et l'éditeur d'ontologie (editeur.js).
//   dispositionCouches(noeuds, aretes, options) -> résultat
//   noeuds   [{w, h, nom}]  largeur, hauteur et nom (pour ranger les ex æquo) de chaque nœud
//   aretes   [{u, v}]       u est placé au-dessus de v (indices de nœuds) ; un cycle est cassé en retournant une arête
//   options  {marge, sep, ecartY, ecartPassage, largeurPassage}
//   résultat {x[], y[]       coin haut gauche de chaque nœud,
//             couche[], rang[]  couche du nœud (les nœuds sans lien viennent après les autres) et rang dans la couche,
//             passages[]     par arête, points {x, y} où elle passe dans les couches qu'elle traverse (de u vers v),
//             largeur, hauteur}
// Étapes : 1. couches (cycles retournés, nœuds sans entrée rapprochés de leur cible) ;
// 2. un point de passage par couche traversée, pour qu'une flèche contourne les nœuds ;
// 3. ordre dans les couches par barycentres, en gardant le meilleur nombre de croisements ;
// 4. abscisses au plus près de la moyenne des voisins (régression isotone), sans chevauchement ;
// 5. nœuds sans lien rangés en bas, par rangées.
(function () {
	'use strict';

	window.dispositionCouches = function (noeuds, aretes, options) {
		var o = Object.assign({ marge: 24, sep: 34, ecartY: 90, ecartPassage: 44, largeurPassage: 14 }, options || {});
		var n = noeuds.length, i;
		var L = aretes.map(function (a, k) { return { u: a.u, v: a.v, k: k, retournee: false }; })
			.filter(function (e) { return e.u !== e.v && e.u >= 0 && e.v >= 0 && e.u < n && e.v < n; });

		// 1. cycles : on retourne les arêtes de retour
		var sortantes = [], etat = [];
		for (i = 0; i < n; i++) { sortantes.push([]); etat.push(0); }
		L.forEach(function (e, j) { sortantes[e.u].push(j); });
		function visite(u) {
			etat[u] = 1;
			sortantes[u].forEach(function (j) {
				var e = L[j];
				if (etat[e.v] === 1) { var t = e.u; e.u = e.v; e.v = t; e.retournee = true; }
				else if (etat[e.v] === 0) visite(e.v);
			});
			etat[u] = 2;
		}
		for (i = 0; i < n; i++) if (etat[i] === 0) visite(i);
		// couches : plus long chemin, puis les nœuds sans entrée descendent vers ce qu'ils pointent
		var entrants = [], sorties = [], couche = [], deg = [];
		for (i = 0; i < n; i++) { entrants.push(0); sorties.push([]); couche.push(0); deg.push(0); }
		L.forEach(function (e) { sorties[e.u].push(e.v); entrants[e.v]++; deg[e.u]++; deg[e.v]++; });
		var restant = entrants.slice(), file = [];
		for (i = 0; i < n; i++) if (restant[i] === 0 && deg[i] > 0) file.push(i);
		while (file.length) {
			var u = file.shift();
			sorties[u].forEach(function (v) { if (couche[v] < couche[u] + 1) couche[v] = couche[u] + 1; if (--restant[v] === 0) file.push(v); });
		}
		for (i = 0; i < n; i++) if (entrants[i] === 0 && sorties[i].length)
			couche[i] = Math.min.apply(null, sorties[i].map(function (v) { return couche[v]; })) - 1;

		// 2. éléments (nœuds et points de passage) et leurs voisins
		var items = [], item_de = {};
		function item(nn, c) {
			var it = { n: nn, w: nn >= 0 ? noeuds[nn].w : o.largeurPassage, h: nn >= 0 ? noeuds[nn].h : 0, couche: c, up: [], down: [], tous: [], x: 0, ordre: 0 };
			items.push(it);
			return it;
		}
		for (i = 0; i < n; i++) if (deg[i] > 0) item_de[i] = item(i, couche[i]);
		L.forEach(function (e) {
			var chaine = [item_de[e.u]];
			for (var l = couche[e.u] + 1; l < couche[e.v]; l++) chaine.push(item(-1, l));
			chaine.push(item_de[e.v]);
			e.chaine = chaine;
			for (var k = 0; k + 1 < chaine.length; k++) {
				chaine[k].down.push(chaine[k + 1]); chaine[k + 1].up.push(chaine[k]);
				chaine[k].tous.push(chaine[k + 1]); chaine[k + 1].tous.push(chaine[k]);
			}
		});
		var nbCouches = items.reduce(function (m, it) { return Math.max(m, it.couche + 1); }, 0);
		var couches = [];
		for (i = 0; i < nbCouches; i++) couches.push([]);
		items.forEach(function (it) { couches[it.couche].push(it); });

		// 3. ordre dans les couches
		function bary(it, v) { return v.length ? v.reduce(function (s, x) { return s + x.ordre; }, 0) / v.length : it.ordre; }
		couches.forEach(function (C, l) {
			C.sort(function (a, b) { return a.n >= 0 && b.n >= 0 ? String(noeuds[a.n].nom).localeCompare(String(noeuds[b.n].nom)) : 0; });
			C.forEach(function (it, k) { it.ordre = k; });
			if (l > 0) {
				C.forEach(function (it) { it.bc = bary(it, it.up); });
				C.sort(function (a, b) { return (a.bc - b.bc) || (a.ordre - b.ordre); });
				C.forEach(function (it, k) { it.ordre = k; });
			}
		});
		function trie(C, sens) {
			C.forEach(function (it) { it.bc = bary(it, sens > 0 ? it.up : it.down); });
			C.sort(function (a, b) { return (a.bc - b.bc) || (a.ordre - b.ordre); });
			C.forEach(function (it, k) { it.ordre = k; });
		}
		function croisements() {
			var tot = 0;
			for (var l = 0; l + 1 < nbCouches; l++) {
				var P = [];
				couches[l].forEach(function (it) { it.down.forEach(function (v) { P.push([it.ordre, v.ordre]); }); });
				for (var a = 0; a < P.length; a++) for (var b = a + 1; b < P.length; b++)
					if ((P[a][0] - P[b][0]) * (P[a][1] - P[b][1]) < 0) tot++;
			}
			return tot;
		}
		var meilleur = croisements(), sauve = items.map(function (it) { return it.ordre; });
		for (var tour = 0; tour < 14 && meilleur > 0; tour++) {
			for (i = 1; i < nbCouches; i++) trie(couches[i], 1);
			for (i = nbCouches - 2; i >= 0; i--) trie(couches[i], -1);
			var c = croisements();
			if (c < meilleur) { meilleur = c; sauve = items.map(function (it) { return it.ordre; }); }
		}
		items.forEach(function (it, k) { it.ordre = sauve[k]; });
		couches.forEach(function (C) { C.sort(function (a, b) { return a.ordre - b.ordre; }); });

		// 4. abscisses
		function sep(a, b) { return (a.w + b.w) / 2 + o.sep; }
		couches.forEach(function (C) {
			var x = 0;
			C.forEach(function (it, k) { if (k) x += sep(C[k - 1], it); it.x = x; });
			C.forEach(function (it) { it.x -= x / 2; });
		});
		function place(C, cle) {
			var d = [], decal = [], dec = 0, blocs = [];
			C.forEach(function (it, k) {
				if (k) dec += sep(C[k - 1], it);
				decal.push(dec);
				var v = it[cle];
				d.push((v.length ? v.reduce(function (s, x) { return s + x.x; }, 0) / v.length : it.x) - dec);
			});
			d.forEach(function (val, k) {
				blocs.push({ s: val, n: 1, de: k });
				while (blocs.length > 1 && blocs[blocs.length - 2].s / blocs[blocs.length - 2].n > blocs[blocs.length - 1].s / blocs[blocs.length - 1].n) {
					var b = blocs.pop(), a = blocs.pop();
					blocs.push({ s: a.s + b.s, n: a.n + b.n, de: a.de });
				}
			});
			blocs.forEach(function (b) { for (var k = b.de; k < b.de + b.n; k++) C[k].x = b.s / b.n + decal[k]; });
		}
		for (var r = 0; r < 8; r++) {
			for (i = 1; i < nbCouches; i++) place(couches[i], 'up');
			for (i = nbCouches - 2; i >= 0; i--) place(couches[i], 'down');
		}
		for (i = 0; i < nbCouches; i++) place(couches[i], 'tous');
		var minX = items.reduce(function (m, it) { return Math.min(m, it.x - it.w / 2); }, Infinity);
		var maxX = items.reduce(function (m, it) { return Math.max(m, it.x + it.w / 2); }, -Infinity);
		var decalX = o.marge - (isFinite(minX) ? minX : 0);
		// ordonnées : une couche mesure son nœud le plus haut ; une couche de points de passage seuls est étroite
		var y = o.marge, ys = [];
		couches.forEach(function (C) {
			var hm = C.reduce(function (m, it) { return Math.max(m, it.h); }, 0);
			ys.push({ y: y, h: hm });
			y += hm + (hm > 0 ? o.ecartY : o.ecartPassage);
		});

		var res = { x: [], y: [], couche: [], rang: [], passages: [], largeur: 0, hauteur: 0 };
		for (i = 0; i < n; i++) { res.x.push(0); res.y.push(0); res.couche.push(0); res.rang.push(0); }
		items.forEach(function (it) {
			if (it.n < 0) return;
			res.x[it.n] = it.x - it.w / 2 + decalX; res.y[it.n] = ys[it.couche].y;
			res.couche[it.n] = it.couche; res.rang[it.n] = it.ordre;
		});
		aretes.forEach(function () { res.passages.push([]); });
		L.forEach(function (e) {
			var pts = e.chaine.slice(1, -1).map(function (it) { return { x: it.x + decalX, y: ys[it.couche].y + ys[it.couche].h / 2 }; });
			res.passages[e.k] = e.retournee ? pts.reverse() : pts;   // toujours de u vers v, dans l'ordre donné
		});
		var bas = nbCouches ? y - (ys[nbCouches - 1].h > 0 ? o.ecartY : o.ecartPassage) : o.marge;
		var largeur = nbCouches ? maxX + decalX + o.marge : o.marge;
		var hauteur = nbCouches ? bas + o.marge : o.marge;
		// 5. nœuds sans lien : en bas, par rangées
		var isoles = [];
		for (i = 0; i < n; i++) if (deg[i] === 0) isoles.push(i);
		isoles.sort(function (a, b) { return String(noeuds[a].nom).localeCompare(String(noeuds[b].nom)); });
		var pas = (isoles.length ? Math.max.apply(null, isoles.map(function (u) { return noeuds[u].w; })) : 0) + o.sep;
		var parRangee = Math.max(3, Math.min(6, Math.floor(((nbCouches ? maxX + decalX : 5 * pas)) / pas)));
		var yIso = nbCouches ? bas + o.ecartY : o.marge, rangeeNo = 0;
		for (var k = 0; k < isoles.length; k += parRangee, rangeeNo++) {
			var rangee = isoles.slice(k, k + parRangee), hr = 0;
			rangee.forEach(function (u, j) {
				res.x[u] = o.marge + j * pas; res.y[u] = yIso; res.couche[u] = nbCouches + rangeeNo; res.rang[u] = j;
				hr = Math.max(hr, noeuds[u].h);
				largeur = Math.max(largeur, res.x[u] + noeuds[u].w + o.marge);
			});
			hauteur = Math.max(hauteur, yIso + hr + o.marge);
			yIso += hr + o.sep;
		}
		res.largeur = largeur; res.hauteur = hauteur;
		return res;
	};
})();
