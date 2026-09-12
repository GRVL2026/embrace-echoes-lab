# Arcade Planner — outils de rendu photoréaliste

Reconstruits le 12/09/2026 depuis `PASSATIONrenduphotorealiste.md` (les scripts d'origine
étaient introuvables sur le Mac). Chaîne : **plan 2D → projection perspective → composite des
sprites à l'échelle → passe IA photoréaliste (Krea nano-banana-pro)**.

Architecture retenue (validée par Léopaul le 12/09) :
- **Prépa offline (une fois par produit)** : baking des GLB (Blender) + reconstructions 3D → local Mac.
- **Génération de la vue au clic** : projection + composite **côté navigateur** (port JS de `rendu.py`),
  puis edge Deno minimale `generer-vue` qui appelle Krea. Pas de nouvelle infra.

## Scripts

### `parse_dims.py` — cotes Shopify → cm
Parseur du métachamp `custom.specs_dimensions`. Cherche chaque axe par sa lettre (L/P/H,
en mm → cm), repli `NxNxN` (accessoires, cm), garde-fou 20 cm – 10 m. Validé sur 14 cas.
```bash
python3 parse_dims.py   # lance l'auto-test
```

### `glb_vues.py` — baking des sprites (Blender headless)
Rend un GLB sous N angles, fond transparent (PNG RGBA), EEVEE + view transform Standard,
85 mm, élévation ~12°. Sprites nommés `vue_000.png`, `vue_045.png`, …
```bash
/Applications/Blender.app/Contents/MacOS/Blender -b -P glb_vues.py -- modele.glb sortie/ 8
```
Entrées prêtes : Blender 5.0.1 + 64 GLB dans `~/Downloads/GLB-optimises-planner/{SEGA,UNIS}`.

### `rendu.py` — projection + salle + composite (RÉFÉRENCE)
Projection sténopé (`project`), salle béton par lancer de rayons numpy (`render_room`),
composite peintre des sprites à l'échelle + ombre de contact (`composite`). Sert de référence
au port JS navigateur.
```bash
python3 rendu.py   # démo : salle nue -> /tmp/room_demo.png
```

## Reste à faire
- Porter `project` + `composite` en JS (canvas), en réutilisant `src/lib/render3DCaptures.ts`.
- Edge `generer-vue` (appel Krea) + secret `KREA_API_KEY`.
- Uploader les sprites bakés dans un bucket Supabase (accès écriture à définir).
- Câbler `parse_dims` dans l'edge `shopify-catalog` pour alimenter `catalog_products.width/depth/height`.
- Bouton « Générer la vue » (barre d'outils SpacePlanner) + bloc dossier client.
