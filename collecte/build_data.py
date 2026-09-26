"""
Prépare les données du site (data/donnees.json) à partir de la collecte (collecte/donnees/) et de
collecte/config_collecte.json.

    python collecte/build_data.py

Les fichiers bruts restent dans collecte/donnees/ : le site les propose en téléchargement directement.
"""

import os
import csv
import json
import statistics
from collections import defaultdict

COLLECTE = os.path.dirname(os.path.abspath(__file__))
RACINE = os.path.dirname(COLLECTE)
V2 = os.path.join(COLLECTE, "donnees")
OUT = os.path.join(RACINE, "data")

DOSSIER_URL = "https://www.debatpublic.fr/sites/default/files/2026-08/Thermo-sur-Seine_Dossier-de-concertation_Juillet2026_web.pdf"
Q_URL = "https://www.thermo-sur-seine-concertation.fr/posts/"


def dossier(page_imprimee):
    """Lien vers une page du dossier : la page PDF n contient les pages imprimées 2n-2 et 2n-1."""
    pdf = page_imprimee // 2 + 1
    return {"texte": f"Dossier de concertation, p. {page_imprimee}", "url": f"{DOSSIER_URL}#page={pdf}"}


def question(n, post):
    return {"texte": f"Question n° {n}", "url": Q_URL + str(post)}


def lire(nom):
    with open(os.path.join(V2, nom), encoding="utf-8-sig") as f:
        return list(csv.DictReader(f, delimiter=";"))


def km(v):
    return round(int(v) / 1000, 1) if v not in ("", None) else None


def dans_anneau(lon, lat, anneau):
    """Test du point dans un polygone (lancer de rayon)."""
    dedans, j = False, len(anneau) - 1
    for i in range(len(anneau)):
        (xi, yi), (xj, yj) = anneau[i], anneau[j]
        if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (yj - yi) + xi:
            dedans = not dedans
        j = i
    return dedans


def charger_pays(fichier):
    with open(os.path.join(COLLECTE, fichier), encoding="utf-8") as f:
        return [(ft["properties"]["ADM0_A3"], ft["geometry"]["coordinates"]) for ft in json.load(f)["features"]]


def pays_du_point(pays, lat, lon):
    """Code ISO du pays qui contient le point, ou None s'il est en mer."""
    for code, polygones in pays:
        for exterieur, *trous in polygones:
            if dans_anneau(lon, lat, exterieur) and not any(dans_anneau(lon, lat, t) for t in trous):
                return code
    return None


