"""
Collecte v2 des distances et temps de parcours vers Vitry-sur-Seine et Ris-Orangis (Google Routes API).

Les paramètres et leurs sources sont dans config_collecte.json. La clé Google se place dans un fichier .env
à la racine du dépôt (voir .env.example) ; elle n'est jamais journalisée.

Commandes (depuis la racine du dépôt) :
  python collecte/collecte_v2.py origines
      Construit collecte/donnees/origines.csv, qui réunit trois couches :
      grille (rayon de 300 km autour de Vitry), site (sites_csr.csv), entree (entrees_autoroute.csv).
  python collecte_v2.py test
      Envoie une seule requête de contrôle : entrée A1 vers Ris-Orangis par l'itinéraire imposé, branche est.
  python collecte_v2.py distances [--couches grille,site,entree] [--go]
      Distances sans trafic : itinéraire le plus rapide vers Vitry et vers Ris-Orangis, et les variantes
      contraintes vers Ris-Orangis (config_collecte.json > variantes_ris) : accès final imposé par la D310,
      et itinéraire du dossier par la RN104 est ou ouest.
  python collecte_v2.py previsions --semaine AAAA-MM-JJ [--pas 60] [--modeles BEST_GUESS] [--couches site,entree] [--go]
      Temps prévus par Google pour chaque créneau de livraison (jours ouvrés, 8 h-20 h, hors fériés et hors août).

Sans --go, les commandes de collecte affichent seulement le nombre de requêtes et le coût estimé.
Toutes les requêtes envoyées sont journalisées, sans la clé, dans collecte/donnees/requetes_<commande>.jsonl.
"""

import os
import sys
import csv
import json
import math
import time
import argparse
import datetime
import requests
from dotenv import load_dotenv

BASE_DIR = os.path.dirname(os.path.abspath(__file__))       # dossier collecte/
RACINE = os.path.dirname(BASE_DIR)
load_dotenv(os.path.join(RACINE, ".env"))
GOOGLE_MAPS_API_KEY = os.environ.get("GOOGLE_MAPS_API_KEY", "")

CONFIG_PATH = os.path.join(BASE_DIR, "config_collecte.json")
SITES_CSV = os.path.join(BASE_DIR, "sites_csr.csv")
ENTREES_CSV = os.path.join(BASE_DIR, "entrees_autoroute.csv")
OUT_DIR = os.path.join(BASE_DIR, "donnees")
ORIGINES_CSV = os.path.join(OUT_DIR, "origines.csv")
DISTANCES_CSV = os.path.join(OUT_DIR, "distances.csv")
PREVISIONS_CSV = os.path.join(OUT_DIR, "previsions.csv")
TRACES_DIR = os.path.join(OUT_DIR, "traces")
# Un journal par commande : deux collectes lancées en parallèle ne doivent pas écrire dans le même fichier
LOG_PATH = os.path.join(OUT_DIR, "requetes.jsonl")

URL_ROUTES = "https://routes.googleapis.com/directions/v2:computeRoutes"
URL_MATRIX = "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix"
MASK_ROUTES = ("routes.distanceMeters,routes.duration,routes.staticDuration,"
               "routes.description,routes.polyline.encodedPolyline,routes.warnings")
MASK_MATRIX = "originIndex,destinationIndex,status,condition,distanceMeters,duration,staticDuration"

COLS_DISTANCES = ["horodatage_requete", "origine_id", "couche", "destination", "variante", "methode", "statut",
                  "distance_m", "forfait_m", "distance_totale_m", "duree_sans_trafic_s", "description",
                  "acces_conforme", "trace"]
COLS_PREVISIONS = ["horodatage_requete", "origine_id", "couche", "destination", "variante", "depart_local",
                   "modele_trafic", "statut", "distance_m", "forfait_m", "distance_totale_m",
                   "duree_s", "duree_sans_trafic_s"]


def load_config():
    with open(CONFIG_PATH, encoding="utf-8") as f:
        return json.load(f)


# ---------------------------------------------------------------------------
# Géométrie
# ---------------------------------------------------------------------------

