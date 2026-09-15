# Rendu photoréaliste du Planner — chaîne validée

Produit une photo de la future salle d'arcade d'un client, **fidèle au plan 2D** et aux vrais jeux
du catalogue. Remplace la piste « modèles 3D GLB » (`../planner-render/`), abandonnée le 14/09/2026.

## Le principe en une phrase

La **géométrie** vient du plan (lancer de rayons + repères peints) ; l'**apparence** vient des
photos catalogue ; le modèle d'image ne fait que remplir un volume qu'on lui impose.

## La chaîne

```
plan 2D ──► scene.py ──► camera.py ──► salle vide (IA, figée)
                                            │
                     ┌──────────────────────┴───────────────────────┐
                     ▼                      ▼                       ▼
              passe machine 1        passe machine 2         passe machine N
           (repere.fabriquer +     INDÉPENDANTES, toutes sur la MÊME salle vide
            1 génération IA)                  │
                     └──────────────────────┬─┴───────────────────────┘
                                            ▼
                               repere.composer  (par écart)
                                            ▼
                                   passe branding (néon)
```

**Ne jamais enchaîner les passes.** Onze passes successives sur la même image ne tiennent pas :
chacune abîme les précédentes (frontons illisibles, machines fusionnées, carrosseries tranchées).
Testé et constaté le 15/09 sur une salle à 15 jeux.

## Les modules

| fichier | rôle |
|---|---|
| `scene.py` | lecture du JSON de salle, géométrie du polygone, plaquage des dos contre les murs |
| `geometrie.py` | lancer de rayons, z-buffer salle, projections, masques de volumes orientés |
| `camera.py` | choix du point de vue **en deux temps** (score rapide, puis z-buffer réel) |
| `repere.py` | fabrication du repère, recollage des gros plans, **composition par écart** |
| `controle.py` | surimpression des volumes du plan pour mesurer l'écart |

## Les pièges déjà payés — ne pas les repayer

- **Repère miroir.** Le plan a Y vers le BAS ; le monde 3D utilise `z = -y`. Utiliser les
  coordonnées du plan telles quelles sort l'image en miroir. Invisible sur une salle rectangulaire,
  flagrant sur une salle en L.
- **Repère trop petit = ignoré.** Sous ~260 px le modèle abandonne le repère et pose un « sujet
  héros » au milieu de la pièce. `repere.fabriquer` bascule alors automatiquement en gros plan.
- **Le modèle refuse de couper une machine** au bord du cadre : il la DÉPLACE. Si une machine
  déborde, rendre à un champ plus large et recadrer par le code.
- **Deux images de salle = recomposition.** Pour la salle vide, fournir la matière en **planche
  d'échantillons** (patch de mur, de sol, de plafond), jamais une photo de pièce : elle serait
  recopiée comme cadrage.
- **Machine masquée à plus de 90 %** par une autre : ne pas la dessiner, sa passe ne peut
  qu'abîmer la précédente (`camera.SEUIL_VISIBLE`).
- **Cotes catalogue** : elles **n'incluent pas** casquettes, toppers et écrans hauts. Le corps
  remplit le repère, l'élément lumineux déborde — c'est correct.
- **Photos en paire.** Beaucoup de fiches montrent la machine en double (Emoji Hoops : 3 photos
  sur 4) → le rendu duplique. Choisir la photo à une seule borne.
- **Statut Krea trompeur** : `get_job` annonce « processing » pendant 5 à 20 minutes alors que le
  job est terminé en ~40 s. Continuer à interroger ; l'URL du résultat n'est pas dérivable du job id.

## Écrire la consigne d'une machine

Voir `../../docs/planner/descriptions-machines.md` — base cumulative, une fiche par jeu.
Protocole : toutes les photos de la fiche → planche de contact pour l'inventaire → **photo pleine
résolution pour tout jugement géométrique** → description en inventaire du haut vers le bas →
2 à 3 photos passées au modèle.

**Le référentiel, ce sont les murs et les angles, jamais la caméra** — dans la consigne comme dans
l'analyse.

## Contrôle

Après chaque passe : `controle.surimpression` pour l'écart au plan, **et** une lecture visuelle de
l'image avec des yeux de client (frontons lisibles, contact au sol, ombre, opacité, machines
jumelles cohérentes, artefacts). La mesure ne voit rien de tout ça.

## Exemple

`exemple-salle2.json` — pentagone de 15,8 × 11 m, 15 jeux, plafond 4 m.
