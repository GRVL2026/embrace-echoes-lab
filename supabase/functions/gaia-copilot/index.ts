import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { anthropicJson, isAnthropicOverload } from '../_shared/anthropic-fetch.ts';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const CHAT_MODEL = 'claude-sonnet-5';
const REVUE_MODEL = 'claude-opus-4-8';
const ANTHROPIC_VERSION = '2023-06-01';
const MAX_TOOL_ROUNDS = 6;
const MAX_TOKENS_PER_TURN = 8000;

/**
 * Convert the system prompt to Anthropic content blocks.
 * `system` is the STABLE prefix (schema + charte) that stays cached across turns.
 * `dynamicSuffix`, when provided, is appended as an UNCACHED block AFTER the cache
 * breakpoint — this is where volatile content like the persistent memory lives,
 * so the cached prefix stays byte-identical across calls.
 */
function systemBlocks(system: string, dynamicSuffix?: string) {
  const blocks: any[] = [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }];
  if (dynamicSuffix && dynamicSuffix.trim()) {
    blocks.push({ type: 'text', text: dynamicSuffix });
  }
  return blocks;
}

/**
 * Return a new messages array where cache_control markers are stripped from all blocks,
 * then set on the last block of the last message. This keeps the cached prefix stable
 * while marking the new tail on each turn (Anthropic supports up to 4 breakpoints).
 */
function withCacheOnLastMessage(
  messages: Array<{ role: 'user' | 'assistant'; content: any }>,
): Array<{ role: 'user' | 'assistant'; content: any }> {
  if (!messages.length) return messages;
  const stripBlock = (b: any) => {
    if (b && typeof b === 'object' && 'cache_control' in b) {
      const { cache_control: _drop, ...rest } = b;
      return rest;
    }
    return b;
  };
  const stripped = messages.map((m) => {
    if (typeof m.content === 'string') return { ...m };
    if (Array.isArray(m.content)) return { ...m, content: m.content.map(stripBlock) };
    return { ...m };
  });
  const lastIdx = stripped.length - 1;
  const last = stripped[lastIdx];
  if (typeof last.content === 'string') {
    stripped[lastIdx] = {
      ...last,
      content: [{ type: 'text', text: last.content, cache_control: { type: 'ephemeral' } }],
    };
  } else if (Array.isArray(last.content) && last.content.length) {
    const blocks = last.content.slice();
    const idx = blocks.length - 1;
    blocks[idx] = { ...blocks[idx], cache_control: { type: 'ephemeral' } };
    stripped[lastIdx] = { ...last, content: blocks };
  }
  return stripped;
}