def haversine_m(lat1, lon1, lat2, lon2):
    r = 6371008.8
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def decode_polyline(encoded):
    """Décode une polyline encodée Google en liste de (lat, lon)."""
    points, index, lat, lon = [], 0, 0, 0
    while index < len(encoded):
        for is_lon in (False, True):
            shift, result = 0, 0
            while True:
                b = ord(encoded[index]) - 63
                index += 1
                result |= (b & 0x1F) << shift
                shift += 5
                if b < 0x20:
                    break
            delta = ~(result >> 1) if result & 1 else result >> 1
            if is_lon:
                lon += delta
            else:
                lat += delta
        points.append((lat / 1e5, lon / 1e5))
    return points


def distance_point_trace_m(lat, lon, points):
    """Distance minimale (m) entre un point et une trace (segments), en projection locale."""
    kx = 111320.0 * math.cos(math.radians(lat))
    ky = 110540.0
    best = float("inf")
    for (a_lat, a_lon), (b_lat, b_lon) in zip(points, points[1:]):
        ax, ay = (a_lon - lon) * kx, (a_lat - lat) * ky
        bx, by = (b_lon - lon) * kx, (b_lat - lat) * ky
        dx, dy = bx - ax, by - ay
        L2 = dx * dx + dy * dy
        t = 0.0 if L2 == 0 else max(0.0, min(1.0, -(ax * dx + ay * dy) / L2))
        px, py = ax + t * dx, ay + t * dy
        best = min(best, math.hypot(px, py))
    return best


# ---------------------------------------------------------------------------
# Calendrier des livraisons (heure de Paris, jours fériés français)
# ---------------------------------------------------------------------------

def paques(annee):
    a, b, c = annee % 19, annee // 100, annee % 100
    d, e = b // 4, b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = c // 4, c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    mois = (h + l - 7 * m + 114) // 31
    jour = ((h + l - 7 * m + 114) % 31) + 1
    return datetime.date(annee, mois, jour)


def jours_feries(annee):
    p = paques(annee)
    fixes = [(1, 1), (5, 1), (5, 8), (7, 14), (8, 15), (11, 1), (11, 11), (12, 25)]
    return {datetime.date(annee, m, j) for m, j in fixes} | {
        p + datetime.timedelta(days=1), p + datetime.timedelta(days=39), p + datetime.timedelta(days=50)}


def decalage_paris(dt_local):
    """Décalage UTC de Paris : +2 h entre le dernier dimanche de mars et le dernier dimanche d'octobre, +1 h sinon."""
    def dernier_dimanche(annee, mois):
        d = datetime.date(annee, mois + 1, 1) - datetime.timedelta(days=1)
        return d - datetime.timedelta(days=(d.weekday() + 1) % 7)
    debut = datetime.datetime.combine(dernier_dimanche(dt_local.year, 3), datetime.time(2, 0))
    fin = datetime.datetime.combine(dernier_dimanche(dt_local.year, 10), datetime.time(3, 0))
    return datetime.timedelta(hours=2 if debut <= dt_local < fin else 1)


def rfc3339_utc(dt_local):
    return (dt_local - decalage_paris(dt_local)).strftime("%Y-%m-%dT%H:%M:%SZ")


def creneaux_livraison(cfg, lundi, pas_min):
    """Créneaux de livraison de la semaine commençant le lundi donné, en heure locale de Paris."""
    liv = cfg["livraisons"]
    h0, m0 = map(int, liv["heure_debut"].split(":"))
    h1, m1 = map(int, liv["heure_fin"].split(":"))
    feries = jours_feries(lundi.year) | jours_feries(lundi.year + 1)
    out = []
    for j in range(7):
        jour = lundi + datetime.timedelta(days=j)
        if jour.weekday() not in liv["jours_semaine"]:
            continue
        if liv["exclure_feries"] and jour in feries:
            continue
        if liv["exclure_aout"] and jour.month == 8:
            continue
        t = datetime.datetime.combine(jour, datetime.time(h0, m0))
        fin = datetime.datetime.combine(jour, datetime.time(h1, m1))
        while t <= fin:
            out.append(t)
            t += datetime.timedelta(minutes=pas_min)
    return out


