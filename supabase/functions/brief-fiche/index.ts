import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { anthropicJson } from '../_shared/anthropic-fetch.ts';

// Le brief d'une fiche : ce que le commercial doit savoir avant de décrocher.
//
// DEUX COUCHES, ET LA SÉPARATION EST LE CŒUR DU SUJET.
//
// Les FAITS sont calculés en base : parc installé, familles absentes,
// facturation, signaux de presse. Exacts, instantanés, gratuits. Ils constituent
// l'essentiel de la valeur et ne passent jamais par un modèle.
//
// L'INTERPRÉTATION est écrite par l'IA à partir de ces seuls faits. Elle ne va rien
// chercher ailleurs et n'a pas le droit d'ajouter une information : son travail est de
// dire ce que les faits impliquent, pas d'en inventer.
//
// LA PRUDENCE EST UNE RÈGLE, PAS UN STYLE. L'historique de ventes ne remonte qu'à
// décembre 2024 et l'annuaire dit ce qui est installé, pas qui l'a vendu. Un brief qui
// affirme au-delà de ça est abandonné au troisième appel, et avec lui tout l'outil.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const MODEL = 'claude-sonnet-5';
const admin = createClient(SUPABASE_URL, SERVICE_KEY);

// Début de l'historique de facturation. Écrit une fois ici : toute phrase du brief qui
// parle d'absence d'achat doit porter cette date, sinon elle ment par omission.
const DEBUT_VENTES = '2024-12-02';

// Du genre de l'annuaire vers nos familles de catalogue. C'est ce qui permet de passer
// de « il lui manque un flipper » à « ses huit rail shooters sont tous hors de notre
// catalogue, voici les nôtres ». Les genres sans équivalent chez nous — combat 2D,
// beat'em up, plateforme, les bornes rétro en général — sont volontairement absents :
// proposer un produit qu'on ne vend pas décrédibilise tout le reste du brief.
const GENRE_VERS_FAMILLE: Record<string, string> = {
  'rail shooter': 'Tirs', 'rail shooter vr': 'Tirs', 'shoot em up': 'Tirs',
  'shoot': 'Tirs', 'run and gun': 'Tirs', 'action': 'Tirs',
  'course auto': 'Conduites', 'course': 'Conduites', 'course moto': 'Conduites',
  'course jet ski / bateaux': 'Conduites', 'combat motorisé': 'Conduites',
  'simulateur de mouvement': 'Conduites', 'simulateur de mouvement vr': 'Conduites',
  'simulateur de vol': 'Conduites', 'motion gaming': 'Conduites',
  'pour enfant': 'Enfant',
  'rythme': "Jeux d'adresse", 'danse': "Jeux d'adresse", 'basket': "Jeux d'adresse",
  'labyrinthe': "Jeux d'adresse", 'puzzle': "Jeux d'adresse", 'sport': "Jeux d'adresse",
};

