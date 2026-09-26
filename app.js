'use strict';

/* Le détour des camions : site statique de plusieurs pages, données dans data/donnees.json (voir build_data.py). */

const SEUILS = [-25, -15, -5, 5, 15, 25];           // classes du détour (km), divergentes autour de 0
const HEURES = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
const CHARGE_DOSSIER = 2500 * 0.20 / 28;             // t par camion : barge de 2 500 m³ × 0,20 t/m³ ÷ 28 camions
const REFERENCE_NORD = 'IDF1';                       // Val'Pôle Plessis-Gassot (95)
const MOINS = '−';

const nf1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const espace = s => s.replace(/ /g, ' ');   // espace insécable normale, plus lisible que l'espace fine
const fmt1 = v => espace(nf1.format(v)).replace('-', MOINS);
const fmt0 = v => espace(nf0.format(v)).replace('-', MOINS);
const signe1 = v => (v > 0 ? '+' : v < 0 ? MOINS : '') + espace(nf1.format(Math.abs(v)));
const signe0 = v => (v > 0 ? '+' : v < 0 ? MOINS : '') + espace(nf0.format(Math.abs(v)));
const arrondi = (v, pas) => Math.round(v / pas) * pas;
const mediane = arr => {
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/* Construction de DOM sans innerHTML pour les textes venant des données */
function el(tag, attrs, ...enfants) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'style') n.style.cssText = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const e of enfants.flat(Infinity)) {
    if (e === null || e === undefined || e === false) continue;
    n.append(e instanceof Node ? e : document.createTextNode(String(e)));
  }
  return n;
}
const lien = (source) => el('a', { href: source.url, target: '_blank', rel: 'noopener' }, source.texte);
const cssVar = nom => getComputedStyle(document.documentElement).getPropertyValue(nom).trim();

function melange(a, b, t) {   // t = part de a
  const p = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const [ca, cb] = [p(a), p(b)];
  return '#' + ca.map((v, i) => Math.round(v * t + cb[i] * (1 - t)).toString(16).padStart(2, '0')).join('');
}
function couleursDivergentes() {
  const bleu = cssVar('--div-bleu'), rouge = cssVar('--div-rouge'), milieu = cssVar('--div-milieu');
  return [bleu, melange(bleu, milieu, 0.65), melange(bleu, milieu, 0.35), milieu,
          melange(rouge, milieu, 0.35), melange(rouge, milieu, 0.65), rouge];
}
const classe = det => SEUILS.filter(s => det >= s).length;

function decoder(enc) {
  const pts = []; let i = 0, lat = 0, lon = 0;
  while (i < enc.length) {
    for (const k of [0, 1]) {
      let r = 0, s = 0, b;
      do { b = enc.charCodeAt(i++) - 63; r |= (b & 0x1f) << s; s += 5; } while (b >= 0x20);
      const d = r & 1 ? ~(r >> 1) : r >> 1;
      if (k === 0) lat += d; else lon += d;
    }
    pts.push([lat / 1e5, lon / 1e5]);
  }
  return pts;
}

function urlGoogleMaps(orig, dest, passages) {
  const p = new URLSearchParams({ api: '1', origin: `${orig.lat},${orig.lon}`,
    destination: `${dest.lat},${dest.lon}`, travelmode: 'driving' });
  if (passages && passages.length) p.set('waypoints', passages.map(w => `${w.lat},${w.lon}`).join('|'));
  return 'https://www.google.com/maps/dir/?' + p.toString();
}

