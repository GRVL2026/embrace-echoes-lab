---
name: prospection
description: Cockpit de prospection, Gazette, distribution des leads, intégration Pipedrive, carte des prospects. À charger pour toute question sur la prospection commerciale d'Arcade OS.
---

# Prospection & Cockpit

## Le principe

Une page unique — le **cockpit** (`/prospection/cockpit`) — remplace les 8 onglets d'avant.
Maquette validée le 11/09/2026.

**Par rôle :**
- **direction** : tout, plus les informations de Tristan ;
- **Tristan** (directeur commercial) : tout — pipe, carte, distribution, progression, charge ;
- **Romain / Valérie** : leurs deals, leur carte, et les news qui leur ont été distribuées.
  Pas de distribution, pas de progression, pas de charge.

## Règles produit

- **Vocabulaire du pipe JEUX de Pipedrive**, réutilisé tel quel : Demande site internet → Contact
  effectué → En discussion → Proposition effectuée → Proforma envoyée → Bon pour accord → Stand by.
- Les pipes **JEUX et Flippers sont fusionnés**, avec un tag `Jeux` ou `Flipper`. Autre pipe = pas
  de tag.
- **Tout est cliquable** : chaque carte, chaque ligne, chaque bout d'information mène à plus de
  détail — popup ou redirection. C'est une règle générale de l'outil.
- Chaque section est **repliable**.
- La progression s'exprime en **« X % distribué »** avec le total à côté.
- Les clients se segmentent par **statut** (actifs / dormants / inactifs), pas par typologie.
- **Distribuer** une news ou un lead crée le deal dans **Pipedrive ET Arcade OS**, avec le brief
  dans les notes du deal.

## Technique

- `supabase/functions/pipedrive-deals` — lit les deals ouverts, fusionne les étapes par nom,
  force le propriétaire pour le rôle `commercial`. Mapping par **email** (profiles ⇄ Pipedrive).
- `get_map_points` — RPC de la carte, renvoie aussi `proprietaire` et `proprietaire_nom`.
- `gazette_signaux` — `assigne_a` / `assigne_le` / `assigne_par`, RPC `assigner_signal` réservée
  au management.

## Accès aux données

Voir la skill `acces-roles`. En résumé : `is_management()` couvre admin, direction et
**chef_ventes** ; `can_access_prospection()` ne couvre que admin, direction et **prospection** —
donc la carte reste fermée aux chefs des ventes tant que la fonction n'est pas élargie.

## Reste à faire

Le « marché » — Tristan sélectionne les leads un par un dans la base segmentée, chacun avec son
mini-brief, puis distribue à Romain ou Valérie. L'edge `pipedrive-create-deal` **écrit de vrais
deals** : la tester, ne jamais la lancer à l'aveugle.
