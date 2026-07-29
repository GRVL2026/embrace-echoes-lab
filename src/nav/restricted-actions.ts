/**
 * Permissions fines pour actions sensibles (défaut = OFF stricte).
 * Contrairement aux clés de menu (par défaut ON), ces clés ne sont
 * accordées que si `user_menu_access.allowed = true` explicitement.
 *
 * Le front doit tester `menuAllowed(key) === true`.
 * Les edge functions doivent revérifier côté serveur.
 */
export type RestrictedAction = {
  key: string;
  label: string;
  description: string;
};

export const RESTRICTED_ACTIONS: RestrictedAction[] = [
  {
    key: "prospection.detecter_signaux",
    label: "Prospection · Détecter les signaux",
    description: "Lancer la détection des établissements récemment créés.",
  },
  {
    key: "prospection.preparer",
    label: "Prospection · Préparer les nouveaux",
    description: "Lancer l'agent d'enrichissement + accroche IA.",
  },
  {
    key: "prospection.envoyer_lgm",
    label: "Prospection · Envoyer vers LGM",
    description: "Envoyer des prospects vers La Growth Machine (bulk et unitaire).",
  },
  {
    key: "prospection.importer_csv",
    label: "Prospection · Importer CSV",
    description: "Importer des prospects depuis un fichier CSV.",
  },
];

export const RESTRICTED_ACTION_KEYS = new Set(RESTRICTED_ACTIONS.map((a) => a.key));
