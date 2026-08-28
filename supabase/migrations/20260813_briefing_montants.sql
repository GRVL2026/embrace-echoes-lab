-- Le briefing du matin affiche le NOMBRE de devis/commandes de la semaine, mais pas leur
-- montant — le dirigeant devait additionner de tête. On fait remonter la somme.
--
-- DROP puis CREATE, et non « create or replace » : on ajoute une colonne au type de
-- retour (montant), et Postgres refuse de changer la signature d'une fonction existante.
-- Rien d'autre en base n'appelle cette fonction (seul le front, via rpc).

drop function if exists public.get_briefing_activite_hebdo();

create function public.get_briefing_activite_hebdo()
returns table(jour date, type_doc text, univers text, n_docs integer, montant numeric)
language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if not public.can_access_dashboard() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
  with lignes as (
    select c.n_cde,
      case c.type_cde when 'QT' then 'devis' else 'commande' end as type_doc,
      c.invoice_date,
      case when c.classe_article ilike 'JEUX%' then 'jeux' else 'magasin' end as univ,
      coalesce(c.montant_ht, 0) as m
    from public.gaia_commandes c
    where c.type_cde in ('QT','SO')
      and c.invoice_date >= date_trunc('week', current_date)::date - 7
      and c.invoice_date <  date_trunc('week', current_date)::date + 7
  ),
  -- Un document (n_cde) porte plusieurs lignes : son montant est leur somme, et son
  -- univers celui de sa plus grosse ligne.
  doc as (
    select l.n_cde,
      max(l.type_doc) as type_doc,
      min(l.invoice_date) as jour,
      (array_agg(l.univ order by l.m desc))[1] as univers,
      sum(l.m) as montant_doc
    from lignes l group by l.n_cde
  )
  select d.jour, d.type_doc, d.univers, count(*)::int, coalesce(sum(d.montant_doc), 0)
  from doc d group by 1, 2, 3;
end;
$function$;

grant execute on function public.get_briefing_activite_hebdo() to authenticated;
