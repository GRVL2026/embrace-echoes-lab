# Arcade Planner — rendu photoréaliste d'une salle à partir du plan 2D

Document de passation. Tout ce qui suit a été **testé en réel le 11/09/2026** (pas de la théorie).
Dépôt concerné : `embrace-echoes-lab` (Arcade OS). Page existante : `src/pages/SpacePlanner.tsx`.

---

## 1. Le besoin

L'opérateur place les jeux **en 2D** dans le Planner (c'est déjà le cas aujourd'hui). Il veut
ensuite, d'un clic, obtenir **une ou deux images photoréalistes** de la salle, pour que son client
se projette dans son futur espace.

Contraintes posées par Léopaul :

- **Les jeux doivent être fidèles à 100 % aux photos des fiches produit du site.** Un client doit
  reconnaître exactement le produit qu'il achète.
- **La géométrie n'a pas besoin d'être au millimètre.** L'objectif est la projection mentale, pas
  le plan d'exécution.
- **Une ou deux vues suffisent**, une seule à la rigueur.
- La salle a **toujours les mêmes finitions** : murs béton brut, sol béton, hauteur de mur fixe
  (3,5 m dans les tests). Cette constance est un atout : moins de variables à gérer.

## 2. Décision d'architecture

**Le module 3D interactif est abandonné en tant que fonctionnalité utilisateur.** Le viewer
three.js existant (`src/components/viewer3d/`) ne doit plus être une page où l'utilisateur navigue.

La 3D ne disparaît pas pour autant : elle devient un **moteur de rendu interne, invisible**.
L'utilisateur ne voit que le plan 2D et le bouton « Générer la vue ».

> Point important : **il n'y a pas besoin d'un moteur 3D temps réel** pour cette chaîne. Une
> projection perspective en ~100 lignes suffit. Le three.js existant peut être réutilisé si c'est
> plus pratique, mais ce n'est pas nécessaire.

---

## 3. La chaîne technique, en 3 étapes

### Étape 1 — Projeter le plan 2D en perspective

Caméra sténopé classique. Repère monde : X = largeur, Y = profondeur, Z = hauteur, en mètres,
origine dans un coin de la salle.

```python
fwd   = normalize(TGT - CAM)
right = normalize(cross(fwd, (0, 0, 1)))
up    = cross(right, fwd)
FPX   = (W / 2) / tan(HFOV / 2)          # W = largeur image en px

def project(P):
    v = P - CAM
    xc, yc, zc = dot(v, right), dot(v, up), dot(v, fwd)
    if zc <= 0:  return None             # derrière la caméra
    return (W/2 + FPX * xc/zc,  H/2 - FPX * yc/zc,  zc)
```

Réglages validés : `HFOV = 68°` (~24 mm), caméra à **1,70 m** de hauteur (hauteur des yeux),
placée dans un coin, visant un point à ~1,35 m de haut vers le fond de la salle.

La salle nue (sol, 4 murs, plafond) est rasterisée par **lancer de rayons vectorisé numpy** :
un rayon par pixel, intersection avec les 6 plans, on garde le plus proche, ombrage par distance
+ grain. C'est rapide (2 Mpx en une passe numpy) et ça donne une perspective rigoureusement juste.

### Étape 2 — Composer les jeux à l'échelle réelle

Pour chaque machine, du **plus loin au plus proche** (algorithme du peintre) :

1. Projeter le point de contact au sol `(x, y, 0)` → `(bx, by)`
2. Projeter le sommet `(x, y, hauteur_réelle)` → `(_, ty)`
3. **Hauteur du sprite en pixels = `by - ty`.** C'est ça qui garantit l'échelle correcte.
4. Largeur = hauteur × ratio du sprite (après recadrage sur la boîte alpha — indispensable, les
   PNG ont beaucoup de vide transparent autour)
5. Coller le sprite avec son **bas sur le point de contact au sol**
6. Sous chaque machine : ellipse noire floutée (ombre de contact). Sans elle, les jeux flottent.

### Étape 3 — Passe IA de photoréalisme

Modèle : **`google/nano-banana-pro`** via l'API Krea. `aspect_ratio: "16:9"`, `resolution: "2K"`.
Durée ~30-45 s, sortie 2752 × 1536 (parfois servie en JPEG).

C'est une **édition guidée par instruction**, pas un img2img à intensité. La consigne doit être
formulée en deux blocs : ce qui est interdit, puis ce qui est autorisé. Prompt validé, à garder
tel quel (en anglais, les modèles y sont plus obéissants) :

