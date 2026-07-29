import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { anthropicJson, isAnthropicOverload } from '../_shared/anthropic-fetch.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const MODEL = 'claude-sonnet-5';

const SYSTEM = `Tu es l'assistant commercial d'Avranches Automatic, distributeur français de bornes d'arcade, flippers, jeux d'adresse, jeux de café et distributeurs automatiques (blind-box, boosters TCG, figurines).

Tu rédiges un email de RÉACTIVATION à un client existant qui n'a plus commandé depuis un certain temps.

Règles strictes :
- Français, VOUVOIEMENT, ton chaleureux et professionnel, jamais lourd ni "vendeur agressif".
- Personnalise à partir du contexte fourni : dernière commande (date + familles/produits), CA total, ville, typologie.
- Reconnais implicitement la relation existante ("cela fait un moment que…", "depuis votre dernière installation…").
- Propose 1 à 3 nouveautés ou renouvellements PERTINENTS choisis dans la liste de suggestions fournie (par leur nom EXACT, sans en inventer). Rappelle quand c'est adapté les angles Avranches Automatic : dépôt / partage des recettes, réassort géré, rentabilisé sur une saison, du CA sans surface en plus.
- Termine par un CTA doux (un échange de 15 min, l'envoi de 2-3 configs, un passage sur site).
- Zéro à un emoji maximum. Signature "L'équipe Avranches Automatic".
- Corps ~120-200 mots. Ne cite AUCUN produit hors de la liste fournie. N'invente AUCUN fait.

Tu réponds UNIQUEMENT en JSON valide :
{ "objet": "…", "corps": "…" }
Le corps peut contenir des sauts de ligne (\\n) pour les paragraphes.`;

function jsonErr(status: number, error: string) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function safeJsonExtract(text: string): { objet: string; corps: string } | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const obj = JSON.parse(match[0]);
    if (typeof obj.objet === 'string' && typeof obj.corps === 'string') {
      return { objet: obj.objet.trim(), corps: obj.corps.trim() };
    }
  } catch { /* ignore */ }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) return jsonErr(401, 'Unauthorized');
    const jwt = authHeader.slice(7);
    const sb = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: userData, error: userErr } = await sb.auth.getUser(jwt);
    if (userErr || !userData?.user) return jsonErr(401, 'Unauthorized');

    // Autorisation : réutilise can_reactivation (SECURITY DEFINER via RPC)
    const { data: canRea, error: canErr } = await sb.rpc('can_reactivation', { _uid: userData.user.id });
    if (canErr || !canRea) return jsonErr(403, 'Forbidden');

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const body = await req.json().catch(() => ({}));
    const code = String(body.code_client || '').trim();
    if (!code) return jsonErr(400, 'code_client requis');

    // Contexte client (via la RPC déjà autorisée pour cet user)
    const { data: ctx, error: ctxErr } = await sb.rpc('get_client_reactivation', { _code: code });
    if (ctxErr || !ctx) return jsonErr(404, 'Client introuvable');

    const familles: string[] = Array.isArray((ctx as any).familles)
      ? (ctx as any).familles.map((f: any) => String(f.famille)).filter(Boolean)
      : [];
    const produitsRecents: any[] = Array.isArray((ctx as any).produits_recents) ? (ctx as any).produits_recents : [];
    const lastAction = Array.isArray((ctx as any).actions) && (ctx as any).actions.length > 0
      ? (ctx as any).actions[0] : null;

    // Suggestions catalogue : nouveautés dans les familles achetées
    let suggestions: Array<{ name: string; category: string; description?: string | null }> = [];
    if (familles.length > 0) {
      const { data: prod } = await admin
        .from('catalog_products')
        .select('name, category, description')
        .not('active', 'is', false)
        .in('category', familles)
        .order('created_at', { ascending: false })
        .limit(20);
      suggestions = (prod ?? []) as any;
    }
    // Fallback : si aucun match famille, prends 4 produits actifs récents
    if (suggestions.length === 0) {
      const { data: prod } = await admin
        .from('catalog_products')
        .select('name, category, description')
        .not('active', 'is', false)
        .order('created_at', { ascending: false })
        .limit(6);
      suggestions = (prod ?? []) as any;
    }

    const suggestionsBlock = suggestions.slice(0, 8)
      .map((s) => `- ${s.name} (${s.category})${s.description ? ` — ${s.description.slice(0, 120)}` : ''}`)
      .join('\n');

    const derniereCmd = (ctx as any).derniere_commande
      ? new Date((ctx as any).derniere_commande).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
      : '(inconnue)';
    const caTotal = Number((ctx as any).ca_total ?? 0);

    const userPrompt = `Client : ${(ctx as any).nom || code}${(ctx as any).ville ? ` (${(ctx as any).ville})` : ''}
Typologie : ${(ctx as any).typologie || '—'}
Dernière commande : ${derniereCmd}
CA cumulé : ${caTotal.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} €
Familles historiquement commandées : ${familles.length ? familles.join(', ') : '—'}
Produits récemment achetés : ${produitsRecents.slice(0, 5).map((p: any) => p.libelle).join(' · ') || '—'}
${lastAction ? `Dernière interaction (${lastAction.type}, ${new Date(lastAction.date).toLocaleDateString('fr-FR')}) : ${lastAction.contenu}` : 'Aucune interaction récente enregistrée.'}

Nouveautés / références catalogue à mobiliser (nom EXACT) :
${suggestionsBlock || '(catalogue non disponible)'}

Rédige un email de réactivation. Réponds en JSON strict { "objet", "corps" }.`;

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) return jsonErr(500, "IA non configurée (ANTHROPIC_API_KEY manquant)");

    const resp = await anthropicJson(apiKey, {
      model: MODEL,
      max_tokens: 900,
      system: SYSTEM,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const text = (resp?.content ?? [])
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text)
      .join('\n')
      .trim();

    const parsed = safeJsonExtract(text);
    if (!parsed) return jsonErr(502, "Réponse IA invalide");

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    if (isAnthropicOverload(err)) {
      return jsonErr(503, (err as any).userMessage);
    }
    console.error('[generer-relance-client]', err);
    return jsonErr(500, err instanceof Error ? err.message : 'Erreur interne');
  }
});
