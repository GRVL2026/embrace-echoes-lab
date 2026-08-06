-- Assortiments : ce qu'un lieu possède, comparé à ce que possèdent ses semblables.
--
-- L'idée : un bowling de douze machines sans jeu de café est une anomalie, puisque
-- 95 % des lieux de cette taille en ont un. Un bowling de deux machines sans jeu de
-- café est normal. Le manque ne se juge pas dans l'absolu, il se juge par rapport à
-- une cohorte — type de lieu et taille de parc.
--
-- ⚠️ PÉRIMÈTRE DE FIABILITÉ, à lire avant d'exploiter ces vues.
--
-- L'annuaire est tenu par des passionnés de jeux vidéo. Il recense 184 modèles de
-- flippers et des centaines de bornes, mais UN SEUL modèle de billard, UN SEUL de
-- baby-foot et QUATRE de grue. Ces familles existent sur le terrain bien plus qu'ici :
-- leur absence dans les données ne prouve rien.
--
-- Sont donc FIABLES : flipper, tir, conduite, sport/rythme, et le reste des bornes.
-- Sont INDICATIFS SEULEMENT : jeu de café et grue — une présence signifie quelque
-- chose, une absence ne signifie rien.

-- ── Famille d'une machine ────────────────────────────────────────────────────
create or replace function public.arcade_famille(nom text, categorie text, type_jeu text)
returns text language sql immutable as $$
  select case
    when categorie = 'flipper' then 'flipper'
    when nom ~* 'grue|crane|pince|peluche|prize|claw' then 'grue'
    when nom ~* 'billard|baby ?foot|air ?hockey|boxer|palet' then 'jeu de café'
    when type_jeu ~* 'rail shooter|^shoot|run and gun|^action$' then 'tir'
    when type_jeu ~* '^course|simulateur|combat motorisé|motion gaming' then 'conduite'
    when type_jeu ~* '^rythme$|^danse$|^basket$|^sport$' then 'sport/rythme'
    else 'autre borne'
  end;
$$;

/** Les familles dont l'absence est interprétable. Voir la mise en garde en tête. */
create or replace function public.arcade_famille_fiable(famille text)
returns boolean language sql immutable as $$
  select famille in ('flipper', 'tir', 'conduite', 'sport/rythme', 'autre borne');
$$;

-- ── L'assortiment d'un lieu ──────────────────────────────────────────────────
create or replace view public.v_arcade_assortiment
with (security_invoker = true) as
  select s.id as salle_id, s.nom, s.ville, s.departement, s.region, s.type_lieu,
         s.prospect_id, s.code_client,
         count(*)::int as nb_machines,
         case when count(*) <= 3 then '1-3' when count(*) <= 8 then '4-8'
              when count(*) <= 15 then '9-15' when count(*) <= 30 then '16-30'
              else '31+' end as tranche,
         public.arcade_famille(m.nom, m.categorie, m.type_jeu) as famille,
         count(*)::int as machines_famille
    from public.arcade_salles s
    join public.arcade_parc p on p.salle_id = s.id
    join public.arcade_machines m on m.slug = p.machine_slug
   where s.ferme = false
   group by s.id, s.nom, s.ville, s.departement, s.region, s.type_lieu,
            s.prospect_id, s.code_client,
            public.arcade_famille(m.nom, m.categorie, m.type_jeu);

-- ── La norme d'une cohorte ───────────────────────────────────────────────────
-- Combien de lieux du même type et de la même taille possèdent cette famille, et en
-- quelle quantité. C'est la référence contre laquelle se mesure un manque.
create or replace view public.v_arcade_normes
with (security_invoker = true) as
  with parcs as (
    select s.id, s.type_lieu, count(*)::int as n,
           case when count(*) <= 3 then '1-3' when count(*) <= 8 then '4-8'
                when count(*) <= 15 then '9-15' when count(*) <= 30 then '16-30'
                else '31+' end as tranche
      from public.arcade_salles s
      join public.arcade_parc p on p.salle_id = s.id
     where s.ferme = false group by s.id, s.type_lieu
  ),
  presence as (
    select pa.type_lieu, pa.tranche, f.famille,
           count(distinct pa.id) as lieux_avec
      from parcs pa
      join public.arcade_parc p on p.salle_id = pa.id
      join public.arcade_machines m on m.slug = p.machine_slug
      join lateral (select public.arcade_famille(m.nom, m.categorie, m.type_jeu) as famille) f on true
     group by pa.type_lieu, pa.tranche, f.famille
  ),
  total as (
    select type_lieu, tranche, count(*) as lieux from parcs group by type_lieu, tranche
  )
  select t.type_lieu, t.tranche, pr.famille,
         t.lieux::int as lieux_cohorte,
         pr.lieux_avec::int,
         round(100.0 * pr.lieux_avec / t.lieux)::int as pct_equipes,
         public.arcade_famille_fiable(pr.famille) as absence_interpretable
    from total t
    join presence pr on pr.type_lieu = t.type_lieu and pr.tranche = t.tranche
   where t.lieux >= 8;   -- sous huit lieux, une « norme » n'en est pas une

grant select on public.v_arcade_assortiment, public.v_arcade_normes to copilot_readonly;
