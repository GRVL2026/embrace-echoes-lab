import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

// Rapprochement de l'annuaire arcade avec l'existant. C'est le cœur du sujet : sans
// lui, 939 lieux et 7 800 machines vivent à côté du reste sans rien enrichir.
//
// TROIS RAPPROCHEMENTS, TROIS MÉTHODES DIFFÉRENTES
//
// 1. Salle → client Cegid, et salle → prospect. La GÉOGRAPHIE prime sur le nom :
//    Cegid porte la raison sociale (« SARL LOISIRS 55 ») là où l'annuaire porte
//    l'enseigne (« 10.55 »), et le rapprochement par nom seul ne trouvait que 5 %.
//    Deux établissements à moins de cent mètres sont presque toujours le même lieu.
//
// 2. Machine → catalogue. Les noms SHOPIFY sont la bonne référence : mesuré à 83 %
//    de correspondance contre 11 % pour les codes Cegid, qui sont conçus pour la
//    facturation et non pour être reconnus. Shopify porte en outre le FABRICANT,
//    qui permet de classer une machine dans notre périmètre sans dépendre du nom.
//
// RIEN N'EST ÉCRIT SANS AVOIR ÉTÉ MONTRÉ. L'action « analyse » calcule tout et ne
// renvoie que des chiffres et des exemples ; « appliquer » écrit. Un rapprochement
// douteux n'est jamais fusionné : il devient « a_confirmer » et attend un arbitrage.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const SHOPIFY_TOKEN = Deno.env.get('SHOPIFY_ACCESS_TOKEN') || '';
const SHOPIFY_STORE = 'zhx0nb-11.myshopify.com';
const admin = createClient(SUPABASE_URL, SERVICE_KEY);

// Seuils. Cent mètres, c'est la précision d'un géocodage à l'adresse : au-delà on
// n'est plus sûr, en deçà c'est le même bâtiment. Quatre cents mètres reste plausible
// dans une zone commerciale, mais demande un œil humain.
// Distance et nom se corroborent : un nom franc autorise une adresse approximative,
// une adresse exacte n'autorise PAS n'importe quel nom. « Magic Games » et « Games
// Over » à treize mètres restent deux enseignes, pas une.
const D_MAX = 600;          // au-delà, ce n'est plus le même établissement
const D_PROCHE = 150;
const SIM_FRANC = 0.50;     // le nom suffit à confirmer, même à quelques rues
const SIM_APPUI = 0.35;     // le nom appuie une adresse déjà proche
const SIM_DOUTE = 0.30;

// ── Outils ────────────────────────────────────────────────────────────────────
const sansAccent = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

function cle(s: string | null | undefined): string {
  return sansAccent((s ?? '').toLowerCase()).replace(/[^a-z0-9]+/g, ' ').trim();
}

// Le type d'établissement et les articles ne distinguent rien : « Camping Le Ranch des
// Volcans » et « LE RANCH DES VOLCANS » désignent le même lieu, mais le mot « camping »
// à lui seul faisait chuter la similarité de 90 % à 67 % — assez pour rater le
// rapprochement. On compare ce qui identifie, pas ce qui catégorise.
const MOTS_VIDES = new Set([
  'camping', 'bowling', 'hotel', 'restaurant', 'bar', 'laser', 'game', 'games',
  'club', 'parc', 'park', 'centre', 'complexe', 'salle', 'village', 'vacances',
  'domaine', 'residence', 'sarl', 'sas', 'sasu', 'sa', 'eurl', 'scea', 'ste', 'societe',
  'le', 'la', 'les', 'l', 'de', 'du', 'des', 'd', 'et', 'aux', 'au', 'a',
]);

function cleIdentifiante(s: string | null | undefined): string {
  const mots = cle(s).split(' ').filter((m) => m && !MOTS_VIDES.has(m));
  // Si tout a été retiré — « Le Camping » — on retombe sur le nom complet plutôt que
  // de comparer deux chaînes vides, qui se ressembleraient parfaitement.
  return mots.length ? mots.join(' ') : cle(s);
}

