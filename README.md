# Le détour des camions — Thermo-sur-Seine

Site citoyen qui mesure ce que coûte, en kilomètres et en temps, le choix de livrer le combustible de la future chaufferie de Vitry-sur-Seine (projet Thermo-sur-Seine) par camion à **Ris-Orangis**, plutôt que directement à **Vitry**.

- **Site** : sept pages statiques publiées avec GitHub Pages : `index.html` (l'essentiel), `dossier.html`, `itineraires.html`, `carte.html`, `heures.html`, `annee.html` et `methode.html`. Elles partagent `style.css` et `app.js`, qui n'exécute que le code de la page affichée (`<body data-page="…">`). Ces pages HTML sont **générées** : voir « Modifier les pages » ci-dessous.
- **Données et code de la mesure** : dossier [`collecte/`](collecte/).
- **Principe** : chaque chiffre renvoie à sa source (page du dossier de concertation, question publiée sur la plateforme de la concertation), et chaque mesure peut être refaite par n'importe qui.

## Ce qui est mesuré

Les trajets sont calculés par Google Maps Platform (API Routes) le 26 septembre 2026. Tous les paramètres sont dans [`collecte/config_collecte.json`](collecte/config_collecte.json), avec leur source.

| Élément | Choix | Source |
|---|---|---|
| Arrivée à Vitry | Entrée du site EDF depuis la rue des Fusillés | Dossier de concertation, p. 50 et 83 |
| Arrivée à Ris-Orangis | Entrée du Chemin Latéral depuis la RN7 à Grigny, plus 1,38 km jusqu'au portail des camions | Dossier, p. 54, 55 et 87 |
| Itinéraires vers Ris-Orangis | Trois variantes. **Le plus rapide** : minimum géographique, mais non autorisé car il traverse des zones urbaines. **L'accès final imposé** : A6 → D310 → RN7 → Chemin Latéral, l'hypothèse la plus favorable au projet. **L'itinéraire du dossier** : RN104 → A6 → D310 → RN7 → Chemin Latéral | Dossier, p. 87 ; questions [n° 63](https://www.thermo-sur-seine-concertation.fr/posts/169499) et [n° 118](https://www.thermo-sur-seine-concertation.fr/posts/170646) |
| Points de départ | 8 entrées d'autoroute en Île-de-France ; 28 installations de préparation de CSR ou de tri, chacune sourcée ; une grille de 1 121 points dans le rayon d'approvisionnement de 300 km. Sur la carte, les carrés dont le centre est en mer ou au Royaume-Uni sont masqués (frontières de Natural Earth) ; ils restent dans les données | Question [n° 46](https://www.thermo-sur-seine-concertation.fr/posts/168716) |
| Heures | Du lundi au vendredi, de 8 h à 20 h, hors jours fériés et hors août | Dossier, p. 87 |

**Limites.**
- **Véhicule.** Google ne calcule pas d'itinéraire poids lourd en France. Les temps sont ceux d'une voiture, donc des minimums pour un camion.
- **Vitry.** Aucun itinéraire n'est imposé vers Vitry.
- **Itinéraire du dossier.** La règle ne dit pas par où rejoindre la RN104. Google prend le trajet le plus rapide qui passe par le point imposé, dans le sens imposé, même si cela suppose un demi-tour sur la RN104.
- **Prévisions.** Les temps prévus restent à valider par des relevés en direct.
- **Liens « Vérifier ».** Ils transmettent les points de passage à Google Maps sous forme d'étapes, sans sens de circulation : un petit écart avec la mesure reste possible.

Le détail est dans [`collecte/donnees/README.md`](collecte/donnees/README.md).

## Refaire la mesure

Il faut Python 3.10 ou plus, et une clé Google Maps Platform avec l'API Routes activée.

```bash
pip install -r collecte/requirements.txt
cp .env.example .env                                   # puis y mettre votre clé
python collecte/collecte_v2.py origines                # construit les 1 157 points de départ
python collecte/collecte_v2.py distances               # affiche le nombre de requêtes et le coût estimé
python collecte/collecte_v2.py distances --go          # lance la collecte
python collecte/collecte_v2.py previsions --semaine 2026-10-05 --go
python collecte/build_data.py                          # régénère data/donnees.json pour le site
```

Sans l'option `--go`, rien n'est envoyé à Google : le script affiche seulement le nombre de requêtes et leur coût estimé. Chaque requête envoyée est journalisée, sans la clé, dans `collecte/donnees/requetes_*.jsonl`.

## Modifier les pages

L'en-tête, le menu et le pied de page ne sont écrits qu'une fois. Les pages HTML de la racine sont construites à partir de :
- [`pages/gabarit.html`](pages/gabarit.html) : en-tête, menu et pied de page, communs à toutes les pages ;
- [`pages/contenu/`](pages/contenu/) : le contenu propre à chaque page, précédé de son titre et de sa description ;
- [`pages/construire_pages.py`](pages/construire_pages.py) : l'ordre et les libellés du menu.

Après une modification de ces fichiers :

```bash
python pages/construire_pages.py              # régénère les sept pages
python pages/construire_pages.py --verifier   # avant un commit : vérifie qu'aucune page n'a été modifiée à la main ou oubliée
```

Ne modifiez pas directement `index.html`, `carte.html`, etc. : la prochaine construction écraserait la modification.

## Voir le site en local

La page charge `data/donnees.json` : il faut donc la servir avec un petit serveur web, et non l'ouvrir directement comme fichier.

```bash
python -m http.server 8000
# puis ouvrir http://localhost:8000/
```

Le fond de carte vient de l'IGN (Géoplateforme) et ne demande aucune clé. Le site n'appelle jamais Google quand on le consulte. Les liens « Vérifier » ouvrent simplement Google Maps avec le même trajet.

## Signaler une erreur

Ouvrez un [ticket](https://github.com/Rico91130/Thermo-sur-seine/issues). Toute erreur fondée sera corrigée publiquement.

## Mentions

- **Indépendance.** Site citoyen indépendant, sans lien avec la SEMOP, la Ville de Paris ou Google.
- **Éditeur.** Éditeur non professionnel ayant choisi de rester anonyme (article 6-III-2 de la loi n° 2004-575 pour la confiance dans l'économie numérique).
- **Hébergeur.** GitHub, Inc., 88 Colin P. Kelly Jr. Street, San Francisco, CA 94107, États-Unis.
- **Crédits.** Fond de carte © IGN – Géoplateforme. Itinéraires : Google Maps Platform. Frontières et trait de côte : Natural Earth (domaine public). Animations de la page d'accueil : GSAP et ScrollTrigger (licence « Standard no-charge », chargés depuis jsdelivr).
- **Licence.** Le code est sous licence MIT ([`LICENSE`](LICENSE)). Les données et les textes produits pour ce projet sont sous licence CC BY 4.0 ([`LICENCE-DONNEES.md`](LICENCE-DONNEES.md)). Les résultats bruts de Google, le fond de carte IGN et les citations restent soumis aux droits de leurs auteurs.
