# Grille d'évaluation des questions / réponses — concertation Thermo-sur-Seine

Contexte : projet de chaufferie de 1,6 TWh brûlant environ 450 000 t/an de combustibles solides de récupération (CSR) et de bois B à Vitry-sur-Seine (94), approvisionnée par camion jusqu'à une plateforme route-fleuve à Ris-Orangis (91), puis par barge sur la Seine. Maître d'ouvrage (MO) : une SEMOP de la Ville de Paris. Concertation préalable sous l'égide de la CNDP, du 1er septembre au 1er novembre 2026. Les questions viennent du public, les réponses du MO.

Le résultat servira à des statistiques publiques qui seront contestées par le MO. Chaque verdict doit donc être **défendable** : on juge seulement si la réponse répond à ce qui est demandé, jamais si elle est vraie, convaincante ou sympathique. **En cas de doute entre deux verdicts, choisir le plus favorable au MO.**

## Champs à produire pour chaque question

```json
{
  "numero": 63,
  "resume": "Acheminement par camion à Ris-Orangis : circulation, pollution, gêne",
  "tags": ["TRANSPORT_ROUTE", "AIR_SANTE", "NUISANCES"],
  "posture": "INQUIETUDE",
  "sous_questions": 4,
  "sous_questions_repondues": 2,
  "verdict": "PARTIEL",
  "report": true,
  "generique": false,
  "chiffre": true,
  "manque": "Pollution et gêne renvoyées aux études ; la question de la vision globale (avantage pour l'un, inconvénient pour l'autre) est ignorée.",
  "preuve": "ces effets sont pris en compte dans les études environnementales en cours"
}
```

- **resume** : 15 mots au plus, neutre, sans nom de personne.
- **tags** : 1 à 3 codes de la liste ci-dessous, le premier étant le sujet principal.
- **posture** exprimée par l'auteur (une seule) :
  - `OPPOSITION` : rejet explicite du projet ou d'un de ses choix (« nous refusons », « ce projet est une aberration »…) ;
  - `INQUIETUDE` : crainte, doute, critique, sans rejet explicite ;
  - `DEMANDE_INFO` : demande d'information neutre ou technique ;
  - `SOUTIEN` : approbation ou suggestion favorable au projet.
- **sous_questions** : nombre de demandes distinctes d'information, de chiffre, de document ou d'engagement, y compris celles formulées sans point d'interrogation (« merci de fournir… »). Ne pas compter les questions purement rhétoriques ou provocatrices, sauf si c'est la seule demande (alors 1). Regrouper les reformulations d'une même demande. Au moins 1.
- **sous_questions_repondues** : nombre de ces demandes qui reçoivent l'information, le chiffre, le document ou l'engagement demandé, de façon spécifique. Une phrase du type « ce n'est pas encore défini, ce sera précisé dans l'étude d'impact » **ne compte pas** comme répondue (elle se note avec `report`). Une réponse qui dit clairement « non » ou « cela n'existe pas » compte comme répondue. `null` si sans réponse.
- **verdict** (un seul) :
  - `SANS_REPONSE` : le statut n'est pas « Réponse publiée » ;
  - `REPOND` : toutes les demandes, ou au moins l'essentiel (80 % et la demande principale), reçoivent une réponse spécifique ;
  - `PARTIEL` : au moins une demande reçoit une réponse spécifique, mais une ou plusieurs autres sont ignorées ou laissées en suspens ;
  - `REPORT` : aucune demande ne reçoit de réponse spécifique, et l'essentiel de la réponse renvoie à plus tard (études en cours, étude d'impact, évaluation des risques sanitaires, enquête publique, autorisation, atelier à venir, « pas encore défini », choix des fournisseurs en 2027…) ;
  - `A_COTE` : aucune demande ne reçoit de réponse spécifique, et la réponse parle d'autre chose : présentation générale du projet, éléments de langage, sujet voisin ;
  - `REFUS` : le MO refuse de répondre, déclare la question hors sujet ou hors de son périmètre.