# ---------------------------------------------------------------------------
# Origines
# ---------------------------------------------------------------------------

def construire_grille(cfg):
    g = cfg["grille"]
    c = cfg["destinations"][g["centre"]]
    kx = 111.320 * math.cos(math.radians(c["lat"]))
    ky = 110.540
    pts = []
    for pas, rmin, rmax in ((g["pas_proche_km"], 0, g["rayon_proche_km"]),
                            (g["pas_loin_km"], g["rayon_proche_km"], g["rayon_km"])):
        n = int(rmax // pas)
        for i in range(-n, n + 1):
            for j in range(-n, n + 1):
                ex, ny = i * pas, j * pas
                r = math.hypot(ex, ny)
                if (rmin == 0 and r <= rmax) or (rmin < r <= rmax):
                    pts.append({
                        "id": f"G{ex:+04d}{ny:+04d}",
                        "couche": "grille",
                        "nom": f"Grille {ex:+d} km est / {ny:+d} km nord de Vitry",
                        "lat": round(c["lat"] + ny / ky, 5),
                        "lon": round(c["lon"] + ex / kx, 5),
                        "details": f"pas {pas} km ; {r:.0f} km de Vitry à vol d'oiseau",
                        "source": "Grille régulière, config_collecte.json > grille",
                    })
    return pts


def charger_sites():
    with open(SITES_CSV, encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f, delimiter=";"))
    return [{
        "id": r["id"],
        "couche": "site",
        "nom": r["nom"],
        "lat": float(r["lat"]),
        "lon": float(r["lon"]),
        "details": f"{r['categorie']} ; confiance : {r['confiance']} ; coordonnées : {r['origine_coordonnees']}",
        "source": r["source_url"],
    } for r in rows if r["lat"] and r["lon"]]


def charger_entrees(cfg):
    poids = cfg["entrees_poids_arqp"]
    with open(ENTREES_CSV, encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f, delimiter=";"))
    return [{
        "id": f"E_{r['autoroute']}",
        "couche": "entree",
        "nom": f"Entrée {r['autoroute']} ({r['commune']})",
        "lat": float(r["lat"]),
        "lon": float(r["lon"]),
        "details": f"poids ARQP {poids.get(r['autoroute'], '')} %",
        "source": poids["source"],
    } for r in rows]


def cmd_origines(cfg):
    os.makedirs(OUT_DIR, exist_ok=True)
    origines = charger_entrees(cfg) + charger_sites() + construire_grille(cfg)
    with open(ORIGINES_CSV, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["id", "couche", "nom", "lat", "lon", "details", "source"], delimiter=";")
        w.writeheader()
        w.writerows(origines)
    par_couche = {}
    for o in origines:
        par_couche[o["couche"]] = par_couche.get(o["couche"], 0) + 1
    print(f"{len(origines)} origines écrites dans {os.path.relpath(ORIGINES_CSV, RACINE)} : {par_couche}")


def lire_origines(couches):
    if not os.path.exists(ORIGINES_CSV):
        sys.exit("Lancer d'abord : python collecte_v2.py origines")
    with open(ORIGINES_CSV, encoding="utf-8-sig") as f:
        rows = [r for r in csv.DictReader(f, delimiter=";") if r["couche"] in couches]
    for r in rows:
        r["lat"], r["lon"] = float(r["lat"]), float(r["lon"])
    return rows


# ---------------------------------------------------------------------------
# Appels Google Routes API
# ---------------------------------------------------------------------------

def latlng(lat, lon, cap=None):
    loc = {"latLng": {"latitude": lat, "longitude": lon}}
    if cap is not None:
        loc["heading"] = int(cap)
    return {"location": loc}


def journaliser(entree):
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(LOG_PATH, "a", encoding="utf-8") as f:
        f.write(json.dumps(entree, ensure_ascii=False) + "\n")


