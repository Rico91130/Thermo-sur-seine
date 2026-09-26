"""
Tracé de la Seine entre la plateforme de Ris-Orangis et la chaufferie de Vitry, pour la carte de la page Présentation.

    python collecte/seine_ign.py      # écrit collecte/seine_ris-vitry.geojson

Source : IGN, BD TOPO (couche troncon_hydrographique, tronçons nommés « la Seine »), lue sur le service WFS de la
Géoplateforme, sans clé ni compte. Licence Ouverte Etalab 2.0. Les tronçons sont chaînés du sud au nord, puis coupés
aux points du fleuve les plus proches du portail de la plateforme (point R1) et de l'entrée du site de Vitry (point V1),
et simplifiés à 12 m près. Le tracé sert à l'illustration : la distance du dossier reste celle du dossier (36 km aller-retour).
"""

import heapq
import json
import math
import os
import urllib.parse
import urllib.request
from datetime import date

ICI = os.path.dirname(os.path.abspath(__file__))
SORTIE = os.path.join(ICI, "seine_ris-vitry.geojson")
WFS = "https://data.geopf.fr/wfs/ows"
ZONE = (2.36, 48.64, 2.46, 48.80)          # lon min, lat min, lon max, lat max
R1 = (2.4085, 48.6635)                      # portail de la plateforme de Ris-Orangis (plan du dossier p. 55 calé sur l'orthophoto IGN)
V1 = (2.4154, 48.7875)                      # entrée du site de Vitry (dossier p. 50 et 83)
TOLERANCE_M = 12


def distance(a, b):
    """Distance en mètres entre deux points (lon, lat)."""
    la1, la2 = math.radians(a[1]), math.radians(b[1])
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin(math.radians(b[0] - a[0]) / 2) ** 2
    return 2 * 6371008.8 * math.asin(math.sqrt(h))


def longueur(ligne):
    return sum(distance(ligne[i], ligne[i + 1]) for i in range(len(ligne) - 1))


def simplifier(points, eps):
    """Douglas-Peucker, distances en mètres dans un plan local."""
    if len(points) < 3:
        return points
    a, b = points[0], points[-1]
    kx, ky = 111320 * math.cos(math.radians(a[1])), 110540

    def ecart(p):
        ax, ay, bx, by, px, py = a[0] * kx, a[1] * ky, b[0] * kx, b[1] * ky, p[0] * kx, p[1] * ky
        dx, dy = bx - ax, by - ay
        t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / ((dx * dx + dy * dy) or 1)))
        return math.hypot(px - ax - t * dx, py - ay - t * dy)

    i, dmax = max(((i, ecart(points[i])) for i in range(1, len(points) - 1)), key=lambda x: x[1])
    if dmax <= eps:
        return [a, b]
    return simplifier(points[:i + 1], eps)[:-1] + simplifier(points[i:], eps)


def main():
    params = {"SERVICE": "WFS", "VERSION": "2.0.0", "REQUEST": "GetFeature", "TYPENAMES": "BDTOPO_V3:troncon_hydrographique",
              "OUTPUTFORMAT": "application/json", "COUNT": "5000", "BBOX": ",".join(map(str, ZONE)) + ",CRS:84"}
    with urllib.request.urlopen(WFS + "?" + urllib.parse.urlencode(params), timeout=120) as r:
        donnees = json.load(r)
    troncons = [[tuple(c[:2]) for c in f["geometry"]["coordinates"]] for f in donnees["features"]
                if f["properties"].get("cpx_toponyme_de_cours_d_eau") == "la Seine"]

    # Chaînage : plus court chemin entre l'extrémité la plus au sud et la plus au nord de la zone
    cle = lambda p: (round(p[0], 5), round(p[1], 5))
    graphe = {}
    for i, t in enumerate(troncons):
        a, b, lg = cle(t[0]), cle(t[-1]), longueur(t)
        graphe.setdefault(a, []).append((b, lg, i, False))
        graphe.setdefault(b, []).append((a, lg, i, True))
    sud, nord = min(graphe, key=lambda n: n[1]), max(graphe, key=lambda n: n[1])
    meilleur, precedent, file = {sud: 0}, {}, [(0, sud)]
    while file:
        c, n = heapq.heappop(file)
        if c > meilleur[n]:
            continue
        for m, lg, i, inverse in graphe[n]:
            if c + lg < meilleur.get(m, float("inf")):
                meilleur[m], precedent[m] = c + lg, (n, i, inverse)
                heapq.heappush(file, (c + lg, m))
    morceaux, n = [], nord
    while n != sud:
        p, i, inverse = precedent[n]
        morceaux.append(troncons[i][::-1] if inverse else troncons[i])
        n = p
    ligne = []
    for t in reversed(morceaux):
        ligne += t if not ligne else t[1:]

    # Coupe entre Ris-Orangis et Vitry, du sud (amont) vers le nord (aval)
    i_ris = min(range(len(ligne)), key=lambda i: distance(ligne[i], R1))
    i_vitry = min(range(len(ligne)), key=lambda i: distance(ligne[i], V1))
    troncon = simplifier(ligne[i_ris:i_vitry + 1], TOLERANCE_M)
    km = round(longueur(troncon) / 1000, 1)
    geojson = {"type": "Feature", "geometry": {"type": "LineString", "coordinates": [[round(x, 5), round(y, 5)] for x, y in troncon]},
               "properties": {"nom": "La Seine, de la plateforme de Ris-Orangis à la chaufferie de Vitry", "longueur_km": km,
                              "source": "IGN, BD TOPO, couche troncon_hydrographique (tronçons « la Seine »), service WFS de la Géoplateforme",
                              "url": "https://geoservices.ign.fr/bdtopo", "licence": "Licence Ouverte Etalab 2.0",
                              "extraction": date.today().isoformat(),
                              "ecart_extremites_m": {"ris_R1": round(distance(ligne[i_ris], R1)), "vitry_V1": round(distance(ligne[i_vitry], V1))}}}
    with open(SORTIE, "w", encoding="utf-8") as f:
        json.dump(geojson, f, ensure_ascii=False)
    print(f"{SORTIE} : {len(troncon)} points, {km} km (dossier : 36 km aller-retour)")


if __name__ == "__main__":
    main()