```
This image is a 3D layout mockup of an arcade game room. Turn it into a photorealistic
architectural interior photograph.

ABSOLUTE RULE — DO NOT MODIFY THE ARCADE MACHINES. Keep every machine exactly as it is: same
models, same positions, same sizes, same proportions, same orientation, same cabinet artwork,
same colors, same screen content, same count. Do not add, remove, move, resize, rotate or
redesign any machine. Do not alter any logo, sticker or graphic printed on the cabinets. You may
only sharpen and relight their surfaces so they look like real photographed machines.

ONLY transform the empty room around them: raw exposed concrete walls, smooth polished concrete
floor, 3.5 m ceiling, industrial black-painted ceiling structure with suspended linear light
fixtures. Add realistic lighting: soft ambient light plus the colored glow the machines cast onto
the floor and nearby walls, subtle reflections of the neon cabinets on the polished floor,
realistic soft contact shadows under each machine, gentle vignetting and natural photographic
grain. Shot on a 24 mm lens at f/4, professional interior photography, crisp and high detail,
photorealistic.
```

Envoi de l'image source à Krea : `get_upload_url` renvoie une URL présignée valable 3 h, on y
POST le fichier en `multipart/form-data` (champ `file`), la réponse est l'URL de l'asset à passer
dans `image_urls`.

**Résultat mesuré :** les machines sont conservées de façon convaincante — formes, couleurs,
jaquettes, écrans. **Seuls les petits textes se dégradent** (un logo « DX », un afficheur
« DEADPOOL » deviennent approximatifs). Invisible à l'échelle de l'image, visible en zoomant.

---

## 4. Les données

### 4.1 Dimensions → métachamp Shopify `custom.specs_dimensions`

**Ce n'est pas dans `catalog_products`** (cette table renvoie 0 ligne au rôle `copilot_readonly`).
La source est Shopify. Format nominal : `"L 705 x P 1450 x H 1980 mm"` (millimètres).

Voisins utiles au même endroit : `specs_weight`, `specs_power`, `specs_capacity`, `specs_tickets`.

Le champ est **saisi à la main**, donc très irrégulier. Douze variantes relevées :

| Cas réel | Particularité |
|---|---|
| `L 705 x P 1450 x H 1980 mm` | format nominal |
| `  L 1140 x P 2420 x H 2460 mm` | espace de tête |
| `L 2520 × P 2490 × H 2750 mm` | signe `×` (U+00D7) au lieu de `x` |
| `L1190 x P 1930 x H 1910 mm` | pas d'espace après `L` |
| `L 1250 x P1600 x H 2290 mm` | pas d'espace après `P` |
| `L 2470x P 1700 x H 2650 mm` | pas d'espace avant `x` |
| `L 1630 x P 1070 x 670 mm` | **le `H` manque** |
| `P 1070 x L 2540 x H 2280 mm` | **`L` et `P` inversés** |
| `L 2110 x P 1190 x H 800/850 mm` | intervalle |
| `Environ L 784 x … en fonction du modèle` | texte autour |
| `L 1377 x P 2134 x H 2143 mm ` | espace de fin |
| `72x26x28` | accessoires : **centimètres**, sans unité ni libellé |
| `Test de taille` | valeur bidon |

Parseur validé sur les 14 cas (fichier joint `parse_dims.py`). Principe : chercher **chaque axe
par sa lettre** (`L`, `P`, `H`) indépendamment — l'ordre n'a alors plus d'importance et
l'inversion `L`/`P` se corrige toute seule. Repli sur le format nu `NxNxN` pour les accessoires.
Garde-fou : rejeter tout ce qui sort de la plage 20 cm – 10 m.

```python
for lettre, cle in (("L","width"), ("P","depth"), ("H","height")):
    m = re.search(rf"\b{lettre}\s*(\d+(?:[.,]\d+)?)(?:\s*/\s*(\d+(?:[.,]\d+)?))?", s)
    if m: axes[cle] = max(float(v.replace(",",".")) for v in re.findall(NOMBRE, m.group(0)))
```

### 4.2 Images des jeux → Shopify, déjà détourées

Excellente nouvelle : les photos de fiche sont des **PNG avec canal alpha, déjà détourés**, en
très haute résolution (2060 × 3358, 3200 × 4912, 4800 × 3414…), en **vue ¾ légèrement en plongée**.
Aucun travail de détourage nécessaire.

Attention : **les résolutions sont très inégales** — 2060 px pour le flipper Deadpool, mais
540 px pour le Mario Kart. Les jeux en basse résolution seront mous au premier plan.