function logUsage(tag: string, usage: any) {
  if (!usage) return;
  console.log(
    `[gaia-copilot] ${tag} usage input=${usage.input_tokens ?? '?'} output=${usage.output_tokens ?? '?'} cache_read=${usage.cache_read_input_tokens ?? 0} cache_creation=${usage.cache_creation_input_tokens ?? 0}`,
  );
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const SCHEMA_DOC = `

OUTIL executer_sql — accès direct à la base commerciale
Tu disposes de l'outil executer_sql(sql_query) qui exécute une requête SQL SELECT en lecture seule (max 200 lignes, timeout 8 s) sur la base commerciale et renvoie les lignes au format JSON. Utilise-le CHAQUE FOIS qu'une question demande un détail absent des données agrégées fournies. Vérifie systématiquement tes résultats en croisant plusieurs requêtes si nécessaire, cite les chiffres exacts, et mentionne en une seule ligne la requête utilisée (ex : "Source : SELECT ... FROM v_gaia_ca_client WHERE annee=2026 …").

Schéma disponible (Postgres, schema public) :

- v_gaia_lignes(invoice_date, code_client, code_article, inventory_id, classe_article, montant_ht, source, qty)
  TOUTES les lignes de vente. La rétrocession SFA (code_client = '9SFA00000') est DÉJÀ EXCLUE.
  Exercice fiscal (sept→août) : extract(year from invoice_date + interval '4 months')::int
  Ex. exercice 2026 = 1er sept. 2025 → 31 août 2026.

- gaia_stock(inventory_id, description, famille2, prix_vente, dernier_cout, qty_available, item_status, …)
  ⚠️ CONTIENT PLUSIEURS LIGNES PAR ARTICLE (une par dépôt). NE JAMAIS joindre gaia_stock directement à des lignes de ventes (v_gaia_lignes, gaia_commandes, etc.) — cela MULTIPLIE les quantités et les montants et produit des chiffres FAUX.
  Pour toute info article (description, famille, prix, stock), joindre à la place la vue v_gaia_articles(code, description, famille, prix_ht, stock) : UNE seule ligne par article, jointure : trim(l.code_article) = v_gaia_articles.code.
  N'utilise gaia_stock directement QUE pour analyser le stock par dépôt.

- v_gaia_articles(code, description, famille, prix_ht, stock) — référentiel article dédupliqué (une ligne par article). À utiliser pour toute jointure article ↔ ventes.

- gaia_clients(customer_id, name, …) — référentiel clients (jointure : trim(l.code_client) = trim(c.customer_id)).
- gaia_client_groupes(code_client, groupe) — regroupement de comptes clients par entité économique.

- gaia_commandes(...)
  Statuts :
    • 'Brouillon' = devis
    • 'Ouvert', 'Expédition en cours', 'Reliquat' = commandes signées en cours
    • 'Historique', 'Annulé' = À EXCLURE des analyses opérationnelles.

OUTIL DOSSIERS COMMERCIAUX (activité de l'équipe) :
- projects(id, client_name, status, owner_id, brand_id, offer, brief, selected_products, created_at, updated_at)
  Dossiers commerciaux créés par les commerciaux. status ∈ ('draft','sent','won','lost').
  owner_id = uuid du commercial (jointure profiles.id = projects.owner_id pour obtenir le nom).
- profiles(id, email, full_name) — annuaire interne. Utilise full_name pour nommer un commercial dans tes réponses (jamais l'uuid).
- dossier_vues(id, project_id, viewed_at) — journal des consultations d'un dossier par le client destinataire. Un dossier envoyé sans aucune vue = jamais consulté.
- dossier_learning(project_id, owner_id, brand_id, offer, status, brief, products, updated_at) — snapshot des assortiments de dossiers envoyés/gagnés (pour analyser ce qui se vend).

Consigne : tu peux analyser l'activité commerciale de l'équipe — dossiers créés/envoyés/gagnés par commercial, dossiers envoyés jamais consultés (LEFT JOIN dossier_vues), délais de conversion sent→won (updated_at - created_at), assortiments récurrents dans dossier_learning.


Vues d'analyse déjà disponibles :
  v_gaia_ca_mensuel, v_gaia_ca_client, v_gaia_ca_famille, v_gaia_ca_periode_egale,
  v_gaia_devis_a_relancer, v_gaia_clients_dormants, v_gaia_stock_dormant,
  v_gaia_marge_famille, v_gaia_marge_client (marge = taux de marque : (ca - cout) / ca).

Règles :
  • Uniquement des SELECT (WITH autorisé). Interdits : INSERT/UPDATE/DELETE/DROP/ALTER/CREATE/GRANT/TRUNCATE.
  • Limite tes requêtes (LIMIT 50 par défaut, LIMIT 200 maximum).
  • Ne fais JAMAIS apparaître SFA (code_client = '9SFA00000') dans les palmarès/dormants/actions.
  • Raisonne toujours en exercice fiscal, jamais en année civile.
  • AUTO-CONTRÔLE OBLIGATOIRE : avant d'affirmer un chiffre, vérifie sa vraisemblance (ordre de grandeur vs le CA total connu). En cas de doute sur une jointure (surtout avec gaia_stock ou toute table potentiellement non-unique), re-vérifie avec une requête de contrôle sans jointure (ex : SUM(montant_ht) directement sur v_gaia_lignes) et compare. Si les deux chiffres divergent, la jointure est fautive : corrige-la (utilise v_gaia_articles) avant de répondre.
  • Mentionne toujours en une ligne la requête SQL utilisée pour chaque chiffre clé.

CHARTE DE L'ANALYSTE — règles SQL OBLIGATOIRES (aucune exception sans justification explicite) :

1. SOURCE DE VÉRITÉ CA : le CA se calcule TOUJOURS depuis v_gaia_lignes (SFA déjà exclue, avoirs en montants signés, historique inclus). Ne calcule JAMAIS un CA directement depuis gaia_ventes ou gaia_historique — ces tables sont des sources brutes, pas la vérité comptable.

2. EXERCICES FISCAUX : toute notion d'"année" = exercice fiscal, calculé par extract(year from invoice_date + interval '4 months')::int. Les années civiles sont INTERDITES sauf demande explicite de l'utilisateur — dans ce cas, précise-le clairement dans la réponse ("année civile 2025, non exercice fiscal").

3. COMMANDES (gaia_commandes) : à filtrer TOUJOURS par statut.
   • Devis = statut = 'Brouillon'.
   • Commandes signées en cours = statut IN ('Ouvert', 'Expédition en cours', 'Reliquat') ET completed = false.
   • EXCLURE systématiquement 'Historique', 'Annulé' ET 'Traité' des analyses opérationnelles : le statut 'Traité' correspond à des commandes déjà facturées (donc déjà comptées dans le CA via v_gaia_lignes) — la vue v_gaia_commandes_etat les exclut à juste titre du portefeuille de commandes signées en cours.
   • Pour compter des commandes : COUNT(DISTINCT n_cde) (une commande = plusieurs lignes).
   • CARNET vs CA — pas de chevauchement : gaia_commandes ne contient QUE les lignes restant à livrer. Dès qu'une ligne est expédiée/facturée, elle sort du carnet (même pour une commande en 'Reliquat' : la part déjà livrée est retirée, seul le reste-à-livrer subsiste). Donc SUM(montant_ht) sur une commande en cours = reste à livrer et à facturer exact, sans double-comptage avec le CA. gaia_ventes = uniquement du livré/facturé.
   • DICTIONNAIRE OFFICIEL order_type (source ERP Romain, 17/07/2026) :
     - QT = Devis (non signé)
     - SO = Commande client ferme
     - LO = Location
     - PT = Prêt facturé
     - RP = Réparation (prestation atelier facturée — utile pour des stats SAV par client : un client qui ne commande plus de jeux mais envoie des réparations est un signal commercial)
     - RT = Rétrocession vers SFA sans marge (À EXCLURE des analyses, comme tout ce qui touche SFA)
     - GT = Garantie (gratuit, montants nuls)
     - ZP = Préparation interne
     - R2 = Retour sans avoir
     - RC = Retour avec avoir
     - FH = Historique de factures (archives)
     - TR = Transfert de stock (inactif)
   • CARNET OFFICIEL : v_gaia_commandes_etat et v_gaia_pipeline ne comptent QUE QT/SO/LO/PT (+ catégorie 'reparation' = RP dans v_gaia_pipeline). GT, ZP, RT, retours (R2/RC), FH et TR en sont exclus.


4. AGRÉGER DANS LE SQL : gaia_query renvoie 200 lignes MAX. Ne calcule JAMAIS un total en récupérant des lignes brutes puis en sommant côté modèle. Utilise SUM/COUNT/AVG/GROUP BY dans la requête, et ORDER BY + LIMIT pour tout classement (Top N).

5. RECHERCHES TEXTE : les libellés Cegid sont en MAJUSCULES SANS ACCENTS. Utilise ILIKE avec des fragments sans accent (ex. description ILIKE '%METALLICA%'). Si zéro résultat, essaie d'autres variantes (synonymes, orthographes, mots partiels) AVANT de conclure "introuvable".

6. CLIENTS : cherche dans gaia_clients par ILIKE partiel sur le nom (jamais par égalité stricte). Puis vérifie TOUJOURS gaia_client_groupes : les enseignes multi-établissements ont plusieurs code_client pour la même entité économique — dans ce cas, raisonne par groupe (agréger sur tous les codes du groupe).

7. ROBUSTESSE SQL : NULLIF(denominateur, 0) pour toute division (taux, ratios) ; COALESCE(SUM(...), 0) pour les sommes. La marge n'est estimée que sur la part du CA dont le coût est connu — mentionne-le explicitement quand tu donnes un taux de marge ("marge estimée sur X % du CA au coût connu").

8. EXERCICE EN COURS : toute comparaison entre un exercice plein (clos) et l'exercice en cours doit être faite "à période égale" (utiliser v_gaia_ca_periode_egale), ou explicitement signalée comme partielle ("exercice 2026 en cours, arrêté au JJ/MM").

9. RAPPELS (déjà en place) : v_gaia_articles pour toute info article (JAMAIS gaia_stock en jointure ventes) ; auto-contrôle de vraisemblance avant d'affirmer ; citation en une ligne de la requête utilisée.

10. GRAPHIQUES : pour toute évolution temporelle (CA mois par mois, tendance annuelle…) OU toute comparaison de plus de 4 valeurs (top clients, familles, articles…), appelle l'outil "afficher_graphique" plutôt que de dresser un long tableau Markdown. Choisis 'ligne' pour une évolution dans le temps, 'barres' pour une comparaison, 'donut' pour une répartition. Continue à commenter le graphique en texte juste après (1-2 phrases).

11. ÉCO-TAXE (DEEE) : l'éco-participation apparaît dans les lignes de vente sous le code article ECOTAXE (présent uniquement dans gaia_ventes, jamais dans gaia_historique). Le CA officiel est TOUJOURS hors éco-taxe : les vues v_gaia_ca_mensuel, v_gaia_ca_client et v_gaia_ca_famille l'excluent déjà automatiquement via v_gaia_ecotax_codes. Si tu calcules un CA directement sur v_gaia_lignes, exclus les codes de v_gaia_ecotax_codes (WHERE code_article NOT IN (SELECT code FROM v_gaia_ecotax_codes)) pour rester cohérent avec le dashboard. Pour analyser l'éco-taxe elle-même, utilise v_gaia_ecotaxe_mensuel (colonnes mois, ecotaxe_ht).

12. MODÈLE ERP OFFICIEL (source Romain, 17/07/2026) :

    • ENTREPÔTS (gaia_stock.warehouse) — séparation physique du stock :
      - PIECES = pièces détachées
      - JEUX = machines / jeux d'arcade
      - SAV = stock dédié aux interventions garantie
      - LOCATION = parc loué
      Un même code_article peut exister dans plusieurs entrepôts : garder la règle "JAMAIS de jointure gaia_stock ↔ ventes" (passer par v_gaia_articles).

    • CLASSES D'ARTICLES (gaia_stock.item_class / v_gaia_lignes.classe_article) — sert aussi aux comptes de ventes :
      - JEUX = machines
      - MAGASIN = pièces détachées vendues depuis le magasin interne (~750-900 k€/exercice)
      - MAGASIN NS = pièces non stockées (approvisionnées à la commande)
      - MO = main d'œuvre / prestation atelier (~120 k€/an)
      - DIVERS NS = divers non stocké
      - ATELIER = fournitures atelier
      - SAV = interventions garantie
      - ARCHIVES = anciennes références

    ⚠️ classe_article contient des ESPACES DE FIN INCONSISTANTS selon la source ('MAGASIN', 'MAGASIN ', 'MAGASIN  '…). TOUJOURS comparer avec trim() et en majuscules :
      upper(trim(classe_article)) LIKE 'MAGASIN%'
      upper(trim(classe_article)) IN ('MAGASIN', 'MAGASIN NS')
    Ne jamais faire = 'MAGASIN' sans trim, tu louperais des lignes.

    • DASHBOARD MAGASIN : le pilotage du magasin de pièces s'appuie sur les vues v_gaia_magasin_mensuel (mois, annee, ca_ht, lignes, clients), v_gaia_magasin_top_clients (annee, client, code_client, ca_ht, lignes) et v_gaia_magasin_top_articles (annee, code_article, description, quantite, ca_ht). Utilise-les de préférence pour toute question sur les pièces détachées — elles appliquent déjà les bons filtres de classe et d'exercice fiscal.
`;



const SYSTEM_PROMPT = `Tu es le copilote stratégique de la direction commerciale d'Avranches Automatic (distributeur français de flippers — revendeur officiel Stern —, jeux d'arcade, grues et distributeurs automatiques). Tu reçois les données commerciales réelles agrégées (CA, clients, devis, stock). Tu raisonnes en dirigeant commercial : factuel, chiffré, direct. Chaque constat s'appuie sur un chiffre fourni ; chaque recommandation est actionnable (qui fait quoi, sur quel client/produit, pourquoi maintenant). Tu signales les limites des données quand c'est pertinent. Tu réponds en français, en Markdown clair.

IMPORTANT — EXERCICE FISCAL : L'exercice fiscal d'Avranches Automatic va du 1er septembre au 31 août (clôture 31/08). Les données "annee" fournies sont des exercices fiscaux (ex. 2026 = 1er sept. 2025 → 31 août 2026), pas des années civiles. Raisonne toujours en exercices, jamais en années civiles. Quand tu nommes une année, écris "exercice 2026" (ou "Ex. 2026 (sept. 2025 → août 2026)"). Compare toujours à période égale (v_gaia_ca_periode_egale), jamais exercice plein vs exercice en cours. Les mois du calendrier fiscal vont de septembre (mois_fiscal=1) à août (mois_fiscal=12).

IMPORTANT — SFA : SFA (Société Française Automatique, code client 9SFA00000) est une société sœur du groupe Gaia : les ventes à SFA sont des rétrocessions intra-groupe sans marge, déjà exclues des données de CA que tu reçois. Ne traite JAMAIS SFA comme un client à développer ou à relancer, et ne la fais jamais apparaître dans les palmarès, dormants ou actions. Le CA analysé est le "vrai CA" d'Avranches Automatic. Le total annuel de rétrocession SFA t'est fourni séparément (retrocession_sfa) uniquement pour contexte.

CONVENTIONS DE SORTIE (à respecter pour toutes les réponses) :
- Structure chaque réponse avec des titres de section \`###\` courts (ex. \`### Chiffres clés\`, \`### Analyse\`, \`### Conclusion\`).
- Présente TOUS les chiffres comparés (par client, par produit, par mois, par exercice…) dans des tableaux markdown GFM à colonnes alignées, plutôt qu'en phrases. Les colonnes numériques sont en dernier, avec unité (€, k€, %).
- Préfère listes à puces et tableaux aux longs paragraphes. Un paragraphe ne dépasse pas 3 phrases.
- Utilise des préfixes de ligne "Constat : …", "Attention : …", "Action : …" pour les points saillants (ils seront rendus en encarts colorés côté UI).
- Termine TOUJOURS par une section \`### Conclusion\` d'1 à 2 phrases synthétiques (le "so what").
- Quand tu appelles \`executer_sql\`, place les requêtes utilisées à la toute fin de la réponse dans une section \`### Sources\`, chacune dans un bloc de code \`\`\`sql … \`\`\` (elles seront repliées automatiquement dans l'UI). Ne mélange PAS le SQL au milieu de l'analyse.
- Reste digeste : vise une réponse tenant en un demi-écran une fois structurée.${SCHEMA_DOC}`;

const SQL_TOOL = {
  name: 'executer_sql',
  description: "Exécute une requête SQL SELECT en lecture seule sur la base commerciale et renvoie les lignes (max 200). Utilise cet outil chaque fois qu'une question demande un détail absent des données déjà fournies.",
  input_schema: {
    type: 'object',
    properties: {
      sql_query: { type: 'string', description: 'Requête SELECT / WITH Postgres. Aucun DML/DDL.' },
    },
    required: ['sql_query'],
  },
};

const MEMORISE_TOOL = {
  name: 'memoriser',
  description: "Enregistre une note durable dans la mémoire du copilote (décisions, plans d'action, contextes, suivis). NE MÉMORISE JAMAIS de chiffres bruts (ils sont dans la base) — uniquement du contexte qualitatif qui devra être rappelé dans les prochaines conversations. Catégories usuelles : 'decision', 'plan', 'contexte', 'suivi', 'note'.",
  input_schema: {
    type: 'object',
    properties: {
      categorie: { type: 'string', description: "Catégorie courte : 'decision' | 'plan' | 'contexte' | 'suivi' | 'note'." },
      contenu: { type: 'string', description: 'Note à mémoriser, phrase complète, autonome (compréhensible sans le contexte de la conversation).' },
    },
    required: ['categorie', 'contenu'],
  },
};

const OUBLIER_TOOL = {
  name: 'oublier',
  description: "Marque une entrée de mémoire comme obsolète (actif = false) à partir de son id. Utilise-le quand une décision est réalisée, annulée ou remplacée.",
  input_schema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'UUID de l\'entrée mémoire à désactiver.' },
    },
    required: ['id'],
  },
};