def appel(url, body, mask, sku, n_evenements):
    """POST vers l'API Routes avec 3 tentatives ; la requête (sans clé) est journalisée."""
    headers = {"X-Goog-Api-Key": GOOGLE_MAPS_API_KEY, "X-Goog-FieldMask": mask, "Content-Type": "application/json"}
    for tentative in range(3):
        horodatage = datetime.datetime.now().isoformat(timespec="seconds")
        try:
            r = requests.post(url, json=body, headers=headers, timeout=60)
            statut, contenu = r.status_code, (r.json() if r.content else {})
        except (requests.RequestException, ValueError) as e:
            statut, contenu = None, {"erreur": str(e)}
        journaliser({"horodatage": horodatage, "url": url, "field_mask": mask, "sku": sku,
                     "evenements": n_evenements, "http": statut, "corps": body,
                     "erreur": contenu.get("error") if isinstance(contenu, dict) else None})
        if statut == 200:
            return horodatage, contenu
        if statut in (429, 500, 502, 503, 504) or statut is None:
            time.sleep(2 ** (tentative + 1))
            continue
        raise RuntimeError(f"Erreur API Routes ({statut}) : {json.dumps(contenu, ensure_ascii=False)[:500]}")
    raise RuntimeError("Erreur API Routes : échec après 3 tentatives")


def secondes(v):
    return int(float(v.rstrip("s"))) if v else None


def points_variante(cfg, variante):
    """Points de passage (dans l'ordre) de la variante d'itinéraire vers Ris-Orangis."""
    imp = cfg["itineraire_impose_ris"]
    return [imp["points_passage"][k] for k in imp["variantes_ris"][variante]]


def calculer_itineraire(origine, dest, cfg, passages=(), depart=None, modele=None):
    """computeRoutes : renvoie (horodatage, dict résultat)."""
    d = cfg["destinations"][dest]
    body = {"origin": latlng(origine["lat"], origine["lon"]), "destination": latlng(d["lat"], d["lon"]),
            "travelMode": "DRIVE", "languageCode": "fr-FR", "regionCode": "FR", "units": "METRIC"}
    if passages:
        body["intermediates"] = [{**latlng(p["lat"], p["lon"], p["cap"]), "via": True} for p in passages]
    if depart:
        body.update({"routingPreference": "TRAFFIC_AWARE_OPTIMAL", "departureTime": rfc3339_utc(depart),
                     "trafficModel": modele})
        sku = "ROUTES_PRO"
    else:
        body["routingPreference"] = "TRAFFIC_UNAWARE"
        sku = "ROUTES_ESSENTIALS"
    horodatage, rep = appel(URL_ROUTES, body, MASK_ROUTES, sku, 1)
    routes = rep.get("routes") or []
    if not routes:
        return horodatage, {"statut": "AUCUN_ITINERAIRE"}
    rt = routes[0]
    res = {"statut": "OK", "distance_m": rt.get("distanceMeters", 0), "duree_s": secondes(rt.get("duration")),
           "duree_sans_trafic_s": secondes(rt.get("staticDuration")), "description": rt.get("description", ""),
           "polyline": rt.get("polyline", {}).get("encodedPolyline", "")}
    if dest == "RIS" and res["polyline"]:
        imp = cfg["itineraire_impose_ris"]
        p = imp["points_passage"][imp["controle"]["point"]]
        dist = distance_point_trace_m(p["lat"], p["lon"], decode_polyline(res["polyline"]))
        res["acces_conforme"] = "oui" if dist <= imp["controle"]["tolerance_m"] else f"non ({dist:.0f} m)"
    return horodatage, res


def calculer_matrice(origines, dests, cfg, depart=None, modele=None):
    """computeRouteMatrix : renvoie (horodatage, {(i_origine, destination): résultat})."""
    body = {"origins": [{"waypoint": latlng(o["lat"], o["lon"])} for o in origines],
            "destinations": [{"waypoint": latlng(cfg["destinations"][d]["lat"], cfg["destinations"][d]["lon"])}
                             for d in dests],
            "travelMode": "DRIVE", "languageCode": "fr-FR", "regionCode": "FR", "units": "METRIC"}
    if depart:
        body.update({"routingPreference": "TRAFFIC_AWARE_OPTIMAL", "departureTime": rfc3339_utc(depart),
                     "trafficModel": modele})
        sku = "MATRIX_PRO"
    else:
        body["routingPreference"] = "TRAFFIC_UNAWARE"
        sku = "MATRIX_ESSENTIALS"
    horodatage, rep = appel(URL_MATRIX, body, MASK_MATRIX, sku, len(origines) * len(dests))
    out = {}
    for el in rep if isinstance(rep, list) else []:
        cle = (el.get("originIndex", 0), dests[el.get("destinationIndex", 0)])
        if el.get("condition") == "ROUTE_EXISTS" and not el.get("status", {}).get("code"):
            out[cle] = {"statut": "OK", "distance_m": el.get("distanceMeters", 0),
                        "duree_s": secondes(el.get("duration")),
                        "duree_sans_trafic_s": secondes(el.get("staticDuration"))}
        else:
            out[cle] = {"statut": el.get("condition") or json.dumps(el.get("status"))}
    return horodatage, out


