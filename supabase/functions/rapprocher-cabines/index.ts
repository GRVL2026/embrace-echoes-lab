import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import {
  cle, cleIdentifiante, indexer, indexerParCp, rapprocher, toutLire, type Cible,
} from '../_shared/rapprochement.ts';
import {
  GOUV_RATE_LIMIT_MS, sleep, gouvSearch, extractEnrichissement, pickUnambiguous,
} from '../_shared/gouv-entreprise.ts';

// Les 331 emplacements de cabines photo relevés chez Tabobine, rattachés à ce que nous
// connaissons déjà, puis transformés en fiches prospects exploitables.
//
// CE QUE CES LIEUX SONT, ET CE QU'ILS NE SONT PAS
//
// Ce sont des établissements qui ont DÉJÀ accepté une cabine photo : l'objection de
// principe — « ça n'intéresse pas ma clientèle » — est derrière eux. C'est leur seule
// valeur, et elle est réelle. Mais ils sont équipés par un CONCURRENT : ils ne sont pas
// disponibles dans l'immédiat, et une fiche qui laisserait croire le contraire ferait
// perdre un appel à un commercial. Le signal le dit donc explicitement.
//
// PROXIMITÉ N'EST PAS IDENTITÉ. Une cabine dans la galerie d'un centre commercial est à
// quarante mètres de la salle d'arcade qui y est locataire, sans avoir le moindre lien
// avec elle : deux exploitants, deux interlocuteurs. Le rapprochement exige donc que les
// NOMS concordent aussi, pas seulement les coordonnées.
//
// Actions : « analyse » calcule et ne montre que des chiffres ; « appliquer » écrit les
// rattachements ; « creer-prospects » ouvre les fiches manquantes ; « enrichir » les
// complète via l'API publique des entreprises.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const admin = createClient(SUPABASE_URL, SERVICE_KEY);

const BUDGET_MS = 110_000;   // les edge functions sont coupées à 150 s : rendre la main avant

// Plancher de similarité de nom pour retenir un voisin géographique. Les cabines sont
// en centre-ville : à moins que les deux fiches ne partagent la même adresse au mètre
// près, il faut que les NOMS disent quelque chose. Un tiers de trigrammes communs, c'est
// « Le Rive Gauche » contre « Rive Gauche » — pas « Barapapa » contre « Audenge Vacances ».
const SIM_URBAIN = 0.30;

// ── Segment ───────────────────────────────────────────────────────────────────
// Le profil de ces lieux contredit ce qu'annonce le fabricant : ce ne sont ni des
// bowlings ni des cinémas, mais des bars, des clubs et des galeries commerciales. Un
// segment juste vaut mieux qu'un segment flatteur — c'est lui qui décide du discours.
const SEGMENTS: { motif: RegExp; segment: string }[] = [
  { motif: /\b(centre\s+commercial|c\.?c\.?|galerie|aeroville|carrousel|beaugrenelle|confluence|carre\s+senart|apsys|westfield|shopping)\b/i, segment: 'retail' },
  { motif: /\b(bowling|laser|karting|trampoline|escape|arcade|cinema|patinoire|parc)\b/i, segment: 'loisirs' },
  { motif: /\b(bar|pub|club|brasserie|taverne|cafe|café|bistrot|resto|restaurant|brique|beer|biere|bière|tap|cantine|guinguette|discotheque|comptoir)\b/i, segment: 'chr' },
];

/** À défaut d'indice dans le nom, « chr » : c'est la catégorie majoritaire de cette
 *  source, et se tromper vers le bar est moins coûteux que de ranger un bar en retail. */
function segmentDe(nom: string): string {
  for (const s of SEGMENTS) if (s.motif.test(nom)) return s.segment;
  return 'chr';
}

/** Enseignes présentes plusieurs fois : la décision se prend au siège, pas sur place.
 *  Un commercial qui appelle le gérant d'un 3 Brasseurs perd son temps. */
function reseaux(noms: string[]): Map<string, number> {
  const parCle = new Map<string, number>();
  for (const n of noms) {
    const k = cleIdentifiante(n).split(' ').slice(0, 2).join(' ');
    if (k.length < 4) continue;
    parCle.set(k, (parCle.get(k) ?? 0) + 1);
  }
  return new Map([...parCle].filter(([, n]) => n >= 3));
}

