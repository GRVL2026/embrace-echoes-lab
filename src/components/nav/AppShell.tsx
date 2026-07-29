import { ReactNode } from "react";
import { useLocation, Link } from "react-router-dom";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/nav/AppSidebar";
import { CopilotProvider } from "@/contexts/CopilotContext";
import { GlobalCopilotPanel } from "@/components/copilot/GlobalCopilotPanel";
import { useAuth } from "@/contexts/AuthContext";
import { resolveActive, isMenuKeyAllowed, type NavCtx } from "@/nav/spaces";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Enveloppe globale des pages authentifiées : barre latérale persistante
 * (repliable en mode icônes, état mémorisé via cookie shadcn) + zone `main`
 * + copilote global (bouton flottant + raccourci Cmd/Ctrl+K + Sheet).
 *
 * Applique aussi la garde d'accès menu : si l'utilisateur ouvre une URL
 * correspondant à une entrée du menu qu'il n'a plus le droit de voir,
 * on affiche une page 403 au lieu de la page.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider defaultOpen>
      <CopilotProvider>
        <div className="flex min-h-screen w-full bg-background text-foreground">
          <AppSidebar />
          <div className="flex-1 min-w-0 flex flex-col">
            <MenuGuard>{children}</MenuGuard>
          </div>
        </div>
        <GlobalCopilotPanel />
      </CopilotProvider>
    </SidebarProvider>
  );
}

function MenuGuard({ children }: { children: ReactNode }) {
  const { pathname, hash } = useLocation();
  const auth = useAuth();
  const ctx: NavCtx = {
    isAdmin: auth.isAdmin,
    isDirection: auth.isDirection,
    canAccessGaia: auth.canAccessGaia,
    canAccessDashboard: auth.canAccessDashboard,
    canMargeGlobale: auth.canMargeGlobale,
    copilotEnabled: auth.copilotEnabled,
    canAccessSalle: auth.canAccessSalle,
    canAccessProspection: auth.canAccessProspection,
    canReactivation: auth.canReactivation,
    salleOnly: auth.salleOnly,
    menuAllowed: auth.menuAllowed,
  };
  const { space, entry } = resolveActive(pathname, hash, ctx);

  // Admin/direction bypass — jamais bloqués par la garde.
  if (auth.isAdmin || auth.isDirection) return <>{children}</>;

  // Si la route ne mappe pas à une entrée du menu (ex. pages détail), on laisse passer.
  if (!entry || !space) return <>{children}</>;

  const spaceBase = space.show ? space.show(ctx) : true;
  const entryBase = entry.show ? entry.show(ctx) : true;
  const allowed =
    isMenuKeyAllowed(ctx, space.key, spaceBase) &&
    isMenuKeyAllowed(ctx, entry.key, entryBase);

  if (allowed) return <>{children}</>;

  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="max-w-md text-center space-y-4">
        <div className="mx-auto w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
          <ShieldAlert className="h-6 w-6 text-destructive" />
        </div>
        <h1 className="font-display text-2xl font-bold">Accès refusé</h1>
        <p className="text-sm text-muted-foreground">
          Cette section n'est pas activée pour votre compte. Contactez un administrateur pour demander l'accès.
        </p>
        <Button asChild variant="default">
          <Link to="/">Retour à l'accueil</Link>
        </Button>
      </div>
    </div>
  );
}
