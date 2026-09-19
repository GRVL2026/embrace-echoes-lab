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

2 bis. **Les APPARTENANCES de rôles — le piège le plus subtil.** pg_dump n'exporte pas non
   plus qui est membre de quoi. À rejouer impérativement :
   ```sql
   grant copilot_readonly to authenticated;
   grant copilot_readonly to service_role;
   grant sandbox_exec   to postgres;
   ```
   Sans elles, `gaia_query` échoue sur `permission denied to set role "copilot_readonly"`
   (elle fait `SET LOCAL ROLE`), et **les 7 détecteurs de la Sentinelle tombent d'un coup** —
   alors que le rôle existe, que les GRANT de tables sont posés et que tout paraît correct.
   Requête de contrôle, à comparer avec la production :
   ```sql
   select r.rolname, g.rolname from pg_auth_members m
     join pg_roles r on r.oid=m.member join pg_roles g on g.oid=m.roleid
    where g.rolname in ('copilot_readonly','sandbox_exec');
   ```
   Vérifié après correction : Sentinelle `ok=true`, **9 signaux, 0 détecteur en échec**.
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

**AUDIT DE SÉCURITÉ FAIT le 16/09 — et il a trouvé une régression majeure.**

À la restauration, la cible présentait **41 fonctions SECURITY DEFINER exécutables par
`anon`**, contre 0 en production. Cause : le dump date de 9h49, soit AVANT l'application des
`REVOKE` du matin ; et toute fonction créée par Lovable naît avec `EXECUTE` accordé à
`PUBLIC`. **Une migration qui se serait arrêtée à « les comptes correspondent » aurait mis en
ligne une base ouverte.**

Correctif appliqué : `REVOKE EXECUTE ... FROM public, anon` sur les 41, puis `GRANT` à
`authenticated` sur les 27 qui l'ont en production. Puis 14 `REVOKE` supplémentaires, la
cible étant plus permissive que la production sur des fonctions internes (triggers, tâches
de maintenance, routines appelées en `service_role`).

État final vérifié, **identique à la production** : 41 SECDEF, 0 pour `anon`, 27 pour
`authenticated`. Sondes anonymes avec la clé publique : `gaia_ventes`, `gaia_clients`,
`gaia_achats` renvoient `permission denied` ; `prospects`, `profiles`, `user_roles`
renvoient `[]` ; les RPC sensibles sont fermées. Aucune fuite.

**Règle à retenir : ne jamais supposer que la sécurité se transporte avec les données.**
Rejouer cet audit après CHAQUE restauration, y compris celle du jour de la bascule.

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
**Premier cron posé le 16/09 : `cegid-keepalive-hebdo`** (job 1, lundis 7h UTC). Il appelle
`cegid-sync` en mode `discover` — 2 lignes lues, aucune écriture — pour réarmer le compteur
de 60 jours de l'application Cegid. Vérifié en exécutant la commande du job : HTTP 200,
`token_step.ok = true`. **À supprimer après la bascule**, la synchro nocturne suffira.

Note : `gaia_config.cron_secret` a été aligné sur le CRON_SECRET du nouveau projet — la
valeur restaurée était celle de l'instance Lovable.
Recréer les 14 planifications en réécrivant l'URL du projet dans chaque commande.
Reprendre le motif de `shopify-stats-refresh`, qui lit le secret dans `gaia_config` au lieu
de l'écrire en dur. En profiter pour **faire la rotation du CRON_SECRET**, exposé le 15/09.

### Phase 6 — Le storage
**Structure FAITE le 16/09** : les **4** buckets (et non 3) sont créés sur la cible avec leur
visibilité d'origine — `models-3d`, `brand-slides`, `planner-media` en public,
`shipment-docs` en privé — et les **8 policies** de `storage.objects` sont restaurées depuis
le dump. Attention : elles ne sont PAS créées par la restauration du schéma `public`, il faut
les extraire avec `pg_restore --schema=storage`.

**FICHIERS TRANSFÉRÉS le 16/09 : 211 sur 211, zéro échec.** Volume réel **271 Mo**
(models-3d 214,6 Mo / brand-slides 15,7 Mo / planner-media 40,9 Mo) — et non ~1 Go comme
l'estimation par échantillon le laissait croire, un fichier de 34 Mo l'ayant biaisée.

Méthode : les buckets non vides étant tous publics, les fichiers se téléchargent sans
authentification depuis `.../storage/v1/object/public/<bucket>/<chemin>`, puis se
re-téléversent en `POST .../storage/v1/object/<bucket>/<chemin>` avec la clé `service_role`
du nouveau projet, en-tête `x-upsert: true` et le `content-type` d'origine (récupéré par un
`HEAD` sur la source — sans lui, Supabase range tout en `application/octet-stream` et les
images ne s'affichent plus).

Vérifié sur la cible : 211 objets, répartition identique à la production, et un fichier
servi publiquement répond HTTP 200.

