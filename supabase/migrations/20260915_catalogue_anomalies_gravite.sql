-- Ajout de `gravite` et `notation` à catalogue_anomalies.
--
-- Pourquoi : la première version de l'audit appliquait un seuil de plausibilité unique
-- (200–10000 mm) à tout le catalogue. Confrontée aux 350 produits actifs, elle produisait
-- 148 lignes dont 145 fausses — les accessoires Stern (shooter knob 12 cm, dust cover 10 cm)
-- étaient accusés d'être hors plage alors qu'ils sont justes. Un rapport à 98 % de faux
-- positifs n'est pas lu, donc ne sert à rien.
--
-- L'audit distingue maintenant la notation (mm = machine, cm = accessoire) et sépare ce qui
-- rend les cotes inexploitables de ce qui n'est qu'un écart de convention.

alter table public.catalogue_anomalies
  add column if not exists notation text,
  add column if not exists gravite  text;

update public.catalogue_anomalies set gravite = 'bloquant' where gravite is null;
alter table public.catalogue_anomalies alter column gravite set not null;

drop index if exists catalogue_anomalies_anomalie_idx;
create index if not exists catalogue_anomalies_gravite_idx
  on public.catalogue_anomalies (gravite, anomalie);
