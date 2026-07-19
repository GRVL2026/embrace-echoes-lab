import { Breadcrumbs } from "@/components/nav/Breadcrumbs";

/**
 * Rétro-compatibilité : les pages existantes rendent encore `<AppTopNav />`.
 * Depuis la refonte navigation, cette barre est remplacée par le fil d'Ariane
 * (l'ancien onglet de navigation est désormais dans la sidebar).
 */
export function AppTopNav() {
  return (
    <div className="ml-2 hidden md:flex items-center min-w-0">
      <Breadcrumbs />
    </div>
  );
}
