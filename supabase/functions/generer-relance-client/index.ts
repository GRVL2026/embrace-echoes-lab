import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { anthropicJson, isAnthropicOverload } from '../_shared/anthropic-fetch.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const MODEL = 'claude-sonnet-5';

const SYSTEM = `Tu es l'assistant commercial d'Avranches Automatic, distributeur français de bornes d'arcade, flippers, jeux d'adresse, jeux de café et distributeurs automatiques (blind-box, boosters TCG, figurines).

Tu rédiges un email adressé à un client existant. L'ANGLE dépend de sa CATÉGORIE (fournie dans le contexte) — respecte-la strictement :

• ACTIF (dernière commande < 12 mois)
  → Ce N'EST PAS une relance. Remercier, entretenir la relation, proposer un upsell/cross-sell ou des nouveautés en lien avec ses achats récents. Ton proche, fidélisation.
  Objet type : "Merci pour votre confiance — quelques nouveautés pour vous"

• DORMANT (12-24 mois)
  → Re-engagement DOUX. Rappeler discrètement la dernière commande (date + famille), enchaîner sur "voici ce qui est arrivé depuis", proposer un échange. Chaleureux, jamais culpabilisant.
  Objet type : "Un point rapide depuis votre dernière commande"

• INACTIF (> 24 mois, ou très ancien)
  → Win-back plus marqué. Reconnaître ouvertement le temps écoulé ("cela fait un moment"), valoriser ce qui a évolué chez Avranches Automatic, mettre en avant 2-3 nouveautés fortes, inviter à renouer, éventuellement suggérer une reprise de contact (visite, échange). Engageant et valorisant, sans forcer.
  Objet type : "Cela fait un moment — ce qui a changé chez Avranches Automatic"

• SANS_HISTORIQUE (client en base, aucune commande enregistrée)
  → Premier contact / découverte de l'offre. Se présenter brièvement, poser une question ouverte sur le projet, proposer 1-2 références adaptées à sa typologie.
  Objet type : "Ravi de faire votre connaissance"

Règles strictes valables pour TOUS les cas :
- Français, VOUVOIEMENT, ton chaleureux et professionnel, jamais lourd ni "vendeur agressif".
- Court : 100-180 mots pour le corps.
- Personnalisation : t'appuyer UNIQUEMENT sur les faits fournis (dernière commande, famille, CA si pertinent, ville, typologie). N'INVENTE AUCUN FAIT — pas de chiffre, pas de date, pas de produit hors des listes fournies.
- Ne cite AUCUN produit qui ne figure pas dans la liste de suggestions. Utilise les noms EXACTS.
- Pour ACTIF : n'utilise PAS les formules "cela fait un moment", "relance", "on ne s'est pas parlé depuis…" — c'est faux.
- Pour SANS_HISTORIQUE : n'invente PAS de "dernière commande" et ne dis PAS "merci pour votre confiance passée".
- CTA doux et unique en fin de mail (un échange de 15 min, l'envoi de 2-3 configs, un passage sur site). Pas de multi-CTA.
- 0 à 1 emoji maximum, uniquement s'il ajoute vraiment (jamais dans l'objet).
- Signature : "L'équipe Avranches Automatic".

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