**À refaire le jour J** pour les fichiers ajoutés entre-temps (`x-upsert: true` rend
l'opération rejouable sans risque). `shipment-docs` est vide.

### Phase 7 — Le front — **DÉPLOYÉ le 16/09 sur `arcade-os.pages.dev`**

**Hébergeur : Cloudflare Pages, pas Vercel.** Le plan gratuit de Vercel interdit l'usage
commercial : il aurait fallu le plan Pro à 20 $/mois/utilisateur. Cloudflare Pages est
gratuit sans cette restriction, et le compte existait déjà (Worker `dossiers`).

Configuration : projet `arcade-os`, branche `main`, build `npm run build` (PAS `bun run
build` : bun n'est pas installé et Cloudflare le propose en détectant `bun.lockb`),
sortie `dist`, plus les 4 variables Vite.

Vérifié sur le site déployé : **9 références au nouveau projet, 0 à l'ancien**.

**Pièges rencontrés :**
- *« Retry deployment » rejoue le commit précédent*, il ne récupère pas les nouveaux. Après
  un correctif, il faut **Create deployment**, pas *Retry*.
- Les paramètres de build saisis à la création peuvent ne pas être enregistrés : vérifier
  dans le log l'absence de `No build command specified. Skipping build step.`
- **Cloudflare Pages refuse tout fichier de plus de 25 Mio.** `public/models/` en contenait
  trois (Monster_Kart 82,7 / dinostorm 35,9 / bowlingchamp 25,2). Deux étaient DÉJÀ dans le
  bucket `models-3d` en double ; le troisième y a été téléversé, et les 8 références de
  `src/lib/shopifyApi.ts` pointent désormais vers le bucket. `public/` : 178 Mo → 34 Mo.
  ⚠️ Ces URL sont en dur sur le nouveau projet : la production Lovable charge donc ces trois
  modèles depuis le nouveau bucket jusqu'à la bascule.

Reste à faire : le domaine `arcade-os.avranchesautomatic.com` (CNAME à créer chez **OVH**,
qui gère le DNS — le domaine principal pointe vers Shopify, ne pas y toucher). **Valeurs exactes à renseigner** (la clé publishable est
publique par nature — elle est déjà embarquée dans le bundle servi au navigateur) :

```
VITE_SUPABASE_PROJECT_ID=dkoroqqvfyjmkaoidwzq
VITE_SUPABASE_URL=https://dkoroqqvfyjmkaoidwzq.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRrb3JvcXF2ZnlqbWthb2lkd3pxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk2MjkyODMsImV4cCI6MjEwNTIwNTI4M30.oCep9jPCYWddBD98nYGUEtUcI8wkmNETP06Q-IHkFj0
VITE_DOSSIER_SHARE_ORIGIN=https://dossiers.avranchesautomatic.workers.dev
```

⚠️ Le fichier `.env` est **commité dans le dépôt** et poussé sur GitHub. Sans danger pour
ces trois variables, mais à corriger : ajouter `.env` au `.gitignore` et passer par les
variables d'environnement de Vercel, sinon la première variable sensible ajoutée par
mégarde partira en public.

`VITE_DOSSIER_SHARE_ORIGIN` n'est pas dans le `.env` actuel : le code retombe sur une
valeur par défaut (cf. `src/components/dossier/DossierPreview.tsx:84`). À expliciter au
moment du déploiement.

### Phase 8 — La bascule — PROCÉDURE DÉTAILLÉE

À faire sur une fenêtre calme (samedi matin idéalement), jamais un jour de forte activité
commerciale. Compter 2 à 3 heures. Chaque étape est vérifiable ; ne pas enchaîner sans
avoir vu le résultat attendu.

**Avant (la veille)**
1. Prévenir les 7 utilisateurs : nouvelle adresse, et surtout **changer leur marque-page**.
   Leurs identifiants ne changent pas (comptes et mots de passe migrés).
2. Vérifier que les 26 secrets sont posés :
   `npx supabase@latest secrets list --project-ref dkoroqqvfyjmkaoidwzq`
3. Auth → URL Configuration : Site URL et Redirect URLs sur le domaine définitif.

**Le jour J**
4. **Export frais depuis Lovable** (les données bougent chaque nuit). Celui du 16/09 ne sert
   que de référence de structure.
5. Recharger **les données seules** (le schéma est déjà en place) :
   `pg_restore --data-only --schema=public --no-owner` — et `auth.users` AVANT `public`.
   Puis `refresh materialized view` sur les deux vues `mv_gaia_*`, puis `analyze`.
6. Re-transférer les fichiers storage ajoutés depuis (script avec `x-upsert: true`,
   rejouable sans risque).
7. **Activer les 14 crons** (ils sont créés mais désactivés) :
   `update cron.job set active = true where jobname <> 'cegid-keepalive-hebdo';`
   puis **supprimer** `cegid-keepalive-hebdo`, devenu inutile.
8. Repointer les intégrations externes vers les nouvelles URL de fonctions :
   - le **Worker Cloudflare** `dossiers.avranchesautomatic.workers.dev` (appelle `dossier-og`)
   - le **webhook LGM**
   - les **URL de redirection OAuth Google**

**Vérifier avant de déclarer la bascule faite**
9. Connexion d'un utilisateur réel, dashboards chiffrés, copilote qui répond.
10. Le lendemain matin : briefing reçu par e-mail, `copilot_briefings` du jour avec
    `detecteurs_en_echec` vide, et `gaia_sync_log` montrant les 7 flux Cegid en succès.

**Après**
11. **Ne rien supprimer chez Lovable avant deux semaines** de fonctionnement nominal.
12. Puis : fermer l'instance Lovable (sinon deux versions coexistent sur deux bases —
    l'application est une PWA, les anciens marque-pages continueraient de fonctionner sans
    que personne s'en aperçoive), révoquer l'ancienne clé Anthropic, demander à Romain de
    régénérer le secret Cegid et de supprimer l'application `dashboardleo`.
13. Supprimer le projet Cloudflare Pages `embrace-echoes-lab` (essai raté) et le projet
    Supabase de test `jlsecjnozhaloxgbckhj`, ainsi que son organisation `arcade-os-test`.
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
