-- Le briefing affiche désormais le CA à trois échelles : exercice (N), mois (M), semaine (S).
--
-- Chaque échelle a sa base de comparaison, choisie par le dirigeant :
--   • N — exercice fiscal (sept→août) EN COURS vs N-1 « À DATE » : à période égale, chaque
--     exercice arrêté au même jour relatif qu'aujourd'hui. C'est la vue v_gaia_ca_periode_egale
--     qui porte déjà cette logique (et l'exclusion de l'éco-taxe, et les avoirs en négatif).
--   • M — mois EN COURS (cumul à ce jour) vs M-1 « GLOBAL » : le mois précédent COMPLET
--     comme repère.
--   • S — semaine EN COURS (lundi→aujourd'hui) vs la semaine précédente COMPLÈTE.
--
-- Toutes les sources passent par v_gaia_lignes, qui unionne ventes récentes et archive
-- (depuis sept. 2022), retire les clients exclus et compte les avoirs (CRM) en négatif :
-- le CA est donc cohérent avec le tableau de bord, et le N-1 est complet.
--
-- SECURITY DEFINER : v_gaia_lignes lit gaia_config, inaccessible au rôle appelant ; la
-- fonction s'exécute donc avec les droits du propriétaire. Le garde can_access_dashboard()
-- protège l'accès en tête.

drop function if exists public.get_briefing_ca();

create function public.get_briefing_ca()
returns table(ca_n numeric, ca_n1 numeric, ca_m numeric, ca_m1 numeric, ca_s numeric, ca_s1 numeric)
language plpgsql stable security definer set search_path to 'public'
as $function$
declare
  fy   int  := extract(year from current_date + interval '4 months')::int;  -- exercice courant
  m0   date := date_trunc('month', current_date)::date;
  m1   date := (date_trunc('month', current_date) - interval '1 month')::date;
  lun  date := date_trunc('week', current_date)::date;
  lun1 date := date_trunc('week', current_date)::date - 7;
  dim1 date := date_trunc('week', current_date)::date - 1;
begin
  if not public.can_access_dashboard() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- N : exercice à date, à période égale (la vue fait tout le travail)
  select coalesce(max(v.ca_ht) filter (where v.annee = fy), 0)::numeric,
         coalesce(max(v.ca_ht) filter (where v.annee = fy - 1), 0)::numeric
    into ca_n, ca_n1
  from public.v_gaia_ca_periode_egale v;

  -- M : mois en cours (cumul) vs mois précédent complet
  select coalesce(sum(c.ca_ht) filter (where c.mois = m0), 0)::numeric,
         coalesce(sum(c.ca_ht) filter (where c.mois = m1), 0)::numeric
    into ca_m, ca_m1
  from public.v_gaia_ca_mensuel c;

  -- S : semaine en cours vs semaine précédente complète, hors éco-taxe
  select coalesce(sum(l.montant_ht) filter (where l.invoice_date >= lun), 0)::numeric,
         coalesce(sum(l.montant_ht) filter (where l.invoice_date >= lun1 and l.invoice_date <= dim1), 0)::numeric
    into ca_s, ca_s1
  from public.v_gaia_lignes l
  where l.invoice_date is not null
    and l.code_article not in (select code from public.v_gaia_ecotax_codes)
    and l.invoice_date >= lun1;

  return next;
end;
$function$;

grant execute on function public.get_briefing_ca() to authenticated;
