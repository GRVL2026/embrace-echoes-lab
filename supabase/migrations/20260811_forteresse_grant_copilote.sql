-- Correctif de la vague 2 : le copilote doit pouvoir évaluer is_admin/is_direction.
--
-- Les policies de la vague 2 sur les tables Cegid appellent is_admin()/is_direction().
-- Le rôle technique copilot_readonly n'avait pas le droit d'EXÉCUTER ces deux fonctions
-- (contrairement à can_access_dashboard, d'où le fait que l'ancienne policy fonctionnait
-- pour lui). Résultat : dès la vague 2 appliquée, toute lecture des tables Cegid par le
-- copilote échouait sur « permission denied for function is_admin » — la lecture d'une
-- policy qui plante fait échouer la requête entière, même si une autre policy l'aurait
-- autorisée.
--
-- Ces fonctions ne font que constater le rôle de l'appelant (via auth.uid()) : les
-- exposer au copilote ne lui donne aucun accès nouveau, cela lui permet seulement de
-- traverser la policy sans la faire exploser.

grant execute on function public.is_admin() to copilot_readonly;
grant execute on function public.is_direction() to copilot_readonly;
