# Questions du public et réponses du maître d'ouvrage

Données de la page « Les réponses en chiffres » (`reponses.html`) : toutes les questions publiées sur la [plateforme de la concertation](https://www.thermo-sur-seine-concertation.fr/posez-vos-questions-3893) au 17 octobre 2026, et l'évaluation de chaque réponse.

| Fichier | Contenu |
|---|---|
| `questions_2026-10-17.json` | Une ligne par question (412) : numéro, lien, date de publication, auteur (un numéro, jamais un nom), thème choisi par l'auteur, titre, statut au 26/09 et au 17/10, et l'évaluation (sujets, résumé, verdict, nombre de demandes et de demandes traitées, renvoi à plus tard, ce qui manque, citation exacte de la réponse qui justifie le verdict) |
| `grille.md` | La grille d'évaluation, telle qu'elle a été appliquée |
| `contre_evaluation.json` | La contre-évaluation à l'aveugle de 60 réponses tirées au hasard : verdict de la première évaluation et verdict de la seconde |
| `collecte_questions.py` | Le relevé de la plateforme (liste, puis page de chaque question) |

`python collecte/build_data.py` copie ces données dans `data/questions.json`, avec l'accord entre les deux évaluations.

## Méthode

1. **Relevé.** `collecte_questions.py` lit toutes les questions publiées, avec leur statut (« Réponse publiée » ou « Réponse en cours »). Le relevé brut, qui contient le texte des questions, n'est pas publié : une question peut contenir des données personnelles. Chaque question reste lisible sur la plateforme, par son lien.
2. **Évaluation.** Chaque réponse est lue en entier et classée selon `grille.md` : *répond* (au moins 80 % des demandes, dont la principale), *partielle*, *renvoi à plus tard*, *à côté*, *refus*, ou *sans réponse*. On juge si la réponse répond à ce qui est demandé, jamais si elle est vraie. En cas de doute, le verdict le plus favorable au maître d'ouvrage l'emporte. Chaque verdict est justifié par une citation exacte de la réponse, vérifiée automatiquement.
3. **Qui a évalué.** Six instances d'un modèle d'intelligence artificielle (Claude, d'Anthropic), chacune sur un lot de questions entrelacées (une question sur six), avec la même grille.
4. **Contre-évaluation.** 60 réponses tirées au hasard (10 par lot) ont été réévaluées par une septième instance, sans accès aux premiers verdicts : même verdict dans 88 % des cas (kappa de Cohen 0,80). Dans 6 des 7 désaccords, la première évaluation était la plus favorable au maître d'ouvrage.

## Limites

- **Dates.** La plateforme affiche la date de publication des questions, mais pas celle des réponses. L'« attente minimale » se déduit de deux relevés (26/09 et 17/10) : c'est une borne basse. Quand une question a été modifiée par son auteur, la plateforme affiche la date de modification ; on garde alors la date la plus ancienne connue.
- **Demandes.** Le nombre de demandes par question est une estimation : les longs questionnaires numérotés en comptent plus de vingt et reçoivent presque toujours une réponse partielle, même longue et chiffrée.
- **Auteurs.** 55 questions sont publiées sans nom d'auteur ; elles ne sont rattachées à aucun numéro.
- **Jugement.** Une évaluation, même cadrée par une grille et contre-vérifiée, reste un jugement. Chaque verdict peut être contrôlé : le lien mène à la question et à sa réponse, la citation dit sur quoi il repose. Une erreur ? [Signalez-la](https://github.com/Rico91130/Thermo-sur-seine/issues).
