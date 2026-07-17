
# Interactivité "chaque chiffre mène à son détail"

Règle permanente : toute tuile KPI, ligne de liste ou segment de graphique doit être cliquable et ouvrir le détail correspondant (section ciblée, panneau latéral, page 360, ou liste filtrée). Curseur pointer + effet hover discret. Un élément sans détail pertinent reste non-cliquable, sans hover trompeur.

## Convention technique partagée

Introduire deux petits utilitaires réutilisés partout :

- `<KpiTile onClick title value hint>` — carte KPI cliquable (rôle `button`, `aria-label`, focus visible, hover `border-primary/60`, active `translate-y-[1px]`). Fallback statique quand `onClick` absent (aucun hover).
- Helper `scrollToId(id)` pour cibler une section de la même page (KPI → section correspondante) + `useState` local pour panneaux latéraux.

Chaque section ciblable reçoit un `id` stable (`id="ca-mensuel"`, `id="stock-detail"`, etc.). Les tuiles KPI en haut deviennent des ancres cliquables vers ces sections. Les segments de graphiques recharts reçoivent `onClick` sur `<Bar>` / `<Pie>` (déjà supporté par recharts).

## Portée par page

### Dashboard AA (`GaiaDashboard.tsx`)
- Tuile "CA exercice" → scroll vers section CA mensuel.
- Tuile "Stock" → ouvre panneau latéral "Stock par dépôt" (agrégation `gaia_stock` par `depot`, valeur + quantité).
- Tuile "Éco-taxe" → scroll vers détail mensuel éco-taxe (créer sous-section si absente).
- Carte "Marge" → panneau "Comment est calculée la marge" (formule + composants, texte statique).
- Lignes du palmarès clients (top CA) → `Link` vers `/admin/gaia/client/:nom` (fiche 360) — vérifier/compléter.
- Segments donut familles → panneau latéral listant les ventes de la famille cliquée (top articles + top clients de la famille sur l'exercice).

### Onglet Magasin (`GaiaMagasin.tsx`)
- Tuiles KPI (CA magasin, marge, panier moyen, nb factures) → scroll vers section correspondante (CA mensuel magasin, top articles, top clients).
- Lignes top clients magasin → fiche 360 (Link).
- Lignes top articles → panneau latéral "Historique de ventes de l'article" (dernières factures, top clients de l'article, courbe CA mensuel).
- Sous-familles → panneau latéral "Articles de la sous-famille" (liste des `code_article` avec CA, qté, dernière vente).

### SAV (`Sav.tsx`)
- Tuiles KPI (ouverts, en attente, résolus 30j, backlog) → applique le filtre statut correspondant sur la liste principale + scroll vers la liste.
- Lignes top clients SAV → recherche/filtre déjà en place à vérifier ; sinon appliquer le nom au filtre de recherche + scroll.

### E-commerce (`Ecommerce.tsx`)
- Tuiles KPI (CA, commandes, panier moyen, nouveaux clients) → filtre + scroll vers la liste correspondante.
- Lignes top produits → panneau détail produit (dernières commandes).
- Lignes top clients → fiche client si existante, sinon panneau récap.

### Hub (`Hub.tsx`)
- Cartes environnements déjà cliquables — vérifier hover + aria-label uniformes.

### Fiches (client, dossier, revue)
- Vérification passive : tuiles KPI existantes cliquables ou explicitement statiques. Aucun changement fonctionnel si déjà fait.

## Règles UX appliquées

- Curseur `cursor-pointer` uniquement si `onClick` réel.
- Hover : `hover:border-primary/60 hover:bg-card/70` + `transition-colors`.
- Focus clavier : `focus-visible:ring-2 ring-primary/50`.
- Tap-target mobile ≥ 44px pour KPI et lignes de liste.
- `aria-label` explicite ("Voir CA mensuel", "Ouvrir la fiche de X", "Filtrer sur tickets en attente").
- Éléments sans détail (ex : petites étiquettes info) : pas de hover, pas de pointer.

## Non-régressions

- Aucune route existante modifiée, aucun endpoint changé.
- Les composants existants gardent leur signature ; l'ajout se fait via wrappers ou props optionnelles.
- Panneaux latéraux : `Sheet` shadcn (déjà utilisé), safe-area et header sticky déjà en place.
- React Query, badges origine, `DetailPageHeader` conservés.

## Détails techniques

- `src/components/ui/KpiTile.tsx` (nouveau) : `button` accessible ou `div` statique selon `onClick`.
- Extension `chartTooltip.tsx` déjà présent — ajouter `onClick` sur `<Bar>`/`<Cell>` pour donuts (segment → panneau).
- Panneaux Sheet : réutiliser le pattern `useState<string | null>` (comme `openParcFamille` de la fiche client).
- Requêtes ajoutées limitées à `LIMIT 50` pour les listes latérales (ventes article, ventes famille, articles sous-famille, stock par dépôt).
- Aucune migration DB nécessaire : réutilisation des vues existantes (`v_gaia_lignes`, `gaia_stock`, `gaia_commandes`, tickets Zendesk cache).

## Livrable

1. `KpiTile` partagé + convention hover.
2. Câblage Dashboard AA (KPI + palmarès + donut familles + panneau stock/marge).
3. Câblage Magasin (KPI + top clients/articles + sous-familles).
4. Câblage SAV (KPI → filtres liste).
5. Câblage E-commerce (KPI → listes filtrées + panneau produit).
6. Vérification Hub + fiches (hover/aria seulement).
