# Sortie d'Arcade OS de Lovable — plan de migration

Décidé le 16/09/2026. Objectif : héberger Arcade OS sur une infrastructure qui appartient
à Avranches Automatic, et cesser de dépendre de Lovable pour déployer, exécuter du SQL ou
sauvegarder.

**Faisabilité prouvée le 16/09** : le schéma complet (69 tables, 40 vues, 166 policies) a
été restauré avec succès sur un projet Supabase vierge. Cf. la recette et ses pièges dans
la mémoire `arcadeos-migration-recette-testee`.

---

## Ce qui rend la migration plus simple qu'attendu

- **Le front ne connaît pas Lovable.** Tout passe par des variables Vite :
  `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID`,
  `VITE_DOSSIER_SHARE_ORIGIN`. Migrer le front = changer quatre valeurs.
- **La référence au projet Lovable n'est en dur que dans 5 fichiers**, dont 2 migrations
  d'archives : `supabase/config.toml`, `supabase/functions/mcp/index.ts`,
  `.lovable/mcp/manifest.json`.
- **Les liens de dossiers partagés ne casseront pas** : ils passent par
  `dossiers.avranchesautomatic.workers.dev`, un domaine qui nous appartient. Seule la cible
  du Worker est à repointer.
- **45 des 48 edge functions** sont du Deno standard, déployables telles quelles.

## Ce qui coûte vraiment

1. **Les 29 secrets** (valeurs non exportables, à réémettre une par une).
2. **Le storage** : buckets `dossiers`, `prospects`, `models-3d` — fichiers à re-télécharger
   puis re-téléverser.
3. **3 edge functions** passant par la passerelle IA de Lovable : `copilot-chat`,
   `analyze-plan`, `sketchfab-search`. À rebrancher sur Anthropic en direct — ou à
   supprimer : `sketchfab-search` n'est appelée nulle part dans le front, et les deux
   autres relèvent du module 3D abandonné. **Vérifier avant de payer pour les porter.**
   `gaia-copilot`, le copilote réel, appelle déjà `api.anthropic.com` directement.
4. **OAuth Google** à reconfigurer (nouvelles URL de redirection).
5. **Le webhook LGM** à repointer vers la nouvelle URL de fonction.

## Coût récurrent

**Supabase Pro : 25 $/mois.** Le plan gratuit est exclu pour de la production — il met les
projets en pause après une semaine d'inactivité et n'offre pas de sauvegardes quotidiennes.
Hébergement du front : gratuit (Vercel ou Cloudflare Pages), avec déploiement automatique
à chaque push — donc meilleur que le « Publish » manuel actuel.

---

## Ordre des opérations

On construit intégralement le nouveau système **à côté**, sans toucher à la production.
La bascule n'intervient qu'à la phase 8, et elle est réversible jusque-là.

### Phase 1 — Le projet cible
Créer le projet Supabase (plan Pro, région West EU Ireland), définir le mot de passe de la
base **au moment de la création** et le consigner dans le gestionnaire de mots de passe.

### Phase 2 — La base — **FAITE le 16/09/2026** sur `dkoroqqvfyjmkaoidwzq`

Résultat vérifié : 69 tables, 40 vues, 98 fonctions, 166 policies, RLS active sur les 69
tables, 750 autorisations rejouées sans erreur, 91 relations lisibles par
`copilot_readonly`, et les **7 comptes utilisateurs avec leurs mots de passe**.

**L'ordre EXACT, chaque écart ayant coûté un échec :**

1. Extensions d'abord : `pg_trgm`, `unaccent`, `pg_net` **dans public**, puis `pg_cron`.
   Elles expliquent l'écart 98 → 63 fonctions si on les oublie.
2. **Les DEUX rôles** : `copilot_readonly` ET **`sandbox_exec`**. Ce second rôle n'apparaît
   nulle part dans l'analyse du schéma mais porte **120 autorisations** : sans lui, elles
   disparaissent en silence. pg_dump n'exporte jamais les rôles.
3. `pg_restore --schema-only --schema=public --no-owner` — **surtout PAS
   `--no-privileges`**, sinon tous les GRANT à `copilot_readonly` sont perdus.