Plusieurs angles existent quand le fabricant les fournit. Stern les nomme **`LF` / `FF` / `RF`**
(left-front / front / right-front) — cette nomenclature est directement exploitable (voir 4.3).

### 4.3 Modèles 3D — trois sources, par ordre de préférence

1. **GLB existants** — 64 jeux SEGA + UNIS déjà optimisés (Draco + WebP 2048), dans
   `~/Downloads/GLB-optimises-planner/{SEGA,UNIS}`. Meilleure qualité, travail déjà payé.
   Champ cible : `catalog_products.model3d`.

2. **Reconstruction multi-vues** — modèle **`tencent/hunyuan3d-3.1-pro`** sur Krea. Il accepte
   `image_urls` (vue de face) + `left_front_image_url` + `right_front_image_url` + `back_image_url`
   + `top_image_url`. **Correspondance directe avec la nomenclature Stern LF/FF/RF.**
   Durée ~3 min, GLB texturé d'environ 60 Mo. **Coût unique par produit**, pas par rendu.

   Testé sur le flipper Deadpool Premium avec ses 3 photos : la **moitié avant** (azimuts 0°, 45°,
   90°, 270°, 315°) est fidèle — jaquette du fronton, afficheur, plateau, monnayeur, pieds, décor
   latéral. La **moitié arrière** (135°, 180°, 225°) est **inventée et floue** : le modèle n'a
   jamais vu le dos. Sans conséquence puisque les machines sont contre les murs, mais il faut
   **interdire les angles arrière** au moteur de cadrage.

   Contrepartie : la texture du modèle 3D est **plus molle que le packshot d'origine**.

3. **Photo à plat (billboard)** — dernier recours, quand une seule photo existe. Voir les pièges
   en §5.

### 4.4 Rendu des GLB en sprites — Blender

Blender **5.0.1** est installé sur le Mac de Léopaul (`/Applications/Blender.app`). Script joint :
`glb_vues.py`, lancé en headless :

```bash
/Applications/Blender.app/Contents/MacOS/Blender -b -P glb_vues.py -- modele.glb sortie/ 8
```

Deux pièges Blender, tous deux rencontrés :

- Le moteur s'appelle **`BLENDER_EEVEE`** en 5.0.1, **pas** `BLENDER_EEVEE_NEXT` (qui n'existe
  plus dans l'énumération et lève un `TypeError`).
- Mettre **`scene.view_settings.view_transform = "Standard"`** : en AgX (défaut) les rendus
  sortent délavés.

Réglages : `film_transparent = True`, `color_mode = "RGBA"`, focale 85 mm avec recul (peu de
distorsion, cohérent avec les packshots), élévation ~12° (plongée légère, comme les photos
catalogue).

---

## 5. Points de vigilance

### 5.1 Les deux vues doivent partir du MÊME côté de la salle

**Erreur commise pendant le test.** J'avais placé la vue 1 dans le coin avant-gauche et la vue 2
dans le coin avant-droit. Résultat : la lecture s'inverse, et Léopaul a cru que **les jeux avaient
changé de place**. Ils n'avaient pas bougé d'un centimètre.

Règle : les deux caméras partent du même côté (par exemple une vue large + une vue rapprochée, ou
deux points voisins). Le client doit reconnaître la même salle, pas la reconstituer.

### 5.2 Vérifier que tous les jeux sont dans le cadre

Toujours pendant le test, le flipper est **sorti du champ** de la vue 2 sans que rien ne le
signale. Il faut une vérification automatique : projeter chaque machine, et si l'une sort du
cadre, élargir le champ ou reculer la caméra avant de lancer la génération (qui coûte du temps
et des crédits).

### 5.3 Choisir la bonne photo selon la position de la caméra

**Deuxième erreur commise.** J'avais utilisé la photo `LF` (vue depuis la **gauche** de la
machine) alors que, sur le plan, la caméra se trouvait sur sa **droite**. La machine était donc
montrée par le mauvais côté — d'où un flipper « qui rendait bizarrement », symptôme signalé par
Léopaul avant que j'en trouve la cause.

Il faut calculer l'azimut caméra↔machine et choisir la vue en conséquence :

```python
# vecteur machine -> caméra, dans le repère de la machine
d = normalize(CAM[:2] - machine_xy)
# 0° = on voit la machine de face ; l'azimut croît dans le sens trigonométrique
azimut = degrees(atan2(d.y, d.x)) - machine_rotation - 90
```

Avec les rendus Blender nommés par angle (`vue_000`, `vue_045`, …), on prend le plus proche —
**en excluant les angles arrière** (135°–225°).

### 5.4 Le billboard fausse la largeur

