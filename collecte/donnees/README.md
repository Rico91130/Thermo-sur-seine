# Données de la collecte v2 (26 septembre 2026)

Ces données ont été produites par [`collecte_v2.py`](../collecte_v2.py) avec l'API Routes de Google. Les paramètres, avec leurs sources, sont dans [`config_collecte.json`](../config_collecte.json). La justification du protocole est dans le [README du dépôt](../../README.md) et dans la section « Méthode » du site.

## Fichiers

| Fichier | Contenu |
|---|---|
| `origines.csv` | 1 157 points de départ, répartis en trois couches : `entree` (8 entrées d'autoroute, avec la pondération ARQP), `site` (28 installations CSR ou centres de tri, avec leur source) et `grille` (1 121 points dans un rayon de 300 km autour de Vitry : un point tous les 5 km jusqu'à 60 km, puis tous les 20 km) |
| `distances.csv` | Distances **sans trafic** : trajet le plus rapide vers Vitry et vers Ris-Orangis, plus les trois variantes contraintes vers Ris-Orangis |
| `previsions.csv` | Temps **prévus par Google** (trafic, modèle `BEST_GUESS`) pour les couches `entree` et `site`. Semaine du 28 septembre au 2 octobre 2026, du lundi au vendredi, toutes les heures de 8 h à 20 h (65 créneaux). Prévisions demandées le 26/09/2026 |
| `traces/*.txt` | Tracé encodé de chaque trajet des couches `entree` et `site`, au format « polyline » de Google |
| `requetes_distances.jsonl`, `requetes_previsions.jsonl` | Chaque requête envoyée : date, adresse, champs demandés, catégorie tarifaire, code HTTP et corps complet de la requête. La clé n'y figure pas |
| `requetes_distances_essai-ecarte_2026-09-26.jsonl` | 145 requêtes d'un premier essai (10:17-10:18). Ses résultats ont été **supprimés** : sans point de passage imposé sur la D310, certains trajets traversaient Ris-Orangis par la RN7, ce que le dossier exclut |
| `requetes_lignes-alterees_2026-09-26.txt` | 9 lignes de journal mélangées, parce que deux collectes écrivaient en même temps dans le même fichier. Cela ne touche pas les résultats, écrits dans des fichiers séparés. Le script a été corrigé : chaque commande a désormais son propre journal |
| `collecte_*.log` | Sortie console des collectes |

## Colonnes principales

- `variante` : pour Vitry, toujours `rapide`. Pour Ris-Orangis :
  - `rapide` : trajet que Google choisirait sans contrainte ; non retenu, car il ne respecte pas l'accès final décrit par le maître d'ouvrage (voir la colonne `acces_conforme`) ;
  - `acces_impose` : passage par A6 → D310 → RN7 → Chemin Latéral, l'hypothèse la plus favorable au projet ;
  - `impose_est` et `impose_ouest` : itinéraire du dossier par la RN104.
- `distance_totale_m` = `distance_m` + `forfait_m`. Le forfait vaut 1 380 m pour Ris-Orangis : c'est le trajet de l'entrée du Chemin Latéral jusqu'au portail. Il vaut 0 pour Vitry.
- `acces_conforme` : `oui` si le tracé passe à moins de 60 m du point de la D310. Cette colonne n'est remplie que pour les trajets vers Ris-Orangis calculés avec un tracé.
- `statut` : `OK`, `ROUTE_NOT_FOUND` ou `AUCUN_ITINERAIRE`. Les 60 points de la grille sans itinéraire sont probablement en mer.

## Carrés masqués sur la carte

Les fichiers de ce dossier sont complets. C'est `build_data.py` qui masque, sur la carte du site, les carrés de la grille dont le centre est en mer (20) ou au Royaume-Uni (11). Le test se fait sur les frontières et le trait de côte de Natural Earth (1:10m, domaine public), extraits dans [`terres_natural-earth.geojson`](../terres_natural-earth.geojson). La règle et sa justification sont dans [`config_collecte.json`](../config_collecte.json), à la clé `masque_grille`. Pour ces 31 carrés, Ris-Orangis était plus loin que Vitry (de +9,8 à +23,6 km avec l'accès final imposé) : le masque ne favorise donc pas la démonstration.

## Limites

- **Véhicule.** Google calcule des trajets en voiture : il ne propose pas de calcul poids lourd en France. Les temps sont donc des minimums pour un camion. Les distances restent valables si le camion emprunte le même itinéraire.
- **Choix d'itinéraire.** Google retient l'itinéraire le plus rapide, pas le plus court.
- **Vitry.** Aucune contrainte n'est imposée au trajet vers Vitry, puisque aucun itinéraire n'y est défini.
- **Itinéraire du dossier.** Le point de passage de la RN104 impose un sens de circulation (vers l'A6), mais la règle ne dit pas par où rejoindre la RN104. Google prend donc parfois un trajet avec demi-tour sur la RN104 (par exemple depuis l'entrée de l'A6 au sud, ou depuis le Plessis-Gassot par la branche ouest). Les variantes `impose_est` et `impose_ouest` sont à lire avec cette limite.
- **Prévisions.** Elles restent à valider : il faudra les comparer aux relevés en direct faits pendant la même semaine. Ces relevés seront publiés avec la validation.