4. **`auth.users` AVANT les données de `public`** : sinon 55 tables échouent sur leurs clés
   étrangères. Puis `auth.identities` APRÈS `auth.users` (l'ordre du dump est inverse).
5. `pg_restore --data-only --schema=public --no-owner`. **Ne pas utiliser
   `--disable-triggers`** : il exige des droits superutilisateur que Supabase n'accorde pas.
6. Rejouer les tables restées vides pour cause de clé étrangère (`dossier_vues`,
   `client_actions`), puis `refresh materialized view` sur les deux vues `mv_gaia_*`,
   puis `analyze`.

**Écarts de comptage attendus** : la production vit pendant l'opération. `gaia_achats` peut
même avoir MOINS de lignes en production qu'au moment du dump, car `cegid-sync` remplace ce
flux à chaque passage. D'où la règle : **export frais juste avant la bascule**.

Reste à faire sur cette phase : un audit de sécurité complet sur la cible — RLS, fonctions
SECURITY DEFINER, droits `anon` — car c'est la couche où une erreur est silencieuse.

### Phase 3 — Les secrets
Réémettre les secrets. Décompte réel : 32 référencés, dont 3 fournis automatiquement par
Supabase (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) et 3 à
supprimer avec les fonctions mortes (`LOVABLE_API_KEY`, `SKETCHFAB_API_TOKEN`,
`FIRECRAWL_API_KEY`) — soit **26 à poser**, dont 4 générables localement (`CRON_SECRET`
et les trois `VAPID_*`).

**Cegid — ⏰ CONTRAINTE DE DÉLAI.** Une application connectée dédiée (`dashboardleo2`) a été
créée par Romain le 16/09/2026, en parallèle de l'existante (`dashboardleo`) qui continue
d'alimenter la production. Son secret n'expire qu'en 2099, **mais l'application est révoquée
après 60 jours sans connexion** : la bascule doit donc intervenir **avant la mi-novembre
2026**, sinon il faut repasser par Romain.

Validé le 16/09 : `client_id` et `client_secret` acceptés par
`.../identity/connect/token` (l'erreur est passée de `invalid_client` à
`invalid_username_or_password`, ce qui prouve que l'application est reconnue).
**RÉSOLU le 16/09** : le compte utilisateur est `rfioriti` (format Cegid = initiale du
prénom + nom, PAS l'adresse e-mail ni le login d'interface web). Vérifié de bout en bout :
jeton obtenu, puis **les 7 flux OData répondent HTTP 200**, et `cegid-sync` exécutée sur le
nouveau projet renvoie `token_step.ok = true`.

Piège qui a coûté 25 essais : ni `lpoblin`, ni les adresses e-mail, ni les variantes avec
suffixe `@AVRANCHES` ne fonctionnent. Le format est **initiale + nom, en minuscules, sans
suffixe**.

⚠️ **Deux dettes à traiter après la bascule** :
- le compte utilisé est le compte **nominatif de Romain**. Si son mot de passe change ou si
  son compte est désactivé, la synchronisation s'arrête. Demander un compte de service dédié.
- son mot de passe est `mdp1234!` — trivial, pour un accès en lecture à l'intégralité des
  données commerciales. À changer indépendamment de la migration.

**Leçon plus large** : le compte qui fait tourner la synchronisation en production depuis
juillet reste inconnu — son mot de passe n'existe que dans les secrets Lovable, qui ne les
communique pas. Si ce compte avait été désactivé, la synchronisation se serait arrêtée sans
aucun moyen de la relancer.

**À faire après la bascule** : demander à Romain de régénérer le secret de
`dashboardleo2` (il a transité en clair lors de la mise en place), et de supprimer
l'application `dashboardleo`.

### Phase 4 — Les edge functions — **VALIDÉ le 16/09/2026**
`supabase functions deploy` pour les 48 (moins celles qu'on supprime).

Testé de bout en bout sur le projet `jlsecjnozhaloxgbckhj` : `npx supabase login`
(authentification par navigateur, aucun token à manipuler), `link --project-ref`
(le mot de passe de la base n'est PAS nécessaire, il ne sert qu'au transfert de données),
puis `functions deploy` — la fonction `importer-glb` a été déployée en 15 secondes et
répond HTTP 401, donc vivante et protégée. **Docker n'est pas requis** : l'avertissement
« Docker is not running » est bénin, le déploiement passe par l'API.

La CLI s'utilise sans installation via `npx --yes supabase@latest <commande>`.

**PHASE FAITE le 16/09 : les 47 fonctions sont déployées sur `dkoroqqvfyjmkaoidwzq`**, toutes
`ACTIVE`, par une seule commande `supabase functions deploy --project-ref <ref>` (sans
argument : déploie tout). Vérifié en anonyme : `gaia-copilot` 401, `cegid-sync` 403,
`copilot-sentinel` 401, `audit-catalogue` 401 — protections intactes.
`lgm-webhook` répond 500 faute de `LGM_WEBHOOK_SECRET` : **à revérifier après la phase 3**,
on attend « invalid token » (fail-closed) et non une erreur serveur.

C'est le bénéfice central de la migration : aujourd'hui, déployer une edge function exige
de demander au chat Lovable de le faire « sans modifier une seule ligne », puis de vérifier
qu'il a obéi. Après migration, c'est une commande.

### Phase 5 — Les crons
Recréer les 14 planifications en réécrivant l'URL du projet dans chaque commande.
Reprendre le motif de `shopify-stats-refresh`, qui lit le secret dans `gaia_config` au lieu
de l'écrire en dur. En profiter pour **faire la rotation du CRON_SECRET**, exposé le 15/09.

### Phase 6 — Le storage
Télécharger puis re-téléverser les 3 buckets. Conserver la lecture publique sur
`models-3d` (les dossiers partagés sont consultés hors session).

### Phase 7 — Le front
Déployer sur Vercel depuis GitHub, avec les 4 variables Vite pointant sur le nouveau projet.

### Phase 8 — La bascule
Fenêtre calme, hors activité commerciale. Repointer le Worker Cloudflare, le webhook LGM
et les URL de redirection OAuth. Vérifier avec les 7 utilisateurs qu'ils se connectent.

### Phase 9 — Décommissionnement
**Ne rien supprimer chez Lovable avant deux semaines de fonctionnement nominal.**
Conserver l'export du 16/09 indéfiniment.

---

## Points de vigilance

- **Ne pas migrer un jour de forte activité commerciale.** La synchro Cegid tourne à 3 h et
  alimente tous les tableaux de bord : une coupure se voit immédiatement.
- **Faire un export frais le jour J.** Celui du 16/09 sert de référence de structure, pas de
  jeu de données final.
- **Auditer la sécurité après restauration**, sans supposer qu'elle se transporte : les
  rôles ne figurent pas dans un dump, et les droits `EXECUTE` accordés à `PUBLIC` sont
  exactement le genre de détail qui passe inaperçu (cf. le REVOKE inopérant du 15/09).
- **Vérifier que la CLI Supabase fonctionne** dès la phase 1 : c'est elle qui remplace le
  chat Lovable pour déployer. Si elle échoue, tout le bénéfice de la migration tombe.
