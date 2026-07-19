DELETE FROM public.veille_rapports
WHERE id IN (
  '5cc75892-d039-4533-8c99-40176c6d2b2a'::uuid,
  '90c484cc-ad1d-465d-ae13-ba590bc610b3'::uuid
)
AND COALESCE((contenu_json->'stats'->>'nb_sources')::integer, 0) = 0
AND (
  contenu_markdown ILIKE '%Server tool use limit exceeded%'
  OR contenu_markdown ILIKE '%Aucune donnée collectée%'
  OR contenu_json::text ILIKE '%Server tool use limit exceeded%'
);