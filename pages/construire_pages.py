"""
Construit les pages du site à partir d'un gabarit commun, pour ne pas répéter l'en-tête, le menu et le pied de page.

    python pages/construire_pages.py              # régénère les pages HTML à la racine du dépôt
    python pages/construire_pages.py --verifier   # signale les pages qui ne correspondent plus à leurs sources

Sources :
- pages/gabarit.html : en-tête, menu, pied de page ;
- pages/contenu/<page>.html : le contenu propre à chaque page, précédé d'un bloc de réglages :
      <!--
      titre: …
      description: …
      options: leaflet, redirection      (facultatif)
      -->
- MENU, ci-dessous : l'ordre et les libellés du menu, qui fixent aussi les liens « page précédente / suivante ».
"""

import os
import re
import sys

ICI = os.path.dirname(os.path.abspath(__file__))
RACINE = os.path.dirname(ICI)

# (nom de la page pour app.js, fichier, adresse dans le menu, libellé du menu)
MENU = [
    ("presentation", "presentation.html", "presentation.html", "Présentation"),
    ("essentiel", "index.html", "./", "L'essentiel"),
    ("dossier", "dossier.html", "dossier.html", "Le dossier et les données"),
    ("itineraires", "itineraires.html", "itineraires.html", "Les itinéraires"),
    ("carte", "carte.html", "carte.html", "La carte"),
    ("heures", "heures.html", "heures.html", "Heure par heure"),
    ("annee", "annee.html", "annee.html", "Simulateur"),
    ("methode", "methode.html", "methode.html", "Méthode et sources"),
]

# Ajouts demandés par l'option « options: » d'une page : (dans <head>, avant </body>)
OPTIONS = {
    "leaflet": ('  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css">\n',
                '  <script src="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js"></script>\n'),
    # Animations du récit de la page d'accueil (GSAP, licence « Standard no-charge », https://gsap.com/standard-license)
    "recit": ("",
              '  <script src="https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js"></script>\n'
              '  <script src="https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/ScrollTrigger.min.js"></script>\n'
              '  <script src="https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/MotionPathPlugin.min.js"></script>\n'),
    "redirection": ("""  <script>
    // Anciennes adresses de la version en une seule page (#carte, #point=IDF1…) : redirection vers la bonne page
    (function () {
      var h = location.hash, pages = { '#confrontation': 'dossier.html', '#itineraires': 'itineraires.html', '#carte': 'carte.html',
        '#heures': 'heures.html', '#calculateur': 'annee.html', '#methode': 'methode.html' };
      if (/^#point=/.test(h)) location.replace('carte.html' + h);
      else if (pages[h]) location.replace(pages[h]);
    })();
  </script>
""", ""),
}


def lire(chemin):
    with open(chemin, encoding="utf-8") as f:
        return f.read()


def lire_contenu(fichier):
    texte = lire(os.path.join(ICI, "contenu", fichier))
    m = re.match(r"\s*<!--(.*?)-->\n", texte, re.S)
    if not m:
        sys.exit(f"pages/contenu/{fichier} : bloc de réglages <!-- titre: … --> manquant en tête du fichier")
    reglages = {}
    for ligne in m.group(1).strip().splitlines():
        cle, _, valeur = ligne.partition(":")
        reglages[cle.strip()] = valeur.strip()
    for cle in ("titre", "description"):
        if not reglages.get(cle):
            sys.exit(f"pages/contenu/{fichier} : réglage « {cle} » manquant")
    options = [o.strip() for o in reglages.get("options", "").split(",") if o.strip()]
    for o in options:
        if o not in OPTIONS:
            sys.exit(f"pages/contenu/{fichier} : option inconnue « {o} » (possibles : {', '.join(OPTIONS)})")
    return reglages, options, texte[m.end():]


def menu(courant):
    actif = ' aria-current="page"'
    return "\n".join(f'        <a href="{adresse}"{actif if nom == courant else ""}>{libelle}</a>'
                     for nom, _, adresse, libelle in MENU)


def voisines(i):
    if MENU[i][1] == "index.html":   # la page d'accueil a ses propres liens vers les autres pages
        return ""
    liens = []
    if i > 0:
        liens.append(f'      <a href="{MENU[i - 1][2]}" rel="prev"><span>Page précédente</span>{MENU[i - 1][3]}</a>')
    if i + 1 < len(MENU):
        liens.append(f'      <a href="{MENU[i + 1][2]}" rel="next"><span>Page suivante</span>{MENU[i + 1][3]}</a>')
    return ('\n    <nav class="conteneur pages-voisines" aria-label="Pages précédente et suivante">\n'
            + "\n".join(liens) + "\n    </nav>\n")


def construire():
    gabarit = lire(os.path.join(ICI, "gabarit.html"))
    pages = {}
    for i, (nom, fichier, _, _) in enumerate(MENU):
        reglages, options, contenu = lire_contenu(fichier)
        valeurs = {
            "source": fichier, "page": nom, "titre": reglages["titre"], "description": reglages["description"],
            "tete": "".join(OPTIONS[o][0] for o in options), "fin": "".join(OPTIONS[o][1] for o in options),
            "menu": menu(nom), "contenu": contenu, "voisines": voisines(i),
        }
        html = re.sub(r"\{\{(\w+)\}\}", lambda m: valeurs[m.group(1)], gabarit)
        pages[fichier] = html
    return pages


def main():
    pages = construire()
    if "--verifier" in sys.argv:
        differentes = [f for f, html in pages.items()
                       if not os.path.exists(os.path.join(RACINE, f)) or lire(os.path.join(RACINE, f)) != html]
        if differentes:
            sys.exit("Pages à régénérer (ou modifiées à la main) : " + ", ".join(differentes)
                     + "\nLancez : python pages/construire_pages.py")
        print(f"Les {len(pages)} pages correspondent à leurs sources.")
        return
    for fichier, html in pages.items():
        with open(os.path.join(RACINE, fichier), "w", encoding="utf-8", newline="\n") as f:
            f.write(html)
    print(f"{len(pages)} pages construites : {', '.join(pages)}")


if __name__ == "__main__":
    main()
