import { Link, useLocation } from "react-router-dom";
import { ChevronRight, Home } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { resolveActive, type NavCtx } from "@/nav/spaces";
import { SidebarTrigger } from "@/components/ui/sidebar";

/**
 * Fil d'Ariane : Espace → Page → (Détail).
 * Rendu automatiquement partout via <AppTopNav /> (rétro-compat) ou peut
 * être placé manuellement dans une page. La couleur d'accent suit l'espace
 * courant.
 */
export function Breadcrumbs({ detail }: { detail?: string }) {
  const { pathname, hash } = useLocation();
  const { isAdmin, isDirection, canAccessGaia, canAccessDashboard, copilotEnabled, canAccessSalle, salleOnly } =
    useAuth();

  const ctx: NavCtx = {
    isAdmin,
    isDirection,
    canAccessGaia,
    canAccessDashboard,
    copilotEnabled,
    canAccessSalle,
    salleOnly,
  };
  const { space, entry } = resolveActive(pathname, hash, ctx);

  const color = space ? `hsl(var(${space.colorToken}))` : undefined;

  return (
    <nav
      aria-label="Fil d'Ariane"
      className="flex items-center gap-1.5 text-xs text-muted-foreground min-w-0"
    >
      <SidebarTrigger className="h-7 w-7 mr-1 hidden md:inline-flex" />
      <Link
        to="/"
        className="inline-flex items-center gap-1 hover:text-foreground"
        aria-label="Hub"
      >
        <Home className="h-3 w-3" />
      </Link>
      {space && (
        <>
          <ChevronRight className="h-3 w-3 opacity-50" />
          <span style={{ color }} className="font-medium whitespace-nowrap">
            {space.label}
          </span>
        </>
      )}
      {entry && (
        <>
          <ChevronRight className="h-3 w-3 opacity-50" />
          <span className="text-foreground whitespace-nowrap truncate">
            {entry.label}
          </span>
        </>
      )}
      {detail && (
        <>
          <ChevronRight className="h-3 w-3 opacity-50" />
          <span className="text-foreground truncate">{detail}</span>
        </>
      )}
    </nav>
  );
}