const CHART_TOOL = {
  name: 'afficher_graphique',
  description: "Affiche un graphique dans la réponse du chat, à l'endroit de l'appel. À utiliser pour toute évolution temporelle ou comparaison de plus de 4 valeurs (à préférer à un long tableau). Le rendu est fait côté page — cet outil renvoie simplement 'ok'.",
  input_schema: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['ligne', 'barres', 'donut'], description: "Type de graphique : 'ligne' pour une évolution temporelle, 'barres' pour une comparaison, 'donut' pour une répartition." },
      titre: { type: 'string', description: 'Titre court affiché au-dessus du graphique.' },
      donnees: {
        type: 'array',
        description: 'Points du graphique (max 30). x = étiquette (mois, client, famille…), y = valeur numérique.',
        items: {
          type: 'object',
          properties: {
            x: { type: 'string', description: 'Étiquette du point (ex. "sept.", "Client Machin", "Flippers").' },
            y: { type: 'number', description: 'Valeur numérique associée.' },
          },
          required: ['x', 'y'],
        },
      },
      unite: { type: 'string', description: "Unité affichée (ex : '€', '€ HT', '%', 'unités'). Optionnel." },
    },
    required: ['type', 'titre', 'donnees'],
  },
};

function summarizeSql(sql: string): string {
  const s = (sql || '').replace(/\s+/g, ' ').trim();
  const tables = Array.from(s.matchAll(/\b(?:from|join)\s+([a-z_0-9.]+)/gi)).map((m) => m[1]);
  const uniq = Array.from(new Set(tables)).slice(0, 2);
  const hasAgg = /\b(sum|count|avg|group by)\b/i.test(s);
  const kind = hasAgg ? 'Agrégation' : 'Lecture';
  const target = uniq.join(' + ') || 'base';
  return `${kind} ${target}`.slice(0, 80);
}




