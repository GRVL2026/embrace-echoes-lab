---
name: acces-roles
description: Rôles, permissions de menu et policies RLS d'Arcade OS — qui voit quoi, et pourquoi une entrée ouverte peut donner une page vide. À charger pour toute question d'accès, de droits ou de sécurité des données.
---

# Accès, rôles et sécurité

## Deux couches indépendantes

**Le menu** ne gouverne que l'affichage. **Les données** sont protégées séparément par les
policies RLS. Ouvrir une entrée de menu sans vérifier la policy donne une **page vide**.
Toujours vérifier les deux.

## Les rôles

`admin`, `direction`, `chef_ventes`, `commercial`, `prospection`. Calculés dans
`src/contexts/AuthContext.tsx` à partir de `user_roles`.

## Permissions de menu (`user_menu_access`)

Corrigé le 15/09/2026 (`1f3ed86`). Trois états, l'override **décide dans les deux sens** :

- aucun enregistrement → le **rôle** décide (`show()`), badge « hérité du rôle » dans l'admin ;
- enregistré `true` → **accordé**, même si le rôle ne le prévoit pas ;
- enregistré `false` → **refusé**, même si le rôle le prévoit.

Avant ce correctif, `isMenuKeyAllowed` faisait `override && fallback` : une case cochée ne pouvait
que **retirer** un accès, jamais en donner — et le commentaire de la fonction annonçait l'inverse.
L'écran d'administration affichait en plus tout comme « allumé » tant que rien n'était enregistré,
si bien que cliquer enregistrait un **refus**.

`resolveActive` applique la même règle, sinon une entrée accordée par override n'est jamais
reconnue comme active.

## Matrice donnée / fonction de garde

| donnée | garde | couvre `chef_ventes` ? |
|---|---|---|
| `gazette_signaux` (tout) | `is_management()` | **oui** |
| `gazette_signaux` (assignés) | `assigne_a = auth.uid()` | — |
| `arcade_salles` (Carte, Parc) | `can_access_prospection()` | **non** |
| `prospects` | `is_management()` ou `proprietaire = auth.uid()` | **oui** |

## Points de vigilance

- Les **RPC créées par Lovable naissent avec `EXECUTE` à `PUBLIC`** et contournent la RLS
  (`SECURITY DEFINER`). Relancer l'audit des fonctions definer après chaque migration.
- Le **moteur SQL des copilotes** (`gaia_query`) passe par `SET LOCAL ROLE copilot_readonly` :
  perte d'identité, un GRANT ne suffit pas sans policy.
- Mon accès SQL est en **lecture seule** : tout DDL/DML se donne prêt à coller.
