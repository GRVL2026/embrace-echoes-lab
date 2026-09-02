-- Ventilation du CA d'un client par FACTURE puis par LIGNE (modèle + type de jeu),
-- pour l'EXERCICE cliqué sur la fiche client.
--
-- IMPORTANT — même base que la carte CA (vue v_gaia_ca_client) pour que les totaux collent :
--   • EXERCICE FISCAL (sept N-1 → août N), pas l'année civile. La carte « CA 2026 » = les
--     factures du 2025-09-01 au 2026-08-31. (v_gaia_ca_client fait extract(year from date+4 mois).)
--   • HORS ÉCO-TAXE (codes de v_gaia_ecotax_codes exclus).
-- Vérifié sur EURL Bananas : gaia_ventes fiscal 2026 hors éco-taxe = 270 234 € = le CA affiché.
--
-- Chaque LIGNE est jointe au catalogue ERP pour le modèle (description) et le type (famille) ;
-- le front regroupe par facture (total + détail dépliable) et agrège par type (camembert).
-- SECURITY DEFINER (contourne la RLS) → réservé admin/direction, comme la fiche client.
-- catalogue_erp = articles ACTIFS seulement : description NULL pour un article retiré → on
-- retombe sur le code_article. Casts défensifs (types source parfois texte).

drop function if exists public.get_client_factures(text[], int);
drop function if exists public.get_client_ventes_lignes(text[], int);

create function public.get_client_ventes_lignes(_codes text[], _annee int)
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
    and v.invoice_date::date >= make_date(_annee - 1, 9, 1)
    and v.invoice_date::date <  make_date(_annee, 9, 1)
    and v.code_article not in (select code from public.v_gaia_ecotax_codes)
  order by v.invoice_date::date desc, v.n_fact, v.montant_ht::numeric desc;
end;
$$;

grant execute on function public.get_client_ventes_lignes(text[], int) to authenticated;