const REVUE_TOOL = {
  name: 'build_revue',
  description: "Construit la revue commerciale du mois sous forme structurée pour un tableau de bord visuel.",
  input_schema: {
    type: 'object',
    properties: {
      sante: {
        type: 'object',
        properties: {
          commentaire: { type: 'string', description: '2 phrases max sur la santé globale.' },
          annees: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                annee: { type: 'number' },
                ca_ht: { type: 'number' },
                evolution_pct: { type: 'number', description: 'Évolution vs année précédente à période égale, en %. Peut être négatif.' },
              },
              required: ['annee', 'ca_ht'],
            },
          },
          tendance_mensuelle: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                mois: { type: 'string', description: 'Ex: "janv.", "févr."…' },
                evolution_pct: { type: 'number' },
                commentaire: { type: 'string' },
              },
              required: ['mois', 'evolution_pct'],
            },
          },
        },
        required: ['commentaire', 'annees', 'tendance_mensuelle'],
      },
      mouvements: {
        type: 'object',
        properties: {
          familles: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                nom: { type: 'string' },
                sens: { type: 'string', enum: ['hausse', 'baisse'] },
                detail: { type: 'string', description: '1 phrase max, chiffrée.' },
              },
              required: ['nom', 'sens', 'detail'],
            },
          },
          clients_hausse: {
            type: 'array',
            items: {
              type: 'object',
              properties: { client: { type: 'string' }, detail: { type: 'string' } },
              required: ['client', 'detail'],
            },
          },
          clients_baisse: {
            type: 'array',
            items: {
              type: 'object',
              properties: { client: { type: 'string' }, detail: { type: 'string' } },
              required: ['client', 'detail'],
            },
          },
        },
        required: ['familles', 'clients_hausse', 'clients_baisse'],
      },
      risques: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            titre: { type: 'string' },
            gravite: { type: 'string', enum: ['haute', 'moyenne', 'basse'] },
            detail: { type: 'string', description: '1-2 phrases max.' },
          },
          required: ['titre', 'gravite', 'detail'],
        },
      },
      actions: {
        type: 'array',
        description: 'TOP 5 actions priorisées par impact en euros (legacy — conserver pour compat).',
        items: {
          type: 'object',
          properties: {
            rang: { type: 'number' },
            titre: { type: 'string' },
            qui: { type: 'string', description: 'Qui doit agir (ex: "Commercial X", "ADV").' },
            cible: { type: 'string', description: 'Client, devis, article ou famille visé.' },
            impact_eur: { type: 'number', description: 'Impact financier estimé en euros HT.' },
            pourquoi: { type: 'string', description: '1 phrase max.' },
          },
          required: ['rang', 'titre', 'qui', 'cible', 'impact_eur', 'pourquoi'],
        },
      },
      plan_actions: {
        type: 'array',
        description: 'PLAN D\'ACTION STRATÉGIQUE : 4 à 8 actions priorisées par impact, chacune ancrée dans des données précises (numéros de devis, noms de clients, montants). JAMAIS de généralités.',
        items: {
          type: 'object',
          properties: {
            titre: { type: 'string', description: 'Action concrète et directe (ex: "Relancer devis DV-12345 CLIENT X").' },
            constat: { type: 'string', description: 'Les chiffres précis qui justifient l\'action (devis N°, client, montant, ancienneté…).' },
            impact_potentiel_eur: { type: 'number', description: 'Impact financier estimé en € HT.' },
            responsable_suggere: { type: 'string', description: 'Ex: "Valérie", "commercial X", "Tristan", "ADV".' },
            horizon: { type: 'string', enum: ['cette_semaine', 'ce_mois', 'ce_trimestre'] },
            premieres_etapes: {
              type: 'array',
              description: '2 à 3 étapes concrètes de démarrage.',
              items: { type: 'string' },
            },
          },
          required: ['titre', 'constat', 'impact_potentiel_eur', 'responsable_suggere', 'horizon', 'premieres_etapes'],
        },
      },
      signaux_vigilance: {
        type: 'array',
        description: '3 à 5 points de risque chiffrés à surveiller (dépendance client, marge, cash, calendrier, parc vieillissant, clients en déclin…).',
        items: {
          type: 'object',
          properties: {
            titre: { type: 'string' },
            detail: { type: 'string', description: '1 phrase chiffrée.' },
          },
          required: ['titre', 'detail'],
        },
      },
    },
    required: ['sante', 'mouvements', 'risques', 'plan_actions'],
  },
};

async function loadData(admin: any) {
  const currentYear = new Date().getFullYear();
  const prevYear = currentYear - 1;

  const [
    caMensuel,
    caPeriodeEgale,
    caFamille,
    caClientCurrent,
    caClientPrev,
    commandesEtat,
    stockValeur,
    devisRelance,
    clientsDormants,
    stockDormant,
    retroSfa,
  ] = await Promise.all([
    admin.from('v_gaia_ca_mensuel').select('*'),
    admin.from('v_gaia_ca_periode_egale').select('*'),
    admin.from('v_gaia_ca_famille').select('*'),
    admin.from('v_gaia_ca_client').select('*').eq('annee', currentYear).order('ca_ht', { ascending: false }).limit(15),
    admin.from('v_gaia_ca_client').select('*').eq('annee', prevYear).order('ca_ht', { ascending: false }).limit(15),
    admin.from('v_gaia_commandes_etat').select('*'),
    admin.from('v_gaia_stock_valeur').select('*'),
    admin.from('v_gaia_devis_a_relancer').select('*').order('montant_ht', { ascending: false }).limit(20),
    admin.from('v_gaia_clients_dormants').select('*').order('ca_n1', { ascending: false }).limit(20),
    admin.from('v_gaia_stock_dormant').select('*').order('valeur_achat', { ascending: false }).limit(20),
    admin.from('v_gaia_retrocession_sfa').select('*'),
  ]);

  const retroByYear = new Map<number, number>();
  for (const r of (retroSfa.data ?? []) as any[]) {
    const y = Number(r.annee);
    retroByYear.set(y, (retroByYear.get(y) ?? 0) + Number(r.montant_ht || 0));
  }
  const retrocession_sfa = Array.from(retroByYear.entries())
    .map(([annee, montant_ht]) => ({ annee, montant_ht }))
    .sort((a, b) => b.annee - a.annee);

  return {
    annee_courante: currentYear,
    annee_precedente: prevYear,
    ca_mensuel: caMensuel.data ?? [],
    ca_periode_egale: caPeriodeEgale.data ?? [],
    ca_famille: caFamille.data ?? [],
    top15_clients_annee_courante: caClientCurrent.data ?? [],
    top15_clients_annee_precedente: caClientPrev.data ?? [],
    commandes_etat: commandesEtat.data ?? [],
    stock_valeur: stockValeur.data ?? [],
    top20_devis_a_relancer: devisRelance.data ?? [],
    top20_clients_dormants: clientsDormants.data ?? [],
    top20_stock_dormant: stockDormant.data ?? [],
    retrocession_sfa,
  };
}

async function runGaiaQuery(admin: any, sql: string): Promise<unknown> {
  try {
    const { data, error } = await admin.rpc('gaia_query', { sql_query: sql });
    if (error) return { error: error.message };
    return data;
  } catch (e: any) {
    return { error: e?.message ?? String(e) };
  }
}

/** Charge les entrées actives de mémoire persistante (les plus récentes d'abord). */
async function loadMemories(admin: any): Promise<Array<{ id: string; categorie: string; contenu: string; auteur: string | null; created_at: string }>> {
  try {
    const { data, error } = await admin
      .from('copilote_memoire')
      .select('id, categorie, contenu, auteur, created_at')
      .eq('actif', true)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) {
      console.log(`[gaia-copilot] loadMemories error: ${error.message}`);
      return [];
    }
    return (data as any[]) ?? [];
  } catch (e: any) {
    console.log(`[gaia-copilot] loadMemories fatal: ${e?.message ?? e}`);
    return [];
  }
}

/** Formate les mémoires pour injection dans le prompt système (bloc dynamique, non caché). */
function formatMemories(memos: Array<{ id: string; categorie: string; contenu: string; created_at: string }>): string {
  if (!memos.length) {
    return `MÉMOIRE DU COPILOTE\n(vide) — utilise l'outil "memoriser" dès qu'une décision, un plan d'action ou un contexte durable est évoqué.`;
  }
  const byCat = new Map<string, string[]>();
  for (const m of memos) {
    const cat = (m.categorie || 'note').toLowerCase();
    if (!byCat.has(cat)) byCat.set(cat, []);
    const dt = new Date(m.created_at).toLocaleDateString('fr-FR');
    byCat.get(cat)!.push(`  • [${m.id}] (${dt}) ${m.contenu}`);
  }
  const sections = Array.from(byCat.entries())
    .map(([cat, lines]) => `▸ ${cat.toUpperCase()}\n${lines.join('\n')}`)
    .join('\n');
  return `MÉMOIRE DU COPILOTE (entrées actives, à prendre en compte dans chaque réponse — outils : "memoriser" pour ajouter, "oublier" pour désactiver via id)\n${sections}`;
}

