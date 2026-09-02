-- Ventilation du CA d'un client par FACTURE, pour l'exercice cliqué sur la fiche client.
--
-- La fiche ne charge que les 10 dernières LIGNES de vente (limite front) : insuffisant pour
-- une ventilation complète et juste. On agrège donc en base, par n_fact, sur l'année demandée
-- (une ligne par facture, montant = somme HT des lignes), ce qui évite aussi le plafond de
-- 1000 lignes de PostgREST côté client.
--
-- SECURITY DEFINER (contourne la RLS) → réservé admin/direction, comme la fiche client
-- (canAccessGaia). Casts défensifs sur invoice_date / montant_ht au cas où le type source
-- serait du texte.

create or replace function public.get_client_factures(_codes text[], _annee int)
returns table(n_fact text, invoice_date date, montant_ht numeric, nb_lignes int)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not (public.is_admin() or public.is_direction()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
  select v.n_fact,
         max(v.invoice_date::date)                as invoice_date,
         sum(coalesce(v.montant_ht::numeric, 0))  as montant_ht,
         count(*)::int                            as nb_lignes
  from public.gaia_ventes v
  where v.code_client = any(_codes)
    and v.n_fact is not null
    and v.invoice_date is not null
    and extract(year from v.invoice_date::date)::int = _annee
  group by v.n_fact
  order by max(v.invoice_date::date) desc;
end;
$$;

grant execute on function public.get_client_factures(text[], int) to authenticated;