Une photo en vue ¾ contient la largeur **et** la profondeur de la machine. Si on dimensionne le
sprite sur le ratio de la photo, un flipper de 70 cm de large occupe visuellement près d'1,40 m.
Le rendu 3D corrige ça automatiquement (la projection est juste par construction) ; le billboard,
non. À corriger si on garde le billboard en repli.

### 5.5 Ne jamais estimer les cotes

Sur les 5 jeux du test, mes estimations s'écartaient jusqu'à **56 cm** du réel :

| Jeu | Estimation | Réel (fiche) |
|---|---|---|
| Mario Kart 3 GP DX | 280 × 230 × 222 | 104 × 160 × 239 (par borne) |
| Need For Speed | 110 × 230 × 225 | 104 × 168 × 234 |
| Super Blaster 2 | 220 × 260 × 245 | **169 × 204 × 301** |
| Flipper Deadpool Premium | 74 × 145 × 193 | 70,5 × 145 × 198 |
| Emoji Power Puck Multi | 250 × 160 × 200 | 234 × 152,5 × 170 |

### 5.6 Le piège des bornes Twin / DX

La fiche **Mario Kart 3 GP DX** donne les cotes d'**une seule borne** (104 cm de large), alors que
la photo du site en montre **deux côte à côte**. À trancher : soit le Planner place deux unités
distinctes, soit on ajoute un champ « nombre de postes ». Concerne probablement tous les
modèles Twin / DX / Multi.

### 5.7 Fiches Shopify à corriger à la source

- **Flipper Deadpool** et **Flipper Jurassic Park** (fiches sans mention Premium/Pro) :
  valeur `Test de taille`
- **T-rex Park** : `L` et `P` inversés
- **Table Gameland** et **Table Magic** : le `H` manque
- **Billard Winner** : `H 800/850` (intervalle — le parseur prend 850, à confirmer)

Le parseur les rejette proprement, mais autant réparer les fiches.

### 5.8 Recadrage léger par l'IA

Le modèle décale/zoome légèrement l'image (sortie 2752 × 1536 pour une entrée 1600 × 900, même
ratio). Les positions ne sont donc pas conservées au pixel près. Sans importance ici puisque le
millimètre n'est pas l'enjeu — mais à savoir si on voulait superposer des annotations sur le
rendu final.

---

## 6. Ce qu'il reste à faire

1. **Lire les cotes depuis Shopify** et les stocker côté Arcade OS (`catalog_products.width /
   depth / height`), avec le parseur de `parse_dims.py`. Prévoir un rafraîchissement, le champ
   Shopify bougeant à la main.
2. **Cadrage automatique des deux vues** : choisir les positions de caméra depuis le même côté,
   vérifier que toutes les machines sont dans le champ, reculer/élargir sinon.
3. **Bouton « Générer la vue »** dans `SpacePlanner.tsx` : appel d'une edge function qui
   enchaîne projection → composite → passe IA, puis stocke les images.
4. **Choix du sprite par machine** : GLB si `model3d` est rempli → sinon vue reconstruite →
   sinon photo à plat, avec sélection de l'angle (§5.3).
5. **Baker les sprites des 64 GLB existants** avec `glb_vues.py`, stocker dans un bucket Supabase.
6. **Lancer les reconstructions Hunyuan3D** pour les jeux qui ont 2-3 photos et pas de GLB.
7. **Trancher la question des bornes Twin** (§5.6).
8. **Corriger les 6 fiches Shopify** (§5.7).
9. Brancher le rendu comme **bloc optionnel du dossier client** (c'était l'« Étape 2 » mise de
   côté).

## 7. Coûts et performances mesurés

| Opération | Durée | Fréquence |
|---|---|---|
| Projection + composite | < 1 s | à chaque rendu |
| Passe IA (nano-banana-pro, 2K) | 30-45 s | à chaque rendu |
| Reconstruction 3D (hunyuan3d-3.1-pro) | ~3 min | **une fois par produit** |
| Rendu 8 angles Blender (EEVEE) | ~1 min | une fois par produit |

Une salle = 1 à 2 images, donc **moins d'une minute et quelques centimes**. Le gros du coût est
la préparation des modèles, qui ne se paie qu'une fois.

## 8. Fichiers de référence

Scripts fonctionnels produits pendant le test (à reprendre, pas à réécrire) :

- `rendu.py` — caméra, lancer de rayons de la salle, image guide filaire, composite
- `parse_dims.py` — parseur du métachamp `custom.specs_dimensions`, testé sur 14 cas
- `glb_vues.py` — rendu Blender headless d'un GLB sous N angles, fond transparent