(async function principal() {
  // Chaque page déclare son nom dans <body data-page="…"> ; seul le code de cette page s'exécute.
  const page = document.body.dataset.page;
  let D;
  try {
    D = await fetch('data/donnees.json').then(r => r.json());
  } catch (e) {
    document.querySelector('main').prepend(el('p', { class: 'conteneur encadre' },
      'Les données n\'ont pas pu être chargées. Ouvrez la page via un serveur web (voir le README).'));
    return;
  }
  const M = D.meta, F = D.faits;
  const V = M.destinations.VITRY, R = M.destinations.RIS, PP = M.points_passage, GM = M.grille_masque;
  const PASSAGES = {
    ACCES_D310: { court: 'D310', long: 'D310 à Grigny, dans le sens A6 → RN7' },
    N104_EST: { court: 'RN104 est', long: 'RN104, branche est (Tigery), dans le sens vers l\'A6' },
    N104_OUEST: { court: 'RN104 ouest', long: 'RN104, branche ouest (Bondoufle), dans le sens vers l\'A6' },
  };
  const urlDossier = F.tonnage.source.url.split('#')[0];
  const pageDuDossier = n => ({ texte: `Dossier de concertation, p. ${n}`, url: `${urlDossier}#page=${Math.floor(n / 2) + 1}` });
  const forfaitRis = `${fmt1(R.forfait_m / 1000)} km`;
  const parId = Object.fromEntries(D.points.map(p => [p.id, p]));
  const cleVariante = v => (v === 'acces' ? 'acces_impose' : 'dossier');
  const detour = (p, v) => p.km[cleVariante(v)] - p.km.vitry;
  const categorie = p => p.couche === 'entree' ? 'entree'
    : p.details.startsWith('producteur CSR') ? 'site-confirme' : 'site-possible';
  const nomCourt = p => p.nom.split(' - ')[0].split(' (')[0];
  const passagesVariante = (p, v) => {
    if (v === 'acces') return [M.points_passage.ACCES_D310];
    if (v === 'rapide') return [];
    const branche = (p.branche_dossier || 'impose_est').split('_')[1].toUpperCase();
    return [M.points_passage['N104_' + branche], M.points_passage.ACCES_D310];
  };
  const tempsMedian = (p, cle) => p.previsions.length ? mediane(p.previsions.map(c => c[cle])) : null;
  const ecartHeure = (p, cle, h) => {
    const c = p.previsions.filter(x => +x.t.slice(11, 13) === h);
    return c.length ? mediane(c.map(x => x[cle] - x.vitry)) : null;
  };
  const camionsAn = (tonnage, charge) => tonnage / charge;
  const lier = (cle, texte) => document.querySelectorAll(`[data-lie="${cle}"]`).forEach(n => { n.textContent = texte; });
  const ref = parId[REFERENCE_NORD];
  const camionsDossier = camionsAn(F.tonnage.valeur, CHARGE_DOSSIER);

  const PAGES = { essentiel, dossier: confrontation, itineraires, carte: carteDuDetour, heures: heureParHeure, annee: surUneAnnee, methode };
  const recolorer = PAGES[page] ? PAGES[page]() : null;
  // Recolorer si le thème du système change
  if (recolorer) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', recolorer);

  /* ---------------- L'essentiel ---------------- */
  function essentiel() {
    lier('hero-km', signe0(detour(ref, 'acces')) + ' km');
    lier('tuile-dossier', signe0(detour(ref, 'dossier')) + ' km');
    lier('tuile-min', signe0(ref.ecart_min_median.acces) + ' min');
    lier('tuile-camions', '≈ ' + fmt0(arrondi(camionsDossier, 100)));
  }

  /* ---------------- Le dossier et les données ---------------- */
  function confrontation() {
    const au8 = ecartHeure(ref, 'acces', 8), au17 = ecartHeure(ref, 'acces', 17);
    const cellulesNord = D.grille.filter(g => g[0] > V.lat);
    const cellulesSud = D.grille.filter(g => g[0] < R.lat);
    const part = (cells, test) => Math.round(100 * cells.filter(test).length / cells.length);
    const kmParKmDetour = 2 * camionsDossier;
    const cartes = [
      { titre: 'Les bouchons de l\'A86', dit: [F.congestion],
        montre: [`Depuis le Plessis-Gassot, le trajet vers Ris-Orangis reste plus long que vers Vitry, même aux heures de pointe : ${signe0(au8)} min à 8 h et ${signe0(au17)} min à 17 h (médianes de la semaine du 28 septembre, prévisions Google en voiture). Le détail est sur la page `,
          el('a', { href: 'heures.html' }, 'Heure par heure'), '.'] },
      { titre: 'L\'itinéraire imposé', dit: [F.itineraire, F.traversee],
        montre: [`Cet itinéraire rallonge encore le trajet : ${signe0(detour(ref, 'dossier'))} km depuis le Plessis-Gassot, contre ${signe0(detour(ref, 'acces'))} km si l'on respecte seulement l'accès final. Sans point de passage imposé, Google ferait passer les camions par la RN7, dans Ris-Orangis. Voir `,
          el('a', { href: 'itineraires.html' }, 'les règles des itinéraires'), '.'] },
      { titre: 'Le nombre de camions', dit: [F.camions_texte],
        montre: `Le graphique de la même page monte à ${F.graphique_2035.valeurs[0]} camions par jour en janvier 2035. Avec les chiffres du dossier (une barge de 2 500 m³ équivaut à 28 camions ; densité de 0,20 t/m³), on obtient ${fmt1(CHARGE_DOSSIER)} t par camion, soit environ ${fmt0(arrondi(camionsDossier, 100))} camions par an.`,
        sourcesMontre: [F.graphique_2035.source, F.barge.source] },
      { titre: 'Le choix de Ris-Orangis', dit: [F.foncier],
        montre: `La parcelle EDF de Vitry fait 38 ha, dont 6,7 ha pour la chaufferie. Ce que ce choix coûte en kilomètres n'est chiffré nulle part. Or, avec ${fmt0(arrondi(camionsDossier, 100))} camions par an, chaque kilomètre de détour moyen représente environ ${fmt0(arrondi(kmParKmDetour, 100))} km de plus par an, aller et retour.`,
        sourcesMontre: [F.parcelle.source, F.transport_absent.source] },
      { titre: 'L\'origine du combustible', dit: [F.fournisseurs, F.nord],
        montre: ['La ', el('a', { href: 'carte.html' }, 'carte du détour'), ` donne le résultat pour toutes les origines possibles. Avec l'accès final imposé, Ris-Orangis est plus loin que Vitry pour ${part(cellulesNord, g => g[5] - g[3] > 0)} % des points situés au nord de Vitry, et plus proche pour ${part(cellulesSud, g => g[5] - g[3] < 0)} % des points situés au sud de Ris-Orangis.`] },
    ];
    document.getElementById('cartes-confrontation').replaceChildren(...cartes.map(c => el('article', { class: 'carte-conf' },
      el('h2', {}, c.titre),
      el('div', { class: 'conf-dit' }, el('span', { class: 'conf-etiquette' }, 'Le maître d\'ouvrage dit'),
        c.dit.map(f => el('div', {}, el('blockquote', {}, `« ${f.citation} »`),
          el('div', { class: 'conf-source' }, '— ', lien(f.source))))),
      el('div', { class: 'conf-montre' }, el('span', { class: 'conf-etiquette' }, 'Les données montrent'),
        el('p', { style: 'margin:0' }, c.montre),
        c.sourcesMontre ? el('div', { class: 'conf-source' }, 'Sources : ',
          c.sourcesMontre.map((s, i) => [i ? ' ; ' : '', lien(s)])) : null))));
  }

  /* ---------------- Les règles des itinéraires ---------------- */
  function itineraires() {
    const citer = f => el('div', { class: 'regle-citation' }, el('blockquote', {}, `« ${f.citation} »`),
      el('div', { class: 'conf-source' }, '— ', lien(f.source)));
    const pointPassage = k => [el('strong', {}, PASSAGES[k].long), ` (${PP[k].lat}, ${PP[k].lon}), `,
      el('a', { href: `carte.html#passage=${k}` }, 'voir sur la carte')];
    const rapideHorsD310 = D.points.filter(p => p.conforme.rapide && p.conforme.rapide !== 'oui').length;
    const entreeA6 = parId.E_A6;
    const regles = [
      { titre: 'Vers Vitry', couleur: '--serie-1', badge: 'aucune règle',
        lignes: [
          ['La règle', 'Aucune. Le dossier ne prévoit pas de livraison par camion à Vitry : il n\'y définit donc pas d\'itinéraire.'],
          ['Dans le calcul', 'Le trajet le plus rapide selon Google, sans point de passage, jusqu\'à l\'entrée du site EDF rue des Fusillés (', lien(pageDuDossier(50)), ').']] },
      { titre: 'Vers Ris-Orangis, le plus rapide', couleur: null, badge: 'non autorisé',
        lignes: [
          ['La règle', 'Aucune : c\'est le trajet que Google choisirait sans contrainte.'],
          ['Pourquoi il n\'est pas retenu', `Il ne respecte pas l'accès final décrit par le maître d'ouvrage : sur les ${D.points.length} origines détaillées, il ne passe pas par la D310 dans ${rapideHorsD310} cas.`],
          ['Dans le calcul', 'Il sert seulement de repère. Il figure dans le détail de chaque point et dans les fichiers téléchargeables.']] },
      { titre: 'Accès final imposé', couleur: '--serie-2', badge: 'hypothèse la plus favorable au projet',
        lignes: [
          ['La règle', 'Sur le trajet terminal : l\'A6, puis la D310 jusqu\'à la RN7 à Grigny, moins de 1 km sur la RN7, puis le Chemin Latéral, sans traverser Ris-Orangis.'],
          ['Les sources', citer(F.acces_final), citer(F.trajet_terminal), citer(F.traversee)],
          ['Dans le calcul', 'Un point de passage obligé : ', pointPassage('ACCES_D310'), `. Avant ce point, Google choisit librement le trajet le plus rapide. Chaque tracé obtenu est contrôlé : il passe à moins de ${M.controle.tolerance_m} m de ce point.`],
          ['Pourquoi c\'est l\'hypothèse la plus favorable au projet', 'Elle n\'impose pas la RN104. Chaque camion rejoint l\'A6 par le chemin le plus rapide, y compris par l\'A6 depuis Paris, que la carte des itinéraires du dossier trace aussi (', lien(F.carte_itineraires.source), ').']] },
      { titre: 'Itinéraire du dossier', couleur: '--serie-3', badge: 'texte du dossier',
        lignes: [
          ['La règle', 'Passer par la RN104 (la Francilienne), puis suivre l\'accès final imposé : A6, D310, RN7 et Chemin Latéral.'],
          ['Les sources', citer(F.rn104), citer(F.trajet_terminal)],
          ['Dans le calcul', 'Deux points de passage obligés. D\'abord la RN104, soit ', pointPassage('N104_EST'), ', soit ', pointPassage('N104_OUEST'),
            ' ; puis le point de la D310. Avant la RN104, Google choisit librement le trajet le plus rapide. Les deux branches sont mesurées, et la plus courte est retenue.'],
          ['Limite', `La règle ne dit pas par où rejoindre la RN104. Google prend le trajet le plus rapide qui passe par le point imposé, dans le sens imposé, même si cela suppose un demi-tour sur la RN104 ; c'est le cas pour des origines situées au nord comme au sud. Depuis l'entrée de l'A6 en Île-de-France (Égreville), le détour atteint ainsi ${signe1(entreeA6.km.dossier - entreeA6.km.acces_impose)} km par rapport à l'accès final imposé. C'est pourquoi le site retient l'accès final imposé comme hypothèse principale.`]] },
    ];
    document.getElementById('regles-itineraires').replaceChildren(...regles.map(r => el('article', { class: 'regle' },
      el('div', { class: 'regle-tete' },
        el('span', { class: r.couleur ? 'cle-ligne' : 'cle-ligne cle-neutre', style: r.couleur ? `background:var(${r.couleur})` : null }),
        el('h2', {}, r.titre), el('span', { class: 'badge' }, r.badge)),
      el('dl', { class: 'regle-liste' }, r.lignes.map(([titre, ...contenu]) => [el('dt', {}, titre), el('dd', {}, contenu)])))));
    document.getElementById('regles-opposable').replaceChildren(
      'Pour le maître d\'ouvrage, c\'est leur inscription dans l\'arrêté préfectoral qui rendrait ces itinéraires opposables : « ',
      F.opposable.citation, ' » (', lien(F.opposable.source), '). Pour les trois itinéraires, Google calcule le trajet jusqu\'à l\'entrée du Chemin Latéral ; les ',
      forfaitRis, ' restants jusqu\'au portail des camions sont ajoutés à chaque distance (', lien(pageDuDossier(55)), ').');
  }

  /* ---------------- La carte du détour ---------------- */
  function carteDuDetour() {
    const etat = { variante: 'acces', selection: null, carre: null };
    let carte = null, calqueTrajets = null, calquePassages = null;
    const rectangles = [], marqueursPassage = {};
    const legendeGrille = document.getElementById('legende-grille');
    const detail = document.getElementById('detail-point');
    const btnRetour = document.getElementById('btn-retour');
    const cadre = document.querySelector('.carte-cadre');

    function dessinerLegende() {
      const cols = couleursDivergentes();
      const W = 300, H = 46, w = W / 7;
      const ns = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(ns, 'svg');
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', 'Légende : de plus de 25 km en moins (bleu) à plus de 25 km en plus (rouge)');
      svg.style.width = '100%';
      cols.forEach((c, i) => {
        const r = document.createElementNS(ns, 'rect');
        Object.entries({ x: i * w + 1, y: 0, width: w - 2, height: 16, rx: 3, fill: c }).forEach(([k, v]) => r.setAttribute(k, v));
        svg.append(r);
      });
      SEUILS.forEach((s, i) => {
        const t = document.createElementNS(ns, 'text');
        Object.entries({ x: (i + 1) * w, y: 32, 'text-anchor': 'middle', class: 'axe-texte' }).forEach(([k, v]) => t.setAttribute(k, v));
        t.textContent = (s > 0 ? '+' : s < 0 ? MOINS : '') + Math.abs(s);
        svg.append(t);
      });
      legendeGrille.replaceChildren(
        el('h2', {}, 'Kilomètres en plus pour livrer Ris-Orangis plutôt que Vitry, par trajet'),
        svg,
        el('div', { class: 'legende-div-titres' }, el('span', {}, '← Ris-Orangis plus proche'), el('span', {}, 'Ris-Orangis plus loin →')),
        el('p', { class: 'note', style: 'margin:6px 0 0' },
          etat.variante === 'acces' ? 'Itinéraire : accès final imposé (A6 → D310 → RN7 → Chemin Latéral).'
            : 'Itinéraire : celui du dossier (RN104 → A6 → D310 → RN7 → Chemin Latéral).'));
    }
    document.getElementById('legende-points').replaceChildren(
      el('ul', { class: 'legende-points' },
        el('li', {}, el('span', { class: 'pastille site-confirme' }), 'Producteur de CSR (sourcé)'),
        el('li', {}, el('span', { class: 'pastille site-possible' }), 'Grand centre de tri de déchets d\'activités (production de CSR non établie)'),
        el('li', {}, el('span', { class: 'pastille entree' }), 'Entrée d\'autoroute en Île-de-France'),
        el('li', {}, el('span', { class: 'pastille passage-point' }),
          el('span', {}, 'Point de passage obligé de l\'itinéraire choisi (', el('a', { href: 'itineraires.html' }, 'voir les règles'), ')'))));
    lier('grille-masque', `Les ${GM.en_mer + GM.royaume_uni} carrés dont le centre est en mer ou au Royaume-Uni ne sont pas affichés`);

    // Encadré en haut du panneau : détail du carré ou du point de passage cliqué (aucune bulle sur la carte)
    const encart = document.getElementById('encart');
    const panneauVide = document.getElementById('panneau-vide');
    const majPanneau = () => { panneauVide.hidden = !encart.hidden || !detail.hidden; };
    const teteEncart = titre => el('div', { class: 'encart-tete' }, el('h2', {}, titre),
      el('button', { type: 'button', class: 'encart-fermer', onclick: () => fermerEncart() }, 'Fermer'));
    function marquerCarre(rect) {
      if (etat.carre) etat.carre.rect.setStyle({ stroke: false });
      if (rect) rect.setStyle({ stroke: true, color: cssVar('--encre'), weight: 2.5, opacity: 1 });
    }
    function montrerEncart(defiler, ...contenu) {
      encart.replaceChildren(...contenu);
      encart.hidden = false;
      majPanneau();
      if (defiler) encart.scrollIntoView({ block: 'nearest' });
    }
    function fermerEncart() {
      marquerCarre(null);
      etat.carre = null;
      encart.hidden = true;
      majPanneau();
    }
    function afficherCarre(g, rect, defiler = true) {
      marquerCarre(rect);
      etat.carre = { g, rect };
      const orig = { lat: g[0], lon: g[1] };
      const branche = g[7] || 'est';
      const cellule = { branche_dossier: 'impose_' + branche };
      const det = (etat.variante === 'acces' ? g[5] : g[6]) - g[3];
      const ligne = (couleur, libelle, etapes, kmVal, ecart, url) => el('tr', {},
        el('td', {}, couleur ? el('span', { class: 'cle-ligne', style: `background:var(${couleur})` }) : null, libelle, el('span', { class: 'etapes' }, etapes)),
        el('td', { class: 'nombre' }, `${fmt1(kmVal)} km`),
        el('td', { class: 'nombre' }, ecart != null ? `${signe1(ecart)} km` : '—'),
        el('td', {}, el('a', { class: 'verifier', href: url, target: '_blank', rel: 'noopener' }, 'Vérifier')));
      montrerEncart(defiler,
        teteEncart('Carré sélectionné'),
        el('p', { class: 'detail-sous' }, `Point de départ de la grille (un point tous les ${g[2]} km), centre : ${g[0]}, ${g[1]}`),
        el('p', { class: 'encart-valeur' }, `${signe1(det)} km`),
        el('p', { class: 'detail-sous' }, `pour livrer Ris-Orangis plutôt que Vitry, avec ${etat.variante === 'acces' ? 'l\'accès final imposé' : `l'itinéraire du dossier (RN104 ${branche})`}`),
        el('table', { class: 'trajets' },
          el('thead', {}, el('tr', {}, el('th', {}, 'Trajet'), el('th', { class: 'nombre' }, 'Distance'), el('th', { class: 'nombre' }, 'Écart'), el('th', {}, ''))),
          el('tbody', {},
            ligne('--serie-1', 'Vitry', 'sans point de passage', g[3], null, urlGoogleMaps(orig, V)),
            ligne('--serie-2', 'Ris-Orangis, accès final imposé', 'étape : D310', g[5], g[5] - g[3], urlGoogleMaps(orig, R, passagesVariante(cellule, 'acces'))),
            ligne('--serie-3', 'Ris-Orangis, itinéraire du dossier', `étapes : RN104 ${branche}, puis D310`, g[6], g[6] - g[3], urlGoogleMaps(orig, R, passagesVariante(cellule, 'dossier'))))),
        el('p', { class: 'note' }, `« Vérifier » ouvre Google Maps avec les mêmes points de passage, sous forme d'étapes. Google Maps s'arrête à l'entrée du Chemin Latéral : ajoutez ${forfaitRis} jusqu'au portail.`));
    }
    function afficherPassage(k) {
      marquerCarre(null);
      etat.carre = null;
      montrerEncart(true,
        teteEncart('Point de passage obligé'),
        el('p', { style: 'margin:0 0 4px' }, el('strong', {}, PASSAGES[k].long)),
        el('p', { class: 'detail-sous' }, `${PP[k].lat}, ${PP[k].lon}`),
        el('p', { style: 'margin:0' }, k === 'ACCES_D310'
          ? 'Imposé par l\'accès final imposé et par l\'itinéraire du dossier.'
          : 'Imposé par l\'itinéraire du dossier, qui passe par la branche est ou ouest de la RN104 (la plus courte des deux).',
          ' ', el('a', { href: 'itineraires.html' }, 'Voir les règles des itinéraires'), '.'));
    }

    function styleGrille() {
      const cols = couleursDivergentes();
      const opacite = etat.selection ? 0 : 0.8;
      rectangles.forEach(({ rect, g }) => {
        const kmRis = etat.variante === 'acces' ? g[5] : g[6];
        rect.setStyle({ fillColor: cols[classe(kmRis - g[3])], fillOpacity: opacite });
      });
    }

    function initialiserCarte() {
      if (!window.L) {
        document.getElementById('map').replaceChildren(el('p', { class: 'carte-indisponible' },
          'La carte n\'a pas pu être chargée. Les données restent consultables dans les tableaux et en téléchargement.'));
        return;
      }
      carte = L.map('map', { preferCanvas: true, minZoom: 6, maxZoom: 16 }).setView([48.72, 2.42], 9);
      L.tileLayer('https://data.geopf.fr/wmts?REQUEST=GetTile&SERVICE=WMTS&VERSION=1.0.0&STYLE=normal&TILEMATRIXSET=PM&FORMAT=image/png&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}', {
        attribution: '© <a href="https://www.ign.fr/">IGN</a> – Géoplateforme · itinéraires : Google', maxZoom: 18 }).addTo(carte);

      const calqueGrille = L.layerGroup().addTo(carte);
      for (const g of D.grille) {
        const [lat, lon, pas] = g;
        const dLat = (pas * 0.46) / 110.54, dLon = (pas * 0.46) / (111.32 * Math.cos(lat * Math.PI / 180));
        const rect = L.rectangle([[lat - dLat, lon - dLon], [lat + dLat, lon + dLon]], { stroke: false, fillOpacity: 0.8 });
        rect.on('click', () => { if (!etat.selection) afficherCarre(g, rect); });   // grille masquée pendant l'affichage d'un site
        rect.addTo(calqueGrille);
        rectangles.push({ rect, g });
      }
      styleGrille();
      calqueTrajets = L.layerGroup().addTo(carte);

      for (const [cle, nom] of [['VITRY', 'Vitry'], ['RIS', 'Ris-Orangis']]) {
        const d = M.destinations[cle];
        L.marker([d.lat, d.lon], { interactive: false, zIndexOffset: 1000,
          icon: L.divIcon({ className: '', html: `<span class="etiquette-dest">${nom}</span>`, iconSize: [0, 0] }) }).addTo(carte);
      }
      calquePassages = L.layerGroup().addTo(carte);
      for (const [k, texte] of Object.entries(PASSAGES)) {
        marqueursPassage[k] = L.marker([PP[k].lat, PP[k].lon], { keyboard: true, zIndexOffset: 500,
          icon: L.divIcon({ className: '', html: `<span class="passage"><span class="passage-point"></span>${texte.court}</span>`, iconSize: [0, 0] }) })
          .on('click', () => afficherPassage(k));
      }
      majPassages();
      for (const p of D.points) {
        const m = L.marker([p.lat, p.lon], { keyboard: true,
          icon: L.divIcon({ className: '', html: `<div class="marqueur ${categorie(p)}"></div>`, iconSize: [12, 12], iconAnchor: [6, 6] }) });
        m.on('click', () => selectionner(p.id, true));
        m.addTo(carte);
        m.getElement().setAttribute('aria-label', p.nom);   // nom lu par les lecteurs d'écran, sans infobulle au survol
      }
      document.getElementById('btn-ile-de-france').addEventListener('click', () => carte.setView([48.72, 2.42], 9));
      document.getElementById('btn-300km').addEventListener('click', () => carte.setView([48.79, 2.42], 7));
      btnRetour.addEventListener('click', () => selectionner(null));
    }

    function dessinerTrajets(p) {
      calqueTrajets.clearLayers();
      const surface = cssVar('--surface');
      const series = [['vitry', cssVar('--serie-1')], ['acces_impose', cssVar('--serie-2')], [p.branche_dossier, cssVar('--serie-3')]];
      const limites = [];
      for (const [cle, couleur] of series.reverse()) {
        if (!p.traces[cle]) continue;
        const pts = decoder(p.traces[cle]);
        limites.push(...pts);
        L.polyline(pts, { color: surface, weight: 7, opacity: 0.9, interactive: false }).addTo(calqueTrajets);
        L.polyline(pts, { color: couleur, weight: 3.5, opacity: 1, lineJoin: 'round', lineCap: 'round', interactive: false }).addTo(calqueTrajets);
      }
      if (limites.length) carte.fitBounds(L.latLngBounds(limites), { padding: [30, 30] });
    }

    // Points de passage affichés : ceux de l'itinéraire choisi, ou ceux des trajets du point sélectionné
    function majPassages() {
      if (!calquePassages) return;
      const p = etat.selection ? parId[etat.selection] : null;
      const cles = p ? ['ACCES_D310', p.branche_dossier === 'impose_ouest' ? 'N104_OUEST' : 'N104_EST']
        : etat.variante === 'acces' ? ['ACCES_D310'] : ['N104_EST', 'N104_OUEST', 'ACCES_D310'];
      calquePassages.clearLayers();
      cles.forEach(k => marqueursPassage[k].addTo(calquePassages));
    }

    // Lien carte.html#passage=N104_OUEST (depuis la page des règles) : centre la carte sur un point de passage
    function montrerPassage(k) {
      if (!carte) return;
      if (etat.selection) selectionner(null);
      if (k !== 'ACCES_D310' && etat.variante !== 'dossier') choisirVariante('dossier');
      cadre.scrollIntoView({ block: 'nearest' });
      carte.setView([PP[k].lat, PP[k].lon], 13);
      afficherPassage(k);
    }

    function remplirDetail(p) {
      const ligne = (couleur, libelle, kmVal, det, minutes, url) => el('tr', {},
        el('td', {}, couleur ? el('span', { class: 'cle-ligne', style: `background:${couleur}` }) : null, libelle),
        el('td', { class: 'nombre' }, kmVal != null ? `${fmt1(kmVal)} km` : '—'),
        el('td', { class: 'nombre' }, det != null ? `${signe1(det)} km` : '—'),
        el('td', { class: 'nombre' }, minutes != null ? `${fmt0(minutes)} min` : '—'),
        el('td', {}, url ? el('a', { class: 'verifier', href: url, target: '_blank', rel: 'noopener' }, 'Vérifier') : null));
      const orig = { lat: p.lat, lon: p.lon };
      detail.replaceChildren(
        el('p', { class: 'detail-titre' }, p.nom),
        el('p', { class: 'detail-sous' }, p.details, ' · ', p.source.startsWith('http')
          ? el('a', { href: p.source, target: '_blank', rel: 'noopener' }, 'source') : el('a', { href: 'methode.html' }, 'source')),
        el('table', { class: 'trajets' },
          el('thead', {}, el('tr', {}, el('th', {}, 'Trajet'), el('th', { class: 'nombre' }, 'Distance'),
            el('th', { class: 'nombre' }, 'Écart'), el('th', { class: 'nombre' }, 'Temps*'), el('th', {}, ''))),
          el('tbody', {},
            ligne(cssVar('--serie-1'), 'Vitry', p.km.vitry, null, tempsMedian(p, 'vitry'), urlGoogleMaps(orig, V)),
            ligne(cssVar('--serie-2'), 'Ris-Orangis, accès final imposé', p.km.acces_impose, detour(p, 'acces'), tempsMedian(p, 'acces'), urlGoogleMaps(orig, R, passagesVariante(p, 'acces'))),
            ligne(cssVar('--serie-3'), `Ris-Orangis, itinéraire du dossier (RN104 ${p.branche_dossier === 'impose_ouest' ? 'ouest' : 'est'})`, p.km.dossier, detour(p, 'dossier'), tempsMedian(p, 'dossier'), urlGoogleMaps(orig, R, passagesVariante(p, 'dossier'))),
            ligne(null, 'Ris-Orangis, le plus rapide (non autorisé)', p.km.rapide, p.km.rapide - p.km.vitry, null, urlGoogleMaps(orig, R)))),
        el('p', { class: 'note' }, `* Temps médian prévu par Google en voiture, jours ouvrés de 8 h à 20 h. Les distances vers Ris-Orangis vont jusqu'au portail : Google Maps s'arrête à l'entrée du Chemin Latéral, il faut donc ajouter ${forfaitRis}. « Vérifier » transmet à Google Maps les mêmes points de passage, sous forme d'étapes.`),
        p.previsions.length ? el('a', { class: 'segment', href: `heures.html#point=${p.id}` }, 'Voir heure par heure') : null);
    }

    function selectionner(id, depuisCarte) {
      etat.selection = id;
      const p = id ? parId[id] : null;
      legendeGrille.hidden = !!p;   // la grille est masquée pendant l'affichage des trajets d'un site
      detail.hidden = !p;
      majPanneau();
      btnRetour.hidden = !p;
      if (carte) {
        styleGrille();
        majPassages();
        if (p) dessinerTrajets(p); else calqueTrajets.clearLayers();
      }
      if (p) { fermerEncart(); remplirDetail(p); }
      if (p && !depuisCarte) cadre.scrollIntoView({ block: 'nearest' });
      // Lien partageable : carte.html#point=IDF1 ouvre directement les trajets de ce point
      if (p) history.replaceState(null, '', '#point=' + p.id);
      else if (location.hash.startsWith('#point=')) history.replaceState(null, '', location.pathname + location.search);
    }

    function choisirVariante(v) {
      etat.variante = v;
      document.querySelectorAll('.segment[data-variante]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.variante === v)));
      dessinerLegende();
      styleGrille();
      majPassages();
      if (etat.carre) afficherCarre(etat.carre.g, etat.carre.rect, false);
    }
    document.querySelectorAll('.segment[data-variante]').forEach(b => b.addEventListener('click', () => choisirVariante(b.dataset.variante)));

    dessinerLegende();
    initialiserCarte();

    const lireAncre = () => {
      const m = location.hash.match(/^#(point|passage)=([\w-]+)$/);
      if (!m) return;
      if (m[1] === 'point' && parId[m[2]]) selectionner(m[2]);
      if (m[1] === 'passage' && PASSAGES[m[2]]) montrerPassage(m[2]);
    };
    lireAncre();
    window.addEventListener('hashchange', lireAncre);

    return () => {
      dessinerLegende(); styleGrille();
      if (etat.carre) afficherCarre(etat.carre.g, etat.carre.rect, false);
      if (etat.selection) { dessinerTrajets(parId[etat.selection]); remplirDetail(parId[etat.selection]); }
    };
  }

  /* ---------------- Heure par heure ---------------- */
  function heureParHeure() {
    const choixOrigine = document.getElementById('choix-origine');
    const choixJour = document.getElementById('choix-jour');
    const groupes = [['Producteurs de CSR', 'site-confirme'], ['Centres de tri de déchets d\'activités', 'site-possible'], ['Entrées d\'autoroute', 'entree']];
    for (const [libelle, cat] of groupes) {
      const og = el('optgroup', { label: libelle });
      D.points.filter(p => categorie(p) === cat && p.previsions.length).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'))
        .forEach(p => og.append(el('option', { value: p.id }, p.nom)));
      choixOrigine.append(og);
    }
    // Lien heures.html#point=IDF3 : ouvre le graphique de ce point
    const ancre = location.hash.match(/^#point=([\w-]+)$/);
    choixOrigine.value = ancre && parId[ancre[1]] && parId[ancre[1]].previsions.length ? ancre[1] : REFERENCE_NORD;
    const jours = [...new Set(D.points[0].previsions.map(c => c.t.slice(0, 10)))];
    const nomJour = j => new Date(j + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    choixJour.append(el('option', { value: 'mediane' }, 'Médiane des 5 jours'), jours.map(j => el('option', { value: j }, nomJour(j))));

    const SERIES = [['vitry', 'Vers Vitry', '--serie-1'], ['acces', 'Vers Ris-Orangis, accès final imposé', '--serie-2'],
                    ['dossier', 'Vers Ris-Orangis, itinéraire du dossier', '--serie-3']];
    const infobulle = document.getElementById('infobulle');

    function valeursHoraires(p, jour) {
      return HEURES.map(h => {
        const c = p.previsions.filter(x => +x.t.slice(11, 13) === h && (jour === 'mediane' || x.t.startsWith(jour)));
        const o = { h };
        for (const [cle] of SERIES) o[cle] = c.length ? mediane(c.map(x => x[cle])) : null;
        return o;
      });
    }

    function dessinerGraphique() {
      const p = parId[choixOrigine.value];
      const jour = choixJour.value;
      const val = valeursHoraires(p, jour);
      document.getElementById('titre-graphique').textContent =
        `Temps de trajet prévus depuis ${nomCourt(p)}, en minutes (${jour === 'mediane' ? 'médiane du lundi 28 septembre au vendredi 2 octobre' : nomJour(jour)})`;
      document.getElementById('legende-graphique').replaceChildren(...SERIES.map(([, lib, v]) =>
        el('span', {}, el('span', { class: 'cle-ligne', style: `background:${cssVar(v)}` }), lib)));

      // Dessin à la largeur réelle du conteneur : les textes gardent leur taille sur mobile
      const zoneGraphique = document.getElementById('graphique');
      const W = Math.max(300, Math.round(zoneGraphique.clientWidth || 760));
      const etroit = W < 560;
      const H = etroit ? 260 : 320, ml = 36, mr = etroit ? 64 : 170, mt = 14, mb = 30;
      const iw = W - ml - mr, ih = H - mt - mb;
      const maxV = Math.max(...val.flatMap(o => SERIES.map(([c]) => o[c] || 0)));
      const pasY = maxV > 120 ? 30 : maxV > 60 ? 20 : 10;
      const yMax = Math.ceil((maxV * 1.05) / pasY) * pasY;
      const x = h => ml + ((h - 8) / 12) * iw;
      const y = v => mt + ih - (v / yMax) * ih;
      const ns = 'http://www.w3.org/2000/svg';
      const s = (tag, attrs, texte) => {
        const n = document.createElementNS(ns, tag);
        for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
        if (texte !== undefined) n.textContent = texte;
        return n;
      };
      const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, tabindex: '0', role: 'img',
        'aria-label': `Graphique des temps de trajet heure par heure depuis ${p.nom}. Utilisez les flèches gauche et droite pour parcourir les heures ; les valeurs sont aussi dans le tableau.` });
      for (let v = 0; v <= yMax; v += pasY) {
        svg.append(s('line', { x1: ml, x2: ml + iw, y1: y(v), y2: y(v), stroke: v === 0 ? cssVar('--base') : cssVar('--grille'), 'stroke-width': 1 }));
        svg.append(s('text', { x: ml - 8, y: y(v) + 4, 'text-anchor': 'end', class: 'axe-texte' }, `${v}`));
      }
      for (const h of HEURES) {
        if (etroit && h % 2) continue;   // une graduation sur deux sur écran étroit
        svg.append(s('text', { x: x(h), y: H - 8, 'text-anchor': 'middle', class: 'axe-texte' }, `${h} h`));
      }

      const fins = [];
      for (const [cle, lib, v] of SERIES) {
        const pts = val.filter(o => o[cle] != null);
        svg.append(s('path', { d: pts.map((o, i) => `${i ? 'L' : 'M'}${x(o.h)},${y(o[cle])}`).join(''),
          fill: 'none', stroke: cssVar(v), 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
        const der = pts[pts.length - 1];
        svg.append(s('circle', { cx: x(der.h), cy: y(der[cle]), r: 4, fill: cssVar(v), stroke: cssVar('--surface'), 'stroke-width': 2 }));
        fins.push({ cle, lib, y: y(der[cle]), v: der[cle] });
      }
      // Étiquettes de fin : seulement celles qui ne se chevauchent pas (la légende reste la référence)
      fins.sort((a, b) => a.y - b.y);
      let dernierY = -Infinity;
      for (const f of fins) {
        if (f.y - dernierY < (etroit ? 16 : 30)) continue;
        const court = f.cle === 'vitry' ? 'Vitry' : f.cle === 'acces' ? 'Ris, accès imposé' : 'Ris, dossier';
        svg.append(s('text', { x: ml + iw + 10, y: f.y + (etroit ? 4 : -2), class: 'etiquette-fin' }, `${fmt0(f.v)} min`));
        if (!etroit) svg.append(s('text', { x: ml + iw + 10, y: f.y + 13, class: 'etiquette-fin-sous' }, court));
        dernierY = f.y;
      }

      // Réticule et infobulle
      const reticule = s('line', { y1: mt, y2: mt + ih, stroke: cssVar('--encre-attenuee'), 'stroke-width': 1, visibility: 'hidden' });
      const points = SERIES.map(([, , v]) => s('circle', { r: 4, fill: cssVar(v), stroke: cssVar('--surface'), 'stroke-width': 2, visibility: 'hidden' }));
      svg.append(reticule, ...points);
      const zone = s('rect', { x: ml, y: mt, width: iw, height: ih, fill: 'transparent' });
      svg.append(zone);
      let indexCourant = null;
      function montrer(i, cx, cy) {
        indexCourant = i;
        const o = val[i];
        reticule.setAttribute('x1', x(o.h)); reticule.setAttribute('x2', x(o.h)); reticule.setAttribute('visibility', 'visible');
        SERIES.forEach(([cle], k) => {
          if (o[cle] == null) { points[k].setAttribute('visibility', 'hidden'); return; }
          points[k].setAttribute('cx', x(o.h)); points[k].setAttribute('cy', y(o[cle])); points[k].setAttribute('visibility', 'visible');
        });
        infobulle.replaceChildren(el('div', { class: 'ib-titre' }, `${jour === 'mediane' ? 'Médiane de la semaine' : nomJour(jour)}, départ à ${o.h} h`),
          ...SERIES.map(([cle, lib, v]) => el('div', { class: 'ib-ligne' },
            el('span', { class: 'cle-ligne', style: `background:${cssVar(v)}` }),
            el('strong', {}, o[cle] != null ? `${fmt0(o[cle])} min` : '—'), el('span', { class: 'lbl' }, lib))),
          el('div', { class: 'ib-ligne', style: 'margin-top:4px' }, el('span', { class: 'lbl' },
            `Écart pour Ris-Orangis : ${signe0(o.acces - o.vitry)} min (accès imposé), ${signe0(o.dossier - o.vitry)} min (dossier)`)));
        infobulle.hidden = false;
        const r = svg.getBoundingClientRect();
        const px = cx ?? (r.left + (x(o.h) / W) * r.width), py = cy ?? (r.top + (mt / H) * r.height + 20);
        const bw = infobulle.offsetWidth;
        infobulle.style.left = `${Math.min(window.innerWidth - bw - 8, px + 14)}px`;
        infobulle.style.top = `${py + 14}px`;
      }
      const cacher = () => { infobulle.hidden = true; reticule.setAttribute('visibility', 'hidden'); points.forEach(pt => pt.setAttribute('visibility', 'hidden')); };
      zone.addEventListener('pointermove', e => {
        const r = svg.getBoundingClientRect();
        const sx = ((e.clientX - r.left) / r.width) * W;
        const i = Math.max(0, Math.min(HEURES.length - 1, Math.round(((sx - ml) / iw) * 12)));
        montrer(i, e.clientX, e.clientY);
      });
      zone.addEventListener('pointerleave', cacher);
      svg.addEventListener('keydown', e => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        e.preventDefault();
        const i = indexCourant == null ? 0 : Math.max(0, Math.min(HEURES.length - 1, indexCourant + (e.key === 'ArrowRight' ? 1 : -1)));
        montrer(i);
      });
      svg.addEventListener('blur', cacher);
      document.getElementById('graphique').replaceChildren(svg);

      // Vue en tableau
      document.getElementById('tableau-heures').replaceChildren(el('div', { class: 'tableau-defilant' }, el('table', { class: 'tableau-donnees' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Départ'), SERIES.map(([, lib]) => el('th', {}, lib)),
          el('th', {}, 'Écart, accès imposé'), el('th', {}, 'Écart, dossier'))),
        el('tbody', {}, val.map(o => el('tr', {}, el('td', {}, `${o.h} h`),
          SERIES.map(([cle]) => el('td', {}, o[cle] != null ? `${fmt0(o[cle])} min` : '—')),
          el('td', {}, `${signe0(o.acces - o.vitry)} min`), el('td', {}, `${signe0(o.dossier - o.vitry)} min`)))))));
    }
    choixOrigine.addEventListener('change', () => { history.replaceState(null, '', '#point=' + choixOrigine.value); dessinerGraphique(); });
    choixJour.addEventListener('change', dessinerGraphique);
    dessinerGraphique();
    let largeurGraphique = document.getElementById('graphique').clientWidth, minuterie = null;
    window.addEventListener('resize', () => {
      clearTimeout(minuterie);
      minuterie = setTimeout(() => {
        const w = document.getElementById('graphique').clientWidth;
        if (Math.abs(w - largeurGraphique) > 20) { largeurGraphique = w; dessinerGraphique(); }
      }, 150);
    });
    return dessinerGraphique;
  }

  /* ---------------- Sur une année ---------------- */
  function surUneAnnee() {
    const calcScenario = document.getElementById('calc-scenario');
    const calcTonnage = document.getElementById('calc-tonnage');
    const calcCharge = document.getElementById('calc-charge');
    const enService = p => p.details.startsWith('producteur CSR') && !p.details.includes('projet');
    const SCENARIOS = {
      nord: { libelle: 'Nord de Paris : producteurs de CSR du Plessis-Gassot et de Bruyères-sur-Oise, à parts égales',
        poids: () => ({ IDF1: 1, IDF3: 1 }) },
      arqp: { libelle: 'Répartition de l\'ARQP par entrée d\'autoroute (selon la population, hors Île-de-France)',
        poids: () => Object.fromEntries(Object.entries(M.poids_arqp).map(([a, w]) => ['E_' + a, w])) },
      producteurs: { libelle: 'Tous les producteurs de CSR en service recensés, à parts égales',
        poids: () => Object.fromEntries(D.points.filter(enService).map(p => [p.id, 1])) },
    };
    for (const [cle, sc] of Object.entries(SCENARIOS)) calcScenario.append(el('option', { value: cle }, sc.libelle));
    const ogPoints = el('optgroup', { label: 'Un seul point de départ' });
    [...D.points].sort((a, b) => a.nom.localeCompare(b.nom, 'fr')).forEach(p => ogPoints.append(el('option', { value: 'pt:' + p.id }, p.nom)));
    calcScenario.append(ogPoints);
    calcTonnage.value = F.tonnage.valeur;
    calcCharge.value = Math.round(CHARGE_DOSSIER * 100) / 100;

    function calculer() {
      const sc = calcScenario.value;
      const poids = sc.startsWith('pt:') ? { [sc.slice(3)]: 1 } : SCENARIOS[sc].poids();
      const total = Object.values(poids).reduce((a, b) => a + b, 0);
      const lignes = Object.entries(poids).map(([id, w]) => ({ p: parId[id], w: w / total }));
      const moy = f => lignes.reduce((a, l) => a + l.w * f(l.p), 0);
      const det = { acces: moy(p => detour(p, 'acces')), dossier: moy(p => detour(p, 'dossier')) };
      const min = { acces: moy(p => p.ecart_min_median.acces ?? 0), dossier: moy(p => p.ecart_min_median.dossier ?? 0) };
      const tonnage = Math.max(0, +calcTonnage.value || 0), charge = Math.max(0.1, +calcCharge.value || CHARGE_DOSSIER);
      const n = camionsAn(tonnage, charge);
      const kmAn = v => n * 2 * det[v], hAn = v => n * 2 * min[v] / 60;
      const cellule = (titre, a, b, note) => el('div', { class: 'tuile' },
        el('p', { class: 'tuile-label' }, titre),
        el('p', { class: 'tuile-valeur' }, a), b ? el('p', { class: 'tuile-note' }, b) : null, note ? el('p', { class: 'tuile-note' }, note) : null);
      document.getElementById('calc-variante').textContent =
        'Chaque résultat est donné pour les deux itinéraires vers Ris-Orangis : l\'accès final imposé (hypothèse la plus favorable au projet) et l\'itinéraire du dossier (RN104).';
      document.getElementById('calc-resultats').replaceChildren(
        cellule('Camions par an', fmt0(arrondi(n, 10)), `${fmt0(tonnage)} t ÷ ${fmt1(charge)} t par camion`),
        cellule('Détour moyen par trajet', `${signe1(det.acces)} km`, `itinéraire du dossier : ${signe1(det.dossier)} km`),
        cellule('Kilomètres en plus par an', `${signe0(arrondi(kmAn('acces'), 1000))} km`, `itinéraire du dossier : ${signe0(arrondi(kmAn('dossier'), 1000))} km`, 'aller et retour'),
        cellule('Heures de conduite en plus par an', `${signe0(arrondi(hAn('acces'), 10))} h`, `itinéraire du dossier : ${signe0(arrondi(hAn('dossier'), 10))} h`, 'au moins : temps de voiture'));
      document.getElementById('calc-formule').textContent =
        `Calcul : kilomètres en plus par an = camions par an × 2 (aller et retour) × détour moyen = ${fmt0(n)} × 2 × ${fmt1(det.acces)} km = ${fmt0(kmAn('acces'))} km (accès final imposé). Le retour se fait vers le point de départ, avec ou sans chargement. Le détour moyen est la moyenne des détours des origines ci-dessous, pondérée par leur part.`;
      document.getElementById('calc-tableau').replaceChildren(el('div', { class: 'tableau-defilant' }, el('table', { class: 'tableau-donnees' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Origine'), el('th', {}, 'Part'), el('th', {}, 'Vers Vitry'),
          el('th', {}, 'Détour, accès imposé'), el('th', {}, 'Détour, dossier'), el('th', {}, 'Écart de temps, accès imposé'))),
        el('tbody', {}, lignes.map(({ p, w }) => el('tr', {},
          el('td', {}, el('a', { href: `carte.html#point=${p.id}` }, p.nom)),
          el('td', {}, `${fmt1(w * 100)} %`), el('td', {}, `${fmt1(p.km.vitry)} km`),
          el('td', {}, `${signe1(detour(p, 'acces'))} km`), el('td', {}, `${signe1(detour(p, 'dossier'))} km`),
          el('td', {}, p.ecart_min_median.acces != null ? `${signe0(p.ecart_min_median.acces)} min` : '—')))))));
    }
    [calcScenario, calcTonnage, calcCharge].forEach(n => n.addEventListener('input', calculer));
    calculer();
  }

  /* ---------------- Méthode, sources et données ---------------- */
  function methode() {
    lier('dest-vitry', `Vitry : entrée du site EDF depuis la rue des Fusillés (${V.lat}, ${V.lon}), d'après le dossier de concertation (p. 50 et 83).`);
    lier('dest-ris', `Ris-Orangis : entrée du Chemin Latéral depuis la RN7 à Grigny (${R.lat}, ${R.lon}), plus ${forfaitRis} jusqu'au portail des camions (dossier p. 54, 55 et 87). Le portail n'est pas visé directement : Google le rattacherait à la RN7, de l'autre côté du RER D.`);
    const nbMasques = GM.en_mer + GM.royaume_uni;
    lier('masque-methode', `Sur la carte, ${nbMasques} carrés sont masqués : ${GM.en_mer} dont le centre est en mer et ${GM.royaume_uni} au Royaume-Uni, d'après les frontières et le trait de côte de Natural Earth.`);
    lier('masque-limite', `${GM.raison} ` + (GM.detour_acces_min_km > 0
      ? `Ce masque ne favorise pas la démonstration : pour chacun des ${nbMasques} carrés masqués, Ris-Orangis était plus loin que Vitry (de ${signe1(GM.detour_acces_min_km)} à ${signe1(GM.detour_acces_max_km)} km avec l'accès final imposé).`
      : `Pour les ${nbMasques} carrés masqués, l'écart avec l'accès final imposé allait de ${signe1(GM.detour_acces_min_km)} à ${signe1(GM.detour_acces_max_km)} km.`)
      + ' Ils restent dans les fichiers téléchargeables.');
    document.getElementById('tableau-parametres').replaceChildren(el('table', { class: 'parametres' }, el('tbody', {},
      [['Arrivée à Vitry', `${V.lat}, ${V.lon}`, 'Dossier p. 50 et 83'],
       ['Arrivée à Ris-Orangis', `${R.lat}, ${R.lon} + ${forfaitRis}`, 'Dossier p. 54, 55 et 87'],
       ['Passage D310 (Grigny)', `${PP.ACCES_D310.lat}, ${PP.ACCES_D310.lon}`, 'Dossier p. 87 ; question n° 63'],
       ['Passage RN104 est', `${PP.N104_EST.lat}, ${PP.N104_EST.lon}`, 'Dossier p. 87 ; question n° 118'],
       ['Passage RN104 ouest', `${PP.N104_OUEST.lat}, ${PP.N104_OUEST.lon}`, 'Dossier p. 87 ; question n° 118'],
       ['Heures de livraison', 'du lundi au vendredi, de 8 h à 20 h, hors jours fériés et hors août', 'Dossier p. 87'],
       ['Rayon d\'approvisionnement', `${M.grille.rayon_km} km au maximum`, 'Question n° 46'],
       ['Carrés masqués sur la carte', `${nbMasques} : ${GM.en_mer} en mer, ${GM.royaume_uni} au Royaume-Uni`, 'Natural Earth, 1:10m'],
       ['Collecte', M.collecte, null],
       ['Prévisions', M.previsions, null]]
        .map(([a, b, c]) => el('tr', {}, el('th', {}, a, c ? el('span', { class: 'param-source' }, c) : null), el('td', {}, b))))));
    const sources = [
      { texte: 'Dossier de concertation (juillet 2026)', url: urlDossier },
      { texte: 'Question n° 46 : origine du CSR et rayon de 300 km', url: F.fournisseurs.source.url },
      { texte: 'Question n° 63 : horaires et itinéraire des camions', url: F.traversee.source.url },
      { texte: 'Question n° 118 : itinéraire inscrit dans l\'arrêté préfectoral', url: F.opposable.source.url },
      { texte: 'Question n° 119 : pourquoi pas de livraison directe à Vitry', url: F.foncier.source.url },
      { texte: 'Cahier d\'acteur n° 19 de l\'ARQP (répartition par entrée d\'autoroute)', url: 'https://www.thermo-sur-seine-concertation.fr/fi/5BgV7ymDVONo/H5mLi48XkdTbZ/cahier_transport_1_nouvelle_version.pdf' },
      { texte: 'Google : pas de calcul poids lourd en France', url: 'https://developers.google.com/maps/documentation/routes/lvr' },
      { texte: 'Google Maps : format des liens « Vérifier » (étapes)', url: 'https://developers.google.com/maps/documentation/urls/get-started#directions-action' },
      { texte: 'Natural Earth : frontières et trait de côte, 1:10m (domaine public)', url: 'https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-0-countries/' },
    ];
    document.getElementById('liste-sources').replaceChildren(...sources.map(s => el('li', {}, lien(s))));
  }
})();