- **report** : `true` si la réponse renvoie au moins un élément demandé à plus tard (même si le verdict est REPOND ou PARTIEL).
- **generique** : `true` si la réponse contient au moins un paragraphe de présentation générale ou d'éléments de langage qui pourraient figurer tel quel en réponse à des questions très différentes (au-delà des formules de politesse « Nous avons bien pris note… », « Nous restons à votre écoute »).
- **chiffre** : `true` si la réponse contient au moins une donnée chiffrée liée à la question (hors dates de calendrier et numéros de page).
- **manque** : 30 mots au plus, ce qui n'est pas répondu (vide si REPOND sans réserve).
- **preuve** : courte citation **exacte, mot pour mot**, de la réponse (20 mots au plus) qui justifie le verdict ; vide si SANS_REPONSE.

## Liste des tags

| Code | Sujet |
|---|---|
| TRANSPORT_ROUTE | camions, trafic, itinéraires, routes, accès aux sites, nombre de camions |
| FLUVIAL | barges, Seine comme voie de transport, plateforme et quai de Ris-Orangis, manutention |
| COMBUSTIBLE | CSR, bois B, nature, composition, forme, origine, fournisseurs, rayon d'approvisionnement, gisement |
| AIR_SANTE | rejets de la cheminée, polluants, dioxines, particules, santé, études sanitaires, surveillance de l'air |
| CLIMAT_GES | CO2, bilan carbone, climat, caractère « renouvelable » ou « décarboné » |
| NUISANCES | bruit, odeurs, poussières, impact visuel, paysage, cheminée |
| RESIDUS | mâchefers, cendres, REFIOM, déchets produits par la chaufferie |
| RISQUES | incendie, explosion, sécurité industrielle, stockage, classement ICPE/Seveso |
| EAU_SEINE | eau, rejets dans la Seine, crues, inondation, biodiversité aquatique |
| SITE_FONCIER | choix des sites (Vitry, Ris-Orangis, autres), foncier, EDF, terrains, alternatives de localisation |
| ALTERNATIVES | géothermie, solaire, chaleur fatale, biomasse, sobriété, besoin réel du projet, autres solutions |
| RESEAU_CHALEUR | CPCU, réseau de chaleur, bénéficiaires (Paris contre communes d'accueil), raccordement local, prix de la chaleur |
| ECONOMIE_COUT | coût, financement, emplois, contrats, rentabilité, fiscalité |
| GOUVERNANCE | SEMOP, Ville de Paris, actionnaires, décision, irréversibilité, contrôle, comité de suivi |
| POLITIQUE_DECHETS | incinération contre recyclage, hiérarchie des déchets, « incinérateur », plans régionaux |
| CONCERTATION | déroulé de la concertation, réunions, transparence, documents ou études demandés |
| CALENDRIER | dates, phasage, lignes de la chaufferie, durée de vie |
| AUTRE | tout le reste |

## Exemple calibré (n° 63)

Question : « Comment allez-vous acheminer les déchets au niveau de Ris-Orangis ? Par camion avec tout ce que cela engendrera en terme de circulation, de pollution et de gêne » ; texte : « … ne faudrait-il pas avoir une vision plus globale. L'avantage pour l'un ne peut-il devenir l'inconvénient pour l'autre ? »

Réponse : camions jusqu'à Ris-Orangis puis barge ; 53 puis 60 à 130 camions par jour ; horaires ; itinéraire RN104, A6, D310, RN7 ; « moins de 1 % du trafic actuel » ; pollution et bruit « pris en compte dans les études environnementales en cours ».

→ 4 demandes (mode d'acheminement, circulation, pollution et gêne, vision globale), 2 répondues (acheminement, circulation), verdict `PARTIEL`, report `true`, chiffre `true`, generique `false`.
