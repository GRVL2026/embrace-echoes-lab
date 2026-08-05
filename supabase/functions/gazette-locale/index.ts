import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { anthropicJson } from '../_shared/anthropic-fetch.ts';

// Gazette locale — repère dans la presse les établissements de loisirs qui viennent de
// bouger, et en fait des opportunités commerciales.
//
// Un lieu qui OUVRE doit s'équiper, un lieu REPRIS veut se démarquer, un lieu qui
// S'AGRANDIT a un budget voté : ce sont les trois moments où l'on achète des jeux.
//
// SOURCE : le flux RSS de Google Actualités. Choix déterminant — la quasi-totalité de la
// presse quotidienne régionale (Ouest-France, actu.fr, La Manche Libre, Sud Ouest, La Voix
// du Nord, Le Télégramme…) bloque les robots, mais Google les indexe et sert titres, dates
// et sources dans un flux librement interrogeable. Pour DÉTECTER, le titre suffit.
//
// Ce flux ne consomme aucun quota de recherche web : dix requêtes couvrent la France
// entière en quatre secondes. C'est pourquoi le balayage est national ET quotidien, là où
// une rotation par région avait d'abord été envisagée.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;
const MODEL = 'claude-sonnet-5';

const admin = createClient(SUPABASE_URL, SERVICE_KEY);

const UA = 'Mozilla/5.0 (compatible; ArcadeOS/1.0; +https://avranchesautomatic.com)';
const BUDGET_MS = 110_000;
// Nombre de titres soumis à l'IA en un appel. Au-delà, la requête s'éternise et la
// plateforme tue la fonction (502 constaté sur un relevé de 30 jours). Le reliquat est
// traité au passage suivant : rien n'est perdu, tout est simplement étalé.
const MAX_PAR_APPEL = 35;

// Types de lieux susceptibles d'acheter des jeux d'arcade, flippers, billards ou grues.
const LIEUX = [
  'bowling', '"parc de loisirs"', '"laser game"', '"complexe de loisirs"',
  '"trampoline park"', '"salle de jeux"', '"escape game"', '"bar à jeux"',
  '"salle d\'arcade"', 'camping', '"village vacances"', '"parc aquatique"',
  // Plaines de jeux couvertes : gros consommateurs de grues et de bornes.
  // ⚠️ Ne PAS chercher « plaine de jeux » : en français de France l'expression désigne un
  // terrain de sport (« le FC X de retour sur la pelouse »). C'est un belgicisme.
  '"parc de jeux indoor"', '"parc de jeux" enfants',
];

// Ce qui trahit un investissement imminent.
const EVENEMENTS =
  '(ouverture OR ouvre OR repris OR reprise OR "change de mains" OR rachète OR racheté OR ' +
  '"nouveau gérant" OR "nouveaux propriétaires" OR "nouveau propriétaire" OR rénove OR ' +
  'rénovation OR agrandit OR agrandissement OR investit OR "va ouvrir" OR "ouvrira")';

// Écarté avant même d'appeler l'IA : inutile de lui faire lire du bruit évident.
const BRUIT = /championnat|victoire|grand prix|pilote|kartcom|résultats?\b|festival|concert|journées du patrimoine|pokémon|nintendo|playstation|météo|curistes?|élection|pelouse|football|match|tournoi/i;

type Brut = { titre: string; url: string; source: string; publie: string };

