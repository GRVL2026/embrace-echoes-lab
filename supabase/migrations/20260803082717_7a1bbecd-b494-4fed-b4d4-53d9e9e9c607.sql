-- Le rôle copilot_readonly ne doit être utilisable que via SET ROLE (gaia_query),
-- jamais hérité implicitement par les utilisateurs connectés.
GRANT copilot_readonly TO authenticated WITH INHERIT FALSE;