"""
Relevé des questions et des réponses publiées sur la plateforme de la concertation Thermo-sur-Seine.

    python collecte/questions/collecte_questions.py

Lit la liste paginée des questions, puis la page de chaque question, et écrit
collecte/questions/releve_<date>.json : numéro, lien, date affichée, statut, thème, titre, texte de la
question et de la réponse. Les auteurs ne sont pas nommés : chacun reçoit un numéro (1 = celui qui a posé
le plus de questions). Ce relevé brut n'est pas publié (les questions peuvent contenir des données
personnelles) : seule son évaluation l'est, dans questions_<date>.json (voir README.md).
"""
import html
import json
import re
import sys
import time
import urllib.request
from collections import Counter
from datetime import date
from pathlib import Path

BASE = "https://www.thermo-sur-seine-concertation.fr"
ICI = Path(__file__).parent
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}


def get(url):
    time.sleep(0.4)
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return r.read().decode("utf-8")


def texte(fragment):
    s = re.sub(r"<br\s*/?>", "\n", fragment)
    s = re.sub(r"</(div|p|li)>", "\n", s)
    s = html.unescape(re.sub(r"<[^>]+>", "", s)).replace("\xa0", " ")
    return re.sub(r"\n{3,}", "\n\n", "\n".join(l.strip() for l in s.split("\n"))).strip()


def cartes():
    res, curseur = [], None
    while True:
        s = get(f"{BASE}/posez-vos-questions-3893" if curseur is None else f"{BASE}/node_section/8394?q=&cursor_section_8394={curseur}")
        for pid, corps in re.findall(r'<article id="post-short-(\d+)"(.*?)</article>', s, flags=re.S):
            auteur = re.search(r'aria-label="Contribution de ([^"]*)"', corps)
            badges = re.findall(r'class="badge__limit">([^<]+)<', corps)
            idx = re.search(r'post__idx">#(\d+)', corps)
            dt = re.search(r'u-txt-no-wrap u-txt-small">\s*([^<]+?)\s*<', corps)
            res.append({"id": int(pid), "numero": int(idx.group(1)) if idx else None,
                        "auteur": html.unescape(auteur.group(1)).strip().casefold() if auteur else "",
                        "statut": badges[0].strip() if badges else None,
                        "theme_plateforme": badges[1].strip() if len(badges) > 1 else None,
                        "date_affichee": dt.group(1).strip() if dt else None})
        m = re.search(r"cursor_section_8394=([A-Za-z0-9_-]+)", s)
        if not m or m.group(1) == curseur:
            return res
        curseur = m.group(1)
        print(f"{len(res)} questions listées", file=sys.stderr)


def detail(c):
    s = get(f"{BASE}/posts/{c['id']}")
    h1 = re.search(r'<h1 class="post__title[^"]*">(.*?)</h1', s, flags=re.S)
    contenu = s[s.find("post-layout__content"):s.find('class="post__survey"')]
    rep = re.search(r'<div class="alert__body">.*?<div class="u-txt-styles">(.*?)</div>\s*</div>\s*</div>\s*</div>\s*</div>', contenu, flags=re.S)
    debut = contenu.rfind("<div>")   # le texte de la question : le dernier <div> sans attribut, après la réponse
    reponse = texte(rep.group(1)) if rep else ""
    if c["statut"] != "Réponse publiée":
        reponse = ""   # « Le maître d'ouvrage prépare actuellement une réponse… »
    return {"titre": texte(re.sub(r'<span class="post__idx">.*?</span>', "", h1.group(1), flags=re.S)) if h1 else None,
            "question": texte(contenu[debut + 5:contenu.rfind("</div>")]) if debut > contenu.find("alert__body") else "",
            "reponse": reponse}


if __name__ == "__main__":
    liste = cartes()
    compte = Counter(c["auteur"] for c in liste if c["auteur"])
    premiere = {}
    for c in sorted(liste, key=lambda c: c["numero"] or 0):
        premiere.setdefault(c["auteur"], c["numero"])
    rang = {a: i for i, a in enumerate(sorted(compte, key=lambda a: (-compte[a], premiere[a])), 1)}
    releve = []
    for c in sorted(liste, key=lambda c: c["numero"] or 0):
        releve.append({"numero": c["numero"], "url": f"{BASE}/posts/{c['id']}", "date_affichee": c["date_affichee"],
                       "auteur": rang.get(c["auteur"]), "statut": c["statut"], "theme_plateforme": c["theme_plateforme"], **detail(c)})
    sortie = ICI / f"releve_{date.today().isoformat()}.json"
    sortie.write_text(json.dumps(releve, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(releve)} questions, dont {sum(r['statut'] == 'Réponse publiée' for r in releve)} avec réponse -> {sortie}", file=sys.stderr)
