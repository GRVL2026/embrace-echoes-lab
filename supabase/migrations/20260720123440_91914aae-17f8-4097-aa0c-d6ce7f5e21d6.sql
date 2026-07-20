UPDATE public.gaia_ventes SET code_client = btrim(code_client) WHERE code_client IS NOT NULL AND code_client <> btrim(code_client);
UPDATE public.gaia_commandes SET code_client = btrim(code_client) WHERE code_client IS NOT NULL AND code_client <> btrim(code_client);
UPDATE public.gaia_clients SET name = btrim(name) WHERE name IS NOT NULL AND name <> btrim(name);