async function memoriser(admin: any, categorie: string, contenu: string): Promise<unknown> {
  try {
    const cat = (categorie || 'note').toString().trim().slice(0, 40) || 'note';
    const txt = (contenu || '').toString().trim().slice(0, 2000);
    if (!txt) return { error: 'contenu vide' };
    const { data, error } = await admin
      .from('copilote_memoire')
      .insert({ categorie: cat, contenu: txt, auteur: 'copilote', actif: true })
      .select('id, categorie, contenu, created_at')
      .single();
    if (error) return { error: error.message };
    return { ok: true, memoire: data };
  } catch (e: any) {
    return { error: e?.message ?? String(e) };
  }
}

async function oublier(admin: any, id: string): Promise<unknown> {
  try {
    const cleanId = (id || '').toString().trim();
    if (!cleanId) return { error: 'id manquant' };
    const { error } = await admin
      .from('copilote_memoire')
      .update({ actif: false })
      .eq('id', cleanId);
    if (error) return { error: error.message };
    return { ok: true, id: cleanId };
  } catch (e: any) {
    return { error: e?.message ?? String(e) };
  }
}


async function anthropicCall(payload: Record<string, unknown>) {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY manquant');
  return await anthropicJson(apiKey, payload, {
    url: ANTHROPIC_URL,
    extraHeaders: { 'anthropic-version': ANTHROPIC_VERSION },
  });
}

type TurnLog = {
  round: number;
  stop_reason: string | null;
  block_types: string[];
  sql_queries: string[];
  memory_writes: string[];
  memory_forgets: string[];
};

function extractText(content: any[]): string {
  if (!Array.isArray(content)) return '';
  return content
    .filter((p: any) => p?.type === 'text' && typeof p.text === 'string')
    .map((p: any) => p.text)
    .join('\n\n')
    .trim();
}

/**
 * Nettoie l'historique avant envoi API : supprime les blocs text vides,
 * qui font échouer l'API avec "text content blocks must be non-empty".
 */
function sanitizeMessagesForApi(
  messages: Array<{ role: 'user' | 'assistant'; content: any }>,
): Array<{ role: 'user' | 'assistant'; content: any }> {
  return messages
    .map((m) => {
      if (typeof m.content === 'string') {
        return m.content.trim().length === 0 ? null : m;
      }
      if (!Array.isArray(m.content)) return m;
      const cleaned = m.content.filter((b: any) => {
        if (!b || typeof b !== 'object') return false;
        if (b.type === 'text') return typeof b.text === 'string' && b.text.trim().length > 0;
        if (b.type === 'thinking') return typeof b.thinking === 'string' && b.thinking.length > 0;
        return true;
      });
      if (cleaned.length === 0) return null;
      return { ...m, content: cleaned };
    })
    .filter((m): m is { role: 'user' | 'assistant'; content: any } => m !== null);
}

/**
 * Boucle agentique : dispatche les tool_use (executer_sql, memoriser, oublier, …)
 * jusqu'à MAX_TOOL_ROUNDS. Retourne l'historique complet (assistant renvoyé TEL QUEL,
 * thinking inclus), la dernière réponse, le nombre de tours et le journal détaillé.
 */
async function toolLoop(params: {
  admin: any;
  model: string;
  system: string;
  dynamicSuffix?: string;
  initialMessages: Array<{ role: 'user' | 'assistant'; content: any }>;
  extraTools?: any[];
  toolChoice?: any;
  extraPayload?: Record<string, unknown>;
  onEvent?: (event: string, data: unknown) => void;

}): Promise<{
  messages: Array<{ role: 'user' | 'assistant'; content: any }>;
  last: any;
  rounds: number;
  journal: TurnLog[];
}> {
  const { admin, model, system, dynamicSuffix, initialMessages, extraTools = [], toolChoice, extraPayload, onEvent } = params;
  const tools = [SQL_TOOL, MEMORISE_TOOL, OUBLIER_TOOL, CHART_TOOL, ...extraTools];
  const messages = [...initialMessages];
  const journal: TurnLog[] = [];

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const isLastRound = round === MAX_TOOL_ROUNDS;
    const sys = isLastRound
      ? `${system}\n\nTu as atteint la limite de ${MAX_TOOL_ROUNDS} appels d'outils. Réponds maintenant avec les informations dont tu disposes.`
      : system;
    const extraOutputConfig = (extraPayload as any)?.output_config;
    const payload: Record<string, unknown> = {
      model,
      max_tokens: isLastRound ? 16000 : MAX_TOKENS_PER_TURN,
      system: systemBlocks(sys, dynamicSuffix),
      messages: withCacheOnLastMessage(sanitizeMessagesForApi(messages)),
      tools,
      // thinking adaptive requis pour opus-4-8 (omission = désactivé). Sans effet sur sonnet-5 (déjà adaptive par défaut).
      thinking: { type: 'adaptive' },
      ...(extraPayload ?? {}),
      ...(isLastRound
        ? {
            tool_choice: { type: 'none' },
            // Préserve l'effort venant de extraPayload (ex: 'xhigh' pour la revue) au dernier tour.
            output_config: extraOutputConfig ?? { effort: 'high' },
          }
        : {}),
    };
    if (!isLastRound && toolChoice) payload.tool_choice = toolChoice;

    const resp = await anthropicCall(payload);
    logUsage(`round=${round}`, resp?.usage);
    const content = Array.isArray(resp?.content) ? resp.content : [];
    const toolCalls = content.filter((b: any) => b?.type === 'tool_use');
    const blockTypes = content.map((b: any) => b?.type ?? 'unknown');
    const sqlQueries = toolCalls
      .filter((c: any) => c?.name === 'executer_sql')
      .map((c: any) => String(c?.input?.sql_query ?? ''));
    const memoryWrites = toolCalls
      .filter((c: any) => c?.name === 'memoriser')
      .map((c: any) => `${c?.input?.categorie ?? '?'}: ${String(c?.input?.contenu ?? '').slice(0, 80)}`);
    const memoryForgets = toolCalls
      .filter((c: any) => c?.name === 'oublier')
      .map((c: any) => String(c?.input?.id ?? ''));

    const turn: TurnLog = {
      round,
      stop_reason: resp?.stop_reason ?? null,
      block_types: blockTypes,
      sql_queries: sqlQueries,
      memory_writes: memoryWrites,
      memory_forgets: memoryForgets,
    };
    journal.push(turn);
    console.log(`[gaia-copilot] round=${round} stop_reason=${turn.stop_reason} blocks=${JSON.stringify(blockTypes)} sql=${JSON.stringify(sqlQueries)} memo+=${JSON.stringify(memoryWrites)} memo-=${JSON.stringify(memoryForgets)}`);

    if (toolCalls.length === 0 || isLastRound) {
      messages.push({ role: 'assistant', content });
      return { messages, last: resp, rounds: round, journal };
    }

    // Notifie les événements de progression avant l'exécution (streaming côté page)
    if (onEvent) {
      for (const call of toolCalls) {
        try {
          if (call?.name === 'executer_sql') {
            const q = String(call?.input?.sql_query ?? '');
            onEvent('gaia_sql', { summary: summarizeSql(q), query: q });
          } else if (call?.name === 'afficher_graphique') {
            onEvent('gaia_chart', call?.input ?? {});
          } else if (call?.name === 'memoriser') {
            onEvent('gaia_memoire', { categorie: call?.input?.categorie, contenu: call?.input?.contenu });
          }
        } catch { /* ignore */ }
      }
    }

    // Dispatche chaque tool_use vers son exécuteur — en parallèle (Promise.all)
    const toolResults = await Promise.all(
      toolCalls.map(async (call: any) => {
        let result: unknown;
        try {
          if (call?.name === 'executer_sql') {
            result = await runGaiaQuery(admin, String(call?.input?.sql_query ?? ''));
          } else if (call?.name === 'memoriser') {
            result = await memoriser(admin, String(call?.input?.categorie ?? ''), String(call?.input?.contenu ?? ''));
          } else if (call?.name === 'oublier') {
            result = await oublier(admin, String(call?.input?.id ?? ''));
          } else if (call?.name === 'afficher_graphique') {
            result = { ok: true, rendered: 'côté page' };
          } else {
            result = { error: `Outil inconnu: ${call?.name}` };
          }
        } catch (e: any) {
          result = { error: e?.message ?? String(e) };
        }
        return {
          type: 'tool_result',
          tool_use_id: call.id,
          content: JSON.stringify(result).slice(0, 60000),
        };
      })
    );

    // Renvoie l'assistant TEL QUEL (thinking + tool_use inclus, requis par l'API)
    messages.push({ role: 'assistant', content });
    messages.push({ role: 'user', content: toolResults });
  }

  throw new Error('Boucle agentique inattendue');
}