def main():
    with open(os.path.join(COLLECTE, "config_collecte.json"), encoding="utf-8") as f:
        cfg = json.load(f)
    origines = {o["id"]: o for o in lire("origines.csv")}
    distances = defaultdict(dict)
    for r in lire("distances.csv"):
        if r["statut"] == "OK":
            distances[r["origine_id"]][(r["destination"], r["variante"])] = r

    def dossier_km(d):
        vals = [(km(d[("RIS", v)]["distance_totale_m"]), v) for v in ("impose_est", "impose_ouest") if ("RIS", v) in d]
        return min(vals) if vals else (None, None)

    # --- Grille : [lat, lon, pas_km, vitry, rapide, acces, dossier, branche RN104 du dossier ("est" ou "ouest")]
    # Les carrés dont le centre est en mer ou au Royaume-Uni sont masqués (config_collecte.json > masque_grille).
    masque = cfg["masque_grille"]
    pays = charger_pays(masque["fichier"])
    grille, masques = [], []
    for oid, o in origines.items():
        if o["couche"] != "grille":
            continue
        d = distances.get(oid, {})
        if not all(k in d for k in (("VITRY", "rapide"), ("RIS", "rapide"), ("RIS", "acces_impose"))):
            continue
        dk, dv = dossier_km(d)
        pas = 5 if "pas 5 km" in o["details"] else 20
        lat, lon = float(o["lat"]), float(o["lon"])
        cellule = [lat, lon, pas, km(d[("VITRY", "rapide")]["distance_totale_m"]),
                   km(d[("RIS", "rapide")]["distance_totale_m"]), km(d[("RIS", "acces_impose")]["distance_totale_m"]), dk,
                   dv.split("_")[1] if dv else None]
        code = pays_du_point(pays, lat, lon)
        if code is None or code in masque["pays_exclus"]:
            masques.append((code, cellule))
        else:
            grille.append(cellule)
    detours_masques = [round(c[5] - c[3], 1) for _, c in masques]

    # --- Prévisions : par origine, liste de créneaux {jour, heure, vitry, acces, dossier} en minutes
    prev = defaultdict(lambda: defaultdict(dict))
    branche = {}
    for r in lire("previsions.csv"):
        if r["statut"] != "OK":
            continue
        cle = "vitry" if r["destination"] == "VITRY" else ("rapide" if r["variante"] == "rapide" else
                                                           "acces" if r["variante"] == "acces_impose" else "dossier")
        if cle == "dossier":
            branche[r["origine_id"]] = r["variante"]
        prev[r["origine_id"]][r["depart_local"]][cle] = round(int(r["duree_s"]) / 60, 1)

    # --- Origines détaillées (entrées et sites) avec tracés
    points = []
    for oid, o in origines.items():
        if o["couche"] == "grille":
            continue
        d = distances.get(oid, {})
        traces, dist, conf = {}, {}, {}
        for (dest, var), r in d.items():
            cle = "vitry" if dest == "VITRY" else var
            dist[cle] = km(r["distance_totale_m"])
            conf[cle] = r["acces_conforme"]
            if r["trace"]:
                with open(os.path.join(V2, r["trace"]), encoding="utf-8") as f:
                    traces[cle] = f.read().strip()
        dk, dv = dossier_km(d)
        creneaux = [{"t": t, **v} for t, v in sorted(prev[oid].items()) if {"vitry", "acces", "dossier"} <= v.keys()]
        points.append({
            "id": oid, "couche": o["couche"], "nom": o["nom"], "lat": float(o["lat"]), "lon": float(o["lon"]),
            "details": o["details"], "source": o["source"],
            "km": {**dist, "dossier": dk}, "branche_dossier": dv, "conforme": conf, "traces": traces,
            "previsions": creneaux,
            "ecart_min_median": {
                "acces": round(statistics.median(c["acces"] - c["vitry"] for c in creneaux), 1) if creneaux else None,
                "dossier": round(statistics.median(c["dossier"] - c["vitry"] for c in creneaux), 1) if creneaux else None,
            },
        })

    imp = cfg["itineraire_impose_ris"]
    donnees = {
        "meta": {
            "collecte": "26 septembre 2026, Google Routes API",
            "previsions": "semaine du 28 septembre au 2 octobre 2026, jours ouvrés, 8 h-20 h, modèle BEST_GUESS",
            "destinations": cfg["destinations"],
            "points_passage": imp["points_passage"],
            "variantes": imp["variantes_ris"],
            "variantes_note": imp["variantes_note"],
            "controle": imp["controle"],
            "livraisons": cfg["livraisons"],
            "grille": cfg["grille"],
            "grille_masque": {
                "en_mer": sum(1 for code, _ in masques if code is None),
                "royaume_uni": sum(1 for code, _ in masques if code == "GBR"),
                "detour_acces_min_km": min(detours_masques, default=None),
                "detour_acces_max_km": max(detours_masques, default=None),
                "raison": masque["raison"],
                "source": masque["source"],
            },
            "poids_arqp":{k: v for k, v in cfg["entrees_poids_arqp"].items() if k != "source"},
            "poids_arqp_source": cfg["entrees_poids_arqp"]["source"],
        },
        "faits": {
            "tonnage": {"valeur": 450000, "citation": "environ 450 000 tonnes de combustibles solides de récupération (CSR)", "source": dossier(65)},
            "barge": {"valeur": 28, "citation": "Chaque barge dispose d'une capacité d'emport équivalente à celle de 28 camions.", "source": dossier(56)},
            "barge_m3": {"valeur": 2500, "citation": "6 barges par jour, d'une capacité unitaire de 2 500 m³", "source": dossier(56)},
            "densite": {"valeur": 0.20, "calcul": "14 800 t ÷ 74 000 m³ (p. 56) = 3 750 t ÷ 18 750 m³ (p. 54) = 2 200 t ÷ 11 000 m³ (p. 44)", "source": dossier(56)},
            "t_par_camion": {"valeur": 17.9, "calcul": "2 500 m³ × 0,20 t/m³ = 500 t par barge ; 500 t ÷ 28 camions", "source": dossier(56)},
            "graphique_2035": {"valeurs": [163, 154, 148, 121, 96, 54, 33, 0, 42, 118, 154, 158], "note": "Lecture du graphique à ±3 près", "source": dossier(87)},
            "livraisons": {"citation": cfg["livraisons"]["source"].split(" : ", 1)[1], "source": dossier(87)},
            "itineraire": {"citation": "En amont, la RN104 constituera l'itinéraire d'accès principal des livraisons […]. Les camions emprunteront l'A6 puis la D310 pour rejoindre la RN7 sur une courte portion à Grigny (< 1 km)", "source": dossier(87)},
            "rn104": {"citation": "En amont, la RN104 constituera l'itinéraire d'accès principal des livraisons depuis les grands centres de préparation de CSR situés au nord de Paris, mais aussi depuis les centres situés au sud de Ris-Orangis.", "source": dossier(87)},
            "acces_final": {"citation": "Les camions emprunteront l'A6 puis la D310 pour rejoindre la RN7 sur une courte portion à Grigny (< 1 km) dans la zone d'activité industrielle et commerciale de la Plaine Basse, avant de rejoindre le chemin latéral à Ris-Orangis.", "source": dossier(87)},
            "trajet_terminal": {"citation": "A l'approche de la plateforme sur le trajet terminal, l'itinéraire imposé aux transporteurs serait, depuis la RN104, l'A6, la RD310, la RN7 pour 900 m […] puis le Chemin Latéral.", "source": question(118, 170646)},
            "carte_itineraires": {"constat": "La carte des itinéraires des poids lourds trace la RN104 à l'est et à l'ouest, l'A6 jusqu'à Grigny, mais aussi l'A6 au nord de Grigny, en direction de Paris.", "source": dossier(88)},
            "traversee": {"citation": "Aucun camion ne traversera Ris-Orangis.", "source": question(63, 169499)},
            "opposable": {"citation": "L'inscription des itinéraires dans l'arrêté préfectoral d'exploiter permet de rendre ces engagements opposables.", "source": question(118, 170646)},
            "foncier": {"citation": "Ce choix est dicté par l'impossibilité, sur le foncier de Vitry, d'accueillir une surface supplémentaire […] de l'ordre de 4 à 5 Ha, en sus des 6,7 Ha déjà occupés par la chaufferie.", "source": question(119, 170649)},
            "parcelle": {"citation": "La nouvelle chaufferie sera située sur une parcelle de 38 hectares appartenant à EDF", "source": dossier(48)},
            "congestion": {"citation": "ramener le gisement de CSR situé au nord de Paris par voies rapides (RN104) sans engorger les routes comme l'A86", "source": dossier(55)},
            "nord": {"citation": "depuis les grands centres de préparation de CSR situés au nord de Paris, mais aussi depuis les centres situés au sud de Ris-Orangis", "source": dossier(87)},
            "fournisseurs": {"citation": "La liste précise des fournisseurs de préparation de CSR et leurs implantations n'est pas arrêtée à ce stade du projet. La sélection des fournisseurs sera organisée dans le cadre d'une consultation à organiser en 2027", "source": question(46, 168716)},
            "rayon": {"citation": "Le concessionnaire est contractuellement engagé à s'approvisionner dans un rayon MAXIMAL de 300 km", "source": question(46, 168716)},
            "camions_texte": {"citation": "le trafic se stabilisera en moyenne entre 60 et 130 camions/jour selon la période", "source": dossier(87)},
            "transport_absent": {"constat": "Le dossier ne chiffre ni les kilomètres parcourus par les camions ni leurs émissions. La question posée sur ce point est toujours sans réponse au 26/09/2026.", "source": question(228, 172454)},
        },
        "points": points,
        "grille": grille,
    }
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "donnees.json"), "w", encoding="utf-8") as f:
        json.dump(donnees, f, ensure_ascii=False, separators=(",", ":"))
    taille = os.path.getsize(os.path.join(OUT, "donnees.json")) / 1024
    print(f"donnees.json : {len(points)} points détaillés, {len(grille)} cellules de grille, {taille:.0f} Ko")
    print(f"masquées : {len(masques)} cellules ({donnees['meta']['grille_masque']['en_mer']} en mer, "
          f"{donnees['meta']['grille_masque']['royaume_uni']} au Royaume-Uni)")


if __name__ == "__main__":
    main()
