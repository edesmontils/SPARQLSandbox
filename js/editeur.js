// Éditeur d'ontologie (page editeur.php) : on modifie un BROUILLON de l'ontologie de la copie de
// session, en graphe (SVG dessiné ici, sans bibliothèque) ou en liste ; « Enregistrer » envoie le
// brouillon à controler.php (action ontologie_enregistrer), qui le traduit en mise à jour SPARQL
// (ontologie.php). Quitter sans enregistrer abandonne simplement le brouillon.
(function () {
	'use strict';

	var donnees = JSON.parse(document.getElementById('donnees').textContent);
	var XSD = 'http://www.w3.org/2001/XMLSchema#', RDFS = 'http://www.w3.org/2000/01/rdf-schema#', RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
	var LARGEUR = 170, ECART_X = 50, ECART_Y = 90, PAR_RANGEE = 5;

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
	function toast(t) {
		var e = $('#toast'); e.textContent = t; e.classList.add('vu');
		clearTimeout(toast.minuterie);
		toast.minuterie = setTimeout(function () { e.classList.remove('vu'); }, 2600);
	}

	//--------------------------------------------------------------------------
	// État : le brouillon
	//--------------------------------------------------------------------------
	var E = { classes: [], props: [], types: [], espace: '', prefixe: '', sel: null, pos: {} };
	var I = null, ouverts = {}, dernierSel = null, iaIris = {}, propositions = null;
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
	function nomDe(iri) {
		if (E.espace && iri.indexOf(E.espace) === 0) return E.prefixe + iri.slice(E.espace.length);
		return iri.replace(/^.*[#\/]/, '');
	}
	function affiche(x) { return x.label || x.nom; }
	function modifie(x, t) {
		var o = x.orig;
		if (x.label !== o.label) return true;
		return t === 'classe' ? (x.comment !== o.comment || x.parent !== o.parent) : (x.domain !== o.domain || x.range !== o.range);
	}
	function statut(x, t) { return x.supprime ? 'del' : x.nouveau ? 'new' : modifie(x, t) ? 'mod' : ''; }
	function nbModifs() {
		return E.classes.filter(function (c) { return statut(c, 'classe'); }).length + E.props.filter(function (p) { return statut(p, 'prop'); }).length;
	}
	function badge(st) {
		return st === 'new' ? '<span class="badge new">nouveau</span>' : st === 'mod' ? '<span class="badge mod">modifié</span>' : st === 'del' ? '<span class="badge del">supprimé</span>' : '';
	}
	function ancetres(iri) { var r = [], c = cl(iri), v = {}; while (c && c.parent && !v[c.parent]) { v[c.parent] = 1; r.push(c.parent); c = cl(c.parent); } return r; }

	function charge(m) {
		E.types = m.types; E.espace = m.espace;
		var avec = m.classes.filter(function (c) { return c.iri.indexOf(m.espace) === 0 && c.nom.indexOf(':') > 0 && c.nom.indexOf('<') !== 0; })[0];
		E.prefixe = avec ? avec.nom.slice(0, avec.nom.indexOf(':') + 1) : '';
		E.classes = m.classes.map(function (c) {
			var x = Object.assign({}, c); x.orig = { label: c.label, comment: c.comment, parent: c.parent }; x.nouveau = false; x.supprime = false; return x;
		});
		E.props = m.props.map(function (p) {
			var x = Object.assign({}, p); x.orig = { label: p.label, domain: p.domain, range: p.range }; x.nouveau = false; x.supprime = false; return x;
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

	function dispose() {
		var cs = E.classes, n = cs.length, idx = {}, i;
		cs.forEach(function (c, k) { idx[c.iri] = k; });
		var suiv = [], etat = [], pred = [];
		for (i = 0; i < n; i++) { suiv.push([]); etat.push(0); pred.push([]); }
		function arete(a, b) { if (a !== undefined && b !== undefined && a !== b) suiv[a].push(b); }
		cs.forEach(function (c) { if (c.parent) arete(idx[c.parent], idx[c.iri]); });
		E.props.forEach(function (p) { if (p.domain && p.range && !litteral(p.range)) arete(idx[p.domain], idx[p.range]); });
		var arriere = {};
		function visite(u) {
			etat[u] = 1;
			suiv[u].forEach(function (v) { if (etat[v] === 1) arriere[u + '>' + v] = true; else if (etat[v] === 0) visite(v); });
			etat[u] = 2;
		}
		for (i = 0; i < n; i++) if (etat[i] === 0) visite(i);
		var entrants = [], couche = [];
		for (i = 0; i < n; i++) { entrants.push(0); couche.push(0); suiv[i] = suiv[i].filter(function (v) { return !arriere[i + '>' + v]; }); }
		for (i = 0; i < n; i++) suiv[i].forEach(function (v) { entrants[v]++; pred[v].push(i); });
		var file = [];
		for (i = 0; i < n; i++) if (entrants[i] === 0) file.push(i);
		while (file.length) {
			var u = file.shift();
			suiv[u].forEach(function (v) { if (couche[v] < couche[u] + 1) couche[v] = couche[u] + 1; if (--entrants[v] === 0) file.push(v); });
		}
		var couches = [];
		for (i = 0; i < n; i++) (couches[couche[i]] = couches[couche[i]] || []).push(i);
		var rang = {};
		var rangees = [];
		couches.forEach(function (L, k) {
			if (!L) return;
			L.sort(function (a, b) {
				function cle(u) { var p = pred[u].filter(function (v) { return rang[v] !== undefined; }); return p.length ? p.reduce(function (s, v) { return s + rang[v]; }, 0) / p.length : -1; }
				return (cle(a) - cle(b)) || cs[a].nom.localeCompare(cs[b].nom);
			});
			L.forEach(function (u, j) { rang[u] = j / Math.max(1, L.length); });
			for (var s = 0; s < L.length; s += PAR_RANGEE) rangees.push(L.slice(s, s + PAR_RANGEE));
		});
		var largeur = rangees.reduce(function (m, L) { return Math.max(m, L.length); }, 1) * (LARGEUR + ECART_X);
		var y = 24;
		E.pos = {};
		rangees.forEach(function (L) {
			var x0 = 24 + (largeur - L.length * (LARGEUR + ECART_X)) / 2;
			L.forEach(function (u, j) { E.pos[cs[u].iri] = { x: x0 + j * (LARGEUR + ECART_X), y: y }; });
			y += L.reduce(function (m, u) { return Math.max(m, hauteur(cs[u])); }, 0) + ECART_Y;
		});
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

	function traceArete(e, N, decalage) {
		var A = N[e.a], B = N[e.b], x = e.x, t = e.k, st = statut(x, t === 'sub' ? 'classe' : 'prop');
		var sel = e.k === 'prop' && E.sel && E.sel.t === 'prop' && E.sel.iri === x.iri;
		var cls = 'ge ar' + (t === 'sub' ? ' sub' : '') + (st ? ' st-' + st : '') + (sel ? ' sel' : '');
		var d, lx, ly;
		if (e.a === e.b) {
			var x0 = A.x + A.w, y0 = A.y + 10;
			d = 'M' + x0 + ' ' + y0 + ' C' + (x0 + 60) + ' ' + (y0 - 28) + ' ' + (x0 + 60) + ' ' + (y0 + 48) + ' ' + x0 + ' ' + (y0 + 20); lx = x0 + 48; ly = y0 + 10;
		} else {
			var ax = A.x + A.w / 2, ay = A.y + A.h / 2, bx = B.x + B.w / 2, by = B.y + B.h / 2, dx = bx - ax, dy = by - ay, len = Math.sqrt(dx * dx + dy * dy) || 1;
			var cx = (ax + bx) / 2 + (-dy / len) * decalage, cy = (ay + by) / 2 + (dx / len) * decalage;
			var P0 = rectPt(A, cx, cy), P2 = rectPt(B, cx, cy);
			d = 'M' + P0.x + ' ' + P0.y + ' Q' + cx + ' ' + cy + ' ' + P2.x + ' ' + P2.y;
			lx = .25 * P0.x + .5 * cx + .25 * P2.x; ly = .25 * P0.y + .5 * cy + .25 * P2.y;
		}
		return '<g class="' + cls + '" data-edge="' + (t === 'sub' ? 'classe' : 'prop') + '" data-iri="' + echappe(x.iri) + '"><path class="hit" d="' + d + '"/>' +
			'<path class="trait" d="' + d + '" marker-end="' + (t === 'sub' ? 'url(#tri)' : 'url(#fl)') + '"/>' +
			(t === 'prop' ? '<text class="lbl" x="' + lx + '" y="' + (ly - 5) + '">' + echappe(court(affiche(x), 24)) + '</text>' : '') + '</g>';
	}

	function rendGraphe() {
		var svg = $('#svg-graphe'); if (!svg) return;
		var N = {}; E.classes.forEach(function (c) { N[c.iri] = geo(c); });
		var ar = [];
		E.classes.forEach(function (c) { if (c.parent && N[c.parent]) ar.push({ k: 'sub', a: c.iri, b: c.parent, x: c }); });
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
		E.classes.forEach(function (c) {
			var g = N[c.iri], st = statut(c, 'classe'), selC = E.sel && E.sel.t === 'classe' && E.sel.iri === c.iri;
			largeur = Math.max(largeur, g.x + g.w + 90); hauteurVue = Math.max(hauteurVue, g.y + g.h + 40);
			h += '<g class="gn' + (st ? ' st-' + st : '') + (selC ? ' sel' : '') + (lien && lien.cible === c.iri ? ' cible' : '') + '" data-cls="' + echappe(c.iri) + '" transform="translate(' + g.x + ',' + g.y + ')">' +
				'<rect class="corps" width="' + g.w + '" height="' + g.h + '" rx="10"><title>' + echappe(c.iri) + '</title></rect>' +
				'<text class="nom" x="10" y="21">' + echappe(court(affiche(c), 20)) + '</text>' +
				'<text class="cpt" x="' + (g.w - 10) + '" y="21" text-anchor="end">' + (c.n || '') + '</text>';
			g.at.forEach(function (p, i) {
				var s = E.sel && E.sel.t === 'prop' && E.sel.iri === p.iri;
				h += '<text class="at' + (s ? ' sel' : '') + (statut(p, 'prop') === 'new' ? ' new' : '') + '" data-attr="' + echappe(p.iri) + '" x="10" y="' + (40 + i * 15) + '">• ' +
					echappe(court(affiche(p), 12)) + ' : ' + echappe(court(nomCourt(p.range).replace('xsd:', ''), 10)) + '</text>';
			});
			h += '<g class="hd" data-cls="' + echappe(c.iri) + '" data-kind="prop" transform="translate(' + g.w + ',16)"><circle r="8"/><title>Glisser vers un concept : propriété ; vers le fond : attribut</title></g>' +
				'<g class="hd" data-cls="' + echappe(c.iri) + '" data-kind="sub" transform="translate(' + (g.w / 2) + ',0)"><polygon points="-8,5 8,5 0,-8"/><title>Glisser vers un concept : « sous-classe de »</title></g></g>';
		});
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
	}

	//--------------------------------------------------------------------------
	// Liste, propriétés non reliées, fiche, état
	//--------------------------------------------------------------------------
	function noeudClasse(c, vus) {
		vus[c.iri] = true;
		var enfants = E.classes.filter(function (x) { return x.parent === c.iri && !vus[x.iri]; });
		var st = statut(c, 'classe'), sel = E.sel && E.sel.t === 'classe' && E.sel.iri === c.iri ? ' sel' : '';
		return '<li><div class="noeud' + sel + (st === 'del' ? ' del' : '') + '" data-t="classe" data-iri="' + echappe(c.iri) + '" tabindex="0"><span class="puce"></span><span class="nom">' + echappe(affiche(c)) + '</span>' +
			badge(st) + '<span class="nb">' + (c.n || '') + '</span></div>' + (enfants.length ? '<ul>' + enfants.map(function (e) { return noeudClasse(e, vus); }).join('') + '</ul>' : '') + '</li>';
	}
	function noeudProp(p, note) {
		var st = statut(p, 'prop'), sel = E.sel && E.sel.t === 'prop' && E.sel.iri === p.iri ? ' sel' : '';
		return '<li><div class="noeud' + sel + (st === 'del' ? ' del' : '') + '" data-t="prop" data-iri="' + echappe(p.iri) + '" tabindex="0"><span class="puce prop"></span><span class="nom">' + echappe(affiche(p)) + '</span>' +
			badge(st) + (note ? '<span class="nb">' + note + '</span>' : '') + '</div></li>';
	}
	function relie(p) { return p.domain && cl(p.domain) && p.range && (litteral(p.range) || cl(p.range)); }
	function rendListes() {
		var vus = {};
		var racines = E.classes.filter(function (c) { return !c.parent || !cl(c.parent); });
		var h = racines.map(function (c) { return noeudClasse(c, vus); }).join('');
		E.classes.forEach(function (c) { if (!vus[c.iri]) h += noeudClasse(c, vus); }); // cycles de sous-classes
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

	function rendFiche() {
		var f = $('#fiche'), s = E.sel, x = s && (s.t === 'classe' ? cl(s.iri) : pr(s.iri));
		if (!x) { f.innerHTML = '<div class="vide">Sélectionnez un concept ou une propriété,<br>ou créez-en un.</div>'; return; }
		var t = s.t, st = statut(x, t), off = x.supprime ? ' disabled' : '';
		var h = '<h2>' + (t === 'classe' ? '🟦 Concept' : '🔵 Propriété') + ' : ' + echappe(affiche(x)) + ' ' + badge(st) + '</h2><div class="formulaire">';
		h += '<label for="f-label">Libellé</label><input type="text" id="f-label" maxlength="200" value="' + echappe(x.label) + '" placeholder="' + echappe(x.nom) + '"' + off + '>';
		if (x.nouveau) h += '<label for="f-local">Identifiant</label><input type="text" class="mono" id="f-local" value="' + echappe(iriLocale(x)) + '" title="' + echappe(E.espace) + '…"' + off + '>';
		else h += '<label>Identifiant</label><input type="text" class="mono" value="' + echappe(x.nom) + '" title="' + echappe(x.iri) + '" disabled>';
		if (t === 'classe') {
			h += '<label for="f-parent">Sous-classe de</label><select id="f-parent"' + off + '>' +
				options(x.parent, true, true, false).replace('value="' + echappe(x.iri) + '"', 'value="' + echappe(x.iri) + '" disabled') + '</select>';
			h += '<label for="f-comment">Commentaire</label><textarea id="f-comment" rows="3" maxlength="1000"' + off + '>' + echappe(x.comment) + '</textarea>';
		} else {
			h += '<label for="f-domain">Domaine (sujet)</label><select id="f-domain"' + off + '>' + options(x.domain, true, true, false) + '</select>';
			h += '<label for="f-range">Portée (objet)</label><select id="f-range"' + off + '>' + options(x.range, true, true, true) + '</select>';
			h += '<div class="plein astuce" style="margin:0">' + (x.range && litteral(x.range) ? '↪ Propriété de <strong>donnée</strong> : la valeur est un littéral.' : '↪ Propriété <strong>objet</strong> : elle relie deux ressources.') + '</div>';
		}
		h += '</div>';
		var imp = [];
		if (t === 'classe') {
			var fils = E.classes.filter(function (c) { return c.parent === x.iri && !c.supprime; });
			var ps = E.props.filter(function (p) { return !p.supprime && (p.domain === x.iri || p.range === x.iri); });
			if (x.n) imp.push(x.n + ' instance(s) de ce concept (elles ne sont pas supprimées avec lui)');
			if (fils.length) imp.push(fils.length + ' sous-classe(s) : ' + fils.map(function (c) { return echappe(affiche(c)); }).join(', '));
			if (ps.length) imp.push(ps.length + ' propriété(s) l\'utilisent : ' + ps.map(function (p) { return echappe(affiche(p)); }).join(', '));
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
			if (x.nouveau && x.iriAuto) { renomme(x, t, E.espace + unique(slug(x.label || 'element', t === 'classe'), x)); var l = $('#f-local'); if (l) l.value = iriLocale(x); }
			rendLeger();
		});
		champ('#f-local', function (v) {
			var l = v.trim();
			if (!/^[\p{L}\p{N}_-]+$/u.test(l)) { toast('Identifiant : lettres, chiffres, _ et - seulement'); return; }
			var iri = E.espace + l;
			if (iri !== x.iri && (cl(iri) || pr(iri))) { toast('Cet identifiant existe déjà'); return; }
			x.iriAuto = false; renomme(x, t, iri);
		});
		champ('#f-parent', function (v) { x.parent = v; });
		champ('#f-comment', function (v) { x.comment = v; if (x.comment && !x.clang && !x.orig.comment) x.clang = 'fr'; });
		champ('#f-domain', function (v) { x.domain = v; });
		champ('#f-range', function (v) { x.range = v; });
		var b = $('#supprime'); if (b) b.addEventListener('click', function () { supprime(x, t); });
		b = $('#restaure'); if (b) b.addEventListener('click', function () { restaure(x, t); });
	}

	function rendEtat() {
		var n = nbModifs(), e = $('#etat');
		e.textContent = n ? '● ' + n + ' modification' + (n > 1 ? 's' : '') + ' non enregistrée' + (n > 1 ? 's' : '') : 'Aucune modification';
		e.classList.toggle('sale', n > 0);
		$('#b-enreg').disabled = !n || enCours;
	}
	function rendVue() {
		$('#zone-graphe').hidden = vue !== 'graphe';
		$('#zone-liste').hidden = vue !== 'liste';
		$('#v-graphe').classList.toggle('actif', vue === 'graphe');
		$('#v-liste').classList.toggle('actif', vue === 'liste');
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
		E.classes.forEach(function (c) { if (c.parent === ancien) c.parent = iri; });
		E.props.forEach(function (p) { if (p.domain === ancien) p.domain = iri; if (p.range === ancien) p.range = iri; });
		if (E.sel && E.sel.iri === ancien) E.sel.iri = iri;
		x.iri = iri; x.nom = nomDe(iri);
	}
	function nouvelElement(t, label, base) {
		var iri = E.espace + unique(slug(base, t === 'classe'), null);
		var o = { iri: iri, nom: nomDe(iri), label: label, llang: 'fr', nouveau: true, supprime: false, iriAuto: true };
		if (t === 'classe') { o.comment = ''; o.clang = ''; o.parent = ''; o.n = 0; o.decl = true; o.orig = { label: '', comment: '', parent: '' }; E.classes.push(o); }
		else { o.domain = ''; o.range = ''; o.orig = { label: '', domain: '', range: '' }; E.props.push(o); }
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
		if (t === 'classe') {
			E.classes.forEach(function (c) { if (c.parent === x.iri) { casc.push([c, 'parent', c.parent]); c.parent = ''; } });
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
		(x.cascade || []).forEach(function (c) { if (c[0][c[1]] === '') c[0][c[1]] = c[2]; });
		x.cascade = [];
		rend();
	}

	function brouillon() {
		var b = { classes: [], props: [], supprimes: { classes: [], props: [] } };
		E.classes.forEach(function (c) {
			if (c.supprime) { if (!c.nouveau) b.supprimes.classes.push(c.iri); return; }
			if (c.nouveau || modifie(c, 'classe')) b.classes.push({ iri: c.iri, label: c.label, llang: c.llang, comment: c.comment, clang: c.clang, parent: c.parent });
		});
		E.props.forEach(function (p) {
			if (p.supprime) { if (!p.nouveau) b.supprimes.props.push(p.iri); return; }
			if (p.nouveau || modifie(p, 'prop')) b.props.push({ iri: p.iri, label: p.label, llang: p.llang, domain: p.domain, range: p.range });
		});
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
			if (r.ok && r.modele) { charge(r.modele); rend(); toast('💾 Ontologie enregistrée'); return true; }
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
		if (drag) { E.pos[drag.iri] = { x: Math.max(0, p.x - drag.dx), y: Math.max(0, p.y - drag.dy) }; rendGraphe(); }
		else if (lien) {
			var el = document.elementFromPoint(e.clientX, e.clientY), n = el && el.closest && el.closest('[data-cls]');
			lien.x = p.x; lien.y = p.y; lien.cible = n ? n.dataset.cls : null; rendGraphe();
		}
	}
	function up(e) {
		document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up);
		if (drag) { drag = null; return; }
		if (!lien) return;
		var l = lien; lien = null;
		var el = document.elementFromPoint(e.clientX, e.clientY), n = el && el.closest && el.closest('[data-cls]'), dansSvg = el && el.closest && el.closest('#svg-graphe');
		if (l.kind === 'prop') {
			if (n) creeProp(l.de, n.dataset.cls, 'nouvelle relation');
			else if (dansSvg) creeProp(l.de, XSD + 'string', 'nouvel attribut');
			else rendGraphe();
			return;
		}
		if (!n || n.dataset.cls === l.de) { rendGraphe(); if (dansSvg) toast('Lâchez sur un autre concept pour créer « sous-classe de »'); return; }
		if (ancetres(n.dataset.cls).indexOf(l.de) >= 0) { rendGraphe(); toast('⛔ Cycle : un concept ne peut pas descendre de son propre descendant'); return; }
		var c = cl(l.de); c.parent = n.dataset.cls; E.sel = { t: 'classe', iri: c.iri }; rend();
		toast(affiche(c) + ' est maintenant sous-classe de ' + affiche(cl(c.parent)));
	}
	function suit() { document.addEventListener('pointermove', mv); document.addEventListener('pointerup', up); }

	$('#svg-graphe').addEventListener('pointerdown', function (e) {
		if (e.button) return;
		var hd = e.target.closest('.hd'), at = e.target.closest('[data-attr]'), gn = e.target.closest('.gn'), ge = e.target.closest('.ge'), p = pt(e), now = Date.now();
		if (hd) { e.preventDefault(); lien = { de: hd.dataset.cls, kind: hd.dataset.kind, x: p.x, y: p.y, cible: null }; suit(); return; }
		if (at) { E.sel = { t: 'prop', iri: at.dataset.attr }; rend(); return; }
		if (gn) {
			var iri = gn.dataset.cls, dbl = dernier.k === iri && now - dernier.t < 400;
			dernier = { t: now, k: iri };
			E.sel = { t: 'classe', iri: iri }; rend();
			if (dbl) { focusLabel(); return; }
			drag = { iri: iri, dx: p.x - E.pos[iri].x, dy: p.y - E.pos[iri].y }; suit(); return;
		}
		if (ge) { E.sel = { t: ge.dataset.edge, iri: ge.dataset.iri }; rend(); return; }
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
	function rendInstances() {
		var zone = $('#p-instances');
		if (!I) return;
		var total = I.classes.reduce(function (s, c) { return s + c.n; }, 0);
		$('#c-inst').textContent = total;
		var selIri = E.sel && E.sel.t === 'classe' ? E.sel.iri : null;
		if (selIri && selIri !== dernierSel) { ouverts[selIri] = true; dernierSel = selIri; }   // choisir un concept ouvre sa liste
		var h = '<p class="astuce" style="margin-top:0">Les individus de votre copie, par concept. Sélectionnez un concept dans le graphe pour voir les siens.' +
			(I.tronque ? ' <strong>Liste tronquée.</strong>' : '') + '</p>';
		if (!I.classes.length) h += '<p class="astuce">Aucune instance : peuplez-la avec l\'IA (onglet voisin) ou avec <code>INSERT DATA</code>.</p>';
		I.classes.forEach(function (c) {
			var ouvert = !!ouverts[c.iri];
			var nIA = c.items.filter(function (it) { return it.iri && iaIris[it.iri]; }).length;
			h += '<div class="inst-classe' + (c.iri === selIri ? ' sel' : '') + '"><button type="button" class="lien-mini inst-tete" data-ic="' + echappe(c.iri) + '" aria-expanded="' + ouvert + '" style="display:flex;width:100%;justify-content:space-between;font-weight:600;padding:5px 2px">' +
				'<span>' + (ouvert ? '▾ ' : '▸ ') + echappe(c.nom) + (nIA ? ' <span class="badge ia">' + nIA + ' IA</span>' : '') + '</span><span>' + c.n + '</span></button>';
			if (ouvert) {
				c.items.forEach(function (it) {
					var vals = it.props.map(function (p) { return echappe(p.p) + ' = ' + echappe(p.v) + (p.l ? '@' + echappe(p.l) : ''); }).join(' · ');
					h += '<div class="inst' + (it.iri && iaIris[it.iri] ? ' nouveau-ia' : '') + '"><div class="tete"><strong title="' + echappe(it.iri || it.nom) + '">' + echappe(it.titre || it.nom) + '</strong>' +
						(it.iri && iaIris[it.iri] ? '<span class="badge ia">IA</span>' : '') + '</div>' +
						(it.titre ? '<div class="vals">' + echappe(it.nom) + '</div>' : '') + (vals ? '<div class="vals">' + vals + '</div>' : '') + '</div>';
				});
				if (c.plus > 0) h += '<div class="inst-plus">… et ' + c.plus + ' autre' + (c.plus > 1 ? 's' : '') + ' non affichée' + (c.plus > 1 ? 's' : '') + '</div>';
			}
			h += '</div>';
		});
		zone.innerHTML = h;
	}

	function ouvreOnglet(o) {
		document.querySelectorAll('.onglets button').forEach(function (b) { b.classList.toggle('actif', b.dataset.onglet === o); });
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
		if (!propositions || !propositions.liste.length) { z.innerHTML = ''; return; }
		var h = '<div class="ligne"><strong>' + propositions.liste.length + ' proposition(s)</strong><button type="button" class="lien-mini" id="tout-cocher">tout cocher</button></div>';
		propositions.liste.forEach(function (p, k) {
			h += '<label><input type="checkbox" data-p="' + p.i + '" checked> <span><strong>' +
				(p.genre === 'nouveau' ? 'Créer ' + echappe(p.cible) + ' « ' + echappe(p.titre) + ' »' : 'Compléter ' + echappe(p.cible)) + '</strong>' +
				(p.detail.length ? '<span class="detail">' + p.detail.map(echappe).join(' · ') + '</span>' : '') + '</span></label>';
		});
		var n = nbModifs();
		h += '<div class="boutons"><button type="button" class="btn vert" id="accepte">➕ Ajouter les propositions cochées</button></div>' +
			(n ? '<p class="astuce">Vos ' + n + ' modification(s) de l\'ontologie seront enregistrées en même temps : les données ne sont jamais ajoutées sans l\'ontologie qui les décrit.</p>' : '');
		z.innerHTML = h;
	}
	function genere() {
		var mode = document.querySelector('input[name=mode]:checked').value;
		if (mode === 'cible' && !modifies().length) { message("<p class='statut ko'>❌ Aucune modification de l'ontologie à viser : modifiez d'abord un concept ou une propriété, ou choisissez le peuplement général.</p>"); return; }
		var bouton = $('#generer');
		bouton.disabled = true;
		message("<p class='astuce'>⏳ L'IA prépare des propositions (cela peut prendre une demi-minute)…</p>");
		$('#propositions').innerHTML = '';
		appel('ia_peupler', { mode: mode, quantite: $('#quantite').value, consigne: $('#consigne').value, brouillon64: base64(JSON.stringify(brouillon())) }).then(function (r) {
			bouton.disabled = false;
			if (!r.ok) { message(r.html); return; }
			message("<p class='statut ok'>✨ " + r.propositions.length + " proposition(s) de l'IA (" + echappe(r.modele) + ") : relisez-les avant de les ajouter ; elles peuvent contenir des erreurs.</p>");
			propositions = { jeton: r.jeton, liste: r.propositions.map(function (p, i) { p.i = i; return p; }) };
			rendPropositions();
		});
	}
	function accepte() {
		var cochees = [].slice.call(document.querySelectorAll('#propositions input[data-p]:checked')).map(function (c) { return c.dataset.p; });
		if (!cochees.length) { toast('Cochez au moins une proposition'); return; }
		var bouton = $('#accepte'); bouton.disabled = true; enCours = true; rendEtat();
		appel('ia_ajouter', { jeton: propositions.jeton, indices: cochees.join(','), brouillon64: base64(JSON.stringify(brouillon())) }).then(function (r) {
			enCours = false;
			message(r.html);
			if (!r.ok) { bouton.disabled = false; rendEtat(); return; }
			(r.sujets || []).forEach(function (s) { iaIris[s] = true; });
			propositions.liste = propositions.liste.filter(function (p) { return cochees.indexOf(String(p.i)) < 0; });
			if (r.modele) charge(r.modele);
			rend(); rendPropositions();
			chargeInstances().then(function () { toast('✨ ' + cochees.length + ' élément(s) ajouté(s) à l\'instance'); ouvreOnglet('instances'); });
		});
	}

	//--------------------------------------------------------------------------
	// Boutons, clavier, sortie
	//--------------------------------------------------------------------------
	document.addEventListener('click', function (e) {
		var n = e.target.closest('[data-t]');
		if (n) { E.sel = { t: n.dataset.t, iri: n.dataset.iri }; rend(); return; }
		var o = e.target.closest('[data-onglet]');
		if (o) { ouvreOnglet(o.dataset.onglet); return; }
		var ic = e.target.closest('[data-ic]');
		if (ic) { ouverts[ic.dataset.ic] = !ouverts[ic.dataset.ic]; rendInstances(); return; }
		var id = e.target.id;
		if (id === 'generer') genere();
		else if (id === 'accepte') accepte();
		else if (id === 'tout-cocher') document.querySelectorAll('#propositions input[data-p]').forEach(function (c) { c.checked = true; });
		else if (id === 'add-classe') creeConcept();
		else if (id === 'add-prop') creeProp('', XSD + 'string', 'nouvelle propriété');
		else if (id === 'v-graphe') { vue = 'graphe'; rendVue(); }
		else if (id === 'v-liste') { vue = 'liste'; rendVue(); }
		else if (id === 'reorg') { E.pos = {}; dispose(); rendGraphe(); }
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
	document.addEventListener('keydown', function (e) {
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
