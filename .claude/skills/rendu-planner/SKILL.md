---
name: rendu-planner
description: Rendu photoréaliste des salles d'arcade à partir du plan 2D du Planner — règles d'or, chaîne de production, pièges connus et état d'avancement. À charger pour toute question de rendu, de caméra, de placement de machines ou de fidélité au catalogue.
---

# Rendu photoréaliste du Planner

## Règles d'or — non négociables

**0. Ne rien supposer.** Un constat = ce que je VOIS sur l'image **plus** une mesure. Jamais une
déduction tirée de la consigne envoyée, jamais une extrapolation à partir de deux cas.

**1. Le référentiel, ce sont les MURS et les ANGLES — jamais la caméra.** Vaut dans les consignes
au modèle **et** dans mes explications. « Dos au mur du fond, entre la borne de fléchettes et le
distributeur » — pas « à 9 m de l'objectif ».

**2. Analyser l'image avec des yeux de client, à chaque étape, AVANT toute mesure.** Frontons
lisibles, machines qui touchent le sol, ombres portées, machines jumelles cohérentes, artefacts de
recollage, texture du sol. **Zoomer à 100 %** : une lecture en taille réduite ne vaut rien.

**3. Une contrainte géométrique passe par la géométrie** — le repère dessiné — pas par le texte.
Le texte ne sert qu'à ce que le repère ne peut pas dire.

**4. Décrire une machine : les 5 étapes obligatoires.** Récupérer TOUTES les photos de la fiche
Shopify → planche de contact pour l'inventaire des pièces → **photo pleine résolution pour tout
jugement géométrique** → description en inventaire du haut vers le bas → 2 à 3 photos passées au
modèle. Le nom du produit est une donnée (« 1p LCD » annonce un écran LCD).

**5. Le dos d'une machine** est le côté opposé à celui où la cote est écrite sur le plan. Les
tables font exception : elles restent en îlot.

## La chaîne

1. **Lire le plan** → polygone en mètres, machines avec leurs **dimensions officielles Shopify**
   (`custom.specs_dimensions`, jamais estimées), rotation, mur d'appui. Plaquer les dos.
2. **Choisir le point de vue** en deux temps : score rapide, puis re-classement des meilleures
   poses avec un z-buffer basse résolution incluant murs ET machines.
3. **Écarter** toute machine masquée à plus de 90 %.
4. **La salle d'abord, puis figée** : lancer de rayons → passe IA avec **planche d'échantillons**
   de matière (jamais une photo de pièce, elle serait recopiée comme cadrage) → contrôle par
   projection des sommets de murs.
5. **Les machines** — deux régimes :
   - **isolées** à l'écran → passe indépendante sur la salle vide, puis assemblage ;
   - **mitoyennes ou jumelles** → générer la plus proche **dans l'image qui contient déjà sa
     voisine**, avec « strictement identique à celle d'à côté ».
6. **Contrôle bloquant après chaque passe** : écart mesuré au plan ET lecture visuelle à 100 %.
7. **Composition** : partir de la salle vide et n'y COLLER que des machines. Ne jamais additionner
   des écarts sur toute l'image.
8. **Branding** en dernier, passe indépendante, logo néon depuis le fichier source.

## Outils

`tools/planner-photoreal/` — `scene.py`, `geometrie.py`, `camera.py`, `repere.py`, `controle.py`,
piloté par un JSON de salle (`exemple-salle2.json`). Le README y liste les pièges.

`docs/planner/descriptions-machines.md` — fiches par jeu. **À enrichir à CHAQUE intégration** :
inventaire vérifié, orientation validée, historique des ratés.

## Pièges déjà payés — ne pas les repayer

- **Repère miroir** : le plan a Y vers le BAS, le monde 3D utilise `z = -y`.
- **Repère sous ~260 px = ignoré** → basculer en gros plan, puis recoller.
- **Le modèle refuse de couper une machine** au bord du cadre : il la DÉPLACE. Rendre plus large,
  recadrer par le code.
- **Onze passes enchaînées ne tiennent pas** : chacune abîme les précédentes (frontons illisibles,
  machines fusionnées).
- **Photos en paire** : beaucoup de fiches montrent la machine en double → le rendu duplique.
- **Cotes catalogue** : n'incluent ni casquettes, ni toppers, ni écrans hauts.
- **Assemblage** : discriminer machine / ombre sur la **chromaticité** (une ombre garde la teinte),
  et borner le corps à l'emprise du plan dilatée (~200 px).
- **Statut Krea trompeur** : « processing » pendant 5 à 20 min alors que le job finit en ~40 s.

## État au 15/09/2026

Salle en L à 5 jeux : bon rendu. Salle pentagone à 15 jeux : chaîne d'outils en place, méthode
validée sur 3 machines, série complète encore imparfaite — reste à refaire la passe de la table
(tour mal placée), réextraire les deux Asphalt, réassembler, et inspecter **chaque** passe à 100 %.