/** Similarité par trigrammes, même principe que pg_trgm : proportion de trigrammes
 *  communs. Recalculée ici parce que le rapprochement se fait en mémoire. */
function similarite(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const tri = (s: string) => {
    const p = `  ${s} `;
    const out = new Set<string>();
    for (let i = 0; i < p.length - 2; i++) out.add(p.slice(i, i + 3));
    return out;
  };
  const A = tri(a), B = tri(b);
  let communs = 0;
  for (const t of A) if (B.has(t)) communs++;
  return communs / (A.size + B.size - communs);
}

/** Distance approchée en mètres. La projection plate suffit largement à l'échelle
 *  d'une commune, et évite une extension géographique pour trois décimales. */
function metres(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = (lat1 - lat2) * 111_320;
  const dLng = (lng1 - lng2) * 111_320 * Math.cos((lat1 * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

type Cible = {
  id: string; nom: string; cle: string;
  lat: number | null; lng: number | null; cp: string | null;
};

/** Index par centième de degré : chercher le voisin le plus proche sans parcourir
 *  dix mille lignes pour chacune des neuf cents salles. */
function indexer(cibles: Cible[]) {
  const grille = new Map<string, Cible[]>();
  for (const c of cibles) {
    if (c.lat === null || c.lng === null) continue;
    const k = `${Math.round(c.lat * 100)}:${Math.round(c.lng * 100)}`;
    const l = grille.get(k);
    if (l) l.push(c); else grille.set(k, [c]);
  }
  return grille;
}

function voisins(grille: Map<string, Cible[]>, lat: number, lng: number): Cible[] {
  const out: Cible[] = [];
  const li = Math.round(lat * 100), gi = Math.round(lng * 100);
  for (let a = -1; a <= 1; a++) {
    for (let b = -1; b <= 1; b++) {
      const c = grille.get(`${li + a}:${gi + b}`);
      if (c) out.push(...c);
    }
  }
  return out;
}

type Verdict = { cible: Cible; niveau: 'sur' | 'doute'; motif: string; score: number } | null;

function rapprocher(
  salle: { nom: string | null; cle: string; lat: number | null; lng: number | null; cp: string | null },
  grille: Map<string, Cible[]>,
  parCp: Map<string, Cible[]>,
): Verdict {
  let meilleur: Verdict = null;

  // La géographie d'abord : elle ne dépend d'aucune convention de nommage.
  if (salle.lat !== null && salle.lng !== null) {
    for (const c of voisins(grille, salle.lat, salle.lng)) {
      const d = metres(salle.lat, salle.lng, c.lat!, c.lng!);
      if (d > D_MAX) continue;
      const sim = similarite(salle.cle, c.cle);
      const niveau: 'sur' | 'doute' =
        (sim >= SIM_FRANC && d <= D_MAX) || (sim >= SIM_APPUI && d <= D_PROCHE) ? 'sur' : 'doute';
      const score = sim * 600 + Math.max(0, 600 - d);
      if (!meilleur || score > meilleur.score) {
        meilleur = { cible: c, niveau, motif: `${Math.round(d)} m, nom ${Math.round(sim * 100)} %`, score };
      }
    }
  }
  if (meilleur?.niveau === 'sur') return meilleur;

  // À défaut, le code postal et le nom.
  if (salle.cp) {
    for (const c of parCp.get(salle.cp) ?? []) {
      const sim = similarite(salle.cle, c.cle);
      if (sim < SIM_DOUTE) continue;
      const niveau: 'sur' | 'doute' = sim >= 0.65 ? 'sur' : 'doute';
      const score = sim * 1000;
      if (!meilleur || (niveau === 'sur' && meilleur.niveau === 'doute') || score > meilleur.score) {
        meilleur = { cible: c, niveau, motif: `même code postal, nom ${Math.round(sim * 100)} %`, score };
      }
    }
  }
  return meilleur;
}

// ── Catalogue Shopify ─────────────────────────────────────────────────────────
type Produit = { titre: string; cle: string; fabricant: string | null; type: string | null };

async function catalogueShopify(): Promise<Produit[]> {
  if (!SHOPIFY_TOKEN) return [];
  const out: Produit[] = [];
  let url: string | null =
    `https://${SHOPIFY_STORE}/admin/api/2025-01/products.json?limit=250&fields=title,vendor,product_type`;
  for (let page = 0; url && page < 12; page++) {
    const res: Response = await fetch(url, {
      headers: { 'X-Shopify-Access-Token': SHOPIFY_TOKEN, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) { res.body?.cancel(); break; }
    const j = await res.json();
    for (const p of j.products ?? []) {
      // « Flipper Godzilla Pro » → « godzilla ». Le préfixe de gamme et la finition
      // ne distinguent pas le modèle, ils distinguent la référence commerciale.
      const brut = String(p.title ?? '');
      const k = cle(brut)
        .replace(/^(flipper|borne|jeu|machine)\s+/i, '')
        .replace(/\b(pro|premium|pre|le|limited|edition|deluxe|dlx|dx|sd|std|twin|single|remastered|remaster|anniversary|\d{2}th)\b/g, ' ')
        .replace(/\s+/g, ' ').trim();
      if (k.length >= 3) out.push({ titre: brut, cle: k, fabricant: p.vendor ?? null, type: p.product_type ?? null });
    }
    const lien = res.headers.get('link') || '';
    const suivant = lien.match(/<([^>]+)>;\s*rel="next"/);
    url = suivant ? suivant[1] : null;
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  const isCron = !!CRON_SECRET && (req.headers.get('x-cron-secret') || '') === CRON_SECRET;
  if (!isCron) {
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer /, '');
    if (!jwt) return json({ error: 'Unauthorized' }, 401);
    const { data: u } = await admin.auth.getUser(jwt);
    if (!u?.user) return json({ error: 'Unauthorized' }, 401);
    const { data: roles } = await admin.from('user_roles').select('role').eq('user_id', u.user.id);
    if (!(roles || []).some((r: any) => r.role === 'admin' || r.role === 'direction'))
      return json({ error: 'Forbidden' }, 403);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const ecrire = body.action === 'appliquer';

    const tout = async (table: string, colonnes: string, filtre?: (q: any) => any) => {
      const acc: any[] = [];
      for (let de = 0; ; de += 1000) {
        let q = admin.from(table).select(colonnes).range(de, de + 999);
        if (filtre) q = filtre(q);
        const { data, error } = await q;
        if (error) throw error;
        acc.push(...(data ?? []));
        if (!data || data.length < 1000) break;
      }
      return acc;
    };

    // ── Chargement ────────────────────────────────────────────────────────────
    const salles = await tout('arcade_salles', 'id, slug, nom, ville, code_postal, lat, lng, prospect_id, code_client');
    const clients = await tout('gaia_clients', 'customer_id, name, code_postal, lat, lng');
    const prospects = await tout('prospects', 'id, entreprise, ville, code_postal, lat, lng, sources');

    const versCible = (r: any, idc: string, nomc: string): Cible => ({
      id: String(r[idc]), nom: String(r[nomc] ?? ''), cle: cleIdentifiante(r[nomc]),
      lat: r.lat === null ? null : Number(r.lat), lng: r.lng === null ? null : Number(r.lng),
      cp: r.code_postal ?? null,
    });
    const cClients = clients.map((r) => versCible(r, 'customer_id', 'name'));
    const cProspects = prospects.map((r) => versCible(r, 'id', 'entreprise'));

    const grilleC = indexer(cClients), grilleP = indexer(cProspects);
    const cpC = new Map<string, Cible[]>(), cpP = new Map<string, Cible[]>();
    const ranger = (m: Map<string, Cible[]>, c: Cible) => {
      if (!c.cp) return;
      const l = m.get(c.cp);
      if (l) l.push(c); else m.set(c.cp, [c]);
    };
    for (const c of cClients) ranger(cpC, c);
    for (const c of cProspects) ranger(cpP, c);

    // ── Rapprochement des lieux ───────────────────────────────────────────────
    const majSalles: any[] = [];
    const compte = { client: 0, prospect: 0, a_confirmer: 0, aucun: 0 };
    const exemples: string[] = [];

    for (const s of salles) {
      const sc = {
        nom: s.nom, cle: cleIdentifiante(s.nom),
        lat: s.lat === null ? null : Number(s.lat),
        lng: s.lng === null ? null : Number(s.lng),
        cp: s.code_postal ?? null,
      };
      const vc = rapprocher(sc, grilleC, cpC);
      const vp = rapprocher(sc, grilleP, cpP);

      // Un client prime toujours sur un prospect : la relation commerciale existante
      // est une certitude, la piste ne l'est pas.
      let ligne: any = { slug: s.slug, fiche_url: `https://www.annuaire-arcade.fr/salle-arcade/${s.slug}/` };
      if (vc?.niveau === 'sur') {
        ligne = { ...ligne, code_client: vc.cible.id, prospect_id: null, rapprochement: 'client' };
        compte.client++;
        if (exemples.length < 12) exemples.push(`CLIENT · ${s.nom} → ${vc.cible.nom} (${vc.motif})`);
      } else if (vp?.niveau === 'sur') {
        ligne = { ...ligne, prospect_id: vp.cible.id, code_client: null, rapprochement: 'prospect' };
        compte.prospect++;
        if (exemples.length < 12) exemples.push(`PROSPECT · ${s.nom} → ${vp.cible.nom} (${vp.motif})`);
      } else if (vc || vp) {
        const v = (vc?.score ?? 0) >= (vp?.score ?? 0) ? vc! : vp!;
        ligne = { ...ligne, rapprochement: 'a_confirmer' };
        compte.a_confirmer++;
        if (exemples.length < 12) exemples.push(`À CONFIRMER · ${s.nom} → ${v.cible.nom} (${v.motif})`);
      } else {
        ligne = { ...ligne, rapprochement: 'aucun', prospect_id: null, code_client: null };
        compte.aucun++;
      }
      majSalles.push(ligne);
    }

    // ── Rapprochement des machines ────────────────────────────────────────────
    const machines = await tout('arcade_machines', 'slug, nom, categorie, editeur');
    const produits = await catalogueShopify();
    const erp = await tout('catalogue_erp', 'code, description, famille',
      (q) => q.in('famille', ['Flippers', 'Tirs', 'Conduites', 'Grues', "Jeux d'adresse",
        'Jeux de café', 'Enfant', 'Occasion']));

    const erpCles = erp.map((r: any) => ({
      code: r.code, description: r.description, famille: r.famille,
      cle: cle(String(r.description).replace(/^(JV|FL|BA|BI|JB|JF)[A-Z0-9]{0,3}\s*-\s*/i, ''))
        .replace(/\b(pro|premium|pre|le|dx|sd|std|twin|single|dlx|deluxe|edition|limited|classic|version|occ|pl|players?|motion|black|red|neuf)\b/g, ' ')
        .replace(/\s+/g, ' ').trim(),
    }));

    const fabricantsMaison = new Set(produits.map((p) => cle(p.fabricant)).filter(Boolean));
    const majMachines: any[] = [];
    const cm = { exacte: 0, marque: 0, a_confirmer: 0, aucune: 0 };
    const exMachines: string[] = [];

    for (const m of machines) {
      const k = cle(m.nom);
      let corr: string = 'aucune', code: string | null = null, famille: string | null = null, note = '';
      const flipper = m.categorie === 'flipper';

      // Un nom de deux ou trois caractères — « DX », résidu d'extraction — ne désigne
      // aucune machine et se rapprocherait de n'importe quoi.
      if (k.length < 4) {
        cm.aucune++;
        majMachines.push({ slug: m.slug, nom: m.nom, code_article: null, famille_aa: null,
          correspondance: 'aucune', correspondance_par: 'auto' });
        continue;
      }

      // La contrainte de catégorie vaut AUSSI côté Shopify. Sans elle, « Jurassic Park
      // Arcade » — rail shooter de Raw Thrills — se rapprochait du flipper Stern du
      // même nom. Même faute que le Taxi de Williams contre la grue Taxi Crane, entrée
      // par une autre porte.
      const memeCategorie = (p: Produit) =>
        flipper ? /flipper/i.test(p.type ?? '') || /flipper/i.test(p.titre)
                : !/flipper/i.test(p.type ?? '') && !/^flipper\b/i.test(p.titre);
      const eligibles = produits.filter(memeCategorie);
      const pShop = eligibles.find((p) => p.cle === k)
        ?? eligibles.find((p) => p.cle && (p.cle.startsWith(k + ' ') || k.startsWith(p.cle + ' ')));
      if (pShop) {
        corr = 'exacte'; note = `Shopify : ${pShop.titre}`;
      } else {
        const candidats = erpCles.filter((e) =>
          flipper ? /^FL/i.test(e.code) || e.famille === 'Flippers'
                  : !/^FL/i.test(e.code) && e.famille !== 'Flippers');
        const exact = candidats.find((e) => e.cle === k);
        if (exact) {
          corr = 'exacte'; code = exact.code; famille = exact.famille; note = exact.description;
        } else {
          const proche = candidats.find((e) => e.cle && (e.cle.startsWith(k + ' ') || k.startsWith(e.cle + ' ')));
          if (proche) {
            corr = 'a_confirmer'; code = proche.code; famille = proche.famille; note = proche.description;
          } else if (m.editeur && fabricantsMaison.has(cle(m.editeur))) {
            corr = 'marque'; note = `fabricant distribué : ${m.editeur}`;
          }
        }
      }
      cm[corr as keyof typeof cm]++;
      if (corr !== 'aucune' && exMachines.length < 12) exMachines.push(`${m.nom} → ${corr} · ${note}`);
      majMachines.push({
        slug: m.slug, nom: m.nom,
        code_article: code, famille_aa: famille,
        correspondance: corr, correspondance_par: 'auto',
      });
    }

    if (!ecrire) {
      return json({
        ok: true, mode: 'analyse — rien n\'a été écrit',
        lieux: { total: salles.length, ...compte },
        machines: { total: machines.length, ...cm, references_shopify: produits.length },
        exemples_lieux: exemples,
        exemples_machines: exMachines,
      });
    }

    for (let i = 0; i < majSalles.length; i += 200) {
      const { error } = await admin.from('arcade_salles')
        .upsert(majSalles.slice(i, i + 200), { onConflict: 'slug' });
      if (error) throw error;
    }
    for (let i = 0; i < majMachines.length; i += 200) {
      const { error } = await admin.from('arcade_machines')
        .upsert(majMachines.slice(i, i + 200), { onConflict: 'slug' });
      if (error) throw error;
    }

    // La source « annuaire arcade » s'ajoute aux prospects reconnus, sans écraser les
    // précédentes : un lieu trouvé par plusieurs chemins est une fiche plus solide.
    const idsProspects = majSalles.filter((l) => l.prospect_id).map((l) => l.prospect_id);
    let sourcesAjoutees = 0;
    for (const p of prospects) {
      if (!idsProspects.includes(p.id)) continue;
      const src: string[] = Array.isArray(p.sources) ? p.sources : [];
      if (src.includes('annuaire-arcade')) continue;
      const { error } = await admin.from('prospects')
        .update({ sources: [...src, 'annuaire-arcade'] }).eq('id', p.id);
      if (error) throw error;
      sourcesAjoutees++;
    }

    return json({
      ok: true, mode: 'appliqué',
      lieux: { total: salles.length, ...compte },
      machines: { total: machines.length, ...cm },
      sources_prospects_ajoutees: sourcesAjoutees,
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
