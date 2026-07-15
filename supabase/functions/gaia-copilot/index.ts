import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL = 'claude-sonnet-5';
const ANTHROPIC_VERSION = '2023-06-01';
const MAX_TOOL_ROUNDS = 6;
const MAX_TOKENS_PER_TURN = 8000;

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
  Description et famille des articles. Jointure avec v_gaia_lignes : trim(l.code_article) = trim(s.inventory_id).

- gaia_clients(customer_id, name, …) — référentiel clients (jointure : trim(l.code_client) = trim(c.customer_id)).
- gaia_client_groupes(code_client, groupe) — regroupement de comptes clients par entité économique.

- gaia_commandes(...)
  Statuts :
    • 'Brouillon' = devis
    • 'Ouvert', 'Expédition en cours', 'Reliquat' = commandes signées en cours
    • 'Historique', 'Annulé' = À EXCLURE des analyses opérationnelles.

Vues d'analyse déjà disponibles :
  v_gaia_ca_mensuel, v_gaia_ca_client, v_gaia_ca_famille, v_gaia_ca_periode_egale,
  v_gaia_devis_a_relancer, v_gaia_clients_dormants, v_gaia_stock_dormant,
  v_gaia_marge_famille, v_gaia_marge_client (marge = taux de marque : (ca - cout) / ca).

Règles :
  • Uniquement des SELECT (WITH autorisé). Interdits : INSERT/UPDATE/DELETE/DROP/ALTER/CREATE/GRANT/TRUNCATE.
  • Limite tes requêtes (LIMIT 50 par défaut, LIMIT 200 maximum).
  • Ne fais JAMAIS apparaître SFA (code_client = '9SFA00000') dans les palmarès/dormants/actions.
  • Raisonne toujours en exercice fiscal, jamais en année civile.
`;

const SYSTEM_PROMPT = `Tu es le copilote stratégique de la direction commerciale d'Avranches Automatic (distributeur français de flippers — revendeur officiel Stern —, jeux d'arcade, grues et distributeurs automatiques). Tu reçois les données commerciales réelles agrégées (CA, clients, devis, stock). Tu raisonnes en dirigeant commercial : factuel, chiffré, direct. Chaque constat s'appuie sur un chiffre fourni ; chaque recommandation est actionnable (qui fait quoi, sur quel client/produit, pourquoi maintenant). Tu signales les limites des données quand c'est pertinent. Tu réponds en français, en Markdown clair.

IMPORTANT — EXERCICE FISCAL : L'exercice fiscal d'Avranches Automatic va du 1er septembre au 31 août (clôture 31/08). Les données "annee" fournies sont des exercices fiscaux (ex. 2026 = 1er sept. 2025 → 31 août 2026), pas des années civiles. Raisonne toujours en exercices, jamais en années civiles. Quand tu nommes une année, écris "exercice 2026" (ou "Ex. 2026 (sept. 2025 → août 2026)"). Compare toujours à période égale (v_gaia_ca_periode_egale), jamais exercice plein vs exercice en cours. Les mois du calendrier fiscal vont de septembre (mois_fiscal=1) à août (mois_fiscal=12).

IMPORTANT — SFA : SFA (Société Française Automatique, code client 9SFA00000) est une société sœur du groupe Gaia : les ventes à SFA sont des rétrocessions intra-groupe sans marge, déjà exclues des données de CA que tu reçois. Ne traite JAMAIS SFA comme un client à développer ou à relancer, et ne la fais jamais apparaître dans les palmarès, dormants ou actions. Le CA analysé est le "vrai CA" d'Avranches Automatic. Le total annuel de rétrocession SFA t'est fourni séparément (retrocession_sfa) uniquement pour contexte.${SCHEMA_DOC}`;

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
        description: 'TOP 5 actions priorisées par impact en euros.',
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
    },
    required: ['sante', 'mouvements', 'risques', 'actions'],
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

async function anthropicCall(payload: Record<string, unknown>) {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY manquant');
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Anthropic HTTP ${res.status} ${res.statusText}. Body: ${text}`);
  try { return JSON.parse(text); }
  catch { throw new Error(`Anthropic 200 mais JSON invalide. Body: ${text.slice(0, 1500)}`); }
}