# ---------------------------------------------------------------------------
# Écriture des résultats
# ---------------------------------------------------------------------------

def deja_faits(path, cles):
    if not os.path.exists(path):
        return set()
    with open(path, encoding="utf-8-sig") as f:
        return {tuple(r[k] for k in cles) for r in csv.DictReader(f, delimiter=";")}


def ajouter_ligne(path, cols, ligne):
    nouveau = not os.path.exists(path)
    with open(path, "a", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols, delimiter=";", extrasaction="ignore")
        if nouveau:
            w.writeheader()
        w.writerow(ligne)


def ligne_resultat(origine, dest, variante, cfg, res):
    forfait = cfg["destinations"][dest]["forfait_m"]
    ok = res.get("statut") == "OK"
    return {"origine_id": origine["id"], "couche": origine["couche"], "destination": dest, "variante": variante,
            "statut": res.get("statut"),
            "distance_m": res.get("distance_m", "") if ok else "",
            "forfait_m": forfait if ok else "",
            "distance_totale_m": res["distance_m"] + forfait if ok else "",
            "duree_s": res.get("duree_s", "") if ok else "",
            "duree_sans_trafic_s": res.get("duree_sans_trafic_s", "") if ok else "",
            "description": res.get("description", ""), "acces_conforme": res.get("acces_conforme", "")}


# ---------------------------------------------------------------------------
# Estimation du coût
# ---------------------------------------------------------------------------

def afficher_estimation(cfg, evenements):
    t = cfg["tarifs"]
    print("\nEstimation (tarifs " + t["source"] + ") :")
    total = 0.0
    for sku, n in evenements.items():
        franchise = t["franchise_mensuelle"][sku]
        cout = max(0, n - franchise) * t["usd_pour_1000"][sku] / 1000
        total += cout
        print(f"  {sku:<18} {n:>7} événements ; franchise mensuelle {franchise} ; "
              f"coût au-delà ≈ {cout:.2f} $")
    print(f"  TOTAL ≈ {total:.2f} $, si rien d'autre n'a consommé ces franchises ce mois-ci.")
    print("  (La franchise est mensuelle et commune à tout le compte de facturation.)\n")


# ---------------------------------------------------------------------------
# Commandes de collecte
# ---------------------------------------------------------------------------

def cmd_test(cfg):
    o = {"id": "E_A1", "couche": "entree", "lat": 49.1237, "lon": 2.5568}
    _, res = calculer_itineraire(o, "RIS", cfg, passages=points_variante(cfg, "impose_est"))
    res.pop("polyline", None)
    print(json.dumps(res, ensure_ascii=False, indent=1))