const PROMPT = `Tu écris le brief qu'un commercial d'Avranches Automatic lit avant d'appeler un établissement. Avranches Automatic distribue des flippers (revendeur officiel Stern), jeux d'arcade, billards, baby-foot, grues et distributeurs automatiques.

Tu reçois des FAITS vérifiés. Tu n'as le droit d'utiliser QUE ces faits.

FORMAT — trois parties courtes, en Markdown, 120 mots maximum au total :
1. Une phrase qui situe l'établissement et son parc.
2. Ce qui saute aux yeux. Deux constats au plus, les plus actionnables. Si « absent_chez_lui_courant_ailleurs » existe, c'est le constat le plus fort : dis-le avec le chiffre de comparaison — « aucun flipper, alors que 73 % des bowlings de cette taille en ont un ». Un manque comparé à ses semblables se discute ; un manque affirmé dans l'absolu se conteste.
3. **À faire** : une à trois actions concrètes, à l'impératif, chacune sur une ligne. Quand « hors_catalogue_par_genre » existe, au moins une action doit proposer NOMMÉMENT une ou deux références de « notre_offre_dans_ces_genres » correspondant au genre le plus représenté. Un lieu qui possède huit jeux de tir qu'aucun de nos fournisseurs ne fabrique est un lieu qui aime les jeux de tir : c'est le meilleur angle possible, bien plus fort qu'une famille absente.

RÈGLES ABSOLUES
- Ne propose QUE des références figurant dans « notre_offre_dans_ces_genres ». N'invente jamais un nom de produit : un commercial qui cite une référence inexistante devant un client perd la partie sur-le-champ.
- N'INVENTE AUCUN CHIFFRE ni aucun fait. Si une information manque, ne la mentionne pas.
- Ne dis JAMAIS « il n'a rien acheté chez nous ». Dis « aucune facture depuis ${DEBUT_VENTES}, notre historique ne remonte pas plus loin ».
- N'utilise JAMAIS l'année d'un modèle pour parler de l'âge du parc : l'annuaire donne l'année de SORTIE du jeu, pas celle de son achat. Un lieu peut avoir acquis d'occasion un modèle de 2013. Cette donnée ne t'est plus transmise, ne la réclame pas.
- Ne conclus JAMAIS d'une absence non signalée dans « absent_chez_lui_courant_ailleurs ». L'annuaire ne recense qu'un billard, un baby-foot et quatre grues pour cent quatre-vingt-quatre flippers : leur absence dans les données ne prouve rien, et ces familles ont été écartées de la comparaison pour cette raison.
- Ne dis JAMAIS qu'une machine installée vient de chez nous : l'annuaire dit ce qui est sur place, pas qui l'a livré. Tu peux dire qu'elle relève de notre catalogue.
- Un établissement d'un réseau (Buffalo Grill, CGR…) se décide au siège : signale-le au lieu de proposer un démarchage local isolé.
- Pas de formule de politesse, pas d'introduction. Le commercial lit trois lignes entre deux appels.`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  // Le secret des tâches planifiées est accepté au même titre qu'une session : il
  // permet de pré-générer les briefs du matin en lot, et de diagnostiquer la fonction
  // sans dépendre d'un navigateur connecté.
  const isCron = !!CRON_SECRET && (req.headers.get('x-cron-secret') || '') === CRON_SECRET;
  let auteur: string | null = null;
  if (!isCron) {
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer /, '');
    if (!jwt) return json({ error: 'Unauthorized' }, 401);
    const { data: u } = await admin.auth.getUser(jwt);
    if (!u?.user) return json({ error: 'Unauthorized' }, 401);
    auteur = u.user.id;
  }

  try {
    const body = await req.json().catch(() => ({}));
    const prospectId: string | null = body.prospect_id ?? null;
    const codeClient: string | null = body.code_client ?? null;
    if (!prospectId && !codeClient) return json({ error: 'prospect_id ou code_client requis' }, 400);

    const cibleType = prospectId ? 'prospect' : 'client';
    const cibleId = prospectId ?? codeClient!;

    // ── Les faits ─────────────────────────────────────────────────────────────
    const faits: Record<string, unknown> = {};

    if (prospectId) {
      const { data: p, error } = await admin.from('prospects')
        .select('entreprise, ville, code_postal, segment, tag, groupe, statut, contact_nom, contact_role, signal, sources, etoiles, capacite, effectif, ca_annuel, site_web')
        .eq('id', prospectId).maybeSingle();
      if (error) throw error;
      if (!p) return json({ error: 'Prospect introuvable' }, 404);
      faits.prospect = p;
    } else {
      const { data: c } = await admin.from('gaia_clients')
        .select('name, ville, code_postal, typologie, status, telephone, email')
        .eq('customer_id', codeClient).maybeSingle();
      faits.client = c ?? { customer_id: codeClient };

      // Facturation sur douze mois glissants, et date de la dernière commande.
      const depuis = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
      const { data: v } = await admin.from('gaia_ventes')
        .select('invoice_date, montant_ht, code_article')
        .eq('code_client', codeClient).gte('invoice_date', depuis).limit(2000);
      const lignes = v ?? [];
      faits.facturation = {
        depuis_le: DEBUT_VENTES,
        ca_12_mois: Math.round(lignes.reduce((n, l: any) => n + Number(l.montant_ht ?? 0), 0)),
        nb_lignes: lignes.length,
        derniere_facture: lignes.map((l: any) => l.invoice_date).sort().at(-1) ?? null,
      };
    }

    // Le parc installé, quelle que soit la nature de la cible.
    const { data: salles } = await admin.from('arcade_salles')
      .select('id, nom, ville, type_lieu, prestations, fiche_lue_at')
      .or(prospectId ? `prospect_id.eq.${prospectId}` : `code_client.eq.${codeClient}`)
      .limit(3);
    if (salles?.length) {
      const salle = salles[0] as any;
      const { data: liens } = await admin.from('arcade_parc')
        .select('arcade_machines(nom, categorie, type_jeu, editeur, annee, correspondance)')
        .eq('salle_id', salle.id).limit(300);
      const machines = (liens ?? []).map((l: any) => l.arcade_machines).filter(Boolean);
      const a = (re: RegExp) => machines.some((m: any) => re.test(String(m.nom)));
      faits.parc = {
        releve_le: salle.fiche_lue_at,
        source: 'annuaire-arcade.fr — machines présentes sur place, pas nécessairement vendues par nous',
        type_lieu: salle.type_lieu, prestations: salle.prestations,
        total: machines.length,
        flippers: machines.filter((m: any) => m.categorie === 'flipper').length,
        de_notre_catalogue: machines.filter((m: any) => m.correspondance === 'exacte' || m.correspondance === 'marque').length,
        familles_absentes: [
          machines.some((m: any) => m.categorie === 'flipper') ? null : 'flipper',
          a(/billard/i) ? null : 'billard',
          a(/baby ?foot/i) ? null : 'baby-foot',
          a(/grue|crane|pince|peluche/i) ? null : 'grue',
        ].filter(Boolean),
        principaux_fabricants: [...new Set(machines.map((m: any) => m.editeur).filter(Boolean))].slice(0, 5),
      };
      // COMPARAISON À SES SEMBLABLES. Un manque ne se juge pas dans l'absolu : un
      // bowling de douze machines sans jeu de café est une anomalie, celui de deux
      // machines ne l'est pas. On confronte donc l'assortiment du lieu à la norme de
      // sa cohorte — même type d'établissement, même taille de parc.
      const { data: sien } = await admin.from('v_arcade_assortiment')
        .select('famille, machines_famille, tranche').eq('salle_id', salle.id);
      const tranche = (sien ?? [])[0]?.tranche ?? null;
      if (tranche && salle.type_lieu) {
        const { data: normes } = await admin.from('v_arcade_normes')
          .select('famille, pct_equipes, lieux_cohorte, absence_interpretable')
          .eq('type_lieu', salle.type_lieu).eq('tranche', tranche);
        const possede = new Set((sien ?? []).map((r: any) => r.famille));
        // On ne signale que ce qu'une majorité nette de la cohorte possède ET dont
        // l'absence est interprétable : l'annuaire ignore les billards et les grues,
        // conclure de leur absence serait inventer.
        const ecarts = (normes ?? [])
          .filter((n: any) => n.absence_interpretable && n.pct_equipes >= 60 && !possede.has(n.famille))
          .map((n: any) => ({ famille: n.famille, pct_des_semblables: n.pct_equipes,
                              cohorte: `${salle.type_lieu} de ${tranche} machines`,
                              lieux_compares: n.lieux_cohorte }));
        if (ecarts.length) (faits.parc as any).absent_chez_lui_courant_ailleurs = ecarts;
        (faits.parc as any).cohorte = `${salle.type_lieu}, ${tranche} machines`;
      }

      // CE QU'IL A ET QUE NOUS NE VENDONS PAS, par genre — et ce que nous proposons
      // dans ces mêmes genres. C'est le croisement qui transforme un constat en offre :
      // un lieu équipé de huit tirs qu'aucun de nos fournisseurs ne fabrique est un lieu
      // qui aime les tirs, donc un candidat pour les nôtres.
      const horsCatalogue = machines.filter((m: any) => m.correspondance === 'aucune' && m.type_jeu);
      const parGenre = new Map<string, string[]>();
      for (const m of horsCatalogue) {
        const g = String(m.type_jeu);
        const l = parGenre.get(g);
        if (l) l.push(m.nom); else parGenre.set(g, [m.nom]);
      }
      if (parGenre.size) {
        (faits.parc as any).hors_catalogue_par_genre = [...parGenre.entries()]
          .sort((x, y) => y[1].length - x[1].length)
          .slice(0, 6)
          .map(([genre, noms]) => ({ genre, nombre: noms.length, exemples: noms.slice(0, 4) }));
        const familles = [...new Set([...parGenre.keys()]
          .map((g) => GENRE_VERS_FAMILLE[g.toLowerCase()]).filter(Boolean))];
        if (familles.length) {
          // Les références neuves seulement : proposer de l'occasion à un lieu qu'on ne
          // connaît pas encore n'est pas le bon premier pas.
          const { data: offre } = await admin.from('catalogue_erp')
            .select('description, famille, prix_ht').in('famille', familles).limit(400);
          const parFamille = new Map<string, string[]>();
          for (const o of offre ?? []) {
            const nom = String((o as any).description)
              .replace(/^(JV|FL|BA|BI|JB|JF)[A-Z0-9]{0,3}\s*-\s*/i, '').trim();
            const f = String((o as any).famille);
            const l = parFamille.get(f);
            if (l) { if (l.length < 12) l.push(nom); } else parFamille.set(f, [nom]);
          }
          faits.notre_offre_dans_ces_genres = [...parFamille.entries()]
            .map(([famille, refs]) => ({ famille, references: refs }));
        }
      }
    }
    // Les signaux de presse rattachés, s'il y en a.
    if (prospectId) {
      const { data: g } = await admin.from('gazette_signaux')
        .select('publie_le, titre, evenement, interpretation, contact_nom, contact_role, url')
        .eq('prospect_id', prospectId).order('publie_le', { ascending: false }).limit(3);
      if (g?.length) faits.presse = g;
    }

    // L'empreinte des faits : tant qu'elle ne bouge pas, le brief reste valable.
    const empreinte = JSON.stringify(faits).length + '-' +
      JSON.stringify(faits).split('').reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0);

    if (body.force !== true) {
      const { data: cache } = await admin.from('fiche_briefs')
        .select('contenu, genere_le, empreinte')
        .eq('cible_type', cibleType).eq('cible_id', cibleId).maybeSingle();
      if (cache && (cache as any).empreinte === empreinte) {
        return json({ ok: true, contenu: (cache as any).contenu, genere_le: (cache as any).genere_le, cache: true });
      }
    }

    // ── L'interprétation ──────────────────────────────────────────────────────
    const rep = await anthropicJson(ANTHROPIC_KEY, {
      model: MODEL, max_tokens: 700, system: PROMPT,
      messages: [{ role: 'user', content: `FAITS VÉRIFIÉS :\n\n${JSON.stringify(faits, null, 2)}` }],
    });
    const contenu: string = (rep?.content ?? []).find((b: any) => b.type === 'text')?.text?.trim() ?? '';
    if (!contenu) {
      // Sans le corps réel, « échec » ne dit rien : modèle refusé, quota et format
      // inattendu se ressemblent tous vus d'ici.
      return json({ error: 'Aucun texte renvoyé par le modèle', modele: MODEL, reponse: rep }, 502);
    }

    const { error: eMaj } = await admin.from('fiche_briefs').upsert({
      cible_type: cibleType, cible_id: cibleId, contenu, faits, empreinte,
      genere_le: new Date().toISOString(), genere_par: auteur,
    }, { onConflict: 'cible_type,cible_id' });
    if (eMaj) throw eMaj;

    return json({ ok: true, contenu, genere_le: new Date().toISOString(), cache: false });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