/**
 * Dernier recours : appel Anthropic SANS outils pour forcer une réponse texte.
 */
async function forceFinalText(
  model: string,
  system: string,
  messages: Array<{ role: 'user' | 'assistant'; content: any }>,
  dynamicSuffix?: string,
  reinforced = false,
): Promise<{ text: string; stop_reason: string | null; block_types: string[] }> {
  const instruction = reinforced
    ? 'Rédige ta réponse complète en français maintenant, à partir des résultats déjà obtenus. Ne renvoie ni outil ni JSON brut : uniquement une synthèse claire en Markdown.'
    : 'Donne maintenant ta réponse finale à partir des résultats déjà obtenus. Rédige une synthèse claire en français, en Markdown.';
  const forced = [...messages, {
    role: 'user' as const,
    content: instruction,
  }];
  const tools = [SQL_TOOL, MEMORISE_TOOL, OUBLIER_TOOL, CHART_TOOL];
  let resp: any;
  try {
    resp = await anthropicCall({
      model,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high' },
      system: systemBlocks(system, dynamicSuffix),
      messages: withCacheOnLastMessage(sanitizeMessagesForApi(forced)),
      tools,
      tool_choice: { type: 'none' },
    });
  } catch (e: any) {
    console.log(`[gaia-copilot] forceFinalText${reinforced ? ':retry' : ''} Anthropic error body: ${e?.message ?? e}`);
    throw e;
  }
  logUsage(`forceFinalText${reinforced ? ':retry' : ''}`, resp?.usage);
  const content = Array.isArray(resp?.content) ? resp.content : [];
  const blockTypes = content.map((b: any) => b?.type ?? 'unknown');
  console.log(`[gaia-copilot] forceFinalText${reinforced ? ':retry' : ''} stop_reason=${resp?.stop_reason} blocks=${JSON.stringify(blockTypes)}`);
  return { text: extractText(content), stop_reason: resp?.stop_reason ?? null, block_types: blockTypes };
}