def cmd_distances(cfg, couches, go):
    origines = lire_origines(couches)
    faits = deja_faits(DISTANCES_CSV, ["origine_id", "destination", "variante"])
    variantes_contraintes = [v for v in cfg["itineraire_impose_ris"]["variantes_ris"] if v != "rapide"]
    grille = [o for o in origines if o["couche"] == "grille"]
    autres = [o for o in origines if o["couche"] != "grille"]

    # Grille : matrice, sans tracé. Autres couches : un itinéraire par trajet, avec tracé enregistré.
    a_faire_matrice = [o for o in grille if any((o["id"], d, "rapide") not in faits for d in ("VITRY", "RIS"))]
    a_faire_routes = [(o, d, "rapide") for o in autres for d in ("VITRY", "RIS")
                      if (o["id"], d, "rapide") not in faits]
    a_faire_routes += [(o, "RIS", v) for o in origines for v in variantes_contraintes
                       if (o["id"], "RIS", v) not in faits]
    ev = {"MATRIX_ESSENTIALS": 2 * len(a_faire_matrice), "ROUTES_ESSENTIALS": len(a_faire_routes)}
    print(f"Origines : {len(origines)} ({', '.join(couches)}) ; matrice : {len(a_faire_matrice)} origines ; "
          f"itinéraires : {len(a_faire_routes)}")
    afficher_estimation(cfg, ev)
    if not go:
        print("Rien n'a été envoyé. Relancer avec --go pour exécuter.")
        return
    os.makedirs(TRACES_DIR, exist_ok=True)

    for i in range(0, len(a_faire_matrice), 312):  # 312 origines × 2 destinations ≤ 625 éléments
        lot = a_faire_matrice[i:i + 312]
        horodatage, res = calculer_matrice(lot, ["VITRY", "RIS"], cfg)
        for j, o in enumerate(lot):
            for d in ("VITRY", "RIS"):
                ligne = ligne_resultat(o, d, "rapide", cfg, res.get((j, d), {"statut": "ABSENT"}))
                ligne.update({"horodatage_requete": horodatage, "methode": "matrice"})
                ajouter_ligne(DISTANCES_CSV, COLS_DISTANCES, ligne)
        print(f"  matrice : {min(i + 312, len(a_faire_matrice))}/{len(a_faire_matrice)} origines")

    for n, (o, d, variante) in enumerate(a_faire_routes, 1):
        passages = points_variante(cfg, variante) if d == "RIS" else ()
        horodatage, res = calculer_itineraire(o, d, cfg, passages=passages)
        ligne = ligne_resultat(o, d, variante, cfg, res)
        ligne.update({"horodatage_requete": horodatage, "methode": "itineraire"})
        if res.get("polyline") and o["couche"] != "grille":
            nom = f"{o['id']}_{d}_{variante}.txt"
            with open(os.path.join(TRACES_DIR, nom), "w", encoding="utf-8") as f:
                f.write(res["polyline"])
            ligne["trace"] = "traces/" + nom
        ajouter_ligne(DISTANCES_CSV, COLS_DISTANCES, ligne)
        if n % 50 == 0 or n == len(a_faire_routes):
            print(f"  itinéraires : {n}/{len(a_faire_routes)}")
        time.sleep(0.05)
    print(f"Terminé : {os.path.relpath(DISTANCES_CSV, RACINE)}")


def meilleure_branche(origine_id):
    """Branche de la RN104 (est/ouest) donnant la plus courte distance imposée pour cette origine."""
    best = None
    with open(DISTANCES_CSV, encoding="utf-8-sig") as f:
        for r in csv.DictReader(f, delimiter=";"):
            if r["origine_id"] == origine_id and r["variante"].startswith("impose_") and r["statut"] == "OK":
                if best is None or int(r["distance_m"]) < best[1]:
                    best = (r["variante"], int(r["distance_m"]))
    return best[0] if best else None


