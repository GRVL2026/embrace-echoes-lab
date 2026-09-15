# Arcade OS — guide de travail

À lire avant toute intervention. Ces règles priment sur les habitudes par défaut.

## Le produit

**Arcade OS** est l'outil interne d'**Avranches Automatic** : pilotage commercial, prospection,
dossiers clients, catalogue, et l'**Arcade Planner** (plan 2D d'une salle d'arcade + rendu
photoréaliste pour que le client se projette).

Stack : React / TypeScript / Vite, Supabase (Postgres + RLS + Edge Functions Deno), hébergé et
publié via Lovable.

## Règles de travail

**Chemin 1.** Tout le code — front et back — se modifie **ici, dans Claude Code**, puis on pousse
sur GitHub. Lovable ne sert plus qu'à **héberger, publier et prévisualiser**. On n'édite plus rien
dans l'éditeur Lovable : sa synchro bidirectionnelle recréerait des commits concurrents.
Toujours `git pull --rebase origin main` avant de pousser.

**Étapes manuelles de Léopaul**, inchangées : publier le front (bouton Publish dans Lovable),
coller le SQL dans l'éditeur Supabase, redéployer une edge function. Le SQL se donne **prêt à
coller**, jamais exécuté par moi (l'accès SQL dont je dispose est en lecture seule).

**Une étape à la fois.** Donner UNE action, attendre son résultat. Ne jamais enchaîner une liste
d'étapes. Léopaul est débutant en développement : guider pas à pas, en français, en proposant les
commandes avant de les exécuter.

**Ne rien supposer.** Un constat = une observation vérifiée + une mesure. Jamais une déduction
tirée de la consigne qu'on vient d'envoyer, jamais une extrapolation à partir de deux cas.

**Sur tout rendu visuel** : regarder l'image avec des yeux de client AVANT de mesurer quoi que ce
soit. Les mesures ne voient ni les textes illisibles, ni les machines qui flottent, ni les
découpes. Voir la skill `rendu-planner`.

**Ne jamais écrire « Hypernova » ni « Hypernova Arcade »** dans aucun contenu. Seulement
« Avranches Automatic ».

**Le menu n'est que l'affichage.** Les données sont protégées séparément par les policies RLS :
ouvrir une entrée de menu sans vérifier la policy donne une page vide.

## Les sujets

Chaque sujet a sa **skill** (`/nom-du-sujet`) qui charge ses règles, son état et ses pièges.
Ouvrir une discussion par sujet plutôt que de tout mélanger.

| skill | sujet |
|---|---|
| `/rendu-planner` | rendu photoréaliste des salles d'arcade |
| `/prospection` | cockpit, Gazette, distribution des leads, Pipedrive |
| `/acces-roles` | rôles, permissions de menu, policies RLS |
| `/donnees-copilote` | dashboards, RPC gaia, copilotes, synchro ERP |

## Documentation durable

- `docs/planner/descriptions-machines.md` — fiches d'intégration par jeu (à enrichir à chaque
  machine intégrée dans une scène)
- `tools/planner-photoreal/README.md` — la chaîne de rendu et ses pièges

## Commandes

```bash
npm run dev      # serveur de développement
npm run build    # build de production
npm run lint     # ESLint
```