type TurnLog = {
  round: number;
  stop_reason: string | null;
  block_types: string[];
  sql_queries: string[];
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
 * Boucle agentique : exécute executer_sql jusqu'à MAX_TOOL_ROUNDS.
 * Retourne l'historique complet (assistant renvoyé TEL QUEL, thinking inclus),
 * la dernière réponse, le nombre de tours et le journal détaillé.
 */
async function toolLoop(params: {
  admin: any;
  system: string;
  initialMessages: Array<{ role: 'user' | 'assistant'; content: any }>;
  extraTools?: any[];
  toolChoice?: any;
}): Promise<{
  messages: Array<{ role: 'user' | 'assistant'; content: any }>;
  last: any;
  rounds: number;
  journal: TurnLog[];
}> {
  const { admin, system, initialMessages, extraTools = [], toolChoice } = params;
  const tools = [SQL_TOOL, ...extraTools];
  const messages = [...initialMessages];
  const journal: TurnLog[] = [];

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const isLastRound = round === MAX_TOOL_ROUNDS;
    const payload: Record<string, unknown> = {
      model: ANTHROPIC_MODEL,
      max_tokens: MAX_TOKENS_PER_TURN,
      system: isLastRound
        ? `${system}\n\nTu as atteint la limite de ${MAX_TOOL_ROUNDS} appels à executer_sql. Réponds maintenant avec les informations dont tu disposes.`
        : system,
      messages,
      tools: isLastRound ? extraTools : tools,
    };
    if (toolChoice) payload.tool_choice = toolChoice;

    const resp = await anthropicCall(payload);
    const content = Array.isArray(resp?.content) ? resp.content : [];
    const sqlCalls = content.filter((b: any) => b?.type === 'tool_use' && b?.name === 'executer_sql');
    const blockTypes = content.map((b: any) => b?.type ?? 'unknown');
    const sqlQueries = sqlCalls.map((c: any) => String(c?.input?.sql_query ?? ''));

    const turn: TurnLog = {
      round,
      stop_reason: resp?.stop_reason ?? null,
      block_types: blockTypes,
      sql_queries: sqlQueries,
    };
    journal.push(turn);
    console.log(`[gaia-copilot] round=${round} stop_reason=${turn.stop_reason} blocks=${JSON.stringify(blockTypes)} sql=${JSON.stringify(sqlQueries)}`);

    if (sqlCalls.length === 0 || isLastRound) {
      messages.push({ role: 'assistant', content });
      return { messages, last: resp, rounds: round, journal };
    }

    // Exécute les requêtes SQL demandées
    const toolResults = await Promise.all(
      sqlCalls.map(async (call: any) => {
        const sql = String(call?.input?.sql_query ?? '');
        const result = await runGaiaQuery(admin, sql);
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
  system: string,
  messages: Array<{ role: 'user' | 'assistant'; content: any }>,
): Promise<{ text: string; stop_reason: string | null; block_types: string[] }> {
  const forced = [...messages, {
    role: 'user' as const,
    content: 'Donne maintenant ta réponse finale à partir des résultats déjà obtenus.',
  }];
  const resp = await anthropicCall({
    model: ANTHROPIC_MODEL,
    max_tokens: MAX_TOKENS_PER_TURN,
    system,
    messages: forced,
  });
  const content = Array.isArray(resp?.content) ? resp.content : [];
  const blockTypes = content.map((b: any) => b?.type ?? 'unknown');
  console.log(`[gaia-copilot] forceFinalText stop_reason=${resp?.stop_reason} blocks=${JSON.stringify(blockTypes)}`);
  return { text: extractText(content), stop_reason: resp?.stop_reason ?? null, block_types: blockTypes };
}


/** Stream final Anthropic call (SSE passthrough) — utilisé pour la revue afin de conserver l'API SSE côté client. */
async function streamFinalRevue(system: string, messages: Array<{ role: 'user' | 'assistant'; content: any }>) {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY manquant');

  const payload = {
    model: ANTHROPIC_MODEL,
    max_tokens: 16000,
    stream: true,
    system,
    messages,
    tools: [REVUE_TOOL],
    tool_choice: { type: 'tool', name: 'build_revue' },
  };
  const payloadStr = JSON.stringify(payload);
  const inputChars = payloadStr.length;

  const encoder = new TextEncoder();
  let heartbeat: number | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(`event: gaia_start\ndata: ${JSON.stringify({ input_chars: inputChars })}\n\n`));
      heartbeat = setInterval(() => {
        try { controller.enqueue(encoder.encode(`: gaia-heartbeat ${Date.now()}\n\n`)); }
        catch { if (heartbeat !== undefined) clearInterval(heartbeat); }
      }, 10_000);
      try {
        const upstream = await fetch(ANTHROPIC_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': ANTHROPIC_VERSION,
          },
          body: payloadStr,
        });
        if (!upstream.ok) {
          const body = await upstream.text();
          controller.enqueue(encoder.encode(`event: gaia_error\ndata: ${JSON.stringify({ error: `Anthropic HTTP ${upstream.status} ${upstream.statusText}. Body: ${body}`, status: upstream.status })}\n\n`));
          controller.close();
          return;
        }
        if (!upstream.body) {
          controller.enqueue(encoder.encode(`event: gaia_error\ndata: ${JSON.stringify({ error: 'Anthropic 200 sans flux de réponse' })}\n\n`));
          controller.close();
          return;
        }
        reader = upstream.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(value);
        }
        controller.enqueue(encoder.encode(`\n\nevent: gaia_debug\ndata: ${JSON.stringify({ input_chars: inputChars })}\n\n`));
        controller.close();
      } catch (error) {
        controller.enqueue(encoder.encode(`event: gaia_error\ndata: ${JSON.stringify({ error: error instanceof Error ? error.message : String(error) })}\n\n`));
        controller.close();
      } finally {
        if (heartbeat !== undefined) clearInterval(heartbeat);
      }
    },
    cancel() {
      if (heartbeat !== undefined) clearInterval(heartbeat);
      reader?.cancel();
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

    if (action === 'revue') {
      const initialMessages = [{
        role: 'user' as const,
        content: `Voici les données commerciales agrégées (JSON) :\n\n\`\`\`json\n${dataJson}\n\`\`\`\n\nProduis la revue commerciale du mois via l'outil build_revue.\n- santé globale : CA à période égale N/N-1/N-2 + évolution en % ; tendance mensuelle en % vs N-1 pour chaque mois disponible ; commentaire 2 phrases max.\n- mouvements : familles et clients qui montent/descendent (top mouvements chiffrés) ;\n- risques (marge, dépendance client, stock, cash, calendrier) avec gravité ;\n- TOP 5 actions priorisées par impact euros (relances devis nominatives, clients dormants à réactiver, stock à écouler). Chaque champ texte : 1-2 phrases max, ton direct.\n\nAvant d'appeler build_revue, utilise executer_sql autant de fois que nécessaire pour vérifier/enrichir tes chiffres.`,
      }];
      const revueSystem = `${SYSTEM_PROMPT}\n\nTu peux utiliser executer_sql pour vérifier des chiffres avant de construire la revue. Ta réponse FINALE doit être un unique appel à l'outil build_revue avec des données structurées, sans texte libre.`;

      // Boucle SQL non-streamée (autorise seulement executer_sql à ce stade)
      const { messages: agenticMessages } = await toolLoop({
        admin,
        system: revueSystem,
        initialMessages,
        extraTools: [],
      });

      // Retire le dernier assistant (produit après épuisement des SQL) pour que le dernier tour final relance proprement le modèle en le forçant sur build_revue.
      // On garde tout l'historique tel quel : le modèle voit ses propres constats et les tool_result SQL.
      return await streamFinalRevue(revueSystem, agenticMessages.concat([{
        role: 'user',
        content: 'Appelle maintenant l\'outil build_revue avec la revue finale structurée.',
      }]));
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
        { role: 'assistant', content: 'Données reçues. Je réponds en m\'appuyant sur ces chiffres et j\'appellerai executer_sql si un détail me manque.' },
        ...cleanHistory,
        { role: 'user', content: question },
      ];

      const { messages: finalMessages, last, rounds } = await toolLoop({
        admin,
        system: SYSTEM_PROMPT,
        initialMessages,
      });

      const lastContent = Array.isArray(last?.content) ? last.content : [];
      const markdown = lastContent
        .filter((p: any) => p?.type === 'text' && typeof p.text === 'string')
        .map((p: any) => p.text)
        .join('\n\n')
        .trim();

      if (!markdown) {
        return jsonResponse({ ok: false, error: `Réponse vide (stop_reason=${last?.stop_reason ?? '?'}, rounds=${rounds})` }, 500);
      }

      return jsonResponse({
        ok: true,
        markdown,
        debug: { stop_reason: last?.stop_reason ?? null, tool_rounds: rounds },
      });
    }

    return jsonResponse({ ok: false, error: `Unknown action: ${action}` }, 400);

  } catch (e: any) {
    const status = Number.isInteger(e?.status) && e.status >= 400 && e.status <= 599 ? e.status : 500;
    return jsonResponse({ ok: false, error: e?.message ?? String(e) }, status);
  }
});