def cmd_previsions(cfg, couches, semaine, pas, modeles, go):
    jour = datetime.date.fromisoformat(semaine)
    lundi = jour - datetime.timedelta(days=jour.weekday())
    maintenant = datetime.datetime.now()
    departs = [d for d in creneaux_livraison(cfg, lundi, pas) if d > maintenant + datetime.timedelta(minutes=10)]
    origines = lire_origines(couches)
    if not os.path.exists(DISTANCES_CSV):
        sys.exit("Lancer d'abord : python collecte_v2.py distances --couches " + ",".join(couches) + " --go")
    branches = {o["id"]: meilleure_branche(o["id"]) for o in origines}
    sans = [k for k, v in branches.items() if not v]
    if sans:
        sys.exit(f"Distances imposées manquantes pour : {sans[:10]}… Lancer d'abord la commande distances.")
    faits = deja_faits(PREVISIONS_CSV, ["origine_id", "destination", "variante", "depart_local", "modele_trafic"])

    # Pour chaque origine : l'accès final imposé seul, et l'itinéraire du dossier par la meilleure branche de la RN104
    n_el = len(origines) * 2
    ev = {"MATRIX_PRO": n_el * len(departs) * len(modeles),
          "ROUTES_PRO": 2 * len(origines) * len(departs) * len(modeles)}
    print(f"Semaine du {lundi} : {len(departs)} créneaux (pas de {pas} min) ; {len(origines)} origines ; "
          f"modèles {modeles}")
    afficher_estimation(cfg, ev)
    if not go:
        print("Rien n'a été envoyé. Relancer avec --go pour exécuter.")
        return

    taille_lot = max(1, 100 // 2)  # TRAFFIC_AWARE_OPTIMAL : 100 éléments maximum par requête
    for modele in modeles:
        for k, depart in enumerate(departs, 1):
            dl = depart.strftime("%Y-%m-%d %H:%M")
            for i in range(0, len(origines), taille_lot):
                lot = [o for o in origines[i:i + taille_lot]
                       if any((o["id"], d, "rapide", dl, modele) not in faits for d in ("VITRY", "RIS"))]
                if not lot:
                    continue
                horodatage, res = calculer_matrice(lot, ["VITRY", "RIS"], cfg, depart=depart, modele=modele)
                for j, o in enumerate(lot):
                    for d in ("VITRY", "RIS"):
                        ligne = ligne_resultat(o, d, "rapide", cfg, res.get((j, d), {"statut": "ABSENT"}))
                        ligne.update({"horodatage_requete": horodatage, "depart_local": dl, "modele_trafic": modele})
                        ajouter_ligne(PREVISIONS_CSV, COLS_PREVISIONS, ligne)
            for o in origines:
                for variante in ("acces_impose", branches[o["id"]]):
                    if (o["id"], "RIS", variante, dl, modele) in faits:
                        continue
                    horodatage, res = calculer_itineraire(o, "RIS", cfg, passages=points_variante(cfg, variante),
                                                          depart=depart, modele=modele)
                    ligne = ligne_resultat(o, "RIS", variante, cfg, res)
                    ligne.update({"horodatage_requete": horodatage, "depart_local": dl, "modele_trafic": modele})
                    ajouter_ligne(PREVISIONS_CSV, COLS_PREVISIONS, ligne)
                    time.sleep(0.05)
            print(f"  {modele} : créneau {k}/{len(departs)} ({dl})")
    print(f"Terminé : {os.path.relpath(PREVISIONS_CSV, RACINE)}")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="Collecte v2 (Google Routes API) : Vitry / Ris-Orangis")
    parser.add_argument("commande", choices=["origines", "test", "distances", "previsions"])
    parser.add_argument("--couches", default="", help="grille,site,entree (défaut : toutes pour distances, site,entree pour previsions)")
    parser.add_argument("--semaine", default="", help="Une date de la semaine à prévoir (AAAA-MM-JJ)")
    parser.add_argument("--pas", type=int, default=60, help="Pas des créneaux en minutes (défaut 60)")
    parser.add_argument("--modeles", default="BEST_GUESS", help="BEST_GUESS,PESSIMISTIC,OPTIMISTIC")
    parser.add_argument("--go", action="store_true", help="Exécuter réellement les requêtes (sinon : estimation seule)")
    args = parser.parse_args()

    config = load_config()
    LOG_PATH = os.path.join(OUT_DIR, f"requetes_{args.commande}.jsonl")
    if args.commande in ("test", "distances", "previsions") and not GOOGLE_MAPS_API_KEY:
        sys.exit("ERREUR : aucune clé GOOGLE_MAPS_API_KEY dans .env")
    if args.commande == "origines":
        cmd_origines(config)
    elif args.commande == "test":
        cmd_test(config)
    elif args.commande == "distances":
        cmd_distances(config, (args.couches or "grille,site,entree").split(","), args.go)
    elif args.commande == "previsions":
        if not args.semaine:
            sys.exit("Préciser --semaine AAAA-MM-JJ")
        cmd_previsions(config, (args.couches or "site,entree").split(","), args.semaine, args.pas,
                       args.modeles.split(","), args.go)
