## Volet 1 — Restriction d'accès au copilote

### Données
- Migration : ajouter `copilote_enabled boolean not null default true` à `public.profiles` (plus simple que nouvelle table, profils déjà auto-créés par `handle_new_user`).
- RLS :
  - SELECT : utilisateur peut lire son propre profil ; admins lisent tout (policy existante déjà + on ajoute admin si absente).
  - UPDATE de `copilote_enabled` : admins uniquement (nouvelle policy dédiée).
- Par défaut TOUS les users actifs.

### Serveur
- Dans `supabase/functions/gaia-copilot/index.ts`, juste après l'auth existante : lire `profiles.copilote_enabled` du user. Si `false` → 403 JSON `{ error: "Accès au copilote non actif pour votre compte" }`. Couvre chat, revue, askCopilot fiche 360 (toutes passent par cette function).

### UI
- `AuthContext` : exposer `copilotEnabled: boolean` (chargé en parallèle des rôles, défaut `true` pendant chargement pour éviter flash).
- `AppHeader` / `MobileNav` : masquer l'entrée "Copilote" si `!copilotEnabled` (actuellement pas d'onglet dédié — vérifier ; sinon masquer le bouton dans `GaiaCopilot` shell).
- `RevueDashboard` : masquer bouton "Générer la revue du mois" si `!copilotEnabled`.
- `GaiaClientFiche` : masquer bouton "Demander au copilote" si `!copilotEnabled`.
- `GaiaCopilot` composant : si `!copilotEnabled`, afficher message doux "Le copilote n'est pas encore ouvert à votre compte" à la place du chat.
- Page `/admin` (`AdminDossiers.tsx`) : ajouter une section "Utilisateurs" (admins only) avec table des profiles + Switch `Accès copilote` qui update `profiles.copilote_enabled` via supabase.

## Volet 2 — Audit UI mobile (navigation retour)

### Nouveau composant partagé
- `src/components/DetailPageHeader.tsx` : header sticky (`sticky top-0 z-50 backdrop-blur bg-background/85 border-b`) avec :
  - Bouton retour (ArrowLeft) 44×44px min à gauche (`h-11 w-11`), toujours visible (`flex-shrink-0`).
  - Titre au centre : `flex-1 min-w-0 truncate`.
  - Slot actions à droite regroupables (menu `...` si >2 sur mobile — simple pass-through props pour l'instant).
  - Prop `backTo` (string) ou `onBack`.

### Pages à migrer vers le nouveau header sticky
- `src/pages/GaiaCarnet.tsx`
- `src/pages/SavTicket.tsx`
- `src/pages/GaiaClientFiche.tsx`
- `src/pages/GaiaRevueView.tsx`
- (Détail commande e-commerce : c'est un panneau/modal, pas une route dédiée → vérifier, ajuster si route existe.)
- (Veille : pas de page détail dédiée à ce jour.)

### Corrections responsive additionnelles
- Toutes ces pages : envelopper tables dans `<div className="overflow-x-auto">`, s'assurer pas de scroll horizontal, KPIs `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`.
- Bandeau Pipeline (`GaiaDashboard`) : passer les étapes en `flex-col md:flex-row` sans overflow.
- Ne pas toucher au design desktop.

### Hors scope
- Aucune autre modification (business logic, styles desktop, contenu du copilote).

## Fichiers modifiés (récap)
- Migration SQL (profiles + RLS)
- `supabase/functions/gaia-copilot/index.ts`
- `src/contexts/AuthContext.tsx`
- `src/components/DetailPageHeader.tsx` (nouveau)
- `src/pages/AdminDossiers.tsx` (section users + toggle)
- `src/pages/GaiaCarnet.tsx`, `src/pages/SavTicket.tsx`, `src/pages/GaiaClientFiche.tsx`, `src/pages/GaiaRevueView.tsx`
- `src/components/admin/GaiaCopilot.tsx`, `src/components/admin/RevueDashboard.tsx`, `src/components/admin/GaiaDashboard.tsx`
- `src/integrations/supabase/types.ts` (regen auto)
