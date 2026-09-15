---
name: donnees-copilote
description: Dashboards, RPC gaia, copilotes IA, synchronisation ERP Cegid et statistiques e-commerce d'Arcade OS. À charger pour toute question de données, de chiffres ou de copilote.
---

# Données & copilotes

## Sources

- **Cegid / GAIA** : `gaia_achats`, `gaia_ventes`, `catalogue_erp`, `gaia_sync_log`
  (le log s'appelle bien `gaia_sync_log`, pas `sync_log` ; fraîcheur via `started_at`).
- **Salle** : `salle_journees` (KPI quotidiens saisis), `salle_objectifs`.
- **E-commerce** : `shopify_stats_cache`.
- **Prospection** : `prospects`, `prospect_events` (colonnes `type`, `nouveau_statut`),
  `arcade_salles`, `gazette_signaux`, `copilot_briefings` (contenu dans `contenu`).

## Pièges de données connus

- **`gaia_achats`** : le nom du produit est dans `description`, pas `libelle_cde`.
  `reste_a_facturer` doit être filtré par statut. Les arrivages se groupent par `num_dossier`.
- **`gaia_ventes`** : la famille JEUX se détaille par type via `catalogue_erp.famille`.
- **Import KPI salle** : structure Excel par blocs de semaine, mapping par en-tête de colonne.
  Attention à l'inversion merch ⇄ cartes.
- **`shopify_stats_cache`** : jamais rafraîchi faute de cron, montants TTC et non HT, faux zéros.
  Le prompt du copilote référence un schéma fictif. À corriger avant de s'y fier.

## Copilotes

Le moteur SQL passe par `gaia_query` avec `SET LOCAL ROLE copilot_readonly` — voir la skill
`acces-roles` pour les conséquences de sécurité. Les vues `v_gaia_*` doivent être explicitement
accordées à ce rôle.

## Accueil

La carte permanente « Activité commerciale » (CA + devis/commandes de la semaine) a remplacé les
ACTIONS RAPIDES.