function xmlDecode(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

// Google Actualités refuse les adresses IP des centres de données : depuis Supabase, il
// répond 503 avec sa page « Sorry… », alors que la même requête aboutit depuis un poste
// ordinaire. On passe donc par un relais Cloudflare Worker, dont l'adresse de sortie est
// acceptée. Le relais est optionnel : sans lui, on tente l'appel direct, qui fonctionnera
// si l'hébergeur change d'adresse ou si Google assouplit son filtrage.
const PROXY = (Deno.env.get('GAZETTE_PROXY_URL') || '').replace(/\/$/, '');

async function interrogerGoogleNews(requete: string, depuis: string): Promise<Brut[]> {
  const q = encodeURIComponent(`${requete} ${EVENEMENTS} after:${depuis}`);
  const direct = `https://news.google.com/rss/search?q=${q}&hl=fr&gl=FR&ceid=FR:fr`;
  const url = PROXY ? `${PROXY}/news?q=${q}` : direct;
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept': 'application/rss+xml, application/xml, text/xml' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Google Actualités ${res.status} — ${(await res.text().catch(() => '')).slice(0, 120)}`);
  const xml = await res.text();
  if (!xml.includes('<item>')) throw new Error(`Flux sans article (${xml.length} octets) — ${xml.slice(0, 120)}`);

  const out: Brut[] = [];
  for (const bloc of xml.split('<item>').slice(1)) {
    const titre = xmlDecode(bloc.match(/<title>(.*?)<\/title>/s)?.[1] ?? '').trim();
    const lien = (bloc.match(/<link>(.*?)<\/link>/s)?.[1] ?? '').trim();
    const src = xmlDecode(bloc.match(/<source[^>]*>(.*?)<\/source>/s)?.[1] ?? '').trim();
    const pub = bloc.match(/<pubDate>(.*?)<\/pubDate>/s)?.[1] ?? '';
    if (!titre || !lien) continue;
    const d = new Date(pub);
    if (isNaN(d.getTime())) continue;               // sans date vérifiable, pas de signal
    out.push({ titre, url: lien, source: src || '(source inconnue)', publie: d.toISOString().slice(0, 10) });
  }
  return out;
}

// Les liens Google Actualités sont des redirections : on remonte à l'URL réelle pour que
// le média soit identifiable et que le lien survive.
async function resoudreUrl(url: string): Promise<string> {
  if (!url.includes('news.google.com')) return url;
  try {
    const res = await fetch(url, {
      method: 'GET', redirect: 'follow',
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(8_000),
    });
    const finale = res.url && !res.url.includes('news.google.com') ? res.url : url;
    // ⚠️ Indispensable : sans annulation, le corps de la page est mis en mémoire tampon.
    // Des articles de presse à plusieurs mégaoctets, téléchargés en parallèle, ont suffi
    // à faire dépasser la limite mémoire de la fonction (WORKER_RESOURCE_LIMIT). Seule
    // l'adresse de redirection nous intéresse, jamais le contenu.
    try { await res.body?.cancel(); } catch { /* corps déjà consommé ou absent */ }
    return finale;
  } catch {
    return url;
  }
}

const EXTRACTION = `Tu lis des articles de presse locale française. Pour CHAQUE article, identifie LA PERSONNE QUI EXPLOITE OU REPREND l'établissement dont parle l'article : gérant, gérante, propriétaire, directeur, directrice, repreneur, exploitant, fondateur.

Réponds UNIQUEMENT par un tableau JSON, un objet par article, dans l'ordre des articles :
[{"i": 0, "nom": "Prénom Nom", "role": "fonction telle qu'écrite dans l'article", "citation": "extrait exact de l'article, 40 à 220 caractères, d'où vient ce nom"}]

RÈGLES ABSOLUES
- N'INVENTE RIEN. Si l'article ne nomme personne qui exploite le lieu, réponds {"i": <n>, "nom": null, "role": null, "citation": null}.
- N'inclus PAS un journaliste, un maire ou un élu, un client interrogé, un architecte, un porte-parole : uniquement la personne qui tient ou reprend l'établissement.
- La citation doit être un passage COPIÉ MOT POUR MOT de l'article : c'est la preuve que le nom en vient. Si tu ne peux pas la copier exactement, mets null au nom aussi.
- Un objet par article, même vide, dans l'ordre. Rien d'autre que le tableau JSON.`;

const PROMPT = `Tu tries des titres de presse pour Avranches Automatic, distributeur français de JEUX D'ARCADE, FLIPPERS, BILLARDS, BABY-FOOT, GRUES et DISTRIBUTEURS AUTOMATIQUES. Ses clients sont des lieux de loisirs : bowlings, parcs indoor, campings, bars, hôtels, centres commerciaux.

Pour CHAQUE titre, décide s'il signale une OPPORTUNITÉ COMMERCIALE RÉELLE, c'est-à-dire un établissement de loisirs qui va devoir s'équiper :
- il OUVRE ou va ouvrir → il équipe ses espaces
- il est REPRIS / change de mains → les nouveaux exploitants renouvellent
- il RÉNOVE, s'AGRANDIT, se DIVERSIFIE → budget engagé
- il subit un sinistre ou une fermeture forcée d'attraction → il doit remplacer

ÉCARTE sans hésiter : festivals, concerts, événements ponctuels, résultats sportifs, sorties de jeux vidéo, articles touristiques, faits divers sans rapport avec un investissement, et tout établissement qui n'est pas un lieu de loisirs (restaurant seul, commerce, coiffeur).

Réponds UNIQUEMENT par un tableau JSON, un objet par titre RETENU (n'inclus pas ceux que tu écartes) :
[{
  "i": <index du titre dans la liste>,
  "commune": "<commune, ou null>",
  "departement": "<numéro à 2 chiffres, ou null>",
  "region": "<région française, ou 'Belgique' / 'Luxembourg'>",
  "type_lieu": "<bowling|parc de loisirs|camping|laser game|bar à jeux|escape game|complexe de loisirs|autre>",
  "evenement": "<ouverture|reprise|rénovation|agrandissement|diversification|sinistre>",
  "etablissement": "<nom de l'établissement si le titre le donne, sinon null>",
  "interpretation": "<UNE phrase : ce qui se passe et POURQUOI c'est une occasion pour Avranches Automatic, avec ce qu'on peut lui vendre>",
  "urgence": "<haute|moyenne|basse>"
}]

RÈGLES :
- N'INVENTE RIEN. Si le titre ne donne pas la commune ou le nom, mets null. Ne devine pas.
- "haute" = l'établissement ouvre ou vient d'être repris : il faut l'appeler cette semaine.
- Sois SÉVÈRE. Mieux vaut cinq signaux justes que trente approximatifs : un commercial qui perd son temps sur du bruit cesse d'ouvrir la gazette.
- Si aucun titre ne mérite d'être retenu, réponds [].`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  const isCron = !!CRON_SECRET && (req.headers.get('x-cron-secret') || '') === CRON_SECRET;
  if (!isCron) {
    const auth = req.headers.get('Authorization') || '';
    const jwt = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!jwt) return json({ error: 'Unauthorized' }, 401);
    const { data: u } = await admin.auth.getUser(jwt);
    if (!u?.user) return json({ error: 'Unauthorized' }, 401);
    const { data: roles } = await admin.from('user_roles').select('role').eq('user_id', u.user.id);
    if (!(roles || []).some((r: any) => r.role === 'admin' || r.role === 'direction'))
      return json({ error: 'Forbidden' }, 403);
  }

  const debut = Date.now();
  try {
    const body = await req.json().catch(() => ({}));

    // ─── Mode ENRICHISSEMENT ────────────────────────────────────────────────────
    // Google Actualités ne livre plus qu'un lien chiffré, illisible dans un navigateur
    // (« news.google.com est bloqué »), et qu'aucune astuce d'URL ne dénoue : la page de
    // redirection est en JavaScript. La vraie adresse se retrouve en cherchant le titre
    // exact sur le web, ce que fait le collecteur depuis le Mac — la même connexion
    // résidentielle qui lui permet déjà d'atteindre la presse. La fonction reçoit ici le
    // texte de l'article et n'a plus qu'à en extraire la personne à appeler.
    if (body.action === 'a_enrichir') {
      // Ordre de service : le territoire d'abord, la fraîcheur ensuite. Quand on ne
      // traite qu'une vingtaine d'articles par jour, ceux de Normandie, Bretagne et
      // Île-de-France doivent passer avant un signal du Var — on peut s'y déplacer.
      const { data, error } = await admin
        .from('gazette_signaux')
        .select('id, titre, source, url, publie_le, region')
        .neq('statut', 'ignore')
        .is('article_lu_at', null)
        .order('publie_le', { ascending: false })
        .limit(400);
      if (error) throw error;
      const PRIO = new Set(['Normandie', 'Bretagne', 'Île-de-France', 'Ile-de-France']);
      const tries = [...(data ?? [])].sort((x: any, y: any) => {
        const px = PRIO.has(x.region ?? '') ? 0 : 1, py = PRIO.has(y.region ?? '') ? 0 : 1;
        return px !== py ? px - py : String(y.publie_le).localeCompare(String(x.publie_le));
      }).slice(0, Math.min(60, Math.max(1, Number(body.limite ?? 25))));
      const { count } = await admin.from('gazette_signaux')
        .select('id', { count: 'exact', head: true })
        .neq('statut', 'ignore').is('article_lu_at', null);
      return json({ ok: true, a_enrichir: tries, restants: count ?? 0 });
    }

    if (Array.isArray(body.enrichis)) {
      const lot = body.enrichis
        .filter((e: any) => e?.id)
        .slice(0, 12) as { id: string; url?: string; texte?: string }[];
      if (lot.length === 0) return json({ ok: true, traites: 0 });

      const lisibles = lot.filter((e) => (e.texte ?? '').trim().length > 400);
      let extraits: any[] = [];
      if (lisibles.length) {
        const corpus = lisibles
          .map((e, i) => `### ARTICLE ${i}\n${(e.texte ?? '').slice(0, 7000)}`)
          .join('\n\n');
        // Deux arguments positionnels, comme le tri plus bas : passer un objet unique
        // envoyait « [object Object] » en guise de clé, et l'API répondait 401.
        const repIA = await anthropicJson(ANTHROPIC_KEY, {
          model: MODEL,
          max_tokens: 3000,
          system: EXTRACTION,
          messages: [{ role: 'user', content: corpus }],
        });
        const rep: string = (repIA?.content ?? []).find((b: any) => b.type === 'text')?.text ?? '';
        const d = (rep ?? '').indexOf('[');
        if (d >= 0) {
          const f = rep.lastIndexOf(']');
          try { extraits = JSON.parse(f > d ? rep.slice(d, f + 1) : rep.slice(d) + ']'); }
          catch { extraits = []; }   // une extraction ratée ne doit pas perdre les URLs résolues
        }
      }
      const parIndex = new Map<number, any>();
      for (const x of extraits) if (Number.isInteger(Number(x?.i))) parIndex.set(Number(x.i), x);

      let avecContact = 0, resolus = 0;
      for (const e of lot) {
        const k = lisibles.indexOf(e);
        const x = k >= 0 ? parIndex.get(k) : null;
        const nom = typeof x?.nom === 'string' && x.nom.trim() ? x.nom.trim() : null;
        // Toujours horodater, même sans contact trouvé : un article illisible qui reste
        // « à lire » revient à chaque passage et bloque la file — la file d'enrichissement
        // OSM s'était figée exactement ainsi sur un département.
        const maj: Record<string, unknown> = { article_lu_at: new Date().toISOString() };
        if (e.url && /^https?:\/\//.test(e.url) && !e.url.includes('news.google.com')) { maj.url = e.url; resolus++; }
        if (nom) {
          maj.contact_nom = nom;
          maj.contact_role = typeof x.role === 'string' && x.role.trim() ? x.role.trim() : null;
          maj.contact_citation = typeof x.citation === 'string' && x.citation.trim() ? x.citation.trim() : null;
          maj.contact_origine = 'article';
          avecContact++;
        }
        const { error: eMaj } = await admin.from('gazette_signaux').update(maj).eq('id', e.id);
        if (eMaj) throw eMaj;
      }
      // L'appelant n'envoie QUE les articles qu'il a réellement pu chercher : ceux
      // laissés de côté par un moteur saturé ne passent pas ici, et gardent donc leur
      // article_lu_at à NULL. Marquer un échec temporaire comme définitif avait effacé
      // 136 articles d'un coup.
      return json({ ok: true, traites: lot.length, resolus, lus: lisibles.length, avec_contact: avecContact });
    }

    // 2 jours par défaut : le recouvrement absorbe le retard d'indexation, un article publié
    // en fin de journée n'étant souvent référencé que le lendemain.
    const jours = Math.min(60, Math.max(1, Number(body.jours ?? 2)));
    const dryRun = body.dry_run === true;
    const depuis = new Date(Date.now() - jours * 86_400_000).toISOString().slice(0, 10);

    // --- 1. Collecte -------------------------------------------------------------
    const parTitre = new Map<string, Brut>();
    const echecs: string[] = [];

    // Articles fournis par l'appelant : Google Actualités refuse les adresses IP des
    // centres de données (Supabase comme Cloudflare), mais répond normalement depuis une
    // connexion ordinaire. La collecte peut donc être faite en amont et postée ici, la
    // fonction gardant son vrai rôle : trier, interpréter, rapprocher, stocker.
    // La source devient ainsi interchangeable — un service de collecte hébergé prendrait
    // le relais sans qu'une ligne de ce qui suit ne change.
    const fournis: any[] = Array.isArray(body.articles) ? body.articles : [];
    for (const a of fournis) {
      const titre = String(a?.titre ?? '').trim();
      const lien = String(a?.url ?? '').trim();
      const publie = String(a?.publie ?? '').slice(0, 10);
      if (!titre || !lien || !/^\d{4}-\d{2}-\d{2}$/.test(publie)) continue;  // pas de date, pas de signal
      if (BRUIT.test(titre) || parTitre.has(titre)) continue;
      parTitre.set(titre, { titre, url: lien, source: String(a?.source ?? '(source inconnue)'), publie });
    }

    for (const lieu of fournis.length ? [] : LIEUX) {
      if (Date.now() - debut > BUDGET_MS) break;
      try {
        for (const b of await interrogerGoogleNews(lieu, depuis)) {
          if (!BRUIT.test(b.titre) && !parTitre.has(b.titre)) parTitre.set(b.titre, b);
        }
      } catch (e) {
        // Ne JAMAIS avaler l'erreur : une collecte vide sans motif est indiagnosticable.
        echecs.push(`${lieu} : ${String((e as any)?.message || e).slice(0, 160)}`);
      }
    }
    if (parTitre.size === 0 && echecs.length) {
      return json({
        error: 'Aucune collecte possible',
        relais: PROXY ? 'utilisé' : 'non configuré (secret GAZETTE_PROXY_URL absent)',
        echecs: echecs.slice(0, 4),
      }, 502);
    }
    const candidats = [...parTitre.values()].sort((a, b) => b.publie.localeCompare(a.publie));

    // Déjà connus : inutile de les repayer à l'IA ni de les redemander à l'utilisateur.
    // On interroge sur les TITRES soumis, jamais sur une fenêtre de dates. Google renvoie
    // des articles bien au-delà de la période demandée : filtrer par date laissait les
    // plus anciens éternellement « inconnus », et la fonction retraitait sans fin les
    // mêmes 35 titres — dix passes pour 35 lignes enregistrées.
    // On lit TOUS les titres déjà enregistrés, page par page. Filtrer par « in » sur les
    // titres soumis échouait silencieusement : ils contiennent virgules, guillemets et
    // parenthèses, que ce type de filtre supporte mal — la fonction retraitait alors
    // indéfiniment les mêmes trente-cinq titres. La table reste modeste (quelques
    // milliers de lignes par an), la lire entièrement est sans conséquence.
    const connus = new Set<string>();
    for (let from = 0; ; from += 1000) {
      const { data: vus, error: eVus } = await admin
        .from('gazette_signaux').select('titre').range(from, from + 999);
      if (eVus) throw eVus;                       // ne jamais avaler : c'est ce qui a coûté deux tours
      for (const r of vus ?? []) connus.add((r as any).titre);
      if (!vus || vus.length < 1000) break;
    }
    const tousNouveaux = candidats.filter((c) => !connus.has(c.titre));
    const nouveaux = tousNouveaux.slice(0, MAX_PAR_APPEL);
    const restants = tousNouveaux.length - nouveaux.length;

    if (nouveaux.length === 0) {
      return json({ ok: true, candidats: candidats.length, nouveaux: 0, retenus: 0, restants_a_traiter: 0, termine: true });
    }

    // --- 2. Tri et interprétation par l'IA ---------------------------------------
    const liste = nouveaux.map((c, i) => `${i}. [${c.publie}] (${c.source}) ${c.titre}`).join('\n');
    const rep = await anthropicJson(ANTHROPIC_KEY, {
      model: MODEL,
      max_tokens: 16000,
      system: PROMPT,
      messages: [{ role: 'user', content: `Titres à trier :\n\n${liste}` }],
    });
    const texte: string = (rep?.content ?? []).find((b: any) => b.type === 'text')?.text ?? '';
    if (!texte) {
      // Sans le corps réel de la réponse, « inexploitable » ne dit rien : modèle refusé,
      // clé invalide, quota, ou format inattendu se ressemblent tous vus d'ici.
      return json({
        error: 'Aucun texte renvoyé par le modèle',
        modele: MODEL,
        stop_reason: rep?.stop_reason ?? null,
        reponse_brute: JSON.stringify(rep ?? {}).slice(0, 500),
        titres_envoyes: nouveaux.length,
      }, 502);
    }
    const brut = texte.replace(/^```(?:json)?/gm, '').replace(/```$/gm, '').trim();
    const debutTab = brut.indexOf('[');
    if (debutTab < 0) {
      return json({ error: 'Réponse IA sans tableau JSON', extrait: brut.slice(0, 300) }, 502);
    }
    // Une réponse tronquée au plafond de jetons reste exploitable : on referme le tableau
    // après le dernier objet COMPLET plutôt que de tout jeter. Perdre le dernier signal
    // d'un lot vaut mieux que perdre le lot entier — c'est ce qui se produisait.
    let corps = brut.slice(debutTab);
    const finTab = corps.lastIndexOf(']');
    let retenus: any[] = [];
    try {
      retenus = JSON.parse(finTab >= 0 ? corps.slice(0, finTab + 1) : corps);
    } catch {
      const dernierObjet = corps.lastIndexOf('}');
      if (dernierObjet < 0) {
        return json({ error: 'Réponse IA inexploitable', extrait: brut.slice(0, 300) }, 502);
      }
      try {
        retenus = JSON.parse(corps.slice(0, dernierObjet + 1) + ']');
      } catch {
        return json({ error: 'Réponse IA illisible même tronquée', extrait: brut.slice(0, 300) }, 502);
      }
    }

    // --- 3. Enregistrement --------------------------------------------------------
    // Résolution des liens en PARALLÈLE et sous contrainte de temps : enchaînée, elle
    // pouvait à elle seule dépasser la limite de 150 s sur une trentaine de signaux.
    // Un lien non résolu reste utilisable — il passe simplement par Google.
    const urls = new Map<string, string>();
    if (!dryRun) {
      const aResoudre = retenus.map((r: any) => nouveaux[Number(r.i)]?.url).filter(Boolean) as string[];
      for (let i = 0; i < aResoudre.length; i += 4) {
        if (Date.now() - debut > BUDGET_MS) break;
        const lot = aResoudre.slice(i, i + 4);
        const res = await Promise.all(lot.map((u) => resoudreUrl(u)));
        lot.forEach((u, k) => urls.set(u, res[k]));
      }
    }

    const lignes = [];
    for (const r of retenus) {
      const src = nouveaux[Number(r.i)];
      if (!src) continue;
      lignes.push({
        publie_le: src.publie,
        source: src.source,
        titre: src.titre,
        url: urls.get(src.url) ?? src.url,
        url_google: src.url,
        commune: r.commune ?? null,
        departement: r.departement ?? null,
        region: r.region ?? null,
        type_lieu: r.type_lieu ?? null,
        evenement: r.evenement ?? null,
        etablissement: r.etablissement ?? null,
        interpretation: r.interpretation ?? null,
        urgence: r.urgence ?? 'moyenne',
        statut: 'nouveau',
      });
    }

    // Les titres ÉCARTÉS sont eux aussi enregistrés, en statut « ignore ». Sans cette
    // trace, ils seraient resoumis à l'IA à chaque passage — coût inutile et progression
    // impossible : la gazette tournerait indéfiniment sur les mêmes titres.
    const indexRetenus = new Set(retenus.map((r: any) => Number(r.i)));
    const ecartes = nouveaux
      .map((n, i) => ({ n, i }))
      .filter(({ i }) => !indexRetenus.has(i))
      .map(({ n }) => ({
        publie_le: n.publie, source: n.source, titre: n.titre,
        url: n.url, url_google: n.url, statut: 'ignore',
      }));

    let inseres = 0;
    if (!dryRun && ecartes.length) {
      await admin.from('gazette_signaux')
        .upsert(ecartes, { onConflict: 'titre', ignoreDuplicates: true });
    }
    if (!dryRun && lignes.length) {
      // onConflict sur l'URL : une même actualité reprise par plusieurs médias ne crée
      // qu'un signal, et un second passage dans la journée n'en duplique aucun.
      const { error, count } = await admin
        .from('gazette_signaux')
        .upsert(lignes, { onConflict: 'titre', ignoreDuplicates: true, count: 'exact' });
      if (error) throw error;
      inseres = count ?? lignes.length;
    }

    return json({
      ok: true, dry_run: dryRun, fenetre_jours: jours, depuis,
      mode: fournis.length ? 'articles fournis' : 'collecte directe',
      candidats: candidats.length,
      echecs_collecte: echecs.length ? echecs.slice(0, 3) : undefined,
      nouveaux: nouveaux.length,
      restants_a_traiter: restants,
      ecartes: ecartes.length,
      retenus: lignes.length,
      inseres,
      taux_retenu: nouveaux.length ? `${Math.round((100 * lignes.length) / nouveaux.length)} %` : '—',
      apercu: lignes.slice(0, 5).map((l) => `${l.publie_le} · ${l.commune ?? '?'} · ${l.titre.slice(0, 70)}`),
      duree_s: Math.round((Date.now() - debut) / 1000),
    });
  } catch (e) {
    console.error(e);
    return json({ error: String((e as any)?.message || e) }, 500);
  }
});
