# Test Manuel - Éditeur Spatial 2D

## ✅ Éléments vérifiés

### 1. Interface Visuelle
- [x] Header avec "SpacePlanner" (violet + vert néon correct)
- [x] Badge "Beta" visible
- [x] Toolbar à gauche avec icônes
- [x] Sidebar droite "Salles" vide
- [x] Canvas avec grille métrique
- [x] Labels de mesure (1m, 2m, 3m, 4m)
- [x] Coordonnées affichées (0cm × 0cm)
- [x] Zoom indicator (100%)
- [x] Instructions pour placer les points

### 2. Couleurs Design System
- [x] Background: #060619 (bleu nuit)
- [x] Violet néon pour "Space" (hsl(263, 85%, 68%))
- [x] Vert néon pour "Planner" (hsl(75, 100%, 50%))
- [x] Grille visible avec bonne opacité

---

## 📝 Tests à faire manuellement

### Test 1: Dessiner une salle rectangulaire
1. Canvas prêt (outil "Mur" sélectionné par défaut)
2. Cliquez 4 fois pour créer un rectangle:
   - Point 1: En haut à gauche (~350px, ~150px)
   - Point 2: En haut à droite (~750px, ~150px)
   - Point 3: En bas à droite (~750px, ~450px)
   - Point 4: En bas à gauche (~350px, ~450px)
3. Cliquez près du Point 1 pour fermer le polygone
4. **Résultat attendu**: Salle créée et affichée dans la sidebar

### Test 2: Vérifier les dimensions
- Les dimensions doivent s'afficher en jaune doré sur les murs
- Format: "X.XXm" ou "XXXcm" selon la longueur

### Test 3: Zoom à la molette
1. Scrollez vers le haut (zoom in) → le zoom % augmente
2. Scrollez vers le bas (zoom out) → le zoom % diminue
3. Les dimensions doivent s'adapter automatiquement

### Test 4: Pan (déplacement)
1. Appuyez sur H ou clic molette + drag
2. La grille doit se déplacer
3. Les axes doivent suivre

### Test 5: Raccourcis clavier
- **V**: Select tool
- **W**: Wall tool (par défaut)
- **D**: Door tool
- **H**: Pan tool
- **E**: Eraser tool
- **Échap**: Annuler le dessin en cours

---

## 🐛 Limitations actuelles
- L'automation du navigateur (browser--act) ne peut pas cliquer sur le canvas HTML5
- Tests manuels requis pour valider les interactions
