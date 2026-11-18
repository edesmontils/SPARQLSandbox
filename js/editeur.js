// Éditeur d'ontologie (page editeur.php) : on modifie un BROUILLON de l'ontologie de la copie de
// session, en graphe (SVG dessiné ici, sans bibliothèque) ou en liste ; « Enregistrer » envoie le
// brouillon à controler.php (action ontologie_enregistrer), qui le traduit en mise à jour SPARQL
// (ontologie.php). Quitter sans enregistrer abandonne simplement le brouillon.
(function () {
	'use strict';

	var donnees = JSON.parse(document.getElementById('donnees').textContent);
	var XSD = 'http://www.w3.org/2001/XMLSchema#', RDFS = 'http://www.w3.org/2000/01/rdf-schema#', RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
	var LARGEUR = 170, ECART_Y = 90, LANGUE_DEFAUT = 'fr';

	function $(s) { return document.querySelector(s); }
	function echappe(t) {
		return String(t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
	}
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
					return { ok: false, html: "<p class='statut ko'>❌ La requête a été bloquée avant d'atteindre l'application (pare-feu ou proxy, code " + r.status + ").</p>" };
				return r.json();
			})
			.catch(function () { return { ok: false, html: "<p class='statut ko'>❌ Le serveur ne répond pas.</p>" }; });
	}
	// Annonce pour les lecteurs d'écran (région vive), en plus du petit message à l'écran
	function annonce(t) {
		var a = document.getElementById('annonce');
		if (!a) return;
		a.textContent = '';
		setTimeout(function () { a.textContent = t; }, 30);
	}
	function toast(t) {
		var e = $('#toast'); e.textContent = t; e.classList.add('vu');
		clearTimeout(toast.minuterie);
		toast.minuterie = setTimeout(function () { e.classList.remove('vu'); }, 2600);
	}

	//--------------------------------------------------------------------------
	// État : le brouillon
	//--------------------------------------------------------------------------
	var E = { classes: [], props: [], types: [], espace: '', prefixe: '', prefixes: {}, meta: { relations: {}, carac: [] }, sel: null, pos: {}, routes: {} }, axOuvert = null;
	var I = null, ouverts = {}, dernierSel = null, iaIris = {}, seulAnon = false, propositions = null, selSous = null, rat = null, poignees = '';
	var vue = 'graphe', lien = null, drag = null, dernier = { t: 0, k: '' }, quitte = false, enCours = false;

	function cl(iri) { return E.classes.filter(function (c) { return c.iri === iri; })[0]; }
	function pr(iri) { return E.props.filter(function (p) { return p.iri === iri; })[0]; }
	function litteral(iri) { return iri.indexOf(XSD) === 0 || iri === RDFS + 'Literal' || iri === RDF + 'langString'; }
	function nomCourt(iri) {
		if (!iri) return '';
		var t = E.types.filter(function (x) { return x.iri === iri; })[0];
		if (t) return t.nom;
		var x = cl(iri) || pr(iri);
		return x ? x.nom : iri.replace(/^.*[#\/]/, '');
	}
	// Nom abrégé d'une IRI avec les préfixes connus de la copie (le plus long espace de noms l'emporte)
	function nomDe(iri) {
		var meilleur = null;
		Object.keys(E.prefixes).forEach(function (p) {
			var ns = E.prefixes[p];
			if (ns && iri.indexOf(ns) === 0 && /^[\p{L}\p{N}_-]*$/u.test(iri.slice(ns.length)) && (!meilleur || ns.length > E.prefixes[meilleur].length)) meilleur = p;
		});
		return meilleur ? meilleur + ':' + iri.slice(E.prefixes[meilleur].length) : iri.replace(/^.*[#\/]/, '');
	}
	// IRI désignée par un identifiant saisi : « prefixe:local » avec n'importe quel préfixe connu, ou la seule partie
	// locale (dans l'espace de noms par défaut) ; renvoie {iri} ou {erreur}
	function resoutIdentifiant(texte, espaceDefaut) {
		var t = String(texte).trim(), m = /^([A-Za-z][\w.-]*):(.*)$/.exec(t);
		if (m) {
			if (!E.prefixes[m[1]]) return { erreur: 'Le préfixe « ' + m[1] + ': » n\'est pas connu : ajoutez-le avec « 🏷️ Préfixes ».' };
			espaceDefaut = E.prefixes[m[1]]; t = m[2];
		}
		if (!/^[\p{L}\p{N}_-]+$/u.test(t)) return { erreur: 'Identifiant « ' + String(texte).trim() + ' » refusé : lettres, chiffres, _ et - seulement, avec ou sans préfixe.' };
		return { iri: espaceDefaut + t };
	}
	function prefixeDe(espace) {
		var p = Object.keys(E.prefixes).filter(function (k) { return E.prefixes[k] === espace; })[0];
		return p ? p + ':' : '';
	}
	function affiche(x) { return x.label || x.nom; }
	function memeListe(a, b) { return a.slice().sort().join(' ') === b.slice().sort().join(' '); }
	// Relations OWL/RDFS d'un concept ('classe') ou d'une propriété ('prop') : [{cle, titre, cible}] (décrites par le serveur, ontologie.php)
	function relationsDe(t) { return (E.meta.relations || {})[t === 'classe' ? 'classes' : 'props'] || []; }
	function cleRelations(t) { return relationsDe(t).map(function (r) { return r.cle; }); }
	// Champs que l'éditeur sait modifier
	function champsDe(t) { return (t === 'classe' ? ['label', 'comment', 'parents'] : ['label', 'comment', 'domain', 'range', 'carac', 'genre', 'min', 'max']).concat(cleRelations(t)); }
	function copieChamps(x, t) { var o = {}; champsDe(t).forEach(function (k) { o[k] = Array.isArray(x[k]) ? x[k].slice() : x[k]; }); return o; }
	function valeursVides(t) {
		var o = { label: '', comment: '' };
		if (t === 'classe') o.parents = []; else { o.domain = ''; o.range = ''; o.carac = []; o.genre = ''; o.min = ''; o.max = ''; }
		cleRelations(t).forEach(function (k) { o[k] = []; });
		return o;
	}
	function modifie(x, t) {
		var o = x.orig;
		return champsDe(t).some(function (k) { return Array.isArray(x[k]) ? !memeListe(x[k], o[k] || []) : x[k] !== o[k]; });
	}
	// Super-classe sélectionnée (flèche « sous-classe de » choisie) pour le concept x
	function parentSel(x) { return selSous && E.sel && E.sel.t === 'classe' && E.sel.iri === x.iri && selSous.iri === x.iri ? selSous.parent : null; }
	function statut(x, t) { return x.supprime ? 'del' : x.nouveau ? 'new' : modifie(x, t) ? 'mod' : ''; }
	function nbModifs() {
		return E.classes.filter(function (c) { return statut(c, 'classe'); }).length + E.props.filter(function (p) { return statut(p, 'prop'); }).length + nbInst();
	}
	function badge(st) {
		return st === 'new' ? '<span class="badge new">nouveau</span>' : st === 'mod' ? '<span class="badge mod">modifié</span>' : st === 'del' ? '<span class="badge del">supprimé</span>' : '';
	}
	// Tous les ancêtres d'un concept (toutes ses super-classes, de proche en proche)
	function ancetres(iri) {
		var r = [], vus = {}, file = [iri];
		while (file.length) {
			var c = cl(file.shift());
			if (c) c.parents.forEach(function (p) { if (!vus[p]) { vus[p] = 1; r.push(p); file.push(p); } });
		}
		return r;
	}

	function charge(m) {
		E.types = m.types; E.espace = m.espace;
		E.meta = m.meta || { relations: {}, carac: [] };
		E.prefixes = m.prefixes || {};
		E.prefixe = prefixeDe(m.espace);
		E.classes = m.classes.map(function (c) {
			var x = Object.assign({}, c); champsDe('classe').forEach(function (k) { if (Array.isArray(x[k])) x[k] = x[k].slice(); }); x.orig = copieChamps(x, 'classe'); x.nouveau = false; x.supprime = false; return x;
		});
		E.props = m.props.map(function (p) {
			var x = Object.assign({}, p); champsDe('prop').forEach(function (k) { if (Array.isArray(x[k])) x[k] = x[k].slice(); }); x.orig = copieChamps(x, 'prop'); x.nouveau = false; x.supprime = false; return x;
		});
		if (E.sel && !(E.sel.t === 'classe' ? cl(E.sel.iri) : pr(E.sel.iri))) E.sel = null;
		if (!E.sel && E.classes.length) E.sel = { t: 'classe', iri: E.classes[0].iri };
		placeInconnus();
	}

	//--------------------------------------------------------------------------
	// Disposition du graphe (couches : super-classe au-dessus de ses sous-classes,
	// domaine d'une propriété au-dessus de sa portée)
	//--------------------------------------------------------------------------
	function attributs(iri) { return E.props.filter(function (p) { return p.domain === iri && p.range && litteral(p.range); }); }
	function hauteur(c) { return 32 + attributs(c.iri).length * 15; }

	// Disposition en couches (js/disposition.js) : une super-classe et un domaine au-dessus de leurs
	// sous-classes et de leurs portées. Renvoie array(positions des concepts, points de passage des flèches).
	function calculeDisposition() {
		var cs = E.classes, idx = {};
		cs.forEach(function (c, k) { idx[c.iri] = k; });
		var aretes = [];
		cs.forEach(function (c, k) { c.parents.forEach(function (p) { if (idx[p] !== undefined && idx[p] !== k) aretes.push({ u: idx[p], v: k, cle: 'sub:' + c.iri + '>' + p }); }); });
		E.props.forEach(function (p) {
			if (p.domain && p.range && !litteral(p.range) && idx[p.domain] !== undefined && idx[p.range] !== undefined && p.domain !== p.range)
				aretes.push({ u: idx[p.domain], v: idx[p.range], cle: 'prop:' + p.iri });
		});
		var D = window.dispositionCouches(cs.map(function (c) { return { w: LARGEUR, h: hauteur(c), nom: c.nom }; }), aretes, { marge: 24, sep: 34, ecartY: ECART_Y });
		var pos = {}, routes = {};
		cs.forEach(function (c, k) { pos[c.iri] = { x: D.x[k], y: D.y[k] }; });
		aretes.forEach(function (e, k) {
			if (!D.passages[k].length) return;
			var u = cs[e.u].iri, v = cs[e.v].iri;
			routes[e.cle] = { u: u, v: v, pu: { x: pos[u].x, y: pos[u].y }, pv: { x: pos[v].x, y: pos[v].y }, pts: D.passages[k] };
		});
		return { pos: pos, routes: routes };
	}
	// Première disposition (sans animation)
	function dispose() { var d = calculeDisposition(); E.pos = d.pos; E.routes = d.routes; }
	// « Réorganiser » : nouvelle disposition, les concepts glissent vers leur place
	function reorganise() {
		var cible = calculeDisposition(), de = {};
		Object.keys(cible.pos).forEach(function (k) { de[k] = E.pos[k] ? { x: E.pos[k].x, y: E.pos[k].y } : cible.pos[k]; });
		E.routes = cible.routes;
		if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) { E.pos = cible.pos; rendGraphe(); return; }
		var t0 = null, DUREE = 450;
		function pas(t) {
			if (t0 === null) t0 = t;
			var k = Math.min(1, (t - t0) / DUREE), f = 1 - Math.pow(1 - k, 3);
			Object.keys(cible.pos).forEach(function (iri) {
				E.pos[iri] = k >= 1 ? cible.pos[iri] : { x: de[iri].x + (cible.pos[iri].x - de[iri].x) * f, y: de[iri].y + (cible.pos[iri].y - de[iri].y) * f };
			});
			rendGraphe();
			if (k < 1) requestAnimationFrame(pas);
		}
		requestAnimationFrame(pas);
	}
	function libre() {
		for (var y = 24; y < 1200; y += 80) for (var x = 24; x < 1200; x += LARGEUR + 20) {
			var ok = E.classes.every(function (c) { var q = E.pos[c.iri]; return !q || Math.abs(q.x - x) >= LARGEUR + 10 || Math.abs(q.y - y) >= hauteur(c) + 20; });
			if (ok) return { x: x, y: y };
		}
		return { x: 24, y: 24 };
	}
	function placeInconnus() {
		if (!Object.keys(E.pos).length) { dispose(); return; }
		E.classes.forEach(function (c) { if (!E.pos[c.iri]) E.pos[c.iri] = libre(); });
	}

	//--------------------------------------------------------------------------
	// Dessin du graphe
	//--------------------------------------------------------------------------
	function geo(c) { var p = E.pos[c.iri] || (E.pos[c.iri] = libre()); return { x: p.x, y: p.y, w: LARGEUR, h: hauteur(c), at: attributs(c.iri) }; }
	function rectPt(n, tx, ty) {
		var cx = n.x + n.w / 2, cy = n.y + n.h / 2, dx = tx - cx, dy = ty - cy;
		if (!dx && !dy) return { x: cx, y: cy };
		var s = Math.min(dx ? (n.w / 2) / Math.abs(dx) : Infinity, dy ? (n.h / 2) / Math.abs(dy) : Infinity);
		return { x: cx + dx * s, y: cy + dy * s };
	}
	function court(t, n) { return t.length > n ? t.slice(0, n - 1) + '…' : t; }

	// Points de passage d'une flèche, dans le sens a -> b ; null si les concepts ont bougé depuis la disposition
	function passage(cle, a) {
		var r = E.routes[cle];
		if (!r) return null;
		var u = E.pos[r.u], v = E.pos[r.v];
		if (!u || !v || u.x !== r.pu.x || u.y !== r.pu.y || v.x !== r.pv.x || v.y !== r.pv.y) return null;
		return a === r.u ? r.pts : r.pts.slice().reverse();
	}
	// Courbe lisse (Catmull-Rom en Bézier) par une suite de points
	function courbe(P) {
		var d = 'M' + P[0].x + ' ' + P[0].y;
		for (var i = 0; i + 1 < P.length; i++) {
			var p0 = P[i - 1] || P[i], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2] || p2;
			d += ' C' + (p1.x + (p2.x - p0.x) / 6) + ' ' + (p1.y + (p2.y - p0.y) / 6) + ' ' + (p2.x - (p3.x - p1.x) / 6) + ' ' + (p2.y - (p3.y - p1.y) / 6) + ' ' + p2.x + ' ' + p2.y;
		}
		return d;
	}

	function traceArete(e, N, decalage) {
		var A = N[e.a], B = N[e.b], x = e.x, t = e.k;
		var st = t === 'sub' ? (x.supprime ? 'del' : (x.nouveau || x.orig.parents.indexOf(e.b) < 0) ? 'new' : '') : statut(x, 'prop');
		var sel = t === 'prop' ? !!(E.sel && E.sel.t === 'prop' && E.sel.iri === x.iri) : parentSel(x) === e.b;
		var P0 = null, P2 = null;
		var cls = 'ge ar' + (t === 'sub' ? ' sub' : '') + (st ? ' st-' + st : '') + (sel ? ' sel' : '');
		var d, lx, ly, via;
		if (e.a === e.b) {
			var x0 = A.x + A.w, y0 = A.y + 10;
			d = 'M' + x0 + ' ' + y0 + ' C' + (x0 + 60) + ' ' + (y0 - 28) + ' ' + (x0 + 60) + ' ' + (y0 + 48) + ' ' + x0 + ' ' + (y0 + 20); lx = x0 + 48; ly = y0 + 10;
		} else if ((via = passage(t === 'sub' ? 'sub:' + x.iri + '>' + e.b : 'prop:' + x.iri, e.a))) {
			// flèche qui traverse des couches : elle passe par les points réservés par la disposition
			var Q0 = rectPt(A, via[0].x, via[0].y), Q2 = rectPt(B, via[via.length - 1].x, via[via.length - 1].y), P = [Q0].concat(via, [Q2]);
			P0 = Q0; P2 = Q2;
			d = courbe(P);
			var m = P.length;
			if (m % 2) { lx = P[(m - 1) / 2].x; ly = P[(m - 1) / 2].y; } else { lx = (P[m / 2 - 1].x + P[m / 2].x) / 2; ly = (P[m / 2 - 1].y + P[m / 2].y) / 2; }
		} else {
			var ax = A.x + A.w / 2, ay = A.y + A.h / 2, bx = B.x + B.w / 2, by = B.y + B.h / 2, dx = bx - ax, dy = by - ay, len = Math.sqrt(dx * dx + dy * dy) || 1;
			var cx = (ax + bx) / 2 + (-dy / len) * decalage, cy = (ay + by) / 2 + (dx / len) * decalage;
			P0 = rectPt(A, cx, cy); P2 = rectPt(B, cx, cy);
			d = 'M' + P0.x + ' ' + P0.y + ' Q' + cx + ' ' + cy + ' ' + P2.x + ' ' + P2.y;
			lx = .25 * P0.x + .5 * cx + .25 * P2.x; ly = .25 * P0.y + .5 * cy + .25 * P2.y;
		}
		// poignées d'extrémité de la flèche choisie : on les glisse vers un autre concept pour la ré-accrocher
		if (sel && P0 && P2 && !x.supprime) {
			var poignee = function (fin, P, F, titre) {
				return '<circle class="he" data-t="' + (t === 'sub' ? 'classe' : 'prop') + '" data-iri="' + echappe(x.iri) + '" data-fin="' + fin + '" data-parent="' + echappe(e.b) + '" data-fx="' + F.x + '" data-fy="' + F.y +
					'" cx="' + P.x + '" cy="' + P.y + '" r="8"><title>' + titre + '</title></circle>';
			};
			if (t === 'prop') poignees += poignee('domain', P0, P2, 'Glisser vers un autre concept : change le domaine') + poignee('range', P2, P0, 'Glisser vers un autre concept (ou le fond : attribut) : change la portée');
			else poignees += poignee('parent', P2, P0, 'Glisser vers un autre concept : change la super-classe');
		}
		return '<g class="' + cls + '" aria-hidden="true" data-edge="' + (t === 'sub' ? 'sub' : 'prop') + '" data-iri="' + echappe(x.iri) + '" data-parent="' + echappe(e.b) + '"><path class="hit" d="' + d + '"/>' +
			'<path class="trait" d="' + d + '" marker-end="' + (t === 'sub' ? 'url(#tri)' : 'url(#fl)') + '"/>' +
			(t === 'prop' ? '<text class="lbl" x="' + lx + '" y="' + (ly - 5) + '">' + echappe(court(affiche(x), 24)) + '</text>' : '') + '</g>';
	}

	function rendGraphe() {
		var svg = $('#svg-graphe'); if (!svg) return;
		var N = {}; E.classes.forEach(function (c) { N[c.iri] = geo(c); });
		poignees = '';
		var ar = [];
		E.classes.forEach(function (c) { c.parents.forEach(function (p) { if (N[p]) ar.push({ k: 'sub', a: c.iri, b: p, x: c }); }); });
		E.props.forEach(function (p) { if (p.domain && N[p.domain] && p.range && N[p.range] && !litteral(p.range)) ar.push({ k: 'prop', a: p.domain, b: p.range, x: p }); });
		var grp = {};
		ar.forEach(function (e) { var k = [e.a, e.b].sort().join(' '); (grp[k] = grp[k] || []).push(e); });
		var h = '<defs><marker id="fl" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#56636e"/></marker>' +
			'<marker id="tri" viewBox="0 0 12 12" refX="11" refY="6" markerWidth="11" markerHeight="11" orient="auto-start-reverse"><path d="M1 1 L11 6 L1 11 z" fill="#fff" stroke="#1f7a8c" stroke-width="1.5"/></marker></defs>';
		Object.keys(grp).forEach(function (k) {
			var L = grp[k];
			L.forEach(function (e, i) { h += traceArete(e, N, (i - (L.length - 1) / 2) * 64 * (e.a < e.b ? 1 : -1)); });
		});
		var largeur = 700, hauteurVue = 380;
		// un seul concept est une étape de tabulation (celui qui est choisi) ; les flèches du clavier font le reste
		var rove = E.sel && E.sel.t === 'classe' && cl(E.sel.iri) ? E.sel.iri : (E.classes[0] ? E.classes[0].iri : null);
		var actif = document.activeElement, focusIri = null;
		if (actif && svg.contains(actif) && actif.closest && actif.closest('.gn')) focusIri = actif.closest('.gn').dataset.cls;
		E.classes.forEach(function (c) {
			var g = N[c.iri], st = statut(c, 'classe'), selC = E.sel && E.sel.t === 'classe' && E.sel.iri === c.iri;
			largeur = Math.max(largeur, g.x + g.w + 90); hauteurVue = Math.max(hauteurVue, g.y + g.h + 40);
			h += '<g class="gn' + (st ? ' st-' + st : '') + (selC ? ' sel' : '') + ((lien && lien.cible === c.iri) || (rat && rat.cible === c.iri) ? ' cible' : '') + '" data-cls="' + echappe(c.iri) + '" role="button" tabindex="' + (c.iri === rove ? 0 : -1) + '"' + (selC ? ' aria-current="true"' : '') +
				' aria-label="' + echappe(descNoeud(c)) + '" transform="translate(' + g.x + ',' + g.y + ')">' +
				'<rect class="corps" width="' + g.w + '" height="' + g.h + '" rx="10"><title>' + echappe(c.iri) + '</title></rect>' +
				'<text class="nom" x="10" y="21">' + echappe(court(affiche(c), 20)) + '</text>' +
				'<text class="cpt" x="' + (g.w - 10) + '" y="21" text-anchor="end">' + (c.n || '') + '</text>';
			g.at.forEach(function (p, i) {
				var s = E.sel && E.sel.t === 'prop' && E.sel.iri === p.iri;
				h += '<text class="at' + (s ? ' sel' : '') + (statut(p, 'prop') === 'new' ? ' new' : '') + '" data-attr="' + echappe(p.iri) + '" aria-hidden="true" x="10" y="' + (40 + i * 15) + '">• ' +
					echappe(court(affiche(p), 12)) + ' : ' + echappe(court(nomCourt(p.range).replace('xsd:', ''), 10)) + '</text>';
			});
			h += '<g class="hd" aria-hidden="true" data-cls="' + echappe(c.iri) + '" data-kind="prop" transform="translate(' + g.w + ',16)"><circle r="8"/><title>Glisser vers un concept : propriété ; vers le fond : attribut</title></g>' +
				'<g class="hd" aria-hidden="true" data-cls="' + echappe(c.iri) + '" data-kind="sub" transform="translate(' + (g.w / 2) + ',0)"><polygon points="-8,5 8,5 0,-8"/><title>Glisser vers un concept : « sous-classe de »</title></g></g>';
		});
		h += poignees;
		if (rat) h += '<line class="tmp" x1="' + rat.fx + '" y1="' + rat.fy + '" x2="' + rat.x + '" y2="' + rat.y + '"/>';
		if (lien) {
			var c0 = cl(lien.de), s = N[lien.de];
			if (c0 && s) {
				var hx = lien.kind === 'prop' ? s.x + s.w : s.x + s.w / 2, hy = lien.kind === 'prop' ? s.y + 16 : s.y;
				h += '<line class="tmp" x1="' + hx + '" y1="' + hy + '" x2="' + lien.x + '" y2="' + lien.y + '" marker-end="' + (lien.kind === 'sub' ? 'url(#tri)' : 'url(#fl)') + '"/>';
			}
		}
		svg.setAttribute('viewBox', '0 0 ' + largeur + ' ' + hauteurVue);
		svg.style.width = largeur + 'px';
		svg.innerHTML = h;
		if (focusIri) { // le dessin est refait à chaque changement : le focus du clavier revient sur son concept
			var cible = [].slice.call(svg.querySelectorAll('.gn')).filter(function (g) { return g.dataset.cls === focusIri; })[0];
			if (cible) cible.focus({ preventScroll: true });
		}
	}

	// Phrase lue par un lecteur d'écran pour un concept du graphe
	function descNoeud(c) {
		var st = statut(c, 'classe'), at = attributs(c.iri).length;
		var par = c.parents.map(function (p) { return cl(p) ? affiche(cl(p)) : nomCourt(p); });
		var rel = E.props.filter(function (p) { return !p.supprime && p.range && !litteral(p.range) && (p.domain === c.iri || p.range === c.iri); }).length;
		return 'Concept ' + affiche(c) + (st ? ', ' + { 'new': 'nouveau', mod: 'modifié', del: 'supprimé' }[st] : '') + ', ' + (c.n || 0) + ' instance' + (c.n > 1 ? 's' : '') +
			(at ? ', ' + at + ' attribut' + (at > 1 ? 's' : '') : '') + (par.length ? ', sous-classe de ' + par.join(', ') : '') + (rel ? ', ' + rel + ' relation' + (rel > 1 ? 's' : '') : '');
	}

	//--------------------------------------------------------------------------
	// Liste, propriétés non reliées, fiche, état
	//--------------------------------------------------------------------------
	function noeudClasse(c, vus, chemin) {
		vus[c.iri] = true;
		chemin = Object.assign({}, chemin); chemin[c.iri] = true;
		var enfants = E.classes.filter(function (x) { return x.parents.indexOf(c.iri) >= 0 && !chemin[x.iri]; });
		var st = statut(c, 'classe'), sel = E.sel && E.sel.t === 'classe' && E.sel.iri === c.iri ? ' sel' : '';
		return '<li><div class="noeud' + sel + (st === 'del' ? ' del' : '') + '" data-t="classe" data-iri="' + echappe(c.iri) + '" tabindex="0"><span class="puce"></span><span class="nom">' + echappe(affiche(c)) + '</span>' +
			badge(st) + '<span class="nb">' + (c.n || '') + '</span></div>' + (enfants.length ? '<ul>' + enfants.map(function (e) { return noeudClasse(e, vus, chemin); }).join('') + '</ul>' : '') + '</li>';
	}
	function noeudProp(p, note) {
		var st = statut(p, 'prop'), sel = E.sel && E.sel.t === 'prop' && E.sel.iri === p.iri ? ' sel' : '';
		return '<li><div class="noeud' + sel + (st === 'del' ? ' del' : '') + '" data-t="prop" data-iri="' + echappe(p.iri) + '" tabindex="0"><span class="puce prop"></span><span class="nom">' + echappe(affiche(p)) + '</span>' +
			badge(st) + (note ? '<span class="nb">' + note + '</span>' : '') + '</div></li>';
	}
	function relie(p) { return p.domain && cl(p.domain) && p.range && (litteral(p.range) || cl(p.range)); }
	function rendListes() {
		var vus = {};
		var racines = E.classes.filter(function (c) { return !c.parents.some(function (p) { return cl(p); }); });
		var h = racines.map(function (c) { return noeudClasse(c, vus, {}); }).join('');   // un concept à plusieurs super-classes apparaît sous chacune
		E.classes.forEach(function (c) { if (!vus[c.iri]) h += noeudClasse(c, vus, {}); }); // cycles de sous-classes
		$('#arbre-classes').innerHTML = h;
		$('#arbre-props').innerHTML = E.props.map(function (p) { return noeudProp(p, ''); }).join('');
		$('#n-classes').textContent = E.classes.filter(function (c) { return !c.supprime; }).length;
		$('#n-props').textContent = E.props.filter(function (p) { return !p.supprime; }).length;
		var orph = E.props.filter(function (p) { return !relie(p); });
		$('#orphelines').hidden = !orph.length;
		$('#orph-titre').textContent = '⚠️ ' + orph.length + ' propriété(s) non reliée(s) au graphe';
		$('#arbre-orph').innerHTML = orph.map(function (p) { return noeudProp(p, (p.domain && cl(p.domain) ? '' : 'domaine ? ') + (p.range && (litteral(p.range) || cl(p.range)) ? '' : 'portée ?')); }).join('');
	}
	function options(valeur, vide, classes, types) {
		var o = vide ? '<option value="">— aucune —</option>' : '';
		if (classes) o += E.classes.filter(function (c) { return !c.supprime; }).map(function (c) {
			return '<option value="' + echappe(c.iri) + '"' + (c.iri === valeur ? ' selected' : '') + '>' + echappe(affiche(c)) + '</option>';
		}).join('');
		if (types) o += '<optgroup label="Types de données">' + E.types.map(function (t) {
			return '<option value="' + echappe(t.iri) + '"' + (t.iri === valeur ? ' selected' : '') + '>' + echappe(t.nom) + '</option>';
		}).join('') + '</optgroup>';
		// valeur hors liste (classe supprimée, IRI externe) : on la garde visible
		if (valeur && o.indexOf('value="' + echappe(valeur) + '"') < 0) o += '<option value="' + echappe(valeur) + '" selected>' + echappe(nomCourt(valeur)) + '</option>';
		return o;
	}
	function iriLocale(x) { return E.espace && x.iri.indexOf(E.espace) === 0 ? x.iri.slice(E.espace.length) : x.iri; }

	// IRI saisie dans une relation vers « n'importe quelle IRI » : <iri>, adresse http(s) ou préfixe:nom (préfixe connu)
	function resoutIri(texte) {
		var t = String(texte).trim().replace(/^<(.*)>$/, '$1');
		if (/^https?:\/\/[^\s<>"{}|\\^`]+$/.test(t)) return { iri: t };
		var m = /^([A-Za-z][\w.-]*):([^\s<>"{}|\\^`]+)$/.exec(t);
		if (m && E.prefixes[m[1]]) return { iri: E.prefixes[m[1]] + m[2] };
		if (m && !/^\/\//.test(m[2])) return { erreur: 'Le préfixe « ' + m[1] + ': » n\'est pas connu : ajoutez-le avec « 🏷️ Préfixes », ou saisissez l\'adresse complète.' };
		return { erreur: 'IRI attendue : une adresse http(s), ou préfixe:nom.' };
	}
	// Libellé affiché pour la cible d'une relation
	function nomCible(iri, cible) {
		if (cible === 'classe' && cl(iri)) return affiche(cl(iri));
		if (cible === 'prop' && pr(iri)) return affiche(pr(iri));
		return nomDe(iri) === iri.replace(/^.*[#\/]/, '') && /^https?:/.test(iri) ? iri : nomDe(iri);
	}
	function alerteGenre(x) {
		if (x.genre === 'objet' && x.range && litteral(x.range)) return 'Une propriété objet a pour portée un concept, pas un type de données.';
		if (x.genre === 'donnee' && x.range && !litteral(x.range)) return 'Une propriété de donnée a pour portée un type de données, pas un concept.';
		return '';
	}
	// Bloc « Axiomes RDFS / OWL et annotations » de la fiche d'un concept (t = 'classe') ou d'une propriété ('prop')
	function blocAxiomes(x, t, off) {
		var n = relationsDe(t).reduce(function (s, r) { return s + x[r.cle].length; }, 0) + (t === 'prop' ? x.carac.length + (x.genre ? 1 : 0) + (x.min !== '' ? 1 : 0) + (x.max !== '' ? 1 : 0) : 0);
		var ouvert = axOuvert === null ? n > 0 : axOuvert;
		var h = '<details class="axiomes" id="f-axiomes"' + (ouvert ? ' open' : '') + '><summary>Axiomes RDFS / OWL et annotations' + (n ? ' <span class="nb">(' + n + ')</span>' : '') + '</summary><div class="ax">';
		if (t === 'prop') {
			// cardinalité voulue : elle devient une forme SHACL (sh:minCount, sh:maxCount) pour les instances du domaine
			var fonct = x.carac.indexOf('fonctionnelle') >= 0;
			h += '<div class="ax-ligne"><span class="ax-t">Forme SHACL</span><div>Au moins <input type="number" class="champ ax-nb" id="f-min" min="0" max="1000" value="' + echappe(x.min) + '" placeholder="0"' + off + ' aria-label="Nombre minimal de valeurs"> ' +
				'et au plus <input type="number" class="champ ax-nb" id="f-max" min="0" max="1000" value="' + echappe(x.max) + '" placeholder="∞"' + off + ' aria-label="Nombre maximal de valeurs"> valeur(s)' +
				(x.domain ? ' par instance de ' + echappe(cl(x.domain) ? affiche(cl(x.domain)) : nomCourt(x.domain)) : ' (sans domaine : seul le maximum est contrôlé)') + '.' +
				(fonct ? '<p class="alerte" style="color:var(--sb-ink-soft)">Propriété fonctionnelle : au plus 1 valeur, quoi qu\'on écrive ici.</p>' : '') +
				'<p class="astuce" style="margin:4px 0 0">Les types (domaine, portée) sont déjà contrôlés par les contrôles RDFS ; ces bornes ajoutent une forme SHACL, visible avec « 🛡️ Formes SHACL ».</p></div></div>';
			h += '<div class="ax-ligne"><label class="ax-t" for="f-genre">Genre OWL</label><div><select id="f-genre"' + off + '><option value="">non précisé</option>' +
				'<option value="objet"' + (x.genre === 'objet' ? ' selected' : '') + '>propriété objet (owl:ObjectProperty)</option>' +
				'<option value="donnee"' + (x.genre === 'donnee' ? ' selected' : '') + '>propriété de donnée (owl:DatatypeProperty)</option></select>' +
				(alerteGenre(x) ? '<p class="alerte">⚠️ ' + echappe(alerteGenre(x)) + '</p>' : '') + '</div></div>';
			h += '<div class="ax-ligne"><span class="ax-t">Caractéristiques</span><div class="carac">' + (E.meta.carac || []).map(function (c) {
				return '<label title="' + echappe(c.aide) + '"><input type="checkbox" data-carac="' + echappe(c.cle) + '"' + (x.carac.indexOf(c.cle) >= 0 ? ' checked' : '') + off + '> ' + echappe(c.titre) + '</label>';
			}).join('') + '</div></div>';
		}
		relationsDe(t).forEach(function (r) {
			h += '<div class="ax-ligne"><span class="ax-t">' + echappe(r.titre) + '</span><div class="parents">' + x[r.cle].map(function (v) {
				return '<span class="puce-parent" title="' + echappe(v) + '">' + echappe(nomCible(v, r.cible)) + (off ? '' :
					' <button type="button" class="lien-mini" data-rm-rel="' + echappe(r.cle) + '" data-iri="' + echappe(v) + '" aria-label="Retirer ' + echappe(nomCible(v, r.cible)) + ' de « ' + echappe(r.titre) + ' »">✕</button>') + '</span>';
			}).join('');
			if (!off) {
				if (r.cible === 'iri') h += '<input type="text" class="champ ax-iri" data-add-iri="' + echappe(r.cle) + '" placeholder="http://… ou préfixe:nom" aria-label="Ajouter : ' + echappe(r.titre) + '"><button type="button" class="btn secondaire petit" data-add-iri-btn="' + echappe(r.cle) + '">＋</button>';
				else {
					var choix = (r.cible === 'classe' ? E.classes : E.props).filter(function (o) { return !o.supprime && o.iri !== x.iri && x[r.cle].indexOf(o.iri) < 0; });
					h += '<select data-add-rel="' + echappe(r.cle) + '" aria-label="Ajouter : ' + echappe(r.titre) + '"><option value="">＋ ajouter…</option>' + choix.map(function (o) {
						return '<option value="' + echappe(o.iri) + '">' + echappe(affiche(o)) + '</option>';
					}).join('') + '</select>';
				}
			}
			h += '</div></div>';
		});
		return h + '<p class="astuce" style="margin:6px 0 0">Ces axiomes décrivent l\'ontologie et sont écrits dans votre copie ; Oxigraph ne raisonne pas dessus, mais vos requêtes peuvent les lire.</p></div></details>';
	}
	function brancheAxiomes(x, t) {
		var f = $('#fiche'), ajouteIri = function (cle) {
			var champ = f.querySelector('[data-add-iri="' + cle + '"]'), r = resoutIri(champ.value);
			if (r.erreur) { toast(r.erreur); return; }
			if (x[cle].indexOf(r.iri) < 0) x[cle].push(r.iri);
			rend();
		};
		var d = $('#f-axiomes'); if (d) d.addEventListener('toggle', function () { axOuvert = d.open; });
		f.querySelectorAll('[data-rm-rel]').forEach(function (b) { b.addEventListener('click', function () { x[b.dataset.rmRel] = x[b.dataset.rmRel].filter(function (v) { return v !== b.dataset.iri; }); rend(); }); });
		f.querySelectorAll('select[data-add-rel]').forEach(function (se) { se.addEventListener('change', function () { var k = se.dataset.addRel; if (se.value && x[k].indexOf(se.value) < 0) x[k].push(se.value); rend(); }); });
		f.querySelectorAll('[data-add-iri-btn]').forEach(function (b) { b.addEventListener('click', function () { ajouteIri(b.dataset.addIriBtn); }); });
		f.querySelectorAll('[data-add-iri]').forEach(function (i) { i.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); ajouteIri(i.dataset.addIri); } }); });
		var g = $('#f-genre'); if (g) g.addEventListener('change', function () { x.genre = g.value; rend(); });
		['min', 'max'].forEach(function (c) {
			var i = $('#f-' + c);
			if (i) i.addEventListener('change', function () { x[c] = i.value === '' ? '' : String(Math.max(0, Math.min(1000, parseInt(i.value, 10) || 0))); rend(); });
		});
		f.querySelectorAll('[data-carac]').forEach(function (c) {
			c.addEventListener('change', function () { x.carac = x.carac.filter(function (v) { return v !== c.dataset.carac; }); if (c.checked) x.carac.push(c.dataset.carac); rend(); });
		});
	}

	function rendFiche() {
		var f = $('#fiche'), s = E.sel, x = s && (s.t === 'classe' ? cl(s.iri) : pr(s.iri));
		if (!x) { f.innerHTML = '<div class="vide">Sélectionnez un concept ou une propriété,<br>ou créez-en un.</div>'; return; }
		var t = s.t, st = statut(x, t), off = x.supprime ? ' disabled' : '';
		var h = '<h2>' + (t === 'classe' ? '🟦 Concept' : '🔵 Propriété') + ' : ' + echappe(affiche(x)) + ' ' + badge(st) + '</h2><div class="formulaire">';
		h += '<label for="f-label">Libellé</label><input type="text" id="f-label" maxlength="200" value="' + echappe(x.label) + '" placeholder="' + echappe(x.nom) + '"' + off + '>';
		if (x.nouveau) h += '<label for="f-local">Identifiant</label><input type="text" class="mono" id="f-local" value="' + echappe(x.nom) + '" title="' + echappe(E.espace) + '… (le préfixe est facultatif)"' + off + '>';
		else h += '<label>Identifiant</label><input type="text" class="mono" value="' + echappe(x.nom) + '" title="' + echappe(x.iri) + '" disabled>';
		if (t === 'classe') {
			h += '<label>Sous-classe de</label><div class="parents">' + x.parents.map(function (p) {
				return '<span class="puce-parent' + (parentSel(x) === p ? ' sel' : '') + '" title="' + echappe(p) + '">' + echappe(cl(p) ? affiche(cl(p)) : nomCourt(p)) +
					(x.supprime ? '' : ' <button type="button" class="lien-mini" data-rm-parent="' + echappe(p) + '" aria-label="Retirer cette super-classe">✕</button>') + '</span>';
			}).join('') + (x.parents.length ? '' : '<span class="astuce" style="margin:0">aucune</span>') +
				(x.supprime ? '' : '<select id="f-parent-add" aria-label="Ajouter une super-classe"><option value="">＋ ajouter une super-classe…</option>' +
					E.classes.filter(function (c) { return !c.supprime && c.iri !== x.iri && x.parents.indexOf(c.iri) < 0 && ancetres(c.iri).indexOf(x.iri) < 0; }).map(function (c) {
						return '<option value="' + echappe(c.iri) + '">' + echappe(affiche(c)) + '</option>';
					}).join('') + '</select>') + '</div>';
			h += '<label for="f-relier-cible">Relier à</label><div class="relier"><select id="f-relier-cible"' + off + ' aria-label="Concept visé par la nouvelle propriété"><option value="">— une valeur (attribut) —</option>' +
				E.classes.filter(function (c) { return !c.supprime; }).map(function (c) { return '<option value="' + echappe(c.iri) + '">' + echappe(affiche(c)) + '</option>'; }).join('') +
				'</select><button type="button" class="btn secondaire petit" id="f-relier"' + off + '>＋ Propriété</button></div>';
			h += '<label for="f-comment">Commentaire</label><textarea id="f-comment" rows="3" maxlength="1000"' + off + '>' + echappe(x.comment) + '</textarea>';
			h += '<div class="plein">' + blocAxiomes(x, t, off) + '</div>';
		} else {
			h += '<label for="f-domain">Domaine (sujet)</label><select id="f-domain"' + off + '>' + options(x.domain, true, true, false) + '</select>';
			h += '<label for="f-range">Portée (objet)</label><select id="f-range"' + off + '>' + options(x.range, true, true, true) + '</select>';
			h += '<label for="f-comment">Commentaire</label><textarea id="f-comment" rows="2" maxlength="1000"' + off + '>' + echappe(x.comment) + '</textarea>';
			h += '<div class="plein">' + blocAxiomes(x, t, off) + '</div>';
			h += '<div class="plein astuce" style="margin:0">' + (x.range && litteral(x.range) ? '↪ Propriété de <strong>donnée</strong> : la valeur est un littéral.' : '↪ Propriété <strong>objet</strong> : elle relie deux ressources.') + '</div>';
		}
		h += '</div>';
		var imp = [];
		if (t === 'classe') {
			var fils = E.classes.filter(function (c) { return c.parents.indexOf(x.iri) >= 0 && !c.supprime; });
			var ps = E.props.filter(function (p) { return !p.supprime && (p.domain === x.iri || p.range === x.iri); });
			var groupe = I && I.classes.filter(function (g) { return g.iri === x.iri; })[0], nAnon = groupe ? groupe.items.filter(function (it) { return !it.iri; }).length : 0;
			if (x.n) imp.push(x.n + ' instance(s) de ce concept (elles ne sont pas supprimées avec lui)' +
				(nAnon ? ' dont ' + nAnon + ' nœud(s) anonyme(s) <button type="button" class="lien-mini" data-ab="voir-anon" data-id="' + echappe(x.iri) + '">les voir</button>' : ''));
			if (fils.length) imp.push(fils.length + ' sous-classe(s) : ' + fils.map(function (c) { return '<button type="button" class="lien-mini" data-t="classe" data-iri="' + echappe(c.iri) + '">' + echappe(affiche(c)) + '</button>'; }).join(', '));
			if (ps.length) imp.push(ps.length + ' propriété(s) l\'utilisent : ' + ps.map(function (p) { return '<button type="button" class="lien-mini" data-t="prop" data-iri="' + echappe(p.iri) + '">' + echappe(affiche(p)) + '</button>'; }).join(', '));
		} else imp.push('Les valeurs déjà présentes dans votre copie ne sont pas modifiées.');
		h += '<div class="impact"><strong>Impact</strong>' + (imp.length ? '<ul><li>' + imp.join('</li><li>') + '</li></ul>' : ' : aucun usage.') + '</div>';
		h += '<div class="actions-fiche">' + (x.supprime
			? '<button type="button" class="btn secondaire" id="restaure">↩️ Annuler la suppression</button>'
			: '<button type="button" class="btn danger" id="supprime">🗑️ Supprimer</button>') + '</div>';
		f.innerHTML = h;

		function liste() { return t === 'classe' ? E.classes : E.props; }
		function champ(id, fn) { var e = $(id); if (e) e.addEventListener('change', function (ev) { fn(ev.target.value); rend(); }); }
		var lab = $('#f-label');
		if (lab) lab.addEventListener('input', function (ev) {
			x.label = ev.target.value;
			if (x.label && !x.llang && !x.orig.label) x.llang = 'fr';
			if (x.nouveau && x.iriAuto) { renomme(x, t, E.espace + unique(slug(x.label || 'element', t === 'classe'), x)); var l = $('#f-local'); if (l) l.value = x.nom; }
			rendLeger();
		});
		champ('#f-local', function (v) {
			var r = resoutIdentifiant(v, E.espace);
			if (r.erreur) { toast(r.erreur); return; }
			var iri = r.iri;
			if (iri !== x.iri && (cl(iri) || pr(iri))) { toast('Cet identifiant existe déjà'); return; }
			x.iriAuto = false; renomme(x, t, iri);
		});
		champ('#f-parent-add', function (v) { if (v && x.parents.indexOf(v) < 0) x.parents.push(v); });
		document.querySelectorAll('[data-rm-parent]').forEach(function (b) {
			b.addEventListener('click', function () { x.parents = x.parents.filter(function (p) { return p !== b.dataset.rmParent; }); selSous = null; rend(); });
		});
		champ('#f-comment', function (v) { x.comment = v; if (x.comment && !x.clang && !x.orig.comment) x.clang = 'fr'; });
		champ('#f-domain', function (v) { x.domain = v; });
		champ('#f-range', function (v) { x.range = v; });
		brancheAxiomes(x, t);
		var rl = $('#f-relier'); if (rl) rl.addEventListener('click', function () {
			var cible = $('#f-relier-cible').value;
			if (cible) liaison('prop', x.iri, cible); else liaison('attr', x.iri);
		});
		var b = $('#supprime'); if (b) b.addEventListener('click', function () { supprime(x, t); });
		b = $('#restaure'); if (b) b.addEventListener('click', function () { restaure(x, t); });
	}

	function rendEtat() {
		var n = nbModifs(), e = $('#etat');
		e.textContent = n ? '● ' + n + ' modification' + (n > 1 ? 's' : '') + ' non enregistrée' + (n > 1 ? 's' : '') : 'Aucune modification';
		e.classList.toggle('sale', n > 0);
		var b = $('#b-enreg');
		b.disabled = !n || enCours;
		b.title = enCours ? 'Enregistrement en cours…' : n ? 'Enregistrer vos modifications dans votre copie' : 'Rien à enregistrer : aucune modification';
	}
	function rendVue() {
		$('#zone-graphe').hidden = vue !== 'graphe';
		$('#zone-liste').hidden = vue !== 'liste';
		$('#v-graphe').classList.toggle('actif', vue === 'graphe');
		$('#v-liste').classList.toggle('actif', vue === 'liste');
		$('#v-graphe').setAttribute('aria-pressed', vue === 'graphe' ? 'true' : 'false');
		$('#v-liste').setAttribute('aria-pressed', vue === 'liste' ? 'true' : 'false');
	}
	function rendLeger() { rendListes(); rendGraphe(); rendEtat(); }
	function rend() { rendListes(); rendFiche(); rendGraphe(); rendEtat(); rendVue(); rendInstances(); rendCible(); }

	//--------------------------------------------------------------------------
	// Modifications du brouillon
	//--------------------------------------------------------------------------
	function slug(texte, majuscule) {
		var mots = texte.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
		if (!mots.length) return 'element';
		return mots.map(function (m, i) {
			return (i === 0 && !majuscule ? m.charAt(0).toLowerCase() : m.charAt(0).toUpperCase()) + m.slice(1);
		}).join('');
	}
	function unique(local, sauf) {
		var l = local, k = 1;
		function pris(iri) { var o = cl(iri) || pr(iri); return o && o !== sauf; }
		while (pris(E.espace + l)) l = local + (++k);
		return l;
	}
	function renomme(x, t, iri) {
		var ancien = x.iri;
		if (iri === ancien) return;
		E.pos[iri] = E.pos[ancien]; delete E.pos[ancien];
		var echange = function (v) { return v === ancien ? iri : v; };
		E.classes.forEach(function (c) { c.parents = c.parents.map(echange); cleRelations('classe').forEach(function (k) { c[k] = c[k].map(echange); }); });
		E.props.forEach(function (p) { if (p.domain === ancien) p.domain = iri; if (p.range === ancien) p.range = iri; cleRelations('prop').forEach(function (k) { p[k] = p[k].map(echange); }); });
		if (E.sel && E.sel.iri === ancien) E.sel.iri = iri;
		x.iri = iri; x.nom = nomDe(iri);
	}
	function nouvelElement(t, label, base) {
		var iri = E.espace + unique(slug(base, t === 'classe'), null);
		var o = { iri: iri, nom: nomDe(iri), label: label, llang: 'fr', nouveau: true, supprime: false, iriAuto: true };
		Object.assign(o, valeursVides(t), { label: label, clang: '' });
		o.orig = valeursVides(t);
		if (t === 'classe') { o.n = 0; o.decl = true; E.classes.push(o); } else E.props.push(o);
		E.sel = { t: t, iri: iri };
		return o;
	}
	function creeConcept(x, y) {
		var o = nouvelElement('classe', 'Nouveau concept', 'Nouveau concept');
		E.pos[o.iri] = x === undefined ? libre() : { x: Math.max(0, x), y: Math.max(0, y) };
		rend(); focusLabel();
	}
	function creeProp(domaine, portee, label) {
		var o = nouvelElement('prop', label, label);
		o.domain = domaine; o.range = portee;
		rend(); focusLabel();
	}
	function focusLabel() { setTimeout(function () { var l = $('#f-label'); if (l && !l.disabled) { l.focus(); l.select(); } }, 0); }

	// Supprimer un concept détache ce qui s'y réfère (sous-classes, domaines, portées) : on garde de quoi défaire
	function supprime(x, t) {
		var casc = [];
		// les relations des autres éléments vers celui-ci sont détachées (de quoi les rétablir)
		var meme = t === 'classe' ? E.classes : E.props, cles = (t === 'classe' ? ['parents'] : []).concat(relationsDe(t).filter(function (r) { return r.cible === t; }).map(function (r) { return r.cle; }));
		meme.forEach(function (o) {
			if (o === x) return;
			cles.forEach(function (k) { if (o[k].indexOf(x.iri) >= 0) { casc.push([o, k, x.iri]); o[k] = o[k].filter(function (v) { return v !== x.iri; }); } });
		});
		if (t === 'classe') {
			E.props.forEach(function (p) {
				if (p.domain === x.iri) { casc.push([p, 'domain', p.domain]); p.domain = ''; }
				if (p.range === x.iri) { casc.push([p, 'range', p.range]); p.range = ''; }
			});
		}
		if (x.nouveau) {
			var liste = t === 'classe' ? E.classes : E.props;
			liste.splice(liste.indexOf(x), 1); delete E.pos[x.iri];
			E.sel = null;
		} else { x.supprime = true; x.cascade = casc; }
		rend();
	}
	function restaure(x, t) {
		x.supprime = false;
		(x.cascade || []).forEach(function (c) {
			if (Array.isArray(c[0][c[1]])) { if (c[0][c[1]].indexOf(c[2]) < 0) c[0][c[1]].push(c[2]); }
			else if (c[0][c[1]] === '') c[0][c[1]] = c[2];
		});
		x.cascade = [];
		rend();
	}

	function elementBrouillon(x, t) {
		var o = { iri: x.iri, label: x.label, llang: x.llang || '', comment: x.comment, clang: x.clang || '' };
		champsDe(t).forEach(function (k) { if (k !== 'label' && k !== 'comment') o[k] = Array.isArray(x[k]) ? x[k].slice() : x[k]; });
		return o;
	}
	function brouillon() {
		var b = { classes: [], props: [], supprimes: { classes: [], props: [] } };
		E.classes.forEach(function (c) {
			if (c.supprime) { if (!c.nouveau) b.supprimes.classes.push(c.iri); return; }
			if (c.nouveau || modifie(c, 'classe')) b.classes.push(elementBrouillon(c, 'classe'));
		});
		E.props.forEach(function (p) {
			if (p.supprime) { if (!p.nouveau) b.supprimes.props.push(p.iri); return; }
			if (p.nouveau || modifie(p, 'prop')) b.props.push(elementBrouillon(p, 'prop'));
		});
		if (nbInst()) b.instances = {
			nouvelles: D.nouvelles.map(function (n) { return n.anon ? { anon: true, classe: n.classe, valeurs: n.valeurs } : { iri: n.iri, classe: n.classe, valeurs: n.valeurs }; }),
			modifiees: Object.keys(D.modifiees).map(function (k) {
				var m = D.modifiees[k], o = { types: m.types.map(function (t) { return t.iri; }), valeurs: m.valeurs };
				if (m.anon) o.anon = m.anon; else o.iri = m.iri;
				return o;
			}),
			supprimees: Object.keys(D.supprimees).filter(function (k) { return k.indexOf('_:') !== 0; }),
			supprimees_anon: Object.keys(D.supprimees).filter(function (k) { return k.indexOf('_:') === 0; }).map(function (k) { return k.slice(2); }),
			ia: D.ia.length ? { jeton: D.iaJeton, indices: D.ia.map(function (p) { return p.i; }) } : null
		};
		return b;
	}

	function message(html) { var m = $('#message'); m.innerHTML = html || ''; m.hidden = !html; }

	// Enregistre le brouillon ; renvoie une promesse (true si enregistré)
	function enregistre() {
		if (enCours) return Promise.resolve(false);
		if (!nbModifs()) return Promise.resolve(true);
		enCours = true; rendEtat();
		message("<p class='astuce'>⏳ Enregistrement…</p>");
		return appel('ontologie_enregistrer', { brouillon64: base64(JSON.stringify(brouillon())) }).then(function (r) {
			enCours = false;
			message(r.html);
			if (r.ok && r.modele) {
				(r.sujets || []).forEach(function (u) { iaIris[u] = true; });
				viderBrouillonInstances();
				charge(r.modele); rend();
				chargeInstances().then(function () { toast('💾 Enregistré dans votre copie'); });
				return true;
			}
			rendEtat();
			return false;
		});
	}
	function retour() { quitte = true; window.location.href = donnees.retour; }

	//--------------------------------------------------------------------------
	// Gestes dans le graphe
	//--------------------------------------------------------------------------
	function pt(e) { var s = $('#svg-graphe'), p = new DOMPoint(e.clientX, e.clientY).matrixTransform(s.getScreenCTM().inverse()); return { x: p.x, y: p.y }; }
	function mv(e) {
		var p = pt(e);
		if (drag) {
			if (!drag.moved && Math.abs(p.x - drag.x0) + Math.abs(p.y - drag.y0) > 3) drag.moved = true;   // un simple clic ne déplace rien
			if (drag.moved) { E.pos[drag.iri] = { x: Math.max(0, p.x - drag.dx), y: Math.max(0, p.y - drag.dy) }; rendGraphe(); }
		}
		else if (lien || rat) {
			var el = document.elementFromPoint(e.clientX, e.clientY), n = el && el.closest && el.closest('[data-cls]'), o = lien || rat;
			o.x = p.x; o.y = p.y; o.cible = n ? n.dataset.cls : null; rendGraphe();
		}
	}
	function up(e) {
		document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up);
		if (drag) {
			var d = drag; drag = null;
			if (!d.moved && d.etaitSel) deselectionne();   // second clic sur le concept déjà choisi
			return;
		}
		if (rat) { var r = rat; rat = null; rattache(r, e); return; }
		if (!lien) return;
		var l = lien; lien = null;
		var el = document.elementFromPoint(e.clientX, e.clientY), n = el && el.closest && el.closest('[data-cls]'), dansSvg = el && el.closest && el.closest('#svg-graphe');
		if (l.kind === 'prop') {
			if (n) liaison('prop', l.de, n.dataset.cls);
			else if (dansSvg) liaison('attr', l.de);
			else rendGraphe();
			return;
		}
		if (!n && dansSvg) toast('Lâchez sur un autre concept pour créer « sous-classe de »');
		liaison('sub', l.de, n ? n.dataset.cls : null);
	}
	// Crée le lien voulu : relation entre deux concepts ('prop'), attribut ('attr') ou super-classe ('sub').
	// Commun au glisser de la souris et au mode « relier » du clavier.
	function liaison(kind, de, cible) {
		if (kind === 'prop') { creeProp(de, cible, 'nouvelle relation'); annonce('Propriété créée de ' + affiche(cl(de)) + ' vers ' + affiche(cl(cible)) + ' : saisissez son libellé.'); return; }
		if (kind === 'attr') { creeProp(de, XSD + 'string', 'nouvel attribut'); annonce('Attribut créé sur ' + affiche(cl(de)) + ' : saisissez son libellé.'); return; }
		if (!cible || cible === de) { rendGraphe(); return; }
		if (ancetres(cible).indexOf(de) >= 0) { rendGraphe(); toast('⛔ Cycle : un concept ne peut pas descendre de son propre descendant'); return; }
		var c = cl(de);
		if (c.parents.indexOf(cible) >= 0) { rendGraphe(); toast(affiche(c) + ' est déjà sous-classe de ' + affiche(cl(cible))); return; }
		c.parents.push(cible); selSous = { iri: c.iri, parent: cible }; E.sel = { t: 'classe', iri: c.iri }; rend();
		toast(affiche(c) + ' est maintenant sous-classe de ' + affiche(cl(cible)));
		annonce(affiche(c) + ' est maintenant sous-classe de ' + affiche(cl(cible)));
	}
	// Fin d'un glissement de poignée : la flèche est accrochée au concept visé
	function rattache(r, e) {
		var el = document.elementFromPoint(e.clientX, e.clientY), n = el && el.closest && el.closest('[data-cls]'), dansSvg = el && el.closest && el.closest('#svg-graphe');
		var cible = n ? n.dataset.cls : null;
		if (r.t === 'prop') {
			var p = pr(r.iri);
			if (r.fin === 'domain') {
				if (!cible) { rendGraphe(); if (dansSvg) toast('Lâchez sur un concept pour changer le domaine'); return; }
				p.domain = cible;
			} else if (cible) p.range = cible;
			else if (dansSvg) { p.range = XSD + 'string'; toast(affiche(p) + ' devient un attribut (xsd:string)'); }
			else { rendGraphe(); return; }
			rend(); return;
		}
		var c = cl(r.iri);
		if (!cible || cible === r.parent) { rendGraphe(); if (dansSvg && !cible) toast('Lâchez sur un concept pour changer la super-classe'); return; }
		if (cible === c.iri) { rendGraphe(); toast('Un concept ne peut pas être sa propre super-classe'); return; }
		if (ancetres(cible).indexOf(c.iri) >= 0) { rendGraphe(); toast('⛔ Cycle : un concept ne peut pas descendre de son propre descendant'); return; }
		if (c.parents.indexOf(cible) >= 0) { rendGraphe(); toast(affiche(c) + ' est déjà sous-classe de ' + affiche(cl(cible))); return; }
		c.parents = c.parents.map(function (p) { return p === r.parent ? cible : p; });
		selSous = { iri: c.iri, parent: cible };
		rend();
	}
	function suit() { document.addEventListener('pointermove', mv); document.addEventListener('pointerup', up); }

	// Clavier dans le graphe : un concept à la fois (Tab y entre, les flèches changent de concept)
	function centreConcept(iri) { var c = cl(iri), g = c && geo(c); return g ? { x: g.x + g.w / 2, y: g.y + g.h / 2 } : { x: 0, y: 0 }; }
	// Concept le plus proche dans la direction de la flèche pressée
	function voisinDans(iri, touche) {
		var o = centreConcept(iri), meilleur = null, score = Infinity;
		E.classes.forEach(function (c) {
			if (c.iri === iri) return;
			var q = centreConcept(c.iri), dx = q.x - o.x, dy = q.y - o.y, a, b;
			if (touche === 'ArrowRight') { a = dx; b = dy; } else if (touche === 'ArrowLeft') { a = -dx; b = dy; }
			else if (touche === 'ArrowDown') { a = dy; b = dx; } else { a = -dy; b = dx; }
			if (a <= 1) return;
			var sc = a + 2 * Math.abs(b);
			if (sc < score) { score = sc; meilleur = c.iri; }
		});
		return meilleur;
	}
	function metFocus(iri) {
		var g = [].slice.call(document.querySelectorAll('#svg-graphe .gn')).filter(function (x) { return x.dataset.cls === iri; })[0];
		if (g) g.focus();
	}
	// Ce qui est choisi (concept ou propriété) : on le choisit, ou on le désélectionne s'il l'était déjà
	function estChoisi(t, iri) { return !!(E.sel && E.sel.t === t && E.sel.iri === iri); }
	function deselectionne() { E.sel = null; selSous = null; rend(); annonce('Sélection retirée.'); }
	function selectionneConcept(iri) {
		if (estChoisi('classe', iri) && !selSous) { deselectionne(); return; }
		E.sel = { t: 'classe', iri: iri }; selSous = null; rend(); annonce(descNoeud(cl(iri)));
	}
	function demarreLien(iri, kind) {
		var o = centreConcept(iri);
		lien = { de: iri, kind: kind, x: o.x, y: o.y, cible: null, clavier: true };
		rendGraphe();
		annonce((kind === 'sub' ? 'Sous-classe de : ' : 'Relation depuis ' + affiche(cl(iri)) + ' : ') + 'choisissez le concept visé avec les flèches, Entrée pour valider, Échap pour annuler.');
	}
	var FLECHES = { ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1 };
	$('#svg-graphe').addEventListener('keydown', function (e) {
		var g = e.target.closest && e.target.closest('.gn');
		if (!g || e.target !== g || e.ctrlKey || e.metaKey || e.altKey) return;
		var iri = g.dataset.cls, c = cl(iri), k = e.key, fait = true;
		if (!c) return;
		if (lien && lien.clavier) {   // mode « relier » : les flèches choisissent la cible
			if (k === 'Escape') { lien = null; rendGraphe(); annonce('Liaison annulée.'); }
			else if (k === 'Enter' || k === ' ') { var l = lien; lien = null; if (l.kind === 'prop') liaison('prop', l.de, iri); else liaison('sub', l.de, iri); }
			else if (FLECHES[k]) {
				var v = voisinDans(iri, k);
				if (v) { var o = centreConcept(v); lien.cible = v; lien.x = o.x; lien.y = o.y; metFocus(v); rendGraphe(); }
			} else fait = false;
		} else if (FLECHES[k]) {
			if (e.shiftKey) {   // Maj + flèche : déplace le concept
				var d = { ArrowUp: [0, -20], ArrowDown: [0, 20], ArrowLeft: [-20, 0], ArrowRight: [20, 0] }[k];
				E.pos[iri] = { x: Math.max(0, E.pos[iri].x + d[0]), y: Math.max(0, E.pos[iri].y + d[1]) };
				rendGraphe();
			} else { var w = voisinDans(iri, k); if (w) metFocus(w); }
		}
		else if (k === 'Enter' || k === ' ') selectionneConcept(iri);
		else if (k === 'F2') { selectionneConcept(iri); focusLabel(); }
		else if (k === 'Delete' || k === 'Backspace') { selectionneConcept(iri); var b = $('#supprime'); if (b) b.click(); }
		else if (k === 'r' || k === 'R') demarreLien(iri, 'prop');
		else if (k === 's' || k === 'S') demarreLien(iri, 'sub');
		else if (k === 'a' || k === 'A') liaison('attr', iri);
		else fait = false;
		if (fait) { e.preventDefault(); e.stopPropagation(); }
	});
	$('#svg-graphe').addEventListener('focusout', function (e) {   // quitter le graphe annule une liaison commencée au clavier
		if (lien && lien.clavier && !(e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('#svg-graphe'))) { lien = null; rendGraphe(); }
	});
	$('#svg-graphe').addEventListener('pointerdown', function (e) {
		if (e.button) return;
		var he = e.target.closest('.he');
		if (he) {
			e.preventDefault();
			rat = { t: he.dataset.t, iri: he.dataset.iri, fin: he.dataset.fin, parent: he.dataset.parent, fx: +he.dataset.fx, fy: +he.dataset.fy, x: pt(e).x, y: pt(e).y, cible: null };
			suit(); return;
		}
		var hd = e.target.closest('.hd'), at = e.target.closest('[data-attr]'), gn = e.target.closest('.gn'), ge = e.target.closest('.ge'), p = pt(e), now = Date.now();
		if (hd) { e.preventDefault(); lien = { de: hd.dataset.cls, kind: hd.dataset.kind, x: p.x, y: p.y, cible: null }; suit(); return; }
		if (at) { if (estChoisi('prop', at.dataset.attr)) deselectionne(); else { E.sel = { t: 'prop', iri: at.dataset.attr }; rend(); } return; }
		if (gn) {
			var iri = gn.dataset.cls, dbl = dernier.k === iri && now - dernier.t < 400;
			dernier = { t: now, k: iri };
			var etaitSel = estChoisi('classe', iri) && !selSous;
			E.sel = { t: 'classe', iri: iri }; selSous = null; rend();
			if (dbl) { focusLabel(); return; }
			drag = { iri: iri, dx: p.x - E.pos[iri].x, dy: p.y - E.pos[iri].y, x0: p.x, y0: p.y, moved: false, etaitSel: etaitSel }; suit(); return;
		}
		if (ge) {
			if (ge.dataset.edge === 'prop' && estChoisi('prop', ge.dataset.iri)) { deselectionne(); return; }
			if (ge.dataset.edge === 'sub') { E.sel = { t: 'classe', iri: ge.dataset.iri }; selSous = { iri: ge.dataset.iri, parent: ge.dataset.parent }; }
			else { E.sel = { t: 'prop', iri: ge.dataset.iri }; selSous = null; }
			rend(); return;
		}
		var dbl2 = dernier.k === 'fond' && now - dernier.t < 400;
		dernier = { t: now, k: 'fond' };
		if (dbl2) creeConcept(p.x - LARGEUR / 2, p.y - 16);
	});

	//--------------------------------------------------------------------------
	// Instances de la copie, et peuplement par IA
	//--------------------------------------------------------------------------
	function chargeInstances() {
		return appel('instances').then(function (r) {
			if (!r.ok) { $('#p-instances').innerHTML = r.html; return; }
			I = r.modele; rendInstances();
		});
	}
	// Brouillon des instances : ce que l'étudiant a ajouté, modifié ou supprimé à la main, et les
	// propositions de l'IA qu'il a acceptées ; tout part avec l'ontologie à « Enregistrer »
	var D = { nouvelles: [], modifiees: {}, supprimees: {}, ia: [], iaJeton: null };
	var F = null;   // formulaire d'instance ouvert : { mode: 'nouvelle'|'edition', idx, iri, nom, classe, types, valeurs, orig, entrants, iriAuto, local, chargement }
	function nbInst() { return D.nouvelles.length + Object.keys(D.modifiees).length + Object.keys(D.supprimees).length + D.ia.length; }
	function viderBrouillonInstances() { D = { nouvelles: [], modifiees: {}, supprimees: {}, ia: [], iaJeton: null }; F = null; }

	function espaceInstances() { return (I && I.espace) || E.espace; }
	function prefixeInstances() { return prefixeDe(espaceInstances()); }
	function iriInstanceExiste(iri) {
		return D.nouvelles.some(function (n) { return n.iri === iri; }) || !!(I && I.classes.some(function (c) { return c.items.some(function (it) { return it.iri === iri; }); }));
	}
	function proprietesPour(classe) {
		var lignees = [classe].concat(ancetres(classe));
		return E.props.filter(function (p) { return !p.supprime && p.domain && lignees.indexOf(p.domain) >= 0; });
	}
	// Valeur vide pour la propriété p : référence vers une instance, ou littéral du type de sa portée
	// Propriétés RDFS / OWL toujours proposées pour une instance, même hors de l'ontologie
	var PROPS_STD = [
		{ iri: RDFS + 'label', nom: 'rdfs:label', k: 'lit' }, { iri: RDFS + 'comment', nom: 'rdfs:comment', k: 'lit' },
		{ iri: RDFS + 'seeAlso', nom: 'rdfs:seeAlso', k: 'iri' }, { iri: RDFS + 'isDefinedBy', nom: 'rdfs:isDefinedBy', k: 'iri' },
		{ iri: 'http://www.w3.org/2002/07/owl#sameAs', nom: 'owl:sameAs', k: 'iri' }
	];
	function valeurVide(piri) {
		var std = !pr(piri) && PROPS_STD.filter(function (x) { return x.iri === piri; })[0];
		if (std) return { p: piri, nom: std.nom, k: std.k, v: '', dt: '', l: std.k === 'lit' ? LANGUE_DEFAUT : '' };
		var p = pr(piri), r = p && p.range;
		if (r && !litteral(r)) return { p: piri, k: 'iri', v: '', dt: '', l: '' };
		// un texte libre (portée rdfs:Literal ou rdf:langString) prend la langue par défaut : sans elle, « Alien » n'est pas « Alien »@fr
		var texteLibre = r === RDFS + 'Literal' || r === RDF + 'langString';
		return { p: piri, k: 'lit', v: '', dt: r && !texteLibre ? r : '', l: texteLibre ? LANGUE_DEFAUT : '' };
	}
	function signature(valeurs, types) {
		return JSON.stringify([valeurs.filter(function (v) { return v.k !== 'bn' && String(v.v).trim() !== ''; })
			.map(function (v) { return [v.p, v.k, String(v.v).trim(), v.dt || '', v.l || '']; }).sort(), (types || []).map(function (t) { return t.iri || t; }).sort()]);
	}
	// Clé d'une instance dans le brouillon : son IRI, ou « _:identifiant » pour un nœud anonyme
	function cleItem(it) { return it.iri || it.nom; }
	// Propriétés proposées pour l'instance en cours d'édition : celles de tous ses concepts
	function proprietesFormulaire() {
		var classes = F.mode === 'nouvelle' ? [F.classe] : (F.types || []).map(function (t) { return t.iri; }), vus = {}, r = [];
		classes.forEach(function (c) { if (c) proprietesPour(c).forEach(function (p) { if (!vus[p.iri]) { vus[p.iri] = 1; r.push(p); } }); });
		return r;
	}
	function titreInstance(valeurs, classe) {
		var t = valeurs.filter(function (v) { return v.k === 'lit' && String(v.v).trim() && /(label|name|nom|titre|title)$/i.test(v.p); })[0] ||
			valeurs.filter(function (v) { return v.k === 'lit' && String(v.v).trim() && (!v.dt || v.dt === XSD + 'string'); })[0];
		return t ? String(t.v).trim() : '';
	}
	function proposeLocal(f) {   // identifiant proposé pour une instance nommée
		var base = titreInstance(f.valeurs) ? slug(titreInstance(f.valeurs), false) : slug((cl(f.classe) ? affiche(cl(f.classe)) : 'instance'), false) + 1;
		var local = base, k = 1;
		while (iriInstanceExiste(espaceInstances() + local)) local = base + (++k);
		return prefixeInstances() + local.toLowerCase();
	}

	function rendInstances() {
		var zone = $('#p-instances');
		if (!I) return;
		if (F) { rendFormulaire(); return; }
		var total = I.classes.reduce(function (s, c) { return s + c.n; }, 0);
		$('#c-inst').textContent = total;
		var selIri = E.sel && E.sel.t === 'classe' ? E.sel.iri : null;
		if (selIri && selIri !== dernierSel) { ouverts[selIri] = true; dernierSel = selIri; }   // choisir un concept ouvre sa liste
		var h = '<div class="ligne" style="margin-top:0"><button type="button" class="btn secondaire petit" data-ab="nouvelle">＋ Nouvelle instance</button>' +
			'<label class="filtre-anon" title="Ne montrer que les instances sans IRI (comme les rôles)"><input type="checkbox" id="filtre-anon"' + (seulAnon ? ' checked' : '') + '> nœuds anonymes seulement</label></div>';
		h += rendBrouillonInstances();
		h += '<p class="astuce">Les individus de votre copie, par concept. Sélectionnez un concept dans le graphe pour voir les siens.' + (I.tronque ? ' <strong>Liste tronquée.</strong>' : '') + '</p>';
		if (!I.classes.length) h += '<p class="astuce">Aucune instance : ajoutez-en une, ou peuplez l\'instance avec l\'IA (onglet voisin).</p>';
		classesAffichees().forEach(function (c) {
			var items = seulAnon ? c.items.filter(function (it) { return !it.iri; }) : c.items;
			if (seulAnon && !items.length) return;   // filtre : seuls les concepts qui ont des nœuds anonymes
			var ouvert = !!ouverts[c.iri] || (seulAnon && c.iri === selIri), attente = seulAnon ? [] : (c.attente || []), nAttente = attente.length;
			var nIA = c.items.filter(function (it) { return provenance(it) === 'ia'; }).length, nAnon = c.items.filter(function (it) { return !it.iri; }).length;
			h += '<div class="inst-classe' + (c.iri === selIri ? ' sel' : '') + '"><button type="button" class="lien-mini inst-tete" data-ic="' + echappe(c.iri) + '" aria-expanded="' + ouvert + '" style="display:flex;width:100%;justify-content:space-between;font-weight:600;padding:5px 2px">' +
				'<span>' + (ouvert ? '▾ ' : '▸ ') + echappe(c.nom) + (nIA ? ' <span class="badge ia">' + nIA + ' IA</span>' : '') + (nAnon ? ' <span class="badge" title="nœuds anonymes (sans IRI)">∅ ' + nAnon + '</span>' : '') + '</span><span>' + c.n + (nAttente ? ' <span class="badge new" title="à enregistrer">+' + nAttente + '</span>' : '') + '</span></button>';
			if (ouvert) {
				h += rendRelations(c.iri);
				attente.forEach(function (a) {   // instances du brouillon : en tête de leur concept
					if (a.n) h += '<div class="inst nouveau-brouillon"><div class="tete"><strong>' + echappe(a.n.titre || a.n.local || 'sans titre') + '</strong><span class="badge new">à enregistrer</span>' + (a.n.anon ? '<span class="badge">anonyme</span>' : '') +
						'<button type="button" class="lien-mini" data-ab="nouvelle-edite" data-id="' + a.i + '" title="Modifier">✎</button><button type="button" class="lien-mini" data-ab="nouvelle-annule" data-id="' + a.i + '" title="Retirer du brouillon">✕</button></div>' +
						(a.n.local ? '<div class="vals">' + echappe(a.n.local) + '</div>' : '') + '<div class="vals">' + a.n.valeurs.map(function (v) { return echappe(nomValeur(v)) + ' = ' + echappe(v.v) + (v.l ? '@' + echappe(v.l) : ''); }).join(' · ') + '</div></div>';
					else h += '<div class="inst nouveau-ia"><div class="tete"><strong>' + echappe(a.p.titre) + '</strong><span class="badge ia">IA</span><span class="badge new">à enregistrer</span>' +
						'<button type="button" class="lien-mini" data-ab="ia-retire" data-id="' + a.p.i + '" title="Retirer du brouillon">✕</button></div>' + (a.p.detail.length ? '<div class="vals">' + a.p.detail.map(echappe).join(' · ') + '</div>' : '') + '</div>';
				});
				items.forEach(function (it) {
					var vals = it.props.map(function (p) { return echappe(p.p) + ' = ' + echappe(p.v) + (p.l ? '@' + echappe(p.l) : ''); }).join(' · ');
					var cle = cleItem(it), supprime = D.supprimees[cle] !== undefined, modifie_ = D.modifiees[cle];
					var prov = provenance(it);
					h += '<div class="inst' + (prov === 'ia' ? ' nouveau-ia' : '') + (supprime ? ' supprimee' : '') + '"><div class="tete"><strong title="' + echappe(it.iri || it.nom) + '">' + echappe(it.titre || it.nom) + '</strong>' +
						(prov === 'ia' ? '<span class="badge ia" title="Créée par l\'IA">IA</span>' : prov === 'manuel' ? '<span class="badge" title="Saisie à la main dans l\'éditeur">manuel</span>' : '') + (supprime ? '<span class="badge del">supprimée</span>' : modifie_ ? '<span class="badge mod">modifiée</span>' : '') +
						(!supprime ? '<button type="button" class="lien-mini" data-ab="edite" data-id="' + echappe(cle) + '" title="Modifier ou supprimer cette instance">✎</button>'
							: '<button type="button" class="lien-mini" data-ab="annule-sup" data-id="' + echappe(cle) + '">annuler</button>') + '</div>' +
						(it.titre ? '<div class="vals">' + echappe(it.nom) + '</div>' : '') + (vals ? '<div class="vals">' + vals + '</div>' : '') +
						(it.iri ? '' : '<div class="vals">nœud anonyme</div>') + '</div>';
				});
				if (c.plus > 0) h += '<div class="inst-plus">… et ' + c.plus + ' autre' + (c.plus > 1 ? 's' : '') + ' non affichée' + (c.plus > 1 ? 's' : '') + '</div>';
			}
			h += '</div>';
		});
		zone.innerHTML = h;
	}
	// D'où vient une instance : « ia », « manuel » (créée dans l'éditeur, gardée par le serveur) ou '' (données d'origine)
	function provenance(it) { return it.src || (it.iri && iaIris[it.iri] ? 'ia' : ''); }
	// Relations (propriétés de concept à concept) du concept : celles qui en partent et celles qui y arrivent
	function rendRelations(iri) {
		var sortantes = E.props.filter(function (p) { return !p.supprime && p.domain === iri && p.range && !litteral(p.range) && cl(p.range); });
		var entrantes = E.props.filter(function (p) { return !p.supprime && p.range === iri && p.domain && cl(p.domain); });
		if (!sortantes.length && !entrantes.length) return '';
		var bouton = function (p) { return '<button type="button" class="lien-mini" data-t="prop" data-iri="' + echappe(p.iri) + '" title="' + echappe(p.nom) + '">' + echappe(affiche(p)) + '</button>'; };
		return '<div class="inst-rel"><strong>Relations</strong>' +
			sortantes.map(function (p) { return '<div>→ ' + bouton(p) + ' → ' + echappe(affiche(cl(p.range))) + '</div>'; }).join('') +
			entrantes.map(function (p) { return '<div>← ' + echappe(affiche(cl(p.domain))) + ' · ' + bouton(p) + '</div>'; }).join('') + '</div>';
	}
	// Nom d'une propriété d'après son IRI (déclarée ou standard)
	function nomValeur(v) { var p = pr(v.p); return p ? affiche(p) : (v.nom || nomDe(v.p)); }
	// Concepts montrés dans l'onglet : ceux de la copie, et ceux qui n'ont que des instances du brouillon ; chacun avec ce qui l'attend
	function classesAffichees() {
		var classes = I.classes.map(function (c) { return Object.assign({}, c, { attente: [] }); }), parIri = {}, parNom = {};
		classes.forEach(function (c) { parIri[c.iri] = c; parNom[c.nom] = c; });
		var entree = function (iri, nom) {
			var c = parIri[iri] || (nom !== undefined && parNom[nom]);
			if (!c) { var e = cl(iri) || E.classes.filter(function (x) { return x.nom === nom; })[0]; c = { iri: e ? e.iri : iri, nom: e ? e.nom : (nom || nomDe(iri)), n: 0, plus: 0, items: [], attente: [] }; classes.push(c); parIri[c.iri] = c; parNom[c.nom] = c; }
			return c;
		};
		D.nouvelles.forEach(function (n, i) { entree(n.classe).attente.push({ i: i, n: n }); });
		D.ia.filter(function (p) { return p.genre === 'nouveau'; }).forEach(function (p) { entree('', p.cible).attente.push({ p: p }); });
		return classes.sort(function (a, b) { return a.nom.localeCompare(b.nom); });
	}
	function rendBrouillonInstances() {
		if (!nbInst()) return '';
		var l = [];
		D.nouvelles.forEach(function (n, i) {
			l.push('<li>＋ ' + echappe(cl(n.classe) ? affiche(cl(n.classe)) : nomCourt(n.classe)) + ' « ' + echappe(n.titre || n.local || 'sans titre') + ' »' + (n.anon ? ' (nœud anonyme)' : '') + ' <button type="button" class="lien-mini" data-ab="nouvelle-edite" data-id="' + i + '">modifier</button> <button type="button" class="lien-mini" data-ab="nouvelle-annule" data-id="' + i + '">retirer</button></li>');
		});
		Object.keys(D.modifiees).forEach(function (iri) {
			l.push('<li>✎ ' + echappe(D.modifiees[iri].nom) + ' <button type="button" class="lien-mini" data-ab="edite" data-id="' + echappe(iri) + '">modifier</button> <button type="button" class="lien-mini" data-ab="modif-annule" data-id="' + echappe(iri) + '">annuler</button></li>');
		});
		Object.keys(D.supprimees).forEach(function (iri) {
			l.push('<li>🗑 ' + echappe(D.supprimees[iri]) + ' <button type="button" class="lien-mini" data-ab="annule-sup" data-id="' + echappe(iri) + '">annuler</button></li>');
		});
		D.ia.forEach(function (p) {
			l.push('<li>✨ ' + (p.genre === 'nouveau' ? 'Créer ' + echappe(p.cible) + ' « ' + echappe(p.titre) + ' »' : 'Compléter ' + echappe(p.cible)) + (p.anomalies && p.anomalies.length ? ' <span title="' + echappe(p.anomalies.join(' / ')) + '">⚠️</span>' : '') + ' <button type="button" class="lien-mini" data-ab="ia-retire" data-id="' + p.i + '">retirer</button></li>');
		});
		return '<div class="inst-brouillon"><strong>À enregistrer (' + nbInst() + ')</strong><ul>' + l.join('') + '</ul></div>';
	}

	// Formulaire d'une instance : ses valeurs, une ligne par valeur
	function ligneValeur(v, k) {
		var p = pr(v.p), nom = p ? affiche(p) : (v.nom || nomCourt(v.p));
		var h = '<div class="if-ligne" data-k="' + k + '"><span class="if-p" title="' + echappe(v.p) + '">' + echappe(nom) + '</span>';
		if (v.k === 'bn') return h + '<span class="vals">' + echappe(v.v) + ' <em>(nœud anonyme, non modifiable ici)</em></span><span></span></div>';
		var texte = v.k === 'lit' && (!v.dt || v.dt === XSD + 'string');
		if (v.k === 'iri') h += '<input type="text" class="champ" list="dl-inst" data-champ="v" value="' + echappe(v.v) + '" placeholder="ex:nom ou IRI">';
		else if (v.dt === XSD + 'boolean') h += '<select class="champ" data-champ="v"><option value=""></option><option' + (v.v === 'true' ? ' selected' : '') + '>true</option><option' + (v.v === 'false' ? ' selected' : '') + '>false</option></select>';
		else {
			var type = /#(integer|int|long|decimal|double|float)$/.test(v.dt) ? 'number' : /#date$/.test(v.dt) ? 'date' : 'text';
			h += '<span style="display:flex;gap:4px"><input type="' + type + '" class="champ" step="any" data-champ="v" value="' + echappe(v.v) + '"' + (v.dt && type === 'text' && v.dt !== XSD + 'string' ? ' placeholder="' + echappe(nomCourt(v.dt)) + '"' : '') + '>' +
				(texte ? '<input type="text" class="champ" data-champ="l" value="' + echappe(v.l) + '" placeholder="langue" list="dl-langues" title="Langue du texte (fr, en…), facultative : un texte sans langue n\'est pas le même qu\'un texte @fr" style="width:4.5em">' : '') + '</span>';
		}
		return h + '<button type="button" class="lien-mini" data-rm-val="' + k + '" aria-label="Retirer cette valeur">✕</button></div>';
	}
	function rendFormulaire() {
		var z = $('#p-instances');
		if (F.chargement) { z.innerHTML = "<p class='astuce'>⏳ Chargement de l'instance…</p>"; return; }
		var h = '<div class="inst-form"><h3 style="margin:0 0 8px">' + (F.mode === 'nouvelle' ? '＋ Nouvelle instance' : '✎ ' + echappe(F.nom)) + '</h3>';
		if (F.mode === 'nouvelle') {
			h += '<div class="if-ligne"><span class="if-p">Concept</span><select id="if-classe" class="champ">' + E.classes.filter(function (c) { return !c.supprime; }).map(function (c) {
				return '<option value="' + echappe(c.iri) + '"' + (c.iri === F.classe ? ' selected' : '') + '>' + echappe(affiche(c)) + '</option>';
			}).join('') + '</select><span></span></div>' +
				'<div class="if-ligne"><span class="if-p">Nœud anonyme</span><label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="if-anon"' + (F.anon ? ' checked' : '') + '> sans identifiant (comme les rôles)</label><span></span></div>' +
				(F.anon ? '' : '<div class="if-ligne"><span class="if-p">Identifiant</span><input type="text" id="if-local" class="champ" value="' + echappe(F.local) + '" title="' + echappe(espaceInstances()) + '…"><span></span></div>');
		} else {
			h += '<div class="if-ligne"><span class="if-p">Concept</span><div class="parents">' + F.types.map(function (t) {
				return '<span class="puce-parent" title="' + echappe(t.iri) + '">' + echappe(cl(t.iri) ? affiche(cl(t.iri)) : t.nom) +
					(F.types.length > 1 ? ' <button type="button" class="lien-mini" data-rm-type="' + echappe(t.iri) + '" aria-label="Retirer ce concept">✕</button>' : '') + '</span>';
			}).join('') + '<select id="if-type-ajout" aria-label="Ajouter un concept"><option value="">＋ concept…</option>' +
				E.classes.filter(function (c) { return !c.supprime && !F.types.some(function (t) { return t.iri === c.iri; }); }).map(function (c) {
					return '<option value="' + echappe(c.iri) + '">' + echappe(affiche(c)) + '</option>';
				}).join('') + '</select></div><span></span></div>';
			h += '<p class="astuce" style="margin:0 0 6px">' + (F.anon ? 'Nœud anonyme (pas d\'IRI) · ' : '') + (F.entrants ? F.entrants + ' référence(s) vers elle' : 'aucune référence vers elle') + '</p>';
		}
		h += '<div id="if-valeurs">' + F.valeurs.map(ligneValeur).join('') + '</div>';
		var ap = proprietesFormulaire(), autres = E.props.filter(function (p) { return !p.supprime && ap.indexOf(p) < 0; });
		var opt = function (p) { return '<option value="' + echappe(p.iri) + '">' + echappe(affiche(p)) + '</option>'; };
		h += '<select id="if-ajout" class="champ" aria-label="Ajouter une valeur"><option value="">＋ ajouter une valeur…</option>' + ap.map(opt).join('') +
			(autres.length ? '<optgroup label="Autres propriétés">' + autres.map(opt).join('') + '</optgroup>' : '') +
			'<optgroup label="RDFS / OWL">' + PROPS_STD.map(function (x) { return '<option value="' + echappe(x.iri) + '">' + echappe(x.nom) + '</option>'; }).join('') + '</optgroup></select>';
		var noms = [];
		(I ? I.classes : []).forEach(function (c) { c.items.forEach(function (it) { if (it.iri && noms.length < 600) noms.push('<option value="' + echappe(it.nom) + '" label="' + echappe(it.titre || '') + '">'); }); });
		h += '<datalist id="dl-inst">' + noms.join('') + '</datalist><datalist id="dl-langues"><option value="fr"><option value="en"><option value="de"><option value="es"><option value="it"></datalist>';
		h += '<div class="boutons"><button type="button" class="btn vert petit" id="if-ok">✔ Valider</button><button type="button" class="btn secondaire petit" id="if-annule">Annuler</button>' +
			(F.mode === 'edition' && !F.bn ? '<button type="button" class="btn danger petit" id="if-suppr">🗑️ Supprimer l\'instance</button>' : '') + '</div>' +
			'<p class="astuce">Rien n\'est écrit dans votre copie avant « Enregistrer ».</p></div>';
		z.innerHTML = h;
	}
	function ouvreNouvelle(classe) {
		var c = classe || (E.sel && E.sel.t === 'classe' && cl(E.sel.iri) && !cl(E.sel.iri).supprime ? E.sel.iri : (E.classes.filter(function (x) { return !x.supprime; })[0] || {}).iri);
		if (!c) { toast('Créez d\'abord un concept'); return; }
		F = { mode: 'nouvelle', idx: -1, classe: c, valeurs: proprietesPour(c).slice(0, 10).map(function (p) { return valeurVide(p.iri); }), iriAuto: true, local: '' };
		F.local = proposeLocal(F);
		rendInstances();
	}
	// cle : IRI de l'instance, ou « _:identifiant » pour un nœud anonyme
	function ouvreEdition(cle) {
		var anon = cle.indexOf('_:') === 0 ? cle.slice(2) : '';
		if (D.modifiees[cle]) {
			var m = D.modifiees[cle];
			F = { mode: 'edition', cle: cle, iri: m.iri, anon: m.anon, nom: m.nom, classe: m.classe, types: JSON.parse(JSON.stringify(m.types)), valeurs: JSON.parse(JSON.stringify(m.valeurs)), orig: m.orig, entrants: m.entrants };
			rendInstances(); return;
		}
		F = { mode: 'edition', cle: cle, iri: anon ? '' : cle, anon: anon, nom: cle, chargement: true, valeurs: [], types: [] };
		rendInstances();
		appel('instance', anon ? { anon: anon } : { iri: cle }).then(function (r) {
			if (!F || F.cle !== cle) return;
			if (!r.ok) { F = null; message(r.html); rendInstances(); return; }
			var m = r.modele;
			F = { mode: 'edition', cle: cle, iri: m.iri, anon: m.anon, nom: m.nom, classe: m.types[0] ? m.types[0].iri : '', types: m.types, valeurs: m.valeurs, orig: signature(m.valeurs, m.types), entrants: m.entrants };
			rendInstances();
		});
	}
	function valideFormulaire() {
		var valeurs = F.valeurs.filter(function (v) { return v.k !== 'bn' && String(v.v).trim() !== ''; }).map(function (v) {
			return { p: v.p, k: v.k, v: String(v.v).trim(), dt: v.k === 'lit' && !v.l ? (v.dt || '') : '', l: v.k === 'lit' ? (v.l || '') : '' };
		});
		if (F.mode === 'nouvelle') {
			var iri = '', entree;
			if (F.anon) entree = { iri: '', anon: true, local: '', classe: F.classe, valeurs: valeurs, titre: titreInstance(valeurs) };
			else {
				var ri = resoutIdentifiant(F.local, espaceInstances());
				if (ri.erreur) { toast(ri.erreur); return; }
				iri = ri.iri;
				var autre = F.idx >= 0 && D.nouvelles[F.idx] && D.nouvelles[F.idx].iri === iri;
				if (!autre && iriInstanceExiste(iri)) { toast('Cet identifiant existe déjà'); return; }
				entree = { iri: iri, local: F.local, classe: F.classe, valeurs: valeurs, titre: titreInstance(valeurs) };
			}
			if (F.idx >= 0) D.nouvelles[F.idx] = entree; else D.nouvelles.push(entree);
			ouverts[F.classe] = true;
		} else if (signature(valeurs, F.types) === F.orig) delete D.modifiees[F.cle];
		else D.modifiees[F.cle] = { iri: F.iri, anon: F.anon, nom: F.nom, classe: F.classe, types: F.types, valeurs: valeurs, orig: F.orig, entrants: F.entrants };
		F = null;
		rend();
	}
	function ouvreOnglet(o) {
		document.querySelectorAll('.onglets button').forEach(function (b) { b.classList.toggle('actif', b.dataset.onglet === o); b.setAttribute('aria-selected', b.dataset.onglet === o ? 'true' : 'false'); });
		['instances', 'ia'].forEach(function (k) { $('#p-' + k).hidden = k !== o; });
		if (o === 'ia') rendCible();
	}
	function modifies() {
		return E.classes.filter(function (c) { return statut(c, 'classe') && !c.supprime; }).map(function (c) { return [c, 'classe']; })
			.concat(E.props.filter(function (p) { return statut(p, 'prop') && !p.supprime; }).map(function (p) { return [p, 'prop']; }));
	}
	function rendCible() {
		var z = $('#cible'); if (!z) return;
		var m = modifies();
		z.innerHTML = m.length ? 'Cibles : ' + m.map(function (x) {
			return '<span>' + echappe(affiche(x[0])) + (statut(x[0], x[1]) === 'new' ? ' ＋' : ' ✎') + '</span>';
		}).join('') : 'Aucune modification en cours : le mode ciblé n\'aurait rien à faire.';
	}
	function rendPropositions() {
		var z = $('#propositions');
		if (!z) return;   // IA non activée sur ce serveur : pas de zone de propositions
		if (!propositions || !propositions.liste.length) { z.innerHTML = ''; return; }
		var douteuses = propositions.liste.filter(function (p) { return p.anomalies && p.anomalies.length; }).length;
		var h = '<div class="ligne"><strong>' + propositions.liste.length + ' proposition(s)</strong><button type="button" class="lien-mini" id="tout-cocher">tout cocher</button>' +
			(douteuses ? '<button type="button" class="lien-mini" id="cocher-saines">cocher sans anomalie</button>' : '') + '</div>' +
			(douteuses ? '<p class="alerte">⚠️ ' + douteuses + ' proposition(s) rendraient votre copie incohérente (contrôle fait sur une copie jetable) : elles sont décochées.</p>' : '');
		propositions.liste.forEach(function (p) {
			var anomalies = p.anomalies || [];
			h += '<label' + (anomalies.length ? ' class="douteuse"' : '') + '><input type="checkbox" data-p="' + p.i + '"' + (anomalies.length ? '' : ' checked') + '> <span><strong>' +
				(p.genre === 'nouveau' ? 'Créer ' + echappe(p.cible) + ' « ' + echappe(p.titre) + ' »' : 'Compléter ' + echappe(p.cible)) + '</strong>' +
				(p.detail.length ? '<span class="detail">' + p.detail.map(echappe).join(' · ') + '</span>' : '') +
				anomalies.map(function (a) { return '<span class="detail anomalie">⚠️ ' + echappe(a) + '</span>'; }).join('') + '</span></label>';
		});
		h += '<div class="boutons"><button type="button" class="btn vert" id="accepte">➕ Ajouter au brouillon</button></div>' +
			'<p class="astuce">Les propositions choisies rejoignent la liste « À enregistrer » de l\'onglet Instance ; elles entrent dans votre copie avec « Enregistrer », en même temps que vos modifications de l\'ontologie.</p>';
		z.innerHTML = h;
	}
	function genere() {
		var mode = document.querySelector('input[name=mode]:checked').value;
		if (D.ia.length) { message("<p class='statut ko'>❌ " + D.ia.length + " proposition(s) de l'IA attendent déjà d'être enregistrées : enregistrez-les (ou retirez-les) avant d'en demander d'autres.</p>"); return; }
		if (mode === 'cible' && !modifies().length) { message("<p class='statut ko'>❌ Aucune modification de l'ontologie à viser : modifiez d'abord un concept ou une propriété, ou choisissez le peuplement général.</p>"); return; }
		var bouton = $('#generer');
		bouton.disabled = true;
		message("<p class='astuce'>⏳ L'IA prépare des propositions (cela peut prendre une demi-minute)…</p>");
		$('#propositions').innerHTML = '';
		appel('ia_peupler', { mode: mode, quantite: $('#quantite').value, consigne: $('#consigne').value, brouillon64: base64(JSON.stringify(brouillon())) }).then(function (r) {
			bouton.disabled = false;
			if (!r.ok) { message(r.html); return; }
			message("<p class='statut ok'>✨ " + r.propositions.length + " proposition(s) de l'IA (" + echappe(r.modele) + ") : relisez-les avant de les ajouter ; elles peuvent contenir des erreurs. Chacune a été contrôlée sur une copie jetable de votre copie.</p>");
			propositions = { jeton: r.jeton, liste: r.propositions.map(function (p, i) { p.i = i; return p; }) };
			rendPropositions();
		});
	}
	// Les propositions cochées rejoignent le brouillon ; elles entrent dans la copie à « Enregistrer »
	function accepte() {
		var cochees = [].slice.call(document.querySelectorAll('#propositions input[data-p]:checked')).map(function (c) { return String(c.dataset.p); });
		if (!cochees.length) { toast('Cochez au moins une proposition'); return; }
		var prises = propositions.liste.filter(function (p) { return cochees.indexOf(String(p.i)) >= 0; });
		D.iaJeton = propositions.jeton;
		prises.forEach(function (p) { D.ia.push(p); var c = E.classes.filter(function (x) { return x.nom === p.cible; })[0]; if (c) ouverts[c.iri] = true; });
		propositions.liste = propositions.liste.filter(function (p) { return cochees.indexOf(String(p.i)) < 0; });
		message('');
		rend(); rendPropositions();
		toast('✨ ' + prises.length + ' proposition(s) ajoutée(s) au brouillon : à enregistrer');
		ouvreOnglet('instances');
	}

	//--------------------------------------------------------------------------
	// Import et export Turtle (import.php, export.php)
	//--------------------------------------------------------------------------
	var IMPORT_TAILLE_MAX = 1048576;
	function appelFichier(action, champs, fichier) {
		var corps = new FormData();
		corps.set('action', action); corps.set('jeu', donnees.jeu); corps.set('csrf', donnees.csrf);
		Object.keys(champs).forEach(function (k) { corps.set(k, champs[k]); });
		corps.set('fichier', fichier);
		return fetch('controler.php', { method: 'POST', body: corps, credentials: 'same-origin' }).then(function (r) {
			if (!r.headers.get('X-SPARQLSandbox')) return { ok: false, html: "<p class='statut ko'>❌ La requête a été bloquée avant d'atteindre l'application (code " + r.status + ").</p>" };
			return r.json();
		}).catch(function () { return { ok: false, html: "<p class='statut ko'>❌ Le serveur ne répond pas.</p>" }; });
	}
	function ouvreImport() {
		var n = nbModifs(), jeu = encodeURIComponent(donnees.jeu), d = $('#dlg-import');
		d.innerHTML = '<h2>🔁 Import et export Turtle</h2>' +
			'<h3>Exporter votre copie</h3><p class="boutons" style="margin:0"><a class="btn secondaire petit" href="export.php?jeu=' + jeu + '" download>⬇️ Tout</a>' +
			'<a class="btn secondaire petit" href="export.php?jeu=' + jeu + '&amp;partie=ontologie" download>⬇️ Ontologie</a><a class="btn secondaire petit" href="export.php?jeu=' + jeu + '&amp;partie=instances" download>⬇️ Instances</a></p>' +
			'<p class="astuce">Ce qui est enregistré dans votre copie (pas votre brouillon), avec les préfixes que vous avez ajoutés.</p>' +
			'<h3>Importer un fichier</h3>' + (n ? '<p class="statut avertissement">⚠️ Vous avez ' + n + ' modification' + (n > 1 ? 's' : '') + ' non enregistrée' + (n > 1 ? 's' : '') + ' : enregistrez-les ou abandonnez-les avant d\'importer.</p>' : '') +
			'<p class="astuce">Un fichier Turtle (<code>.ttl</code>) ou N-Triples (<code>.nt</code>), de 1 Mo et 20 000 triplets au plus. Il est contrôlé puis essayé sur une copie jetable : en cas de problème, votre copie reste intacte.</p>' +
			'<div class="imp-champs"><label for="imp-fichier">Fichier</label><input type="file" id="imp-fichier" accept=".ttl,.nt">' +
			'<span class="imp-t">Partie</span><div><label><input type="radio" name="imp-partie" value="tout" checked> ontologie et instances</label> <label><input type="radio" name="imp-partie" value="ontologie"> ontologie seule</label> <label><input type="radio" name="imp-partie" value="instances"> instances seules</label></div>' +
			'<span class="imp-t">Mode</span><div><label><input type="radio" name="imp-mode" value="fusionner" checked> fusionner (ajouter à votre copie)</label> <label><input type="radio" name="imp-mode" value="remplacer"> remplacer (efface d\'abord la même partie de votre copie)</label></div></div>' +
			'<div class="boutons"><button type="button" class="btn secondaire" id="imp-analyse"' + (n ? ' disabled' : '') + '>🔎 Analyser, sans importer</button>' +
			'<button type="button" class="btn vert" id="imp-fait"' + (n ? ' disabled' : '') + '>📥 Importer</button><button type="button" class="btn" id="imp-fermer">Fermer</button></div>' +
			'<div id="imp-msg" aria-live="polite"></div>';
		if (!d.open) d.showModal();
	}
	function lanceImport(simuler) {
		var f = $('#imp-fichier').files[0], m = $('#imp-msg');
		if (!f) { m.innerHTML = "<p class='statut ko'>❌ Choisissez un fichier.</p>"; return; }
		if (f.size > IMPORT_TAILLE_MAX) { m.innerHTML = "<p class='statut ko'>❌ Le fichier est trop gros (1 Mo au plus).</p>"; return; }
		var partie = document.querySelector('input[name=imp-partie]:checked').value, mode = document.querySelector('input[name=imp-mode]:checked').value;
		if (!simuler && mode === 'remplacer' && !window.confirm('Remplacer : la même partie de votre copie sera effacée avant l\'import. Continuer ?')) return;
		m.innerHTML = "<p class='astuce'>⏳ " + (simuler ? 'Analyse' : 'Import') + ' en cours…</p>';
		document.querySelectorAll('#imp-analyse, #imp-fait').forEach(function (b) { b.disabled = true; });
		appelFichier('importer', { partie: partie, mode: mode, simuler: simuler ? '1' : '0' }, f).then(function (r) {
			m.innerHTML = r.html;
			document.querySelectorAll('#imp-analyse, #imp-fait').forEach(function (b) { b.disabled = false; });
			if (r.ok && r.importe) apresImport();
		});
	}
	// La copie a changé : le modèle de l'éditeur, ses positions et les instances sont relus
	function apresImport() {
		E.pos = {}; E.routes = {}; E.sel = null; iaIris = {}; propositions = null; rendPropositions();
		appel('ontologie').then(function (r) {
			if (!r.ok) { message(r.html); return; }
			charge(r.modele); rend(); chargeInstances();
		});
	}

	//--------------------------------------------------------------------------
	// Contrôle de cohérence de la copie avec le brouillon (rien n'est enregistré)
	//--------------------------------------------------------------------------
	function ouvreControle() {
		var d = $('#dlg-controle');
		d.innerHTML = '<h2>🔍 Contrôle de cohérence</h2><p class="astuce">⏳ Contrôle en cours (RDFS, formes SHACL du jeu et formes de votre ontologie)…</p>';
		if (!d.open) d.showModal();
		appel('controle', { brouillon64: base64(JSON.stringify(brouillon())) }).then(function (r) {
			d.innerHTML = '<h2>🔍 Contrôle de cohérence</h2><div aria-live="polite">' + r.html + '</div>' +
				'<p class="astuce">Ce contrôle est le même que le panneau « 🩺 Cohérence » de la page principale, avec en plus vos modifications non enregistrées. Les formes SHACL sont visibles avec « 🛡️ Formes SHACL ».</p>' +
				'<div class="boutons"><button type="button" class="btn" id="controle-fermer">Fermer</button></div>';
		});
	}

	//--------------------------------------------------------------------------
	// Formes SHACL : celles que l'ontologie (brouillon compris) fait naître, et celles du jeu
	//--------------------------------------------------------------------------
	var formes = null;
	function ouvreFormes() {
		appel('formes', { brouillon64: base64(JSON.stringify(brouillon())) }).then(function (r) {
			if (!r.ok) { message(r.html); return; }
			formes = r;
			var h = '<h2>🛡️ Formes SHACL</h2><p class="astuce">Une forme SHACL dit ce que les données doivent respecter. Celles de <strong>votre ontologie</strong> suivent ce que vous définissez : ' +
				'une cardinalité voulue sur une propriété, une propriété fonctionnelle (au plus une valeur), deux concepts disjoints. Elles sont recalculées à chaque contrôle et s\'ajoutent à celles du jeu ' +
				'(écrites par l\'enseignant). Les types sont déjà contrôlés par les contrôles RDFS.' + (nbModifs() ? ' <strong>Vos modifications non enregistrées y sont comprises.</strong>' : '') + '</p>' +
				'<h3>Dérivées de votre ontologie</h3>' + (r.derivees ? '<pre class="turtle" tabindex="0">' + echappe(r.derivees) + '</pre>' :
					'<p class="astuce">Aucune pour l\'instant : fixez une cardinalité sur une propriété (fiche, « Forme SHACL »), marquez-la fonctionnelle, ou déclarez deux concepts disjoints.</p>');
			if (r.jeu) h += '<details><summary>Formes du jeu de données (enseignant)</summary><pre class="turtle" tabindex="0">' + echappe(r.jeu) + '</pre></details>';
			h += '<div class="boutons"><button type="button" class="btn secondaire" id="formes-telecharge"' + (r.derivees || r.jeu ? '' : ' disabled') + '>⬇️ Télécharger (Turtle)</button><button type="button" class="btn" id="formes-fermer">Fermer</button></div>';
			$('#dlg-formes').innerHTML = h;
			var d = $('#dlg-formes'); if (!d.open) d.showModal();
		});
	}
	function telechargeFormes() {
		var texte = (formes.jeu ? '# Formes du jeu de données\n' + formes.jeu + '\n\n' : '') + (formes.derivees ? '# Formes dérivées de l\'ontologie\n' + formes.derivees : '');
		var a = document.createElement('a');
		a.href = URL.createObjectURL(new Blob([texte], { type: 'text/turtle;charset=utf-8' }));
		a.download = 'formes-' + donnees.jeu + '.ttl';
		document.body.appendChild(a); a.click(); a.remove();
	}

	//--------------------------------------------------------------------------
	// Préfixes de la copie : vocabulaires standards ou « métier » ajoutés par l'étudiant
	//--------------------------------------------------------------------------
	var prefs = null;
	function rendPrefixes() {
		var P = prefs, h = '<h2>🏷️ Préfixes</h2>' +
			'<p class="astuce">Un préfixe abrège un espace de noms (<code>cine:Film</code> pour <code>http://example.org/cinema/vocab#Film</code>). Ceux que vous ajoutez servent partout dans votre copie (éditeur, requêtes, IA) jusqu\'au retour au jeu d\'origine. ' +
			'Dans l\'éditeur, un identifiant s\'écrit alors <code>préfixe:nom</code> (par exemple <code>skos:Concept</code>) pour réutiliser un terme d\'un vocabulaire.</p>';
		var ligne = function (p, ns, origine, rm) {
			return '<tr><th scope="row"><code>' + echappe(p) + ':</code></th><td><code>' + echappe(ns) + '</code></td><td>' + origine + '</td><td>' +
				(rm ? '<button type="button" class="lien-mini" data-pref-rm="' + echappe(p) + '" aria-label="Retirer le préfixe ' + echappe(p) + '">✕ retirer</button>' : '') + '</td></tr>';
		};
		h += '<div class="defile" style="max-height:220px"><table class="resultat pref-table"><thead><tr><th>Préfixe</th><th>Espace de noms</th><th>Origine</th><th></th></tr></thead><tbody>';
		Object.keys(P.ajoutes).forEach(function (p) { h += ligne(p, P.ajoutes[p], 'ajouté', true); });
		Object.keys(P.jeu).forEach(function (p) { h += ligne(p, P.jeu[p], 'jeu de données', false); });
		Object.keys(P.standard).forEach(function (p) { h += ligne(p, P.standard[p], 'standard', false); });
		h += '</tbody></table></div>';
		h += '<h3>Ajouter un vocabulaire standard</h3>';
		if (P.catalogue.length) h += '<div class="relier"><label for="pref-cat" class="visuellement-cache">Vocabulaire standard</label><select id="pref-cat" class="champ">' +
			P.catalogue.map(function (c) { return '<option value="' + echappe(c.prefixe) + '">' + echappe(c.prefixe + ' — ' + c.description) + '</option>'; }).join('') +
			'</select><button type="button" class="btn secondaire petit" id="pref-ajout-cat">＋ Ajouter</button></div>';
		else h += '<p class="astuce">Tous les vocabulaires du catalogue sont déjà définis.</p>';
		h += '<h3>Ou un préfixe métier</h3><div class="pref-metier"><label for="pref-nom">Préfixe</label><input type="text" id="pref-nom" class="champ" maxlength="20" placeholder="meteo" autocomplete="off">' +
			'<label for="pref-ns">Espace de noms</label><input type="text" id="pref-ns" class="champ" maxlength="200" placeholder="http://example.org/meteo#" autocomplete="off">' +
			'<button type="button" class="btn secondaire petit" id="pref-ajout-perso">＋ Ajouter</button></div>' +
			'<p class="astuce">L\'espace de noms est une adresse <code>http://…</code> ou <code>https://…</code> qui se termine par <code>#</code> ou <code>/</code>.</p>' +
			'<div id="pref-msg" aria-live="polite"></div><div class="boutons"><button type="button" class="btn" id="pref-fermer">Fermer</button></div>';
		$('#dlg-prefixes').innerHTML = h;
	}
	function ouvrePrefixes() {
		appel('prefixes').then(function (r) {
			if (!r.ok) { message(r.html); return; }
			prefs = r.prefixes; rendPrefixes();
			var d = $('#dlg-prefixes'); if (!d.open) d.showModal();
		});
	}
	// Après un ajout ou un retrait : les noms abrégés se mettent à jour sans toucher au brouillon
	function prefixesChanges(P) {
		prefs = P;
		E.prefixes = Object.assign({}, P.standard, P.jeu, P.ajoutes);
		E.prefixe = prefixeDe(E.espace);
		E.classes.forEach(function (c) { c.nom = nomDe(c.iri); });
		E.props.forEach(function (p) { p.nom = nomDe(p.iri); });
		rend(); chargeInstances();
	}
	function actionPrefixe(action, champs) {
		appel(action, champs).then(function (r) {
			prefixesChanges(r.prefixes || prefs);
			rendPrefixes();
			var m = $('#pref-msg'); if (m) m.innerHTML = '<p class="statut ' + (r.ok ? 'ok' : 'ko') + '">' + (r.ok ? '✅ ' : '❌ ') + echappe(r.message || '') + '</p>';
		});
	}

	//--------------------------------------------------------------------------
	// Boutons, clavier, sortie
	//--------------------------------------------------------------------------
	document.addEventListener('click', function (e) {
		var n = e.target.closest('[data-t]');
		if (n) { if (estChoisi(n.dataset.t, n.dataset.iri) && n.closest('#p-instances, .noeud')) deselectionne(); else { E.sel = { t: n.dataset.t, iri: n.dataset.iri }; rend(); } return; }
		var o = e.target.closest('[data-onglet]');
		if (o) { ouvreOnglet(o.dataset.onglet); return; }
		var ic = e.target.closest('[data-ic]');
		if (ic) { ouverts[ic.dataset.ic] = !ouverts[ic.dataset.ic]; rendInstances(); return; }
		var pr_ = e.target.closest('[data-pref-rm]');
		if (pr_) { actionPrefixe('prefixe_retirer', { prefixe: pr_.dataset.prefRm }); return; }
		var ab = e.target.closest('[data-ab]');
		if (ab) {
			var act = ab.dataset.ab, ident = ab.dataset.id;
			if (act === 'nouvelle') ouvreNouvelle();
			else if (act === 'edite') ouvreEdition(ident);
			else if (act === 'voir-anon') { seulAnon = true; ouverts[ident] = true; ouvreOnglet('instances'); rendInstances(); }
			else if (act === 'nouvelle-edite') { var n = D.nouvelles[+ident]; F = { mode: 'nouvelle', idx: +ident, classe: n.classe, anon: !!n.anon, valeurs: JSON.parse(JSON.stringify(n.valeurs)), iriAuto: false, local: n.local }; rendInstances(); }
			else if (act === 'nouvelle-annule') { D.nouvelles.splice(+ident, 1); rend(); }
			else if (act === 'modif-annule') { delete D.modifiees[ident]; rend(); }
			else if (act === 'annule-sup') { delete D.supprimees[ident]; rend(); }
			else if (act === 'ia-retire') { D.ia = D.ia.filter(function (p) { return String(p.i) !== ident; }); rend(); }
			return;
		}
		var rt = e.target.closest('[data-rm-type]');
		if (rt && F) { F.types = F.types.filter(function (t) { return t.iri !== rt.dataset.rmType; }); F.classe = F.types[0] ? F.types[0].iri : ''; rendInstances(); return; }
		var rv = e.target.closest('[data-rm-val]');
		if (rv && F) { F.valeurs.splice(+rv.dataset.rmVal, 1); rendInstances(); return; }
		var id = e.target.id;
		if (id === 'b-prefixes') ouvrePrefixes();
		else if (id === 'b-import') ouvreImport();
		else if (id === 'imp-fermer') $('#dlg-import').close();
		else if (id === 'imp-analyse') lanceImport(true);
		else if (id === 'imp-fait') lanceImport(false);
		else if (id === 'b-controle') ouvreControle();
		else if (id === 'controle-fermer') $('#dlg-controle').close();
		else if (id === 'b-formes') ouvreFormes();
		else if (id === 'formes-fermer') $('#dlg-formes').close();
		else if (id === 'formes-telecharge') telechargeFormes();
		else if (id === 'pref-fermer') $('#dlg-prefixes').close();
		else if (id === 'pref-ajout-cat') actionPrefixe('prefixe_ajouter', { prefixe: $('#pref-cat').value });
		else if (id === 'pref-ajout-perso') actionPrefixe('prefixe_ajouter', { prefixe: $('#pref-nom').value, iri: $('#pref-ns').value });
		else if (id === 'if-ok') valideFormulaire();
		else if (id === 'if-annule') { F = null; rendInstances(); }
		else if (id === 'if-suppr') {
			if (F.entrants && !window.confirm(F.entrants + ' autre(s) ressource(s) font référence à cette instance : ces liens seront supprimés avec elle. Continuer ?')) return;
			D.supprimees[F.cle] = F.nom; delete D.modifiees[F.cle]; F = null; rend();
		}
		else if (id === 'generer') genere();
		else if (id === 'accepte') accepte();
		else if (id === 'tout-cocher') document.querySelectorAll('#propositions input[data-p]').forEach(function (c) { c.checked = true; });
		else if (id === 'cocher-saines') document.querySelectorAll('#propositions label').forEach(function (l) { l.querySelector('input').checked = !l.classList.contains('douteuse'); });
		else if (id === 'add-classe') creeConcept();
		else if (id === 'add-prop') creeProp('', XSD + 'string', 'nouvelle propriété');
		else if (id === 'v-graphe') { vue = 'graphe'; rendVue(); }
		else if (id === 'v-liste') { vue = 'liste'; rendVue(); }
		else if (id === 'reorg') reorganise();
		else if (id === 'b-enreg') enregistre();
		else if (id === 'retour') {
			if (!nbModifs()) { retour(); return; }
			$('#dlg-texte').textContent = 'Vous avez ' + nbModifs() + ' modification(s) non enregistrée(s) de l\'ontologie. Au retour, le graphe reflétera l\'état enregistré de votre copie.';
			$('#dlg-sortie').showModal();
		}
		else if (id === 's-continuer') $('#dlg-sortie').close();
		else if (id === 's-abandon') { $('#dlg-sortie').close(); retour(); }
		else if (id === 's-enreg') { $('#dlg-sortie').close(); enregistre().then(function (ok) { if (ok) retour(); }); }
	});
	// Saisies du formulaire d'instance : elles mettent à jour F sans redessiner (le curseur reste en place)
	document.addEventListener('input', function (e) {
		if (!F) return;
		var li = e.target.closest('.if-ligne[data-k]');
		if (li && e.target.dataset.champ) {
			var v = F.valeurs[+li.dataset.k]; v[e.target.dataset.champ] = e.target.value;
			if (F.mode === 'nouvelle' && F.iriAuto && e.target.dataset.champ === 'v') { F.local = proposeLocal(F); var l = $('#if-local'); if (l) l.value = F.local; }
		} else if (e.target.id === 'if-local') { F.local = e.target.value.trim(); F.iriAuto = false; }
	});
	document.addEventListener('change', function (e) {
		if (e.target.id === 'filtre-anon') { seulAnon = e.target.checked; rendInstances(); return; }
		if (!F) return;
		if (e.target.id === 'if-classe') {
			var garde = F.valeurs.filter(function (v) { return String(v.v).trim() !== ''; });
			F.classe = e.target.value;
			F.valeurs = proprietesPour(F.classe).slice(0, 10).map(function (p) { return valeurVide(p.iri); }).filter(function (v) { return !garde.some(function (g) { return g.p === v.p; }); }).concat(garde);
			if (F.iriAuto) F.local = proposeLocal(F);
			rendInstances();
		} else if (e.target.id === 'if-anon') {
			F.anon = e.target.checked; rendInstances();
		} else if (e.target.id === 'if-type-ajout' && e.target.value) {
			var cn = cl(e.target.value);
			F.types.push({ iri: e.target.value, nom: cn ? cn.nom : e.target.value });
			if (!F.classe) F.classe = e.target.value;
			rendInstances();
		} else if (e.target.id === 'if-ajout' && e.target.value) {
			F.valeurs.push(valeurVide(e.target.value));
			rendInstances();
		} else if (e.target.tagName === 'SELECT' && e.target.dataset.champ) {
			var l2 = e.target.closest('.if-ligne[data-k]'); if (l2) F.valeurs[+l2.dataset.k][e.target.dataset.champ] = e.target.value;
		}
	});
	document.addEventListener('keydown', function (e) {
		if (e.key === 'Enter' && (e.target.id === 'pref-nom' || e.target.id === 'pref-ns')) { e.preventDefault(); $('#pref-ajout-perso').click(); return; }
		if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('.noeud')) { e.preventDefault(); e.target.click(); return; }
		if (e.key !== 'Delete' && e.key !== 'Backspace') return;
		if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
		var b = $('#supprime'); if (b) { e.preventDefault(); b.click(); }
	});
	window.addEventListener('beforeunload', function (e) { if (!quitte && nbModifs()) { e.preventDefault(); e.returnValue = ''; } });

	//--------------------------------------------------------------------------
	// Chargement
	//--------------------------------------------------------------------------
	appel('ontologie').then(function (r) {
		if (!r.ok) { message(r.html); return; }
		charge(r.modele);
		rend();
		chargeInstances();
	});
})();