type Cabine = {
  id: string; nom: string; ville: string | null; code_postal: string | null;
  adresse: string | null; lat: number | null; lng: number | null;
  departement: string | null; exploitant: string;
  // État déjà en base. `arbitre_le` non nul signifie qu'un humain a tranché : sa
  // décision prime alors sur tout ce que le calcul peut proposer.
  rapprochement: string | null; arbitre_le: string | null;
};

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

  const debut = Date.now();
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? 'analyse');

    // ── Enrichissement des fiches créées ──────────────────────────────────────
    // L'API publique recherche-entreprises rend le SIRET, le dirigeant, l'effectif, le
    // chiffre d'affaires et l'adresse officielle. Elle est gratuite et ne consomme aucun
    // crédit Pappers. Deux requêtes par seconde : c'est elle qui borne le lot.
    if (action === 'enrichir') {
      const lot = Math.min(120, Math.max(1, Number(body.lot ?? 60)));
      const { data: cibles, error } = await admin.from('prospects')
        .select('id, entreprise, ville, code_postal')
        .eq('source', 'cabine-photo').is('siret', null).is('gouv_tente_at', null)
        .limit(lot);
      if (error) throw error;
      if (!cibles?.length) return json({ ok: true, traites: 0, termine: true });

      let enrichis = 0, ambigus = 0, introuvables = 0, doublonsSiret = 0;
      for (const p of cibles) {
        if (Date.now() - debut > BUDGET_MS) break;
        const requete = [p.entreprise, p.ville].filter(Boolean).join(' ');
        const res = await gouvSearch(requete, 5);
        await sleep(GOUV_RATE_LIMIT_MS);

        // On horodate TOUJOURS, même bredouille : sans cela le même lot reviendrait à
        // chaque appel et les lieux suivants ne seraient jamais tentés.
        const patch: Record<string, unknown> = { gouv_tente_at: new Date().toISOString() };
        if (!res?.length) {
          introuvables++;
        } else {
          const { hit, ambiguous } = pickUnambiguous(res, String(p.entreprise ?? ''));
          if (ambiguous || !hit) {
            ambigus++;
          } else {
            const e = extractEnrichissement(hit);
            // L'ADRESSE RENVOYÉE EST CELLE DU SIÈGE, pas celle du lieu. Pour une chaîne,
            // le siège est à Paris quand la cabine est à Lille : écraser l'adresse
            // relevée enverrait le commercial au mauvais endroit, et ferait chercher le
            // lieu dans le mauvais département lors de l'appariement OpenStreetMap.
            delete (e as Record<string, unknown>).adresse;
            // Une société radiée ne se démarche pas : on garde l'information plutôt que
            // de la taire, le commercial saura qu'il n'y a rien à faire.
            for (const [k, v] of Object.entries(e)) if (v != null && v !== '') patch[k] = v;
            if (hit.siren) patch.siren = String(hit.siren);
            enrichis++;
          }
        }
        let { error: e2 } = await admin.from('prospects').update(patch).eq('id', p.id);
        // Le SIRET est unique en base. Deux établissements d'une même enseigne renvoient
        // le SIÈGE, donc le même SIRET : la seconde écriture viole la contrainte. Ce
        // n'est pas une anomalie, c'est la réalité d'un réseau — on renonce alors au
        // seul SIRET et on conserve tout le reste (dirigeant, effectif, activité),
        // plutôt que de perdre l'enrichissement entier pour cette fiche.
        if (e2 && (e2 as any).code === '23505') {
          const { siret: _siret, siren: _siren, ...sansIdentifiant } = patch as Record<string, unknown>;
          doublonsSiret++;
          ({ error: e2 } = await admin.from('prospects').update(sansIdentifiant).eq('id', p.id));
        }
        if (e2) throw e2;
      }
      const { count: restants } = await admin.from('prospects')
        .select('id', { count: 'exact', head: true })
        .eq('source', 'cabine-photo').is('gouv_tente_at', null);
      return json({ ok: true, traites: cibles.length, enrichis, ambigus, introuvables,
        sieges_partages: doublonsSiret, restants: restants ?? 0 });
    }

    // ── Chargement ────────────────────────────────────────────────────────────
    // On lit aussi le rapprochement STOCKÉ et sa date d'arbitrage : sans eux, le
    // recalcul ignorerait qu'un humain est déjà passé par là.
    const cabines = (await toutLire(admin, 'cabines_photo',
      'id, nom, ville, code_postal, adresse, lat, lng, departement, exploitant, pays,'
      + ' rapprochement, arbitre_le',
    )).filter((c: any) => c.pays === 'FR') as Cabine[];

    const clientsBruts = await toutLire(admin, 'gaia_clients', 'customer_id, name, code_postal, lat, lng');
    const prospectsBruts = await toutLire(admin, 'prospects', 'id, entreprise, ville, code_postal, lat, lng, sources');
    const sallesBrutes = (await toutLire(admin, 'arcade_salles',
      'id, nom, ville, code_postal, lat, lng, ferme')).filter((s: any) => !s.ferme);

    const enCible = (id: string, nom: string, cp: unknown, lat: unknown, lng: unknown): Cible => ({
      id, nom,
      cle: cleIdentifiante(nom),
      cleBrute: cle(nom),
      cp: cp ? String(cp) : null,
      lat: lat != null ? Number(lat) : null,
      lng: lng != null ? Number(lng) : null,
    });

    const clients = clientsBruts.map((c: any) =>
      enCible(String(c.customer_id), String(c.name ?? ''), c.code_postal, c.lat, c.lng));
    const prospects = prospectsBruts.map((p: any) =>
      enCible(String(p.id), String(p.entreprise ?? ''), p.code_postal, p.lat, p.lng));
    const salles = sallesBrutes.map((s: any) =>
      enCible(String(s.id), String(s.nom ?? ''), s.code_postal, s.lat, s.lng));

    const idxClients = indexer(clients), cpClients = indexerParCp(clients);
    const idxProspects = indexer(prospects), cpProspects = indexerParCp(prospects);
    const idxSalles = indexer(salles), cpSalles = indexerParCp(salles);

    const chaines = reseaux(cabines.map((c) => c.nom));

    // ── Verdict par cabine ────────────────────────────────────────────────────
    type Ligne = {
      cabine: Cabine;
      rapprochement: 'client' | 'prospect' | 'a_confirmer' | 'aucun';
      code_client: string | null; prospect_id: string | null; salle_id: string | null;
      motif: string;
    };
    const lignes: Ligne[] = [];

    for (const c of cabines) {
      const lieu = {
        nom: c.nom, cle: cleIdentifiante(c.nom), cleBrute: cle(c.nom),
        lat: c.lat != null ? Number(c.lat) : null,
        lng: c.lng != null ? Number(c.lng) : null,
        cp: c.code_postal,
      };
      // SIM_URBAIN : ces lieux sont en centre-ville, où la proximité ne prouve rien.
      // Sans plancher sur le nom, l'analyse rendait 161 « à confirmer » dont presque
      // tous à 0 % de similarité — un bar messin apparié à un camping à 187 mètres.
      const vClient = rapprocher(lieu, idxClients, cpClients, SIM_URBAIN);
      const vProspect = rapprocher(lieu, idxProspects, cpProspects, SIM_URBAIN);
      const vSalle = rapprocher(lieu, idxSalles, cpSalles, SIM_URBAIN);

      // La salle d'arcade n'emporte JAMAIS la décision à elle seule : elle enrichit un
      // rattachement, elle ne le crée pas. C'est le garde-fou contre la coïncidence de
      // galerie marchande, où deux commerces voisins n'ont rien à voir l'un avec l'autre.
      const salle_id = vSalle?.niveau === 'sur' ? vSalle.cible.id : null;

      // Un client existant prime sur un prospect : c'est la relation la plus établie.
      if (vClient?.niveau === 'sur') {
        lignes.push({ cabine: c, rapprochement: 'client', code_client: vClient.cible.id,
          prospect_id: null, salle_id, motif: `client ${vClient.cible.nom} — ${vClient.motif}` });
      } else if (vProspect?.niveau === 'sur') {
        lignes.push({ cabine: c, rapprochement: 'prospect', code_client: null,
          prospect_id: vProspect.cible.id, salle_id, motif: `prospect ${vProspect.cible.nom} — ${vProspect.motif}` });
      } else if (vClient?.niveau === 'doute' || vProspect?.niveau === 'doute') {
        const v = (vClient?.score ?? 0) >= (vProspect?.score ?? 0) ? vClient! : vProspect!;
        const estClient = v === vClient;
        lignes.push({ cabine: c, rapprochement: 'a_confirmer',
          code_client: estClient ? v.cible.id : null,
          prospect_id: estClient ? null : v.cible.id,
          salle_id, motif: `à confirmer : ${v.cible.nom} — ${v.motif}` });
      } else {
        lignes.push({ cabine: c, rapprochement: 'aucun', code_client: null,
          prospect_id: null, salle_id, motif: 'aucun rapprochement' });
      }
    }

    // L'état qui fait foi : la décision humaine si elle existe, le calcul sinon. Les
    // comptes rendus s'appuient dessus, sinon ils annonceraient onze arbitrages en
    // attente alors que cinq sont tranchés — et on croirait le travail non fait.
    const etatRetenu = (l: Ligne) =>
      l.cabine.arbitre_le ? (l.cabine.rapprochement ?? 'aucun') : l.rapprochement;

    const compte = (r: string) => lignes.filter((l) => etatRetenu(l) === r).length;
    const resume = {
      arbitres: lignes.filter((l) => l.cabine.arbitre_le).length,
      cabines: cabines.length,
      client: compte('client'),
      prospect: compte('prospect'),
      a_confirmer: compte('a_confirmer'),
      aucun: compte('aucun'),
      avec_salle_arcade: lignes.filter((l) => l.salle_id).length,
      reseaux: [...chaines.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ×${n}`),
    };

    if (action === 'analyse') {
      return json({ ok: true, mode: 'analyse', ...resume,
        exemples: lignes.filter((l) => l.rapprochement !== 'aucun').slice(0, 12)
          .map((l) => `${l.cabine.nom} (${l.cabine.ville ?? '?'}) → ${l.motif}`) });
    }

    // ── Écriture des rattachements ────────────────────────────────────────────
    if (action === 'appliquer') {
      let ecrits = 0, respectes = 0;
      for (const l of lignes) {
        if (Date.now() - debut > BUDGET_MS) break;
        // CE QU'UN HUMAIN A TRANCHÉ NE SE RECALCULE PAS. Le filtre est dans le WHERE
        // plutôt que dans une condition JavaScript : ainsi une ligne arbitrée entre le
        // calcul et l'écriture — la boucle dure plusieurs secondes — est protégée elle
        // aussi. Sans cela, les rejets du 10 août disparaissaient au premier
        // relancement, sans le moindre avertissement.
        const { data, error } = await admin.from('cabines_photo').update({
          rapprochement: l.rapprochement,
          code_client: l.code_client,
          prospect_id: l.prospect_id,
          salle_id: l.salle_id,
        }).eq('id', l.cabine.id).is('arbitre_le', null).select('id');
        if (error) throw error;
        if (data?.length) ecrits++; else respectes++;
      }
      return json({ ok: true, ...resume, ecrits, arbitrages_respectes: respectes });
    }

    // ── Création des fiches manquantes ────────────────────────────────────────
    if (action === 'creer-prospects' || action === 'creer-prospects-analyse') {
      const sec = action === 'creer-prospects-analyse';

      // Dédoublonnage par empreinte : la même colonne calculée existe des deux côtés,
      // donc un lieu déjà présent sous un autre libellé ne sera pas recréé.
      const dejaLa = new Set(
        prospectsBruts.map((p: any) => `${cleIdentifiante(p.entreprise)}|${cle(p.ville ?? '')}`),
      );

      // etatRetenu fait foi ici aussi : les cinq galeries rejetées à la main restaient
      // « à confirmer » aux yeux du recalcul, donc n'obtenaient jamais leur fiche —
      // alors qu'un exploitant de galerie est un interlocuteur à part entière,
      // distinct de ses locataires, et mérite la sienne.
      const aCreer = lignes
        .filter((l) => etatRetenu(l) === 'aucun')
        .filter((l) => !dejaLa.has(`${cleIdentifiante(l.cabine.nom)}|${cle(l.cabine.ville ?? '')}`));

      // Deux relevés d'un même établissement (deux cabines dans la même galerie) ne
      // doivent donner qu'une fiche.
      const vus = new Set<string>();
      const uniques = aCreer.filter((l) => {
        const k = `${cleIdentifiante(l.cabine.nom)}|${cle(l.cabine.ville ?? '')}`;
        if (vus.has(k)) return false;
        vus.add(k);
        return true;
      });

      const fiches = uniques.map((l) => {
        const c = l.cabine;
        const k = cleIdentifiante(c.nom).split(' ').slice(0, 2).join(' ');
        const reseau = chaines.get(k);
        return {
          entreprise: c.nom,
          ville: c.ville,
          code_postal: c.code_postal,
          adresse: [c.adresse, c.code_postal, c.ville].filter(Boolean).join(' ') || null,
          lat: c.lat, lng: c.lng,
          geocoded_at: c.lat != null ? new Date().toISOString() : null,
          geocode_source: c.lat != null ? 'api-adresse' : null,
          segment: segmentDe(c.nom),
          source: 'cabine-photo',
          sources: ['cabine-photo'],
          statut: 'nouveau',
          groupe: reseau ? k : null,
          // Le signal est ce que lit le commercial en premier. Il dit l'atout — le lieu
          // a déjà dit oui à une cabine — ET la contrainte : elle est posée par un
          // concurrent, donc l'échéance est un renouvellement, pas une vente immédiate.
          signal: `Accueille déjà une cabine photo ${c.exploitant} (relevé public, 7 août 2026). `
            + `Établissement acquis au principe de la cabine, mais équipé par un concurrent : `
            + `l'angle est la comparaison et le renouvellement, pas l'installation.`
            + (reseau ? ` Enseigne présente ${reseau} fois dans ce relevé — décision probablement au siège.` : ''),
        };
      });

      if (sec) {
        return json({ ok: true, mode: 'analyse', ...resume,
          a_creer: fiches.length,
          deja_en_fiche: compte('aucun') - aCreer.length,   // même lieu déjà prospect sous un autre libellé
          doublons_du_releve: aCreer.length - fiches.length, // deux cabines dans le même établissement
          par_segment: fiches.reduce((acc: Record<string, number>, f) => {
            acc[f.segment] = (acc[f.segment] ?? 0) + 1; return acc;
          }, {}),
          apercu: fiches.slice(0, 10).map((f) => `${f.entreprise} · ${f.ville ?? '?'} · ${f.segment}`) });
      }

      let crees = 0;
      for (let i = 0; i < fiches.length; i += 100) {
        if (Date.now() - debut > BUDGET_MS) break;
        const { data, error } = await admin.from('prospects')
          .insert(fiches.slice(i, i + 100)).select('id, entreprise, ville');
        if (error) throw error;
        crees += data?.length ?? 0;

        // Rattacher la cabine à la fiche qu'elle vient de faire naître : sans ce lien,
        // le point de la carte reste orphelin et affiche « fiche non retrouvée ».
        for (const p of data ?? []) {
          const k = `${cleIdentifiante(p.entreprise)}|${cle(p.ville ?? '')}`;
          const ids = lignes
            .filter((l) => l.rapprochement === 'aucun'
              && `${cleIdentifiante(l.cabine.nom)}|${cle(l.cabine.ville ?? '')}` === k)
            .map((l) => l.cabine.id);
          if (!ids.length) continue;
          const { error: e2 } = await admin.from('cabines_photo')
            .update({ prospect_id: p.id, rapprochement: 'prospect' }).in('id', ids);
          if (e2) throw e2;
        }
      }
      return json({ ok: true, ...resume, crees, candidats: fiches.length });
    }

    return json({ error: `Action inconnue : ${action}` }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
