-- Ventilation du CA d'un client par FACTURE puis par LIGNE (modèle + type de jeu),
-- pour l'exercice cliqué sur la fiche client.
--
-- La fiche ne charge que les 10 dernières lignes de vente (limite front) : insuffisant.
-- On renvoie ici TOUTES les lignes de l'année (jointes au catalogue ERP pour le modèle et
-- la famille), le front les regroupe par facture (total + détail dépliable). L'agrégation/
-- jointure en base évite aussi le plafond de 1000 lignes de PostgREST côté client.
--
-- SECURITY DEFINER (contourne la RLS) → réservé admin/direction, comme la fiche client.
-- catalogue_erp ne contient que les articles ACTIFS : description peut être NULL pour un
-- article retiré → on retombe sur le code_article. Casts défensifs (types source parfois texte).

-- Ancienne version niveau-facture, remplacée par la version niveau-ligne ci-dessous.
drop function if exists public.get_client_factures(text[], int);

create or replace function public.get_client_ventes_lignes(_codes text[], _annee int)
returns table(
  n_fact       text,
  invoice_date date,
  code_article text,
  modele       text,
  famille      text,
  qty          numeric,
  montant_ht   numeric
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not (public.is_admin() or public.is_direction()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
  select v.n_fact,
         v.invoice_date::date                      as invoice_date,
         v.code_article,
         coalesce(ce.description, v.code_article)   as modele,
         ce.famille                                 as famille,
         coalesce(v.qty::numeric, 0)                as qty,
         coalesce(v.montant_ht::numeric, 0)         as montant_ht
  from public.gaia_ventes v
  left join public.catalogue_erp ce on ce.code = v.code_article
  where v.code_client = any(_codes)
    and v.n_fact is not null
    and v.invoice_date is not null
    and extract(year from v.invoice_date::date)::int = _annee
  order by v.invoice_date::date desc, v.n_fact, v.montant_ht::numeric desc;
end;
$$;

grant execute on function public.get_client_ventes_lignes(text[], int) to authenticated;