// streamFinalRevue supprimé : la revue est désormais générée à l'intérieur du
// stream SSE ouvert immédiatement au début de l'action 'revue' (voir plus bas),
// pour éviter les IDLE_TIMEOUT de la gateway pendant la boucle toolLoop.

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) {
      return jsonResponse({ ok: false, error: 'Unauthorized: missing bearer token' }, 401);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const jwt = authHeader.replace('Bearer ', '');
    const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
    if (userErr || !userData?.user) {
      return jsonResponse({ ok: false, error: `Unauthorized: ${userErr?.message ?? 'session invalide'}` }, 401);
    }

    const { data: roleRows, error: roleErr } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userData.user.id)
      .in('role', ['admin', 'direction']);

    if (roleErr || !roleRows || roleRows.length === 0) {
      return jsonResponse({ ok: false, error: 'Forbidden: admin or direction only' }, 403);
    }

    let body: any = {};
    try { body = await req.json(); } catch { body = {}; }
    const action = body?.action;

    const admin = createClient(supabaseUrl, serviceKey);
    const data = await loadData(admin);
    const dataJson = JSON.stringify(data);
    console.log(`[gaia-copilot] dataJson size=${dataJson.length} chars (${Object.keys(data ?? {}).length} clés)`);
    if (dataJson.length < 200) {
      console.log(`[gaia-copilot] ⚠️ dataJson suspicieusement petit: ${dataJson.slice(0, 500)}`);
    }

    // Mémoire persistante — bloc dynamique (non caché) injecté après le préfixe stable.
    const memos = await loadMemories(admin);
    const memorySuffix = formatMemories(memos);
    console.log(`[gaia-copilot] memoires actives=${memos.length}`);

    const SUIVI_INSTRUCTION = `CONSIGNE DE SUIVI : quand une conversation aboutit à une action décidée (relance, plan client, décision), appelle immédiatement l'outil "memoriser" (catégorie 'suivi' ou 'plan') pour la consigner. Une action non mémorisée sera perdue.`;

    if (action === 'revue') {
      const suivis = memos.filter((m) => m.categorie === 'suivi');
      const suivisBlock = suivis.length
        ? `\n\nSUIVIS EN MÉMOIRE À CONTRÔLER (${suivis.length}) :\n${suivis.map((s) => `  • [${s.id}] ${s.contenu}`).join('\n')}\n\nAvant de rédiger la revue, vérifie chacun de ces suivis via executer_sql (le devis a-t-il été relancé et vu ? le client dormant a-t-il repassé commande ? etc.) et signale explicitement dans la revue (section risques ou actions) ceux restés SANS EFFET visible dans les données. Pour ceux qui sont clairement clos ou obsolètes, appelle "oublier" avec leur id.`
        : `\n\nAucun suivi actif en mémoire pour l'instant.`;

      const initialMessages = [{
        role: 'user' as const,
        content: `Voici les données commerciales agrégées (JSON) :\n\n\`\`\`json\n${dataJson}\n\`\`\`\n\nProduis une VRAIE REVUE STRATÉGIQUE via l'outil build_revue — pas un rapport de chiffres, mais une analyse d'exploitation avec un plan d'action concret et priorisé.\n\n### CONCEPTS MÉTIER À MOBILISER EXPLICITEMENT\n- **Pipeline VIVANT vs dormant** : devis < 6 mois = vivant, 6-12 mois = **gisement de relances** (lister les plus gros par numéro + client + montant via v_gaia_carnet_documents), > 12 mois = **à annuler** (hygiène commerciale).\n- **Commandes fermes anciennes** : à élucider (livraison, blocage, annulation ?).\n- **Carnet de commandes** = reste à livrer exact, **aucun chevauchement avec le CA facturé**.\n- **Comparaison N-1 à PÉRIODE ÉGALE** : mêmes mois de l'exercice fiscal (sept → août), jamais 12 mois vs 7.\n- **CA officiel** : hors éco-taxe et hors SFA (rétrocession).\n- **MAGASIN pièces détachées** (~750-900 k€/exercice, récurrent) : tendance, top clients pièces, à intégrer aux constats.\n- **Signaux clients croisés** : réparations RP sans achats de jeux = client à visiter ; parc vieillissant ; clients en déclin vs N-1.\n- **Marge / taux de marque** quand pertinent (arbitrage prix vs volume).\n\n### CONSIGNES DE SORTIE\n- santé : CA à période égale N/N-1/N-2 + évolution % ; tendance mensuelle % vs N-1 ; commentaire 2 phrases max.\n- mouvements : familles + clients qui montent/descendent (top mouvements chiffrés).\n- risques (marge, dépendance, stock, cash, calendrier) avec gravité.\n- **plan_actions** : entre **4 et 8 actions** PRIORISÉES par impact €, chacune ancrée dans des **données précises** (numéros de devis, noms de clients exacts, montants exacts). Chaque action précise horizon (cette_semaine / ce_mois / ce_trimestre), responsable suggéré (Valérie / commercial / Tristan / ADV) et 2-3 **premieres_etapes** concrètes. **JAMAIS de généralités** type "améliorer la communication" ou "développer le portefeuille".\n- **signaux_vigilance** : 3 à 5 points de risque **chiffrés** à surveiller.\n- Chaque champ texte : 1-2 phrases max, ton direct.${suivisBlock}\n\nAvant d'appeler build_revue, utilise executer_sql autant de fois que nécessaire pour vérifier/enrichir tes chiffres (notamment lister les devis 6-12 mois par montant via v_gaia_carnet_documents, extraire les tops clients pièces MAGASIN, identifier les clients avec RP sans achat jeux 12 mois, etc.), et "memoriser" pour consigner les nouvelles décisions/plans que la revue implique.`,
      }];
      const revueSystem = `${SYSTEM_PROMPT}\n\n${SUIVI_INSTRUCTION}\n\nTu peux utiliser executer_sql pour vérifier des chiffres, "memoriser"/"oublier" pour gérer la mémoire, avant de construire la revue. Ta réponse FINALE doit être un unique appel à l'outil build_revue avec des données structurées, sans texte libre. Le champ plan_actions doit contenir des actions ancrées dans des données précises (numéros de devis, clients, montants) — jamais de généralités.`;
      const revueExtra = { output_config: { effort: 'xhigh' } };

      const encoder = new TextEncoder();
      const userIdForRow = userData.user.id;
      const titreRevue = `Revue commerciale — ${new Date().toLocaleDateString('fr-FR')}`;

      // Valide la structure du build_revue : au moins un contenu utile
      // dans santé globale OU dans une des sections principales.
      const validateRevue = (input: any): { ok: true } | { ok: false; reason: string } => {
        if (!input || typeof input !== 'object') return { ok: false, reason: 'input non-objet' };
        const sante = input.sante && typeof input.sante === 'object' ? input.sante : {};
        const santeCommentaire = typeof sante.commentaire === 'string' ? sante.commentaire.trim() : '';
        const santeAnnees = Array.isArray(sante.annees) ? sante.annees : [];
        const santeTendance = Array.isArray(sante.tendance_mensuelle) ? sante.tendance_mensuelle : [];
        const santeFilled = santeCommentaire.length > 0 && santeAnnees.length > 0;

        const mvts = input.mouvements && typeof input.mouvements === 'object' ? input.mouvements : {};
        const familles = Array.isArray(mvts.familles) ? mvts.familles.length : 0;
        const clientsHausse = Array.isArray(mvts.clients_hausse) ? mvts.clients_hausse.length : 0;
        const clientsBaisse = Array.isArray(mvts.clients_baisse) ? mvts.clients_baisse.length : 0;
        const risques = Array.isArray(input.risques) ? input.risques.length : 0;
        const actions = Array.isArray(input.actions) ? input.actions.length : 0;
        const sectionsFilled = familles + clientsHausse + clientsBaisse + risques + actions;

        if (!santeFilled) {
          return { ok: false, reason: `santé globale vide (commentaire="${santeCommentaire.slice(0, 40)}", annees=${santeAnnees.length}, tendance=${santeTendance.length})` };
        }
        if (sectionsFilled === 0) {
          return { ok: false, reason: 'toutes les sections (mouvements, risques, actions) sont vides' };
        }
        return { ok: true };
      };

      // Effectue l'appel build_revue final ; renvoie l'input structuré ou lève.
      const callBuildRevue = async (
        agenticMessages: Array<{ role: 'user' | 'assistant'; content: any }>,
        extraInstruction: string | null,
      ): Promise<{ input: any; stopReason: string | null }> => {
        const tail = extraInstruction
          ? `Appelle maintenant l'outil build_revue avec la revue finale structurée. ${extraInstruction}`
          : `Appelle maintenant l'outil build_revue avec la revue finale structurée.`;
        const finalPayload: Record<string, unknown> = {
          model: REVUE_MODEL,
          // ↑ 32000 : la revue peut être volumineuse et on streame les heartbeats,
          //   donc pas de risque de timeout HTTP côté client.
          max_tokens: 32000,
          thinking: { type: 'adaptive' },
          system: systemBlocks(revueSystem, memorySuffix),
          messages: withCacheOnLastMessage(sanitizeMessagesForApi(
            agenticMessages.concat([{ role: 'user', content: tail }]),
          )),
          tools: [REVUE_TOOL],
          tool_choice: { type: 'tool', name: 'build_revue' },
          ...revueExtra,
        };
        const finalResp = await anthropicCall(finalPayload);
        logUsage(extraInstruction ? 'revue:build_revue:retry' : 'revue:build_revue', finalResp?.usage);
        const stopReason = finalResp?.stop_reason ?? null;
        const finalContent = Array.isArray(finalResp?.content) ? finalResp.content : [];
        const toolUse = finalContent.find((b: any) => b?.type === 'tool_use' && b?.name === 'build_revue');
        const inputSize = toolUse?.input ? JSON.stringify(toolUse.input).length : 0;
        console.log(`[gaia-copilot] build_revue${extraInstruction ? ':retry' : ''} stop_reason=${stopReason} tool_input_size=${inputSize}`);
        if (!toolUse || !toolUse.input || typeof toolUse.input !== 'object') {
          const blocks = finalContent.map((b: any) => b?.type ?? 'unknown');
          throw new Error(`build_revue non renvoyé par le modèle. stop_reason=${stopReason} blocks=${JSON.stringify(blocks)}`);
        }
        if (stopReason === 'max_tokens') {
          console.log(`[gaia-copilot] ⚠️ build_revue tronqué (stop_reason=max_tokens)`);
        }
        return { input: toolUse.input, stopReason };
      };

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          let heartbeat: number | undefined;
          let closed = false;
          const safeSend = (event: string, data: unknown) => {
            if (closed) return;
            try {
              controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
            } catch { closed = true; }
          };
          const safeHeartbeat = () => {
            if (closed) return;
            try { controller.enqueue(encoder.encode(`: gaia-heartbeat ${Date.now()}\n\n`)); }
            catch { closed = true; }
          };
          const safeClose = () => {
            if (closed) return;
            closed = true;
            try { controller.close(); } catch { /* already closed */ }
          };

          const work = async () => {
            let revueId: string | null = null;
            try {
              // 1. Draft row (statut = 'en_cours') — persistée avant tout traitement
              const { data: draftRow, error: draftErr } = await admin
                .from('gaia_revues')
                .insert({
                  titre: titreRevue,
                  statut: 'en_cours',
                  data: null,
                  created_by: userIdForRow,
                })
                .select('id')
                .single();
              if (draftErr) throw new Error(`Création de la revue impossible : ${draftErr.message}`);
              revueId = (draftRow as any)?.id ?? null;

              safeSend('gaia_start', { kind: 'revue', id: revueId });
              heartbeat = setInterval(safeHeartbeat, 10_000);

              if (dataJson.length < 200) {
                throw new Error(`Données agrégées insuffisantes (dataJson=${dataJson.length} chars) — la base commerciale n'a rien renvoyé. Vérifie la synchro Cegid.`);
              }

              // 2. Boucle agentique SQL, streamée via gaia_sql / gaia_memoire
              const { messages: agenticMessages } = await toolLoop({
                admin,
                model: REVUE_MODEL,
                system: revueSystem,
                dynamicSuffix: memorySuffix,
                initialMessages,
                extraTools: [],
                extraPayload: revueExtra,
                onEvent: (evt, data) => safeSend(evt, data),
              });

              // 3. Appel final build_revue (non-streamé, heartbeats maintiennent la connexion)
              safeSend('gaia_sql', { summary: 'Construction de la revue finale…', query: '' });
              let { input: revueInput, stopReason } = await callBuildRevue(agenticMessages, null);

              // 3bis. Validation : si vide/tronqué, on retente une fois avec une
              // consigne de concision explicite.
              let validation = validateRevue(revueInput);
              if (!validation.ok) {
                console.log(`[gaia-copilot] build_revue invalide (${validation.reason}) — retry`);
                safeSend('gaia_sql', { summary: 'Nouvelle tentative (revue trop courte)…', query: '' });
                const retryInstruction = `La précédente tentative a rendu une revue vide ou incomplète (${validation.reason}). REMPLIS OBLIGATOIREMENT sante.commentaire (2 phrases), sante.annees (au moins 2 exercices avec ca_ht) et AU MOINS UNE section parmi mouvements.familles, mouvements.clients_hausse/baisse, risques ou actions. Sois concis : chaque champ texte = 1-2 phrases maximum, maximum 5 items par liste.`;
                const retry = await callBuildRevue(agenticMessages, retryInstruction);
                revueInput = retry.input;
                stopReason = retry.stopReason;
                validation = validateRevue(revueInput);
                if (!validation.ok) {
                  throw new Error(`Revue vide même après retry (${validation.reason}). stop_reason=${stopReason}. Relancez la génération.`);
                }
              }

              // 4. Sauvegarde finale
              if (revueId) {
                const { error: updErr } = await admin
                  .from('gaia_revues')
                  .update({
                    statut: 'terminee',
                    data: revueInput,
                    erreur: null,
                    updated_at: new Date().toISOString(),
                  })
                  .eq('id', revueId);
                if (updErr) console.log(`[gaia-copilot] revue update terminee error: ${updErr.message}`);
              }
              safeSend('gaia_revue', { id: revueId, data: revueInput });
            } catch (e: any) {
              const msg = e?.message ?? String(e);
              console.log(`[gaia-copilot] revue background fatal: ${msg}`);
              if (revueId) {
                try {
                  await admin
                    .from('gaia_revues')
                    .update({
                      statut: 'erreur',
                      erreur: msg.slice(0, 2000),
                      updated_at: new Date().toISOString(),
                    })
                    .eq('id', revueId);
                } catch (persistErr: any) {
                  console.log(`[gaia-copilot] revue update erreur failed: ${persistErr?.message ?? persistErr}`);
                }
              }
              safeSend('gaia_error', { error: msg, id: revueId, code: isAnthropicOverload(e) ? 'overload' : undefined });
            } finally {
              if (heartbeat !== undefined) clearInterval(heartbeat);
              safeClose();
            }
          };

          const promise = work();
          // Garantit la poursuite du travail même si le client ferme la connexion SSE.
          try {
            // @ts-ignore EdgeRuntime est fourni par Supabase Edge Functions
            if (typeof EdgeRuntime !== 'undefined' && typeof EdgeRuntime.waitUntil === 'function') {
              // @ts-ignore
              EdgeRuntime.waitUntil(promise);
            }
          } catch { /* ignore */ }
        },
        cancel() {
          // Ne rien annuler : le travail continue via EdgeRuntime.waitUntil.
        },
      });

      return new Response(stream, {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'X-Accel-Buffering': 'no',
        },
      });
    }

    if (action === 'chat') {
      const question = typeof body?.question === 'string' ? body.question.trim() : '';
      if (!question) {
        return jsonResponse({ ok: false, error: 'question manquante' }, 400);
      }
      const history = Array.isArray(body?.history) ? body.history : [];
      const cleanHistory = history
        .filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
        .slice(-6)
        .map((m: any) => ({ role: m.role as 'user' | 'assistant', content: m.content as any }));

      const contextMsg = `Voici les données commerciales agrégées (JSON) à utiliser pour répondre :\n\n\`\`\`json\n${dataJson}\n\`\`\``;
      const initialMessages: Array<{ role: 'user' | 'assistant'; content: any }> = [
        { role: 'user', content: contextMsg },
        { role: 'assistant', content: 'Données reçues. Je réponds en m\'appuyant sur ces chiffres, sur ma mémoire persistante, et j\'appellerai executer_sql / memoriser / oublier / afficher_graphique au besoin.' },
        ...cleanHistory,
        { role: 'user', content: question },
      ];

      const chatSystem = `${SYSTEM_PROMPT}\n\n${SUIVI_INSTRUCTION}`;

      const encoder = new TextEncoder();
      let heartbeat: number | undefined;

      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const send = (event: string, data: unknown) => {
            try {
              controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
            } catch { /* closed */ }
          };
          send('gaia_start', { question });
          heartbeat = setInterval(() => {
            try { controller.enqueue(encoder.encode(`: gaia-heartbeat ${Date.now()}\n\n`)); }
            catch { if (heartbeat !== undefined) clearInterval(heartbeat); }
          }, 10_000);

          try {
            const { messages: finalMessages, last, rounds, journal } = await toolLoop({
              admin,
              model: CHAT_MODEL,
              system: chatSystem,
              dynamicSuffix: memorySuffix,
              initialMessages,
              onEvent: (evt, data) => send(evt, data),
            });

            const lastContent = Array.isArray(last?.content) ? last.content : [];
            let markdown = extractText(lastContent);
            let forcedDebug: any = null;

            if (!markdown || rounds >= MAX_TOOL_ROUNDS) {
              try {
                const forced = await forceFinalText(CHAT_MODEL, chatSystem, finalMessages, memorySuffix);
                if (forced.text) markdown = forced.text;
                forcedDebug = { stop_reason: forced.stop_reason, block_types: forced.block_types };
              } catch (e: any) {
                console.log(`[gaia-copilot] forceFinalText error: ${e?.message ?? e}`);
                forcedDebug = { error: e?.message ?? String(e) };
              }
            }

            if (!markdown) {
              try {
                const retry = await forceFinalText(CHAT_MODEL, chatSystem, finalMessages, memorySuffix, true);
                if (retry.text) markdown = retry.text;
                forcedDebug = { ...(forcedDebug ?? {}), retry: { stop_reason: retry.stop_reason, block_types: retry.block_types } };
              } catch (e: any) {
                console.log(`[gaia-copilot] forceFinalText retry error: ${e?.message ?? e}`);
                forcedDebug = { ...(forcedDebug ?? {}), retry: { error: e?.message ?? String(e) } };
              }
            }

            const sqlUsed = journal.flatMap((j) => j.sql_queries);

            if (!markdown) {
              send('gaia_final', {
                markdown: "Je n'ai pas réussi à formuler ma réponse. Peux-tu reformuler ta question ?",
                debug: { stop_reason: last?.stop_reason ?? null, tool_rounds: rounds, journal, forced: forcedDebug, empty_response: true },
                sql_used: sqlUsed,
              });
            } else {
              send('gaia_final', {
                markdown,
                debug: { stop_reason: last?.stop_reason ?? null, tool_rounds: rounds, journal, forced: forcedDebug },
                sql_used: sqlUsed,
              });
            }
          } catch (e: any) {
            console.log(`[gaia-copilot] chat stream fatal: ${e?.message ?? e}`);
            const overload = isAnthropicOverload(e);
            send('gaia_error', { error: e?.message ?? String(e), code: overload ? 'overload' : undefined });
          } finally {
            if (heartbeat !== undefined) clearInterval(heartbeat);
            try { controller.close(); } catch { /* already closed */ }
          }
        },
        cancel() {
          if (heartbeat !== undefined) clearInterval(heartbeat);
        },
      });

      return new Response(stream, {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'X-Accel-Buffering': 'no',
        },
      });
    }



    return jsonResponse({ ok: false, error: `Unknown action: ${action}` }, 400);

  } catch (e: any) {
    console.log(`[gaia-copilot] fatal error: ${e?.message ?? e}`);
    return jsonResponse({ ok: false, error: e?.message ?? String(e) }, 200);
  }
});
