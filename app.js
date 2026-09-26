'use strict';

/* Thermo-sur-Seine : le trajet du combustible. Site statique de plusieurs pages, données dans data/donnees.json (voir build_data.py). */

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
const fmt2 = v => espace(new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v));   // euros
const fmtBrut = v => espace(v.toLocaleString('fr-FR'));   // constante affichée telle que publiée (ex. 0,496)
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
  // Conversion des kilomètres et des heures de conduite en plus : gazole, CO2 et coût (constantes CNR et ADEME, voir D.faits)
  const bilan = (km, heures) => {
    const litres = km * F.consommation.valeur / 100;
    return { litres, co2: litres * F.co2_gazole.valeur / 1000, carburant: litres * F.prix_gazole.valeur,
             cout: km * F.cout_km.valeur + heures * F.cout_heure.valeur };
  };
  const millions = v => { const r = Math.round(v / 1e5) / 10; return `${Number.isInteger(r) ? fmt0(r) : fmt1(r)} million${r >= 2 ? 's' : ''}`; };
  const lienCnr = texte => [lien({ texte, url: F.consommation.source.url }), ' (', lien({ texte: 'copie archivée', url: F.consommation.source.archive }), ')'];
  // Volet fluvial (dossier p. 56) : une barge de 2 500 m³ de CSR à 0,20 t/m³ emporte 500 t ; le pousseur fait 36 km aller et retour.
  // Consommation par km de convoi (guide « Information GES ») : la puissance des pousseurs n'est pas publiée, d'où une fourchette.
  const T_PAR_BARGE = F.barge_m3.valeur * F.densite.valeur;
  const KM_SEINE = F.trajet_fluvial.valeur / 2;   // km de barge parcourus par chaque tonne livrée
  const SUD = parId.IDF2;                          // Écharcon (91), producteur de CSR au sud de Ris-Orangis
  const barges = tonnage => {
    const convois = tonnage / T_PAR_BARGE, km = convois * F.trajet_fluvial.valeur;
    const [bas, haut] = [F.pousseur_conso.valeurs.moins_590_kw, F.pousseur_conso.valeurs['590_879_kw']];
    return { convois, km, litres: { bas: km * bas, haut: km * haut },
             co2: { bas: km * bas * F.co2_gnr.valeur / 1000, haut: km * haut * F.co2_gnr.valeur / 1000 } };
  };
  const fourchetteCo2 = (bas, haut) => `${fmt0(arrondi(bas, 10))} à ${fmt0(arrondi(haut, 10))} t`;
  const lienGuide = texte => lien({ texte, url: F.pousseur_conso.source.url });
  const noteBarges = b => [`${fmt0(F.tonnage.valeur)} t ÷ ${fmt0(T_PAR_BARGE)} t par barge (2 500 m³ × ${fmt2(F.densite.valeur)} t/m³) = ${fmt0(b.convois)} convois ; × ${fmt0(F.trajet_fluvial.valeur)} km aller et retour = ${fmt0(b.km)} km de pousseur ; × ${fmt2(F.pousseur_conso.valeurs.moins_590_kw)} à ${fmt2(F.pousseur_conso.valeurs['590_879_kw'])} litres de gazole non routier par km (pousseur de moins de 590 kW ou de 590 à 879 kW : la puissance n'est pas publiée) × ${fmt2(F.co2_gnr.valeur)} kg de CO₂ par litre (`,
    lienGuide('guide officiel « Information GES des prestations de transport », 2018, tableaux 11 et 12'), '). Hypothèses : un pousseur par barge ; pousseurs de manœuvre non comptés. Les facteurs actuels de l\'ADEME, exprimés par tonne-kilomètre, supposent des convois bien plus chargés : ils ne conviennent pas à des barges de CSR, très léger, qui n\'emportent que 500 t.'];

  const note = (id, ...contenu) => document.getElementById(id).replaceChildren(...contenu.flat(Infinity).filter(c => c !== null && c !== undefined && c !== false));
  const citation = f => [`« ${f.citation} » (`, lien(f.source), ')'];
  // Compteurs des récits : la valeur finale est écrite tout de suite (lecture sans animation), l'animation la refait défiler depuis 0.
  // Les lecteurs d'écran lisent la valeur finale (texte masqué), pas le compteur animé.
  const nouveauxCompteurs = () => {
    const compteurs = new Map();
    const compteur = (cle, valeur, format) => {
      const span = document.querySelector(`[data-compteur="${cle}"]`);
      span.textContent = format(valeur);
      span.setAttribute('aria-hidden', 'true');
      span.after(el('span', { class: 'sr-only' }, format(valeur)));
      compteurs.set(span, { valeur, format });
    };
    return { compteurs, compteur };
  };

  const PAGES = { presentation, essentiel, dossier: confrontation, itineraires, carte: carteDuDetour, heures: heureParHeure, annee: surUneAnnee, methode };
  const recolorer = PAGES[page] ? PAGES[page]() : null;
  // Recolorer si le thème du système change
  if (recolorer) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', recolorer);

  /* ---------------- Présentation du projet : diaporama horizontal ---------------- */
  function presentation() {
    const { compteurs, compteur } = nouveauxCompteurs();
    compteur('chaleur', F.chaleur.valeur, v => `${fmt1(v)} TWh`);
    compteur('tonnage', F.tonnage.valeur, v => `${fmt0(arrondi(v, 1000))} tonnes`);
    lier('trajet-fluvial', `${fmt0(F.trajet_fluvial.valeur)} km`);
    note('note-chaleur', 'Dossier de concertation : ', ...citation(F.projet), ' ; ', ...citation(F.reseau), ' ; ', ...citation(F.chaleur), ' ; ', ...citation(F.chaufferie),
      '. Le maître d\'ouvrage est une société d\'économie mixte à opération unique (SEMOP), créée pour exploiter le réseau de chaleur parisien pendant 25 ans (', lien(F.maitrise_ouvrage.source), ').');
    note('note-tonnage', 'Dossier de concertation : « ', F.tonnage.citation, ' » (', lien(F.tonnage.source), ') ; ', ...citation(F.csr),
      '. Les fournisseurs ne seront choisis qu\'en 2027, dans un rayon de 300 km au maximum (', lien(F.fournisseurs.source), ').');
    note('note-chaine', 'Dossier de concertation : ', ...citation(F.chaine), ' ; ', ...citation(F.trajet_fluvial),
      `. Carte : trajet d'un camion venant du Plessis-Gassot, calculé par Google le 26 septembre 2026 avec l'accès final imposé, jusqu'à l'entrée du Chemin Latéral (il reste ${forfaitRis} jusqu'au portail) ; tracé de la Seine d'après l'`,
      lien({ texte: 'IGN, BD TOPO', url: M.seine.url }), ` (${fmt1(M.seine.longueur_km)} km entre les deux sites, cohérent avec les ${fmt0(F.trajet_fluvial.valeur)} km aller et retour du dossier) ; centres de préparation de CSR confirmés en Île-de-France (`,
      el('a', { href: 'methode.html' }, 'méthode'), ').');
    // Carte du trajet du combustible : créée à la première ouverture de sa diapositive (Leaflet a besoin d'une taille),
    // puis le camion et la barge refont leur trajet à chaque ouverture.
    let carteTrajet = null;
    document.getElementById('carte-projet').closest('.diapo').addEventListener('diapo-affichee', () => {
      if (!window.L) {
        document.getElementById('carte-projet').replaceChildren(el('p', { class: 'carte-indisponible' }, 'La carte n\'a pas pu être chargée.'));
        return;
      }
      carteTrajet = carteTrajet || carteDuTrajet();
      carteTrajet();
    });
    // Frise chronologique : une année, ce qui s'y passe, et la citation qui le dit
    const etapes = F.calendrier.etapes;
    document.getElementById('frise-projet').replaceChildren(...etapes.map(e => el('li', { class: 'frise-etape' },
      el('span', { class: 'frise-point', 'aria-hidden': 'true' }),
      el('strong', { class: 'frise-annee' }, e.annee),
      el('span', { class: 'frise-texte' }, e.texte))));
    note('note-frise', 'Sources : ', etapes.map((e, i) => [i ? ' ; ' : '', `${e.annee} : « ${e.citation} » (`, lien(e.source), e.autre_source ? [' ; ', lien(e.autre_source)] : null, ')']),
      '. Ce calendrier est celui annoncé par le maître d\'ouvrage ; il dépend de l\'issue de l\'enquête publique.');
    document.getElementById('citation-foncier').replaceChildren(`« ${F.foncier.citation} »`, el('footer', {}, '— ', lien(F.foncier.source)));
    note('note-foncier', F.transport_absent.constat.replace(/\.$/, ''), ' (', lien(F.transport_absent.source), ').');
    note('presentation-sources', 'Toutes les citations viennent du ', lien({ texte: 'dossier de concertation (juillet 2026)', url: urlDossier }),
      ', de ', lien({ texte: 'L\'essentiel du projet', url: F.calendrier.etapes[0].source.url }), ' ou des réponses publiées par le maître d\'ouvrage sur la plateforme de la concertation.');
    diaporama(compteurs);
  }

  // Carte de la région parisienne : les centres de préparation de CSR franciliens, un camion qui va du Plessis-Gassot
  // à la plateforme de Ris-Orangis, puis une barge qui descend la Seine jusqu'à Vitry. Pas d'infobulle : des étiquettes fixes.
  // Renvoie la fonction qui (re)joue l'animation ; sans GSAP ou avec « réduire les animations », les tracés sont complets d'emblée.
  function carteDuTrajet() {
    const carte = L.map('carte-projet', { scrollWheelZoom: false, zoomSnap: 0.25 });
    carte.attributionControl.setPrefix(false);   // Leaflet est crédité en pied de page
    L.tileLayer('https://data.geopf.fr/wmts?REQUEST=GetTile&SERVICE=WMTS&VERSION=1.0.0&STYLE=normal&TILEMATRIXSET=PM&FORMAT=image/png&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}', {
      attribution: '© <a href="https://www.ign.fr/">IGN</a> · Seine : BD TOPO · itinéraire : Google', maxZoom: 18 }).addTo(carte);
    const icone = (html, taille = [0, 0], ancre) => L.divIcon({ className: '', html, iconSize: taille, iconAnchor: ancre });
    const poser = (latlng, html, taille, ancre) => L.marker(latlng, { icon: icone(html, taille, ancre), interactive: false, keyboard: false }).addTo(carte);
    const camionPts = decoder(ref.traces.acces_impose), seinePts = M.seine.latlngs;

    // Centres de préparation de CSR confirmés en Île-de-France, avec leur commune
    const COMMUNES = { IDF3: 'Bruyères-sur-Oise', IDF1: 'Le Plessis-Gassot', IDF2: 'Écharcon' };
    Object.entries(COMMUNES).forEach(([id, commune]) => {
      const p = parId[id];
      poser([p.lat, p.lon], '<div class="marqueur site-confirme"></div>', [12, 12], [6, 6]);
      poser([p.lat, p.lon], `<span class="etiquette-carte">${commune}</span>`);
    });
    // Tracés : un liseré clair sous chaque ligne pour la lisibilité sur le fond de carte
    const ligne = (couleur, epaisseur) => [
      L.polyline([], { color: cssVar('--surface'), weight: epaisseur + 4, opacity: 0.9, interactive: false }).addTo(carte),
      L.polyline([], { color: cssVar(couleur), weight: epaisseur, lineJoin: 'round', lineCap: 'round', interactive: false }).addTo(carte)];
    const lignesCamion = ligne('--serie-2', 3.5), lignesSeine = ligne('--serie-1', 5);
    // Sites du projet et véhicules (vus de profil, comme dans la barre de navigation)
    poser(seinePts[0], '<span class="site-projet site-ris"></span>', [14, 14], [7, 7]);
    poser(seinePts[0], '<span class="etiquette-carte etiquette-carte-gauche"><strong>Plateforme de Ris-Orangis</strong></span>');
    poser(seinePts[seinePts.length - 1], '<span class="site-projet site-vitry"></span>', [14, 14], [7, 7]);
    poser(seinePts[seinePts.length - 1], '<span class="etiquette-carte"><strong>Chaufferie de Vitry</strong></span>');
    const vehiculeCamion = poser(camionPts[0], '<svg class="carte-mobile" viewBox="0 0 32 20"><rect x="1" y="3" width="19" height="11" rx="1.5" class="chaine-remorque"/><path d="M21 6h5.5l4 4.5V14H21z" class="chaine-cabine"/><circle cx="7" cy="16" r="2.6"/><circle cx="25" cy="16" r="2.6"/></svg>', [30, 19], [15, 16]);
    const vehiculeBarge = poser(seinePts[0], '<svg class="carte-mobile" viewBox="0 0 32 20"><path d="M1 10h30l-4 7H5z" class="chaine-coque"/><rect x="6" y="5" width="18" height="5" rx="1" class="chaine-cargaison"/></svg>', [30, 19], [15, 15]);

    // Position le long d'un tracé, en proportion de sa longueur
    const cumul = pts => pts.reduce((acc, p, i) => (acc.push(i ? acc[i - 1] + carte.distance(pts[i - 1], p) : 0), acc), []);
    const cumulCamion = cumul(camionPts), cumulSeine = cumul(seinePts);
    const jusqua = (pts, cum, t) => {
      const cible = t * cum[cum.length - 1];
      let i = cum.findIndex(c => c >= cible);
      if (i <= 0) return [pts[0]];
      const f = (cible - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
      return [...pts.slice(0, i), [pts[i - 1][0] + f * (pts[i][0] - pts[i - 1][0]), pts[i - 1][1] + f * (pts[i][1] - pts[i - 1][1])]];
    };
    const avancer = (lignes, vehicule, pts, cum) => t => {
      const trace = jusqua(pts, cum, t);
      lignes.forEach(l => l.setLatLngs(trace));
      vehicule.setLatLng(trace[trace.length - 1]);
    };
    const majCamion = avancer(lignesCamion, vehiculeCamion, camionPts, cumulCamion);
    const majSeine = avancer(lignesSeine, vehiculeBarge, seinePts, cumulSeine);
    const bornes = L.latLngBounds([...camionPts, ...seinePts, ...Object.keys(COMMUNES).map(id => [parId[id].lat, parId[id].lon])]);

    const G = window.gsap, anime = !!G && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let tl = null;
    return () => {
      carte.invalidateSize();
      carte.fitBounds(bornes, { paddingTopLeft: [28, 20], paddingBottomRight: [28, 36] });   // en bas : place pour les crédits
      if (tl) tl.kill();
      // Arrivés, le camion et la barge s'effacent pour laisser voir les sites du projet
      const visibles = (camion, barge) => { vehiculeCamion.setOpacity(camion); vehiculeBarge.setOpacity(barge); };
      if (!anime) { majCamion(1); majSeine(1); visibles(0, 0); return; }
      const o = { camion: 0, seine: 0, vc: 1, vb: 0 };
      majCamion(0); majSeine(0); visibles(1, 0);
      tl = G.timeline({ delay: 0.5, onUpdate: () => visibles(o.vc, o.vb) })
        .to(o, { camion: 1, duration: 3.2, ease: 'power1.inOut', onUpdate: () => majCamion(o.camion) })
        .to(o, { vc: 0, vb: 1, duration: 0.3 })
        .to(o, { seine: 1, duration: 2.4, ease: 'power1.inOut', onUpdate: () => majSeine(o.seine) }, '+=0.1')
        .to(o, { vb: 0, duration: 0.4 }, '+=0.3');
    };
  }

  /* ---------------- Le grand détour (accueil) : récit à faire défiler ---------------- */
  function essentiel() {
    // Hypothèse de référence : combustible venant du Plessis-Gassot, accès final imposé (le plus favorable au projet)
    const detourRef = detour(ref, 'acces');
    const kmAn = camionsDossier * 2 * detourRef;
    const heuresAn = camionsDossier * 2 * ref.ecart_min_median.acces / 60;
    const b = bilan(kmAn, heuresAn);
    const tours = Math.round(kmAn / F.tour_terre.valeur), emplois = Math.round(heuresAn / F.duree_legale.valeur);
    const vols = arrondi(b.co2 / F.avion_paris_new_york.valeur, 10);   // allers-retours Paris–New York en avion (ADEME, Impact CO2)
    const ecarts = cells => cells.map(g => g[5] - g[3]);
    const nord = ecarts(D.grille.filter(g => g[0] > V.lat));
    const pct = (arr, test) => Math.round(100 * arr.filter(test).length / arr.length);
    const { compteurs, compteur } = nouveauxCompteurs();
    compteur('detour-trajet', detourRef, v => `${signe1(v)} km`);
    compteur('camions', camionsDossier, v => fmt0(arrondi(v, 100)));
    compteur('km-an', kmAn, v => `${fmt0(arrondi(v, 1000))} km`);
    compteur('heures', heuresAn, v => `${fmt0(arrondi(v, 100))} heures`);
    compteur('co2', b.co2, v => `${fmt0(arrondi(v, 10))} tonnes`);
    compteur('cout', b.cout, v => `${fmt0(arrondi(v, 1000))} €`);
    compteur('nord', pct(nord, d => d > 0), v => `${fmt0(v)} %`);
    // Volet fluvial : distance de la chaîne complète (camion puis barge) et CO2 des pousseurs
    const chaineRef = ref.km.acces_impose + KM_SEINE, fl = barges(F.tonnage.valeur);
    compteur('chaine', chaineRef, v => `${fmt0(v)} km`);
    compteur('co2-barges', fl.co2.haut, v => `${fmt0(arrondi(v * fl.co2.bas / fl.co2.haut, 10))} à ${fmt0(arrondi(v, 10))} tonnes`);

    lier('detour-aller-retour', `${signe0(2 * detourRef)} km`);
    lier('tours-terre', `${fmt0(tours)} fois le tour de la Terre`);
    lier('emplois', `${fmt0(emplois)} emplois à temps plein`);
    lier('litres', `${fmt0(arrondi(b.litres, 1000))} litres`);
    lier('vols', `environ ${fmt0(vols)} allers-retours`);
    lier('carburant', `${fmt0(arrondi(b.carburant, 10000))} €`);
    lier('nord-mediane', `${fmt0(mediane(nord))} km`);
    lier('chaine-directe', `${fmt0(ref.km.vitry)} km`);
    lier('convois', fmt0(arrondi(fl.convois, 10)));
    lier('co2-camions', `${fmt0(arrondi(b.co2, 10))} tonnes`);
    document.getElementById('citation-fluvial').replaceChildren(`« ${F.atout_fluvial.citation} »`, el('footer', {}, '— ', lien(F.atout_fluvial.source)));

    // Barres empilées : distance parcourue par chaque tonne, en camion puis en barge
    const kmChaineMax = Math.max(ref.km.vitry, chaineRef);
    const segment = (km, couleur) => el('span', { class: 'barre-remplie', style: `width:${(100 * km / kmChaineMax).toFixed(1)}%;background:var(${couleur})` });
    document.getElementById('barres-chaine').replaceChildren(
      el('div', { class: 'barre' }, el('span', { class: 'barre-libelle' }, 'Directement à Vitry', el('strong', {}, `${fmt1(ref.km.vitry)} km`)),
        el('span', { class: 'barre-piste barre-piste-empilee' }, segment(ref.km.vitry, '--serie-2'))),
      el('div', { class: 'barre' }, el('span', { class: 'barre-libelle' }, 'Par Ris-Orangis', el('strong', {}, `${fmt1(chaineRef)} km`)),
        el('span', { class: 'barre-piste barre-piste-empilee' }, segment(ref.km.acces_impose, '--serie-2'), segment(KM_SEINE, '--serie-1'))),
      el('p', { class: 'barres-legende' }, el('span', { class: 'cle-ligne', style: 'background:var(--serie-2)' }), 'camion ',
        el('span', { class: 'cle-ligne', style: 'background:var(--serie-1)' }, ), 'barge sur la Seine'));

    // Deux barres : distance vers Vitry et vers Ris-Orangis, depuis le Plessis-Gassot
    const kmMax = Math.max(ref.km.vitry, ref.km.acces_impose);
    document.getElementById('barres-trajet').replaceChildren(...[['Vers Vitry', ref.km.vitry, '--serie-1'], ['Vers Ris-Orangis', ref.km.acces_impose, '--serie-2']]
      .map(([libelle, km, couleur]) => el('div', { class: 'barre' },
        el('span', { class: 'barre-libelle' }, libelle, el('strong', {}, `${fmt1(km)} km`)),
        el('span', { class: 'barre-piste' }, el('span', { class: 'barre-remplie', style: `width:${(100 * km / kmMax).toFixed(1)}%;background:var(${couleur})` })))));

    // Pictogrammes : un globe par tour de la Terre, une silhouette par emploi à temps plein
    const ns = 'http://www.w3.org/2000/svg';
    const picto = formes => {
      const svg = document.createElementNS(ns, 'svg');
      svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('class', 'picto');
      for (const [tag, attrs] of formes) {
        const n = document.createElementNS(ns, tag);
        for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
        svg.append(n);
      }
      return svg;
    };
    const globe = () => picto([['circle', { cx: 12, cy: 12, r: 10 }], ['ellipse', { cx: 12, cy: 12, rx: 4.5, ry: 10 }], ['line', { x1: 2, y1: 12, x2: 22, y2: 12 }]]);
    const silhouette = () => picto([['circle', { cx: 12, cy: 6.5, r: 4, class: 'plein' }], ['path', { d: 'M4 22c0-5 3.6-8.5 8-8.5s8 3.5 8 8.5z', class: 'plein' }]]);
    document.getElementById('pictos-terre').replaceChildren(...Array.from({ length: tours }, globe));
    document.getElementById('pictos-emplois').replaceChildren(...Array.from({ length: emplois }, silhouette));
    const avion = () => picto([['path', { d: 'M12 2c.8 0 1.3.9 1.3 2v5.2l8.2 4.6v2l-8.2-2.4v4.8l2.2 1.6V22L12 21l-3.5 1v-2.2l2.2-1.6v-4.8l-8.2 2.4v-2l8.2-4.6V4c0-1.1.5-2 1.3-2z', class: 'plein' }]]);
    document.getElementById('pictos-co2').replaceChildren(...Array.from({ length: vols }, avion));   // un avion par aller-retour

    // Calculs et sources, étape par étape
    note('note-camions', `Calcul : ${fmt0(F.tonnage.valeur)} t ÷ ${fmt1(CHARGE_DOSSIER)} t par camion (une barge de 2 500 m³ vaut 28 camions, densité de 0,20 t/m³) : `,
      lien(F.tonnage.source), ' ; ', lien(F.barge.source), '.');
    note('note-km-an', `Calcul : ${fmt0(camionsDossier)} camions × 2 (aller et retour) × ${fmt1(detourRef)} km. Tour de la Terre à l'équateur : ${fmt0(F.tour_terre.valeur)} km (`,
      lien({ texte: 'NGA, WGS 84', url: F.tour_terre.source.url }), ').');
    note('note-heures', `Calcul : ${fmt0(camionsDossier)} camions × 2 × ${fmt1(ref.ecart_min_median.acces)} minutes de trajet en plus (médiane des prévisions Google aux heures de livraison), puis ÷ ${fmt0(F.duree_legale.valeur)} heures, durée légale annuelle du travail (`,
      lien({ texte: 'service-public.gouv.fr', url: F.duree_legale.source.url }), '). Ce sont des temps de voiture : un camion ne peut qu\'être plus lent.');
    note('note-co2', `Calcul : ${fmt0(arrondi(kmAn, 1000))} km × ${fmt1(F.consommation.valeur)} litres aux 100 km (`, ...lienCnr('CNR'),
      `) × ${fmt1(F.co2_gazole.valeur)} kg de CO₂ par litre, de l'extraction du pétrole au pot d'échappement (`, lien({ texte: 'ADEME', url: F.co2_gazole.source.url }),
      `). Un aller-retour Paris–New York en avion émet ${fmt2(F.avion_paris_new_york.valeur)} t de CO₂ par passager (`, lien({ texte: 'ADEME, Impact CO₂', url: F.avion_paris_new_york.source.url }),
      `), soit ${fmt0(arrondi(b.co2, 10))} ÷ ${fmt2(F.avion_paris_new_york.valeur)} ≈ ${fmt0(vols)} allers-retours. Les camions à fond mouvant prévus consomment sans doute davantage : ce chiffre est prudent.`);
    note('note-cout', `Calcul : ${fmt0(arrondi(kmAn, 1000))} km × ${fmtBrut(F.cout_km.valeur)} €/km + ${fmt0(arrondi(heuresAn, 100))} h × ${fmt2(F.cout_heure.valeur)} €/h ; gazole : ${fmt0(arrondi(b.litres, 1000))} litres × ${fmt2(F.prix_gazole.valeur)} € (`,
      ...lienCnr('CNR, décembre 2025'), '). Hors péages et hors TVA. Le gazole a fortement augmenté en 2026 : ces montants sont sous-estimés.');
    note('note-chaine-complete', `Calcul : ${fmt1(ref.km.acces_impose)} km de camion jusqu'à Ris-Orangis (accès final imposé, mesure Google), puis ${fmt0(KM_SEINE)} km de barge, soit la moitié du trajet aller et retour décrit par le dossier : « ${F.trajet_fluvial.citation} » (`,
      lien(F.trajet_fluvial.source), `) ; livraison directe : ${fmt1(ref.km.vitry)} km. Depuis le sud, c'est différent : depuis Écharcon (Essonne), ${fmt1(SUD.km.acces_impose)} km de camion puis ${fmt0(KM_SEINE)} km de barge font ${fmt1(SUD.km.acces_impose + KM_SEINE)} km, contre ${fmt1(SUD.km.vitry)} km directement.`);
    note('note-co2-barges', 'Moteurs thermiques : ', lien(F.pousseurs_thermiques.source), '. Calcul : ', ...noteBarges(fl), ` Le dossier annonce « ${F.barges_jour.citation.replace(/\.$/, '')} » (`, lien(F.barges_jour.source), '), ce qui est du même ordre.');
    note('note-nord', 'Le dossier prévoit des livraisons « ', F.nord.citation, ' » (', lien(F.nord.source), ').');
    note('essentiel-sources', 'Sources : nombre de camions calculé d\'après le dossier (', lien(F.tonnage.source), ' ; ', lien(F.barge.source),
      ') ; tour de la Terre : ', lien({ texte: 'NGA, WGS 84', url: F.tour_terre.source.url }),
      ' ; durée légale du travail : ', lien({ texte: 'service-public.gouv.fr', url: F.duree_legale.source.url }),
      ' ; consommation et coûts : ', ...lienCnr('CNR, référentiel régional'), ' ; CO₂ du gazole : ', lien({ texte: 'ADEME, Base Carbone', url: F.co2_gazole.source.url }),
      ' ; barges : dossier (', lien(F.trajet_fluvial.source), ') et ', lienGuide('guide officiel « Information GES des prestations de transport »'),
      ' ; distances et temps : mesures Google du 26 septembre 2026 (', el('a', { href: 'methode.html' }, 'méthode'), '). Les étapes chiffrées du détour supposent un combustible venant du Plessis-Gassot, sauf la dernière, qui porte sur tous les points de départ situés au nord de Vitry. Les fournisseurs ne seront choisis qu\'en 2027 (',
      lien({ texte: 'question n° 46', url: F.fournisseurs.source.url }), ').');

    animerRecit(compteurs, document.getElementById('essentiel'));
  }

  // Compteur animé : refait défiler la valeur depuis 0. Le nombre de tours de la Terre suit le compteur de kilomètres.
  function compteurAnime(G, compteurs) {
    const spanTours = document.querySelector('[data-lie="tours-terre"]'), toursFin = kmFin => kmFin / F.tour_terre.valeur;
    const suivis = new Map([[document.querySelector('[data-compteur="km-an"]'), (v, fin) => {
      spanTours.textContent = `${fmt0(v >= fin ? Math.round(toursFin(fin)) : Math.floor(toursFin(v)))} fois le tour de la Terre`;
    }]]);
    return (span, duree, ease) => {
      const { valeur, format } = compteurs.get(span), o = { v: 0 }, suivi = suivis.get(span);
      return G.fromTo(o, { v: 0 }, { v: valeur, duration: duree, ease, onUpdate: () => {
        span.textContent = format(o.v);
        if (suivi) suivi(o.v, valeur);
      } });
    };
  }

  // Animation d'une étape (récit de l'accueil ou diapositive de la présentation) : apparition en cascade, puis compteurs,
  // barres, pictogrammes et frise chronologique, joués d'un seul tenant. Renvoie une timeline en pause.
  function animationEtape(G, etape, compter) {
    const contenu = etape.querySelector('.etape-contenu');
    const tl = G.timeline({ paused: true });
    tl.from(contenu.children, { y: 40, opacity: 0, duration: 0.7, stagger: 0.1, ease: 'power3.out' });
    const pictos = etape.querySelectorAll('.picto');
    // Avec des pictogrammes, le compteur avance au même rythme qu'eux (un globe par tour de la Terre, etc.)
    const duree = pictos.length ? Math.min(3, 1.2 + pictos.length * 0.03) : 1.6;
    etape.querySelectorAll('[data-compteur]').forEach(s => tl.add(compter(s, duree, pictos.length ? 'none' : 'power2.out'), 0.3));
    if (pictos.length) tl.from(pictos, { scale: 0, opacity: 0, duration: 0.35, ease: 'back.out(2.5)', stagger: duree / pictos.length }, 0.3);
    const barres = etape.querySelectorAll('.barre-remplie');
    if (barres.length) tl.from(barres, { scaleX: 0, transformOrigin: 'left center', duration: 1.3, stagger: 0.3, ease: 'power2.out' }, 0.3);
    // Frise chronologique : le trait se trace, puis chaque année apparaît à son tour
    const frise = etape.querySelector('.frise');
    if (frise) {
      tl.fromTo(frise, { '--trace': 0 }, { '--trace': 1, duration: 2.2, ease: 'power1.inOut' }, 0.4);
      tl.from(frise.querySelectorAll('.frise-etape'), { opacity: 0, y: 12, duration: 0.45, stagger: 0.36, ease: 'power2.out' }, 0.5);
    }
    return tl;
  }

  // Animations du récit de l'accueil (GSAP + ScrollTrigger). Chaque étape se joue en entier, toute seule, dès qu'elle
  // apparaît à l'écran : pas besoin de continuer à faire défiler. Sans GSAP ou avec « réduire les animations »,
  // rien n'est masqué : les valeurs finales restent affichées.
  function animerRecit(compteurs, recit) {
    const G = window.gsap, ST = window.ScrollTrigger;
    if (!G || !ST || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    G.registerPlugin(ST);
    document.documentElement.classList.add('recit-anime');
    const compter = compteurAnime(G, compteurs);

    // Barre de progression de la lecture
    const progression = el('div', { class: 'recit-progression', 'aria-hidden': 'true' });
    document.body.append(progression);
    G.to(progression, { scaleX: 1, ease: 'none', scrollTrigger: { trigger: recit, start: 'top top', end: 'bottom bottom', scrub: 0.3 } });
    if (window.MotionPathPlugin) routeDuCamion(G, ST, recit);

    // Ouverture, puis chaque étape quand elle entre dans l'écran
    G.from('.etape-ouverture .etape-contenu > *', { y: 30, opacity: 0, duration: 0.9, stagger: 0.15, ease: 'power3.out' });
    recit.querySelectorAll('.etape:not(.etape-ouverture)').forEach(etape => {
      const tl = animationEtape(G, etape, compter);
      ST.create({ trigger: etape.querySelector('.etape-contenu'), start: 'top 80%', once: true, onEnter: () => tl.play() });
    });
  }

  // Présentation : un diaporama horizontal. Flèches, points, touches ← →, balayage au doigt ; une barge avance sur la Seine
  // d'un point à l'autre. Chaque diapositive rejoue ses animations quand elle s'affiche, et l'adresse garde sa position (#diapo-3).
  // Sans JavaScript, toutes les diapositives s'affichent l'une sous l'autre ; sans GSAP ou avec « réduire les animations »,
  // elles changent sans animation, avec leurs valeurs finales.
  function diaporama(compteurs) {
    const racine = document.getElementById('presentation');
    const diapos = [...racine.querySelectorAll('.diapo')], n = diapos.length;
    const precedent = document.getElementById('diapo-precedente'), suivant = document.getElementById('diapo-suivante');
    const points = document.getElementById('diapo-points'), fleuve = document.getElementById('diapo-fleuve'), compte = document.getElementById('diapo-compte');
    const G = window.gsap, anime = !!G && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const compter = anime ? compteurAnime(G, compteurs) : null;
    const timelines = anime ? diapos.map(d => animationEtape(G, d, compter)) : [];
    racine.classList.add('diaporama-actif');
    document.getElementById('diapo-barre').hidden = false;
    diapos.forEach((d, i) => {
      d.setAttribute('role', 'group');
      d.setAttribute('aria-roledescription', 'diapositive');
      d.setAttribute('aria-label', `${i + 1} sur ${n} : ${d.dataset.titre}`);
    });
    const boutons = diapos.map((d, i) => el('button', { type: 'button', class: 'diapo-point', 'aria-label': `Diapositive ${i + 1} : ${d.dataset.titre}`, onclick: () => aller(i) }));
    points.replaceChildren(...boutons);

    let courante = -1;
    function aller(i, depuisAdresse = false) {
      i = Math.max(0, Math.min(n - 1, i));
      if (i === courante) return;
      const sens = i > courante ? 1 : -1;
      diapos.forEach((d, k) => { d.hidden = k !== i; });
      boutons.forEach((b, k) => b.setAttribute('aria-current', k === i ? 'step' : 'false'));
      precedent.disabled = i === 0;
      suivant.disabled = i === n - 1;
      compte.textContent = `${i + 1} / ${n}`;
      fleuve.style.setProperty('--position', n > 1 ? i / (n - 1) : 0);
      if (anime && courante >= 0) G.fromTo(diapos[i], { x: 60 * sens, opacity: 0 }, { x: 0, opacity: 1, duration: 0.5, ease: 'power2.out' });
      if (anime) timelines[i].restart();
      diapos[i].dispatchEvent(new CustomEvent('diapo-affichee'));   // par exemple pour la carte, qui a besoin d'être visible
      if (courante >= 0 && !depuisAdresse) history.replaceState(null, '', `#diapo-${i + 1}`);
      // Après un changement, le haut de la diapositive reste en vue
      if (courante >= 0 && racine.getBoundingClientRect().top < 0) racine.scrollIntoView({ block: 'start' });
      courante = i;
    }
    precedent.addEventListener('click', () => aller(courante - 1));
    suivant.addEventListener('click', () => aller(courante + 1));
    racine.querySelectorAll('[data-diapo-suivante]').forEach(b => b.addEventListener('click', () => aller(courante + 1)));
    document.addEventListener('keydown', e => {
      if (e.altKey || e.ctrlKey || e.metaKey || /^(input|select|textarea)$/i.test(e.target.tagName)) return;
      if (e.key === 'ArrowRight') { aller(courante + 1); e.preventDefault(); }
      else if (e.key === 'ArrowLeft') { aller(courante - 1); e.preventDefault(); }
    });
    // Balayage horizontal au doigt (un geste surtout vertical reste un défilement)
    let depart = null;
    racine.addEventListener('touchstart', e => { depart = [e.touches[0].clientX, e.touches[0].clientY]; }, { passive: true });
    racine.addEventListener('touchend', e => {
      if (!depart) return;
      const dx = e.changedTouches[0].clientX - depart[0], dy = e.changedTouches[0].clientY - depart[1];
      if (Math.abs(dx) > 50 && Math.abs(dx) > 1.5 * Math.abs(dy)) aller(courante + (dx < 0 ? 1 : -1));
      depart = null;
    });
    const numeroDansAdresse = () => { const m = /^#diapo-(\d+)$/.exec(location.hash); return m ? +m[1] - 1 : 0; };
    aller(numeroDansAdresse(), true);
    window.addEventListener('hashchange', () => aller(numeroDansAdresse(), true));
  }

  // Un petit camion (vu de dessus) descend le récit au rythme du défilement.
  // Grand écran : il suit une route sinueuse dans la marge de droite et reste à hauteur du milieu de l'écran.
  // Petit écran : pas de place à côté du texte, il roule le long de la barre de progression, en haut.
  function routeDuCamion(G, ST, recit) {
    G.registerPlugin(window.MotionPathPlugin);
    const ns = 'http://www.w3.org/2000/svg';
    const svgEl = (tag, attrs, parent) => {
      const n = document.createElementNS(ns, tag);
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
      if (parent) parent.append(n);
      return n;
    };
    // Camion vu de dessus, orienté vers la droite (x positif = avant) : remorque, cabine, pare-brise
    const camion = (parent, echelle = 1) => {
      const g = svgEl('g', { transform: `scale(${echelle})` }, svgEl('g', { class: 'camion' }, parent));
      svgEl('rect', { x: -19, y: -7, width: 27, height: 14, rx: 2, class: 'camion-remorque' }, g);
      svgEl('rect', { x: 9, y: -6, width: 10, height: 12, rx: 2.5, class: 'camion-cabine' }, g);
      svgEl('rect', { x: 15.5, y: -4.5, width: 2, height: 9, rx: 1, class: 'camion-parebrise' }, g);
      return g.parentNode;   // groupe animé (le groupe intérieur porte l'échelle)
    };
    const mm = G.matchMedia();

    mm.add('(min-width: 1000px)', () => {
      const svg = svgEl('svg', { class: 'route', 'aria-hidden': 'true' });
      const chaussee = svgEl('path', { class: 'route-chaussee' }, svg);
      const parcourue = svgEl('path', { class: 'route-parcourue' }, svg);
      const ligne = svgEl('path', { class: 'route-ligne' }, svg);
      const vehicule = camion(svg, 1.5);
      recit.append(svg);
      let longueur = 0;
      // Géométrie recalculée à chaque rafraîchissement (hauteur du récit, largeur de la marge)
      const geometrie = () => {
        const r = recit.getBoundingClientRect(), c = recit.querySelector('.etape-contenu').getBoundingClientRect();
        const gauche = Math.round(c.right - r.left + 40), largeur = Math.max(80, Math.min(220, r.width - gauche - 24)), H = recit.offsetHeight;
        Object.assign(svg.style, { left: `${gauche}px`, width: `${largeur}px`, height: `${H}px` });
        svg.setAttribute('viewBox', `0 0 ${largeur} ${H}`);
        // Virages alternés à gauche et à droite, un tous les ~420 px
        const n = Math.max(2, Math.round(H / 420)), pas = H / n, milieu = largeur / 2, a = milieu - 20;
        let d = `M ${milieu} 0`;
        for (let i = 0; i < n; i++) {
          const x = milieu + (i % 2 ? -a : a), y = i * pas;
          d += ` C ${x} ${y + pas * 0.25}, ${x} ${y + pas * 0.75}, ${milieu} ${y + pas}`;
        }
        [chaussee, parcourue, ligne].forEach(p => p.setAttribute('d', d));
        longueur = chaussee.getTotalLength();
        parcourue.style.strokeDasharray = `${longueur}`;
      };
      geometrie();
      ST.addEventListener('refreshInit', geometrie);
      // Le milieu de l'écran parcourt le récit de haut en bas : le camion y reste, à la même hauteur
      const defilement = { trigger: recit, start: 'top center', end: 'bottom center', scrub: 0.6, invalidateOnRefresh: true };
      G.to(vehicule, { ease: 'none', scrollTrigger: defilement,
        motionPath: { path: chaussee, align: chaussee, alignOrigin: [0.5, 0.5], autoRotate: true } });
      G.fromTo(parcourue, { strokeDashoffset: () => longueur }, { strokeDashoffset: 0, ease: 'none', scrollTrigger: { ...defilement } });
      return () => { ST.removeEventListener('refreshInit', geometrie); svg.remove(); };
    });

    mm.add('(max-width: 999px)', () => {
      const svg = svgEl('svg', { class: 'camion-barre', viewBox: '-20 -10 40 20', 'aria-hidden': 'true' });
      camion(svg);
      document.body.append(svg);
      G.fromTo(svg, { x: 0 }, { x: () => window.innerWidth - 34, ease: 'none', scrollTrigger: {
        trigger: recit, start: 'top top', end: 'bottom bottom', scrub: 0.3, invalidateOnRefresh: true } });
      return () => svg.remove();
    });
  }

  /* ---------------- Questions / réponses : une conversation de groupe ---------------- */
  // Trois participants. « Le public » : de vraies questions de la plateforme de la concertation, citées mot pour mot, sans nom d'auteur.
  // « Le maître d'ouvrage » : ses réponses publiées ou le dossier de concertation, cités mot pour mot. « Les faits » : nos mesures
  // et les chiffres du dossier. Chaque message renvoie à sa source.
  function confrontation() {
    const au8 = ecartHeure(ref, 'acces', 8), au17 = ecartHeure(ref, 'acces', 17);
    const cellulesNord = D.grille.filter(g => g[0] > V.lat);
    const cellulesSud = D.grille.filter(g => g[0] < R.lat);
    const part = (cells, test) => Math.round(100 * cells.filter(test).length / cells.length);
    const kmParKmDetour = 2 * camionsDossier;
    const fl = barges(F.tonnage.valeur);
    const co2Camions = bilan(camionsDossier * 2 * detour(ref, 'acces'), 0).co2;   // même hypothèse que l'accueil (Plessis-Gassot, accès imposé)
    const g35 = F.graphique_2035.valeurs;                                          // camions par jour, de janvier à décembre 2035
    const fort = t => el('strong', {}, t);
    const lienPage = (href, texte) => el('a', { href }, texte);

    // Les messages : qui parle, ce qu'il dit, et ses sources
    const pub = f => ({ qui: 'public', cite: f.citation, sources: [f.source] });
    const mo = f => ({ qui: 'mo', cite: f.citation, sources: [f.source] });
    const faits = (contenu, sources) => ({ qui: 'faits', contenu, sources });
    const silence = f => ({ qui: 'systeme', contenu: [`Toujours sans réponse du maître d'ouvrage au ${f.sans_reponse} :`], sources: [f.source] });

    const fils = [
      { titre: 'Combien de camions ?', messages: [
        pub(F.public_camions),
        mo(F.mo_camions),
        faits(['Le graphique du dossier monte pourtant à ', fort(`${g35[0]} camions par jour`), ` en janvier 2035, et reste à ${Math.min(g35[10], g35[11], g35[0], g35[1])} ou plus de novembre à février. Les « 60 à 130 » sont des moyennes par saison.`], [F.graphique_2035.source]),
        faits([`Avec les chiffres du dossier (une barge de 2 500 m³ vaut 28 camions ; densité de 0,20 t/m³), un camion porte ${fmt1(CHARGE_DOSSIER)} t : il en faut environ `, fort(`${fmt0(arrondi(camionsDossier, 100))} par an`), '.'], [F.barge.source, F.tonnage.source]),
      ] },
      { titre: 'Et les bouchons de l\'A86 ?', messages: [
        pub(F.public_a86),
        mo(F.congestion),
        faits(['Depuis le Plessis-Gassot, livrer Ris-Orangis prend plus de temps que livrer Vitry, même aux heures de pointe :']),
        faits([fort(`${signe0(au8)} min à 8 h`), ' et ', fort(`${signe0(au17)} min à 17 h`), '.']),
        faits(['Médianes de la semaine du 28 septembre, prévisions Google en voiture : un camion ne peut qu\'être plus lent. Le détail est sur la page ', lienPage('heures.html', 'Heure par heure'), '.']),
      ] },
      { titre: 'Les camions traverseront-ils Ris-Orangis ?', messages: [
        pub(F.public_ris),
        mo(F.mo_itineraire),
        faits(['Cet itinéraire par la RN104 rallonge encore le trajet : ', fort(`${signe1(detour(ref, 'dossier'))} km`), ` depuis le Plessis-Gassot, contre ${signe1(detour(ref, 'acces'))} km par le seul accès final.`]),
        mo(F.opposable),
        faits(['Encore faudra-t-il le faire respecter : sans point de passage imposé, l\'itinéraire le plus rapide fait passer les camions par la RN7, dans Ris-Orangis. Voir ', lienPage('itineraires.html', 'les règles des itinéraires'), '.']),
      ] },
      { titre: 'Pourquoi pas directement à Vitry ?', messages: [
        pub(F.public_plateforme),
        mo(F.mo_plateforme),
        mo(F.foncier),
        faits(['La parcelle EDF de Vitry fait 38 ha, dont 6,7 ha pour la chaufferie.'], [F.parcelle.source]),
        faits(['Ce que ce choix coûte en kilomètres n\'est chiffré nulle part. Or, avec ', `${fmt0(arrondi(camionsDossier, 100))} camions par an, chaque kilomètre de détour moyen représente `, fort(`${fmt0(arrondi(kmParKmDetour, 100))} km de plus par an`), ', aller et retour.']),
        pub(F.public_vitry),
        silence(F.public_vitry),
      ] },
      { titre: 'La barge, c\'est plus écologique ?', messages: [
        pub(F.public_fluvial),
        mo(F.mo_barge),
        mo(F.atout_fluvial),
        faits(['Depuis le nord, la barge ne remplace aucun kilomètre de camion : elle s\'y ajoute.']),
        faits([`Depuis le Plessis-Gassot, livré directement à Vitry, le combustible ferait ${fmt1(ref.km.vitry)} km. Par Ris-Orangis : ${fmt1(ref.km.acces_impose)} km de camion, puis ${fmt0(KM_SEINE)} km de barge, soit `, fort(`${fmt1(ref.km.acces_impose + KM_SEINE)} km`), '.'], [F.trajet_fluvial.source]),
        mo(F.pousseurs_thermiques),
        faits([`Ces ${fmt0(arrondi(fl.convois, 10))} convois par an émettraient `, fort(`${fourchetteCo2(fl.co2.bas, fl.co2.haut)} de CO₂`), `, en plus des ${fmt0(arrondi(co2Camions, 10))} t du détour des camions.`], [F.pousseur_conso.source]),
        faits([`Depuis le sud, en revanche, la barge remplace une partie de la route : depuis Écharcon, ${fmt1(SUD.km.acces_impose + KM_SEINE)} km par Ris-Orangis, contre ${fmt1(SUD.km.vitry)} km directement.`]),
        silence(F.public_fluvial),
      ] },
      { titre: 'D\'où viendront les déchets ?', messages: [
        pub(F.public_origine),
        mo(F.fournisseurs),
        mo(F.rn104),
        faits(['Tant que l\'origine n\'est pas connue, la ', lienPage('carte.html', 'carte du détour'), ' donne le résultat pour toutes les origines possibles.']),
        faits(['Avec l\'accès final imposé, Ris-Orangis est plus loin que Vitry pour ', fort(`${part(cellulesNord, g => g[5] - g[3] > 0)} %`), ' des points situés au nord de Vitry…']),
        faits(['… et plus proche pour ', fort(`${part(cellulesSud, g => g[5] - g[3] < 0)} %`), ' des points situés au sud de Ris-Orangis.']),
      ] },
      { titre: 'Et la pollution du transport ?', messages: [
        pub(F.public_bilan),
        silence(F.public_bilan),
        faits(['Le dossier ne chiffre ni les kilomètres parcourus par les camions ni leurs émissions.']),
        faits(['Nos calculs depuis le Plessis-Gassot : ', fort(`${fmt0(arrondi(co2Camions, 10))} t de CO₂ par an`), ' pour le seul détour des camions, et ', fort(fourchetteCo2(fl.co2.bas, fl.co2.haut)), ' pour les barges. Le détail est sur la page ', lienPage('./', 'Le grand détour'), '.'], [F.co2_gazole.source, F.pousseur_conso.source]),
      ] },
    ];

    const PARTICIPANTS = { public: { nom: 'Le public', initiales: 'P', ecrit: 'est' }, mo: { nom: 'Le maître d\'ouvrage', initiales: 'MO', ecrit: 'est' }, faits: { nom: 'Les faits', ecrit: 'sont' } };
    const frappe = () => el('span', { class: 'sms-frappe', 'aria-hidden': 'true' }, el('i'), el('i'), el('i'));
    const meta = sources => sources && sources.length
      ? el('span', { class: 'bulle-meta' }, sources.map((s, i) => [i ? ' ; ' : '', lien(s)])) : null;
    const message = (m, suite) => {
      if (m.qui === 'systeme') return el('div', { class: 'message message-systeme', 'data-qui': 'systeme' },
        el('p', { class: 'bulle-systeme' }, m.contenu, ' ', meta(m.sources)));
      const p = PARTICIPANTS[m.qui], envoye = m.qui === 'faits';
      const corps = m.cite ? el('blockquote', { class: 'bulle-texte' }, `« ${m.cite} »`) : el('p', { class: 'bulle-texte' }, m.contenu);
      return el('div', { class: `message ${envoye ? 'message-envoye' : 'message-recu'} de-${m.qui}${suite ? ' suite' : ''}`, 'data-qui': m.qui },
        envoye ? null : el('span', { class: 'wa-avatar', 'aria-hidden': 'true' }, p.initiales),
        frappe(),
        el('div', { class: 'bulle' },
          envoye ? el('span', { class: 'sr-only' }, 'Les faits : ') : el('span', { class: 'bulle-nom' }, p.nom, el('span', { class: 'sr-only' }, ' : ')),
          corps, meta(m.sources)));
    };
    const statut = el('span', { class: 'sms-entete-sous', 'aria-hidden': 'true' }, 'Le public, Le maître d\'ouvrage, Les faits');
    document.getElementById('cartes-confrontation').replaceChildren(
      el('div', { class: 'sms-entete' },
        el('span', { class: 'sms-avatar', 'aria-hidden': 'true' }, 'TS'),
        el('span', {}, el('strong', {}, 'Thermo-sur-Seine : le transport'), statut,
          el('span', { class: 'sr-only' }, 'Conversation de groupe entre le public, le maître d\'ouvrage et les faits.'))),
      // Notice, comme le bandeau d'information d'une messagerie : ce ne sont pas des messages inventés
      el('div', { class: 'message message-systeme lu' }, el('p', { class: 'bulle-systeme' },
        'Questions réelles du public (sans nom d\'auteur) et réponses du maître d\'ouvrage, citées mot pour mot avec leur source. « Les faits » répondent avec nos mesures et les chiffres du dossier.')),
      ...fils.map(f => el('section', { class: 'fil' },
        el('h2', { class: 'fil-sujet' }, f.titre),
        f.messages.map((m, i) => message(m, i > 0 && f.messages[i - 1].qui === m.qui)))));
    animerConversation(statut, PARTICIPANTS);
  }

  // Chaque échange se joue tout seul quand il apparaît à l'écran : « … est en train d'écrire » dans l'en-tête et dans la bulle,
  // puis le message, l'un après l'autre. Les bulles gardent leur place pendant l'animation (pas de saut de mise en page).
  // Sans IntersectionObserver ou avec « réduire les animations », tout reste affiché directement.
  function animerConversation(statut, participants) {
    if (!('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    document.documentElement.classList.add('sms-anime');
    const membres = statut.textContent;
    let enCours = 0;
    const attendre = ms => new Promise(r => setTimeout(r, ms));
    const jouer = async fil => {
      for (const m of fil.querySelectorAll('.message')) {
        const qui = m.dataset.qui;
        if (qui === 'systeme') {
          await attendre(500);
          m.classList.add('lu');
          continue;
        }
        enCours++;
        statut.textContent = `${participants[qui].nom} ${participants[qui].ecrit} en train d'écrire…`;
        m.classList.add('en-frappe');
        await attendre(Math.min(1300, 400 + m.querySelector('.bulle-texte').textContent.length * 2.5));
        m.classList.replace('en-frappe', 'lu');
        if (--enCours === 0) statut.textContent = membres;
        await attendre(250);
      }
    };
    const observateur = new IntersectionObserver(entrees => entrees.forEach(e => {
      if (!e.isIntersecting) return;
      observateur.unobserve(e.target);
      jouer(e.target);
    }), { rootMargin: '0px 0px -15% 0px' });
    document.querySelectorAll('.fil').forEach(f => observateur.observe(f));
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

  /* ---------------- Simulateur (sur une année) ---------------- */
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
      const fl = barges(tonnage), direct = moy(p => p.km.vitry), chaine = moy(p => p.km.acces_impose) + KM_SEINE;
      const cellule = (titre, a, b, note) => el('div', { class: 'tuile' },
        el('p', { class: 'tuile-label' }, titre),
        el('p', { class: 'tuile-valeur' }, a), b ? el('p', { class: 'tuile-note' }, b) : null, note ? el('p', { class: 'tuile-note' }, note) : null);
      document.getElementById('calc-variante').textContent =
        'Chaque résultat est donné pour les deux itinéraires vers Ris-Orangis : l\'accès final imposé (hypothèse la plus favorable au projet) et l\'itinéraire du dossier (RN104).';
      document.getElementById('calc-resultats').replaceChildren(
        cellule('Camions par an', fmt0(arrondi(n, 10)), `${fmt0(tonnage)} t ÷ ${fmt1(charge)} t par camion`),
        cellule('Détour moyen par trajet', `${signe1(det.acces)} km`, `itinéraire du dossier : ${signe1(det.dossier)} km`),
        cellule('Kilomètres en plus par an', `${signe0(arrondi(kmAn('acces'), 1000))} km`, `itinéraire du dossier : ${signe0(arrondi(kmAn('dossier'), 1000))} km`, 'aller et retour'),
        cellule('Heures de conduite en plus par an', `${signe0(arrondi(hAn('acces'), 10))} h`, `itinéraire du dossier : ${signe0(arrondi(hAn('dossier'), 10))} h`, 'au moins : temps de voiture'),
      ...(() => {
        const b = bilan(kmAn('acces'), hAn('acces')), bd = bilan(kmAn('dossier'), hAn('dossier'));
        return [
          cellule('Émissions de CO₂ en plus par an', `${signe0(arrondi(b.co2, 10))} t`, `itinéraire du dossier : ${signe0(arrondi(bd.co2, 10))} t`, `${signe0(arrondi(b.litres, 1000))} litres de gazole`),
          cellule('Gazole en plus par an', `${signe0(arrondi(b.carburant, 1000))} €`, `itinéraire du dossier : ${signe0(arrondi(bd.carburant, 1000))} €`, 'hors TVA, prix de décembre 2025'),
          cellule('Coût de transport en plus par an', `${signe0(arrondi(b.cout, 1000))} €`, `itinéraire du dossier : ${signe0(arrondi(bd.cout, 1000))} €`, 'camion et chauffeur, hors péages'),
        ];
      })(),
      // Volet fluvial : la barge s'ajoute au trajet des camions
      cellule('Distance parcourue par tonne', `${fmt1(chaine)} km`, `dont ${fmt0(KM_SEINE)} km de barge ; directement à Vitry : ${fmt1(direct)} km`, 'camion (accès final imposé) puis barge'),
      cellule('Convois de barges par an', fmt0(arrondi(fl.convois, 10)), `${fmt0(arrondi(fl.km, 100))} km de pousseur`, `${fmt0(T_PAR_BARGE)} t par barge, ${fmt0(F.trajet_fluvial.valeur)} km aller et retour`),
      cellule('CO₂ des barges par an', fourchetteCo2(fl.co2.bas, fl.co2.haut), 'à ajouter au CO₂ des camions', 'selon la puissance des pousseurs, non publiée'));
      document.getElementById('calc-formule').textContent =
        `Calcul : kilomètres en plus par an = camions par an × 2 (aller et retour) × détour moyen = ${fmt0(n)} × 2 × ${fmt1(det.acces)} km = ${fmt0(kmAn('acces'))} km (accès final imposé). Le retour se fait vers le point de départ, avec ou sans chargement. Le détour moyen est la moyenne des détours des origines ci-dessous, pondérée par leur part. `
        + `Litres de gazole = kilomètres × ${fmt1(F.consommation.valeur)} ÷ 100 ; CO₂ = litres × ${fmt1(F.co2_gazole.valeur)} kg ; gazole en euros = litres × ${fmt2(F.prix_gazole.valeur)} € ; coût de transport = kilomètres × ${fmtBrut(F.cout_km.valeur)} € + heures × ${fmt2(F.cout_heure.valeur)} €. `
        + `Barges : convois = tonnage ÷ ${fmt0(T_PAR_BARGE)} t = ${fmt0(fl.convois)} ; km de pousseur = convois × ${fmt0(F.trajet_fluvial.valeur)} km ; CO₂ = km × ${fmt2(F.pousseur_conso.valeurs.moins_590_kw)} à ${fmt2(F.pousseur_conso.valeurs['590_879_kw'])} litres par km × ${fmt2(F.co2_gnr.valeur)} kg. Le nombre de barges ne dépend pas des tonnes par camion.`;
      document.getElementById('calc-tableau').replaceChildren(el('div', { class: 'tableau-defilant' }, el('table', { class: 'tableau-donnees' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Origine'), el('th', {}, 'Part'), el('th', {}, 'Vers Vitry'),
          el('th', {}, 'Détour, accès imposé'), el('th', {}, 'Détour, dossier'), el('th', {}, 'Écart de temps, accès imposé'))),
        el('tbody', {}, lignes.map(({ p, w }) => el('tr', {},
          el('td', {}, el('a', { href: `carte.html#point=${p.id}` }, p.nom)),
          el('td', {}, `${fmt1(w * 100)} %`), el('td', {}, `${fmt1(p.km.vitry)} km`),
          el('td', {}, `${signe1(detour(p, 'acces'))} km`), el('td', {}, `${signe1(detour(p, 'dossier'))} km`),
          el('td', {}, p.ecart_min_median.acces != null ? `${signe0(p.ecart_min_median.acces)} min` : '—')))))));
    }
    document.getElementById('calc-constantes').replaceChildren(
      `Constantes : consommation de ${fmt1(F.consommation.valeur)} litres aux 100 km, gazole à ${fmt2(F.prix_gazole.valeur)} € le litre hors TVA, ${fmtBrut(F.cout_km.valeur)} € par km et ${fmt2(F.cout_heure.valeur)} € par heure de conduite (`,
      ...lienCnr('CNR, référentiel régional, décembre 2025'), `) ; ${fmt1(F.co2_gazole.valeur)} kg de CO₂ par litre de gazole, de l'extraction du pétrole au pot d'échappement (`,
      lien({ texte: 'ADEME, Base Carbone, élément 25775', url: F.co2_gazole.source.url }),
      '). Le prix du gazole a fortement augmenté en 2026 : les montants en euros sont sous-estimés. Les camions à fond mouvant consomment sans doute plus que la moyenne : tous ces chiffres sont prudents. ',
      `Barges : ${fmt2(F.pousseur_conso.valeurs.moins_590_kw)} à ${fmt2(F.pousseur_conso.valeurs['590_879_kw'])} litres de gazole non routier par km de convoi et ${fmt2(F.co2_gnr.valeur)} kg de CO₂ par litre (`,
      lienGuide('guide officiel « Information GES des prestations de transport », 2018'), `) ; ${fmt0(T_PAR_BARGE)} t par barge et ${fmt0(F.trajet_fluvial.valeur)} km aller et retour (`, lien(F.trajet_fluvial.source), '). Un pousseur par barge ; pousseurs de manœuvre et manutention non comptés.');
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
    document.querySelectorAll('[data-lie="limite-barges"]').forEach(n => n.replaceChildren(
      `Le trajet en barge (${fmt0(KM_SEINE)} km par tonne livrée) est ajouté au trajet des camions pour obtenir la distance de la chaîne complète. Son CO₂ est calculé par kilomètre de convoi, comme celui des camions : ${fmt2(F.pousseur_conso.valeurs.moins_590_kw)} à ${fmt2(F.pousseur_conso.valeurs['590_879_kw'])} litres de gazole non routier par km, car la puissance des pousseurs n'est pas publiée (`,
      lienGuide('guide « Information GES », 2018'), `). Les facteurs actuels de l'ADEME, par tonne-kilomètre, supposent des convois bien plus chargés : appliqués aux ${fmt0(T_PAR_BARGE)} t d'une barge de CSR, ils sous-estimeraient nettement. On suppose un pousseur par barge ; les pousseurs de manœuvre, la manutention (deux ruptures de charge) et une éventuelle motorisation électrique ne sont pas pris en compte.`));
    document.getElementById('tableau-parametres').replaceChildren(el('table', { class: 'parametres' }, el('tbody', {},
      [['Arrivée à Vitry', `${V.lat}, ${V.lon}`, 'Dossier p. 50 et 83'],
       ['Arrivée à Ris-Orangis', `${R.lat}, ${R.lon} + ${forfaitRis}`, 'Dossier p. 54, 55 et 87'],
       ['Passage D310 (Grigny)', `${PP.ACCES_D310.lat}, ${PP.ACCES_D310.lon}`, 'Dossier p. 87 ; question n° 63'],
       ['Passage RN104 est', `${PP.N104_EST.lat}, ${PP.N104_EST.lon}`, 'Dossier p. 87 ; question n° 118'],
       ['Passage RN104 ouest', `${PP.N104_OUEST.lat}, ${PP.N104_OUEST.lon}`, 'Dossier p. 87 ; question n° 118'],
       ['Heures de livraison', 'du lundi au vendredi, de 8 h à 20 h, hors jours fériés et hors août', 'Dossier p. 87'],
       ['Rayon d\'approvisionnement', `${M.grille.rayon_km} km au maximum`, 'Question n° 46'],
       ['Carrés masqués sur la carte', `${nbMasques} : ${GM.en_mer} en mer, ${GM.royaume_uni} au Royaume-Uni`, 'Natural Earth, 1:10m'],
       ['Consommation d\'un semi-remorque', `${fmt1(F.consommation.valeur)} L/100 km`, 'CNR, référentiel régional, échantillon 2025'],
       ['Prix du gazole', `${fmt2(F.prix_gazole.valeur)} €/L hors TVA`, 'CNR, décembre 2025'],
       ['Coût d\'un semi-remorque', `${fmtBrut(F.cout_km.valeur)} €/km + ${fmt2(F.cout_heure.valeur)} €/h`, 'CNR, hors péages'],
       ['CO₂ du gazole', `${fmt1(F.co2_gazole.valeur)} kg CO₂e/L`, 'ADEME, Base Carbone, élément 25775'],
       ['Barge', `${fmt0(T_PAR_BARGE)} t de CSR (2 500 m³ × ${fmt2(F.densite.valeur)} t/m³), ${fmt0(F.trajet_fluvial.valeur)} km aller et retour`, 'Dossier p. 56'],
       ['Consommation d\'un pousseur', `${fmt2(F.pousseur_conso.valeurs.moins_590_kw)} L/km (moins de 590 kW) à ${fmt2(F.pousseur_conso.valeurs['590_879_kw'])} L/km (590 à 879 kW)`, 'Guide « Information GES », 2018, tableau 12'],
       ['CO₂ du gazole non routier', `${fmt2(F.co2_gnr.valeur)} kg CO₂e/L`, 'Guide « Information GES », 2018, tableau 11 (Base Carbone)'],
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
      { texte: 'ADEME, Base Carbone : facteur d\'émission du gazole routier (élément 25775)', url: F.co2_gazole.source.url },
      { texte: 'Ministère, « Information GES des prestations de transport », guide méthodologique (2018) : consommation des pousseurs par km', url: F.pousseur_conso.source.url },
      { texte: 'ADEME et VNF, « Efficacités énergétiques et émissions unitaires du transport fluvial » (2019) : facteurs par tonne-kilomètre', url: 'https://entreprises-fluviales.fr/wp-content/uploads/2020/11/Rapport_efficacite_transport_fluvial_2019_ADEME.pdf' },
    ];
    document.getElementById('liste-sources').replaceChildren(...sources.map(s => el('li', {}, lien(s))),
      el('li', {}, lienCnr('Comité national routier : consommation, prix du gazole et coûts d\'un semi-remorque (référentiel régional, décembre 2025)')));
  }
})();
